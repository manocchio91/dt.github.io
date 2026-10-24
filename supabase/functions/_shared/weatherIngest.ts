// Logica dell'Edge Function open-meteo-ingest, indipendente da Deno: testata su PGlite
// (supabase/tests/weather.test.ts) con fetch simulato e fixture reali di Open-Meteo.
import {
  buildIngestUrl,
  fetchForecastJson,
  ingestRequestHash,
  issuedHour,
  OM_DEFAULT_MODEL,
  OpenMeteoError,
  parseForecastResponse,
  splitAtIssue,
  toObservationRows,
  toPointRows,
  validateCoordinates,
  type FetchOptions,
  type WeatherScope,
} from './openMeteoForecast.ts';

type Res = { data: unknown; error: { message: string; code?: string } | null };
interface Query extends PromiseLike<Res> {
  select(cols?: string): Query;
  eq(col: string, val: unknown): Query;
  maybeSingle(): Query;
}
export interface IngestClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<Res>;
  from(table: string): Query;
}

export class IngestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'IngestError';
    this.status = status;
    this.code = code;
  }
}

export interface IngestSummary {
  location_id: string;
  run_id: string | null;
  status: 'completata' | 'errore' | 'gia_acquisita';
  trigger: 'pianificata' | 'manuale';
  issued_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
  points: number;
  observations: number;
  grid: { latitude: number; longitude: number; elevation: number | null } | null;
  model: string;
  warnings: string[];
  error?: { code: string; message: string };
}

