import type { Route } from '@playwright/test';
import { parseForecastResponse, splitAtIssue, toPointRows, issuedHour } from '../packages/domain/src/index';
import urbanFixture from '../packages/domain/src/connectors/fixtures/open-meteo-forecast-urban.json' with { type: 'json' };

/**
 * Tabelle meteo e Edge Function open-meteo-ingest SIMULATE per gli E2E.
 * I valori sono quelli di una risposta reale Open-Meteo (fixture), con gli istanti spostati
 * all'ora corrente perché la schermata sia deterministica. Nessuna chiamata a Open-Meteo.
 */
export interface WeatherState {
  locations: Record<string, unknown>[];
  runs: Record<string, unknown>[];
  points: Record<string, unknown>[];
  observations: Record<string, unknown>[];
  invokes: { body: unknown; status: number }[];
  /** risposta simulata di weather_history_status per località */
  history: Record<string, Record<string, unknown>>;
}

/** Storico simulato di 7 giorni (168 ore) prima dell'emissione, come dopo il recupero iniziale del server. */
function pastHours(issued: string): Record<string, unknown>[] {
  const H = 3_600_000;
  return Array.from({ length: 168 }, (_, i) => new Date(Date.parse(issued) - (168 - i) * H).toISOString()).flatMap((t, i) => [
    { location_id: WEATHER_LOC, observed_at: t, variable: 'temperature_2m', value: 12 + 6 * Math.sin((2 * Math.PI * (i - 9)) / 24), unit: '°C', source: 'open_meteo', quality_flag: 'modellato' },
    { location_id: WEATHER_LOC, observed_at: t, variable: 'relative_humidity_2m', value: 75 - 15 * Math.sin((2 * Math.PI * (i - 9)) / 24), unit: '%', source: 'open_meteo', quality_flag: 'modellato' },
  ]);
}

/** Stato dello storico come lo calcola il server (migrazioni 0012–0013). */
export function historyStatus(over: Record<string, unknown> = {}): Record<string, unknown> {
  const last = new Date(Date.parse(issuedHour(new Date())) - 3_600_000).toISOString();
  return {
    stato: 'sufficiente', livello: 'disponibile', ore_obiettivo: 168, prima_ora: new Date(Date.parse(last) - 191 * 3_600_000).toISOString(), ultima_ora: last,
    ore_finestra: 168, ore_continue: 192, ore_future: 79, completezza_pct: 100, sufficiente_timestral: true, aggiornato: true, in_corso: false, buchi: [],
    variabili: ['relative_humidity_2m', 'temperature_2m'], ore_per_variabile: { relative_humidity_2m: 168, temperature_2m: 168 }, variabili_richieste_mancanti: [],
    ultimo_aggiornamento: new Date().toISOString(), ultimo_errore: null, ...over,
  };
}

export const WEATHER_LOC = '00000000-0000-4000-8000-00000000c1c1';

export function initialWeatherState(projectId: string, organizationId: string): WeatherState {
  const issued = issuedHour(new Date());
  const p = parseForecastResponse(urbanFixture, 'urban');
  const fixtureIssued = '2026-10-24T15:00:00.000Z';
  const shift = Date.parse(issued) - Date.parse(fixtureIssued);
  const points = toPointRows(splitAtIssue(p, fixtureIssued).forecast).map((r) => ({
    ...r,
    valid_at: new Date(Date.parse(r.valid_at as string) + shift).toISOString(),
    fetch_run_id: 'run-1',
    issued_at: issued,
    model: 'best_match',
    unit_metadata: p.units,
    source: 'open_meteo',
  }));
  return {
    locations: [{ id: WEATHER_LOC, organization_id: organizationId, project_id: projectId, name: 'Piazza', scope: 'urban', latitude: 41.5606, longitude: 14.663, elevation: null, active: true, created_at: issued }],
    runs: [
      {
        id: 'run-1',
        location_id: WEATHER_LOC,
        status: 'completata',
        trigger: 'pianificata',
        requested_at: new Date(Date.parse(issued) + 7 * 60_000).toISOString(),
        completed_at: new Date(Date.parse(issued) + 7 * 60_000 + 3000).toISOString(),
        model_requested: 'best_match',
        model_returned: null,
        response_grid_latitude: p.grid.latitude,
        response_grid_longitude: p.grid.longitude,
        response_elevation: p.grid.elevation,
        issued_at: issued,
        valid_from: points[0]!.valid_at,
        valid_to: points.at(-1)!.valid_at,
        points_count: points.length,
        error_code: null,
        error_message: null,
      },
    ],
    points,
    observations: pastHours(issued),
    invokes: [],
    history: { [WEATHER_LOC]: historyStatus() },
  };
}

