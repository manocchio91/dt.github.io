import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { hashOf, seedCampobasso, seedVineyard } from '@mdt/domain';
import { actAs, createAuthUser, createDb } from './harness';
import { pgliteClient } from './pgliteClient';
import { authorizeManual, ingestLocation, type IngestClient } from '../functions/_shared/weatherIngest.ts';
import { COMMON_HOURLY, EXPECTED_UNITS, hourlyVariables, type HourlyVariable } from '../functions/_shared/openMeteoForecast.ts';

/**
 * Storico Open-Meteo di 7 giorni (migrazioni 0012–0013, Edge Function open-meteo-ingest v4+):
 * prima acquisizione, acquisizioni incrementali, idempotenza, lacune, cambio dell'ora legale,
 * risposte incomplete, errori temporanei, provenienza, permessi.
 * Open-Meteo è simulato rispettando past_days, forecast_days e hourly della richiesta: la serie
 * parte dalla mezzanotte locale di N giorni prima calcolata con lo scostamento ATTUALE (come l'API).
 */
const ids = {
  alice: '00000000-0000-4000-8000-0000000b0a11', // admin A
  dave: '00000000-0000-4000-8000-0000000b0da7', // editor A
  carol: '00000000-0000-4000-8000-0000000b0ca2', // lettura A
  bob: '00000000-0000-4000-8000-0000000b0b0b', // admin B (esterno)
};
const H = 3_600_000;
const T1 = new Date('2026-10-22T10:20:00Z'); // prima acquisizione (ora legale)
const T2 = new Date('2026-10-22T13:20:00Z'); // job delle 3 ore
const T3 = new Date('2026-10-25T04:20:00Z'); // dopo il ritorno all'ora solare (25/10 01:00 UTC)

let db: PGlite;
let orgA: string;
let urbanLoc: string;
let agriLoc: string;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const admin = () => pgliteClient(db, { as: 'service' }) as unknown as IngestClient;
const userClient = (id: string) => pgliteClient(db, { as: { id } }) as unknown as IngestClient;
const noSleep = async () => {};

function romeOffsetSeconds(t: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', timeZoneName: 'shortOffset' }).formatToParts(t).find((p) => p.type === 'timeZoneName')!.value;
  return Number(name.replace('GMT', '') || 0) * 3600;
}

function value(v: HourlyVariable, t: number): number {
  const h = new Date(t * 1000).getUTCHours();
  if (v === 'shortwave_radiation') return h >= 7 && h <= 16 ? 400 : 0;
  if (v.startsWith('soil_moisture')) return 0.25;
  if (v.startsWith('soil_temperature')) return 14;
  const base: Partial<Record<HourlyVariable, number>> = { temperature_2m: 16 + (h % 12) / 2, apparent_temperature: 15, relative_humidity_2m: 70, precipitation: 0, precipitation_probability: 10, wind_speed_10m: 3, wind_direction_10m: 200, wind_gusts_10m: 6, et0_fao_evapotranspiration: 0.1, vapour_pressure_deficit: 0.6 };
  return base[v]!;
}

/** Risposta Open-Meteo simulata per l'URL richiesto. */
function openMeteo(now: Date, o: { nullFrom?: string; nullHours?: number; omit?: HourlyVariable[] } = {}) {
  return vi.fn<typeof fetch>(async (input) => {
    const u = new URL(String(input));
    const past = Number(u.searchParams.get('past_days'));
    const days = Number(u.searchParams.get('forecast_days'));
    const vars = u.searchParams.get('hourly')!.split(',') as HourlyVariable[];
    const offset = romeOffsetSeconds(now);
    const localMidnight = Math.floor((now.getTime() / 1000 + offset) / 86400) * 86400 - offset;
    const start = localMidnight - past * 86400;
    const time = Array.from({ length: (past + days) * 24 }, (_, i) => start + i * 3600);
    const nullFrom = o.nullFrom ? Date.parse(o.nullFrom) / 1000 : null;
    const isNull = (t: number) => nullFrom !== null && t >= nullFrom && t < nullFrom + (o.nullHours ?? 0) * 3600;
    const hourly: Record<string, unknown> = { time };
    const units: Record<string, string> = { time: 'unixtime' };
    for (const v of vars) {
      if (o.omit?.includes(v)) continue;
      hourly[v] = time.map((t) => (isNull(t) ? null : value(v, t)));
      units[v] = EXPECTED_UNITS[v];
    }
    const body = { latitude: 41.56, longitude: 14.66, generationtime_ms: 1, utc_offset_seconds: offset, timezone: 'Europe/Rome', elevation: 700, hourly_units: units, hourly };
    return { ok: true, status: 200, json: async () => body } as Response;
  });
}

