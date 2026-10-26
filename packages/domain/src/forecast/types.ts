/**
 * Previsione probabilistica di serie temporali (F31).
 *
 * Modulo SEPARATO dalla simulazione degli interventi: prevede l'andamento di
 * una variabile osservata (es. temperatura dell'aria, umidità del suolo), non
 * calcola l'effetto causale di alberi, depaving o schermature, non misura, non
 * diagnostica, non prescrive.
 */

/** I 21 livelli di quantile restituiti da Timestral (README ufficiale). */
export const QUANTILE_LEVELS = [
  0.01, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.99,
] as const;
export const MEDIAN_INDEX = 10;

export type ForecastFrequency = '1h';
export const FREQUENCY_MS: Record<ForecastFrequency, number> = { '1h': 3_600_000 };

/** Tipi di covariata futura ammessi: solo informazioni realmente note in anticipo. */
export type KnownCovariateKind = 'calendario' | 'previsione_meteo' | 'piano_irriguo' | 'evento_pianificato';

export interface TimeSeries {
  variable: string;
  unit: string;
  /** istanti UTC ISO 8601, regolari alla frequenza dichiarata */
  timestamps: string[];
  /** null = valore mancante */
  values: (number | null)[];
}

export interface Covariate {
  name: string;
  unit: string;
  values: (number | null)[];
}

export interface KnownCovariate extends Covariate {
  kind: KnownCovariateKind;
}

export interface ForecastRequest {
  frequency: ForecastFrequency;
  /** uno o più target previsti congiuntamente (stessa griglia temporale) */
  targets: TimeSeries[];
  /** note solo sul contesto (lunghezza T) */
  pastCovariates: Covariate[];
  /** note su contesto e orizzonte (lunghezza T + horizon) */
  knownCovariates: KnownCovariate[];
  horizon: number;
  timezone: 'Europe/Rome';
}

export type ForecastStatus = 'demo' | 'beta' | 'validato';

export interface ForecastModelMeta {
  id: string;
  name: string;
  version: string;
  /** revisione dei pesi o del codice (commit) */
  revision: string;
  kind: 'timestral' | 'baseline' | 'demo';
  status: ForecastStatus;
  license: string;
  applicability: string;
  limitations: string[];
}

export interface ForecastResult {
  model: ForecastModelMeta;
  /** istanti UTC dell'orizzonte */
  timestamps: string[];
  /** per target: mediana (horizon) */
  median: number[][];
  /** per target: quantili [horizon][21] */
  quantiles: number[][][];
  levels: readonly number[];
  inferenceMs: number;
  warnings: string[];
  /** classe di dato: STIMATO_DA_MODELLO per modelli reali e baseline, SIMULATO per la demo */
  dataClass: 'STIMATO_DA_MODELLO' | 'SIMULATO';
  inputHash: string;
  /** per target: rapporto del vincolo fisico applicato lato server (null = nessun vincolo richiesto) */
  constraints?: (PhysicalConstraintReport | null)[];
  /** versione dell'adattatore del servizio che ha prodotto il risultato */
  adapterVersion?: string;
  /** esecuzione registrata su Supabase dal proxy (solo modelli reali) */
  runId?: string;
}

/** Vincolo fisico (es. umidità 0–100%) applicato dal servizio prima della registrazione: mai nel browser. */
export interface PhysicalConstraintReport {
  physical_constraint_applied: boolean;
  physical_min: number | null;
  physical_max: number | null;
  adjusted_values_count: number;
  total_values: number;
  maximum_raw_value: number;
  minimum_raw_value: number;
  method: string;
  adapter_version: string;
}

export interface TimeSeriesForecastAdapter {
  readonly meta: ForecastModelMeta;
  forecast(req: ForecastRequest, opts?: { signal?: AbortSignal }): Promise<ForecastResult>;
}

export class ForecastUnavailableError extends Error {
  constructor(message = 'Motore Timestral non configurato') {
    super(message);
    this.name = 'ForecastUnavailableError';
  }
}

export class ForecastInputError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' '));
    this.name = 'ForecastInputError';
  }
}
