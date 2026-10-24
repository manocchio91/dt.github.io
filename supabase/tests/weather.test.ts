import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { hashOf, seedCampobasso, seedVineyard } from '@mdt/domain';
import urbanFixture from '../../packages/domain/src/connectors/fixtures/open-meteo-forecast-urban.json' with { type: 'json' };
import agriFixture from '../../packages/domain/src/connectors/fixtures/open-meteo-forecast-agricultural.json' with { type: 'json' };
import { actAs, createAuthUser, createDb } from './harness';
import { pgliteClient } from './pgliteClient';
import { authorizeManual, ingestAllActive, ingestLocation, IngestError, type IngestClient } from '../functions/_shared/weatherIngest.ts';

const ids = {
  alice: '00000000-0000-4000-8000-00000000a11c', // admin A
  dave: '00000000-0000-4000-8000-00000000da7e', // editor A
  carol: '00000000-0000-4000-8000-0000000ca201', // viewer A
  bob: '00000000-0000-4000-8000-000000000b0b', // admin B
};
// le fixture sono risposte reali acquisite alle 15:3x UTC del 24/10/2026
const NOW = new Date('2026-10-24T15:20:00Z');
const LATER = new Date('2026-10-24T18:20:00Z');

let db: PGlite;
let orgA: string;
let orgB: string;
let urbanLoc: string;
let agriLoc: string;
let urbanProject: string;
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;
const fixtureFetch = (body: unknown) => vi.fn<typeof fetch>(async () => res(200, body));
const admin = () => pgliteClient(db, { as: 'service' }) as unknown as IngestClient;
const userClient = (id: string) => pgliteClient(db, { as: { id } }) as unknown as IngestClient;
const noSleep = async () => {};

beforeAll(async () => {
  db = await createDb();
  for (const [k, email] of [['alice', 'alice@a.it'], ['dave', 'dave@a.it'], ['carol', 'carol@a.it'], ['bob', 'bob@b.it']] as const) await createAuthUser(db, ids[k], email);
  await actAs(db, { id: ids.alice });
  orgA = (await one<{ id: string }>(`select public.create_organization('Comune A') as id`)).id;
  await db.query(`select public.add_member_by_email($1, 'dave@a.it', 'editor')`, [orgA]);
  await db.query(`select public.add_member_by_email($1, 'carol@a.it', 'viewer')`, [orgA]);
  const u = seedCampobasso(new Date('2026-10-24T08:00:00Z'));
  const v = seedVineyard(new Date('2026-08-20T08:00:00Z'), '2026-08-20');
  urbanProject = u.project.id;
  await db.query('select public.save_project($1, $2, $3, 0)', [orgA, JSON.stringify(u), hashOf(u)]);
  await db.query('select public.save_project($1, $2, $3, 0)', [orgA, JSON.stringify(v), hashOf(v)]);
  await actAs(db, { id: ids.dave });
  urbanLoc = (await one<{ id: string }>(`insert into weather_locations (organization_id, project_id, name, scope, latitude, longitude, elevation) values ($1, $2, 'Piazza', 'urban', 41.5606, 14.663, 700) returning id`, [orgA, u.project.id])).id;
  agriLoc = (await one<{ id: string }>(`insert into weather_locations (organization_id, project_id, name, scope, latitude, longitude) values ($1, $2, 'Vigneto', 'agricultural', 41.8, 14.92) returning id`, [orgA, v.project.id])).id;
  await actAs(db, { id: ids.bob });
  orgB = (await one<{ id: string }>(`select public.create_organization('Comune B') as id`)).id;
}, 180_000);

describe('Funzione open-meteo-ingest: modulo condiviso', () => {
  it('la copia nella Edge Function è identica al dominio (npm run sync:functions)', () => {
    const root = join(import.meta.dirname, '..', '..');
    expect(readFileSync(join(root, 'supabase/functions/_shared/openMeteoForecast.ts'), 'utf8')).toBe(readFileSync(join(root, 'packages/domain/src/connectors/openMeteoForecast.ts'), 'utf8'));
  });
});

