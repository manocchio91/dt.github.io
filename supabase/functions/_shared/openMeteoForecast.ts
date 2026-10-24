/**
 * Open-Meteo Forecast API per l'acquisizione ufficiale (Edge Function open-meteo-ingest).
 * Modulo senza dipendenze: è copiato in supabase/functions/_shared da `npm run sync:functions`
 * e usato identico dal dominio, dai test e dalla funzione Deno.
 *
 * I valori sono STIME MODELLISTICHE riferite alla cella di griglia del modello:
 * "Dato territoriale modellato, non rilevato da sensore locale".
 */

export const OM_FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
export const OM_ATTRIBUTION = 'Weather data by Open-Meteo.com (CC BY 4.0); modelli dei servizi meteorologici nazionali e ECMWF; suolo e rianalisi: Copernicus Climate Change Service (ERA5/ERA5-Land).';
export const OM_DEFAULT_MODEL = 'best_match';

export type WeatherScope = 'urban' | 'agricultural';

export const COMMON_HOURLY = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'precipitation',
  'precipitation_probability',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'shortwave_radiation',
] as const;

export const SOIL_TEMPERATURE = ['soil_temperature_0cm', 'soil_temperature_6cm', 'soil_temperature_18cm', 'soil_temperature_54cm'] as const;
export const SOIL_MOISTURE = ['soil_moisture_0_to_1cm', 'soil_moisture_1_to_3cm', 'soil_moisture_3_to_9cm', 'soil_moisture_9_to_27cm', 'soil_moisture_27_to_81cm'] as const;
export const AGRI_HOURLY = ['et0_fao_evapotranspiration', 'vapour_pressure_deficit', ...SOIL_TEMPERATURE, ...SOIL_MOISTURE] as const;

export type HourlyVariable = (typeof COMMON_HOURLY)[number] | (typeof AGRI_HOURLY)[number];

/** Unità attese (la richiesta impone wind_speed_unit=ms). Una risposta con unità diverse è rifiutata. */
export const EXPECTED_UNITS: Record<HourlyVariable, string> = {
  temperature_2m: '°C',
  relative_humidity_2m: '%',
  apparent_temperature: '°C',
  precipitation: 'mm',
  precipitation_probability: '%',
  wind_speed_10m: 'm/s',
  wind_direction_10m: '°',
  wind_gusts_10m: 'm/s',
  shortwave_radiation: 'W/m²',
  et0_fao_evapotranspiration: 'mm',
  vapour_pressure_deficit: 'kPa',
  soil_temperature_0cm: '°C',
  soil_temperature_6cm: '°C',
  soil_temperature_18cm: '°C',
  soil_temperature_54cm: '°C',
  soil_moisture_0_to_1cm: 'm³/m³',
  soil_moisture_1_to_3cm: 'm³/m³',
  soil_moisture_3_to_9cm: 'm³/m³',
  soil_moisture_9_to_27cm: 'm³/m³',
  soil_moisture_27_to_81cm: 'm³/m³',
};

/** Intervalli fisicamente plausibili: fuori intervallo il valore diventa mancante con avviso. */
const PLAUSIBLE: Partial<Record<HourlyVariable, [number, number]>> = {
  temperature_2m: [-60, 60],
  apparent_temperature: [-80, 70],
  relative_humidity_2m: [0, 100],
  precipitation: [0, 500],
  precipitation_probability: [0, 100],
  wind_speed_10m: [0, 120],
  wind_direction_10m: [0, 360],
  wind_gusts_10m: [0, 150],
  shortwave_radiation: [0, 1500],
  et0_fao_evapotranspiration: [0, 30],
  vapour_pressure_deficit: [0, 15],
  soil_moisture_0_to_1cm: [0, 1],
  soil_moisture_1_to_3cm: [0, 1],
  soil_moisture_3_to_9cm: [0, 1],
  soil_moisture_9_to_27cm: [0, 1],
  soil_moisture_27_to_81cm: [0, 1],
};

