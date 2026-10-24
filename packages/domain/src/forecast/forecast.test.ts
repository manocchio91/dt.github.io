import { describe, expect, it } from 'vitest';
import {
  alertConfusion,
  backtestOrigins,
  calendarCovariates,
  checkQuantiles,
  coverage,
  DemoForecastAdapter,
  exceedanceProbability,
  ForecastInputError,
  ForecastUnavailableError,
  localHour,
  NaivePersistenceAdapter,
  pinball,
  QUANTILE_LEVELS,
  requestAtOrigin,
  runBacktest,
  SeasonalNaiveAdapter,
  TIMESTRAL_MODELS,
  TimestralForecastAdapter,
  toHourlyGrid,
  URBAN_DATASET,
  validateForecastRequest,
  VINEYARD_DATASET,
  wql,
  type ForecastRequest,
  type TimeSeries,
} from './index';

const hourly = (n: number, f: (i: number) => number | null, start = '2025-07-01T00:00:00Z'): TimeSeries => ({
  variable: 'temperatura_aria',
  unit: '°C',
  timestamps: Array.from({ length: n }, (_, i) => new Date(Date.parse(start) + i * 3_600_000).toISOString()),
  values: Array.from({ length: n }, (_, i) => f(i)),
});
const req = (s: TimeSeries, horizon = 24, extra: Partial<ForecastRequest> = {}): ForecastRequest => ({ frequency: '1h', targets: [s], pastCovariates: [], knownCovariates: [], horizon, timezone: 'Europe/Rome', ...extra });
const daily = (i: number) => 20 + 6 * Math.sin((2 * Math.PI * (i - 9)) / 24);

describe('Contratto di output: 21 quantili ordinati e mediana coerente', () => {
  it('le baseline restituiscono forme corrette, quantili non incrociati e mediana = q0,5', async () => {
    for (const a of [new NaivePersistenceAdapter(), new SeasonalNaiveAdapter()]) {
      const r = await a.forecast(req(hourly(240, (i) => daily(i) + ((i * 7) % 5) * 0.2), 48));
      expect(r.levels).toEqual(QUANTILE_LEVELS);
      expect(r.quantiles[0]).toHaveLength(48);
      expect(r.quantiles[0]![0]).toHaveLength(21);
      expect(checkQuantiles(r.quantiles[0]!, r.median[0]!)).toEqual([]);
      expect(r.timestamps[0]).toBe('2025-07-11T00:00:00.000Z');
      expect(r.dataClass).toBe('STIMATO_DA_MODELLO');
    }
  });

  it('checkQuantiles rileva quantili incrociati, livelli mancanti e mediana incoerente', () => {
    const good = QUANTILE_LEVELS.map((l) => l * 10);
    expect(checkQuantiles([good], [5])).toEqual([]);
    const crossed = [...good];
    crossed[3] = 0;
    expect(checkQuantiles([crossed], [5]).join(' ')).toMatch(/incrociati/);
    expect(checkQuantiles([good.slice(0, 20)], [5], QUANTILE_LEVELS.slice(0, 20)).join(' ')).toMatch(/21 livelli/);
    expect(checkQuantiles([good], [9]).join(' ')).toMatch(/mediana/);
  });

  it('la persistenza stagionale segue il ciclo giornaliero', async () => {
    const r = await new SeasonalNaiveAdapter().forecast(req(hourly(24 * 10, daily), 24));
    expect(Math.abs(r.median[0]![14]! - daily(24 * 10 + 14))).toBeLessThan(0.01);
  });

  it('valori mancanti nello storico sono gestiti e segnalati', async () => {
    const s = hourly(240, (i) => (i % 13 === 0 ? null : daily(i)));
    const r = await new SeasonalNaiveAdapter().forecast(req(s, 24));
    expect(r.median[0]!.every(Number.isFinite)).toBe(true);
  });

  it('la demo è sempre marcata SIMULATO', async () => {
    const r = await new DemoForecastAdapter({ median: [[1]], quantiles: [[QUANTILE_LEVELS.map(() => 1)]], timestamps: ['2025-07-11T00:00:00.000Z'] }).forecast(req(hourly(100, daily), 1));
    expect(r.dataClass).toBe('SIMULATO');
    expect(r.model.status).toBe('demo');
  });
});

