import { expect, test } from '@playwright/test';
import { answer, LOCAL } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo\.com|tile\.openstreetmap\.org/, (route) => route.abort());
});

test('golden path urbano guidato: criticità, due alternative, decisione e verifica', async ({ page }) => {
  await page.goto(LOCAL + '/benvenuto');
  await answer(page, /Tecnico comunale/);
  await answer(page, null);
  await answer(page, /Confrontare possibili interventi/);
  await answer(page, /Area dimostrativa/);
  await answer(page, /Confini dell.area/, 'checkbox');
  await answer(page, /Guidata/);

  await expect(page).toHaveURL(/\/urbano$/);
  await expect(page.getByRole('heading', { name: 'Cosa sta succedendo?' })).toBeVisible();
  await expect(page.getByText(/Cosa vuoi provare/i)).toBeVisible();
  await page.getByRole('link', { name: /Confronta e decidi/ }).first().click();

  await expect(page.getByText('Alternative a colpo d’occhio')).toBeVisible();
  const alternatives = page.getByRole('checkbox');
  expect(await alternatives.count()).toBeGreaterThanOrEqual(2);
  await expect(alternatives.nth(0)).toBeChecked();
  await expect(alternatives.nth(1)).toBeChecked();
  await page.getByLabel('Alternativa scelta', { exact: true }).selectOption({ index: 1 });
  await page.locator('#rat').fill('Scelta umana basata sul confronto di benefici, costi e incertezza.');
  await page.getByLabel('Autore').fill('Tecnico comunale');
  await page.getByRole('button', { name: /Registra decisione/ }).click();
  await expect(page.getByText('Registro delle decisioni')).toBeVisible();
  await page.getByRole('link', { name: /pianifica la verifica/ }).click();
  await expect(page).toHaveURL(/\/verifica$/);
  await expect(page.getByText('Decisione registrata')).toBeVisible();

  const visibleText = await page.locator('body').evaluate((el) => (el as HTMLElement).innerText);
  expect(visibleText).not.toMatch(/Supabase|Docker|endpoint|cron|quantile|hash|migration/i);
});

test('golden path agricolo guidato: zona, osservazione, alternative, decisione supervisionata e verifica', async ({ page }) => {
  await page.goto(LOCAL + '/benvenuto');
  await answer(page, /Agronomo/);
  await answer(page, null);
  await answer(page, /Controllare lo stress/);
  await answer(page, /Vigneto dimostrativo/);
  await answer(page, /Osservazioni in campo/, 'checkbox');
  await answer(page, /Guidata/);

  await expect(page).toHaveURL(/\/agricolo$/);
  await expect(page.getByText('Prima zona da controllare')).toBeVisible();
  await expect(page.locator('#first-zone')).toContainText(/Zona/);
  await page.getByText('+ Aggiungi osservazione').click();
  await page.getByLabel('Nota').fill('Foglie osservate durante il sopralluogo guidato');
  await page.getByRole('button', { name: 'Registra', exact: true }).click();
  await expect(page.getByText(/visivo: Foglie osservate durante/)).toBeVisible();

  const decision = page.locator('#a8');
  const measures = decision.getByRole('checkbox');
  expect(await measures.count()).toBeGreaterThanOrEqual(2);
  await measures.nth(0).check();
  await measures.nth(1).check();
  await decision.getByLabel('Misura scelta').selectOption({ index: 1 });
  await decision.getByLabel('Chi registra').fill('Agricoltore');
  await decision.getByLabel('Agronomo / supervisore').fill('Dott.ssa Rossi');
  await decision.getByLabel('Motivazione').fill('Decisione supervisionata dopo confronto di almeno due alternative disponibili.');
  await decision.getByRole('button', { name: 'Registra decisione' }).click();
  await expect(page.locator('#a9')).toContainText('Prima → oggi');
  await expect(page.locator('#a9')).toContainText(/senza attribuirlo automaticamente/);

  const visibleText = await page.locator('body').evaluate((el) => (el as HTMLElement).innerText);
  expect(visibleText).not.toMatch(/Supabase|Docker|endpoint|cron|quantile|hash|migration/i);
});
