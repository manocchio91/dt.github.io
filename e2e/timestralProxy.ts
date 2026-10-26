import { expect, type Page, type Route } from '@playwright/test';
import { QUANTILE_LEVELS, TIMESTRAL_MODELS } from '../packages/domain/src/index';
import { initialState, installFakeSupabase, ORG_B, USER, type FakeState } from './fakeSupabase';
import { REMOTE } from './helpers';

/** Proxy Timestral simulato (risposta nel formato reale del proxy) e accesso come editor di "Comune B". */
export interface ProxyMock {
  calls: { body: Record<string, unknown>; authorization: string | null }[];
}

export async function mockTimestralProxy(page: Page, opts: { center?: number; applied?: boolean; status?: number } = {}): Promise<ProxyMock> {
  const mock: ProxyMock = { calls: [] };
  await page.route('http://forecast.e2e.test/**', async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = req.postDataJSON() as Record<string, unknown> & { prediction_length: number };
    mock.calls.push({ body, authorization: req.headers()['authorization'] ?? null });
    if (opts.status) return route.fulfill({ status: opts.status, headers: cors, json: { detail: 'Il modello avanzato non è disponibile. Puoi continuare con la previsione di base.' } });
    const H = body.prediction_length;
    const center = opts.center ?? 25;
    const raw = Array.from({ length: H }, () => QUANTILE_LEVELS.map((l) => center + (l - 0.5) * 20));
    const humidity = ((body.mdt as { variables: { name: string }[] }).variables[0]!.name === 'umidita_relativa');
    const flat = raw.flat();
    const q = humidity ? raw.map((row) => row.map((x) => Math.min(100, Math.max(0, x)))) : raw;
    const constraints = humidity
      ? [{ physical_constraint_applied: opts.applied ?? flat.some((x) => x > 100), physical_min: 0, physical_max: 100, adjusted_values_count: flat.filter((x) => x > 100 || x < 0).length, total_values: flat.length, maximum_raw_value: Math.max(...flat), minimum_raw_value: Math.min(...flat), method: 'physical_clipping_v1', adapter_version: 'mdt-forecasting 0.2.0' }]
      : [null];
    return route.fulfill({
      status: 200,
      headers: cors,
      json: { schema_version: 1, model: 'mistralai/Timestral-5M', revision: TIMESTRAL_MODELS['mistralai/Timestral-5M'].revision, code_commit: 'a534bdb', quantile_levels: QUANTILE_LEVELS, quantiles: [[q]], median: [[q.map((r) => r[10])]], inference_ms: 150, warnings: [], input_hash: 'x'.repeat(64), adapter_version: 'mdt-forecasting 0.2.0', constraints, run_id: '00000000-0000-4000-8000-0000000000f1' },
    });
  });
  return mock;
}
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };

/** Accesso come editor (Comune B) e apertura della pagina Previsioni del progetto demo condiviso. */
export async function openForecastAsEditor(page: Page): Promise<FakeState> {
  const state = initialState();
  for (const d of Object.values(state.docs)) d.org = ORG_B;
  await page.route(/open-meteo\.com|tile\.openstreetmap\.org/, (r) => r.abort());
  await installFakeSupabase(page, state);
  await page.goto(REMOTE + '/accesso');
  await page.getByLabel('Email').fill(USER.email);
  await page.getByLabel('Password').fill(USER.password);
  await page.getByRole('button', { name: 'Accedi' }).click();
  await expect(page.getByText(`Accesso effettuato come ${USER.email}`)).toBeVisible();
  await page.getByRole('radio', { name: /Comune B.*modifica/ }).check();
  const pid = Object.keys(state.docs)[0]!;
  await page.goto(`${REMOTE}/progetti/${pid}/previsioni`);
  await expect(page.getByTestId('forecast-badge')).toBeVisible({ timeout: 15_000 });
  return state;
}

export async function chooseAdvanced(page: Page, variable: 'umidita_relativa' | 'temperatura_aria' = 'umidita_relativa') {
  await page.getByRole('combobox', { name: /^Grandezza/ }).selectOption(variable);
  await page.getByRole('combobox', { name: /^Modello/ }).selectOption('mistralai/Timestral-5M');
  await expect(page.getByRole('button', { name: 'Avvia Timestral-5M' })).toBeVisible();
  await page.getByRole('button', { name: 'Avvia Timestral-5M' }).click();
}
