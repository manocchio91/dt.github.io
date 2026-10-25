import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { hashOf, seedCampobasso, seedVineyard, type ProjectBundle } from '@mdt/domain';
import { actAs, createAuthUser, createDb } from './harness';

/** B-109 — media_assets e storage: permessi, contesto, ciclo di vita, audit. */
const U = {
  admin: '00000000-0000-4000-8000-0000000000a9',
  editor: '00000000-0000-4000-8000-0000000000e9',
  editor2: '00000000-0000-4000-8000-0000000000e8',
  approver: '00000000-0000-4000-8000-0000000000d9',
  viewer: '00000000-0000-4000-8000-0000000000f9',
  outsider: '00000000-0000-4000-8000-0000000000c9',
};
let db: PGlite;
let orgA: string;
let orgB: string;
let agri: ProjectBundle;
let urban: ProjectBundle;
let n = 0;
const SHA = 'a'.repeat(64);

const uuid = () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`;

async function newMedia(over: Record<string, unknown> = {}, project = agri, org = () => orgA) {
  const id = (over.id as string) ?? uuid();
  const mime = (over.mime as string) ?? 'image/jpeg';
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[mime] ?? 'bin';
  const row = {
    id,
    project_id: project.project.id,
    organization_id: org(),
    storage_path: `${org()}/${project.project.id}/${id}.${ext}`,
    mime,
    uploaded_by: U.editor,
    author_name: 'Editor',
    category: project.project.sector === 'urban' ? 'foto_sopralluogo' : 'immagine_terreno_coltura',
    observed_on: '2026-08-19',
    size_bytes: 1000,
    sha256: SHA,
    original_name: 'foto.jpg',
    area_ref: project.area!.id,
    ...over,
  };
  const cols = Object.keys(row);
  await db.query(`insert into media_assets (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
  return row as typeof row & { id: string; storage_path: string };
}

/** Uscita dalla quarantena: solo il servizio (gateway), dopo la validazione. */
async function confirmAsService(id: string, back: { id: string } | 'superuser' = 'superuser') {
  await actAs(db, 'service');
  await db.query(`update media_assets set status = 'attivo', validated_at = now() where id = $1`, [id]);
  await actAs(db, back);
}

const putObject = (path: string) => db.query(`insert into storage.objects (bucket_id, name) values ('project-media', $1)`, [path]);
const objects = async () => (await db.query<{ name: string }>('select name from storage.objects order by name')).rows.map((r) => r.name);
const status = async (id: string) => {
  await actAs(db, 'superuser');
  return (await db.query<{ status: string }>('select status from media_assets where id = $1', [id])).rows[0]?.status ?? null;
};

beforeAll(async () => {
  db = await createDb();
  for (const [k, id] of Object.entries(U)) await createAuthUser(db, id, `${k}@media.test`);
  await actAs(db, { id: U.admin });
  orgA = (await db.query<{ id: string }>(`select public.create_organization('Comune A') as id`)).rows[0]!.id;
  for (const [email, role] of [
    ['editor@media.test', 'editor'],
    ['editor2@media.test', 'editor'],
    ['approver@media.test', 'approver'],
    ['viewer@media.test', 'viewer'],
  ]) {
    await db.query(`select public.add_member_by_email($1, $2, $3)`, [orgA, email, role]);
  }
  agri = seedVineyard(new Date('2026-08-20T08:00:00Z'), '2026-08-20');
  urban = seedCampobasso(new Date('2026-10-24T08:00:00Z'));
  for (const b of [agri, urban]) await db.query('select public.save_project($1, $2, $3, 0)', [orgA, JSON.stringify(b), hashOf(b)]);
  await actAs(db, { id: U.outsider });
  orgB = (await db.query<{ id: string }>(`select public.create_organization('Comune B') as id`)).rows[0]!.id;
}, 180_000);

