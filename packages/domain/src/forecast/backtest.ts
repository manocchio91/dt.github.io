import { alertConfusion, coverage, mae, maseScale, meanPinball, wql, type AlertRule } from './metrics';
import { calendarCovariates } from './validate';
import { MEDIAN_INDEX, type ForecastRequest, type TimeSeries, type TimeSeriesForecastAdapter } from './types';

/**
 * Backtest temporale walk-forward SENZA leakage: per ogni origine il modello
 * riceve solo lo storico fino all'origine e covariate realmente note (qui solo
 * il calendario); i valori futuri del target servono soltanto a valutare.
 */
export interface BacktestConfig {
  series: TimeSeries;
  horizon: number;
  /** distanza tra origini consecutive (passi) */
  step: number;
  /** storico minimo prima della prima origine */
  minContext: number;
  /** storico massimo passato al modello */
  maxContext?: number;
  maxOrigins?: number;
  alert?: AlertRule;
  useCalendar?: boolean;
}

export interface OriginForecast {
  origin: string;
  quantiles: number[][];
  median: number[];
  observed: (number | null)[];
}

export interface BacktestMetrics {
  adapter: string;
  name: string;
  origins: number;
  mae: number;
  mase: number;
  meanPinball: number;
  wql: number;
  coverage80: number;
  coverage98: number;
  alerts?: ReturnType<typeof alertConfusion>;
  evaluatedPoints: number;
}

export function backtestOrigins(cfg: BacktestConfig): number[] {
  const T = cfg.series.values.length;
  const out: number[] = [];
  for (let o = cfg.minContext; o + cfg.horizon <= T; o += cfg.step) out.push(o);
  return cfg.maxOrigins ? out.slice(-cfg.maxOrigins) : out;
}

export function requestAtOrigin(cfg: BacktestConfig, origin: number): ForecastRequest {
  const start = cfg.maxContext ? Math.max(0, origin - cfg.maxContext) : 0;
  const ctx: TimeSeries = {
    variable: cfg.series.variable,
    unit: cfg.series.unit,
    timestamps: cfg.series.timestamps.slice(start, origin),
    values: cfg.series.values.slice(start, origin),
  };
  const allTs = cfg.series.timestamps.slice(start, origin + cfg.horizon);
  return {
    frequency: '1h',
    targets: [ctx],
    pastCovariates: [],
    knownCovariates: cfg.useCalendar === false ? [] : calendarCovariates(allTs),
    horizon: cfg.horizon,
    timezone: 'Europe/Rome',
  };
}

export async function runBacktest(cfg: BacktestConfig, adapter: TimeSeriesForecastAdapter): Promise<{ metrics: BacktestMetrics; forecasts: OriginForecast[] }> {
  const forecasts: OriginForecast[] = [];
  for (const origin of backtestOrigins(cfg)) {
    const req = requestAtOrigin(cfg, origin);
    // garanzia anti-leakage: lo storico termina prima del primo istante valutato
    if (Date.parse(req.targets[0]!.timestamps.at(-1)!) >= Date.parse(cfg.series.timestamps[origin]!)) throw new Error('leakage: storico oltre l’origine');
    const r = await adapter.forecast(req);
    forecasts.push({
      origin: cfg.series.timestamps[origin]!,
      quantiles: r.quantiles[0]!,
      median: r.median[0]!,
      observed: cfg.series.values.slice(origin, origin + cfg.horizon),
    });
  }
  const allQ = forecasts.flatMap((f) => f.quantiles);
  const allMed = forecasts.flatMap((f) => f.quantiles.map((q) => q[MEDIAN_INDEX]!));
  const allObs = forecasts.flatMap((f) => f.observed);
  const scale = maseScale(cfg.series.values.slice(0, cfg.minContext));
  const m = mae(allMed, allObs);
  const metrics: BacktestMetrics = {
    adapter: adapter.meta.id,
    name: adapter.meta.name,
    origins: forecasts.length,
    mae: round(m.value),
    mase: round(m.value / scale),
    meanPinball: round(meanPinball(allQ, allObs)),
    wql: round(wql(allQ, allObs)),
    coverage80: round(coverage(allQ, allObs, 0.1, 0.9).value),
    coverage98: round(coverage(allQ, allObs, 0.01, 0.99).value),
    evaluatedPoints: m.n,
    ...(cfg.alert ? { alerts: alertConfusion(forecasts.map((f) => f.quantiles), forecasts.map((f) => f.observed), cfg.alert) } : {}),
  };
  return { metrics, forecasts };
}

const round = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : NaN);
