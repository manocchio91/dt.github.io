import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { seedCampobasso, seedVineyard, type ProjectBundle } from '@mdt/domain';
import { ProjectsPage } from '../pages/ProjectsPage';
import AreaPage from '../pages/AreaPage';
import UrbanLabPage from '../pages/UrbanLabPage';
import ComparePage from '../pages/ComparePage';
import VerifyPage from '../pages/VerifyPage';
import AgriLabPage from '../pages/AgriLabPage';
import ForecastPage from '../pages/ForecastPage';
import { fakeAuth, fakeSession, member, remoteRepo, renderApp } from './utils';
import type { ReactNode } from 'react';
import type { OrgRole } from '../state/auth';

/** B-120: chi ha solo il ruolo "lettura" non vede comandi di modifica. */
const EDIT = /^(calcola|aggiungi|registra|crea|elimina|salva|disegna|importa|conferm|aggiorna|invia|usa valori|posiziona|carica|rimuovi|copia qui|annulla)/i;

let urban: ProjectBundle;
let agri: ProjectBundle;

beforeEach(() => {
  localStorage.clear();
  urban = seedCampobasso(new Date('2026-10-24T08:00:00Z'));
  agri = seedVineyard(new Date('2026-08-20T08:00:00Z'), '2026-08-20');
});

const pages: { name: string; ui: () => ReactNode; route: () => string; path: string; marker: RegExp }[] = [
  { name: 'Progetti', ui: () => <ProjectsPage />, route: () => '/progetti', path: '/progetti', marker: /Campobasso/ },
  { name: 'Parcelle', ui: () => <AreaPage />, route: () => `/progetti/${agri.project.id}/area`, path: '/progetti/:id/area', marker: /Sottozone della parcella/ },
  { name: 'Lab urbano', ui: () => <UrbanLabPage />, route: () => `/progetti/${urban.project.id}/urbano`, path: '/progetti/:id/urbano', marker: /RISULTATO SINTETICO/ },
  { name: 'Confronto', ui: () => <ComparePage />, route: () => `/progetti/${urban.project.id}/confronto`, path: '/progetti/:id/confronto', marker: /Tabella di confronto/ },
  { name: 'Verifica', ui: () => <VerifyPage />, route: () => `/progetti/${urban.project.id}/verifica`, path: '/progetti/:id/verifica', marker: /Piano di monitoraggio/ },
  { name: 'Lab agricolo', ui: () => <AgriLabPage />, route: () => `/progetti/${agri.project.id}/agricolo`, path: '/progetti/:id/agricolo', marker: /Componenti per zona/ },
  { name: 'Previsioni urbane', ui: () => <ForecastPage />, route: () => `/progetti/${urban.project.id}/previsioni`, path: '/progetti/:id/previsioni', marker: /Confronto con le baseline/ },
  { name: 'Previsioni vigneto', ui: () => <ForecastPage />, route: () => `/progetti/${agri.project.id}/previsioni`, path: '/progetti/:id/previsioni', marker: /Soglie dell’agronomo/ },
];

async function renderAs(role: OrgRole, page: (typeof pages)[number]) {
  const auth = fakeAuth({ session: fakeSession(), memberships: [member(role)], current: member(role) });
  renderApp(page.ui(), { auth, repo: remoteRepo([urban, agri]), route: page.route(), path: page.path });
  await screen.findAllByText(page.marker);
}

const editButtons = () => screen.queryAllByRole('button').filter((b) => EDIT.test((b.textContent ?? '').trim()));

describe('B-120 — interfaccia per ruolo', () => {
  for (const page of pages) {
    it(`${page.name}: il ruolo "lettura" non vede comandi di modifica`, async () => {
      await renderAs('viewer', page);
      expect(editButtons().map((b) => b.textContent)).toEqual([]);
      expect(document.querySelectorAll('input[type=file]')).toHaveLength(0);
      expect(document.querySelectorAll('textarea:not([readonly])')).toHaveLength(0);
    });

    it(`${page.name}: il ruolo "modifica" vede i comandi`, async () => {
      await renderAs('editor', page);
      expect(editButtons().length).toBeGreaterThan(0);
    });
  }

  it('solo l’amministratore vede "Elimina" nei progetti dell’organizzazione', async () => {
    await renderAs('editor', pages[0]!);
    expect(screen.queryByRole('button', { name: 'Elimina' })).toBeNull();
  });

  it('nell’archivio locale (ospite) i comandi sono disponibili', async () => {
    renderApp(<UrbanLabPage />, { repo: remoteRepoLocal([urban]), route: `/progetti/${urban.project.id}/urbano`, path: '/progetti/:id/urbano' });
    await screen.findAllByText(/RISULTATO SINTETICO/);
    expect(within(document.body).getAllByRole('button', { name: /Calcola A/ }).length).toBe(1);
  });
});

function remoteRepoLocal(bundles: ProjectBundle[]) {
  const r = remoteRepo(bundles);
  return { ...r, kind: 'local' as const };
}
