import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, openUrbanLabAsEditor } from './helpers';
import { initialState, installFakeSupabase, ORG_B, type FakeState } from './fakeSupabase';

let state: FakeState;

test.beforeEach(async ({ page }) => {
  state = initialState();
  for (const d of Object.values(state.docs)) d.org = ORG_B;
  state.weather.locations[0]!.organization_id = ORG_B;
  await page.route(/open-meteo\.com|tile\.openstreetmap\.org/, (r) => r.abort());
  await installFakeSupabase(page, state);
});

test('smartphone: avviso di conflitto leggibile, pulsanti ampi, nessuno scorrimento orizzontale', async ({ page }) => {
  const pid = await openUrbanLabAsEditor(page, state);
  state.docs[pid]!.version += 1;
  await page.getByRole('button', { name: 'Calcola A' }).click();
  const notice = page.getByTestId('conflict-notice');
  await expect(notice).toBeVisible();
  await expectNoHorizontalScroll(page);
  const h = await notice.getByRole('button', { name: 'Ricarica progetto' }).evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(44);
});
