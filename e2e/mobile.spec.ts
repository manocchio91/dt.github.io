import { expect, test } from '@playwright/test';
import { answer, expectNoHorizontalScroll, LOCAL } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo\.com|tile\.openstreetmap\.org/, (r) => r.abort());
});

test('smartphone: onboarding completo senza scroll orizzontale e barra inferiore', async ({ page }) => {
  await page.goto(LOCAL + '/benvenuto');
  await expectNoHorizontalScroll(page);
  await answer(page, /Tecnico comunale/);
  await expectNoHorizontalScroll(page);
  await answer(page, null);
  await answer(page, /Preparare una proposta/);
  await answer(page, /Area dimostrativa/);
  await answer(page, null);
  await expectNoHorizontalScroll(page);
  await answer(page, /Guidata/);
  await expect(page).toHaveURL(/\/urbano$/);
  await expect(page.getByRole('navigation', { name: 'Navigazione mobile' })).toBeVisible();
  // controlli abbastanza grandi per l'uso in campo (almeno 44 px)
  const h = await page.getByRole('button', { name: 'Calcola A' }).evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(44);
});