const status = async (loc: string, at: Date) => (await one<{ s: Record<string, unknown> }>('select public.weather_history_status($1, $2) as s', [loc, at.toISOString()])).s;
const obsCount = async (loc: string) => (await one<{ n: number }>(`select count(*)::int n from weather_observations where location_id = $1 and source = 'open_meteo'`, [loc])).n;

beforeAll(async () => {
  db = await createDb();
  for (const [k, email] of [['alice', 'alice@bf.it'], ['dave', 'dave@bf.it'], ['carol', 'carol@bf.it'], ['bob', 'bob@bf.it']] as const) await createAuthUser(db, ids[k], email);
  await actAs(db, { id: ids.alice });
  orgA = (await one<{ id: string }>(`select public.create_organization('Comune BF') as id`)).id;
  await db.query(`select public.add_member_by_email($1, 'dave@bf.it', 'editor')`, [orgA]);
  await db.query(`select public.add_member_by_email($1, 'carol@bf.it', 'viewer')`, [orgA]);
  const u = seedCampobasso(new Date('2026-10-20T08:00:00Z'));
  const v = seedVineyard(new Date('2026-08-20T08:00:00Z'), '2026-08-20');
  await db.query('select public.save_project($1, $2, $3, 0)', [orgA, JSON.stringify(u), hashOf(u)]);
  await db.query('select public.save_project($1, $2, $3, 0)', [orgA, JSON.stringify(v), hashOf(v)]);
  await actAs(db, { id: ids.dave });
  urbanLoc = (await one<{ id: string }>(`insert into weather_locations (organization_id, project_id, name, scope, latitude, longitude) values ($1, $2, 'Piazza BF', 'urban', 41.5606, 14.663) returning id`, [orgA, u.project.id])).id;
  agriLoc = (await one<{ id: string }>(`insert into weather_locations (organization_id, project_id, name, scope, latitude, longitude) values ($1, $2, 'Vigneto BF', 'agricultural', 41.8, 14.92) returning id`, [orgA, v.project.id])).id;
  await actAs(db, { id: ids.bob });
  await db.query(`select public.create_organization('Comune esterno BF')`);
  await actAs(db, 'service');
}, 180_000);

describe('Prima acquisizione: 7 giorni completi', () => {
  it('nuova località senza storico: in preparazione, poi past_days=8 e almeno 168 ore valide', async () => {
    expect(await status(urbanLoc, T1)).toMatchObject({ stato: 'in_preparazione', livello: 'insufficiente', ore_finestra: 0 });
    const f = openMeteo(T1);
    const s = await ingestLocation(admin(), urbanLoc, { trigger: 'pianificata', now: T1, fetch: { fetchImpl: f, sleep: noSleep } });
    expect(s).toMatchObject({ status: 'completata', past_days: 8, backfill: true });
    expect(new URL(String(f.mock.calls[0]![0])).searchParams.get('past_days')).toBe('8');
    const st = await status(urbanLoc, T1);
    expect(st).toMatchObject({ stato: 'sufficiente', livello: 'disponibile', sette_giorni: true, ore_finestra: 168, buchi: [], variabili_richieste_mancanti: [] });
    expect(st.ore_continue as number).toBeGreaterThanOrEqual(168);
    expect(st.ultima_ora).toBe('2026-10-22T09:00:00+00:00');
    // tutte le variabili urbane, ognuna con 168 ore distinte nella finestra
    expect(Object.keys(st.ore_per_variabile as object).sort()).toEqual([...COMMON_HOURLY].sort());
    expect(Object.values(st.ore_per_variabile as Record<string, number>).every((n) => n === 168)).toBe(true);
  });

  it('storico separato dalla previsione: ore passate in weather_observations, future in weather_forecast_points', async () => {
    const run = await one<{ id: string; issued_at: Date }>(`select id, issued_at from weather_fetch_runs where location_id = $1 and status = 'completata'`, [urbanLoc]);
    const maxObs = await one<{ t: Date }>('select max(observed_at) t from weather_observations where fetch_run_id = $1', [run.id]);
    const minPoint = await one<{ t: Date }>('select min(valid_at) t from weather_forecast_points where fetch_run_id = $1', [run.id]);
    expect(maxObs.t.getTime()).toBeLessThan(run.issued_at.getTime());
    expect(minPoint.t.getTime()).toBe(run.issued_at.getTime());
  });

  it('provenienza di ogni ora storica: fonte, variabile, unità, ora di validità e acquisizione con cella, modello, progetto e organizzazione', async () => {
    const r = await one<Record<string, unknown>>(
      `select o.source, o.quality_flag, o.unit, o.observed_at, o.organization_id, l.project_id, r.requested_at, r.response_grid_latitude, r.response_elevation, r.model_requested, r.issued_at
       from weather_observations o join weather_fetch_runs r on r.id = o.fetch_run_id join weather_locations l on l.id = o.location_id
       where o.location_id = $1 and o.variable = 'temperature_2m' order by o.observed_at limit 1`,
      [urbanLoc],
    );
    expect(r).toMatchObject({ source: 'open_meteo', quality_flag: 'modellato', unit: '°C', organization_id: orgA, response_grid_latitude: 41.56, response_elevation: 700, model_requested: 'best_match' });
    expect(r.project_id).toBeTruthy();
    expect((await one<{ n: number }>(`select count(*)::int n from weather_observations where location_id = $1 and fetch_run_id is null`, [urbanLoc])).n).toBe(0);
  });
});

