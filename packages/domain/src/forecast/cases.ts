import { URBAN_DATASET, VINEYARD_DATASET, type ForecastDataset } from './datasets';
import type { BacktestConfig } from './backtest';
import type { AlertRule } from './metrics';

/**
 * Casi di backtest dichiarati: stessi parametri per lo script, i test e
 * l'interfaccia. Urbano e agricolo sono valutati separatamente.
 * Le soglie sono DIMOSTRATIVE: in uso reale le fissa l'esperto (tecnico
 * comunale, agronomo) e vanno documentate nel progetto.
 */
export interface BacktestCase {
  id: string;
  context: 'urbano' | 'agricolo';
  label: string;
  dataset: ForecastDataset;
  variable: string;
  horizon: number;
  alert: AlertRule & { note: string };
}

export const BACKTEST_CASES: BacktestCase[] = [
  {
    id: 'urbano-temperatura-24h',
    context: 'urbano',
    label: 'Campobasso — temperatura dell’aria, orizzonte 24 h',
    dataset: URBAN_DATASET,
    variable: 'temperatura_aria',
    horizon: 24,
    alert: { threshold: 32, direction: 'sopra', minProbability: 0.3, note: 'soglia dimostrativa di caldo intenso (32 °C)' },
  },
  {
    id: 'agricolo-umidita-suolo-72h',
    context: 'agricolo',
    label: 'Vigneto molisano — umidità del suolo 7–28 cm, orizzonte 72 h',
    dataset: VINEYARD_DATASET,
    variable: 'umidita_suolo',
    horizon: 72,
    alert: { threshold: 0.16, direction: 'sotto', minProbability: 0.5, note: 'soglia dimostrativa di umidità bassa (0,16 m³/m³), da sostituire con quella dell’agronomo' },
  },
  {
    id: 'agricolo-temperatura-48h',
    context: 'agricolo',
    label: 'Vigneto molisano — temperatura dell’aria, orizzonte 48 h',
    dataset: VINEYARD_DATASET,
    variable: 'temperatura_aria',
    horizon: 48,
    alert: { threshold: 35, direction: 'sopra', minProbability: 0.3, note: 'soglia dimostrativa di stress termico (35 °C)' },
  },
];

/** Protocollo comune: origini giornaliere, 14 giorni minimi, 28 giorni di contesto, solo calendario come covariata nota. */
export function caseConfig(c: BacktestCase): BacktestConfig {
  return { series: c.dataset.series(c.variable), horizon: c.horizon, step: 24, minContext: 24 * 14, maxContext: 24 * 28, alert: c.alert };
}

/** Riepilogo dell'ultimo backtest (generato da scripts/backtest.ts, verificato dai test). */
export { default as BACKTEST_SUMMARY } from './data/backtest_summary.json' with { type: 'json' };