/** Variabili obbligatorie: senza di esse la risposta è incompleta e l'acquisizione fallisce. */
const REQUIRED: readonly HourlyVariable[] = ['temperature_2m', 'relative_humidity_2m', 'precipitation', 'wind_speed_10m', 'shortwave_radiation'];

export function hourlyVariables(scope: WeatherScope): HourlyVariable[] {
  return scope === 'agricultural' ? [...COMMON_HOURLY, ...AGRI_HOURLY] : [...COMMON_HOURLY];
}

export type OpenMeteoErrorCode = 'PARAMETRI' | 'TIMEOUT' | 'RETE' | 'HTTP' | 'LIMITE' | 'FORMATO' | 'DATI_ASSENTI';

export class OpenMeteoError extends Error {
  readonly code: OpenMeteoErrorCode;
  readonly retryable: boolean;
  constructor(code: OpenMeteoErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'OpenMeteoError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface WeatherLocationInput {
  id: string;
  latitude: number;
  longitude: number;
  scope: WeatherScope;
}

export function validateCoordinates(lat: unknown, lon: unknown): string | null {
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return 'Latitudine non valida.';
  if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) return 'Longitudine non valida.';
  if (lat === 0 && lon === 0) return 'Coordinate 0,0: probabilmente non impostate.';
  return null;
}

export interface ForecastRequestOptions {
  forecastDays?: number;
  pastDays?: number;
  model?: string;
}

export function buildIngestUrl(loc: WeatherLocationInput, o: ForecastRequestOptions = {}): string {
  const err = validateCoordinates(loc.latitude, loc.longitude);
  if (err) throw new OpenMeteoError('PARAMETRI', err);
  const params = new URLSearchParams({
    latitude: loc.latitude.toFixed(5),
    longitude: loc.longitude.toFixed(5),
    hourly: hourlyVariables(loc.scope).join(','),
    timezone: 'Europe/Rome',
    // istanti assoluti (secondi UTC): nessuna ambiguità al cambio dell'ora legale
    timeformat: 'unixtime',
    wind_speed_unit: 'ms',
    forecast_days: String(o.forecastDays ?? 4),
    past_days: String(o.pastDays ?? 1),
    models: o.model ?? OM_DEFAULT_MODEL,
  });
  return `${OM_FORECAST_ENDPOINT}?${params.toString()}`;
}

export interface FetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** tentativi aggiuntivi dopo il primo, solo per errori temporanei */
  retries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** GET con timeout e pochi tentativi (rete, timeout, 5xx, 429). Gli errori 4xx non si ripetono. */
export async function fetchForecastJson(url: string, o: FetchOptions = {}): Promise<{ body: unknown; attempts: number }> {
  const fetchImpl = o.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const retries = Math.min(o.retries ?? 2, 3);
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: OpenMeteoError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep((o.baseDelayMs ?? 500) * 2 ** (attempt - 1));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 10_000);
    try {
      const res = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      if (!res.ok) {
        let reason = '';
        try {
          reason = String(((await res.json()) as { reason?: unknown }).reason ?? '');
        } catch {
          /* corpo non JSON */
        }
        const msg = `Open-Meteo ha risposto ${res.status}${reason ? `: ${reason.slice(0, 200)}` : ''}`;
        if (res.status === 429) last = new OpenMeteoError('LIMITE', msg, true);
        else if (res.status >= 500) last = new OpenMeteoError('HTTP', msg, true);
        else throw new OpenMeteoError('HTTP', msg, false);
        continue;
      }
      try {
        return { body: await res.json(), attempts: attempt + 1 };
      } catch {
        throw new OpenMeteoError('FORMATO', 'Risposta non in formato JSON.');
      }
    } catch (e) {
      if (e instanceof OpenMeteoError) {
        if (!e.retryable) throw e;
        last = e;
      } else if ((e as { name?: string }).name === 'AbortError') last = new OpenMeteoError('TIMEOUT', 'Tempo di risposta di Open-Meteo scaduto.', true);
      else last = new OpenMeteoError('RETE', 'Open-Meteo non raggiungibile.', true);
    } finally {
      clearTimeout(timer);
    }
  }
  throw last ?? new OpenMeteoError('RETE', 'Open-Meteo non raggiungibile.', true);
}

