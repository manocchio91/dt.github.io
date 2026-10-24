import { exceedanceProbability } from './metrics';
import { MEDIAN_INDEX, QUANTILE_LEVELS, type ForecastResult } from './types';
import type { ForecastLineage } from './datasets';

/** Bande selezionabili: indici nei 21 livelli. */
export const FORECAST_BANDS = {
  '80': { label: 'intervallo 80% (q0,10–q0,90)', lo: 2, hi: 18 },
  '90': { label: 'intervallo 90% (q0,05–q0,95)', lo: 1, hi: 19 },
  '98': { label: 'intervallo 98% (q0,01–q0,99)', lo: 0, hi: 20 },
} as const;
export type ForecastBand = keyof typeof FORECAST_BANDS;

export interface ExpertThreshold {
  value: number;
  direction: 'sopra' | 'sotto';
  /** probabilità minima di superamento per segnalare */
  minProbability: number;
  expertRole: string;
  rationale: string;
  zone?: string;
}

export interface ThresholdFinding {
  /** probabilità di superamento per ogni passo */
  probabilities: number[];
  firstAt: string | null;
  maxProbability: number;
  flagged: boolean;
}

export function evaluateThreshold(result: ForecastResult, t: Pick<ExpertThreshold, 'value' | 'direction' | 'minProbability'>, variate = 0): ThresholdFinding {
  const probs = result.quantiles[variate]!.map((row) => exceedanceProbability(row, t.value, t.direction));
  const idx = probs.findIndex((p) => p >= t.minProbability);
  return { probabilities: probs, firstAt: idx >= 0 ? result.timestamps[idx]! : null, maxProbability: Math.max(0, ...probs), flagged: idx >= 0 };
}

/** Soglia agronomica di umidità del suolo da capacità di campo e punto di appassimento (frazione di acqua disponibile). */
export function soilMoistureThreshold(fieldCapacity: number | null, wiltingPoint: number | null, depletionFraction = 0.3): number | null {
  if (fieldCapacity === null || wiltingPoint === null || fieldCapacity <= wiltingPoint) return null;
  return Math.round((wiltingPoint + depletionFraction * (fieldCapacity - wiltingPoint)) * 1000) / 1000;
}

/** Previsione registrata nel progetto e nel dossier (F31). */
export interface ForecastRecord {
  id: string;
  createdAt: string;
  context: 'urbano' | 'agricolo';
  variable: string;
  unit: string;
  horizon: number;
  /** istante "ora": ultimo dato dello storico usato */
  issuedAt: string;
  model: { id: string; name: string; revision: string; kind: string; status: string };
  dataClass: ForecastResult['dataClass'];
  inputHash: string;
  band: ForecastBand;
  timestamps: string[];
  median: number[];
  lower: number[];
  upper: number[];
  thresholds: (ExpertThreshold & { firstAt: string | null; maxProbability: number; flagged: boolean })[];
  lineage: ForecastLineage;
  warnings: string[];
  note: string;
  expost?: ExpostComparison;
}

export interface ExpostComparison {
  recordedAt: string;
  source: string;
  observed: (number | null)[];
  mae: number | null;
  insideBand: number | null;
  points: number;
}

export function buildForecastRecord(args: {
  id: string;
  now: Date;
  context: ForecastRecord['context'];
  result: ForecastResult;
  variable: string;
  unit: string;
  band: ForecastBand;
  thresholds: ExpertThreshold[];
  lineage: ForecastLineage;
  note: string;
}): ForecastRecord {
  const { result, band } = args;
  const b = FORECAST_BANDS[band];
  const q = result.quantiles[0]!;
  return {
    id: args.id,
    createdAt: args.now.toISOString(),
    context: args.context,
    variable: args.variable,
    unit: args.unit,
    horizon: result.timestamps.length,
    issuedAt: new Date(Date.parse(result.timestamps[0]!) - 3_600_000).toISOString(),
    model: { id: result.model.id, name: result.model.name, revision: result.model.revision, kind: result.model.kind, status: result.model.status },
    dataClass: result.dataClass,
    inputHash: result.inputHash,
    band,
    timestamps: result.timestamps,
    median: q.map((r) => r[MEDIAN_INDEX]!),
    lower: q.map((r) => r[b.lo]!),
    upper: q.map((r) => r[b.hi]!),
    thresholds: args.thresholds.map((t) => ({ ...t, ...pick(evaluateThreshold(result, t)) })),
    lineage: args.lineage,
    warnings: result.warnings,
    note: args.note,
  };
}

const pick = (f: ThresholdFinding) => ({ firstAt: f.firstAt, maxProbability: Math.round(f.maxProbability * 1000) / 1000, flagged: f.flagged });

/** Confronto con l'osservazione successiva (stesse ore della previsione). */
export function expostComparison(rec: Pick<ForecastRecord, 'median' | 'lower' | 'upper'>, observed: (number | null)[], source: string, now: Date): ExpostComparison {
  let abs = 0;
  let inside = 0;
  let n = 0;
  rec.median.forEach((m, i) => {
    const o = observed[i];
    if (typeof o !== 'number' || !Number.isFinite(o)) return;
    abs += Math.abs(o - m);
    if (o >= rec.lower[i]! && o <= rec.upper[i]!) inside++;
    n++;
  });
  return {
    recordedAt: now.toISOString(),
    source,
    observed,
    mae: n ? Math.round((abs / n) * 1000) / 1000 : null,
    insideBand: n ? Math.round((inside / n) * 1000) / 1000 : null,
    points: n,
  };
}

export const FORECAST_TEXT = {
  agri: 'Previsione prodotta da un modello e non misurazione sul terreno. Verificare in campo e confrontarsi con un agronomo prima di intervenire.',
  urban: 'La previsione descrive l’andamento atteso delle condizioni meteo-climatiche nell’area: non stima l’effetto di alberi, depavimentazione o altri interventi, che si valutano con gli scenari del Decision Lab.',
  notConfigured: 'Motore Timestral non configurato',
  levels: QUANTILE_LEVELS,
} as const;
