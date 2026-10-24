import { expect, test, type Page } from '@playwright/test';
import { answer, editButtonTexts, REMOTE } from './helpers';
import { initialState, installFakeSupabase, USER, type FakeState } from './fakeSupabase';

/** Utente autenticato con due organizzazioni: lettura in "Comune A", modifica in "Comune B". */

let state: FakeState;

test.beforeEach(async ({ page }) => {
  state = initialState();
  await page.route(/open-meteo\.com|tile\.openstreetmap\.org/, (r) => r.abort());
  await installFakeSupabase(page, state);
});

async function login(page: Page) {
  await page.goto(REMOTE + '/accesso');
  await page.getByLabel('Email').fill(USER.email);
  await page.getByLabel('Password').fill(USER.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByText(`Accesso effettuato come ${USER.email}`)).toBeVisible();
}

async function selectOrg(page: Page, name: RegExp) {
  await page.goto(REMOTE + '/accesso');
  await page.getByRole('radio', { name }).check();
}

test('ruolo "lettura": nessun comando di modifica, anche scegliendo il profilo "Revisore"', async ({ page }) => {
  await login(page);
  await selectOrg(page, /Comune A.*lettura/);
  await expect(page.getByRole('link', { name: /Comune A · lettura/ })).toBeVisible();

  // onboarding con profilo "Revisore": il ruolo resta "lettura"
  await page.goto(REMOTE + '/benvenuto');
  await expect(page.getByText(/il tuo ruolo è: lettura/)).toBeVisible();
  await answer(page, /Revisore/);
  await answer(page, /Città/);
  await answer(page, /Preparare una proposta/);
  await expect(page.getByRole('radio', { name: /Un mio nuovo progetto/ })).toHaveCount(0);
  await answer(page, /Area dimostrativa/);
  await answer(page, null);
  await answer(page, /Guidata/);
  await expect(page).toHaveURL(/\/urbano$/);

  // preferenze scritte sulla propria riga, senza campi di permesso
  expect(state.prefWrites).toHaveLength(1);
  expect(state.prefWrites[0]).toMatchObject({ user_id: USER.id, profile: 'revisore' });
  expect(JSON.stringify(state.prefWrites[0])).not.toMatch(/"role"|canEdit|organization_id/);

  await expect(page.getByText(/Ruolo “lettura” in Comune A/)).toBeVisible();
  expect(await editButtonTexts(page)).toEqual([]);
  await page.goto(REMOTE + '/progetti');
  await expect(page.getByRole('heading', { name: /Campobasso/ })).toBeVisible();
  expect(await editButtonTexts(page)).toEqual([]);
  await expect(page.getByRole('button', { name: 'Elimina' })).toHaveCount(0);
  // nessun tentativo di scrittura è partito verso il server
  expect(state.rpcCalls).toEqual([]);
});

test('cambiando organizzazione si aggiornano archivio, progetti e permessi', async ({ page }) => {
  await login(page);
  await selectOrg(page, /Comune A.*lettura/);
  await page.goto(REMOTE + '/progetti');
  await expect(page.getByRole('heading', { name: /Campobasso/ })).toBeVisible();
  expect(await editButtonTexts(page)).toEqual([]);

  await selectOrg(page, /Comune B.*modifica/);
  await expect(page.getByRole('link', { name: /Comune B · modifica/ })).toBeVisible();
  await page.goto(REMOTE + '/progetti');
  await expect(page.getByRole('heading', { name: /Campobasso/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Crea e definisci l’area/ })).toBeVisible();

  // in Comune B si può caricare la demo: il salvataggio passa dal server con il ruolo corretto
  await page.getByRole('button', { name: 'Carica demo urbana' }).click();
  await expect(page).toHaveURL(/\/urbano$/);
  await expect(page.getByRole('button', { name: 'Calcola A' })).toBeVisible();
  expect(state.rpcCalls.filter((c) => c.status === 200)).toHaveLength(1);
});

test('le preferenze dell’account persistono tra sessioni', async ({ page }) => {
  await login(page);
  await page.goto(REMOTE + '/benvenuto');
  await answer(page, /Agronomo/);
  await answer(page, null);
  await answer(page, /Registrare cosa vedo/);
  await answer(page, /Vigneto dimostrativo/);
  await answer(page, null);
  await answer(page, /Tecnica/);
  await page.waitForURL(/\/agricolo$|\/benvenuto/);
  expect(state.prefs[USER.id]).toMatchObject({ profile: 'agronomo', mode: 'tecnica' });

  // nuova pagina: nessuna copia locale, le preferenze tornano dal server
  expect(await page.evaluate(() => localStorage.getItem('mdt:onboarding:v1'))).toBeNull();
  await page.goto(REMOTE + '/');
  await expect(page.getByText(/Agronomo o consulente · Registrare cosa vedo in campo/)).toBeVisible();
});

test('il server rifiuta comunque le scritture di chi ha solo la lettura (RLS come protezione principale)', async ({ page }) => {
  await login(page);
  await selectOrg(page, /Comune A.*lettura/);
  // chiamata diretta all'RPC con il token dell'utente, aggirando l'interfaccia
  const status = await page.evaluate(async (bundle) => {
    const r = await fetch('http://supabase.e2e.test/rest/v1/rpc/save_project', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer token-00000000-0000-4000-8000-00000000e2e1', apikey: 'x' },
      body: JSON.stringify({ p_organization_id: '00000000-0000-4000-8000-0000000000a1', p_bundle: bundle, p_bundle_hash: 'h', p_expected_version: 1 }),
    });
    return r.status;
  }, Object.values(state.docs)[0]!.bundle);
  expect(status).toBe(403);
});
