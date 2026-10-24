import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { actAs, createDb } from './harness';

/** Migrazione 0008: correzioni del Security Advisor applicabili senza essere proprietari degli oggetti di PostGIS. */
let db: PGlite;
beforeAll(async () => {
  db = await createDb();
}, 180_000);

describe('Correzioni del Security Advisor', () => {
  it('search_path fissato sulle funzioni segnalate', async () => {
    await actAs(db, 'superuser');
    const r = await db.query<{ f: string; cfg: string[] | null }>(
      `select p.oid::regprocedure::text f, p.proconfig cfg from pg_proc p
       where p.oid in ('public.forbid_baseline_update()'::regprocedure, 'app.try_uuid(text)'::regprocedure, 'app.touch_user_preferences()'::regprocedure, 'app.is_service_role()'::regprocedure)`,
    );
    expect(r.rows).toHaveLength(4);
    for (const row of r.rows) expect(row.cfg, row.f).toContain('search_path=public');
  });

  it('le funzioni continuano a funzionare con il search_path fisso', async () => {
    await actAs(db, 'superuser');
    const r = await db.query<{ u: string | null; bad: string | null }>(`select app.try_uuid('00000000-0000-4000-8000-000000000001')::text u, app.try_uuid('x')::text bad`);
    expect(r.rows[0]).toEqual({ u: '00000000-0000-4000-8000-000000000001', bad: null });
    // is_service_role è usata dentro funzioni SECURITY DEFINER: per il servizio restituisce l'elenco, per un utente niente
    await actAs(db, 'service');
    expect((await db.query<{ r: string[] }>('select public.weather_active_locations() r')).rows[0]!.r).toEqual([]);
    await actAs(db, { id: '00000000-0000-4000-8000-00000000a11c' });
    expect((await db.query<{ s: boolean }>('select app.is_service_role() s')).rows[0]!.s).toBe(false);
  });
});
