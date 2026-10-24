import { hashOf } from '../hash/hash';
import { FREQUENCY_MS, ForecastInputError, type ForecastRequest, type KnownCovariate, type TimeSeries } from './types';

/** Unità accettate per variabile (nessuna conversione implicita). */
export const VARIABLE_UNITS: Record<string, string> = {
  temperatura_aria: '°C',
  umidita_relativa: '%',
  temperatura_superficiale: '°C',
  umidita_suolo: 'm³/m³',
  temperatura_suolo: '°C',
  radiazione: 'W/m²',
  vento: 'm/s',
  precipitazione: 'mm',
};

export const LIMITS = { maxTargets: 8, maxContext: 8760, minContext: 72, maxHorizon: 168, maxCovariates: 16, maxMissingRatio: 0.3 };

/** Converte misure con orario qualsiasi in una griglia oraria UTC regolare (NaN = mancante). */
export function toHourlyGrid(points: { t: string; value: number | null }[], unit: string, variable: string): TimeSeries {
  const step = FREQUENCY_MS['1h'];
  const parsed = points
    .map((p) => ({ ms: Date.parse(p.t), v: p.value }))
    .filter((p) => Number.isFinite(p.ms))
    .sort((a, b) => a.ms - b.ms);
  if (parsed.length === 0) return { variable, unit, timestamps: [], values: [] };
  const start = Math.floor(parsed[0]!.ms / step) * step;
  const end = Math.floor(parsed.at(-1)!.ms / step) * step;
  const slots = new Map<number, number[]>();
  for (const p of parsed) {
    if (p.v === null || !Number.isFinite(p.v)) continue;
    const k = Math.floor(p.ms / step) * step;
    slots.set(k, [...(slots.get(k) ?? []), p.v]);
  }
  const timestamps: string[] = [];
  const values: (number | null)[] = [];
  for (let t = start; t <= end; t += step) {
    timestamps.push(new Date(t).toISOString());
    const s = slots.get(t);
    values.push(s ? s.reduce((a, b) => a + b, 0) / s.length : null);
  }
  return { variable, unit, timestamps, values };
}

export function missingRatio(values: readonly (number | null)[]): number {
  return values.length ? values.filter((v) => v === null || !Number.isFinite(v)).length / values.length : 1;
}

/**
 * Controlli prima dell'inferenza. Rifiuta (non corregge in silenzio):
 * frequenze irregolari, unità incompatibili, covariate di lunghezza errata,
 * covariate che coincidono con il target (leakage), orizzonti fuori limite.
 */
