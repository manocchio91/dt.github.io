import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/** Build per GitHub Pages: app servita in https://<utente>.github.io/dt.github.io/ */
const PAGES = 'http://localhost:4175/dt.github.io';
const DIST = join(import.meta.dirname, '..', 'apps', 'web', 'dist-pages');

test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo\.com|tile\.openstreetmap\.org/, (r) => r.abort());
});

test('build Pages: risorse sotto la sottocartella e fallback 404.html', () => {
  const index = readFileSync(join(DIST, 'index.html'), 'utf8');
  expect(index).toContain('src="/dt.github.io/assets/');
  expect(index).toContain('href="/dt.github.io/favicon.svg"');
  expect(existsSync(join(DIST, '404.html'))).toBe(true);
  expect(readFileSync(join(DIST, '404.html'), 'utf8')).toBe(index);
});

test('GitHub Pages: navigazione, ricarica di una rotta interna e favicon nella sottocartella', async ({ page }) => {
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith('http://localhost:4175')) failed.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(PAGES + '/');
  await page.getByRole('button', { name: 'Apri la demo urbana' }).click();
  await expect(page).toHaveURL(/\/dt\.github\.io\/progetti\/[^/]+\/urbano$/);
  await page.getByRole('link', { name: 'Previsioni (Beta)' }).click();
  await expect(page).toHaveURL(/\/dt\.github\.io\/progetti\/[^/]+\/previsioni$/);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Previsioni' })).toBeVisible();
  await page.getByRole('link', { name: 'Stato funzioni' }).click();
  await expect(page).toHaveURL(PAGES + '/stato');
  await expect(page.locator('header img')).toHaveAttribute('src', '/dt.github.io/favicon.svg');
  expect(failed).toEqual([]);
});