export interface IngestOptions {
  trigger: 'pianificata' | 'manuale';
  requestedBy?: string | null;
  now?: Date;
  model?: string;
  fetch?: FetchOptions;
  /** solo log tecnici: id, esito, conteggi (mai dati personali) */
  log?: (msg: string) => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Aggiornamento manuale: il token dell'utente deve avere ruolo "modifica" e rispettare il limite di frequenza. */
export async function authorizeManual(user: IngestClient, locationId: string): Promise<string> {
  if (!UUID.test(locationId)) throw new IngestError(400, 'PARAMETRI', 'location_id non valido');
  const { data, error } = await user.rpc('weather_authorize_manual', { p_location: locationId });
  if (error) {
    const status = error.code === 'P0429' ? 429 : error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : error.code === '55000' ? 409 : 403;
    throw new IngestError(status, status === 429 ? 'LIMITE' : 'AUTORIZZAZIONE', error.message);
  }
  return String((data as { user_id: string }).user_id);
}

export async function ingestLocation(admin: IngestClient, locationId: string, o: IngestOptions): Promise<IngestSummary> {
  const log = o.log ?? (() => {});
  if (!UUID.test(locationId)) throw new IngestError(400, 'PARAMETRI', 'location_id non valido');
  const model = o.model ?? OM_DEFAULT_MODEL;
  const loc = await admin.from('weather_locations').select('id, latitude, longitude, scope, active').eq('id', locationId).maybeSingle();
  if (loc.error) throw new IngestError(500, 'DATABASE', loc.error.message);
  const l = loc.data as { id: string; latitude: number; longitude: number; scope: WeatherScope; active: boolean } | null;
  if (!l) throw new IngestError(404, 'PARAMETRI', 'Località non trovata');
  if (!l.active) throw new IngestError(409, 'PARAMETRI', 'Località disattivata');
  const coordErr = validateCoordinates(l.latitude, l.longitude);
  if (coordErr) throw new IngestError(422, 'PARAMETRI', coordErr);

  const issuedAt = issuedHour(o.now ?? new Date());
  const hash = await ingestRequestHash(l, model, issuedAt);
  const begin = await admin.rpc('weather_begin_fetch', { p_location: l.id, p_request_hash: hash, p_trigger: o.trigger, p_model: model, p_requested_by: o.requestedBy ?? null });
  if (begin.error) throw new IngestError(begin.error.code === '55000' ? 409 : 500, 'DATABASE', begin.error.message);
  const b = begin.data as { duplicate: boolean; run: Record<string, unknown> };
  const base = { location_id: l.id, trigger: o.trigger, model, warnings: [] as string[] };
  if (b.duplicate) {
    const r = b.run;
    log(`open-meteo-ingest location=${l.id} esito=gia_acquisita run=${String(r.id)}`);
    return {
      ...base,
      run_id: String(r.id),
      status: 'gia_acquisita',
      issued_at: (r.issued_at as string) ?? issuedAt,
      valid_from: (r.valid_from as string) ?? null,
      valid_to: (r.valid_to as string) ?? null,
      points: Number(r.points_count ?? 0),
      observations: 0,
      grid: r.response_grid_latitude == null ? null : { latitude: Number(r.response_grid_latitude), longitude: Number(r.response_grid_longitude), elevation: r.response_elevation == null ? null : Number(r.response_elevation) },
    };
  }
  const runId = String(b.run.id);
  try {
    const { body, attempts } = await fetchForecastJson(buildIngestUrl(l, { model }), o.fetch);
    const parsed = parseForecastResponse(body, l.scope);
    const { forecast, past } = splitAtIssue(parsed, issuedAt);
    if (forecast.length === 0) throw new OpenMeteoError('DATI_ASSENTI', 'Nessuna ora futura nella risposta.');
    const meta = {
      issued_at: issuedAt,
      model,
      // Open-Meteo non dichiara quale modello sottostante ha scelto con best_match
      model_returned: model === OM_DEFAULT_MODEL ? null : model,
      grid_latitude: parsed.grid.latitude,
      grid_longitude: parsed.grid.longitude,
      elevation: parsed.grid.elevation,
      generation_time_ms: parsed.generationTimeMs,
      valid_from: forecast[0]!.validAt,
      valid_to: forecast.at(-1)!.validAt,
      units: { ...parsed.units, timezone: parsed.timezone, fetched_at: (o.now ?? new Date()).toISOString(), endpoint: 'api.open-meteo.com/v1/forecast' },
    };
    const done = await admin.rpc('weather_complete_fetch', { p_run: runId, p_meta: meta, p_points: toPointRows(forecast), p_observations: toObservationRows(parsed, past, l.scope) });
    if (done.error) throw new IngestError(500, 'DATABASE', done.error.message);
    const counts = done.data as { points: number; observations: number };
    log(`open-meteo-ingest location=${l.id} esito=completata run=${runId} punti=${counts.points} tentativi=${attempts}`);
    return {
      ...base,
      run_id: runId,
      status: 'completata',
      issued_at: issuedAt,
      valid_from: meta.valid_from,
      valid_to: meta.valid_to,
      points: counts.points,
      observations: counts.observations,
      grid: parsed.grid,
      warnings: parsed.warnings,
    };
  } catch (e) {
    const code = e instanceof OpenMeteoError ? e.code : e instanceof IngestError ? e.code : 'INTERNO';
    const message = (e as Error).message.slice(0, 300);
    // l'errore chiude solo questa acquisizione: i dati validi precedenti restano
    await admin.rpc('weather_fail_fetch', { p_run: runId, p_code: code, p_message: message });
    log(`open-meteo-ingest location=${l.id} esito=errore run=${runId} codice=${code}`);
    return { ...base, run_id: runId, status: 'errore', issued_at: issuedAt, valid_from: null, valid_to: null, points: 0, observations: 0, grid: null, error: { code, message } };
  }
}

/** Job pianificato: tutte le località attive, una alla volta; l'errore di una non ferma le altre. */
export async function ingestAllActive(admin: IngestClient, o: Omit<IngestOptions, 'trigger'> & { maxLocations?: number }): Promise<IngestSummary[]> {
  const { data, error } = await admin.rpc('weather_active_locations', {});
  if (error) throw new IngestError(500, 'DATABASE', error.message);
  const ids = ((data as string[] | null) ?? []).slice(0, o.maxLocations ?? 200);
  const out: IngestSummary[] = [];
  for (const id of ids) {
    try {
      out.push(await ingestLocation(admin, id, { ...o, trigger: 'pianificata' }));
    } catch (e) {
      const err = e instanceof IngestError ? e : new IngestError(500, 'INTERNO', (e as Error).message);
      out.push({ location_id: id, run_id: null, status: 'errore', trigger: 'pianificata', issued_at: null, valid_from: null, valid_to: null, points: 0, observations: 0, grid: null, model: o.model ?? OM_DEFAULT_MODEL, warnings: [], error: { code: err.code, message: err.message } });
    }
  }
  return out;
}
