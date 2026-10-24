import { dataValue, missingValue, type DataValue, type Lineage } from '../data/dataValue';
import type { AgriWeather } from '../agri/agriDemo';

/**
 * Connettore Open-Meteo. I valori sono STIME/PREVISIONI MODELLISTICHE riferite
 * alla cella di griglia del modello, mai misure di un sensore sul posto.
 * In caso di errore restituisce ok:false: nessun valore di riserva fittizio.
 */

export type ConnectorErrorCode = 'PARAMETRI' | 'TIMEOUT' | 'RETE' | 'HTTP' | 'FORMATO' | 'DATI_ASSENTI';

export interface ConnectorError {
  code: ConnectorErrorCode;
  message: string;
  endpoint: string;
  at: string;
}

export type Result<T> = { ok: true; value: T; fromCache: boolean } | { ok: false; error: ConnectorError };

export interface ConnectorOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: Date;
  cache?: Map<string, { at: number; body: unknown }>;
  cacheTtlMs?: number;
}

export const OPEN_METEO_LICENSE = 'CC BY 4.0 — Open-Meteo.com (dati da servizi meteorologici nazionali e rianalisi ECMWF/ERA5)';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const defaultCache = new Map<string, { at: number; body: unknown }>();

async function getJson(url: string, o: ConnectorOptions): Promise<Result<unknown>> {
  const now = o.now ?? new Date();
  const cache = o.cache ?? defaultCache;
  const ttl = o.cacheTtlMs ?? 6 * 3_600_000;
  const hit = cache.get(url);
  if (hit && now.getTime() - hit.at < ttl) return { ok: true, value: hit.body, fromCache: true };

  const fetchImpl = o.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? 12_000);
  const fail = (code: ConnectorErrorCode, message: string): Result<unknown> => ({
    ok: false,
    error: { code, message, endpoint: url.split('?')[0]!, at: now.toISOString() },
  });
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) {
      let reason = '';
      try {
        reason = ((await res.json()) as { reason?: string }).reason ?? '';
      } catch {
        /* corpo non JSON */
      }
      return fail('HTTP', `Il servizio ha risposto ${res.status}${reason ? `: ${reason}` : ''}.`);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return fail('FORMATO', 'Risposta non in formato JSON.');
    }
    cache.set(url, { at: now.getTime(), body });
    return { ok: true, value: body, fromCache: false };
  } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') return fail('TIMEOUT', 'Tempo di risposta scaduto.');
    return fail('RETE', 'Servizio non raggiungibile (rete assente o bloccata).');
  } finally {
    clearTimeout(timer);
  }
}

interface OmResponse {
  latitude: number;
  longitude: number;
  elevation?: number;
  hourly?: Record<string, (number | null)[] | string[]> & { time: string[] };
  daily?: Record<string, (number | null)[] | string[]> & { time: string[] };
}

function isOm(x: unknown): x is OmResponse {
  return !!x && typeof x === 'object' && typeof (x as OmResponse).latitude === 'number';
}