describe('Validazione dell’input', () => {
  it('frequenza irregolare rifiutata; toHourlyGrid normalizza in modo esplicito', () => {
    const s = hourly(100, daily);
    const irregular = { ...s, timestamps: s.timestamps.map((t, i) => (i === 50 ? new Date(Date.parse(t) + 600_000).toISOString() : t)) };
    expect(validateForecastRequest(req(irregular)).join(' ')).toMatch(/Frequenza irregolare/);
    const grid = toHourlyGrid(
      [
        { t: '2025-07-01T10:05:00+02:00', value: 25 },
        { t: '2025-07-01T10:40:00+02:00', value: 27 },
        { t: '2025-07-01T13:10:00+02:00', value: 30 },
      ],
      '°C',
      'temperatura_aria',
    );
    expect(grid.timestamps).toEqual(['2025-07-01T08:00:00.000Z', '2025-07-01T09:00:00.000Z', '2025-07-01T10:00:00.000Z', '2025-07-01T11:00:00.000Z']);
    expect(grid.values).toEqual([26, null, null, 30]);
  });

  it('unità incompatibili, storico corto, orizzonte eccessivo, troppi mancanti: rifiutati', () => {
    expect(validateForecastRequest(req({ ...hourly(100, daily), unit: '°F' })).join(' ')).toMatch(/Unità incompatibile/);
    expect(validateForecastRequest(req(hourly(10, daily))).join(' ')).toMatch(/troppo corto/);
    expect(validateForecastRequest(req(hourly(100, daily), 500)).join(' ')).toMatch(/Orizzonte/);
    expect(validateForecastRequest(req(hourly(100, (i) => (i % 2 ? null : 1)))).join(' ')).toMatch(/mancanti/);
  });

  it('covariate future solo realmente note, della lunghezza giusta, mai il target', () => {
    const s = hourly(100, daily);
    expect(validateForecastRequest(req(s, 24, { knownCovariates: calendarCovariates(s.timestamps) })).join(' ')).toMatch(/attesa 124/);
    const leak = { name: 'temperatura_aria', unit: '°C', kind: 'previsione_meteo' as const, values: Array(124).fill(20) };
    expect(validateForecastRequest(req(s, 24, { knownCovariates: [leak] })).join(' ')).toMatch(/leakage/);
    const bad = { name: 'x', unit: '-', kind: 'osservazione_futura' as never, values: Array(124).fill(0) };
    expect(validateForecastRequest(req(s, 24, { knownCovariates: [bad] })).join(' ')).toMatch(/tipo non ammesso/);
  });

  it('istanti in UTC; il calendario usa l’ora locale e gestisce il ritorno all’ora solare', () => {
    // 26/10/2025: alle 01:00 UTC le 03:00 locali tornano alle 02:00
    const ts = ['2025-10-25T23:00:00Z', '2025-10-26T00:00:00Z', '2025-10-26T01:00:00Z', '2025-10-26T02:00:00Z'];
    expect(ts.map(localHour)).toEqual([1, 2, 2, 3]);
    const cal = calendarCovariates(ts);
    expect(cal.map((c) => c.kind)).toEqual(['calendario', 'calendario', 'calendario', 'calendario']);
    expect(cal[0]!.values[1]).toBe(cal[0]!.values[2]);
    expect(validateForecastRequest(req({ ...hourly(100, daily), timestamps: hourly(100, daily).timestamps.map((t) => t.replace('Z', '+02:00')) })).join(' ')).toMatch(/UTC|irregolare/);
  });
});

