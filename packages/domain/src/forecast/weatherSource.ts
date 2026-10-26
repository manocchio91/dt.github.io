import { assertValidRequest, calendarCovariates, futureTimestamps, toHourlyGrid } from './validate';
import { ForecastInputError, type ForecastRequest, type KnownCovariate } from './types';

/**
 * Input per Timestral dallo storico registrato su Supabase (weather_observations) con la
 * previsione Open-Meteo (weather_forecast_points) come covariata NOTA IN ANTICIPO.
 *
 * - target: misure da sensore se presenti, altrimenti l'analisi Open-Meteo delle ore passate
 *   (dichiarato nella provenienza: non è una misura in campo);
 * - covariate note: sul contesto l'analisi Open-Meteo, sull'orizzonte l'ultima emissione Open-Meteo;
 * - nessun valore futuro del target entra nell'input.
 * L'output resta di Timestral (o "Motore Timestral non configurato"): i dati Open-Meteo non
 * vengono mai presentati come previsione Timestral.
 */

/** Variabili Open-Meteo → nomi del contratto di previsione (F31). */
export const OM_TO_FORECAST_VARIABLE: Record<string, string> = {
  temperature_2m: 'temperatura_aria',
  relative_humidity_2m: 'umidita_relativa',
  soil_moisture_9_to_27cm: 'umidita_suolo',
  soil_temperature_6cm: 'temperatura_suolo',
  shortwave_radiation: 'radiazione',
  wind_speed_10m: 'vento',
  precipitation: 'precipitazione',
};

export interface ObservationRow {
  observed_at: string;
  variable: string;
  value: number;
  unit: string;
  source: string;
}

export interface ForecastPointRow {
  valid_at: string;
  issued_at: string;
  [variable: string]: unknown;
}

export interface WeatherInputProvenance {
  targetSource: 'sensore' | 'open_meteo' | 'misto';
  sensorHours: number;
  openMeteoHours: number;
  covariateSource: 'open_meteo';
  forecastIssuedAt: string;
  contextFrom: string;
  contextTo: string;
}

export function buildTimestralRequestFromWeather(args: {
  /** variabile Open-Meteo del target, es. temperature_2m */
  target: string;
  observations: ObservationRow[];
  forecastPoints: ForecastPointRow[];
  horizon: number;
  /** covariate Open-Meteo note in anticipo (default: il target stesso come previsione) */
  covariates?: string[];
  contextHours?: number;
}): { request: ForecastRequest; provenance: WeatherInputProvenance } {
  const name = OM_TO_FORECAST_VARIABLE[args.target];
  if (!name) throw new ForecastInputError([`Variabile non supportata per Timestral: ${args.target}`]);
  const own = args.observations.filter((o) => o.variable === args.target);
  if (own.length === 0) throw new ForecastInputError(['Nessuno storico registrato per la variabile richiesta.']);
  const unit = own[0]!.unit;
  // per ogni ora: misura da sensore se disponibile, altrimenti analisi Open-Meteo
  const byHour = new Map<string, { value: number; source: string }>();
  for (const o of own) {
    const h = new Date(Math.floor(Date.parse(o.observed_at) / 3_600_000) * 3_600_000).toISOString();
    const prev = byHour.get(h);
    if (!prev || (prev.source !== 'sensore' && o.source === 'sensore')) byHour.set(h, { value: o.value, source: o.source });
  }
  let target = toHourlyGrid([...byHour].map(([t, v]) => ({ t, value: v.value })), unit, name);
  const keep = args.contextHours ?? 24 * 28;
  if (target.timestamps.length > keep) target = { ...target, timestamps: target.timestamps.slice(-keep), values: target.values.slice(-keep) };
  const contextTo = target.timestamps.at(-1)!;
  const horizonTs = futureTimestamps(contextTo, args.horizon);

  // ultima emissione che copre l'intero orizzonte
  const issues = [...new Set(args.forecastPoints.map((p) => p.issued_at))].sort().reverse();
  const covVars = args.covariates ?? [args.target];
  let chosen: string | null = null;
  for (const iss of issues) {
    const pts = new Map(args.forecastPoints.filter((p) => p.issued_at === iss).map((p) => [new Date(Date.parse(p.valid_at)).toISOString(), p]));
    if (Date.parse(iss) <= Date.parse(horizonTs[0]!) && horizonTs.every((t) => covVars.every((v) => typeof pts.get(t)?.[v] === 'number'))) {
      chosen = iss;
      break;
    }
  }
  if (!chosen) throw new ForecastInputError(['La previsione Open-Meteo registrata non copre l’orizzonte richiesto: aggiornare i dati meteo.']);
  const horizonPts = new Map(args.forecastPoints.filter((p) => p.issued_at === chosen).map((p) => [new Date(Date.parse(p.valid_at)).toISOString(), p]));

  const knownCovariates: KnownCovariate[] = covVars.map((v) => {
    const analysis = new Map(args.observations.filter((o) => o.variable === v && o.source === 'open_meteo').map((o) => [new Date(Date.parse(o.observed_at)).toISOString(), o.value]));
    const u = args.observations.find((o) => o.variable === v)?.unit ?? String((args.forecastPoints[0]?.unit_metadata as Record<string, string> | undefined)?.[v] ?? '');
    return {
      name: `previsione_open_meteo_${v}`,
      unit: u,
      kind: 'previsione_meteo',
      values: [...target.timestamps.map((t) => analysis.get(t) ?? null), ...horizonTs.map((t) => horizonPts.get(t)![v] as number)],
    };
  });
  const request: ForecastRequest = {
    frequency: '1h',
    targets: [target],
    pastCovariates: [],
    knownCovariates: [...knownCovariates, ...calendarCovariates([...target.timestamps, ...horizonTs])],
    horizon: args.horizon,
    timezone: 'Europe/Rome',
  };
  assertValidRequest(request);
  const sources = target.timestamps.map((t) => byHour.get(t)?.source).filter(Boolean);
  const sensorHours = sources.filter((s) => s === 'sensore').length;
  const openMeteoHours = sources.filter((s) => s === 'open_meteo').length;
  return {
    request,
    provenance: {
      targetSource: sensorHours && openMeteoHours ? 'misto' : sensorHours ? 'sensore' : 'open_meteo',
      sensorHours,
      openMeteoHours,
      covariateSource: 'open_meteo',
      forecastIssuedAt: chosen,
      contextFrom: target.timestamps[0]!,
      contextTo,
    },
  };
}