function mean(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export interface UrbanWeatherRequest {
  lat: number;
  lon: number;
  start: string;
  end: string;
  referenceHourLocal: number;
}

export interface UrbanWeatherResult {
  values: DataValue[];
  gridLat: number;
  gridLon: number;
  hoursUsed: number;
  url: string;
}

export function buildArchiveUrl(r: UrbanWeatherRequest): string {
  const p = new URLSearchParams({
    latitude: r.lat.toFixed(4),
    longitude: r.lon.toFixed(4),
    start_date: r.start,
    end_date: r.end,
    hourly: 'temperature_2m,relative_humidity_2m,wind_speed_10m,shortwave_radiation',
    daily: 'temperature_2m_max',
    timezone: 'Europe/Rome',
    wind_speed_unit: 'ms',
  });
  return `${ARCHIVE}?${p.toString()}`;
}

export async function fetchUrbanBaselineWeather(r: UrbanWeatherRequest, o: ConnectorOptions = {}): Promise<Result<UrbanWeatherResult>> {
  const now = o.now ?? new Date();
  const url = buildArchiveUrl(r);
  const paramErr = (message: string): Result<UrbanWeatherResult> => ({
    ok: false,
    error: { code: 'PARAMETRI', message, endpoint: ARCHIVE, at: now.toISOString() },
  });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.start) || !/^\d{4}-\d{2}-\d{2}$/.test(r.end) || r.start > r.end) {
    return paramErr('Periodo non valido.');
  }
  const latest = new Date(now.getTime() - 5 * 86_400_000).toISOString().slice(0, 10);
  if (r.end > latest) return paramErr(`L'archivio storico ha un ritardo di circa 5 giorni: scegli una data di fine ≤ ${latest}.`);
  if ((Date.parse(r.end) - Date.parse(r.start)) / 86_400_000 > 366) return paramErr('Periodo massimo: 1 anno.');

  const res = await getJson(url, o);
  if (!res.ok) return res;
  const body = res.value;
  if (!isOm(body) || !body.hourly?.time || !body.daily?.time) {
    return { ok: false, error: { code: 'FORMATO', message: 'Struttura della risposta inattesa.', endpoint: ARCHIVE, at: now.toISOString() } };
  }
  const hh = String(r.referenceHourLocal).padStart(2, '0');
  const idx = body.hourly.time.map((t, i) => (t.slice(11, 13) === hh ? i : -1)).filter((i) => i >= 0);
  const col = (k: string) => (body.hourly![k] as (number | null)[] | undefined) ?? [];
  const pick = (k: string) => idx.map((i) => col(k)[i]);
  const tAir = mean(pick('temperature_2m'));
  if (tAir === null) {
    return { ok: false, error: { code: 'DATI_ASSENTI', message: 'Nessun valore di temperatura per il periodo richiesto.', endpoint: ARCHIVE, at: now.toISOString() } };
  }
  const lineage = (formula: string, extra: Partial<Lineage> = {}): Lineage => ({
    source: 'Open-Meteo Historical Weather API (rianalisi/modello)',
    endpoint: ARCHIVE,
    acquiredAt: now.toISOString(),
    license: OPEN_METEO_LICENSE,
    coordinates: { lat: body.latitude, lon: body.longitude },
    spatialResolution: 'cella di griglia del modello (indicativamente 9–25 km a seconda del dataset)',
    temporalResolution: 'oraria',
    transforms: [`selezione ore ${hh}:00 Europe/Rome dal ${r.start} al ${r.end}`, 'media aritmetica'],
    formula,
    quality: 'media',
    limitations: [
      'Stima modellistica riferita alle coordinate della cella di griglia: non è un sensore sul posto.',
      'Non risolve il microclima della singola piazza o strada (canyon urbano, ombre, materiali).',
    ],
    usage: 'Baseline meteo di riferimento per lo scenario.',
    isDemo: false,
    ...extra,
  });
  const values: DataValue[] = [
    dataValue({ key: 't_air_ref_hour', label: `Temperatura aria a 2 m, ore ${hh}:00 (media periodo)`, unit: '°C', value: r1(tAir), dataClass: 'STIMATO_DA_MODELLO', lineage: lineage('media(temperature_2m alle ore di riferimento)', { height: '2 m' }) }),
  ];
  const tMax = mean((body.daily.temperature_2m_max as (number | null)[] | undefined) ?? []);
  values.push(
    tMax === null
      ? missingValue('t_air_max_mean', 'Media delle temperature massime giornaliere', '°C', 'Assente nella risposta.')
      : dataValue({ key: 't_air_max_mean', label: 'Media delle temperature massime giornaliere', unit: '°C', value: r1(tMax), dataClass: 'STIMATO_DA_MODELLO', lineage: lineage('media(temperature_2m_max)', { temporalResolution: 'giornaliera', height: '2 m' }) }),
  );
  const rh = mean(pick('relative_humidity_2m'));
  values.push(
    rh === null
      ? missingValue('rh_ref_hour', 'Umidità relativa', '%', 'Assente nella risposta.')
      : dataValue({ key: 'rh_ref_hour', label: `Umidità relativa a 2 m, ore ${hh}:00`, unit: '%', value: Math.round(rh), dataClass: 'STIMATO_DA_MODELLO', lineage: lineage('media(relative_humidity_2m)', { height: '2 m' }) }),
  );
  const wind = mean(pick('wind_speed_10m'));
  values.push(
    wind === null
      ? missingValue('wind_10m_ref_hour', 'Vento a 10 m', 'm/s', 'Assente nella risposta.')
      : dataValue({ key: 'wind_10m_ref_hour', label: `Vento a 10 m, ore ${hh}:00`, unit: 'm/s', value: r1(wind), dataClass: 'STIMATO_DA_MODELLO', lineage: lineage('media(wind_speed_10m)', { height: '10 m (non quota pedone)' }) }),
  );
  const sw = mean(pick('shortwave_radiation'));
  values.push(
    sw === null
      ? missingValue('sw_radiation_ref_hour', 'Radiazione solare globale', 'W/m²', 'Assente nella risposta.')
      : dataValue({ key: 'sw_radiation_ref_hour', label: `Radiazione globale, ore ${hh}:00`, unit: 'W/m²', value: Math.round(sw / 10) * 10, dataClass: 'STIMATO_DA_MODELLO', lineage: lineage('media(shortwave_radiation), media dell’ora precedente') }),
  );
  values.push(
    missingValue(
      't_surface_ref_hour',
      'Temperatura superficiale',
      '°C',
      'Open-Meteo non fornisce la temperatura delle superfici urbane: serve un prodotto satellitare LST o misure (Roadmap F06).',
    ),
  );
  return { ok: true, fromCache: res.fromCache, value: { values, gridLat: body.latitude, gridLon: body.longitude, hoursUsed: idx.length, url } };
}

