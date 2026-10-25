import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { hashOf, seedCampobasso } from '@mdt/domain';
import { actAs, createAuthUser, createDb, reopen } from './harness';

/**
 * Migrazione 0009: PostGIS da public a extensions.
 * - aggiornamento da uno stato 0001–0008 CON geometrie reali (valori, SRID, vincoli, indici conservati);
 * - installazione pulita 0001–0009 (le altre suite girano già su questo stato);
 * - l'app non dipende da public.geometry.
 */
const MIG_0009 = readFileSync(join(import.meta.dirname, '..', 'migrations', '20261024000009_postgis_to_extensions_schema.sql'), 'utf8');
const POLY = 'SRID=4326;POLYGON((14.66 41.56,14.67 41.56,14.67 41.57,14.66 41.57,14.66 41.56))';
const PT = 'SRID=4326;POINT(14.663 41.5606)';

let up: PGlite;
const ids: Record<string, string> = {};
const one = async <T>(db: PGlite, sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]!;

beforeAll(async () => {
  up = await createDb({ upTo: '20261024000008' });
  await actAs(up, 'superuser');
  ids.org = (await one<{ id: string }>(up, `insert into organizations (name) values ('Comune prova') returning id`)).id;
  ids.project = (await one<{ id: string }>(up, `insert into projects (organization_id, name, sector, area_geom) values ($1, 'Piazza', 'urban', $2::geometry) returning id`, [ids.org, POLY])).id;
  ids.area = (await one<{ id: string }>(up, `insert into areas (project_id, name, geom) values ($1, 'AOI', $2::geometry) returning id`, [ids.project, POLY])).id;
  ids.parcel = (await one<{ id: string }>(up, `insert into parcels (area_id, name, geom) values ($1, 'Zona', $2::geometry) returning id`, [ids.area, POLY])).id;
  ids.sensor = (await one<{ id: string }>(up, `insert into sensors (project_id, variable, unit, location) values ($1, 'temperatura_aria', '°C', $2::geometry) returning id`, [ids.project, PT])).id;
  ids.obs = (await one<{ id: string }>(up, `insert into field_observations (project_id, observed_at, category, location, location_consent) values ($1, now(), 'nota', $2::geometry, true) returning id`, [ids.project, PT])).id;
  ids.obsNoGeo = (await one<{ id: string }>(up, `insert into field_observations (project_id, observed_at, category) values ($1, now(), 'senza posizione') returning id`, [ids.project])).id;
}, 180_000);

