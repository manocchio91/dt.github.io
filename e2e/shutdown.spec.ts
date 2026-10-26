import { expect, test } from '@playwright/test';

test('la suite apre la build e lascia il teardown al runner', async ({ page }) => {
  await page.goto('http://localhost:4173/');
  await expect(page.locator('body')).toBeVisible();
});
