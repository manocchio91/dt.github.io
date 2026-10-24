import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { actAs, createDb } from './harness';

/** Migrazione 0008: correzioni del Security Advisor (verificate su PGlite; su Supabase con db advisors). */
let db: PGlite;
beforeAll(async () => {
  db = await createDb();
}, 180_000);

describe('Correzioni del Security Advisor', () => {
  it('spatial_ref_sys: RLS attiva, lettura consentita, nessuna scrittura per anon e authenticated', async () => {
    await actAs(db, 'superuser');
    const t = (await db.query<{ rls: boolean }>(`select relrowsecurity as rls from pg_class where oid = 'public.spatial_ref_sys'::regclass`)).rows[0]!;
    expect(t.rls).toBe(true);
    for (const who of ['anon', { id: '00000000-0000-4000-8000-00000000a11c' }] as const) {
      await actAs(db, who);
      await expect(db.query('select srid from spatial_ref_sys where srid = 4326')).resolves.toMatchObject({ rows: [{ srid: 4326 }] });
      await expect(db.query(`delete from spatial_ref_sys where srid = 4326`)).rejects.toThrow();
      await expect(db.query(`insert into spatial_ref_sys (srid, auth_name, auth_srid) values (999999, 'x', 1)`)).rejects.toThrow();
    }
  });

  it('search_path fissato sulle funzioni segnalate', async () => {
    await actAs(db, 'superuser');
    const r = await db.query<{ f: string; cfg: string[] | null }>(
      `select p.oid::regprocedure::text f, p.proconfig cfg from pg_proc p
       where p.oid in ('public.forbid_baseline_update()'::regprocedure, 'app.try_uuid(text)'::regprocedure, 'app.touch_user_preferences()'::regprocedure, 'app.is_service_role()'::regprocedure)`,
    );
    expect(r.rows).toHaveLength(4);
    for (const row of r.rows) expect(row.cfg, row.f).toContain('search_path=public');
  });

  it('st_estimatedextent non eseguibile da anon e authenticated', async () => {
    await actAs(db, 'superuser');
    const r = await db.query<{ anon: boolean; auth: boolean }>(
      `select bool_or(has_function_privilege('anon', p.oid, 'execute')) anon, bool_or(has_function_privilege('authenticated', p.oid, 'execute')) auth from pg_proc p where p.proname = 'st_estimatedextent'`,
    );
    expect(r.rows[0]).toEqual({ anon: false, auth: false });
  });
});
