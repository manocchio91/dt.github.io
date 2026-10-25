import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { hashOf, seedCampobasso, withAudit, type ProjectBundle } from '@mdt/domain';
import { actAs, createAuthUser, createDb } from './harness';
import { pgliteClient } from './pgliteClient';
import { ConflictError, SupabaseRepository } from '../../apps/web/src/state/supabaseRepository';

/**
 * Migrazione 0010: conflitto di versione (PT409), ultimo amministratore con verifica differita,
 * eliminazione dell'organizzazione, cancellazione dell'utente senza perdita delle risorse.
 */
const ids = {
  alice: '00000000-0000-4000-8000-00000000a11c', // admin A
  anna: '00000000-0000-4000-8000-00000000a22a', // editor A
  dave: '00000000-0000-4000-8000-00000000da7e', // editor A
  carol: '00000000-0000-4000-8000-0000000ca201', // viewer A
  bob: '00000000-0000-4000-8000-000000000b0b', // admin B
};

let db: PGlite;
let orgA: string;
let orgB: string;
const one = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]!;
const count = async (sql: string, p: unknown[] = []) => (await one<{ n: number }>(`select count(*)::int n from (${sql}) x`, p)).n;
const pgError = async (sql: string, p: unknown[] = []) => {
  try {
    await db.query(sql, p);
    return null;
  } catch (e) {
    return e as { code?: string; message: string; detail?: string; hint?: string };
  }
};

beforeAll(async () => {
  db = await createDb();
  for (const [k, email] of [['alice', 'alice@a.it'], ['anna', 'anna@a.it'], ['dave', 'dave@a.it'], ['carol', 'carol@a.it'], ['bob', 'bob@b.it']] as const) await createAuthUser(db, ids[k], email);
  await actAs(db, { id: ids.alice });
  orgA = (await one<{ id: string }>(`select public.create_organization('Comune A') as id`)).id;
  await db.query(`select public.add_member_by_email($1, 'anna@a.it', 'editor')`, [orgA]);
  await db.query(`select public.add_member_by_email($1, 'dave@a.it', 'editor')`, [orgA]);
  await db.query(`select public.add_member_by_email($1, 'carol@a.it', 'viewer')`, [orgA]);
  await actAs(db, { id: ids.bob });
  orgB = (await one<{ id: string }>(`select public.create_organization('Comune B') as id`)).id;
}, 180_000);

describe('Difetto 1 — conflitto di versione: PT409 (HTTP 409 con PostgREST), mai 40001', () => {
  let bundle: ProjectBundle;

  it('due editor della stessa organizzazione: il secondo salvataggio riceve PT409 con dettagli e hint stabili', async () => {
    bundle = seedCampobasso(new Date('2026-10-25T08:00:00Z'));
    await actAs(db, { id: ids.anna });
    await db.query('select public.save_project($1, $2, $3, 0)', [orgA, JSON.stringify(bundle), hashOf(bundle)]);
    const v2 = withAudit(bundle, 'a', 'modifica di Anna', new Date());
    await db.query('select public.save_project($1, $2, $3, 1)', [orgA, JSON.stringify(v2), hashOf(v2)]);
    await actAs(db, { id: ids.dave });
    const e = await pgError('select public.save_project($1, $2, $3, 1)', [orgA, JSON.stringify(bundle), hashOf(bundle)]);
    expect(e?.code).toBe('PT409');
    expect(e?.code).not.toBe('40001');
    expect(e?.message).toBe('Il progetto è stato aggiornato da un’altra persona.'.replace('’', "'"));
    expect(e?.hint).toBe('MDT_CONFLITTO_VERSIONE');
    const d = JSON.parse(e!.detail!);
    expect(d).toMatchObject({ codice: 'MDT_CONFLITTO_VERSIONE', versione_attesa: 1, versione_trovata: 2 });
    expect(typeof d.aggiornato_il).toBe('string');
    // nessun dettaglio interno del database nel messaggio
    expect(JSON.stringify(e)).not.toMatch(/project_documents|plpgsql|LINE \d/);
  });

  it('nessuna modifica ai dati in caso di conflitto', async () => {
    await actAs(db, 'superuser');
    const r = await one<{ version: number; n: number }>(`select version, jsonb_array_length(bundle -> 'audit') n from project_documents where project_id = $1`, [bundle.project.id]);
    expect(r.version).toBe(2);
    expect(r.n).toBe(bundle.audit.length + 1);
  });

  it('il client riconosce il conflitto con i dettagli tecnici (versione attesa e trovata)', async () => {
    const a = new SupabaseRepository(pgliteClient(db, { as: { id: ids.anna } }) as never, orgA);
    const b = new SupabaseRepository(pgliteClient(db, { as: { id: ids.dave } }) as never, orgA);
    const base = (await a.get(bundle.project.id))!;
    await b.get(bundle.project.id);
    await a.save(withAudit(base, 'a', 'seconda modifica di Anna', new Date()));
    const err = await b.save(withAudit(base, 'b', 'modifica di Dave', new Date())).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).message).toBe('Questo progetto è stato aggiornato da un’altra persona. Ricarica i dati prima di salvare nuovamente.');
    expect((err as ConflictError).info).toMatchObject({ codice: 'MDT_CONFLITTO_VERSIONE', versioneAttesa: 2, versioneTrovata: 3 });
  });

  it('isolamento: un’altra organizzazione non scopre l’esistenza né la versione del progetto', async () => {
    await actAs(db, { id: ids.bob });
    const e = await pgError('select public.save_project($1, $2, $3, 1)', [orgB, JSON.stringify(bundle), hashOf(bundle)]);
    expect(e?.code).toBe('PT409');
    expect(JSON.parse(e!.detail!)).toMatchObject({ versione_trovata: null, aggiornato_il: null });
  });

  it('nessuna funzione dell’app usa più SQLSTATE 40001', async () => {
    await actAs(db, 'superuser');
    expect(await count(`select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app') and p.prosrc like '%40001%'`)).toBe(0);
  });
});

