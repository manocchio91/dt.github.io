#!/usr/bin/env node
/**
 * Verifica su un progetto Supabase REALE di TEST (mai produzione).
 *
 * Esegue contro Auth, PostgREST, Storage ed Edge Functions reali i controlli di
 * docs/14 e scrive un report SENZA credenziali in docs/reports/.
 *
 * Variabili d'ambiente (da file locale escluso da Git, es. .env.supabase-test):
 *   SUPABASE_URL                 URL del progetto di test
 *   SUPABASE_ANON_KEY            chiave anon pubblica
 *   SUPABASE_SERVICE_ROLE_KEY    solo per creare/eliminare gli utenti di prova e per pulizia
 *   MDT_CONFIRM_TEST_PROJECT=yes conferma esplicita che il progetto NON è di produzione
 * Opzioni: --slow (attende la scadenza reale degli URL firmati, 65 s), --keep (non ripulisce)
 *
 * Uso:  node --env-file=.env.supabase-test scripts/supabase-real/verify.mjs
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import piexif from 'piexifjs';
import { stripMetadata } from '../../packages/domain/src/media/files.ts';

const { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, MDT_CONFIRM_TEST_PROJECT } = process.env;
const SLOW = process.argv.includes('--slow');
const KEEP = process.argv.includes('--keep');

if (!URL_ || !ANON || !SERVICE) {
  console.error('Mancano SUPABASE_URL, SUPABASE_ANON_KEY o SUPABASE_SERVICE_ROLE_KEY (usa un file .env locale escluso da Git).');
  process.exit(2);
}
if (MDT_CONFIRM_TEST_PROJECT !== 'yes') {
  console.error('Imposta MDT_CONFIRM_TEST_PROJECT=yes per confermare che il progetto è di TEST.');
  process.exit(2);
}

const host = new URL(URL_).host.replace(/^[^.]+/, '****'); // nel report non compare il riferimento del progetto
const run = randomBytes(4).toString('hex');
const password = randomBytes(18).toString('base64url'); // mai stampata né salvata
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const results = [];
const created = { users: [], orgs: [], media: [] };

function record(id, title, status, evidence = '') {
  results.push({ id, title, status, evidence });
  console.log(`${status === 'ok' ? '✔' : status === 'ko' ? '✖' : '·'} ${id} ${title}${evidence ? ` — ${evidence}` : ''}`);
}
async function check(id, title, fn) {
  try {
    const ev = await fn();
    record(id, title, 'ok', ev ?? '');
  } catch (e) {
    record(id, title, 'ko', e.message);
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const sha = (b) => createHash('sha256').update(b).digest('hex');

async function newUser(label) {
  const email = `mdt-${run}-${label}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `Test ${label}` } });
  if (error) throw new Error(`creazione utente ${label}: ${error.message}`);
  created.users.push(data.user.id);
  const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw new Error(`login ${label}: ${e2.message}`);
  return { id: data.user.id, email, client };
}

/** Documento di progetto minimo (vigneto con due sottozone) per provare i collegamenti. */
function bundle(name) {
  const id = crypto.randomUUID();
  const ring = [[14.919, 41.7993], [14.92141, 41.7993], [14.92141, 41.80065], [14.919, 41.80065], [14.919, 41.7993]];
  return {
    schemaVersion: 1,
    project: { id, name, sector: 'agriculture', mode: 'demo', isDemoSeed: true, description: 'Verifica Supabase reale', createdAt: new Date().toISOString() },
    area: { id: `${id}-parcel`, name: 'Parcella di prova', geometry: { type: 'Polygon', coordinates: [ring] }, crs: 'EPSG:4326', areaM2: 30000, source: 'seed', isDemonstrativeGeometry: true, createdAt: new Date().toISOString() },
    baselines: [{ id: `${id}-bl1`, projectId: id, areaId: `${id}-parcel`, version: 1, parentId: null, periodStart: '2025-07-01', periodEnd: '2025-07-31', referenceHourLocal: 15, timezone: 'Europe/Rome', values: [], qaNotes: [], sourceSummary: 'test', isDemo: true, contentHash: 'x', lockedAt: new Date().toISOString() }],
    scenarios: [],
    runs: [],
    agri: { setup: {}, zones: [{ id: `${id}-zA`, name: 'Zona A' }], observations: [], weather: null, weatherNote: '', today: '2025-08-01' },
    decisions: [],
    verificationPlans: [],
    measurements: [],
    modelProposals: [],
    audit: [{ at: new Date().toISOString(), action: 'creazione', detail: 'test' }],
  };
}

