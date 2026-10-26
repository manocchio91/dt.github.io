import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalScroll, REMOTE } from './helpers';
import { initialState, installFakeSupabase, ORG_B, USER, type FakeState } from './fakeSupabase';
import { historyStatus, WEATHER_LOC } from './fakeWeather';

/** Storico Open-Meteo di 7 giorni nel pannello meteo (stato calcolato dal server, backend simulato). */
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

async function open(page: Page, org: RegExp) {
  await page.goto(REMOTE + '/accesso');
  await page.getByLabel('Email').fill(USER.email);
  await page.getByLabel('Password').fill(USER.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByText(`Accesso effettuato come ${USER.email}`)).toBeVisible();
  await page.getByRole('radio', { name: org }).check();
  await page.goto(`${REMOTE}/progetti/${Object.keys(state.docs)[0]!}/urbano`);
  await expect(page.getByRole('heading', { name: 'Dati meteorologici' })).toBeVisible();
}

test('storico completo: una frase semplice; ore valide e lacune solo nei dettagli della fonte', async ({ page }) => {
  await open(page, /Comune A.*lettura/);
  const note = page.getByTestId('weather-history');
  await expect(note).toHaveText('Storico disponibile: 7 giorni. Il modello avanzato può essere utilizzato.');
  await expect(page.getByTestId('weather-history-details')).toBeHidden();
  await page.getByText('Dettagli della fonte').click();
  await expect(page.getByTestId('weather-history-details')).toContainText('168 ore valide su 168');
  await expect(page.getByTestId('weather-panel')).not.toContainText(/backfill|inferenza|covariat/i);
  expect(openMeteoCalls).toEqual([]);
});

test('storico in consolidamento con una lacuna: ore disponibili e ore mancanti, nessun valore inventato', async ({ page }) => {
  state.weather.history[WEATHER_LOC] = historyStatus({ livello: 'consolidamento', ore_finestra: 96, ore_continue: 90, buchi: [{ da: '2026-10-20T00:00:00Z', a: '2026-10-20T05:00:00Z', ore: 6 }] });
  await open(page, /Comune A.*lettura/);
  const note = page.getByTestId('weather-history');
  await expect(note).toContainText('Stiamo raccogliendo lo storico necessario. Sono disponibili 96 delle 168 ore previste.');
  await expect(note).toContainText('Mancano 6 ore nello storico: non vengono stimate né riempite.');
  await expect(note.getByRole('button')).toHaveCount(0);
});

test('prima acquisizione non riuscita: messaggio semplice e “Riprova aggiornamento” per chi modifica', async ({ page }) => {
  for (const d of Object.values(state.docs)) d.org = ORG_B;
  state.weather.locations[0]!.organization_id = ORG_B;
  state.weather.runs = [{ ...state.weather.runs[0]!, status: 'errore', error_code: 'TIMEOUT', issued_at: null }];
  state.weather.points = [];
  state.weather.history[WEATHER_LOC] = historyStatus({ stato: 'non_riuscito', livello: 'insufficiente', ultima_ora: null, ore_finestra: 0, ore_continue: 0 });
  await open(page, /Comune B.*modifica/);
  const note = page.getByTestId('weather-history');
  await expect(note).toContainText('Il progetto è stato salvato, ma i dati meteo non sono ancora disponibili. Riprova più tardi.');
  await expect(page.getByTestId('weather-panel')).not.toContainText('TIMEOUT');
  await note.getByRole('button', { name: 'Riprova aggiornamento' }).click();
  await expect.poll(() => state.weather.invokes.map((i) => i.status)).toEqual([200]);
  expect(openMeteoCalls).toEqual([]);
});

test('lettura: vede lo stato ma non avvia acquisizioni; nessuno scorrimento orizzontale a 320 px', async ({ page }) => {
  state.weather.history[WEATHER_LOC] = historyStatus({ stato: 'non_riuscito', livello: 'insufficiente', ultima_ora: null, ore_finestra: 0 });
  state.weather.runs = [{ ...state.weather.runs[0]!, status: 'errore', issued_at: null }];
  await open(page, /Comune A.*lettura/);
  await expect(page.getByTestId('weather-history')).toContainText('dati meteo non sono ancora disponibili');
  await expect(page.getByRole('button', { name: 'Riprova aggiornamento' })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByTestId('weather-history').scrollIntoViewIfNeeded();
  await expectNoHorizontalScroll(page);
});
