import urban from './data/urban_campobasso_2025.json';
import vineyard from './data/vineyard_molise_2025.json';
import { missingRatio } from './validate';
import type { TimeSeries } from './types';

/**
 * Serie orarie reali di RIANALISI (Open-Meteo, ERA5/ERA5-Land, CC BY 4.0)
 * usate per backtest e dimostrazioni. Sono stime da modello su celle di
 * qualche chilometro, NON misure di sensori nell'area o nella parcella.
 */
interface RawDataset {
  meta: {
    title: string;
    source: string;
    endpoint: string;
    license: string;
    retrievedAt: string;
    requested: { lat: number; lon: number };
    gridCell: { lat: number; lon: number; elevationM: number };
    frequency: string;
    timezone: string;
    dataClass: string;
    note: string;
  };
  time: string[];
  series: Record<string, { unit: string; values: (number | null)[] }>;
}

export interface ForecastDataset {
  id: 'urban_campobasso_2025' | 'vineyard_molise_2025';
  meta: RawDataset['meta'];
  time: string[];
  series(variable: string): TimeSeries;
  variables(): string[];
}

function wrap(id: ForecastDataset['id'], raw: RawDataset): ForecastDataset {
  return {
    id,
    meta: raw.meta,
    time: raw.time,
    variables: () => Object.keys(raw.series),
    series(variable: string): TimeSeries {
      const s = raw.series[variable];
      if (!s) throw new Error(`Variabile ${variable} non presente nel dataset ${id}`);
      return { variable, unit: s.unit, timestamps: raw.time, values: s.values };
    },
  };
}

export const URBAN_DATASET = wrap('urban_campobasso_2025', urban as RawDataset);
export const VINEYARD_DATASET = wrap('vineyard_molise_2025', vineyard as RawDataset);

/** Provenienza di una previsione (F21): dati, modello, esecuzione. */
export interface ForecastLineage {
  dataset: string;
  source: string;
  endpoint: string;
  license: string;
  coordinates: { lat: number; lon: number };
  variable: string;
  unit: string;
  frequency: string;
  period: { from: string; to: string };
  missingPct: number;
  qaFlags: string[];
  covariates: string[];
  model: { id: string; revision: string; status: string };
  executedAt: string;
  horizon: number;
  dataClass: string;
  startedBy: string;
}

export function forecastLineage(
  ds: ForecastDataset,
  s: TimeSeries,
  model: { id: string; revision: string; status: string },
  extra: { covariates: string[]; horizon: number; startedBy: string; executedAt: string },
): ForecastLineage {
  const missing = missingRatio(s.values);
  return {
    dataset: ds.meta.title,
    source: ds.meta.source,
    endpoint: ds.meta.endpoint,
    license: ds.meta.license,
    coordinates: { lat: ds.meta.gridCell.lat, lon: ds.meta.gridCell.lon },
    variable: s.variable,
    unit: s.unit,
    frequency: ds.meta.frequency,
    period: { from: s.timestamps[0]!, to: s.timestamps.at(-1)! },
    missingPct: Math.round(missing * 1000) / 10,
    qaFlags: [missing > 0 ? 'valori mancanti presenti' : 'nessun valore mancante', 'rianalisi: stima da modello, non misura in campo'],
    covariates: extra.covariates,
    model,
    executedAt: extra.executedAt,
    horizon: extra.horizon,
    dataClass: 'STIMATO_DA_MODELLO',
    startedBy: extra.startedBy,
  };
}