describe('Località: permessi e isolamento', () => {
  it('editor crea, viewer legge, esterno non vede; coordinate e fuso validati', async () => {
    await actAs(db, { id: ids.carol });
    expect(await rows('select name from weather_locations order by name')).toEqual([{ name: 'Piazza' }, { name: 'Vigneto' }]);
    await expect(db.query(`insert into weather_locations (organization_id, project_id, name, scope, latitude, longitude) values ($1, $2, 'X', 'urban', 41, 14)`, [orgA, urbanProject])).rejects.toThrow();
    await actAs(db, { id: ids.bob });
    expect(await rows('select id from weather_locations')).toEqual([]);
    await expect(db.query(`insert into weather_locations (organization_id, project_id, name, scope, latitude, longitude) values ($1, $2, 'X', 'urban', 41, 14)`, [orgB, urbanProject])).rejects.toThrow();
    await actAs(db, { id: ids.dave });
    await expect(db.query(`insert into weather_locations (organization_id, project_id, name, scope, latitude, longitude) values ($1, $2, 'Y', 'urban', 95, 14)`, [orgA, urbanProject])).rejects.toThrow();
    await expect(db.query(`insert into weather_locations (organization_id, project_id, name, scope, latitude, longitude, timezone) values ($1, $2, 'Z', 'urban', 41, 14, 'UTC')`, [orgA, urbanProject])).rejects.toThrow();
  });
});

describe('Nessun client si spaccia per Open-Meteo', () => {
  it('acquisizioni, previsioni e osservazioni con fonte open_meteo: rifiutate ai client, anche all’admin', async () => {
    await actAs(db, { id: ids.alice });
    await expect(db.query(`insert into weather_fetch_runs (organization_id, location_id, trigger, model_requested, request_hash) values ($1, $2, 'manuale', 'best_match', repeat('a', 64))`, [orgA, urbanLoc])).rejects.toThrow();
    await expect(db.query(`insert into weather_observations (organization_id, location_id, observed_at, variable, value, unit, source) values ($1, $2, now(), 'temperature_2m', 20, '°C', 'open_meteo')`, [orgA, urbanLoc])).rejects.toThrow();
    await expect(db.query(`select public.weather_begin_fetch($1, repeat('a', 64), 'manuale', 'best_match')`, [urbanLoc])).rejects.toThrow();
    await expect(db.query(`select public.weather_complete_fetch(gen_random_uuid(), '{}', '[]')`)).rejects.toThrow();
  });

  it('un editor registra una misura da sensore; non può cambiarne la fonte in open_meteo', async () => {
    await actAs(db, { id: ids.dave });
    const o = await one<{ id: string; created_by: string }>(`insert into weather_observations (organization_id, location_id, observed_at, variable, value, unit, source) values ($1, $2, '2026-10-24T12:00:00Z', 'temperature_2m', 18.4, '°C', 'sensore') returning id, created_by`, [orgA, urbanLoc]);
    expect(o.created_by).toBe(ids.dave);
    await expect(db.query(`update weather_observations set source = 'open_meteo' where id = $1`, [o.id])).rejects.toThrow();
    await db.query(`update weather_observations set quality_flag = 'valido' where id = $1`, [o.id]);
    await actAs(db, { id: ids.carol });
    await expect(db.query(`insert into weather_observations (organization_id, location_id, observed_at, variable, value, unit, source) values ($1, $2, now(), 'temperature_2m', 18, '°C', 'sensore')`, [orgA, urbanLoc])).rejects.toThrow();
  });
});

