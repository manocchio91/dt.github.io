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
  await answer(page, /Confrontare possibili interventi/);
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

test('smartphone: foto da fotocamera nel percorso agricolo, senza scroll orizzontale', async ({ page }) => {
  const { jpegWithGps } = await import('./mediaFiles');
  await page.goto(LOCAL + '/');
  await page.getByRole('button', { name: 'Apri la demo agricola' }).click();
  await expect(page).toHaveURL(/\/agricolo$/);
  await page.goto(page.url().replace(/agricolo$/, 'documenti'));
  const camera = page.getByLabel('Fotocamera: scatta una foto');
  await expect(camera).toHaveAttribute('capture', 'environment');
  await expect(page.getByRole('button', { name: 'Scatta una foto', exact: true })).toBeVisible();
  await camera.setInputFiles({ name: 'IMG_20260819.jpg', mimeType: 'image/jpeg', buffer: jpegWithGps() });
  await expect(page.getByText('File accettato')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByLabel('Autore').fill('Viticoltore');
  await page.getByRole('button', { name: 'Salva nel browser' }).click();
  await expect(page.getByText('File locale — non sincronizzato con il server.')).toBeVisible();
  await expectNoHorizontalScroll(page);
  const h = await page.getByRole('button', { name: 'Scarica' }).evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(44);
});
