import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { hashOf, seedVineyard, type ProjectBundle } from '@mdt/domain';
import { PartialDeletionError, prepareUpload, SupabaseMediaStore, UploadCancelled, type UploadDetails } from '../../apps/web/src/state/mediaStore';
import type { SupabaseLike } from '../../apps/web/src/state/supabase';
import { actAs, createAuthUser, createDb } from './harness';
import { pgliteClient, type StorageFaults } from './pgliteClient';

/** SupabaseMediaStore dell'app contro Postgres reale con RLS e policy di storage. */
const U = { admin: '00000000-0000-4000-8000-0000000000a7', editor: '00000000-0000-4000-8000-0000000000e7', viewer: '00000000-0000-4000-8000-0000000000f7', other: '00000000-0000-4000-8000-0000000000c7' };
const JPEG = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='), (c) => c.charCodeAt(0));

let db: PGlite;
let orgA: string;
let orgB: string;
let bundle: ProjectBundle;

const store = (user: string, org = () => orgA, faults: StorageFaults = {}) => new SupabaseMediaStore(pgliteClient(db, faults) as unknown as SupabaseLike, org(), user);
const prepared = () => prepareUpload({ name: 'Vite Zona A.jpg', type: 'image/jpeg', size: JPEG.length }, JPEG).prepared!;
const details = (user: string): UploadDetails => ({
  organizationId: orgA,
  projectId: bundle.project.id,
  areaId: bundle.area!.id,
  zoneId: bundle.agri!.zones[0]!.id,
  cellId: null,
  scenarioId: null,
  observationId: null,
  workflowStage: 'bozza',
  category: 'immagine_terreno_coltura',
  description: 'Foglie basali ingiallite',
  observedOn: '2026-08-19',
  author: 'Editor',
  authorId: user,
  location: null,
  locationConsent: false,
});

beforeAll(async () => {
  db = await createDb();
  for (const [k, id] of Object.entries(U)) await createAuthUser(db, id, `${k}@ms.test`);
  await actAs(db, { id: U.admin });
  orgA = (await db.query<{ id: string }>(`select public.create_organization('Azienda A') as id`)).rows[0]!.id;
  await db.query(`select public.add_member_by_email($1, 'editor@ms.test', 'editor')`, [orgA]);
  await db.query(`select public.add_member_by_email($1, 'viewer@ms.test', 'viewer')`, [orgA]);
  bundle = seedVineyard(new Date('2026-08-20T08:00:00Z'), '2026-08-20');
  await db.query('select public.save_project($1, $2, $3, 0)', [orgA, JSON.stringify(bundle), hashOf(bundle)]);
  await actAs(db, { id: U.other });
  orgB = (await db.query<{ id: string }>(`select public.create_organization('Azienda B') as id`)).rows[0]!.id;
}, 180_000);

describe('SupabaseMediaStore — ciclo completo', () => {


  it('upload in tre fasi, con avanzamento, e file collegato al contesto', async () => {
    await actAs(db, { id: U.editor });
    const stages: string[] = [];
    const rec = await store(U.editor).upload(prepared(), details(U.editor), (s) => stages.push(s));

    expect(stages).toEqual(['registrazione', 'invio', 'conferma', 'fatto']);
    expect(rec.storagePath).toBe(`${orgA}/${bundle.project.id}/${rec.id}.jpg`);
    const list = await store(U.editor).list(bundle.project.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'attivo', zoneId: bundle.agri!.zones[0]!.id, originalName: 'vite-zona-a.jpg', storage: 'server' });
  });

  it('il lettore consulta: accesso registrato e URL firmato di 60 secondi', async () => {
    await actAs(db, { id: U.viewer });
    const [rec] = await store(U.viewer).list(bundle.project.id);
    const t = Date.now();
    const o = await store(U.viewer).open(rec!);
    expect(o.url).toContain(rec!.storagePath!);
    expect(o.expiresAt! - t).toBeGreaterThanOrEqual(59_000);
    expect(o.expiresAt! - t).toBeLessThanOrEqual(61_000);
  });

  it('il lettore non carica tramite API e non lascia residui', async () => {
    await actAs(db, { id: U.viewer });
    await expect(store(U.viewer).upload(prepared(), details(U.viewer))).rejects.toThrow(/rifiutato/);
    await actAs(db, 'superuser');
    expect((await db.query('select count(*)::int as n from media_assets')).rows[0]).toEqual({ n: 1 });
  });

  it('modifica dei collegamenti solo per l’autore', async () => {
    await actAs(db, { id: U.editor });
    const [rec] = await store(U.editor).list(bundle.project.id);
    const upd = await store(U.editor).update(rec!, { description: 'Aggiornata', zoneId: bundle.agri!.zones[1]!.id });
    expect(upd).toMatchObject({ description: 'Aggiornata', zoneId: bundle.agri!.zones[1]!.id });
    await actAs(db, { id: U.viewer });
    await expect(store(U.viewer).update(rec!, { description: 'x' })).rejects.toThrow(/solo i tuoi contenuti/);
  });

  it('un’altra organizzazione non vede nulla e non apre il file', async () => {
    await actAs(db, { id: U.other });
    expect(await store(U.other, () => orgB).list(bundle.project.id)).toEqual([]);
    await actAs(db, { id: U.editor });
    const [rec] = await store(U.editor).list(bundle.project.id);
    await actAs(db, { id: U.other });
    await expect(store(U.other, () => orgB).open(rec!)).rejects.toThrow(/non disponibile/);
  });

  it('l’editor non elimina; errore dello storage → eliminazione incompleta, poi ripresa', async () => {
    await actAs(db, { id: U.editor });
    const [rec] = await store(U.editor).list(bundle.project.id);
    await expect(store(U.editor).remove(rec!)).rejects.toThrow(/Solo un amministratore/);

    await actAs(db, { id: U.admin });
    await expect(store(U.admin, () => orgA, { failRemove: true }).remove(rec!)).rejects.toBeInstanceOf(PartialDeletionError);
    const [half] = await store(U.admin).list(bundle.project.id);
    expect(half!.status).toBe('eliminazione_in_corso');
    // nessun nuovo URL per chi non è amministratore durante l'eliminazione
    await actAs(db, { id: U.viewer });
    await expect(store(U.viewer).open(half!)).rejects.toThrow(/non disponibile/);

    await actAs(db, { id: U.admin });
    await store(U.admin).remove(half!);
    expect(await store(U.admin).list(bundle.project.id)).toEqual([]);
    await actAs(db, 'superuser');
    expect((await db.query('select count(*)::int as n from storage.objects')).rows[0]).toEqual({ n: 0 });

  });

  it('caricamento annullato: nessuna scheda e nessun oggetto restano sul server', async () => {
    await actAs(db, { id: U.editor });
    const ac = new AbortController();
    const p = store(U.editor).upload(prepared(), details(U.editor), (s) => {
      if (s === 'invio') ac.abort();
    }, ac.signal);
    await expect(p).rejects.toBeInstanceOf(UploadCancelled);
    await actAs(db, 'superuser');
    expect((await db.query('select count(*)::int as n from media_assets')).rows[0]).toEqual({ n: 0 });
    expect((await db.query('select count(*)::int as n from storage.objects')).rows[0]).toEqual({ n: 0 });
  });
});