describe('Metriche', () => {
  it('pinball, WQL e copertura su casi noti', () => {
    expect(pinball(10, 0.9, 12)).toBeCloseTo(1.8);
    expect(pinball(10, 0.9, 8)).toBeCloseTo(0.2);
    const rows = [QUANTILE_LEVELS.map((l) => 10 + (l - 0.5) * 4)];
    expect(coverage(rows, [10], 0.1, 0.9)).toEqual({ value: 1, n: 1, expected: 0.8 });
    expect(coverage(rows, [20], 0.1, 0.9).value).toBe(0);
    expect(wql(rows, [10])).toBeGreaterThan(0);
  });

  it('probabilità di superamento della soglia interpolando i quantili', () => {
    const row = QUANTILE_LEVELS.map((l) => 20 + l * 10); // quantile l → 20 + 10 l
    expect(exceedanceProbability(row, 25, 'sopra')).toBeCloseTo(0.5, 2);
    expect(exceedanceProbability(row, 29, 'sopra')).toBeCloseTo(0.1, 2);
    expect(exceedanceProbability(row, 22, 'sotto')).toBeCloseTo(0.2, 2);
    expect(exceedanceProbability(row, 100, 'sopra')).toBeLessThan(0.01);
  });

  it('falsi allarmi e criticità mancate rispetto a una soglia', () => {
    const hot = [QUANTILE_LEVELS.map((l) => 30 + l)];
    const cool = [QUANTILE_LEVELS.map((l) => 20 + l)];
    const c = alertConfusion([hot, hot, cool, cool], [[31], [25], [31], [22]], { threshold: 30, direction: 'sopra', minProbability: 0.5 });
    expect(c).toEqual({ veriPositivi: 1, falsiAllarmi: 1, criticitaMancate: 1, veriNegativi: 1 });
  });
});

describe('Adapter Timestral (servizio esterno)', () => {
  const s = hourly(200, daily);
  const okBody = (h: number) => {
    const q = Array.from({ length: h }, () => QUANTILE_LEVELS.map((l) => 20 + l));
    return { schema_version: 1, model: 'mistralai/Timestral-5M', revision: TIMESTRAL_MODELS['mistralai/Timestral-5M'].revision, quantile_levels: [...QUANTILE_LEVELS], quantiles: [[q]], median: [[q.map((r) => r[10]!)]], inference_ms: 12, warnings: [] };
  };
  const json = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b }) as Response;

  it('senza URL: “Motore Timestral non configurato”, nessun valore sostitutivo', async () => {
    const a = new TimestralForecastAdapter({ baseUrl: null, model: 'mistralai/Timestral-5M' });
    expect(a.configured).toBe(false);
    await expect(a.forecast(req(s))).rejects.toThrow(new ForecastUnavailableError('Motore Timestral non configurato'));
  });

  it('risposta valida: badge Timestral con revisione dei pesi; cache e idempotenza', async () => {
    let calls = 0;
    const a = new TimestralForecastAdapter({ baseUrl: 'http://svc', model: 'mistralai/Timestral-5M', fetchImpl: async () => (calls++, json(okBody(24))) });
    const r1 = await a.forecast(req(s));
    const r2 = await a.forecast(req(s));
    expect(calls).toBe(1);
    expect(r1.inputHash).toBe(r2.inputHash);
    expect(r1.model).toMatchObject({ kind: 'timestral', status: 'beta', revision: 'bdd20cfc15a3fea0e4cb5ccef37f8d3ca7aa335f' });
    expect(r2.warnings.join(' ')).toMatch(/cache/);
  });

  it('quantili incrociati, revisione diversa o schema diverso: risultato scartato', async () => {
    const crossed = okBody(24);
    crossed.quantiles[0]![0]![0]![5] = -100;
    await expect(new TimestralForecastAdapter({ baseUrl: 'http://svc', model: 'mistralai/Timestral-5M', fetchImpl: async () => json(crossed) }).forecast(req(s))).rejects.toThrow(/incrociati/);
    await expect(new TimestralForecastAdapter({ baseUrl: 'http://svc', model: 'mistralai/Timestral-5M', fetchImpl: async () => json({ ...okBody(24), revision: 'altro' }) }).forecast(req(s))).rejects.toThrow(/Revisione/);
    await expect(new TimestralForecastAdapter({ baseUrl: 'http://svc', model: 'mistralai/Timestral-5M', fetchImpl: async () => json({ ...okBody(24), schema_version: 2 }) }).forecast(req(s))).rejects.toThrow(/Schema/);
  });

  it('timeout, servizio irraggiungibile e modello non caricato: errore esplicito', async () => {
    const hang: typeof fetch = (_u, init) => new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))));
    await expect(new TimestralForecastAdapter({ baseUrl: 'http://svc', model: 'mistralai/Timestral-5M', timeoutMs: 20, fetchImpl: hang }).forecast(req(s))).rejects.toThrow(/tempo scaduto/);
    await expect(new TimestralForecastAdapter({ baseUrl: 'http://svc', model: 'mistralai/Timestral-5M', fetchImpl: async () => { throw new TypeError('fetch failed'); } }).forecast(req(s))).rejects.toThrow(/non raggiungibile/);
    await expect(new TimestralForecastAdapter({ baseUrl: 'http://svc', model: 'mistralai/Timestral-5M', fetchImpl: async () => json({}, 503) }).forecast(req(s))).rejects.toThrow(/non caricato/);
  });

  it('input non valido rifiutato prima di chiamare il servizio', async () => {
    let calls = 0;
    const a = new TimestralForecastAdapter({ baseUrl: 'http://svc', model: 'mistralai/Timestral-5M', fetchImpl: async () => (calls++, json(okBody(24))) });
    await expect(a.forecast(req({ ...s, unit: 'K' }))).rejects.toBeInstanceOf(ForecastInputError);
    expect(calls).toBe(0);
  });
});