export interface AgriWeatherRequest {
  lat: number;
  lon: number;
  today: string;
}

export function buildForecastUrl(r: AgriWeatherRequest): string {
  const p = new URLSearchParams({
    latitude: r.lat.toFixed(4),
    longitude: r.lon.toFixed(4),
    daily: 'temperature_2m_max,precipitation_sum',
    hourly: 'soil_moisture_9_to_27cm',
    past_days: '14',
    forecast_days: '1',
    timezone: 'Europe/Rome',
  });
  return `${FORECAST}?${p.toString()}`;
}

export async function fetchAgriWeather(r: AgriWeatherRequest, o: ConnectorOptions = {}): Promise<Result<AgriWeather>> {
  const now = o.now ?? new Date();
  const url = buildForecastUrl(r);
  const res = await getJson(url, o);
  if (!res.ok) return res;
  const body = res.value;
  if (!isOm(body) || !body.daily?.time || !body.hourly?.time) {
    return { ok: false, error: { code: 'FORMATO', message: 'Struttura della risposta inattesa.', endpoint: FORECAST, at: now.toISOString() } };
  }
  const tmaxCol = (body.daily.temperature_2m_max as (number | null)[] | undefined) ?? [];
  const precCol = (body.daily.precipitation_sum as (number | null)[] | undefined) ?? [];
  const past = body.daily.time.map((d, i) => ({ d, i })).filter(({ d }) => d < r.today);
  const dailyTmax = past
    .map(({ d, i }) => ({ date: d, value: tmaxCol[i] }))
    .filter((x): x is { date: string; value: number } => typeof x.value === 'number');
  if (dailyTmax.length === 0) {
    return { ok: false, error: { code: 'DATI_ASSENTI', message: 'Nessuna temperatura massima nei giorni passati.', endpoint: FORECAST, at: now.toISOString() } };
  }
  const baseLineage: Lineage = {
    source: 'Open-Meteo Forecast API (modelli meteorologici, giorni passati)',
    endpoint: FORECAST,
    acquiredAt: now.toISOString(),
    license: OPEN_METEO_LICENSE,
    coordinates: { lat: body.latitude, lon: body.longitude },
    spatialResolution: 'cella di griglia del modello (km)',
    temporalResolution: 'giornaliera',
    transforms: ['ultimi 14 giorni prima di oggi'],
    quality: 'media',
    limitations: ['Stima modellistica riferita alle coordinate: non è una stazione nel vigneto.'],
    isDemo: false,
  };
  const smCol = (body.hourly.soil_moisture_9_to_27cm as (number | null)[] | undefined) ?? [];
  const smToday = mean(body.hourly.time.map((t, i) => (t.startsWith(r.today) ? smCol[i] : null)));
  const soilMoisture =
    smToday === null
      ? missingValue('soil_moisture', 'Umidità del suolo 9–27 cm', 'm³/m³', 'Assente nella risposta del modello.')
      : dataValue({
          key: 'soil_moisture',
          label: 'Umidità volumetrica del suolo 9–27 cm',
          unit: 'm³/m³',
          value: Math.round(smToday * 1000) / 1000,
          dataClass: 'STIMATO_DA_MODELLO',
          lineage: {
            ...baseLineage,
            depth: '9–27 cm',
            temporalResolution: 'oraria, media del giorno corrente',
            transforms: ['media delle ore del giorno corrente'],
            limitations: [
              "Stima riferita all'area, non misurata sul terreno.",
              'Il modello usa un suolo generico: non conosce tessitura e profondità reali della parcella.',
            ],
          },
        });
  const precSum = past.reduce((s, { i }) => s + (precCol[i] ?? 0), 0);
  return {
    ok: true,
    fromCache: res.fromCache,
    value: {
      dailyTmax,
      dailyTmaxClass: 'STIMATO_DA_MODELLO',
      dailyTmaxLineage: baseLineage,
      soilMoisture,
      precipitation14d: dataValue({
        key: 'precipitation_14d',
        label: 'Precipitazione cumulata 14 giorni',
        unit: 'mm',
        value: r1(precSum),
        dataClass: 'STIMATO_DA_MODELLO',
        lineage: { ...baseLineage, formula: 'Σ precipitation_sum' },
      }),
    },
  };
}
