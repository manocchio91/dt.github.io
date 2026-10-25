import { expect, test, type Page } from '@playwright/test';
import { answer, expectNoHorizontalScroll, expectSourceBadgesInside, LOCAL } from './helpers';

/**
 * Etichette di fonte su smartphone: il testo va a capo dentro il contenitore, senza tagli né
 * scorrimento orizzontale, in entrambi i percorsi e in entrambe le modalità.
 */
test.use({ viewport: { width: 375, height: 812 } });

test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo\.com|supabase\.co|tile\.openstreetmap\.org/, (r) => r.abort());
});

const PATHS = {
  urbano: { profile: /Tecnico comunale/, decision: /Confrontare possibili interventi/, area: /Area dimostrativa/ },
  agricolo: { profile: /Agricoltore o viticoltore/, decision: /Osservare una parcella/, area: /Vigneto dimostrativo/ },
} as const;

async function completeGuide(page: Page, path: keyof typeof PATHS, mode: 'Guidata' | 'Tecnica') {
  const p = PATHS[path];
  await page.goto(LOCAL + '/benvenuto');
  await answer(page, p.profile);
  await answer(page, null);
  await answer(page, p.decision);
  await answer(page, p.area);
  await answer(page, null, 'checkbox');
  await answer(page, new RegExp(mode));
  await expect(page).toHaveURL(new RegExp(`/${path}$`));
}

/** Il testo dell'etichetta è tutto visibile: nessun ritaglio orizzontale dentro il badge. */
async function expectBadgeComplete(page: Page, testId: string) {
  const badge = page.getByTestId(testId);
  const m = await badge.evaluate((e) => ({
    scroll: e.scrollWidth,
    client: e.clientWidth,
    symbol: e.querySelector('[aria-hidden=true]')!.getBoundingClientRect().width,
    sr: e.querySelector('.sr-only')?.textContent ?? '',
    ellipsis: getComputedStyle(e).textOverflow,
  }));
  expect(m.scroll).toBeLessThanOrEqual(m.client + 1);
  expect(m.symbol).toBeGreaterThan(0);
  expect(m.sr).toMatch(/^: \S/);
  expect(m.ellipsis).not.toBe('ellipsis');
}

test('urbano, modalità tecnica, 375 px: badge della previsione con il nome completo del modello', async ({ page }) => {
  await completeGuide(page, 'urbano', 'Tecnica');
  await page.getByRole('link', { name: 'Previsioni (Beta)' }).click();
  await expect(page.getByTestId('forecast-technical')).toHaveAttribute('open', '');
  const badge = page.getByTestId('forecast-badge');
  await expect(badge).toContainText('STIMATO DA MODELLO — Persistenza stagionale (stessa ora del giorno prima)');
  await expectBadgeComplete(page, 'forecast-badge');
  await expectSourceBadgesInside(page);
  await expectNoHorizontalScroll(page);
});

for (const path of ['urbano', 'agricolo'] as const) {
  for (const mode of ['Guidata', 'Tecnica'] as const) {
    test(`${path}, modalità ${mode.toLowerCase()}, 375 px: quattro fonti e previsione senza scorrimento orizzontale`, async ({ page }) => {
      await completeGuide(page, path, mode);
      // pannello meteo: le quattro etichette di fonte nella legenda
      const legend = page.getByTestId('weather-panel').getByLabel('Legenda delle fonti');
      await legend.scrollIntoViewIfNeeded();
      await expect(legend.locator('[data-source]')).toHaveCount(4);
      await expectSourceBadgesInside(page);
      await expectNoHorizontalScroll(page);
      // Previsioni: badge del modello e dettagli tecnici aperti
      await page.getByRole('link', { name: 'Previsioni (Beta)' }).click();
      await expect(page.getByTestId('forecast-badge')).toBeVisible();
      const tech = page.getByTestId('forecast-technical');
      if (mode === 'Guidata') {
        await expect(tech).not.toHaveAttribute('open', '');
        await tech.locator('summary').click();
      }
      await expect(tech).toHaveAttribute('open', '');
      await expectBadgeComplete(page, 'forecast-badge');
      await expectSourceBadgesInside(page);
      await expectNoHorizontalScroll(page);
    });
  }
}

test('caso limite a 320 px: etichetta molto lunga e senza spazi va a capo senza tagli', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await completeGuide(page, 'agricolo', 'Tecnica');
  await page.getByRole('link', { name: 'Previsioni (Beta)' }).click();
  const badge = page.getByTestId('forecast-badge');
  await expect(badge).toBeVisible();
  const long =
    ' — Modello di previsione con un nome estremamente lungo per verificare il ritorno a capo ' +
    'IdentificativoDiRevisioneSenzaSpaziMoltoLungo0123456789abcdefABCDEF0123456789';
  await badge.evaluate((e, text) => {
    e.querySelector('.normal-case')!.textContent = text;
  }, long);
  await expect(badge).toContainText(long.trim());
  // più righe: il badge è alto almeno il doppio del simbolo, che occupa una riga sola
  const lines = await badge.evaluate((e) => e.getBoundingClientRect().height / e.querySelector('[aria-hidden=true]')!.getBoundingClientRect().height);
  expect(lines).toBeGreaterThanOrEqual(2);
  await expectBadgeComplete(page, 'forecast-badge');
  await expectSourceBadgesInside(page);
  await expectNoHorizontalScroll(page);
});
