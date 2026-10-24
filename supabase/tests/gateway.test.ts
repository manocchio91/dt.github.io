import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
// @ts-expect-error libreria senza tipi, usata solo nei test per scrivere EXIF reali
import piexif from 'piexifjs';
import { hashOf, seedVineyard, sha256Bytes, stripMetadata, type ProjectBundle } from '@mdt/domain';
import { completeUpload, deleteMedia, purgeExpired, signedUrl, type GatewayClient } from '../functions/_shared/mediaGateway.ts';
import { actAs, createAuthUser, createDb } from './harness';
import { pgliteClient, type ClientOptions } from './pgliteClient';

/** B-124 / B-125 — gateway server-side sullo stesso codice della Edge Function, contro Postgres reale. */
const U = { admin: '00000000-0000-4000-8000-0000000000a6', editor: '00000000-0000-4000-8000-0000000000e6', viewer: '00000000-0000-4000-8000-0000000000f6', other: '00000000-0000-4000-8000-0000000000c6' };
const TINY = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const CLEAN_JPEG = Uint8Array.from(atob(TINY), (c) => c.charCodeAt(0));
const EXIF_JPEG = Uint8Array.from(
  piexif.insert(piexif.dump({ GPS: { [piexif.GPSIFD.GPSLatitudeRef]: 'N', [piexif.GPSIFD.GPSLatitude]: [[41, 1], [33, 1], [0, 1]] } }), atob(TINY)),
  (c: string) => c.charCodeAt(0),
);
const pdf = (s: string) => new TextEncoder().encode(`%PDF-1.7\n${s}\n%%EOF`);

let db: PGlite;
let org: string;
let bundle: ProjectBundle;
let n = 0;
const blobs = new Map<string, Uint8Array>();
const as = (actor: NonNullable<ClientOptions['as']>, failRemove = false) => pgliteClient(db, { as: actor, blobs, failRemove }) as unknown as GatewayClient;
const service = (failRemove = false) => as('service', failRemove);

/** Prepara una scheda in quarantena e carica i byte indicati, dichiarando i metadati scelti. */
async function staged(bytes: Uint8Array, declared: { mime?: string; sha?: string; name?: string; size?: number } = {}) {
  const id = `00000000-0000-4000-9100-${String(++n).padStart(12, '0')}`;
  const mime = declared.mime ?? 'image/jpeg';
  const ext = mime === 'application/pdf' ? 'pdf' : 'jpg';
  const path = `${org}/${bundle.project.id}/${id}.${ext}`;
  const ed = pgliteClient(db, { as: { id: U.editor }, blobs });
  const ins = await ed.from('media_assets').insert({
    id, project_id: bundle.project.id, organization_id: org, storage_path: path, mime,
    size_bytes: declared.size ?? bytes.length, sha256: declared.sha ?? sha256Bytes(bytes), original_name: declared.name ?? `file.${ext}`,
    uploaded_by: U.editor, author_name: 'Editor', category: mime === 'application/pdf' ? 'relazione_tecnica' : 'immagine_terreno_coltura',
    observed_on: '2026-08-19', area_ref: bundle.area!.id,
  });
  if (ins.error) throw new Error(ins.error.message);
  const up = await ed.storage.from('project-media').upload(path, bytes);
  if (up.error) throw new Error(up.error.message);
  return { id, path };
}

const statusOf = async (id: string) => {
  await actAs(db, 'superuser');
  return (await db.query<{ status: string }>('select status from media_assets where id = $1', [id])).rows[0]?.status ?? null;
};
const objectExists = async (path: string) => {
  await actAs(db, 'superuser');
  return (await db.query('select 1 from storage.objects where name = $1', [path])).rows.length === 1;
};
const auditActions = async (id: string) => {
  await actAs(db, 'superuser');
  return (await db.query<{ action: string }>(`select action from audit_logs where entity = 'media_assets' and entity_id = $1 order by id`, [id])).rows.map((r) => r.action);
};

beforeAll(async () => {
  db = await createDb();
  for (const [k, id] of Object.entries(U)) await createAuthUser(db, id, `${k}@gw.test`);
  await actAs(db, { id: U.admin });
  org = (await db.query<{ id: string }>(`select public.create_organization('Azienda GW') as id`)).rows[0]!.id;
  await db.query(`select public.add_member_by_email($1, 'editor@gw.test', 'editor')`, [org]);
  await db.query(`select public.add_member_by_email($1, 'viewer@gw.test', 'viewer')`, [org]);
  bundle = seedVineyard(new Date('2026-08-20T08:00:00Z'), '2026-08-20');
  await db.query('select public.save_project($1, $2, $3, 0)', [org, JSON.stringify(bundle), hashOf(bundle)]);
  await actAs(db, { id: U.other });
  await db.query(`select public.create_organization('Altra') as id`);
}, 180_000);

