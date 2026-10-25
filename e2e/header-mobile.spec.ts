import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, REMOTE } from './helpers';
import { initialState, installFakeSupabase, USER } from './fakeSupabase';

/** Intestazione su smartphone: un nome di organizzazione molto lungo va a capo, senza scorrimento orizzontale. */
test.use({ viewport: { width: 320, height: 700 } });

test('320 px: organizzazione con nome lunghissimo e senza spazi nell’intestazione', async ({ page }) => {
  const state = initialState();
  const long = 'ComuneConUnNomeMoltoLungoSenzaSpazi_UfficioAmbienteEVerdePubblico_2026';
  state.memberships[1]!.name = long;
  await page.route(/open-meteo\.com|tile\.openstreetmap\.org/, (r) => r.abort());
  await installFakeSupabase(page, state);
  await page.goto(REMOTE + '/accesso');
  await page.getByLabel('Email').fill(USER.email);
  await page.getByLabel('Password').fill(USER.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByText(`Accesso effettuato come ${USER.email}`)).toBeVisible();
  await page.getByRole('radio', { name: new RegExp(long) }).check();
  const chip = page.getByRole('banner').getByRole('link', { name: new RegExp(long) });
  await expect(chip).toContainText(`${long} · modifica`);
  await expectNoHorizontalScroll(page);
  const box = (await chip.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  const m = await chip.evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth }));
  expect(m.scroll).toBeLessThanOrEqual(m.client + 1);
  await page.goto(REMOTE + '/');
  await expectNoHorizontalScroll(page);
});