function jpegWithGps() {
  const tiny = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const exif = piexif.dump({ GPS: { [piexif.GPSIFD.GPSLatitudeRef]: 'N', [piexif.GPSIFD.GPSLatitude]: [[41, 1], [33, 1], [0, 1]] } });
  return Buffer.from(piexif.insert(exif, Buffer.from(tiny, 'base64').toString('binary')), 'binary');
}

async function stage(user, orgId, b, bytes, mime = 'image/jpeg', overrides = {}) {
  const id = crypto.randomUUID();
  const ext = mime === 'application/pdf' ? 'pdf' : 'jpg';
  const path = `${orgId}/${b.project.id}/${id}.${ext}`;
  const { error } = await user.client.from('media_assets').insert({
    id, project_id: b.project.id, organization_id: orgId, storage_path: path, mime, size_bytes: bytes.length, sha256: sha(bytes),
    original_name: `prova.${ext}`, uploaded_by: user.id, author_name: 'Verifica', category: 'foto_sopralluogo', observed_on: '2025-08-01',
    area_ref: b.area.id, ...overrides,
  });
  if (error) throw new Error(`scheda: ${error.message}`);
  created.media.push({ id, path });
  const up = await user.client.storage.from('project-media').upload(path, new Blob([bytes], { type: mime }), { contentType: mime, upsert: false });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  return { id, path };
}

const gateway = (user, body) => user.client.functions.invoke('media-gateway', { body });
const status = async (err) => err?.context?.status ?? (err ? 0 : 200);

console.log(`Verifica su ${host} — esecuzione ${run}`);
const started = new Date();

let A, E, V, O, orgA, orgB, proj;
await check('S1', 'Utenti di prova: registrazione e login email/password', async () => {
  A = await newUser('admin');
  E = await newUser('editor');
  V = await newUser('viewer');
  O = await newUser('esterno');
  const { data } = await admin.from('users').select('id').in('id', [A.id, E.id, V.id, O.id]);
  expect(data?.length === 4, 'profili pubblici non creati dal trigger');
  return '4 utenti, profili creati dal trigger';
});
if (!A) await finish();

await check('S2', 'Organizzazioni e ruoli', async () => {
  const r1 = await A.client.rpc('create_organization', { p_name: `MDT test ${run} A` });
  expect(!r1.error, r1.error?.message);
  orgA = r1.data;
  created.orgs.push(orgA);
  for (const [u, role] of [[E, 'editor'], [V, 'viewer']]) {
    const r = await A.client.rpc('add_member_by_email', { p_org: orgA, p_email: u.email, p_role: role });
    expect(!r.error, r.error?.message);
  }
  const r2 = await O.client.rpc('create_organization', { p_name: `MDT test ${run} B` });
  orgB = r2.data;
  created.orgs.push(orgB);
  return 'admin, editor, viewer in A; esterno in B';
});

await check('S2b', 'Nessuna auto-promozione (memberships, users.app_role)', async () => {
  const u = await V.client.from('memberships').update({ role: 'admin' }).eq('user_id', V.id).select();
  expect((u.data ?? []).length === 0, 'il viewer ha modificato il proprio ruolo');
  const i = await V.client.from('memberships').insert({ organization_id: orgA, user_id: O.id, role: 'admin' });
  expect(!!i.error, 'il viewer ha inserito un membro');
  const a = await V.client.from('users').update({ app_role: 'admin_platform' }).eq('id', V.id);
  expect(!!a.error, 'app_role modificabile');
  return 'rifiutato';
});

await check('S3', 'Ruolo lettura: salvataggio rifiutato dal server', async () => {
  proj = bundle(`Vigneto ${run}`);
  const ok = await E.client.rpc('save_project', { p_organization_id: orgA, p_bundle: proj, p_bundle_hash: 'h', p_expected_version: 0 });
  expect(!ok.error && ok.data === 1, `editor: ${ok.error?.message}`);
  const no = await V.client.rpc('save_project', { p_organization_id: orgA, p_bundle: proj, p_bundle_hash: 'h', p_expected_version: 1 });
  expect(no.error?.code === '42501', `atteso 42501, ricevuto ${no.error?.code ?? 'nessun errore'}`);
  return 'editor 200, viewer 42501';
});

