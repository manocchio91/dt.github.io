import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { hashOf, polygonFromVertices, seedCampobasso, type ProjectBundle } from '@mdt/domain';
import { actAs, createAuthUser, createDb } from './harness';

const ids = {
  alice: '00000000-0000-4000-8000-00000000a11c',
  bob: '00000000-0000-4000-8000-000000000b0b',
  carol: '00000000-0000-4000-8000-0000000ca201',
  dave: '00000000-0000-4000-8000-00000000da7e',
};

let db: PGlite;
let orgA: string;
let orgB: string;
let bundle: ProjectBundle;
let pid: string;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0]!;
}

async function rows(sql: string, params: unknown[] = []) {
  return (await db.query(sql, params)).rows;
}

async function save(org: string, b: ProjectBundle, expected: number): Promise<number> {
  const r = await one<{ v: number }>('select public.save_project($1, $2, $3, $4) as v', [org, JSON.stringify(b), hashOf(b), expected]);
  return r.v;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

beforeAll(async () => {
  db = await createDb();
  const users = await Promise.all([
    createAuthUser(db, ids.alice, 'alice@comune-a.it'),
  ]);
  void users;
  await createAuthUser(db, ids.bob, 'bob@comune-b.it');
  await createAuthUser(db, ids.carol, 'carol@comune-a.it');
  await createAuthUser(db, ids.dave, 'dave@comune-a.it');

  await actAs(db, { id: ids.alice });
  orgA = (await one<{ id: string }>(`select public.create_organization('Comune A') as id`)).id;
  await db.query(`select public.add_member_by_email($1, 'carol@comune-a.it', 'viewer')`, [orgA]);
  await db.query(`select public.add_member_by_email($1, 'DAVE@comune-a.it', 'editor')`, [orgA]);
  await actAs(db, { id: ids.bob });
  orgB = (await one<{ id: string }>(`select public.create_organization('Comune B') as id`)).id;

  bundle = seedCampobasso(new Date('2026-10-24T08:00:00Z'));
  pid = bundle.project.id;
  await actAs(db, { id: ids.alice });
  await save(orgA, bundle, 0);
}, 180_000);

describe('Provisioning utenti e organizzazioni', () => {
  it('crea il profilo pubblico alla registrazione', async () => {
    await actAs(db, { id: ids.carol });
    const me = await rows('select id, display_name from users where id = $1', [ids.carol]);
    expect(me).toEqual([{ id: ids.carol, display_name: 'carol' }]);
  });

  it('il creatore è admin; i ruoli sono quelli assegnati', async () => {
    await actAs(db, { id: ids.alice });
    const m = await rows('select user_id, role from memberships where organization_id = $1 order by role', [orgA]);
    expect(m).toEqual([
      { user_id: ids.carol, role: 'viewer' },
      { user_id: ids.dave, role: 'editor' },
      { user_id: ids.alice, role: 'admin' },
    ]);
  });

  it('solo un admin aggiunge membri', async () => {
    await actAs(db, { id: ids.carol });
    await expect(db.query(`select public.add_member_by_email($1, 'bob@comune-b.it', 'admin')`, [orgA])).rejects.toThrow(/amministratore/);
    await expect(db.query(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin')`, [orgA, ids.carol])).rejects.toThrow();
  });

  it("non si può rimuovere l'ultimo admin", async () => {
    await actAs(db, { id: ids.alice });
    await expect(db.query('delete from memberships where organization_id = $1 and user_id = $2', [orgA, ids.alice])).rejects.toThrow(/almeno un amministratore/);
  });

  it('un utente non può cambiarsi il ruolo applicativo', async () => {
    await actAs(db, { id: ids.carol });
    await expect(db.query(`update users set app_role = 'admin_platform' where id = $1`, [ids.carol])).rejects.toThrow(/permission denied/);
    await db.query(`update users set display_name = 'Carol V.' where id = $1`, [ids.carol]);
  });
});

describe('Isolamento tra organizzazioni (F26)', () => {
  it('un utente di un altro Comune non vede né progetti, né documenti, né membri', async () => {
    await actAs(db, { id: ids.bob });
    expect(await rows('select id from projects')).toEqual([]);
    expect(await rows('select project_id from project_documents')).toEqual([]);
    expect(await rows('select * from memberships where organization_id = $1', [orgA])).toEqual([]);
    expect(await rows('select * from organizations where id = $1', [orgA])).toEqual([]);
  });

  it('non può scrivere nel tenant altrui', async () => {
    await actAs(db, { id: ids.bob });
    const intruder = { ...clone(bundle), project: { ...bundle.project, id: '00000000-0000-4000-8000-0000000000ff' } };
    await expect(save(orgA, intruder, 0)).rejects.toThrow(/Permesso negato/);
    await expect(save(orgA, bundle, 1)).rejects.toThrow(/Permesso negato/);
    // anche dichiarando la propria organizzazione non può toccare il progetto altrui
    await expect(save(orgB, bundle, 1)).rejects.toThrow(/Conflitto/);
  });

  it('anonimo: nessun accesso alle tabelle e alle funzioni di scrittura', async () => {
    await actAs(db, 'anon');
    expect(await rows('select id from projects')).toEqual([]);
    await expect(db.query(`select public.create_organization('X')`)).rejects.toThrow(/permission denied/);
  });
});

describe('Ruoli nel tenant', () => {
  it('viewer legge ma non scrive', async () => {
    await actAs(db, { id: ids.carol });
    expect(await rows('select id from projects')).toHaveLength(1);
    const doc = await one<{ version: number; bundle: ProjectBundle }>('select version, bundle from project_documents where project_id = $1', [pid]);
    expect(doc.version).toBe(1);
    expect(doc.bundle.baselines[0]!.contentHash).toBe(bundle.baselines[0]!.contentHash);
    await expect(save(orgA, bundle, 1)).rejects.toThrow(/Permesso negato/);
  });

  it('editor salva con controllo di concorrenza ottimistico', async () => {
    await actAs(db, { id: ids.dave });
    const b2 = clone(bundle);
    b2.project.name = 'Piazza — revisione tecnica';
    expect(await save(orgA, b2, 1)).toBe(2);
    await expect(save(orgA, b2, 1)).rejects.toThrow(/Conflitto/);
    const p = await one<{ name: string; area_m2: number }>('select name, area_m2 from projects where id = $1', [pid]);
    expect(p.name).toBe('Piazza — revisione tecnica');
    expect(p.area_m2).toBeGreaterThan(5000);
    bundle = b2;
  });

  it('editor non può eliminare il progetto; admin sì (verificato su un progetto di prova)', async () => {
    const tmp = { ...clone(bundle), project: { ...bundle.project, id: '00000000-0000-4000-8000-00000000077a', name: 'tmp' } };
    await actAs(db, { id: ids.dave });
    await save(orgA, tmp, 0);
    await db.query('delete from projects where id = $1', [tmp.project.id]);
    expect(await rows('select id from projects where id = $1', [tmp.project.id])).toHaveLength(1);
    await actAs(db, { id: ids.alice });
    await db.query('delete from projects where id = $1', [tmp.project.id]);
    expect(await rows('select id from projects where id = $1', [tmp.project.id])).toHaveLength(0);
  });
});

describe('Integrità del documento lato server', () => {
  it('rifiuta la modifica di una baseline salvata', async () => {
    await actAs(db, { id: ids.dave });
    const b = clone(bundle);
    (b.baselines[0] as { periodEnd: string }).periodEnd = '2025-09-30';
    await expect(save(orgA, b, 2)).rejects.toThrow(/immutabile/);
    const removed = { ...clone(bundle), baselines: [] };
    await expect(save(orgA, removed, 2)).rejects.toThrow(/immutabile/);
  });

  it('accetta una nuova versione aggiunta accanto alla precedente', async () => {
    await actAs(db, { id: ids.dave });
    const b = clone(bundle);
    b.baselines.push({ ...clone(b.baselines[0]!), id: 'bl-v2', version: 2, parentId: b.baselines[0]!.id });
    expect(await save(orgA, b, 2)).toBe(3);
    bundle = b;
  });

  it('decisioni e audit sono append-only', async () => {
    await actAs(db, { id: ids.dave });
    const b = clone(bundle);
    b.decisions.push({
      id: 'd1', projectId: pid, sector: 'urban', alternatives: ['a', 'b'], chosen: 'a', outcome: 'accettata',
      rationale: 'Scelgo A per ombra a maturità e OPEX inferiore.', author: 'Dave', supervisor: null, state: 'bozza',
      history: [{ at: '2026-10-24T09:00:00Z', actor: 'Dave', action: 'creazione', rationale: '...' }], createdAt: '2026-10-24T09:00:00Z',
    });
    expect(await save(orgA, b, 3)).toBe(4);
    const tampered = clone(b);
    tampered.decisions[0]!.rationale = 'Motivazione riscritta a posteriori.';
    await expect(save(orgA, tampered, 4)).rejects.toThrow(/non può essere modificata/);
    const historyEdit = clone(b);
    historyEdit.decisions[0]!.history[0]!.actor = 'Altro';
    await expect(save(orgA, historyEdit, 4)).rejects.toThrow(/append-only/);
    const appended = clone(b);
    appended.decisions[0]!.state = 'inviata_a_revisione';
    appended.decisions[0]!.history.push({ at: '2026-10-24T10:00:00Z', actor: 'Dave', action: 'invio a revisione', rationale: 'ok' });
    expect(await save(orgA, appended, 4)).toBe(5);
    const auditCut = { ...clone(appended), audit: [] };
    await expect(save(orgA, auditCut, 5)).rejects.toThrow(/audit/);
    bundle = appended;
  });

  it('rifiuta geometrie non valide (auto-intersezione)', async () => {
    await actAs(db, { id: ids.dave });
    const b = clone(bundle);
    b.area!.geometry = polygonFromVertices([
      [14.66, 41.56],
      [14.661, 41.561],
      [14.661, 41.56],
      [14.66, 41.561],
    ]);
    await expect(save(orgA, b, 5)).rejects.toThrow(/Geometria/);
  });
});

describe('Link condivisi revocabili con scadenza (F26)', () => {
  let token: string;

  it('solo editor+ crea il link; il token non è salvato in chiaro', async () => {
    await actAs(db, { id: ids.carol });
    await expect(db.query('select public.create_shared_link($1, 7)', [pid])).rejects.toThrow(/Permesso negato/);
    await actAs(db, { id: ids.dave });
    await expect(db.query('select public.create_shared_link($1, 365)', [pid])).rejects.toThrow(/90 giorni/);
    token = (await one<{ t: string }>('select public.create_shared_link($1, 7) as t', [pid])).t;
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    const stored = await rows('select token_hash from shared_links where project_id = $1', [pid]);
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('anonimo legge in sola lettura con il token valido, non con uno errato', async () => {
    await actAs(db, 'anon');
    const ok = await one<{ r: { bundle: ProjectBundle; readOnly: boolean } }>('select public.get_shared_project($1) as r', [token]);
    expect(ok.r.readOnly).toBe(true);
    expect(ok.r.bundle.project.id).toBe(pid);
    expect((await one<{ r: unknown }>('select public.get_shared_project($1) as r', ['0'.repeat(48)])).r).toBeNull();
  });

  it('dopo la revoca il link non funziona più', async () => {
    await actAs(db, { id: ids.dave });
    const link = await one<{ id: string }>('select id from shared_links where project_id = $1', [pid]);
    await db.query('select public.revoke_shared_link($1)', [link.id]);
    await expect(db.query('select public.revoke_shared_link($1)', [link.id])).rejects.toThrow(/già revocato/);
    await actAs(db, 'anon');
    expect((await one<{ r: unknown }>('select public.get_shared_project($1) as r', [token])).r).toBeNull();
  });

  it('un link scaduto non funziona', async () => {
    await actAs(db, { id: ids.dave });
    const t2 = (await one<{ t: string }>('select public.create_shared_link($1, 1) as t', [pid])).t;
    await actAs(db, 'superuser');
    await db.query(`update shared_links set created_at = now() - interval '3 days', expires_at = now() - interval '2 days' where revoked_at is null`);
    await actAs(db, 'anon');
    expect((await one<{ r: unknown }>('select public.get_shared_project($1) as r', [t2])).r).toBeNull();
  });
});

describe('Storage per tenant', () => {
  const path = () => `${orgA}/${pid}/foto-1.jpg`;

  // Da B-109 (migrazione 0004) un oggetto si carica solo dopo aver creato la sua scheda
  // media_assets con contesto obbligatorio: il ciclo completo è in media.test.ts.
  it('senza scheda media nessuno carica oggetti, neanche chi ha il ruolo modifica', async () => {
    await actAs(db, { id: ids.dave });
    await expect(db.query(`insert into storage.objects (bucket_id, name) values ('project-media', $1)`, [path()])).rejects.toThrow(/row-level security/);
  });

  it('viewer non carica; altro tenant non vede né carica', async () => {
    await actAs(db, { id: ids.carol });
    expect(await rows('select name from storage.objects')).toEqual([]);
    await expect(db.query(`insert into storage.objects (bucket_id, name) values ('project-media', $1)`, [`${orgA}/${pid}/x.jpg`])).rejects.toThrow(/row-level security/);
    await actAs(db, { id: ids.bob });
    expect(await rows('select name from storage.objects')).toEqual([]);
    await expect(db.query(`insert into storage.objects (bucket_id, name) values ('project-media', $1)`, [`${orgB}/${pid}/y.jpg`])).rejects.toThrow(/row-level security/);
  });

  it('percorsi incoerenti (org diversa dal progetto, segmenti non validi) sono rifiutati', async () => {
    await actAs(db, { id: ids.dave });
    await expect(db.query(`insert into storage.objects (bucket_id, name) values ('project-media', $1)`, [`${orgB}/${pid}/z.jpg`])).rejects.toThrow(/row-level security/);
    await expect(db.query(`insert into storage.objects (bucket_id, name) values ('project-media', $1)`, ['nonuuid/x/z.jpg'])).rejects.toThrow(/row-level security/);
  });
});

describe('Audit', () => {
  it("l'admin vede il registro del proprio tenant; viewer e altri tenant no", async () => {
    await actAs(db, { id: ids.alice });
    const a = await rows('select action, entity from audit_logs where organization_id = $1', [orgA]);
    expect(a.length).toBeGreaterThan(5);
    expect(a).toEqual(expect.arrayContaining([{ action: 'update', entity: 'project_documents' }, { action: 'read', entity: 'shared_links' }]));
    await actAs(db, { id: ids.carol });
    expect(await rows('select * from audit_logs')).toEqual([]);
    await actAs(db, { id: ids.bob });
    expect(await rows('select * from audit_logs where organization_id = $1', [orgA])).toEqual([]);
    await expect(db.query(`insert into audit_logs (action, entity) values ('x', 'y')`)).rejects.toThrow(/row-level security/);
  });
});