describe('Migrazione 0009 — aggiornamento da 0008 con dati', () => {
  let auditBefore = 0;

  it('stato iniziale: PostGIS in public', async () => {
    const r = await one<{ s: string }>(up, `select extnamespace::regnamespace::text s from pg_extension where extname = 'postgis'`);
    expect(r.s).toBe('public');
    auditBefore = (await one<{ n: number }>(up, 'select count(*)::int n from audit_logs')).n;
  });

  it('si applica senza errori e porta PostGIS in extensions', async () => {
    await up.exec(MIG_0009);
    const r = await one<{ s: string }>(up, `select extnamespace::regnamespace::text s from pg_extension where extname = 'postgis'`);
    expect(r.s).toBe('extensions');
    expect((await up.query(`select 1 from pg_class where relname = 'spatial_ref_sys' and relnamespace = 'public'::regnamespace`)).rows).toEqual([]);
    expect((await up.query(`select 1 from pg_type where typname in ('geometry', 'geography') and typnamespace = 'public'::regnamespace`)).rows).toEqual([]);
  });

  it('geometrie conservate identiche, SRID 4326, area ricalcolata', async () => {
    const p = await one<{ wkt: string; srid: number; t: string }>(up, `select extensions.ST_AsEWKT(area_geom) wkt, extensions.ST_SRID(area_geom) srid, format_type(atttypid, atttypmod) t from projects, pg_attribute where id = $1 and attrelid = 'projects'::regclass and attname = 'area_geom'`, [ids.project]);
    expect(p).toEqual({ wkt: POLY, srid: 4326, t: 'extensions.geometry(Polygon,4326)' });
    const a = await one<{ wkt: string; m2: number }>(up, `select extensions.ST_AsEWKT(geom) wkt, area_m2 m2 from areas where id = $1`, [ids.area]);
    expect(a.wkt).toBe(POLY);
    expect(a.m2).toBeGreaterThan(800_000);
    expect(a.m2).toBeLessThan(1_000_000);
    expect((await one<{ wkt: string }>(up, `select extensions.ST_AsEWKT(geom) wkt from parcels where id = $1`, [ids.parcel])).wkt).toBe(POLY);
    expect((await one<{ wkt: string }>(up, `select extensions.ST_AsEWKT(location) wkt from sensors where id = $1`, [ids.sensor])).wkt).toBe(PT);
    expect((await one<{ wkt: string }>(up, `select extensions.ST_AsEWKT(location) wkt from field_observations where id = $1`, [ids.obs])).wkt).toBe(PT);
    expect((await one<{ g: string | null }>(up, `select location::text g from field_observations where id = $1`, [ids.obsNoGeo])).g).toBeNull();
  });

  it('nessun audit spurio: i trigger erano sospesi durante il ripristino', async () => {
    expect((await one<{ n: number }>(up, 'select count(*)::int n from audit_logs')).n).toBe(auditBefore);
    const disabled = await up.query(`select tgname from pg_trigger where not tgisinternal and tgenabled = 'D'`);
    expect(disabled.rows).toEqual([]);
  });

  it('vincoli, nullability e indici ricreati con i nomi originali', async () => {
    const cons = await up.query<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) def from pg_constraint where conname in ('areas_geom_check', 'parcels_geom_check', 'projects_area_geom_check', 'field_observations_check', 'media_location_ck') order by conname`,
    );
    expect(cons.rows.map((r) => r.conname)).toEqual(['areas_geom_check', 'field_observations_check', 'media_location_ck', 'parcels_geom_check', 'projects_area_geom_check']);
    expect(cons.rows.find((r) => r.conname === 'areas_geom_check')!.def).toMatch(/extensions\.st_isvalid/i);
    const nn = await up.query<{ t: string }>(
      `select c.relname || '.' || a.attname t from pg_attribute a join pg_class c on c.oid = a.attrelid where a.attnotnull and (c.relname, a.attname) in (('areas', 'geom'), ('parcels', 'geom'), ('interventions', 'geom')) order by 1`,
    );
    expect(nn.rows.map((r) => r.t)).toEqual(['areas.geom', 'interventions.geom', 'parcels.geom']);
    const idx = await up.query<{ indexname: string; indexdef: string }>(`select indexname, indexdef from pg_indexes where indexname like '%geom_idx' order by indexname`);
    expect(idx.rows.map((r) => r.indexname)).toEqual(['areas_geom_idx', 'parcels_geom_idx', 'projects_area_geom_idx']);
    for (const r of idx.rows) expect(r.indexdef).toMatch(/USING gist/);
  });

  it('i vincoli funzionano: poligono non valido e posizione senza consenso rifiutati', async () => {
    const bow = 'SRID=4326;POLYGON((0 0,1 1,1 0,0 1,0 0))';
    await expect(up.query(`insert into areas (project_id, name, geom) values ($1, 'X', extensions.ST_GeomFromEWKT($2))`, [ids.project, bow])).rejects.toThrow(/areas_geom_check/);
    await expect(up.query(`insert into areas (project_id, name) values ($1, 'senza geometria')`, [ids.project])).rejects.toThrow(/null/i);
    await expect(up.query(`insert into field_observations (project_id, observed_at, category, location) values ($1, now(), 'x', extensions.ST_GeomFromEWKT($2))`, [ids.project, PT])).rejects.toThrow(/field_observations_check/);
    await expect(up.query(`insert into sensors (project_id, variable, unit, location) values ($1, 'v', 'u', extensions.ST_GeomFromEWKT('SRID=3857;POINT(1 1)'))`, [ids.project])).rejects.toThrow(/SRID/i);
  });

  it('nuova sessione: il database aggiornato si riapre come da una nuova connessione', async () => {
    up = await reopen(up);
    await actAs(up, 'superuser');
    // search_path predefinito di Supabase per i ruoli dell’API: "$user", public, extensions
    await up.exec('set search_path = public, extensions');
    expect((await one<{ n: number }>(up, 'select count(*)::int n from areas')).n).toBe(1);
  });

  it('funzioni spaziali: distanza, intersezione, validità e indice GiST utilizzabile', async () => {
    const r = await one<{ d: number; i: boolean; v: boolean }>(
      up,
      `select extensions.ST_Distance(a.geom::extensions.geography, s.location::extensions.geography) d, extensions.ST_Intersects(a.geom, s.location) i, extensions.ST_IsValid(a.geom) v from areas a, sensors s where a.id = $1 and s.id = $2`,
      [ids.area, ids.sensor],
    );
    expect(r).toEqual({ d: 0, i: true, v: true });
    await up.exec('set enable_seqscan = off');
    const plan = await up.query<{ 'QUERY PLAN': string }>(`explain select id from areas where geom && extensions.ST_MakeEnvelope(14.6, 41.5, 14.7, 41.6, 4326)`);
    await up.exec('reset enable_seqscan');
    expect(plan.rows.map((x) => x['QUERY PLAN']).join(' ')).toMatch(/areas_geom_idx/);
    // operatore qualificato: funziona anche senza extensions nel search_path
    await up.exec('set search_path = public');
    const q = await up.query(`select id from areas where geom OPERATOR(extensions.&&) extensions.ST_MakeEnvelope(14.6, 41.5, 14.7, 41.6, 4326)`);
    expect(q.rows).toHaveLength(1);
    await up.exec('set search_path = public, extensions');
  });

  it('save_project (usa ST_*) funziona dopo lo spostamento e salva area e geometria', async () => {
    const uid = '00000000-0000-4000-8000-00000000a11c';
    await createAuthUser(up, uid, 'alice@a.it');
    await actAs(up, { id: uid });
    const org = (await one<{ id: string }>(up, `select public.create_organization('Comune A') as id`)).id;
    const b = seedCampobasso(new Date('2026-10-24T08:00:00Z'));
    await up.query('select public.save_project($1, $2, $3, 0)', [org, JSON.stringify(b), hashOf(b)]);
    await actAs(up, 'superuser');
    const p = await one<{ srid: number; m2: number; cfg: string[] }>(
      up,
      `select extensions.ST_SRID(area_geom) srid, area_m2 m2, (select proconfig from pg_proc where oid = 'public.save_project(uuid,jsonb,text,integer)'::regprocedure) cfg from projects where id = $1`,
      [b.project.id],
    );
    expect(p.srid).toBe(4326);
    expect(p.m2).toBeGreaterThan(0);
    expect(p.cfg).toEqual(['search_path=public, extensions']);
  });

  it('una seconda applicazione si ferma alla precondizione senza modificare nulla', async () => {
    await expect(up.exec(MIG_0009)).rejects.toThrow(/Precondizione non soddisfatta: PostGIS è nello schema extensions/);
  });
});

describe('Migrazione 0009 — installazione pulita 0001–0009', () => {
  let fresh: PGlite;
  beforeAll(async () => {
    fresh = await createDb();
  }, 180_000);

  it('nessuna funzione o colonna dell’app dipende da public.geometry', async () => {
    await actAs(fresh, 'superuser');
    const cols = await fresh.query<{ t: string }>(
      `select format_type(a.atttypid, a.atttypmod) t from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and format_type(a.atttypid, a.atttypmod) ~* 'geometry|geography'`,
    );
    expect(cols.rows.length).toBe(9);
    for (const c of cols.rows) expect(c.t).toMatch(/^extensions\.geometry\(/);
    const fns = await fresh.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app') and p.prosrc ~* 'public\\.(st_|geometry|geography)'
         and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`,
    );
    expect(fns.rows).toEqual([]);
  });
});