describe('Il codice condiviso della Edge Function è identico al dominio', () => {
  it('supabase/functions/_shared/files.ts = packages/domain/src/media/files.ts', () => {
    const root = join(import.meta.dirname, '..', '..');
    expect(readFileSync(join(root, 'supabase/functions/_shared/files.ts'), 'utf8')).toBe(readFileSync(join(root, 'packages/domain/src/media/files.ts'), 'utf8'));
  });
});

describe('Quarantena e validazione server-side (B-124)', () => {
  it('file conforme: esce dalla quarantena con esito registrato; ripetere è idempotente', async () => {
    const f = await staged(CLEAN_JPEG);
    const r = await completeUpload(as({ id: U.editor }), service(), f.id);
    expect(r).toEqual({ status: 'attivo', idempotent: false });
    expect(await statusOf(f.id)).toBe('attivo');
    const again = await completeUpload(as({ id: U.editor }), service(), f.id);
    expect(again).toEqual({ status: 'attivo', idempotent: true });
    await actAs(db, 'superuser');
    const v = (await db.query<{ validation: Record<string, unknown> }>('select validation from media_assets where id = $1', [f.id])).rows[0]!.validation;
    expect(v).toMatchObject({ tipo_reale: 'image/jpeg', sha256_verificato: true, metadati_assenti: true, antivirus: 'non disponibile' });
    expect(await auditActions(f.id)).toEqual(['validazione_superata']);
  });

  it('client modificato che salta la rimozione EXIF/GPS: file scartato, oggetto e scheda rimossi', async () => {
    expect(stripMetadata(EXIF_JPEG, 'image/jpeg').removed.length).toBeGreaterThan(0);
    const f = await staged(EXIF_JPEG);
    await expect(completeUpload(as({ id: U.editor }), service(), f.id)).rejects.toMatchObject({ status: 422, details: [expect.stringMatching(/contiene ancora metadati/)] });
    expect(await statusOf(f.id)).toBeNull();
    expect(await objectExists(f.path)).toBe(false);
    expect(await auditActions(f.id)).toEqual(['caricamento_scartato']);
  });

  it('impronta o dimensione dichiarate diverse dai byte reali: rifiutato', async () => {
    const f = await staged(CLEAN_JPEG, { sha: 'b'.repeat(64) });
    await expect(completeUpload(as({ id: U.editor }), service(), f.id)).rejects.toMatchObject({ status: 422, details: expect.arrayContaining([expect.stringMatching(/SHA-256/)]) });
  });

  it('estensione e tipo contraffatti (PDF dichiarato come JPEG): rifiutato', async () => {
    const f = await staged(pdf('documento'), { mime: 'image/jpeg', name: 'foto.jpg' });
    await expect(completeUpload(as({ id: U.editor }), service(), f.id)).rejects.toMatchObject({ status: 422 });
  });

  it('PDF con JavaScript o allegati incorporati: rifiutato; PDF semplice: accettato', async () => {
    const bad = await staged(pdf('1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj'), { mime: 'application/pdf', name: 'relazione.pdf' });
    await expect(completeUpload(as({ id: U.editor }), service(), bad.id)).rejects.toMatchObject({ status: 422, details: [expect.stringMatching(/JavaScript incorporato/)] });
    const ok = await staged(pdf('1 0 obj << /Type /Catalog >> endobj'), { mime: 'application/pdf', name: 'relazione.pdf' });
    expect((await completeUpload(as({ id: U.editor }), service(), ok.id)).status).toBe('attivo');
  });

  it('solo l’autore può chiedere la conferma; senza oggetto si risponde 409 e si può riprovare', async () => {
    const f = await staged(CLEAN_JPEG);
    await expect(completeUpload(as({ id: U.viewer }), service(), f.id)).rejects.toMatchObject({ status: 403 });
    await expect(completeUpload(as({ id: U.other }), service(), f.id)).rejects.toMatchObject({ status: 403 });
    // oggetto rimosso dall'autore prima della conferma (es. invio interrotto)
    await pgliteClient(db, { as: { id: U.editor }, blobs }).storage.from('project-media').remove([f.path]);
    await expect(completeUpload(as({ id: U.editor }), service(), f.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe('Consultazione: audit obbligatorio prima della firma', () => {
  it('il lettore ottiene un URL di 60 s e l’accesso è registrato; il client da solo non può firmare', async () => {
    const f = await staged(CLEAN_JPEG);
    await completeUpload(as({ id: U.editor }), service(), f.id);
    const s = await signedUrl(as({ id: U.viewer }), service(), f.id, 'foto.jpg');
    expect(s.expiresInSeconds).toBe(60);
    expect(await auditActions(f.id)).toContain('consultazione');
    const direct = await pgliteClient(db, { as: { id: U.viewer }, blobs }).storage.from('project-media').createSignedUrl(f.path, 60);
    expect(direct.error).not.toBeNull();
    await expect(signedUrl(as({ id: U.other }), service(), f.id)).rejects.toMatchObject({ status: 403 });
  });
});

describe('Eliminazione tramite gateway', () => {
  it('editor rifiutato; errore dello storage → 503 e file nascosto; nuovo tentativo completa', async () => {
    const f = await staged(CLEAN_JPEG);
    await completeUpload(as({ id: U.editor }), service(), f.id);
    await expect(deleteMedia(as({ id: U.editor }), service(), f.id)).rejects.toMatchObject({ status: 403 });
    await expect(deleteMedia(as({ id: U.admin }), service(true), f.id)).rejects.toMatchObject({ status: 503 });
    expect(await statusOf(f.id)).toBe('eliminazione_in_corso');
    await expect(signedUrl(as({ id: U.viewer }), service(), f.id)).rejects.toMatchObject({ status: 403 });
    expect(await deleteMedia(as({ id: U.admin }), service(), f.id)).toEqual({ deleted: true });
    expect(await statusOf(f.id)).toBeNull();
    expect(await objectExists(f.path)).toBe(false);
    expect(await auditActions(f.id)).toEqual(['validazione_superata', 'eliminazione_avviata', 'eliminazione_completata']);
  });
});

describe('Conservazione (B-125)', () => {
  async function expire(id: string) {
    await actAs(db, 'superuser');
    await db.query('alter table media_assets disable trigger user');
    await db.query(`update media_assets set retention_until = current_date - 1 where id = $1`, [id]);
    await db.query('alter table media_assets enable trigger user');
  }

  it('anteprima per gli amministratori dei file in scadenza', async () => {
    const f = await staged(CLEAN_JPEG);
    await completeUpload(as({ id: U.editor }), service(), f.id);
    await actAs(db, 'superuser');
    await db.query('alter table media_assets disable trigger user');
    await db.query(`update media_assets set retention_until = current_date + 10 where id = $1`, [f.id]);
    await db.query('alter table media_assets enable trigger user');
    await actAs(db, { id: U.admin });
    expect((await db.query<{ id: string }>('select id from public.media_expiring($1, 30)', [org])).rows.map((r) => r.id)).toContain(f.id);
    await actAs(db, { id: U.editor });
    expect((await db.query('select id from public.media_expiring($1, 30)', [org])).rows).toEqual([]);
  });

  it('data di fine conservazione modificabile solo dagli amministratori e mai nel passato', async () => {
    const f = await staged(CLEAN_JPEG);
    await completeUpload(as({ id: U.editor }), service(), f.id);
    await actAs(db, { id: U.editor });
    await expect(db.query(`update media_assets set retention_until = current_date + 30 where id = $1`, [f.id])).rejects.toThrow(/Solo un amministratore/);
    await actAs(db, { id: U.admin });
    await db.query(`update media_assets set retention_until = current_date + 30 where id = $1`, [f.id]);
    await expect(db.query(`update media_assets set retention_until = current_date - 1 where id = $1`, [f.id])).rejects.toThrow(/nel passato/);
  });

  it('job di pulizia: elimina i file scaduti, registra il minimo, gestisce l’errore parziale e riprende', async () => {
    const a = await staged(CLEAN_JPEG);
    const b = await staged(CLEAN_JPEG);
    for (const f of [a, b]) {
      await completeUpload(as({ id: U.editor }), service(), f.id);
      await expire(f.id);
    }
    const today = new Date().toISOString().slice(0, 10);
    const failing = await purgeExpired(service(true), today);
    expect(failing.eliminati).toBe(0);
    expect(failing.errori.filter((e) => e.fase === 'storage').length).toBeGreaterThanOrEqual(2);
    expect(await statusOf(a.id)).toBe('eliminazione_in_corso');

    const ok = await purgeExpired(service(), today);
    expect(ok.errori).toEqual([]);
    expect(ok.eliminati).toBeGreaterThanOrEqual(2);
    for (const f of [a, b]) {
      expect(await statusOf(f.id)).toBeNull();
      expect(await objectExists(f.path)).toBe(false);
      expect(await auditActions(f.id)).toEqual(['validazione_superata', 'eliminazione_per_scadenza', 'eliminazione_completata']);
    }
  });
});
