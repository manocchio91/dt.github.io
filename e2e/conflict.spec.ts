import { expect, test } from '@playwright/test';
import { openUrbanLabAsEditor } from './helpers';
import { initialState, installFakeSupabase, ORG_B, type FakeState } from './fakeSupabase';

/**
 * Conflitto di salvataggio con due persone sullo stesso progetto (backend simulato: risposta HTTP 409 PT409
 * come PostgREST). Nessun salvataggio automatico dopo il conflitto.
 */
let state: FakeState;

test.beforeEach(async ({ page }) => {
  state = initialState();
  for (const d of Object.values(state.docs)) d.org = ORG_B;
  state.weather.locations[0]!.organization_id = ORG_B;
  await page.route(/open-meteo\.com|tile\.openstreetmap\.org/, (r) => r.abort());
  await installFakeSupabase(page, state);
});

test('due persone sullo stesso progetto: avviso chiaro, “Ricarica progetto”, nessun salvataggio automatico', async ({ page }) => {
  const pid = await openUrbanLabAsEditor(page, state);
  // un'altra persona salva nel frattempo
  state.docs[pid]!.version += 1;
  const before = state.rpcCalls.filter((c) => c.name === 'save_project').length;
  await page.getByRole('button', { name: 'Calcola A' }).click();

  const notice = page.getByTestId('conflict-notice');
  await expect(notice).toBeVisible();
  await expect(notice.getByRole('alert')).toHaveText(/Questo progetto è stato aggiornato da un’altra persona\. Ricarica i dati prima di salvare nuovamente\./);
  await expect(notice.getByRole('alert')).not.toContainText('PT409');
  await expect(notice.locator('details')).not.toHaveAttribute('open', '');
  const saves = state.rpcCalls.filter((c) => c.name === 'save_project').slice(before);
  expect(saves.map((c) => c.status)).toEqual([409]);

  // da tastiera: Tab porta alle azioni, Invio ricarica
  await notice.getByRole('button', { name: 'Ricarica progetto' }).focus();
  await page.keyboard.press('Enter');
  await expect(notice).toHaveCount(0);
  // nessun nuovo tentativo di salvataggio dopo il conflitto
  expect(state.rpcCalls.filter((c) => c.name === 'save_project').slice(before)).toHaveLength(1);

  // dopo la ricarica il salvataggio riparte dalla versione aggiornata
  await page.getByRole('button', { name: 'Calcola A' }).click();
  await expect.poll(() => state.rpcCalls.filter((c) => c.name === 'save_project').slice(before).map((c) => c.status)).toEqual([409, 200]);
});

test('“Annulla” chiude l’avviso; i dettagli tecnici si aprono solo su richiesta', async ({ page }) => {
  const pid = await openUrbanLabAsEditor(page, state);
  state.docs[pid]!.version += 1;
  await page.getByRole('button', { name: 'Calcola A' }).click();
  const notice = page.getByTestId('conflict-notice');
  await notice.getByText('Dettagli tecnici').click();
  await expect(notice.getByText('Codice conflitto')).toBeVisible();
  await expect(notice.getByText('MDT_CONFLITTO_VERSIONE')).toBeVisible();
  await notice.getByRole('button', { name: 'Annulla' }).click();
  await expect(notice).toHaveCount(0);
});