export interface ForecastHour {
  validAt: string;
  values: Partial<Record<HourlyVariable, number | null>>;
}

export interface ParsedForecast {
  grid: { latitude: number; longitude: number; elevation: number | null };
  generationTimeMs: number | null;
  timezone: string | null;
  units: Partial<Record<HourlyVariable, string>>;
  variables: HourlyVariable[];
  hours: ForecastHour[];
  warnings: string[];
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function toIso(t: unknown, utcOffsetSeconds: number): string {
  if (typeof t === 'number' && Number.isFinite(t)) return new Date(t * 1000).toISOString();
  if (typeof t === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) {
    // formato locale (senza timeformat=unixtime): si converte con lo scostamento dichiarato
    return new Date(Date.parse(`${t}:00Z`) - utcOffsetSeconds * 1000).toISOString();
  }
  throw new OpenMeteoError('FORMATO', `Istante non valido nella risposta: ${String(t).slice(0, 30)}`);
}

/** Valida e normalizza la risposta (forma, unità, istanti, intervalli plausibili). */
export function parseForecastResponse(body: unknown, scope: WeatherScope): ParsedForecast {
  if (!isObj(body)) throw new OpenMeteoError('FORMATO', 'Risposta non valida: oggetto atteso.');
  if (body.error === true) throw new OpenMeteoError('HTTP', `Open-Meteo: ${String(body.reason ?? 'errore')}`);
  const lat = body.latitude;
  const lon = body.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number' || validateCoordinates(lat, lon)) throw new OpenMeteoError('FORMATO', 'Coordinate della cella assenti o non valide.');
  const hourly = body.hourly;
  const unitsIn = isObj(body.hourly_units) ? body.hourly_units : {};
  if (!isObj(hourly) || !Array.isArray(hourly.time) || hourly.time.length === 0) throw new OpenMeteoError('DATI_ASSENTI', 'Nessuna serie oraria nella risposta.');
  const offset = typeof body.utc_offset_seconds === 'number' ? body.utc_offset_seconds : 0;
  const times = (hourly.time as unknown[]).map((t) => toIso(t, offset));
  for (let i = 1; i < times.length; i++) {
    if (Date.parse(times[i]!) - Date.parse(times[i - 1]!) !== 3_600_000) throw new OpenMeteoError('FORMATO', 'Serie oraria non regolare.');
  }
  const warnings: string[] = [];
  const units: ParsedForecast['units'] = {};
  const variables: HourlyVariable[] = [];
  const columns: Partial<Record<HourlyVariable, (number | null)[]>> = {};
  for (const v of hourlyVariables(scope)) {
    const col = hourly[v];
    if (col === undefined) {
      if (REQUIRED.includes(v)) throw new OpenMeteoError('DATI_ASSENTI', `Variabile obbligatoria assente: ${v}.`);
      warnings.push(`${v}: non disponibile per questa cella o modello`);
      continue;
    }
    if (!Array.isArray(col) || col.length !== times.length) throw new OpenMeteoError('FORMATO', `Serie ${v} di lunghezza diversa dagli istanti.`);
    const unit = unitsIn[v];
    if (unit !== EXPECTED_UNITS[v]) throw new OpenMeteoError('FORMATO', `Unità inattesa per ${v}: ${String(unit)} (attesa ${EXPECTED_UNITS[v]}).`);
    const range = PLAUSIBLE[v];
    let dropped = 0;
    columns[v] = col.map((x) => {
      if (x === null) return null;
      if (typeof x !== 'number' || !Number.isFinite(x)) {
        dropped++;
        return null;
      }
      if (range && (x < range[0] || x > range[1])) {
        dropped++;
        return null;
      }
      return x;
    });
    if (dropped) warnings.push(`${v}: ${dropped} valori non plausibili scartati`);
    if (columns[v]!.every((x) => x === null)) warnings.push(`${v}: tutti i valori mancanti`);
    units[v] = unit;
    variables.push(v);
  }
  return {
    grid: { latitude: lat, longitude: lon, elevation: typeof body.elevation === 'number' ? body.elevation : null },
    generationTimeMs: typeof body.generationtime_ms === 'number' ? body.generationtime_ms : null,
    timezone: typeof body.timezone === 'string' ? body.timezone : null,
    units,
    variables,
    hours: times.map((validAt, i) => ({ validAt, values: Object.fromEntries(variables.map((v) => [v, columns[v]![i] ?? null])) })),
    warnings,
  };
}

/** Ora di emissione: inizio dell'ora UTC dell'acquisizione (Open-Meteo non restituisce l'ora del run del modello). */
export function issuedHour(d: Date): string {
  const t = new Date(d.getTime());
  t.setUTCMinutes(0, 0, 0);
  return t.toISOString();
}

/** Ore future (valid_at ≥ emissione) → previsioni; ore passate → analisi registrate come osservazioni modellate. */
export function splitAtIssue(p: ParsedForecast, issuedAt: string): { forecast: ForecastHour[]; past: ForecastHour[] } {
  const t = Date.parse(issuedAt);
  return { forecast: p.hours.filter((h) => Date.parse(h.validAt) >= t), past: p.hours.filter((h) => Date.parse(h.validAt) < t) };
}

/** Variabili delle ore passate conservate come storico (base per backtest e per Timestral). */
export const HISTORY_VARIABLES: Record<WeatherScope, HourlyVariable[]> = {
  urban: ['temperature_2m', 'relative_humidity_2m', 'precipitation', 'wind_speed_10m', 'shortwave_radiation'],
  agricultural: ['temperature_2m', 'relative_humidity_2m', 'precipitation', 'shortwave_radiation', 'et0_fao_evapotranspiration', 'soil_temperature_6cm', 'soil_moisture_9_to_27cm'],
};

export function toPointRows(hours: ForecastHour[]): ({ valid_at: string } & Partial<Record<HourlyVariable, number | null>>)[] {
  return hours.map((h) => ({ valid_at: h.validAt, ...h.values }));
}

export function toObservationRows(p: ParsedForecast, past: ForecastHour[], scope: WeatherScope): { observed_at: string; variable: string; value: number; unit: string }[] {
  const out: { observed_at: string; variable: string; value: number; unit: string }[] = [];
  for (const h of past) {
    for (const v of HISTORY_VARIABLES[scope]) {
      const x = h.values[v];
      if (typeof x === 'number' && p.units[v]) out.push({ observed_at: h.validAt, variable: v, value: x, unit: p.units[v]! });
    }
  }
  return out;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Chiave di idempotenza: stessa località, coordinate, ambito, modello e ora di emissione. */
export function ingestRequestHash(loc: WeatherLocationInput, model: string, issuedAt: string): Promise<string> {
  return sha256Hex(JSON.stringify({ id: loc.id, lat: loc.latitude.toFixed(5), lon: loc.longitude.toFixed(5), scope: loc.scope, model, vars: hourlyVariables(loc.scope), issuedAt }));
}

/** Dato non aggiornato: ultima emissione più vecchia della soglia (default 6 h, due cicli da 3 h). */
export function isStale(issuedAt: string | null | undefined, now: Date, maxAgeHours = 6): boolean {
  if (!issuedAt) return true;
  return now.getTime() - Date.parse(issuedAt) > maxAgeHours * 3_600_000;
}
