import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { seedCampobasso, type ProjectBundle } from '@mdt/domain';
import { Layout } from '../app/Layout';
import { AuthContext } from '../state/auth';
import { PreferencesProvider } from '../state/preferences';
import { StoreProvider, useStore } from '../state/store';
import { ConflictError } from '../state/supabaseRepository';
import type { Repository } from '../state/repository';
import { fakeAuth } from './utils';

/** Conflitto di salvataggio: un messaggio, “Ricarica progetto” principale, “Annulla”, dettagli solo espandibili. */
function setup() {
  const b = seedCampobasso(new Date('2026-10-25T08:00:00Z'));
  const repo: Repository & { list: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> } = {
    kind: 'supabase',
    list: vi.fn(async () => [b]),
    get: vi.fn(async () => b),
    save: vi.fn(async () => {
      throw new ConflictError({ codice: 'MDT_CONFLITTO_VERSIONE', versioneAttesa: 1, versioneTrovata: 2, aggiornatoIl: '2026-10-25T09:00:00Z' });
    }),
    remove: vi.fn(async () => {}),
  };
  function Saver() {
    const { save, get } = useStore();
    return (
      <button type="button" onClick={() => void save(get(b.project.id) as ProjectBundle).catch(() => {})}>
        Salva modifica
      </button>
    );
  }
  render(
    <AuthContext.Provider value={fakeAuth()}>
      <PreferencesProvider>
        <StoreProvider repository={repo}>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<Saver />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </StoreProvider>
      </PreferencesProvider>
    </AuthContext.Provider>,
  );
  return { repo };
}

describe('Conflitto di salvataggio nell’interfaccia', () => {
  it('messaggio chiaro senza codici tecnici, una sola azione principale, nessun nuovo salvataggio automatico', async () => {
    const { repo } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Salva modifica' }));
    const notice = await screen.findByTestId('conflict-notice');
    expect(screen.getByRole('alert').textContent).toBe('⚠Questo progetto è stato aggiornato da un’altra persona. Ricarica i dati prima di salvare nuovamente.');
    expect(screen.getByRole('alert').textContent).not.toMatch(/PT409|MDT_|40001|versione/);
    expect(screen.getByRole('button', { name: 'Ricarica progetto' }).className).toMatch(/btn-primary/);
    expect(screen.getByRole('button', { name: 'Annulla' }).className).toMatch(/btn-secondary/);
    // dettagli tecnici chiusi finché l'utente non li apre
    const details = notice.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.textContent).toMatch(/Versione attesa1/);
    expect(details.textContent).toMatch(/Versione trovata2/);
    expect(details.textContent).toMatch(/MDT_CONFLITTO_VERSIONE/);
    expect(repo.save).toHaveBeenCalledTimes(1);
    // nessun banner d'errore generico duplicato
    expect(screen.queryByText(/Salvataggio non riuscito/)).toBeNull();
  });

  it('“Ricarica progetto” rilegge i dati e chiude l’avviso', async () => {
    const { repo } = setup();
    await waitFor(() => expect(repo.list).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Salva modifica' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ricarica progetto' }));
    await waitFor(() => expect(screen.queryByTestId('conflict-notice')).toBeNull());
    expect(repo.list).toHaveBeenCalledTimes(2);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('“Annulla” chiude l’avviso senza ricaricare né salvare', async () => {
    const { repo } = setup();
    await waitFor(() => expect(repo.list).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Salva modifica' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByTestId('conflict-notice')).toBeNull());
    expect(repo.list).toHaveBeenCalledTimes(1);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });
});