await check('S4', 'Isolamento: l’esterno non vede progetti né documenti', async () => {
  const p = await O.client.from('projects').select('id').eq('id', proj.project.id);
  const d = await O.client.from('project_documents').select('project_id');
  expect((p.data ?? []).length === 0 && (d.data ?? []).length === 0, 'dati visibili a un’altra organizzazione');
  return '0 righe';
});

await check('S5', 'Concorrenza: il secondo salvataggio riceve conflitto', async () => {
  const v2 = await E.client.rpc('save_project', { p_organization_id: orgA, p_bundle: { ...proj, audit: [...proj.audit, { at: new Date().toISOString(), action: 'x', detail: 'x' }] }, p_bundle_hash: 'h', p_expected_version: 1 });
  expect(!v2.error, v2.error?.message);
  const stale = await E.client.rpc('save_project', { p_organization_id: orgA, p_bundle: proj, p_bundle_hash: 'h', p_expected_version: 1 });
  expect(stale.error?.code === '40001', `atteso 40001, ricevuto ${stale.error?.code}`);
  proj.audit.push({ at: new Date().toISOString(), action: 'x', detail: 'x' });
  return '40001';
});

await check('S6', 'Baseline immutabile', async () => {
  const doc = await E.client.from('project_documents').select('bundle, version').eq('project_id', proj.project.id).maybeSingle();
  const b = doc.data.bundle;
  b.baselines[0].periodEnd = '2025-09-30';
  const r = await E.client.rpc('save_project', { p_organization_id: orgA, p_bundle: b, p_bundle_hash: 'h', p_expected_version: doc.data.version });
  expect(/immutabile/.test(r.error?.message ?? ''), 'modifica della baseline accettata');
  return 'rifiutata dal trigger';
});

await check('S7', 'Link condiviso: creazione, lettura anonima, revoca, scadenza', async () => {
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const t = await E.client.rpc('create_shared_link', { p_project: proj.project.id, p_days: 1 });
  expect(!t.error, t.error?.message);
  const g = await anon.rpc('get_shared_project', { p_token: t.data });
  expect(g.data?.readOnly === true, 'lettura anonima non riuscita');
  const link = await E.client.from('shared_links').select('id').eq('project_id', proj.project.id).limit(1).maybeSingle();
  await E.client.rpc('revoke_shared_link', { p_link: link.data.id });
  const g2 = await anon.rpc('get_shared_project', { p_token: t.data });
  expect(g2.data === null, 'link revocato ancora valido');
  const t2 = await E.client.rpc('create_shared_link', { p_project: proj.project.id, p_days: 1 });
  const past = new Date(Date.now() - 3 * 86400_000).toISOString();
  await admin.from('shared_links').update({ created_at: past, expires_at: new Date(Date.now() - 2 * 86400_000).toISOString() }).is('revoked_at', null).eq('project_id', proj.project.id);
  const g3 = await anon.rpc('get_shared_project', { p_token: t2.data });
  expect(g3.data === null, 'link scaduto ancora valido');
  return 'revoca e scadenza efficaci';
});