describe('Backtest walk-forward senza leakage (dati reali di rianalisi)', () => {
  it('lo storico di ogni origine termina prima dei valori valutati e non contiene il futuro', () => {
    const series = URBAN_DATASET.series('temperatura_aria');
    const cfg = { series, horizon: 24, step: 24, minContext: 24 * 14 };
    const origins = backtestOrigins(cfg);
    expect(origins.length).toBeGreaterThan(70);
    for (const o of [origins[0]!, origins.at(-1)!]) {
      const r = requestAtOrigin(cfg, o);
      expect(r.targets[0]!.values).toHaveLength(o);
      expect(Date.parse(r.targets[0]!.timestamps.at(-1)!)).toBeLessThan(Date.parse(series.timestamps[o]!));
      expect(r.knownCovariates.every((c) => c.kind === 'calendario')).toBe(true);
    }
  });

  it('urbano, temperatura dell’aria a 24 h: metriche calcolate per persistenza e persistenza stagionale', async () => {
    const series = URBAN_DATASET.series('temperatura_aria');
    const cfg = { series, horizon: 24, step: 24, minContext: 24 * 14, maxContext: 24 * 28, alert: { threshold: 32, direction: 'sopra' as const, minProbability: 0.3 } };
    const p = await runBacktest(cfg, new NaivePersistenceAdapter());
    const s = await runBacktest(cfg, new SeasonalNaiveAdapter());
    for (const m of [p.metrics, s.metrics]) {
      expect(m.origins).toBe(78);
      expect(m.evaluatedPoints).toBe(78 * 24);
      expect(m.coverage80).toBeGreaterThan(0.4);
      expect(m.coverage80).toBeLessThanOrEqual(1);
    }
    // con il ciclo giornaliero la stagionale batte la persistenza semplice sulla temperatura oraria
    expect(s.metrics.mae).toBeLessThan(p.metrics.mae);
  });

  it('agricolo, umidità del suolo a 72 h: metriche separate dall’urbano', async () => {
    const series = VINEYARD_DATASET.series('umidita_suolo');
    const r = await runBacktest({ series, horizon: 72, step: 24, minContext: 24 * 14, maxContext: 24 * 28 }, new NaivePersistenceAdapter());
    expect(r.metrics.origins).toBeGreaterThan(80);
    expect(Number.isFinite(r.metrics.wql)).toBe(true);
    expect(series.unit).toBe('m³/m³');
  });
});