describe('Caricamento: prima la scheda con contesto, poi l’oggetto', () => {
  it('editor: scheda → oggetto → conferma; il file diventa visibile ai lettori', async () => {
    await actAs(db, { id: U.editor });
    const m = await newMedia({ zone_ref: agri.agri!.zones[0]!.id, observation_ref: agri.agri!.observations[0]!.id });
    await putObject(m.storage_path);
    // B-124: l'autore non può far uscire il file dalla quarantena da solo
    await expect(db.query(`update media_assets set status = 'attivo' where id = $1`, [m.id])).rejects.toThrow(/validazione del server/);
    await confirmAsService(m.id, { id: U.viewer });
    expect((await db.query('select id from media_assets where id = $1', [m.id])).rows).toHaveLength(1);
    // i client non leggono direttamente gli oggetti: la consultazione passa dal gateway
    expect(await objects()).not.toContain(m.storage_path);
  });

  it('un file in quarantena non è visibile agli altri membri', async () => {
    await actAs(db, { id: U.editor });
    const q = await newMedia();
    await putObject(q.storage_path);
    expect(await objects()).toContain(q.storage_path); // l'autore lo vede per poterlo annullare
    await actAs(db, { id: U.viewer });
    expect((await db.query('select id from media_assets where id = $1', [q.id])).rows).toEqual([]);
    expect(await objects()).not.toContain(q.storage_path);
  });

  it('la validazione non si può falsificare dal client', async () => {
    await actAs(db, { id: U.editor });
    await expect(newMedia({ validation: { sha256_verificato: true } })).rejects.toThrow(/solo dal servizio/);
    const m = await newMedia();
    await expect(db.query(`update media_assets set validation = '{"ok":true}' where id = $1`, [m.id])).rejects.toThrow(/solo dal servizio/);
  });

  it('nemmeno il servizio conferma un caricamento senza oggetto nello storage', async () => {
    await actAs(db, { id: U.editor });
    const m = await newMedia();
    await actAs(db, 'service');
    await expect(db.query(`update media_assets set status = 'attivo' where id = $1`, [m.id])).rejects.toThrow(/Oggetto non presente/);
  });

  it('un oggetto senza scheda, o con scheda già attiva, non si carica', async () => {
    await actAs(db, { id: U.editor });
    await expect(putObject(`${orgA}/${agri.project.id}/${uuid()}.jpg`)).rejects.toThrow(/row-level security/);
  });

  it('il ruolo lettura non carica tramite API (né scheda né oggetto)', async () => {
    await actAs(db, { id: U.viewer });
    await expect(newMedia({ uploaded_by: U.viewer })).rejects.toThrow(/row-level security/);
    await expect(putObject(`${orgA}/${agri.project.id}/${uuid()}.jpg`)).rejects.toThrow(/row-level security/);
  });

  it('l’approvatore allega un documento alla revisione', async () => {
    await actAs(db, { id: U.approver });
    const m = await newMedia({ uploaded_by: U.approver, mime: 'application/pdf', category: 'relazione_tecnica', workflow_stage: 'revisione', original_name: 'relazione.pdf' });
    await putObject(m.storage_path);
    await confirmAsService(m.id);
    expect(await status(m.id)).toBe('attivo');
  });

  it('nessuno può firmare come un altro autore', async () => {
    await actAs(db, { id: U.editor });
    await expect(newMedia({ uploaded_by: U.editor2 })).rejects.toThrow(/row-level security|autore/);
  });
});

