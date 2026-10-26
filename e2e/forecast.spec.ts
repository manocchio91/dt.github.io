import { expect, test } from '@playwright/test';
import { LOCAL } from './helpers';

/** F31 — previsioni probabilistiche: build standard senza servizio Timestral configurato. */

test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo\.com|tile\.openstreetmap\.org/, (r) => r.abort());
});

async function openForecast(page: import('@playwright/test').Page, demo: RegExp, lab: RegExp) {
  await page.goto(LOCAL + '/');
  await page.getByRole('button', { name: demo }).click();
  await expect(page).toHaveURL(lab);
  await page.getByRole('link', { name: 'Previsioni (Beta)' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Previsioni' })).toBeVisible();
}

test('urbano: previsione di base, banda, soglia, modello avanzato nascosto senza servizio, registrazione ed ex-post', async ({ page }) => {
  await openForecast(page, /Apri la demo urbana/, /\/urbano$/);
  await expect(page.getByTestId('forecast-badge')).toContainText('STIMATO DA MODELLO — previsione di base');
  await expect(page.getByText(/non stima l’effetto di alberi/)).toBeVisible();
  await expect(page.getByTestId('forecast-summary')).toBeVisible();
  // l'intervallo probabilistico resta disponibile nell'approfondimento tecnico, aperto su richiesta
  await expect(page.getByLabel('Intervallo mostrato')).toBeHidden();
  await page.getByText('Approfondimento tecnico').click();
  await page.getByLabel('Intervallo mostrato').selectOption('90');
  await expect(page.getByRole('listitem').filter({ hasText: 'intervallo 90%' })).toBeVisible();

  await expect(page.getByRole('option', { name: 'Timestral-5M' })).toHaveCount(0);
  await expect(page.getByTestId('forecast-badge')).toContainText('previsione di base');

  await page.getByRole('button', { name: 'Registra questa previsione nel progetto' }).click();
  await expect(page.getByText(/compare nell’export del dossier/)).toBeVisible();
  await page.getByRole('button', { name: 'Confronta con l’osservazione successiva' }).click();
  await expect(page.getByText(/Confronto ex-post: errore medio/)).toBeVisible();

  // persistenza nel browser dopo il ricaricamento
  await page.reload();
  await expect(page.getByTestId('forecast-records')).toContainText('Persistenza stagionale');
});

test('tastiera: il grafico si esplora con le frecce e la tabella è raggiungibile', async ({ page }) => {
  await openForecast(page, /Apri la demo urbana/, /\/urbano$/);
  const chart = page.getByRole('group', { name: /Storico e previsione/ });
  await chart.focus();
  await page.keyboard.press('Home');
  await expect(page.locator('p[aria-live=polite]')).toContainText(/mediana .* intervallo 80%/);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await page.getByText('Tabella dei valori (alternativa al grafico)').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('table').filter({ hasText: 'Data e orario (Europe/Rome)' })).toBeVisible();
});

test('vigneto: testo obbligatorio, 72 h e zone dalle soglie dell’agronomo', async ({ page }) => {
  await openForecast(page, /Apri la demo agricola/, /\/agricolo$/);
  await expect(page.getByText('Previsione prodotta da un modello e non misurazione sul terreno. Verificare in campo e confrontarsi con un agronomo prima di intervenire.')).toBeVisible();
  await expect(page.getByLabel('Orizzonte')).toHaveValue('72');
  await expect(page.getByTestId('zone-table').getByRole('row')).toHaveCount(3);
});
