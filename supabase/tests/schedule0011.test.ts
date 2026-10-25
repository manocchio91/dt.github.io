import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { actAs, createDb } from './harness';

/** Migrazione 0011: pianificazione Open-Meteo ogni 3 ore, senza segreti nel repository. */
const sql = readFileSync(join(import.meta.dirname, '..', 'migrations', '20261025000011_open_meteo_schedule.sql'), 'utf8');
let db: PGlite;
beforeAll(async () => {
  db = await createDb();
}, 180_000);

describe('Pianificazione Open-Meteo (0011)', () => {
  it('nel file nessun segreto, chiave o URL: solo i nomi dei valori nel Vault', () => {
    expect(sql).not.toMatch(/https?:\/\//);
    expect(sql).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|sb_(secret|publishable)_|service_role_key|password/i);
    expect(sql).toContain("name = 'open_meteo_ingest_url'");
    expect(sql).toContain("name = 'open_meteo_cron_secret'");
  });

  it('ogni 3 ore, job unico e solo con URL e segreto presenti', () => {
    expect(sql).toContain("'0 */3 * * *'");
    expect(sql).not.toMatch(/\* \* \* \* \*/);
    expect(sql).toMatch(/if exists \(select 1 from cron\.job where jobname = 'mdt-open-meteo-ingest'\) then\s+perform cron\.unschedule/);
    expect(sql).toContain('where s.url is not null and s.secret is not null');
    expect(sql).toContain('{"all_active": true}');
  });

  it('senza pg_cron (PGlite) la migrazione si applica e lo stato lo dichiara', async () => {
    await actAs(db, 'service');
    const r = await db.query<{ s: Record<string, unknown> }>('select public.weather_schedule_status() s');
    expect(r.rows[0]!.s).toEqual({ pianificazione: 'non disponibile' });
  });

  it('lo stato della pianificazione è riservato al ruolo di servizio', async () => {
    await actAs(db, { id: '00000000-0000-4000-8000-00000000a11c' });
    await expect(db.query('select public.weather_schedule_status()')).rejects.toThrow();
    await actAs(db, 'anon');
    await expect(db.query('select public.weather_schedule_status()')).rejects.toThrow();
  });
});
