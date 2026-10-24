import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { seedVineyard, withAudit } from '@mdt/domain';
import { ConflictError, PermissionError, SupabaseRepository } from '../../apps/web/src/state/supabaseRepository';
import type { SupabaseLike } from '../../apps/web/src/state/supabase';
import { actAs, createAuthUser, createDb } from './harness';
import { pgliteClient } from './pgliteClient';

/** SupabaseRepository dell'app contro il database reale con RLS (PGlite). */
const U = { admin: '00000000-0000-4000-8000-0000000000a1', editor: '00000000-0000-4000-8000-0000000000e1', viewer: '00000000-0000-4000-8000-0000000000f1' };
let db: PGlite;
let org: string;
const client = () => pgliteClient(db) as unknown as SupabaseLike;

beforeAll(async () => {
  db = await createDb();
  await createAuthUser(db, U.admin, 'admin@vigneto.it');
  await createAuthUser(db, U.editor, 'editor@vigneto.it');
  await createAuthUser(db, U.viewer, 'viewer@vigneto.it');
  await actAs(db, { id: U.admin });
  org = (await db.query<{ id: string }>(`select public.create_organization('Azienda agricola DEMO') as id`)).rows[0]!.id;
  await db.query(`select public.add_member_by_email($1, 'editor@vigneto.it', 'editor')`, [org]);
  await db.query(`select public.add_member_by_email($1, 'viewer@vigneto.it', 'viewer')`, [org]);
}, 180_000);

describe('SupabaseRepository (end-to-end su Postgres con RLS)', () => {
  const bundle = seedVineyard(new Date('2026-08-20T08:00:00Z'), '2026-08-20');

  it('editor: salva, rilegge e aggiorna con versione', async () => {
    await actAs(db, { id: U.editor });
    const repo = new SupabaseRepository(client(), org);
    await repo.save(bundle);
    expect(repo.versionOf(bundle.project.id)).toBe(1);
    const again = await repo.get(bundle.project.id);
    expect(again?.agri?.zones).toHaveLength(2);
    await repo.save(withAudit(bundle, 'test', 'secondo salvataggio', new Date()));
    expect(repo.versionOf(bundle.project.id)).toBe(2);
    expect((await repo.list()).map((b) => b.project.id)).toEqual([bundle.project.id]);
  });

  it('due sessioni concorrenti: la seconda riceve ConflictError', async () => {
    await actAs(db, { id: U.editor });
    const a = new SupabaseRepository(client(), org);
    const b = new SupabaseRepository(client(), org);
    const base = (await a.get(bundle.project.id))!;
    await b.get(bundle.project.id);
    await a.save(withAudit(base, 'a', 'modifica A', new Date()));
    await expect(b.save(withAudit(base, 'b', 'modifica B', new Date()))).rejects.toBeInstanceOf(ConflictError);
  });

  it('viewer: legge, ma il salvataggio è rifiutato', async () => {
    await actAs(db, { id: U.viewer });
    const repo = new SupabaseRepository(client(), org);
    const list = await repo.list();
    expect(list).toHaveLength(1);
    await expect(repo.save(withAudit(list[0]!, 'x', 'tentativo', new Date()))).rejects.toBeInstanceOf(PermissionError);
    const other = seedVineyard(new Date(), '2026-08-20');
    await expect(repo.save(other)).rejects.toBeInstanceOf(PermissionError);
  });

  it('eliminazione: editor rifiutato con PermissionError, admin consentito', async () => {
    await actAs(db, { id: U.editor });
    await expect(new SupabaseRepository(client(), org).remove(bundle.project.id)).rejects.toBeInstanceOf(PermissionError);
    await actAs(db, { id: U.admin });
    const repo = new SupabaseRepository(client(), org);
    await repo.remove(bundle.project.id);
    expect(await repo.list()).toEqual([]);
  });

  it('un utente esterno vede un archivio vuoto', async () => {
    await createAuthUser(db, '00000000-0000-4000-8000-0000000000ee', 'esterno@altro.it');
    await actAs(db, { id: '00000000-0000-4000-8000-0000000000ee' });
    expect(await new SupabaseRepository(client(), org).list()).toEqual([]);
  });
});