describe('Difetto 2 — ultimo amministratore e eliminazione dell’organizzazione', () => {
  it('un’organizzazione esistente non può restare senza amministratori (rimozione o declassamento)', async () => {
    await actAs(db, { id: ids.alice });
    expect((await pgError(`delete from memberships where organization_id = $1 and user_id = $2`, [orgA, ids.alice]))?.message).toMatch(/almeno un amministratore/);
    expect((await pgError(`update memberships set role = 'editor' where organization_id = $1 and user_id = $2`, [orgA, ids.alice]))?.message).toMatch(/almeno un amministratore/);
    await actAs(db, 'superuser');
    expect(await count(`select 1 from memberships where organization_id = $1 and role = 'admin'`, [orgA])).toBe(1);
  });

  it('con un secondo amministratore il primo può lasciare il ruolo', async () => {
    await actAs(db, { id: ids.alice });
    await db.query(`select public.add_member_by_email($1, 'anna@a.it', 'admin')`, [orgA]);
    await db.query(`update memberships set role = 'editor' where organization_id = $1 and user_id = $2`, [orgA, ids.alice]);
    await actAs(db, { id: ids.anna });
    await db.query(`update memberships set role = 'admin' where organization_id = $1 and user_id = $2`, [orgA, ids.alice]);
  });

  it('solo un amministratore elimina, con il nome esatto come conferma', async () => {
    await actAs(db, { id: ids.dave });
    expect((await pgError(`select public.delete_organization($1, 'Comune A')`, [orgA]))?.code).toBe('42501');
    await actAs(db, { id: ids.carol });
    expect((await pgError(`select public.delete_organization($1, 'Comune A')`, [orgA]))?.code).toBe('42501');
    await actAs(db, { id: ids.bob });
    expect((await pgError(`select public.delete_organization($1, 'Comune A')`, [orgA]))?.code).toBe('42501');
    expect((await pgError(`delete from organizations where id = $1`, [orgA]))).toBeNull(); // nessuna policy: 0 righe
    await actAs(db, { id: ids.alice });
    expect((await pgError(`select public.delete_organization($1, 'Comune')`, [orgA]))?.code).toBe('22023');
    await actAs(db, 'superuser');
    expect(await count('select 1 from organizations where id = $1', [orgA])).toBe(1);
  });

  it('con file presenti l’eliminazione si ferma (i file si rimuovono dal gateway)', async () => {
    await actAs(db, 'superuser');
    const t = await one<{ id: string }>(`insert into organizations (name) values ('Temporanea con file') returning id`);
    await db.query(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin')`, [t.id, ids.bob]);
    await db.query(`insert into storage.objects (bucket_id, name) values ('project-media', $1)`, [`${t.id}/x/y.jpg`]);
    await actAs(db, { id: ids.bob });
    expect((await pgError(`select public.delete_organization($1, 'Temporanea con file')`, [t.id]))?.code).toBe('55000');
    await actAs(db, 'superuser');
    await db.query(`delete from storage.objects where name = $1`, [`${t.id}/x/y.jpg`]);
    await actAs(db, { id: ids.bob });
    await db.query(`select public.delete_organization($1, 'Temporanea con file')`, [t.id]);
  });

  it('eliminazione completa: cascata su membri, progetti, previsioni, meteo; audit minimo conservato', async () => {
    await actAs(db, { id: ids.bob });
    const t = (await one<{ id: string }>(`select public.create_organization('Temporanea completa') as id`)).id;
    const b = seedCampobasso(new Date('2026-10-25T09:00:00Z'));
    b.project.id = '00000000-0000-4000-8000-0000000000f1';
    await db.query('select public.save_project($1, $2, $3, 0)', [t, JSON.stringify(b), hashOf(b)]);
    await db.query(`insert into weather_locations (organization_id, project_id, name, scope, latitude, longitude) values ($1, $2, 'P', 'urban', 41.5, 14.6)`, [t, b.project.id]);
    const summary = (await one<{ s: Record<string, number> }>(`select public.delete_organization($1, 'Temporanea completa') s`, [t])).s;
    expect(summary).toMatchObject({ progetti: 1, membri: 1, localita_meteo: 1 });
    await actAs(db, 'superuser');
    for (const tbl of ['organizations', 'memberships', 'projects', 'project_documents', 'weather_locations']) {
      expect(await count(`select 1 from ${tbl} where ${tbl === 'organizations' ? 'id' : 'organization_id'} = $1`, [t]), tbl).toBe(0);
    }
    const audit = await one<{ organization_id: string | null; actor_id: string; details: Record<string, unknown> }>(
      `select organization_id, actor_id, details from audit_logs where entity = 'organizations' and entity_id = $1 and action = 'delete'`,
      [t],
    );
    expect(audit).toMatchObject({ organization_id: null, actor_id: ids.bob });
    expect(audit.details).toMatchObject({ progetti: 1, membri: 1 });
    // le righe di audit della cascata restano senza legame, con traccia dell'organizzazione eliminata
    expect(await count(`select 1 from audit_logs where organization_id is null and details ->> 'organizzazione_eliminata' = $1`, [t])).toBeGreaterThan(0);
    expect(await count(`select 1 from audit_logs where organization_id = $1`, [t])).toBe(0);
  });

  it('servizio (Admin API) può eliminare un’organizzazione, sempre con conferma del nome', async () => {
    await actAs(db, 'superuser');
    const t = await one<{ id: string }>(`insert into organizations (name) values ('Temporanea servizio') returning id`);
    await db.query(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin')`, [t.id, ids.bob]);
    await actAs(db, 'service');
    expect((await pgError(`select public.delete_organization($1, 'x')`, [t.id]))?.code).toBe('22023');
    await db.query(`select public.delete_organization($1, 'Temporanea servizio')`, [t.id]);
    await actAs(db, 'superuser');
    expect(await count('select 1 from organizations where id = $1', [t.id])).toBe(0);
  });
});

describe('Difetto 3 — cancellazione dell’utente', () => {
  it('utente proprietario di un progetto: il progetto resta, owner_id e riferimenti diventano NULL', async () => {
    const u = '00000000-0000-4000-8000-0000000e1e11';
    await createAuthUser(db, u, 'eli@a.it');
    await actAs(db, { id: ids.alice });
    await db.query(`select public.add_member_by_email($1, 'eli@a.it', 'editor')`, [orgA]);
    await actAs(db, { id: u });
    const b = seedCampobasso(new Date('2026-10-25T10:00:00Z'));
    b.project.id = '00000000-0000-4000-8000-0000000000e2';
    await db.query('select public.save_project($1, $2, $3, 0)', [orgA, JSON.stringify(b), hashOf(b)]);
    const loc = (await one<{ id: string }>(`insert into weather_locations (organization_id, project_id, name, scope, latitude, longitude) values ($1, $2, 'P', 'urban', 41.5, 14.6) returning id`, [orgA, b.project.id])).id;
    await db.query(`insert into weather_observations (organization_id, location_id, observed_at, variable, value, unit, source) values ($1, $2, now(), 'temperature_2m', 18, '°C', 'sensore')`, [orgA, loc]);
    await db.query(
      `insert into forecast_thresholds (organization_id, project_id, context, variable, unit, threshold, direction, min_probability, expert_role, rationale, set_by) values ($1, $2, 'urbano', 'temperatura_aria', '°C', 32, 'sopra', 0.3, 'tecnico comunale', 'Soglia di prova per la cancellazione', $3)`,
      [orgA, b.project.id, u],
    );
    await actAs(db, 'superuser');
    expect(await count('select 1 from audit_logs where actor_id = $1', [u])).toBeGreaterThan(0);

    await db.query('delete from auth.users where id = $1', [u]);

    const p = await one<{ owner_id: string | null; updated_by: string | null }>('select owner_id, updated_by from projects where id = $1', [b.project.id]);
    expect(p).toEqual({ owner_id: null, updated_by: null });
    expect(await count('select 1 from project_documents where project_id = $1 and updated_by is null', [b.project.id])).toBe(1);
    expect(await count('select 1 from forecast_thresholds where project_id = $1 and set_by is null', [b.project.id])).toBe(1);
    expect(await count('select 1 from weather_observations where location_id = $1 and created_by is null', [loc])).toBe(1);
    // nessun dato personale residuo: profilo, appartenenze, preferenze, riferimenti negli audit
    expect(await count('select 1 from public.users where id = $1', [u])).toBe(0);
    expect(await count('select 1 from memberships where user_id = $1', [u])).toBe(0);
    expect(await count('select 1 from user_preferences where user_id = $1', [u])).toBe(0);
    expect(await count('select 1 from audit_logs where actor_id = $1', [u])).toBe(0);
    expect(await count(`select 1 from audit_logs where details::text like '%eli@a.it%'`)).toBe(0);
  });

  it('un client non può azzerare i riferimenti di un utente ancora esistente (le guardie restano attive)', async () => {
    await actAs(db, { id: ids.alice });
    const pid = (await one<{ id: string }>(`select id from projects where organization_id = $1 limit 1`, [orgA])).id;
    const r = await one<{ id: string }>(
      `insert into forecast_thresholds (organization_id, project_id, context, variable, unit, threshold, direction, min_probability, expert_role, rationale, set_by) values ($1, $2, 'urbano', 'temperatura_aria', '°C', 30, 'sopra', 0.3, 'tecnico comunale', 'Soglia per il test delle guardie', $3) returning id`,
      [orgA, pid, ids.alice],
    );
    expect((await pgError(`update forecast_thresholds set set_by = null where id = $1`, [r.id]))?.message).toMatch(/versionate/);
    const doc = (await one<{ project_id: string }>(`select project_id from project_documents where updated_by is not null limit 1`)).project_id;
    await actAs(db, { id: ids.alice });
    expect((await pgError(`update project_documents set updated_by = null where project_id = $1`, [doc]))?.code).toBe('PT409');
  });

  it('l’unico amministratore di un’organizzazione esistente non può essere cancellato', async () => {
    await actAs(db, 'superuser');
    expect((await pgError('delete from auth.users where id = $1', [ids.bob]))?.message).toMatch(/almeno un amministratore/);
    expect(await count('select 1 from auth.users where id = $1', [ids.bob])).toBe(1);
  });

  it('un amministratore con un altro amministratore nella stessa organizzazione può essere cancellato', async () => {
    await actAs(db, 'superuser');
    expect(await count(`select 1 from memberships where organization_id = $1 and role = 'admin'`, [orgA])).toBe(2);
    await db.query('delete from auth.users where id = $1', [ids.anna]);
    expect(await count(`select 1 from memberships where organization_id = $1 and role = 'admin'`, [orgA])).toBe(1);
  });

  it('organizzazione intera e poi i suoi membri: nessun residuo', async () => {
    await actAs(db, { id: ids.bob });
    await db.query(`select public.delete_organization($1, 'Comune B')`, [orgB]);
    await actAs(db, 'superuser');
    await db.query('delete from auth.users where id = $1', [ids.bob]);
    expect(await count('select 1 from organizations where id = $1', [orgB])).toBe(0);
    expect(await count('select 1 from public.users where id = $1', [ids.bob])).toBe(0);
  });
});

describe('Migrazione 0010 — aggiornamento da 0009 e PostGIS', () => {
  it('si applica su uno stato 0001–0009 e PostGIS resta in extensions con geometrie funzionanti', async () => {
    const up = await createDb({ upTo: '20261024000009' });
    await actAs(up, 'superuser');
    await up.exec(readFileSync(join(import.meta.dirname, '..', 'migrations', '20261024000010_conflict_org_user_deletion.sql'), 'utf8'));
    const r = (await up.query<{ s: string; v: boolean; d: number }>(
      `select extnamespace::regnamespace::text s,
              extensions.st_isvalid(extensions.st_geomfromtext('POLYGON((14.66 41.56,14.67 41.56,14.67 41.57,14.66 41.57,14.66 41.56))', 4326)) v,
              round(extensions.st_distance(extensions.st_setsrid(extensions.st_makepoint(14.663, 41.5606), 4326)::extensions.geography,
                                           extensions.st_setsrid(extensions.st_makepoint(14.67, 41.5606), 4326)::extensions.geography)) d
       from pg_extension where extname = 'postgis'`,
    )).rows[0]!;
    expect(r).toEqual({ s: 'extensions', v: true, d: 584 });
    const trig = await up.query<{ tgname: string; deferrable: boolean }>(`select tgname, tgdeferrable deferrable from pg_trigger where tgname = 'memberships_last_admin'`);
    expect(trig.rows).toEqual([{ tgname: 'memberships_last_admin', deferrable: true }]);
    const save = await up.query<{ cfg: string[] }>(`select proconfig cfg from pg_proc where oid = 'public.save_project(uuid,jsonb,text,integer)'::regprocedure`);
    expect(save.rows[0]!.cfg).toEqual(['search_path=public, extensions']);
  }, 180_000);
});
