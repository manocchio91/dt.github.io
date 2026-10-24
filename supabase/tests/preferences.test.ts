import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { finalizeOnboarding } from '@mdt/domain';
import { actAs, createAuthUser, createDb } from './harness';

const U = { admin: '00000000-0000-4000-8000-0000000000a2', viewer: '00000000-0000-4000-8000-0000000000f2', other: '00000000-0000-4000-8000-0000000000c2' };
let db: PGlite;
let org: string;

const prefs = (profile: 'tecnico_comunale' | 'revisore' | 'agronomo', extra: Record<string, unknown> = {}) => ({
  ...finalizeOnboarding(
    profile === 'agronomo'
      ? { profile, sector: 'agriculture', decision: 'zona_da_controllare', area: { kind: 'demo' }, data: [], mode: 'tecnica' }
      : { profile, sector: 'urban', decision: 'ridurre_calore', area: { kind: 'demo' }, data: [], mode: 'guidata' },
    new Date('2026-10-24T10:00:00Z'),
  ),
  ...extra,
});

async function upsert(userId: string, p: Record<string, unknown>) {
  await db.query(
    `insert into user_preferences (user_id, profile, sector, mode, preferences) values ($1, $2, $3, $4, $5)
     on conflict (user_id) do update set profile = excluded.profile, sector = excluded.sector, mode = excluded.mode, preferences = excluded.preferences`,
    [userId, p.profile, p.sector, p.mode, JSON.stringify(p)],
  );
}

const roleOf = async (userId: string) => {
  await actAs(db, 'superuser');
  return (await db.query<{ role: string }>('select role from memberships where organization_id = $1 and user_id = $2', [org, userId])).rows[0]?.role;
};

beforeAll(async () => {
  db = await createDb();
  await createAuthUser(db, U.admin, 'admin@c.it');
  await createAuthUser(db, U.viewer, 'viewer@c.it');
  await createAuthUser(db, U.other, 'other@c.it');
  await actAs(db, { id: U.admin });
  org = (await db.query<{ id: string }>(`select public.create_organization('Comune C') as id`)).rows[0]!.id;
  await db.query(`select public.add_member_by_email($1, 'viewer@c.it', 'viewer')`, [org]);
}, 180_000);

describe('Preferenze di onboarding su Supabase', () => {
  it("l'utente salva e rilegge il proprio profilo", async () => {
    await actAs(db, { id: U.viewer });
    await upsert(U.viewer, prefs('tecnico_comunale'));
    const r = await db.query<{ profile: string; preferences: { decision: string } }>('select profile, preferences from user_preferences');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ profile: 'tecnico_comunale', preferences: { decision: 'ridurre_calore' } });
  });

  it('può modificarle in seguito', async () => {
    await actAs(db, { id: U.viewer });
    await upsert(U.viewer, prefs('agronomo'));
    const r = await db.query<{ sector: string; mode: string }>('select sector, mode from user_preferences');
    expect(r.rows[0]).toEqual({ sector: 'agriculture', mode: 'tecnica' });
  });

  it('scegliere il profilo "revisore" non cambia il ruolo di autorizzazione', async () => {
    await actAs(db, { id: U.viewer });
    await upsert(U.viewer, prefs('revisore'));
    expect(await roleOf(U.viewer)).toBe('viewer');
    await actAs(db, { id: U.viewer });
    await expect(db.query('select public.save_project($1, $2, $3, 0)', [org, JSON.stringify({ project: { id: '00000000-0000-4000-8000-0000000000aa', name: 'x', sector: 'urban' } }), 'h'])).rejects.toThrow(/Permesso negato/);
  });

  it('campi che somigliano a permessi sono rifiutati dal database', async () => {
    await actAs(db, { id: U.viewer });
    await expect(upsert(U.viewer, prefs('revisore', { role: 'admin' }))).rejects.toThrow(/check constraint/);
    await expect(upsert(U.viewer, prefs('revisore', { organization_id: org }))).rejects.toThrow(/check constraint/);
    expect(await roleOf(U.viewer)).toBe('viewer');
  });

  it('colonne e documento devono coincidere', async () => {
    await actAs(db, { id: U.viewer });
    await expect(
      db.query(`update user_preferences set profile = 'agronomo' where user_id = $1`, [U.viewer]),
    ).rejects.toThrow(/check constraint/);
  });

  it('nessuno legge o scrive le preferenze altrui, neanche un admin', async () => {
    await actAs(db, { id: U.admin });
    expect((await db.query('select * from user_preferences')).rows).toEqual([]);
    await expect(upsert(U.viewer, prefs('agronomo'))).rejects.toThrow(/row-level security/);
    await actAs(db, { id: U.other });
    expect((await db.query('select * from user_preferences where user_id = $1', [U.viewer])).rows).toEqual([]);
    await actAs(db, 'anon');
    expect((await db.query('select * from user_preferences')).rows).toEqual([]);
  });

  it('un utente non può auto-promuoversi scrivendo in memberships', async () => {
    await actAs(db, { id: U.viewer });
    await expect(db.query(`update memberships set role = 'admin' where user_id = $1`, [U.viewer])).resolves.toMatchObject({ affectedRows: 0 });
    await expect(db.query(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin')`, [org, U.other])).rejects.toThrow(/row-level security/);
    expect(await roleOf(U.viewer)).toBe('viewer');
  });
});