export function validateForecastRequest(req: ForecastRequest): string[] {
  const p: string[] = [];
  const step = FREQUENCY_MS[req.frequency];
  if (!step) p.push(`Frequenza non supportata: ${req.frequency}.`);
  if (req.targets.length === 0) p.push('Serve almeno una serie target.');
  if (req.targets.length > LIMITS.maxTargets) p.push(`Al massimo ${LIMITS.maxTargets} serie target.`);
  if (!Number.isInteger(req.horizon) || req.horizon < 1 || req.horizon > LIMITS.maxHorizon) p.push(`Orizzonte fuori dai limiti (1–${LIMITS.maxHorizon} passi).`);
  const base = req.targets[0];
  const T = base?.timestamps.length ?? 0;
  if (T < LIMITS.minContext) p.push(`Storico troppo corto: servono almeno ${LIMITS.minContext} valori.`);
  if (T > LIMITS.maxContext) p.push(`Storico troppo lungo: massimo ${LIMITS.maxContext} valori (taglia i più vecchi).`);
  for (const s of req.targets) {
    const expected = VARIABLE_UNITS[s.variable];
    if (!expected) p.push(`Variabile non riconosciuta: ${s.variable}.`);
    else if (s.unit !== expected) p.push(`Unità incompatibile per ${s.variable}: “${s.unit}” invece di “${expected}”.`);
    if (s.values.length !== s.timestamps.length) p.push(`${s.variable}: numero di valori diverso dal numero di istanti.`);
    if (base && s.timestamps.join() !== base.timestamps.join()) p.push(`${s.variable}: griglia temporale diversa dagli altri target.`);
    if (missingRatio(s.values) > LIMITS.maxMissingRatio) p.push(`${s.variable}: oltre il ${Math.round(LIMITS.maxMissingRatio * 100)}% di valori mancanti.`);
    if (s.values.at(-1) === null) p.push(`${s.variable}: l’ultimo valore dello storico è mancante.`);
  }
  if (base && step) {
    for (let i = 1; i < base.timestamps.length; i++) {
      const d = Date.parse(base.timestamps[i]!) - Date.parse(base.timestamps[i - 1]!);
      if (d !== step) {
        p.push(`Frequenza irregolare tra ${base.timestamps[i - 1]} e ${base.timestamps[i]}: normalizza prima con toHourlyGrid().`);
        break;
      }
    }
    if (base.timestamps.some((t) => !t.endsWith('Z') && !/[+-]00:00$/.test(t))) p.push('Gli istanti devono essere in UTC (il fuso Europe/Rome si usa solo per la visualizzazione).');
  }
  const targetNames = new Set(req.targets.map((t) => t.variable));
  if (req.pastCovariates.length + req.knownCovariates.length > LIMITS.maxCovariates) p.push(`Al massimo ${LIMITS.maxCovariates} covariate.`);
  for (const c of req.pastCovariates) {
    if (c.values.length !== T) p.push(`Covariata passata ${c.name}: lunghezza ${c.values.length}, attesa ${T}.`);
    if (targetNames.has(c.name)) p.push(`La covariata ${c.name} coincide con un target: rischio di leakage.`);
  }
  for (const c of req.knownCovariates) {
    if (c.values.length !== T + req.horizon) p.push(`Covariata futura ${c.name}: lunghezza ${c.values.length}, attesa ${T + req.horizon}.`);
    if (targetNames.has(c.name)) p.push(`La covariata ${c.name} coincide con un target: rischio di leakage.`);
    if (!['calendario', 'previsione_meteo', 'piano_irriguo', 'evento_pianificato'].includes((c as KnownCovariate).kind)) p.push(`Covariata futura ${c.name}: tipo non ammesso.`);
  }
  return p;
}

export function assertValidRequest(req: ForecastRequest): void {
  const p = validateForecastRequest(req);
  if (p.length) throw new ForecastInputError(p);
}

export function futureTimestamps(last: string, horizon: number, step = FREQUENCY_MS['1h']): string[] {
  const t0 = Date.parse(last);
  return Array.from({ length: horizon }, (_, i) => new Date(t0 + (i + 1) * step).toISOString());
}

/** Impronta deterministica dell'input (cache e riproducibilità). */
export function requestHash(req: ForecastRequest, modelId: string, revision: string): string {
  return hashOf({ req, modelId, revision });
}

/** Covariate di calendario: note per costruzione, calcolate dall'ora locale Europe/Rome (gestisce l'ora legale). */
export function calendarCovariates(timestamps: readonly string[]): KnownCovariate[] {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', weekday: 'short', hourCycle: 'h23' });
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hs: number[] = [];
  const ds: number[] = [];
  for (const t of timestamps) {
    const parts = fmt.formatToParts(new Date(t));
    hs.push(Number(parts.find((x) => x.type === 'hour')!.value));
    ds.push(days.indexOf(parts.find((x) => x.type === 'weekday')!.value));
  }
  const round = (x: number) => Math.round(x * 1e6) / 1e6;
  return [
    { name: 'ora_sin', unit: '-', kind: 'calendario', values: hs.map((h) => round(Math.sin((2 * Math.PI * h) / 24))) },
    { name: 'ora_cos', unit: '-', kind: 'calendario', values: hs.map((h) => round(Math.cos((2 * Math.PI * h) / 24))) },
    { name: 'giorno_sin', unit: '-', kind: 'calendario', values: ds.map((d) => round(Math.sin((2 * Math.PI * d) / 7))) },
    { name: 'giorno_cos', unit: '-', kind: 'calendario', values: ds.map((d) => round(Math.cos((2 * Math.PI * d) / 7))) },
  ];
}

export function localHour(t: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)));
}

