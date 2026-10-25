import { expect, test, type Page } from '@playwright/test';
import { LOCAL, REMOTE } from './helpers';
import { initialState, installFakeSupabase, USER } from './fakeSupabase';

/**
 * Schermate di riferimento per l'audit di usabilità (non è un test di regressione).
 * Eseguito solo su richiesta: MDT_CAPTURE=prima|dopo npx playwright test ux-capture
 * Le immagini vanno in docs/ux/schermate/<fase>/.
 */
const PHASE = process.env.MDT_CAPTURE;
test.skip(!PHASE, 'cattura schermate solo con MDT_CAPTURE');

const SIZES = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'smartphone', width: 375, height: 812 },
] as const;

async function shot(page: Page, name: string, focus?: string) {
  for (const s of SIZES) {
    await page.setViewportSize({ width: s.width, height: s.height });
    if (focus) await page.getByTestId(focus).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `docs/ux/schermate/${PHASE}/${name}-${s.name}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo\.com|tile\.openstreetmap\.org/, (r) => r.abort());
});

test('percorso ospite', async ({ page }) => {
  await page.goto(LOCAL + '/');
  await shot(page, '01-home');
  await page.goto(LOCAL + '/benvenuto');
  await shot(page, '02-onboarding-domanda-1');
  await page.goto(LOCAL + '/');
  await page.getByRole('button', { name: /Apri la demo urbana/ }).click();
  await expect(page).toHaveURL(/\/urbano$/);
  await shot(page, '03-lab-urbano');
  await shot(page, '04-meteo-non-collegato', 'weather-panel');
  const pid = page.url().split('/progetti/')[1]!.split('/')[0]!;
  await page.goto(`${LOCAL}/progetti/${pid}/previsioni`);
  await expect(page.getByTestId('forecast-badge')).toBeVisible({ timeout: 20_000 });
  await shot(page, '05-previsioni-urbano');
  await page.getByRole('combobox', { name: /^Modello/ }).selectOption('mistralai/Timestral-5M');
  await page.waitForTimeout(800);
  await shot(page, '06-previsioni-modello-avanzato');
  await page.goto(LOCAL + '/');
  await page.getByRole('button', { name: /Apri la demo agricola/ }).click();
  await expect(page).toHaveURL(/\/agricolo$/);
  const aid = page.url().split('/progetti/')[1]!.split('/')[0]!;
  await page.goto(`${LOCAL}/progetti/${aid}/previsioni`);
  await expect(page.getByTestId('forecast-badge')).toBeVisible({ timeout: 20_000 });
  await shot(page, '07-previsioni-agricolo');
});

test('pannello meteo collegato (backend simulato)', async ({ page }) => {
  const state = initialState();
  await installFakeSupabase(page, state);
  await page.goto(REMOTE + '/accesso');
  await page.getByLabel('Email').fill(USER.email);
  await page.getByLabel('Password').fill(USER.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByText(`Accesso effettuato come ${USER.email}`)).toBeVisible();
  await page.getByRole('radio', { name: /Comune A.*lettura/ }).check();
  const pid = Object.keys(state.docs)[0]!;
  await page.goto(`${REMOTE}/progetti/${pid}/urbano`);
  await expect(page.getByRole('heading', { name: 'Dati meteorologici' })).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, '08-meteo-collegato', 'weather-panel');
});