let photo;
await check('M1', 'Upload privato, validazione server, URL firmato reale, EXIF/GPS assenti nel file scaricato', async () => {
  const raw = jpegWithGps();
  const clean = Buffer.from(stripMetadata(new Uint8Array(raw), 'image/jpeg').bytes);
  photo = await stage(E, orgA, proj, clean);
  const c = await gateway(E, { action: 'complete', mediaId: photo.id });
  expect(!c.error, `complete: ${c.error?.message}`);
  const s = await gateway(V, { action: 'sign', mediaId: photo.id, downloadName: 'prova.jpg' });
  expect(!s.error && s.data?.signedUrl, `sign: ${s.error?.message}`);
  photo.url = s.data.signedUrl;
  const res = await fetch(photo.url);
  expect(res.status === 200, `download ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  expect(!bytes.includes(Buffer.from('Exif')), 'EXIF presente nel file scaricato');
  return `download 200, ${bytes.length} byte, nessun EXIF`;
});

await check('M2', 'Upload diretto senza scheda: rifiutato dallo storage', async () => {
  const up = await E.client.storage.from('project-media').upload(`${orgA}/${proj.project.id}/${crypto.randomUUID()}.jpg`, new Blob([Buffer.from([0xff, 0xd8, 0xff])]), { upsert: false });
  expect(!!up.error, 'oggetto accettato senza scheda');
  return up.error.message;
});

await check('M3', 'Ruolo lettura: scheda e upload via API rifiutati', async () => {
  const i = await V.client.from('media_assets').insert({ id: crypto.randomUUID(), organization_id: orgA, uploaded_by: V.id });
  expect(!!i.error, 'scheda inserita dal viewer');
  return i.error.message;
});

await check('M4', 'Consultazione registrata nell’audit prima della firma', async () => {
  const { data } = await admin.from('audit_logs').select('action').eq('entity', 'media_assets').eq('entity_id', photo.id);
  expect((data ?? []).some((r) => r.action === 'consultazione'), 'nessuna riga di consultazione');
  return (data ?? []).map((r) => r.action).join(', ');
});

await check('M4b', 'Il client non firma direttamente', async () => {
  const d = await V.client.storage.from('project-media').createSignedUrl(photo.path, 60);
  expect(!!d.error, 'firma diretta consentita');
  return d.error.message;
});

if (SLOW) {
  await check('M5', 'URL firmato scaduto dopo 60 s', async () => {
    await new Promise((r) => setTimeout(r, 65_000));
    const res = await fetch(photo.url);
    expect(res.status >= 400, `ancora valido (${res.status})`);
    return `HTTP ${res.status}`;
  });
} else record('M5', 'URL firmato scaduto dopo 60 s', 'skip', 'eseguire con --slow');

await check('M8', 'Altra organizzazione: niente firma né lettura', async () => {
  const s = await gateway(O, { action: 'sign', mediaId: photo.id });
  expect((await status(s.error)) === 403, `atteso 403, ricevuto ${await status(s.error)}`);
  return '403';
});

await check('M11', 'Validazione server: PDF dichiarato come JPEG rifiutato e rimosso', async () => {
  const fake = await stage(E, orgA, proj, Buffer.from('%PDF-1.7\nfinto\n'), 'image/jpeg');
  const c = await gateway(E, { action: 'complete', mediaId: fake.id });
  expect((await status(c.error)) === 422, `atteso 422, ricevuto ${await status(c.error)}`);
  const { data } = await admin.from('media_assets').select('id').eq('id', fake.id);
  expect((data ?? []).length === 0, 'scheda non rimossa');
  return '422, scheda e oggetto rimossi';
});

await check('M11b', 'Validazione server: client che salta la rimozione EXIF rifiutato', async () => {
  const dirty = await stage(E, orgA, proj, jpegWithGps());
  const c = await gateway(E, { action: 'complete', mediaId: dirty.id });
  expect((await status(c.error)) === 422, `atteso 422, ricevuto ${await status(c.error)}`);
  return '422';
});

await check('M10', 'Limite di dimensione dell’organizzazione', async () => {
  await A.client.from('organizations').update({ media_max_bytes: 1048576 }).eq('id', orgA);
  const big = await E.client.from('media_assets').insert({
    id: crypto.randomUUID(), project_id: proj.project.id, organization_id: orgA, storage_path: 'x', mime: 'image/jpeg', size_bytes: 2_000_000, sha256: 'a'.repeat(64),
    original_name: 'big.jpg', uploaded_by: E.id, author_name: 'x', category: 'foto_sopralluogo', observed_on: '2025-08-01', area_ref: proj.area.id,
  });
  await A.client.from('organizations').update({ media_max_bytes: 20971520 }).eq('id', orgA);
  expect(!!big.error, 'file oltre il limite accettato');
  return big.error.message;
});

await check('M6', 'Eliminazione amministrativa: oggetto rimosso e link non più valido', async () => {
  const no = await gateway(E, { action: 'delete', mediaId: photo.id });
  expect((await status(no.error)) === 403, 'editor ha eliminato');
  const fresh = await gateway(V, { action: 'sign', mediaId: photo.id });
  const d = await gateway(A, { action: 'delete', mediaId: photo.id });
  expect(!d.error, `delete: ${d.error?.message}`);
  const res = await fetch(fresh.data.signedUrl);
  expect(res.status >= 400, `URL ancora valido (${res.status})`);
  return `URL dopo eliminazione: HTTP ${res.status}`;
});

await check('M9', 'Revoca dell’utente: nuove firme rifiutate subito', async () => {
  const p2 = await stage(E, orgA, proj, Buffer.from(stripMetadata(new Uint8Array(jpegWithGps()), 'image/jpeg').bytes));
  await gateway(E, { action: 'complete', mediaId: p2.id });
  await A.client.from('memberships').delete().eq('organization_id', orgA).eq('user_id', V.id);
  const s = await gateway(V, { action: 'sign', mediaId: p2.id });
  expect((await status(s.error)) === 403, `atteso 403, ricevuto ${await status(s.error)}`);
  return '403 dopo la revoca';
});

await check('M13', 'Progetto con file non eliminabile', async () => {
  const r = await A.client.from('projects').delete().eq('id', proj.project.id);
  expect(!!r.error, 'progetto con file eliminato');
  return r.error.message;
});

await check('A1', 'Audit leggibile solo dagli amministratori', async () => {
  const a = await A.client.from('audit_logs').select('id').eq('organization_id', orgA);
  const e = await E.client.from('audit_logs').select('id').eq('organization_id', orgA);
  expect((a.data ?? []).length > 0 && (e.data ?? []).length === 0, 'visibilità errata');
  return `${a.data.length} righe per l’admin, 0 per l’editor`;
});

await check('R1', 'Limitazione di frequenza su login errati (osservazione)', async () => {
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const codes = [];
  for (let i = 0; i < 6; i++) {
    const { error } = await c.auth.signInWithPassword({ email: `mdt-${run}-nessuno@example.test`, password: 'sbagliata' });
    codes.push(error?.status ?? 200);
  }
  return `codici: ${codes.join(', ')} (429 = limite attivo; i limiti dipendono dalla configurazione del progetto)`;
});

// ------------------------------------------------------------ F31 previsioni
const T5 = 'mistralai/Timestral-5M@bdd20cfc15a3fea0e4cb5ccef37f8d3ca7aa335f';
const SEASONAL = 'baseline-persistenza-stagionale@n/a';
const LEVELS = [0.01, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.99];
const runRow = (model) => ({
  organization_id: orgA,
  project_id: proj.project.id,
  model_version_id: model,
  context: 'agricolo',
  horizon: 3,
  issued_at: '2025-09-12T23:00:00Z',
  input_hash: `verify-${run}`,
  data_class: 'STIMATO_DA_MODELLO',
  lineage: { source: 'verifica automatica', period: { from: '2025-08-15', to: '2025-09-12' }, variable: 'umidita_suolo' },
});
async function insertOutput(client, runId) {
  const ts = ['2025-09-13T00:00:00Z', '2025-09-13T01:00:00Z', '2025-09-13T02:00:00Z'];
  const s = await client.from('forecast_series').insert({ run_id: runId, variable: 'umidita_suolo', unit: 'm³/m³', timestamps: ts, median: [0.15, 0.15, 0.15] }).select('id').single();
  expect(!s.error, s.error?.message);
  const q = await client.from('forecast_quantiles').insert(LEVELS.map((l) => ({ series_id: s.data.id, level: l, values: ts.map(() => 0.14 + l * 0.02) })));
  expect(!q.error, q.error?.message);
}
let fRun, fThr;

await check('F1', 'Previsioni: l’editor registra una baseline con 21 quantili', async () => {
  const r = await E.client.from('forecast_runs').insert(runRow(SEASONAL)).select('id, started_by').single();
  expect(!r.error, r.error?.message);
  expect(r.data.started_by === E.id, 'started_by non è l’utente');
  fRun = r.data.id;
  await insertOutput(E.client, fRun);
  const done = await E.client.from('forecast_runs').update({ status: 'completata' }).eq('id', fRun);
  expect(!done.error, done.error?.message);
  return 'esecuzione, serie e 21 quantili registrati';
});

await check('F2', 'Previsioni: un client non registra un’esecuzione Timestral', async () => {
  const r = await A.client.from('forecast_runs').insert(runRow(T5));
  expect(!!r.error, 'esecuzione Timestral accettata da un client');
  return r.error.message;
});

await check('F3', 'Previsioni: il ruolo di servizio registra un’esecuzione Timestral', async () => {
  const r = await admin.from('forecast_runs').insert({ ...runRow(T5), started_by: E.id }).select('id').single();
  expect(!r.error, r.error?.message);
  await insertOutput(admin, r.data.id);
  return 'accettata';
});

await check('F4', 'Previsioni: esecuzione conclusa immutabile', async () => {
  const r = await E.client.from('forecast_runs').update({ warnings: ['alterata'] }).eq('id', fRun);
  expect(!!r.error, 'esecuzione conclusa modificata');
  return r.error.message;
});

await check('F5', 'Previsioni: isolamento tra organizzazioni', async () => {
  const r = await O.client.from('forecast_runs').select('id');
  const q = await O.client.from('forecast_quantiles').select('series_id');
  expect((r.data ?? []).length === 0 && (q.data ?? []).length === 0, 'l’esterno vede previsioni di A');
  return '0 righe';
});

await check('F6', 'Previsioni: soglie versionate', async () => {
  const row = { organization_id: orgA, project_id: proj.project.id, context: 'agricolo', zone: 'Zona nord', variable: 'umidita_suolo', unit: 'm³/m³', threshold: 0.16, direction: 'sotto', min_probability: 0.5, expert_role: 'agronomo', rationale: 'Verifica automatica delle soglie', set_by: E.id };
  const t = await E.client.from('forecast_thresholds').insert(row).select('id').single();
  expect(!t.error, t.error?.message);
  fThr = t.data.id;
  const u = await E.client.from('forecast_thresholds').update({ threshold: 0.2 }).eq('id', fThr);
  expect(!!u.error, 'soglia sovrascritta');
  return u.error.message;
});

await check('F7', 'Previsioni: avviso con verifica ex-post', async () => {
  const a = await E.client.from('forecast_alerts').insert({ organization_id: orgA, run_id: fRun, threshold_id: fThr, zone: 'Zona nord', first_exceedance: '2025-09-13T01:00:00Z', probability: 0.6 }).select('id').single();
  expect(!a.error, a.error?.message);
  const bad = await E.client.from('forecast_alerts').update({ probability: 0.9 }).eq('id', a.data.id);
  expect(!!bad.error, 'probabilità modificata');
  const ok = await E.client.from('forecast_alerts').update({ status: 'verificato_in_campo', observed_value: 0.151 }).eq('id', a.data.id).select('reviewed_by').single();
  expect(!ok.error && ok.data.reviewed_by === E.id, ok.error?.message ?? 'reviewed_by errato');
  return 'probabilità bloccata, ex-post registrato';
});

await check('F8', 'Previsioni: audit visibile solo all’admin', async () => {
  const a = await A.client.from('audit_logs').select('entity').eq('organization_id', orgA).like('entity', 'forecast%');
  const v = await V.client.from('audit_logs').select('entity').like('entity', 'forecast%');
  expect((a.data ?? []).length >= 4 && (v.data ?? []).length === 0, 'visibilità audit errata');
  return `${a.data.length} righe per l’admin, 0 per il viewer`;
});

// ------------------------------------------------------------ W meteo (Open-Meteo → Supabase)
let wLoc;
await check('W1', 'Meteo: località creata dall’editor, letta dal viewer, invisibile all’esterno', async () => {
  const r = await E.client.from('weather_locations').insert({ organization_id: orgA, project_id: proj.project.id, name: `Verifica ${run}`, scope: 'agricultural', latitude: 41.8, longitude: 14.92 }).select('id').single();
  expect(!r.error, r.error?.message);
  wLoc = r.data.id;
  const v = await V.client.from('weather_locations').select('id').eq('id', wLoc);
  const o = await O.client.from('weather_locations').select('id').eq('id', wLoc);
  expect((v.data ?? []).length === 1 && (o.data ?? []).length === 0, 'visibilità errata');
  return 'RLS rispettata';
});

await check('W2', 'Meteo: nessun client si spaccia per Open-Meteo', async () => {
  const obs = await A.client.from('weather_observations').insert({ organization_id: orgA, location_id: wLoc, observed_at: new Date().toISOString(), variable: 'temperature_2m', value: 20, unit: '°C', source: 'open_meteo' });
  const runRow = await A.client.from('weather_fetch_runs').insert({ organization_id: orgA, location_id: wLoc, trigger: 'manuale', model_requested: 'best_match', request_hash: 'a'.repeat(64) });
  expect(!!obs.error && !!runRow.error, 'inserimento con fonte Open-Meteo accettato da un client');
  return 'rifiutato';
});

await check('W3', 'Meteo: funzioni di registrazione riservate al service role', async () => {
  const r = await E.client.rpc('weather_begin_fetch', { p_location: wLoc, p_request_hash: 'b'.repeat(64), p_trigger: 'manuale', p_model: 'best_match' });
  expect(!!r.error, 'weather_begin_fetch eseguibile da un utente');
  return r.error.message;
});

const wInvoke = await E.client.functions.invoke('open-meteo-ingest', { body: { location_id: wLoc } });
const wStatus = wInvoke.error?.context?.status ?? (wInvoke.error ? 0 : 200);
if (wStatus === 404 || wStatus === 0) {
  record('W4', 'Meteo: aggiornamento manuale via Edge Function', 'skip', `funzione open-meteo-ingest non pubblicata o non raggiungibile (stato ${wStatus})`);
  record('W5', 'Meteo: limite di frequenza dell’aggiornamento manuale', 'skip', 'richiede la funzione pubblicata');
} else {
  await check('W4', 'Meteo: aggiornamento manuale via Edge Function (Open-Meteo reale)', async () => {
    expect(wStatus === 200, `stato ${wStatus}`);
    const runs = await V.client.from('weather_fetch_runs').select('status, points_count, response_grid_latitude, model_requested').eq('location_id', wLoc);
    const ok = (runs.data ?? []).find((x) => x.status === 'completata');
    expect(ok && ok.points_count >= 72 && ok.response_grid_latitude, 'acquisizione non registrata');
    return `${ok.points_count} ore registrate, cella ${ok.response_grid_latitude}`;
  });
  await check('W5', 'Meteo: secondo aggiornamento manuale entro 10 minuti rifiutato', async () => {
    const again = await E.client.functions.invoke('open-meteo-ingest', { body: { location_id: wLoc } });
    expect(again.error?.context?.status === 429, `stato ${again.error?.context?.status ?? 200}`);
    return '429';
  });
}
record('W6', 'Meteo: job pg_cron ogni 3 ore', 'skip', 'manuale: verificare cron.job_run_details e una nuova emissione dopo 3 ore (docs/16)');

record('M12', 'Offline su smartphone e sincronizzazione', 'skip', 'manuale (docs/14)');
record('M14', 'Pulizia a fine conservazione pianificata', 'skip', 'manuale: richiede pg_cron e segreto (docs/13)');
record('S8', 'Magic link via email', 'skip', 'manuale: verificare la ricezione della mail di test');

await finish();

async function finish() {
  if (!KEEP) {
    for (const m of created.media) {
      await admin.storage.from('project-media').remove([m.path]);
      await admin.from('media_assets').delete().eq('id', m.id);
    }
    for (const o of created.orgs) await admin.from('organizations').delete().eq('id', o);
    for (const u of created.users) await admin.auth.admin.deleteUser(u);
  }
  const ok = results.filter((r) => r.status === 'ok').length;
  const ko = results.filter((r) => r.status === 'ko').length;
  const day = started.toISOString().slice(0, 10);
  mkdirSync('docs/reports', { recursive: true });
  const lines = [
    `# Verifica Supabase reale — ${day}`,
    '',
    `- Ambiente: progetto di TEST su \`${host}\` (riferimento oscurato)`,
    `- Esecuzione: ${run}, ${started.toISOString()} → ${new Date().toISOString()}`,
    `- Esito: ${ok} superati, ${ko} falliti, ${results.length - ok - ko} non eseguiti`,
    `- Pulizia dei dati di prova: ${KEEP ? 'no (--keep)' : 'sì'}`,
    '',
    '| ID | Controllo | Esito | Evidenza |',
    '|---|---|---|---|',
    ...results.map((r) => `| ${r.id} | ${r.title} | ${r.status === 'ok' ? '✔' : r.status === 'ko' ? '✖' : 'non eseguito'} | ${String(r.evidence).replace(/\|/g, '/')} |`),
    '',
    'Nessuna credenziale è riportata in questo file. Le password di prova sono casuali e non vengono salvate.',
  ];
  writeFileSync(`docs/reports/supabase-real-${day}-${run}.md`, lines.join('\n') + '\n');
  console.log(`\nReport: docs/reports/supabase-real-${day}-${run}.md`);
  process.exit(ko ? 1 : 0);
}
