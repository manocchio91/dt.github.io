import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, REMOTE } from './helpers';
import { chooseAdvanced, mockTimestralProxy, openForecastAsEditor } from './timestralProxy';

/** Previsioni con Timestral tramite il proxy (simulato): badge solo per risultati reali, vincolo dell'umidità, ripiego. */

test('guidata: “STIMATO DA MODELLO — Timestral-5M”, nota breve sul vincolo, dettagli tecnici chiusi', async ({ page }) => {
  const mock = await mockTimestralProxy(page, { center: 95 });
  await openForecastAsEditor(page);
  // prima del modello avanzato il badge è della previsione di base, senza alcun richiamo a Timestral
  await expect(page.getByTestId('forecast-badge')).toContainText('previsione di base');
  await expect(page.getByTestId('forecast-badge')).not.toContainText('Timestral');
  await chooseAdvanced(page);
  await expect(page.getByTestId('forecast-badge')).toContainText('STIMATO DA MODELLO — Timestral-5M');
  await expect(page.getByTestId('forecast-constraint-note')).toHaveText('L’intervallo è stato riportato entro i limiti fisici dell’umidità, da 0% a 100%.');
  await expect(page.getByTestId('forecast-technical')).not.toHaveAttribute('open', '');
  await expect(page.getByTestId('forecast-constraint-tech')).toBeHidden();
  // nel percorso guidato nessun termine tecnico in primo piano
  const visible = await page.locator('main').evaluate((m) => (m as HTMLElement).innerText);
  expect(visible).not.toMatch(/physical_clipping|adjusted|quantil|WQL|MAE|hash/i);
  // il proxy ha ricevuto il token di sessione e i metadati del progetto; i limiti fisici non vengono dal browser
  expect(mock.calls[0]!.authorization).toMatch(/^Bearer /);
  expect(mock.calls[0]!.body.mdt).toMatchObject({ context: 'urbano', variables: [{ name: 'umidita_relativa', unit: '%' }] });
  expect(mock.calls[0]!.body.physical_bounds).toBeUndefined();
});

test('tastiera e screen reader: approfondimento tecnico apribile, vincolo descritto, badge con descrizione accessibile', async ({ page }) => {
  await mockTimestralProxy(page, { center: 95 });
  await openForecastAsEditor(page);
  await chooseAdvanced(page);
  await expect(page.getByTestId('forecast-badge')).toContainText('Timestral-5M');
  await expect(page.getByTestId('forecast-badge').locator('.sr-only')).toHaveText(/valore calcolato da un modello/);
  const summary = page.getByTestId('forecast-technical').locator('summary');
  await summary.focus();
  await expect(summary).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('forecast-technical')).toHaveAttribute('open', '');
  const tech = page.getByTestId('forecast-constraint-tech');
  await expect(tech).toBeVisible();
  await expect(tech).toContainText(/Applicato: \d+ valori su \d+ riportati entro 0–100/);
  await expect(tech).toContainText('physical_clipping_v1');
  await expect(tech).toContainText('può modificare la calibrazione probabilistica');
});

test('vincolo non necessario: nessuna nota; temperatura mai vincolata', async ({ page }) => {
  await mockTimestralProxy(page, { center: 50 });
  await openForecastAsEditor(page);
  await chooseAdvanced(page);
  await expect(page.getByTestId('forecast-badge')).toContainText('Timestral-5M');
  await expect(page.getByTestId('forecast-constraint-note')).toHaveCount(0);
  await chooseAdvanced(page, 'temperatura_aria');
  await expect(page.getByTestId('forecast-badge')).toContainText('Timestral-5M');
  await expect(page.getByTestId('forecast-constraint-note')).toHaveCount(0);
});

test('container spento: messaggio semplice, nessun badge Timestral, ripiego sulla previsione di base', async ({ page }) => {
  await mockTimestralProxy(page, { status: 503 });
  const state = await openForecastAsEditor(page);
  await chooseAdvanced(page);
  await expect(page.getByText('Il modello avanzato non è disponibile.', { exact: true })).toBeVisible();
  await expect(page.getByText('Puoi continuare con la previsione di base.')).toBeVisible();
  await expect(page.getByTestId('forecast-badge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Mostra la previsione di base' }).click();
  await expect(page.getByTestId('forecast-badge')).toContainText('previsione di base');
  // il resto dell'app continua a funzionare
  await page.goto(`${REMOTE}/progetti/${Object.keys(state.docs)[0]}/urbano`);
  await expect(page.getByRole('heading', { name: 'Decision Lab urbano' })).toBeVisible();
});

test('zoom 200% (640 px utili): badge, nota e approfondimento tecnico senza scorrimento orizzontale', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 400 });
  await mockTimestralProxy(page, { center: 95 });
  await openForecastAsEditor(page);
  await chooseAdvanced(page);
  await expect(page.getByTestId('forecast-badge')).toContainText('Timestral-5M');
  await expect(page.getByTestId('forecast-constraint-note')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByTestId('forecast-technical').locator('summary').click();
  await expect(page.getByTestId('forecast-constraint-tech')).toBeVisible();
  await expectNoHorizontalScroll(page);
});