describe('Acquisizioni successive: incrementali e idempotenti', () => {
  it('job delle 3 ore: past_days=1, solo le 3 ore nuove per ognuna delle 9 variabili urbane', async () => {
    const before = await obsCount(urbanLoc);
    const f = openMeteo(T2);
    const s = await ingestLocation(admin(), urbanLoc, { trigger: 'pianificata', now: T2, fetch: { fetchImpl: f, sleep: noSleep } });
    expect(s).toMatchObject({ status: 'completata', past_days: 1, backfill: false });
    expect(s.observations).toBe(3 * COMMON_HOURLY.length);
    expect(await obsCount(urbanLoc)).toBe(before + 3 * COMMON_HOURLY.length);
  });

  it('stessa ora: nessuna nuova acquisizione, nessuna chiamata a Open-Meteo', async () => {
    const before = await obsCount(urbanLoc);
    const f = openMeteo(T2);
    const s = await ingestLocation(admin(), urbanLoc, { trigger: 'pianificata', now: new Date('2026-10-22T13:55:00Z'), fetch: { fetchImpl: f } });
    expect(s.status).toBe('gia_acquisita');
    expect(f).not.toHaveBeenCalled();
    expect(await obsCount(urbanLoc)).toBe(before);
  });

  it('nessun duplicato: una sola riga per ora, variabile e fonte; le previsioni già emesse non cambiano', async () => {
    expect((await rows(`select observed_at, variable from weather_observations where location_id = $1 group by 1, 2 having count(*) > 1`, [urbanLoc])).length).toBe(0);
    const first = await one<{ t: number }>(`select temperature_2m t from weather_forecast_points where location_id = $1 order by issued_at, valid_at limit 1`, [urbanLoc]);
    await expect(db.query(`update weather_forecast_points set temperature_2m = 99 where location_id = $1`, [urbanLoc])).rejects.toThrow();
    expect((await one<{ t: number }>(`select temperature_2m t from weather_forecast_points where location_id = $1 order by issued_at, valid_at limit 1`, [urbanLoc])).t).toBe(first.t);
  });

  it('cambio dell’ora legale: le ore mancanti si recuperano senza doppioni né salti', async () => {
    const f = openMeteo(T3);
    const s = await ingestLocation(admin(), urbanLoc, { trigger: 'pianificata', now: T3, fetch: { fetchImpl: f, sleep: noSleep } });
    expect(s.status).toBe('completata');
    // dalle 13:00 UTC del 22/10 alle 04:00 UTC del 25/10: 63 ore → 3 giorni interi
    expect(s.past_days).toBe(3);
    const hours = await rows<{ t: Date }>(`select observed_at t from weather_observations where location_id = $1 and variable = 'temperature_2m' and observed_at >= '2026-10-24T20:00:00Z' order by 1`, [urbanLoc]);
    // 20:00 → 03:00 UTC: 8 ore distinte, incluse le due ore locali "02:xx" del 25/10
    expect(hours.map((h) => h.t.toISOString())).toEqual(Array.from({ length: 8 }, (_, i) => new Date(Date.parse('2026-10-24T20:00:00Z') + i * H).toISOString()));
    expect((await rows(`select observed_at from weather_observations where location_id = $1 group by observed_at, variable having count(*) > 1`, [urbanLoc])).length).toBe(0);
    expect(await status(urbanLoc, T3)).toMatchObject({ livello: 'disponibile', buchi: [] });
  });
});