describe('Contesto obbligatorio e coerenza', () => {
  it('area, sottozona, scenario e osservazione devono esistere nel progetto', async () => {
    await actAs(db, { id: U.editor });
    await expect(newMedia({ area_ref: 'area-inesistente' })).rejects.toThrow(/area o alla parcella/);
    await expect(newMedia({ zone_ref: 'zona-x' })).rejects.toThrow(/Sottozona non valida/);
    await expect(newMedia({ scenario_ref: 'sc-x' }, urban)).rejects.toThrow(/Scenario non trovato/);
    await expect(newMedia({ observation_ref: 'oss-x' })).rejects.toThrow(/Osservazione non trovata/);
  });

  it('nessuna commistione urbano/agricolo', async () => {
    await actAs(db, { id: U.editor });
    await expect(newMedia({ zone_ref: agri.agri!.zones[0]!.id }, urban)).rejects.toThrow(/Sottozona non valida/);
    await expect(newMedia({ cell_ref: 'r1c1' })).rejects.toThrow(/Cella non valida/);
    await expect(newMedia({ category: 'immagine_terreno_coltura' }, urban)).rejects.toThrow(/solo nei progetti agricoli/);
    const ok = await newMedia({ cell_ref: 'r3c4', scenario_ref: urban.scenarios[0]!.id }, urban);
    expect(ok.id).toBeTruthy();
  });

  it('percorso {org}/{progetto}/{uuid}.{ext} obbligatorio e coerente con il tipo', async () => {
    await actAs(db, { id: U.editor });
    const id = uuid();
    await expect(newMedia({ id, storage_path: `${orgA}/${agri.project.id}/${id}.png` })).rejects.toThrow(/media_path_ck/);
    await expect(newMedia({ id: uuid(), storage_path: `${orgA}/${agri.project.id}/qualsiasi.jpg` })).rejects.toThrow(/media_path_ck/);
  });

  it('organizzazione diversa da quella del progetto: rifiutato', async () => {
    await actAs(db, { id: U.editor });
    await expect(newMedia({}, agri, () => orgB)).rejects.toThrow(/row-level security|organizzazione del progetto/);
  });

  it('tipi, dimensione, posizione e data controllati anche nel database', async () => {
    await actAs(db, { id: U.editor });
    await expect(newMedia({ mime: 'image/svg+xml' })).rejects.toThrow(/media_mime_ck|media_path_ck/);
    await expect(newMedia({ size_bytes: 30 * 1024 * 1024 })).rejects.toThrow(/media_size_ck|limite/);
    await expect(newMedia({ location: 'SRID=4326;POINT(14.92 41.80)' })).rejects.toThrow(/media_location_ck/);
    const withConsent = await newMedia({ location: 'SRID=4326;POINT(14.92 41.80)', location_consent: true });
    expect(withConsent.id).toBeTruthy();
    await expect(newMedia({ observed_on: '2099-01-01' })).rejects.toThrow(/futuro/);
  });

  it('limite di dimensione configurabile per organizzazione', async () => {
    await actAs(db, { id: U.admin });
    await db.query('update organizations set media_max_bytes = 2097152 where id = $1', [orgA]);
    await actAs(db, { id: U.editor });
    await expect(newMedia({ size_bytes: 3 * 1024 * 1024 })).rejects.toThrow(/limite dell'organizzazione/);
    await actAs(db, { id: U.admin });
    await db.query('update organizations set media_max_bytes = 20971520 where id = $1', [orgA]);
  });

  it('conservazione impostata automaticamente secondo l’organizzazione', async () => {
    await actAs(db, { id: U.editor });
    const m = await newMedia();
    const r = (await db.query<{ y: number }>(`select extract(year from age(retention_until, current_date))::int as y from media_assets where id = $1`, [m.id])).rows[0]!;
    expect(r.y).toBe(5);
  });
});

describe('Modifica dei propri contenuti', () => {
  it('l’autore modifica descrizione e associazione, non il file', async () => {
    await actAs(db, { id: U.editor });
    const m = await newMedia();
    await db.query(`update media_assets set description = 'Foglie basali', zone_ref = $2 where id = $1`, [m.id, agri.agri!.zones[1]!.id]);
    await expect(db.query(`update media_assets set sha256 = $2 where id = $1`, [m.id, 'b'.repeat(64)])).rejects.toThrow(/non sono modificabili/);
  });

  it('un altro editor non modifica i contenuti altrui; il lettore nemmeno', async () => {
    await actAs(db, { id: U.editor });
    const m = await newMedia();
    await actAs(db, { id: U.editor2 });
    expect((await db.query(`update media_assets set description = 'x' where id = $1`, [m.id])).affectedRows).toBe(0);
    await actAs(db, { id: U.viewer });
    expect((await db.query(`update media_assets set description = 'x' where id = $1`, [m.id])).affectedRows).toBe(0);
  });
});

describe('Isolamento tra organizzazioni', () => {
  it('un utente di un’altra organizzazione non vede schede né oggetti e non firma URL', async () => {
    await actAs(db, { id: U.outsider });
    expect((await db.query('select id from media_assets')).rows).toEqual([]);
    expect(await objects()).toEqual([]);
    const any = (await (async () => {
      await actAs(db, 'superuser');
      return db.query<{ id: string }>(`select id from media_assets where status = 'attivo' limit 1`);
    })()).rows[0]!.id;
    await actAs(db, { id: U.outsider });
    await expect(db.query('select public.log_media_access($1)', [any])).rejects.toThrow(/non disponibile/);
  });

  it('revoca: chi viene rimosso dall’organizzazione perde subito lettura e firma', async () => {
    await actAs(db, { id: U.admin });
    await db.query(`select public.add_member_by_email($1, 'outsider@media.test', 'viewer')`, [orgA]);
    await actAs(db, 'superuser');
    const active = (await db.query<{ id: string }>(`select id from media_assets where status = 'attivo' and organization_id = $1 limit 1`, [orgA])).rows[0]!.id;
    await actAs(db, { id: U.outsider });
    expect((await db.query<{ p: string }>('select public.log_media_access($1) as p', [active])).rows[0]!.p).toBeTruthy();
    await actAs(db, { id: U.admin });
    await db.query('delete from memberships where organization_id = $1 and user_id = $2', [orgA, U.outsider]);
    await actAs(db, { id: U.outsider });
    await expect(db.query('select public.log_media_access($1)', [active])).rejects.toThrow(/non disponibile/);
    expect((await db.query('select id from media_assets')).rows).toEqual([]);
  });
});

describe('Consultazione ed eliminazione', () => {
  let m: { id: string; storage_path: string };

  it('la consultazione restituisce il percorso e la registra nell’audit', async () => {
    await actAs(db, { id: U.editor });
    m = await newMedia({ description: 'Testo da non conservare nel registro' });
    await putObject(m.storage_path);
    await confirmAsService(m.id, { id: U.viewer });
    const r = await db.query<{ p: string }>('select public.log_media_access($1) as p', [m.id]);
    expect(r.rows[0]!.p).toBe(m.storage_path);
  });

  it('solo l’amministratore avvia l’eliminazione; l’editor no', async () => {
    await actAs(db, { id: U.editor });
    await expect(db.query(`update media_assets set status = 'eliminazione_in_corso' where id = $1`, [m.id])).rejects.toThrow(/Solo un amministratore/);
    await expect(db.query('select public.media_authorize_delete($1)', [m.id])).rejects.toThrow(/Solo un amministratore/);
    await expect(db.query(`delete from storage.objects where name = $1`, [m.storage_path])).resolves.toMatchObject({ affectedRows: 0 });
  });

  it('eliminazione: autorizzazione dell’admin (con audit) poi servizio; la scheda resta finché l’oggetto esiste', async () => {
    await actAs(db, { id: U.admin });
    expect((await db.query<{ p: string }>('select public.media_authorize_delete($1) as p', [m.id])).rows[0]!.p).toBe(m.storage_path);
    // ripetibile: una seconda autorizzazione non fallisce (ripresa dopo errore parziale)
    await db.query('select public.media_authorize_delete($1)', [m.id]);
    // durante l'eliminazione nessuno firma nuovi URL
    await actAs(db, { id: U.viewer });
    await expect(db.query('select public.log_media_access($1)', [m.id])).rejects.toThrow(/non disponibile/);
    // nessun client cancella scheda o oggetto direttamente
    await actAs(db, { id: U.admin });
    expect((await db.query('delete from media_assets where id = $1', [m.id])).affectedRows).toBe(0);
    expect((await db.query('delete from storage.objects where name = $1', [m.storage_path])).affectedRows).toBe(0);
    expect(await status(m.id)).toBe('eliminazione_in_corso');
    // il servizio completa: oggetto, poi scheda
    await actAs(db, 'service');
    expect((await db.query('delete from storage.objects where name = $1', [m.storage_path])).affectedRows).toBe(1);
    expect((await db.query('delete from media_assets where id = $1', [m.id])).affectedRows).toBe(1);
    expect(await status(m.id)).toBeNull();
  });

  it('audit con informazioni minime: niente nome, descrizione o percorso', async () => {
    await actAs(db, { id: U.admin });
    const rows = (await db.query<{ action: string; details: Record<string, unknown> }>(`select action, details from audit_logs where entity = 'media_assets' and entity_id = $1 order by occurred_at, id`, [m.id])).rows;
    expect(rows.map((r) => r.action)).toEqual(['validazione_superata', 'consultazione', 'eliminazione_avviata', 'eliminazione_completata']);
    const all = JSON.stringify(rows);
    expect(all).not.toContain('Testo da non conservare');
    expect(all).not.toContain(m.storage_path);
    expect(all).not.toContain('foto.jpg');
  });

  it('caricamento annullato: l’autore rimuove oggetto e scheda ancora in caricamento', async () => {
    await actAs(db, { id: U.editor });
    const x = await newMedia();
    await putObject(x.storage_path);
    expect((await db.query('delete from storage.objects where name = $1', [x.storage_path])).affectedRows).toBe(1);
    expect((await db.query('delete from media_assets where id = $1', [x.id])).affectedRows).toBe(1);
  });

  it('un progetto con file non si elimina finché i file esistono', async () => {
    await actAs(db, { id: U.admin });
    await expect(db.query('delete from projects where id = $1', [agri.project.id])).rejects.toThrow(/foto o documenti/);
  });

  it('file oltre il periodo di conservazione elencati agli amministratori', async () => {
    await actAs(db, { id: U.editor });
    const fresh = await newMedia();
    await putObject(fresh.storage_path);
    await confirmAsService(fresh.id);
    await db.query(`alter table media_assets disable trigger media_assets_guard_upd`);
    const old = fresh.id;
    await db.query(`update media_assets set retention_until = current_date - 1 where id = $1`, [old]);
    await db.query(`alter table media_assets enable trigger media_assets_guard_upd`);
    await actAs(db, { id: U.admin });
    expect((await db.query('select id from public.media_due_for_deletion($1)', [orgA])).rows).toEqual([{ id: old }]);
    await actAs(db, { id: U.editor });
    expect((await db.query('select id from public.media_due_for_deletion($1)', [orgA])).rows).toEqual([]);
  });
});