describe('Acquisizione: registrazione, idempotenza, nessuna sovrascrittura', () => {
  it('urbano: punti futuri con cella effettiva, unità e date di emissione/validità; nessuna variabile agricola', async () => {
    const f = fixtureFetch(urbanFixture);
    const s = await ingestLocation(admin(), urbanLoc, { trigger: 'pianificata', now: NOW, fetch: { fetchImpl: f, sleep: noSleep } });
    expect(s).toMatchObject({ status: 'completata', issued_at: '2026-10-24T15:00:00.000Z', valid_from: '2026-10-24T15:00:00.000Z' });
    expect(s.points).toBeGreaterThanOrEqual(72);
    expect(s.observations).toBeGreaterThan(0);
    expect(s.grid!.latitude).toBeCloseTo(41.586, 2);
    expect(new URL(String(f.mock.calls[0]![0])).searchParams.get('hourly')).not.toMatch(/soil/);
    await actAs(db, { id: ids.carol });
    const run = await one<Record<string, unknown>>('select status, provider, model_requested, model_returned, response_grid_latitude, response_elevation, points_count, trigger from weather_fetch_runs where id = $1', [s.run_id]);
    expect(run).toMatchObject({ status: 'completata', provider: 'open_meteo', model_requested: 'best_match', model_returned: null, response_elevation: 700, trigger: 'pianificata', points_count: s.points });
    const p = await one<Record<string, unknown>>(`select source, model, unit_metadata, soil_moisture_9_to_27cm, temperature_2m from weather_forecast_points where fetch_run_id = $1 order by valid_at limit 1`, [s.run_id]);
    expect(p.source).toBe('open_meteo');
    expect((p.unit_metadata as Record<string, string>).wind_speed_10m).toBe('m/s');
    expect((p.unit_metadata as Record<string, string>).timezone).toBe('Europe/Rome');
    expect(p.soil_moisture_9_to_27cm).toBeNull();
    expect(typeof p.temperature_2m).toBe('number');
  });

  it('agricolo: suolo, ET0 e VPD registrati', async () => {
    const s = await ingestLocation(admin(), agriLoc, { trigger: 'pianificata', now: NOW, fetch: { fetchImpl: fixtureFetch(agriFixture), sleep: noSleep } });
    expect(s.status).toBe('completata');
    await actAs(db, { id: ids.carol });
    const p = await one<Record<string, number | null>>(`select soil_moisture_9_to_27cm, soil_temperature_6cm, et0_fao_evapotranspiration, vapour_pressure_deficit from weather_forecast_points where fetch_run_id = $1 and soil_moisture_9_to_27cm is not null limit 1`, [s.run_id]);
    expect(p.soil_moisture_9_to_27cm).toBeGreaterThan(0);
    expect(p.vapour_pressure_deficit).not.toBeNull();
  });

  it('stessa ora: acquisizione duplicata non registra nulla di nuovo e non chiama Open-Meteo', async () => {
    const before = (await one<{ n: number }>('select count(*)::int n from weather_forecast_points where location_id = $1', [urbanLoc])).n;
    const f = fixtureFetch(urbanFixture);
    const s = await ingestLocation(admin(), urbanLoc, { trigger: 'pianificata', now: new Date('2026-10-24T15:55:00Z'), fetch: { fetchImpl: f } });
    expect(s.status).toBe('gia_acquisita');
    expect(f).not.toHaveBeenCalled();
    expect((await one<{ n: number }>('select count(*)::int n from weather_forecast_points where location_id = $1', [urbanLoc])).n).toBe(before);
  });

  it('ora successiva: nuova emissione accanto alla precedente (backtest), mai sovrascritta', async () => {
    const s = await ingestLocation(admin(), urbanLoc, { trigger: 'pianificata', now: LATER, fetch: { fetchImpl: fixtureFetch(urbanFixture), sleep: noSleep } });
    expect(s.status).toBe('completata');
    const issued = await rows<{ issued_at: Date; n: number }>('select issued_at, count(*)::int n from weather_forecast_points where location_id = $1 group by issued_at order by issued_at', [urbanLoc]);
    expect(issued).toHaveLength(2);
    // la stessa ora di validità ha due emissioni diverse
    const same = await one<{ n: number }>(`select count(distinct issued_at)::int n from weather_forecast_points where location_id = $1 and valid_at = '2026-10-25T12:00:00Z'`, [urbanLoc]);
    expect(same.n).toBe(2);
    await actAs(db, 'service');
    await expect(db.query(`update weather_forecast_points set temperature_2m = 99 where location_id = $1`, [urbanLoc])).rejects.toThrow(/non si sovrascrivono/);
  });

  it('errore di Open-Meteo dopo i tentativi: acquisizione in errore, ultimo dato valido intatto', async () => {
    const before = (await one<{ n: number }>('select count(*)::int n from weather_forecast_points where location_id = $1', [urbanLoc])).n;
    const f = vi.fn<typeof fetch>(async () => res(503, { reason: 'maintenance' }));
    const s = await ingestLocation(admin(), urbanLoc, { trigger: 'pianificata', now: new Date('2026-10-24T21:10:00Z'), fetch: { fetchImpl: f, sleep: noSleep, retries: 2 } });
    expect(s).toMatchObject({ status: 'errore', error: { code: 'HTTP' } });
    expect(f).toHaveBeenCalledTimes(3);
    const run = await one<{ status: string; error_code: string; error_message: string }>('select status, error_code, error_message from weather_fetch_runs where id = $1', [s.run_id]);
    expect(run).toMatchObject({ status: 'errore', error_code: 'HTTP' });
    expect((await one<{ n: number }>('select count(*)::int n from weather_forecast_points where location_id = $1', [urbanLoc])).n).toBe(before);
    // dopo un errore la stessa ora si può riprovare
    const retry = await ingestLocation(admin(), urbanLoc, { trigger: 'pianificata', now: new Date('2026-10-24T21:40:00Z'), fetch: { fetchImpl: fixtureFetch(urbanFixture), sleep: noSleep } });
    expect(retry.status).toBe('completata');
  });

  it('risposta incompleta (manca la temperatura): errore registrato, nessun punto', async () => {
    const broken = JSON.parse(JSON.stringify(urbanFixture)) as { hourly: Record<string, unknown> };
    delete broken.hourly.temperature_2m;
    const s = await ingestLocation(admin(), urbanLoc, { trigger: 'pianificata', now: new Date('2026-10-25T00:10:00Z'), fetch: { fetchImpl: fixtureFetch(broken), sleep: noSleep } });
    expect(s).toMatchObject({ status: 'errore', points: 0, error: { code: 'DATI_ASSENTI' } });
  });

  it('località disattivata o con coordinate non valide: rifiutata senza chiamare Open-Meteo', async () => {
    await actAs(db, { id: ids.dave });
    const bad = (await one<{ id: string }>(`insert into weather_locations (organization_id, project_id, name, scope, latitude, longitude) values ($1, $2, 'Zero', 'urban', 0, 0) returning id`, [orgA, urbanProject])).id;
    const f = fixtureFetch(urbanFixture);
    await expect(ingestLocation(admin(), bad, { trigger: 'pianificata', now: NOW, fetch: { fetchImpl: f } })).rejects.toMatchObject({ status: 422 });
    await actAs(db, { id: ids.dave });
    await db.query('update weather_locations set active = false where id = $1', [bad]);
    await expect(ingestLocation(admin(), bad, { trigger: 'pianificata', now: NOW, fetch: { fetchImpl: f } })).rejects.toMatchObject({ status: 409 });
    expect(f).not.toHaveBeenCalled();
    await expect(ingestLocation(admin(), 'non-un-uuid', { trigger: 'pianificata' })).rejects.toMatchObject({ status: 400 });
  });

  it('job pianificato: solo località attive, un errore non ferma le altre', async () => {
    const f = vi.fn<typeof fetch>(async (url) => (new URL(String(url)).searchParams.get('hourly')!.includes('soil') ? res(500, {}) : res(200, urbanFixture)));
    const out = await ingestAllActive(admin(), { now: new Date('2026-10-25T03:07:00Z'), fetch: { fetchImpl: f, sleep: noSleep, retries: 0 } });
    expect(out.map((r) => [r.location_id, r.status]).sort()).toEqual([[agriLoc, 'errore'], [urbanLoc, 'completata']].sort());
  });
});

