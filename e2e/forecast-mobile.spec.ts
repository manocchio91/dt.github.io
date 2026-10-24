import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, LOCAL } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo\.com|tile\.openstreetmap\.org/, (r) => r.abort());
});

test('smartphone: previsioni del vigneto leggibili senza scroll orizzontale', async ({ page }) => {
  await page.goto(LOCAL + '/');
  await page.getByRole('button', { name: 'Apri la demo agricola' }).click();
  await expect(page).toHaveURL(/\/agricolo$/);
  await page.getByRole('link', { name: 'Previsioni (Beta)' }).click();
  await expect(page.getByTestId('forecast-badge')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expect(page.getByText(/Verificare in campo e confrontarsi con un agronomo/)).toBeVisible();
  const h = await page.getByRole('combobox', { name: /^Modello/ }).evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(40);
});
