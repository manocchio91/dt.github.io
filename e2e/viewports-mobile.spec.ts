import { expect, test } from '@playwright/test';
import { answer, expectNoHorizontalScroll, LOCAL } from './helpers';

/** Larghezze 320, 375, 390 e 768 px: guida, Decision Lab con pannello meteo e Previsioni senza scorrimento orizzontale. */
test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo\.com|supabase\.co|tile\.openstreetmap\.org/, (r) => r.abort());
});

for (const width of [320, 375, 390, 768]) {
  test(`${width} px: percorso principale leggibile, azione principale raggiungibile`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(LOCAL + '/benvenuto');
    await expectNoHorizontalScroll(page);
    await answer(page, /Tecnico comunale/);
    await expect(page.getByTestId('onboarding-progress')).toHaveText('Domanda 2 di 6');
    await expectNoHorizontalScroll(page);
    await page.goto(LOCAL + '/');
    await page.getByRole('button', { name: 'Apri la demo urbana' }).click();
    await expect(page).toHaveURL(/\/urbano$/);
    await page.getByTestId('weather-panel').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('weather-panel')).toContainText('Dati meteo non ancora collegati.');
    await expectNoHorizontalScroll(page);
    await page.getByRole('link', { name: 'Previsioni (Beta)' }).click();
    await expect(page.getByTestId('forecast-summary')).toBeVisible();
    await expectNoHorizontalScroll(page);
    const btn = page.getByRole('button', { name: 'Registra questa previsione nel progetto' });
    await btn.scrollIntoViewIfNeeded();
    const box = (await btn.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  });
}