describe('Aggiornamento manuale autorizzato', () => {
  it('viewer rifiutato (403), esterno non trova la località (404), editor autorizzato', async () => {
    await expect(authorizeManual(userClient(ids.carol), urbanLoc)).rejects.toMatchObject({ status: 403 });
    await expect(authorizeManual(userClient(ids.bob), urbanLoc)).rejects.toMatchObject({ status: 404 });
    expect(await authorizeManual(userClient(ids.dave), urbanLoc)).toBe(ids.dave);
  });

  it('limite di frequenza: secondo aggiornamento manuale entro 10 minuti → 429', async () => {
    const m = await ingestLocation(admin(), urbanLoc, { trigger: 'manuale', requestedBy: ids.dave, now: new Date('2026-10-26T09:10:00Z'), fetch: { fetchImpl: fixtureFetch(urbanFixture), sleep: noSleep } });
    expect(m.status).toBe('completata');
    const e = await authorizeManual(userClient(ids.dave), urbanLoc).catch((x: IngestError) => x);
    expect(e).toBeInstanceOf(IngestError);
    expect(e).toMatchObject({ status: 429, code: 'LIMITE' });
  });
});

describe('Lettura, isolamento e audit', () => {
  it('l’esterno non legge acquisizioni, previsioni né osservazioni di A', async () => {
    await actAs(db, { id: ids.bob });
    expect(await rows('select id from weather_fetch_runs')).toEqual([]);
    expect(await rows('select id from weather_forecast_points limit 1')).toEqual([]);
    expect(await rows('select id from weather_observations limit 1')).toEqual([]);
  });

  it('storico modellato delle ore passate registrato come osservazione Open-Meteo, mai come sensore', async () => {
    await actAs(db, { id: ids.carol });
    const r = await rows<{ source: string; quality_flag: string }>(`select distinct source, quality_flag from weather_observations where location_id = $1 order by source`, [urbanLoc]);
    expect(r).toEqual([{ source: 'open_meteo', quality_flag: 'modellato' }, { source: 'sensore', quality_flag: 'valido' }]);
  });

  it('audit di località, acquisizioni e osservazioni, visibile all’admin', async () => {
    await actAs(db, { id: ids.alice });
    const ent = await rows<{ entity: string }>(`select distinct entity from audit_logs where organization_id = $1 and entity like 'weather%' order by entity`, [orgA]);
    expect(ent.map((e) => e.entity)).toEqual(['weather_fetch_runs', 'weather_locations', 'weather_observations']);
  });
});