/** Ore minime di storico continuo perché il modello avanzato possa partire (come il proxy). */
export const MIN_HISTORY_HOURS = 72;

export interface HistoryContext {
  /** ore consecutive, ordinate, in UTC */
  timestamps: string[];
  /** una riga per variabile; null = ora senza valore (mai riempita) */
  context: (number | null)[][];
  units: string[];
  /** ore senza valore per variabile */
  missing: number[];
  provenance: { source: 'open_meteo'; from: string; to: string; hours: number };
}

/**
 * Contesto multivariato per Timestral dallo storico Open-Meteo salvato su Supabase
 * (weather_observations): ore ordinate e consecutive fino all'ultima ora con TUTTE le variabili,
 * valori finiti, una sola unità per variabile, lacune lasciate vuote (nessuna interpolazione).
 * Errore se lo storico continuo è sotto il minimo: il modello avanzato non parte.
 */
export function buildHistoryContext(rows: ObservationRow[], variables: string[], opts: { maxHours?: number; before?: string; minHours?: number } = {}): HistoryContext {
  const errors: string[] = [];
  const byVar = new Map<string, Map<number, number>>();
  const units: string[] = [];
  for (const v of variables) {
    const own = rows.filter((r) => r.variable === v && r.source === 'open_meteo' && (!opts.before || Date.parse(r.observed_at) < Date.parse(opts.before)));
    const u = [...new Set(own.map((r) => r.unit))];
    if (own.length === 0) errors.push(`${v}: nessuno storico registrato`);
    else if (u.length > 1) errors.push(`${v}: unità non coerenti (${u.join(', ')})`);
    units.push(u[0] ?? '');
    const m = new Map<number, number>();
    for (const r of own) {
      const t = Date.parse(r.observed_at);
      if (!Number.isFinite(t) || !Number.isFinite(r.value)) continue;
      m.set(Math.floor(t / 3_600_000) * 3_600_000, r.value);
    }
    byVar.set(v, m);
  }
  if (errors.length) throw new ForecastInputError(errors);
  // ultima ora con tutte le variabili presenti
  const common = [...byVar.get(variables[0]!)!.keys()].filter((t) => variables.every((v) => byVar.get(v)!.has(t))).sort((a, b) => a - b);
  if (common.length === 0) throw new ForecastInputError(['Nessuna ora con tutte le variabili richieste.']);
  const last = common.at(-1)!;
  const first = Math.min(...variables.map((v) => Math.min(...byVar.get(v)!.keys())));
  const n = Math.min(Math.floor((last - first) / 3_600_000) + 1, opts.maxHours ?? 24 * 28);
  const timestamps = Array.from({ length: n }, (_, i) => new Date(last - (n - 1 - i) * 3_600_000).toISOString());
  const context = variables.map((v) => timestamps.map((t) => byVar.get(v)!.get(Date.parse(t)) ?? null));
  // ore continue che terminano all'ultima ora: tutte le variabili presenti
  let continuous = 0;
  for (let i = n - 1; i >= 0 && context.every((row) => row[i] !== null); i--) continuous++;
  const min = opts.minHours ?? MIN_HISTORY_HOURS;
  if (continuous < min) throw new ForecastInputError([`Storico continuo di ${continuous} ore: servono almeno ${min} ore per il modello avanzato.`]);
  return {
    timestamps,
    context,
    units,
    missing: context.map((row) => row.filter((x) => x === null).length),
    provenance: { source: 'open_meteo', from: timestamps[0]!, to: timestamps.at(-1)!, hours: n },
  };
}
