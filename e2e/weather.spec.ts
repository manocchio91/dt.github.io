import { expect, test, type Page } from '@playwright/test';
import { LOCAL, REMOTE } from './helpers';
import { initialState, installFakeSupabase, ORG_B, USER, type FakeState } from './fakeSupabase';
import { WEATHER_LOC } from './fakeWeather';

/** Pannello “Dati meteorologici” contro Supabase simulato (dati da una risposta reale Open-Meteo). */

let state: FakeState;
const openMeteoCalls: string[] = [];

test.beforeEach(async ({ page }) => {
  state = initialState();
  openMeteoCalls.length = 0;
  await page.route(/open-meteo\.com/, (r) => {
    openMeteoCalls.push(r.request().url());
    return r.abort();
  });
  await page.route(/tile\.openstreetmap\.org/, (r) => r.abort());
  await installFakeSupabase(page, state);
});

async function loginAndOpen(page: Page, org: RegExp) {
  await page.goto(REMOTE + '/accesso');
  await page.getByLabel('Email').fill(USER.email);
  await page.getByLabel('Password').fill(USER.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByText(`Accesso effettuato come ${USER.email}`)).toBeVisible();
  await page.getByRole('radio', { name: org }).check();
  const pid = Object.keys(state.docs)[0]!;
  await page.goto(`${REMOTE}/progetti/${pid}/urbano`);
  await expect(page.getByRole('heading', { name: 'SITUAZIONE ATTUALE' })).toBeVisible();
}

test('lettura: dati Open-Meteo con fonte, cella, timestamp e avviso; nessun aggiornamento manuale', async ({ page }) => {
  await loginAndOpen(page, /Comune A.*lettura/);
  const panel = page.getByTestId('weather-panel');
  await expect(panel.getByText('Dato territoriale modellato, non rilevato da sensore locale')).toBeVisible();
  await expect(panel.locator('[data-source=OPEN_METEO]').first()).toContainText('DATO OPEN-METEO');
  await expect(page.getByTestId('weather-meta')).toContainText('Open-Meteo Forecast API');
  await expect(page.getByTestId('weather-meta')).toContainText('best_match (modello effettivo non dichiarato dalla risposta)');
  // in modalità guidata: sintesi in primo piano, dettagli chiusi e apribili
  await expect(page.getByTestId('weather-summary')).toBeVisible();
  await expect(page.getByTestId('weather-meta')).toBeHidden();
  await page.getByText('Dettagli della fonte').click();
  await expect(page.getByTestId('weather-meta')).toBeVisible();
  await page.getByText('Tutti i valori ora per ora').click();
  await expect(page.getByTestId('weather-hourly').getByRole('row')).toHaveCount(25);
  await expect(panel.getByRole('button', { name: 'Aggiorna dati' })).toHaveCount(0);
  await expect(panel).not.toContainText('Timestral');
  expect(openMeteoCalls.filter((u) => u.includes('api.open-meteo.com/v1/forecast'))).toEqual([]);
});

test('tastiera: orizzonte 24/72 con Tab e Invio, tabella scorrevole raggiungibile', async ({ page }) => {
  await loginAndOpen(page, /Comune A.*lettura/);
  // in modalità guidata i valori ora per ora si aprono su richiesta, anche da tastiera
  await page.getByText('Tutti i valori ora per ora').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '24 ore' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '72 ore' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '72 ore' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('weather-hourly').getByRole('row')).toHaveCount(73);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('region', { name: 'Tabella oraria delle prossime 72 ore' })).toBeFocused();
});

test('modifica: “Aggiorna dati” passa dalla Edge Function e rispetta il limite di frequenza', async ({ page }) => {
  for (const d of Object.values(state.docs)) d.org = ORG_B;
  state.weather.locations[0]!.organization_id = ORG_B;
  await loginAndOpen(page, /Comune B.*modifica/);
  const btn = page.getByRole('button', { name: 'Aggiorna dati' });
  await btn.click();
  await expect(page.getByText(/Dati aggiornati: \d+ ore di previsione registrate/)).toBeVisible();
  expect(state.weather.invokes).toEqual([{ body: { location_id: WEATHER_LOC }, status: 200 }]);
  await expect(btn).toBeDisabled();
  await expect(page.getByText(/Nuovo aggiornamento manuale dalle/)).toBeVisible();
  await expect(page.getByTestId('weather-meta')).toContainText('aggiornamento manuale');
});

test('senza rete: ultimi dati mostrati e dichiarati, aggiornamento disabilitato', async ({ page, context }) => {
  for (const d of Object.values(state.docs)) d.org = ORG_B;
  state.weather.locations[0]!.organization_id = ORG_B;
  await loginAndOpen(page, /Comune B.*modifica/);
  await page.getByText('Tutti i valori ora per ora').click();
  await expect(page.getByTestId('weather-hourly')).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText('Nessuna connessione')).toBeVisible();
  await expect(page.getByTestId('weather-hourly')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aggiorna dati' })).toBeDisabled();
  await context.setOffline(false);
});

test('ospite (GitHub Pages senza Supabase): archivio meteo non collegato, nessuna acquisizione dal browser', async ({ page }) => {
  await page.goto(LOCAL + '/');
  await page.getByRole('button', { name: 'Apri la demo agricola' }).click();
  await expect(page).toHaveURL(/\/agricolo$/);
  await expect(page.getByText('Dati meteo non ancora collegati.')).toBeVisible();
  await expect(page.getByTestId('weather-panel').locator('[data-source]')).toHaveCount(4);
});