describe('Riepilogo del backtest usato dall’interfaccia', () => {
  it('backtest_summary.json è riproducibile dal codice (caso urbano)', async () => {
    const { default: summary } = await import('./data/backtest_summary.json', { with: { type: 'json' } });
    const { BACKTEST_CASES, caseConfig } = await import('./cases');
    const c = BACKTEST_CASES.find((x) => x.id === 'urbano-temperatura-24h')!;
    const r = await runBacktest(caseConfig(c), new SeasonalNaiveAdapter());
    const stored = summary.cases.find((x) => x.id === c.id)!.results.find((x) => x.adapter === 'baseline-persistenza-stagionale')!;
    expect(stored).toEqual(JSON.parse(JSON.stringify(r.metrics)));
    // Timestral non eseguito: dichiarato, mai inventato
    expect(summary.cases.every((x) => x.results.every((m) => !m.adapter.startsWith('mistralai/')) || x.notRun.length === 0)).toBe(true);
  });
});

describe('Registro della previsione, soglie agronomiche ed ex-post', () => {
  it('soglia di umidità da capacità di campo e appassimento; dati mancanti → non determinabile', async () => {
    const { soilMoistureThreshold } = await import('./record');
    expect(soilMoistureThreshold(0.25, 0.12)).toBeCloseTo(0.159, 3);
    expect(soilMoistureThreshold(0.25, 0.12, 0.5)).toBeCloseTo(0.185, 3);
    expect(soilMoistureThreshold(null, 0.12)).toBeNull();
    expect(soilMoistureThreshold(0.1, 0.12)).toBeNull();
  });

  it('record: banda scelta, soglia valutata dai quantili, lineage; ex-post con MAE e copertura', async () => {
    const { buildForecastRecord, expostComparison, evaluateThreshold } = await import('./record');
    const { forecastLineage } = await import('./datasets');
    const s = URBAN_DATASET.series('temperatura_aria');
    const cfg = { series: s, horizon: 24, step: 24, minContext: 336, maxContext: 672 };
    const req = requestAtOrigin(cfg, 2000);
    const r = await new SeasonalNaiveAdapter().forecast(req);
    const thr = { value: 30, direction: 'sopra' as const, minProbability: 0.3, expertRole: 'tecnico comunale', rationale: 'prova di soglia' };
    const lin = forecastLineage(URBAN_DATASET, req.targets[0]!, r.model, { covariates: [], horizon: 24, startedBy: 'test', executedAt: '2026-10-24T00:00:00Z' });
    const rec = buildForecastRecord({ id: 'r1', now: new Date('2026-10-24T00:00:00Z'), context: 'urbano', result: r, variable: 'temperatura_aria', unit: '°C', band: '90', thresholds: [thr], lineage: lin, note: 'n' });
    expect(rec.issuedAt).toBe(new Date(Date.parse(s.timestamps[1999]!)).toISOString());
    expect(rec.lower.every((l, i) => l <= rec.median[i]! && rec.median[i]! <= rec.upper[i]!)).toBe(true);
    expect(rec.lower[0]).toBe(r.quantiles[0]![0]![1]);
    expect(rec.thresholds[0]!.flagged).toBe(evaluateThreshold(r, thr).flagged);
    expect(rec.lineage.dataClass).toBe('STIMATO_DA_MODELLO');
    const cmp = expostComparison(rec, s.values.slice(2000, 2024), 'rianalisi', new Date());
    expect(cmp.points).toBe(24);
    expect(cmp.mae).toBeGreaterThanOrEqual(0);
    expect(cmp.insideBand).toBeGreaterThanOrEqual(0);
    expect(expostComparison(rec, Array(24).fill(null), 'x', new Date())).toMatchObject({ mae: null, insideBand: null, points: 0 });
  });

  it('il record entra nel progetto e nell’export con hash verificabile', async () => {
    const { seedCampobasso } = await import('../seeds/seeds');
    const { exportProject, importProject } = await import('../project/bundle');
    const b = seedCampobasso(new Date('2026-10-24T08:00:00Z'));
    const withF = { ...b, forecasts: [{ id: 'f', variable: 'temperatura_aria' } as never] };
    const back = importProject(JSON.stringify(exportProject(withF, new Date())));
    expect(back.hashOk).toBe(true);
    expect(back.bundle!.forecasts).toHaveLength(1);
  });
});
