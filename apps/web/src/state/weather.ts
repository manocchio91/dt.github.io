import type { SupabaseClient } from '@supabase/supabase-js';
import type { WeatherScope } from '@mdt/domain';

/**
 * Lettura dei dati meteo acquisiti dalla Edge Function open-meteo-ingest.
 * Il frontend NON chiama Open-Meteo per l'acquisizione ufficiale: legge solo ciò che il
 * servizio ha registrato (RLS per organizzazione) e può chiedere un aggiornamento manuale.
 */
export interface WeatherLocation {
  id: string;
  organization_id: string;
  project_id: string;
  name: string;
  scope: WeatherScope;
  latitude: number;
  longitude: number;
  elevation: number | null;
  active: boolean;
}

export interface WeatherRun {
  id: string;
  status: 'in_corso' | 'completata' | 'errore';
  trigger: 'pianificata' | 'manuale';
  requested_at: string;
  completed_at: string | null;
  model_requested: string;
  model_returned: string | null;
  response_grid_latitude: number | null;
  response_grid_longitude: number | null;
  response_elevation: number | null;
  issued_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
  points_count: number;
  error_code: string | null;
  error_message: string | null;
}

export type WeatherPoint = { valid_at: string; issued_at: string; model: string; unit_metadata: Record<string, string> } & Record<string, number | string | null | Record<string, string>>;

export interface SensorObservation {
  observed_at: string;
  variable: string;
  value: number;
  unit: string;
  source: string;
  quality_flag: string;
}

export interface WeatherSnapshot {
  location: WeatherLocation;
  run: WeatherRun | null;
  lastAttempt: WeatherRun | null;
  points: WeatherPoint[];
  sensors: SensorObservation[];
  lastManualAt: string | null;
}

export class WeatherRefreshError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const MANUAL_COOLDOWN_MS = 10 * 60_000;

type Client = Pick<SupabaseClient, 'from' | 'functions'>;

const check = <T>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

export async function listLocations(client: Client, projectId: string): Promise<WeatherLocation[]> {
  return check(await client.from('weather_locations').select('*').eq('project_id', projectId).eq('active', true).order('created_at')) as WeatherLocation[];
}

export async function createLocation(client: Client, l: Omit<WeatherLocation, 'id' | 'active'>): Promise<WeatherLocation> {
  return check(await client.from('weather_locations').insert(l).select('*').single()) as WeatherLocation;
}

export async function loadSnapshot(client: Client, location: WeatherLocation): Promise<WeatherSnapshot> {
  const runs = check(await client.from('weather_fetch_runs').select('*').eq('location_id', location.id).order('requested_at', { ascending: false }).limit(20)) as WeatherRun[];
  const run = runs.find((r) => r.status === 'completata') ?? null;
  const points = run ? (check(await client.from('weather_forecast_points').select('*').eq('fetch_run_id', run.id).order('valid_at').limit(200)) as WeatherPoint[]) : [];
  const sensors = check(await client.from('weather_observations').select('observed_at, variable, value, unit, source, quality_flag').eq('location_id', location.id).eq('source', 'sensore').order('observed_at', { ascending: false }).limit(20)) as SensorObservation[];
  return { location, run, lastAttempt: runs[0] ?? null, points, sensors, lastManualAt: runs.find((r) => r.trigger === 'manuale')?.requested_at ?? null };
}

/** Aggiornamento manuale tramite la Edge Function (autorizzazione e limite applicati dal server). */
export async function requestRefresh(client: Client, locationId: string): Promise<{ status: string; points: number }> {
  const { data, error } = await client.functions.invoke('open-meteo-ingest', { body: { location_id: locationId } });
  if (error) {
    const ctx = (error as { context?: { status?: number; json?: () => Promise<{ error?: string }> } }).context;
    const status = ctx?.status ?? 0;
    let msg = '';
    try {
      msg = (await ctx?.json?.())?.error ?? '';
    } catch {
      /* corpo non JSON */
    }
    throw new WeatherRefreshError(msg || (status === 0 ? 'Servizio non raggiungibile.' : `Errore ${status}.`), status);
  }
  return data as { status: string; points: number };
}

export const WEATHER_LABEL: Record<string, string> = {
  temperature_2m: 'Temperatura aria (2 m)',
  apparent_temperature: 'Temperatura percepita',
  relative_humidity_2m: 'Umidità relativa',
  precipitation: 'Precipitazioni',
  precipitation_probability: 'Probabilità di precipitazione',
  wind_speed_10m: 'Vento (10 m)',
  wind_direction_10m: 'Direzione del vento',
  wind_gusts_10m: 'Raffiche',
  shortwave_radiation: 'Radiazione solare',
  et0_fao_evapotranspiration: 'ET0 (FAO)',
  vapour_pressure_deficit: 'VPD',
  soil_temperature_0cm: 'T suolo 0 cm',
  soil_temperature_6cm: 'T suolo 6 cm',
  soil_temperature_18cm: 'T suolo 18 cm',
  soil_temperature_54cm: 'T suolo 54 cm',
  soil_moisture_0_to_1cm: 'Umidità suolo 0–1 cm',
  soil_moisture_1_to_3cm: 'Umidità suolo 1–3 cm',
  soil_moisture_3_to_9cm: 'Umidità suolo 3–9 cm',
  soil_moisture_9_to_27cm: 'Umidità suolo 9–27 cm',
  soil_moisture_27_to_81cm: 'Umidità suolo 27–81 cm',
};

/**
 * Input per Timestral dallo storico registrato (28 giorni) e dall'ultima previsione Open-Meteo.
 * Prepara la richiesta: l'esecuzione resta del servizio Timestral (oggi non configurato).
 */
export async function loadTimestralInput(client: Client, locationId: string, target: string, horizon: number) {
  const { buildTimestralRequestFromWeather } = await import('@mdt/domain');
  const since = new Date(Date.now() - 28 * 86_400_000).toISOString();
  const observations = check(await client.from('weather_observations').select('observed_at, variable, value, unit, source').eq('location_id', locationId).eq('variable', target).gte('observed_at', since).order('observed_at').limit(5000));
  const runs = check(await client.from('weather_fetch_runs').select('id').eq('location_id', locationId).eq('status', 'completata').order('issued_at', { ascending: false }).limit(1)) as { id: string }[];
  const forecastPoints = runs[0] ? check(await client.from('weather_forecast_points').select('*').eq('fetch_run_id', runs[0].id).order('valid_at')) : [];
  return buildTimestralRequestFromWeather({ target, observations: observations as never, forecastPoints: forecastPoints as never, horizon });
}
