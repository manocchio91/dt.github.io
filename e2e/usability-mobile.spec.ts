import { expect, test } from '@playwright/test';
import { answer, expectNoHorizontalScroll, expectQuestion, LOCAL } from './helpers';

/** Smartphone a 375 px: guida, pannello meteo e previsioni senza scorrimento orizzontale. */
test.use({ viewport: { width: 375, height: 812 } });

test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo\.com|supabase\.co|tile\.openstreetmap\.org/, (r) => r.abort());
});

test('smartphone 375 px: le 6 domande una per schermata, “Continua” sempre raggiungibile', async ({ page }) => {
  await page.goto(LOCAL + '/benvenuto');
  const choices: (RegExp | null)[] = [/Agricoltore o viticoltore/, null, /Osservare una parcella/, /Vigneto dimostrativo/, null, /Guidata/];
  for (const [i, c] of choices.entries()) {
    await expect(page.getByTestId('onboarding-progress')).toHaveText(`Domanda ${i + 1} di 6`);
    await expectNoHorizontalScroll(page);
    const btn = page.getByRole('button', { name: 'Continua' });
    const box = (await btn.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(40);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    await answer(page, c);
  }
  await expect(page).toHaveURL(/\/agricolo$/);
  await expectNoHorizontalScroll(page);
});

test('smartphone 375 px: pannello meteo e previsioni leggibili, dettagli chiusi', async ({ page }) => {
  await page.goto(LOCAL + '/');
  await page.getByRole('button', { name: 'Apri la demo urbana' }).click();
  await expect(page).toHaveURL(/\/urbano$/);
  await page.getByTestId('weather-panel').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('weather-panel')).toContainText('Dati meteo non ancora collegati.');
  await expectNoHorizontalScroll(page);
  await page.getByRole('link', { name: 'Previsioni (Beta)' }).click();
  await expect(page.getByTestId('forecast-summary')).toBeVisible();
  await expect(page.getByTestId('forecast-technical')).not.toHaveAttribute('open', '');
  await expectNoHorizontalScroll(page);
  await page.getByTestId('forecast-technical').locator('summary').click();
  await expectNoHorizontalScroll(page);
});

test('smartphone: la guida riprende dalla domanda lasciata', async ({ page }) => {
  await page.goto(LOCAL + '/benvenuto');
  await answer(page, /Tecnico comunale/);
  await page.getByRole('button', { name: 'Esci e riprendi dopo' }).click();
  await page.goto(LOCAL + '/benvenuto');
  await expectQuestion(page, 'In quale ambito lavori?');
});

for (const width of [320, 375, 390]) {
  test(`percorsi essenziali a ${width} px: sintesi, una CTA primaria e nessuno scorrimento orizzontale`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.goto(LOCAL + '/');
    await page.getByRole('button', { name: 'Apri la demo urbana' }).click();
    await expect(page.getByRole('heading', { name: 'SITUAZIONE ATTUALE' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'PERIODO STORICO DI RIFERIMENTO' })).toBeVisible();
    await expect(page.locator('main .btn-primary:visible')).toHaveCount(1);
    await expectNoHorizontalScroll(page);

    await page.goto(LOCAL + '/');
    await page.getByRole('button', { name: 'Apri la demo agricola' }).click();
    await expect(page.getByTestId('decision-overview')).toContainText(/Regolare|Attenzione|Critico/);
    await expect(page.getByTestId('decision-overview')).toContainText(/agronomo/i);
    await expect(page.locator('main .btn-primary:visible')).toHaveCount(1);
    await expect(page.locator('main')).not.toContainText(/\b(Irriga|Concima|Tratta la pianta)\b/i);
    await expectNoHorizontalScroll(page);
  });
}