const cors = { 'access-control-allow-origin': '*' };
const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
const eq = (url: URL, k: string) => url.searchParams.get(k)?.replace(/^eq\./, '') ?? null;

export async function handleWeather(route: Route, w: WeatherState, roleIn: (org: string) => string | undefined, userId: string | null): Promise<boolean> {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname;
  const readable = (org: unknown) => !!userId && !!roleIn(String(org));
  const editor = (org: unknown) => ['editor', 'approver', 'admin'].includes(roleIn(String(org)) ?? '');

  if (p === '/functions/v1/open-meteo-ingest') {
    const body = req.postDataJSON() as { location_id?: string };
    const loc = w.locations.find((l) => l.id === body.location_id);
    let status = 200;
    let out: unknown;
    if (!userId) [status, out] = [401, { error: 'Autenticazione richiesta' }];
    else if (!loc || !readable(loc.organization_id)) [status, out] = [404, { error: 'Località non trovata.' }];
    else if (!editor(loc.organization_id)) [status, out] = [403, { error: 'Serve il ruolo "modifica" per aggiornare i dati.' }];
    else {
      const last = w.runs.filter((r) => r.trigger === 'manuale').map((r) => Date.parse(String(r.requested_at))).sort().at(-1);
      if (last && Date.now() - last < 10 * 60_000) [status, out] = [429, { error: 'Aggiornamento già richiesto: riprova tra qualche minuto.' }];
      else {
        const base = w.runs[0]!;
        w.runs.unshift({ ...base, id: `run-${w.runs.length + 1}`, trigger: 'manuale', requested_at: new Date().toISOString(), completed_at: new Date().toISOString() });
        w.points = w.points.map((x) => ({ ...x, fetch_run_id: w.runs[0]!.id }));
        out = { status: 'completata', points: w.points.length };
      }
    }
    w.invokes.push({ body, status });
    await json(route, status, out);
    return true;
  }

  if (p === '/rest/v1/rpc/weather_history_status') {
    const { p_location } = req.postDataJSON() as { p_location: string };
    const loc = w.locations.find((l) => l.id === p_location);
    if (!userId || !loc || !readable(loc.organization_id)) await json(route, 404, { code: 'P0002', message: 'Località non trovata.' });
    else await json(route, 200, w.history[p_location] ?? historyStatus({ stato: 'in_preparazione', livello: 'insufficiente', ultima_ora: null, ore_finestra: 0, ore_continue: 0 }));
    return true;
  }

  const table = p.match(/^\/rest\/v1\/(weather_[a-z_]+)$/)?.[1];
  if (!table) return false;
  if (!userId) {
    await json(route, 200, []);
    return true;
  }
  const wantsObject = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
  if (table === 'weather_locations' && req.method() === 'POST') {
    const row = req.postDataJSON() as Record<string, unknown>;
    if (!editor(row.organization_id)) {
      await json(route, 403, { code: '42501', message: 'new row violates row-level security policy' });
      return true;
    }
    const created = { id: `00000000-0000-4000-8000-${String(w.locations.length).padStart(12, '0')}`, active: true, ...row };
    w.locations.push(created);
    await json(route, 201, wantsObject ? created : [created]);
    return true;
  }
  const visibleLocs = w.locations.filter((l) => readable(l.organization_id)).map((l) => l.id);
  let rows: Record<string, unknown>[] =
    table === 'weather_locations'
      ? w.locations.filter((l) => readable(l.organization_id))
      : table === 'weather_fetch_runs'
        ? w.runs.filter((r) => visibleLocs.includes(r.location_id))
        : table === 'weather_forecast_points'
          ? w.points.filter((x) => w.runs.some((r) => r.id === x.fetch_run_id && visibleLocs.includes(r.location_id)))
          : w.observations.filter((o) => visibleLocs.includes(o.location_id));
  for (const k of ['project_id', 'location_id', 'fetch_run_id', 'status', 'source', 'trigger']) {
    const v = eq(url, k);
    if (v !== null) rows = rows.filter((r) => String(r[k]) === v);
  }
  if (eq(url, 'active') === 'true') rows = rows.filter((r) => r.active === true);
  await json(route, 200, wantsObject ? (rows[0] ?? null) : rows);
  return true;
}