describe('Lacune, risposte incomplete ed errori', () => {
  it('agricolo con 6 ore vuote: lacuna segnalata senza valori inventati, storico in consolidamento', async () => {
    const f = openMeteo(T1, { nullFrom: '2026-10-19T00:00:00Z', nullHours: 6 });
    const s = await ingestLocation(admin(), agriLoc, { trigger: 'pianificata', now: T1, fetch: { fetchImpl: f, sleep: noSleep } });
    expect(s.status).toBe('completata');
    expect((await one<{ n: number }>(`select count(*)::int n from weather_observations where location_id = $1 and observed_at >= '2026-10-19T00:00:00Z' and observed_at < '2026-10-19T06:00:00Z'`, [agriLoc])).n).toBe(0);
    const st = await status(agriLoc, T1);
    expect(st).toMatchObject({ livello: 'consolidamento', ore_finestra: 162, buchi: [{ da: '2026-10-19T00:00:00+00:00', a: '2026-10-19T05:00:00+00:00', ore: 6 }] });
    expect(st.ore_continue).toBe(76); // dalle 06:00 del 19/10 (fine della lacuna) alle 09:00 del 22/10
    // variabili agricole nello storico
    for (const v of ['et0_fao_evapotranspiration', 'vapour_pressure_deficit', 'soil_temperature_6cm', 'soil_moisture_9_to_27cm']) expect(Object.keys(st.ore_per_variabile as object)).toContain(v);
  });

  it('acquisizione successiva: scarica dalla prima ora mancante e chiude la lacuna', async () => {
    const f = openMeteo(T2);
    const s = await ingestLocation(admin(), agriLoc, { trigger: 'pianificata', now: T2, fetch: { fetchImpl: f, sleep: noSleep } });
    expect(s).toMatchObject({ status: 'completata', backfill: false });
    expect(s.past_days).toBe(4); // 85 ore dalla lacuna + margine → 4 giorni
    expect(await status(agriLoc, T2)).toMatchObject({ livello: 'disponibile', buchi: [], ore_finestra: 168 });
  });

  it('risposta incompleta (manca l’umidità): acquisizione in errore, storico valido intatto', async () => {
    const before = await obsCount(agriLoc);
    const t = new Date('2026-10-22T16:20:00Z');
    const s = await ingestLocation(admin(), agriLoc, { trigger: 'pianificata', now: t, fetch: { fetchImpl: openMeteo(t, { omit: ['relative_humidity_2m'] }), sleep: noSleep } });
    expect(s).toMatchObject({ status: 'errore', error: { code: 'DATI_ASSENTI' } });
    expect(await obsCount(agriLoc)).toBe(before);
    expect(await status(agriLoc, t)).toMatchObject({ livello: 'disponibile', ultimo_errore: { codice: 'DATI_ASSENTI' } });
  });

  it('errore temporaneo (503) seguito da risposta valida: un nuovo tentativo, nessun dato perso', async () => {
    const t = new Date('2026-10-22T19:20:00Z');
    const ok = openMeteo(t);
    let calls = 0;
    const f = vi.fn<typeof fetch>(async (u, i) => (++calls === 1 ? ({ ok: false, status: 503, json: async () => ({ reason: 'busy' }) } as Response) : ok(u, i)));
    const s = await ingestLocation(admin(), agriLoc, { trigger: 'pianificata', now: t, fetch: { fetchImpl: f, sleep: noSleep, retries: 2 } });
    expect(s.status).toBe('completata');
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('Permessi e isolamento', () => {
  it('lettura: vede lo stato dello storico ma non avvia acquisizioni; esterno: non vede nulla', async () => {
    await actAs(db, { id: ids.carol });
    expect((await status(urbanLoc, T3)).livello).toBe('disponibile');
    await expect(authorizeManual(userClient(ids.carol), urbanLoc)).rejects.toMatchObject({ status: 403 });
    await actAs(db, { id: ids.bob });
    await expect(status(urbanLoc, T3)).rejects.toThrow(/non trovata/);
    expect(await rows('select id from weather_observations')).toEqual([]);
    await expect(authorizeManual(userClient(ids.bob), urbanLoc)).rejects.toMatchObject({ status: 404 });
    await actAs(db, 'anon');
    await expect(status(urbanLoc, T3)).rejects.toThrow();
    await actAs(db, 'service');
  });

  it('una misura da sensore non può dichiarare un’acquisizione Open-Meteo', async () => {
    const run = await one<{ id: string }>(`select id from weather_fetch_runs where location_id = $1 limit 1`, [urbanLoc]);
    await actAs(db, { id: ids.dave });
    await expect(
      db.query(`insert into weather_observations (organization_id, location_id, observed_at, variable, value, unit, source, fetch_run_id) values ($1, $2, now(), 'temperature_2m', 20, '°C', 'sensore', $3)`, [orgA, urbanLoc, run.id]),
    ).rejects.toThrow();
    await actAs(db, 'service');
  });

  it('agricolo e urbano restano distinti: nessuna variabile del suolo nello storico urbano', async () => {
    const urbanVars = (await rows<{ variable: string }>(`select distinct variable from weather_observations where location_id = $1`, [urbanLoc])).map((r) => r.variable);
    expect(urbanVars.some((v) => v.startsWith('soil') || v === 'et0_fao_evapotranspiration')).toBe(false);
    const agriVars = (await rows<{ variable: string }>(`select distinct variable from weather_observations where location_id = $1`, [agriLoc])).map((r) => r.variable).sort();
    expect(agriVars).toEqual([...hourlyVariables('agricultural')].sort());
  });
});
