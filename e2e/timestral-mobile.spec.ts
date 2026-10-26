import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, expectSourceBadgesInside } from './helpers';
import { chooseAdvanced, mockTimestralProxy, openForecastAsEditor } from './timestralProxy';

/** Timestral su smartphone: badge, nota del vincolo e ripiego leggibili, senza scorrimento orizzontale. */
for (const width of [320, 375, 390]) {
  test(`${width} px: badge Timestral-5M, nota del vincolo e dettagli tecnici senza scorrimento orizzontale`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await mockTimestralProxy(page, { center: 95 });
    await openForecastAsEditor(page);
    await chooseAdvanced(page);
    await expect(page.getByTestId('forecast-badge')).toContainText('STIMATO DA MODELLO — Timestral-5M');
    await expect(page.getByTestId('forecast-constraint-note')).toBeVisible();
    await expectSourceBadgesInside(page);
    await expectNoHorizontalScroll(page);
    await page.getByTestId('forecast-technical').locator('summary').click();
    await expect(page.getByTestId('forecast-constraint-tech')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
}

test('375 px: container spento, messaggio di ripiego senza scorrimento orizzontale', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await mockTimestralProxy(page, { status: 503 });
  await openForecastAsEditor(page);
  await chooseAdvanced(page);
  await expect(page.getByText('Il modello avanzato non è disponibile.', { exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);
});
