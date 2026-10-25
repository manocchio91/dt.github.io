// Pulizia dei dati di prova sul progetto Supabase di TEST, in due fasi:
//   node --env-file=.env.supabase-test scripts/supabase-real/cleanup-test-data.mjs --anteprima
//       → elenco preciso (ID) di organizzazioni "MDT test …", utenti "mdt-…@example.test" e righe collegate;
//         verifica che non esistano altri utenti od organizzazioni; scrive docs/reports/supabase-cleanup-anteprima-<data>.md
//         e il file degli ID in supabase/.temp/cleanup-ids.json (escluso da Git).
//   node --env-file=.env.supabase-test scripts/supabase-real/cleanup-test-data.mjs --elimina
//       → elimina SOLO gli ID dell'anteprima: organizzazioni con delete_organization (conferma del nome),
//         poi utenti con Supabase Auth Admin; rilegge il database e fallisce se resta anche una sola entità.
// Nessun trigger o RLS viene disattivato; nessuna chiave viene stampata.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: SERVICE, MDT_CONFIRM_TEST_PROJECT } = process.env;
if (!URL_ || !SERVICE) throw new Error('Mancano SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (file .env locale escluso da Git).');
if (MDT_CONFIRM_TEST_PROJECT !== 'yes') throw new Error('Progetto non confermato come ambiente di TEST (MDT_CONFIRM_TEST_PROJECT=yes).');
const mode = process.argv.includes('--elimina') ? 'elimina' : process.argv.includes('--anteprima') ? 'anteprima' : null;
if (!mode) throw new Error('Specificare --anteprima oppure --elimina.');

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const IDS_FILE = 'supabase/.temp/cleanup-ids.json';
const ORG_RE = /^MDT test [0-9a-f]{8} [A-Z]$/;
const USER_RE = /^mdt-[0-9a-f]{8}-[a-z]+@example\.test$/;
const day = new Date().toISOString().slice(0, 10);

const ORG_TABLES = ['memberships', 'projects', 'project_documents', 'shared_links', 'media_assets', 'weather_locations', 'weather_fetch_runs', 'weather_forecast_points',
  'weather_observations', 'forecast_runs', 'forecast_thresholds', 'forecast_alerts', 'forecast_backtests'];

async function countWhere(table, col, val) {
  const r = await admin.from(table).select('*', { count: 'exact', head: true }).eq(col, val);
  if (r.error) throw new Error(`${table}: ${r.error.message}`);
  return r.count ?? 0;
}
async function countAll(table) {
  const r = await admin.from(table).select('*', { count: 'exact', head: true });
  if (r.error) throw new Error(`${table}: ${r.error.message}`);
  return r.count ?? 0;
}
async function allUsers() {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (r.error) throw new Error(r.error.message);
    out.push(...r.data.users);
    if (r.data.users.length < 200) return out;
  }
}
async function storageObjects(orgId) {
  const r = await admin.storage.from('project-media').list(orgId, { limit: 100 });
  return r.error ? 0 : (r.data ?? []).length;
}

if (mode === 'anteprima') {
  const orgs = (await admin.from('organizations').select('id, name, created_at').order('name')).data ?? [];
  const users = await allUsers();
  const testOrgs = orgs.filter((o) => ORG_RE.test(o.name));
  const testUsers = users.filter((u) => USER_RE.test(u.email ?? ''));
  const otherOrgs = orgs.length - testOrgs.length;
  const otherUsers = users.length - testUsers.length;
  const rows = [];
  for (const o of testOrgs) {
    const c = {};
    for (const t of ORG_TABLES) c[t] = await countWhere(t, 'organization_id', o.id);
    c.oggetti_storage = await storageObjects(o.id);
    rows.push({ id: o.id, nome: o.name, collegati: c });
  }
  const ids = { generatoIl: new Date().toISOString(), organizzazioni: testOrgs.map((o) => ({ id: o.id, nome: o.name })), utenti: testUsers.map((u) => ({ id: u.id, email: u.email })) };
  mkdirSync('supabase/.temp', { recursive: true });
  writeFileSync(IDS_FILE, JSON.stringify(ids, null, 1));
  const lines = [
    `# Anteprima pulizia dati di prova — ${day}`,
    '',
    'Progetto Supabase di TEST (riferimento omesso). Nessuna credenziale in questo file.',
    '',
    `- Organizzazioni di prova (\`MDT test <esecuzione> <lettera>\`): **${testOrgs.length}**`,
    `- Utenti di prova (\`mdt-<esecuzione>-<ruolo>@example.test\`): **${testUsers.length}**`,
    `- Altre organizzazioni (non di prova): **${otherOrgs}**`,
    `- Altri utenti (non di prova): **${otherUsers}**`,
    '',
    '## Organizzazioni e righe collegate',
    '',
    '| ID | Nome | Righe collegate |',
    '|---|---|---|',
    ...rows.map((r) => `| \`${r.id}\` | ${r.nome} | ${Object.entries(r.collegati).filter(([, n]) => n > 0).map(([t, n]) => `${t}: ${n}`).join(', ') || 'nessuna'} |`),
    '',
    '## Utenti',
    '',
    '| ID | Email di prova |',
    '|---|---|',
    ...testUsers.map((u) => `| \`${u.id}\` | ${u.email} |`),
    '',
    otherOrgs || otherUsers ? '**ATTENZIONE: esistono organizzazioni o utenti non di prova. La pulizia non deve procedere senza verifica.**' : 'Nessun utente od organizzazione reale presente.',
    '',
  ];
  mkdirSync('docs/reports', { recursive: true });
  writeFileSync(`docs/reports/supabase-cleanup-anteprima-${day}.md`, lines.join('\n'));
  console.log(`Anteprima: ${testOrgs.length} organizzazioni, ${testUsers.length} utenti di prova; altri: ${otherOrgs} organizzazioni, ${otherUsers} utenti.`);
  console.log(`Report: docs/reports/supabase-cleanup-anteprima-${day}.md`);
  process.exitCode = otherOrgs || otherUsers ? 2 : 0;
} else {
  if (!existsSync(IDS_FILE)) throw new Error('Eseguire prima --anteprima.');
  const ids = JSON.parse(readFileSync(IDS_FILE, 'utf8'));
  const errors = [];
  for (const o of ids.organizzazioni) {
    if (!ORG_RE.test(o.nome)) { errors.push(`organizzazione ${o.id}: nome non di prova`); continue; }
    const cur = await admin.from('organizations').select('id, name').eq('id', o.id).maybeSingle();
    if (!cur.data) continue;
    if (cur.data.name !== o.nome) { errors.push(`organizzazione ${o.id}: nome cambiato dopo l'anteprima`); continue; }
    const r = await admin.rpc('delete_organization', { p_org: o.id, p_confirm_name: o.nome });
    if (r.error) errors.push(`organizzazione ${o.id}: ${r.error.message}`);
  }
  for (const u of ids.utenti) {
    if (!USER_RE.test(u.email ?? '')) { errors.push(`utente ${u.id}: email non di prova`); continue; }
    const r = await admin.auth.admin.deleteUser(u.id);
    if (r.error && !/not found/i.test(r.error.message)) errors.push(`utente ${u.id}: ${r.error.message}`);
  }
  // verifica rileggendo il database: ogni entità attesa deve essere sparita
  const remainingOrgs = [];
  for (const o of ids.organizzazioni) if ((await admin.from('organizations').select('id').eq('id', o.id)).data?.length) remainingOrgs.push(o.id);
  const remainingUsers = [];
  for (const u of ids.utenti) {
    const g = await admin.auth.admin.getUserById(u.id);
    const profile = (await admin.from('users').select('id').eq('id', u.id)).data ?? [];
    if ((g.data?.user && !g.error) || profile.length) remainingUsers.push(u.id);
  }
  const counts = {};
  for (const t of ['organizations', 'users', ...ORG_TABLES, 'user_preferences', 'audit_logs', 'forecast_model_versions']) counts[t] = await countAll(t);
  const buckets = (await admin.storage.listBuckets()).data?.map((b) => b.id) ?? [];
  const authUsers = (await allUsers()).length;
  const objects = (await admin.storage.from('project-media').list('', { limit: 100 })).data?.length ?? 0;
  const appRowsLeft = Object.entries(counts).filter(([t, n]) => !['audit_logs', 'forecast_model_versions'].includes(t) && n > 0);
  const ok = !errors.length && !remainingOrgs.length && !remainingUsers.length && authUsers === 0 && objects === 0 && !appRowsLeft.length && counts.forecast_model_versions === 4 && buckets.length === 1 && buckets[0] === 'project-media';
  const lines = [
    `# Pulizia dati di prova — ${day}`,
    '',
    'Progetto Supabase di TEST (riferimento omesso). Nessuna credenziale in questo file.',
    '',
    `Esito: **${ok ? 'pulizia completata e verificata sui conteggi reali' : 'PULIZIA NON COMPLETA'}**`,
    '',
    `- Organizzazioni eliminate: ${ids.organizzazioni.length - remainingOrgs.length} su ${ids.organizzazioni.length}`,
    `- Utenti eliminati: ${ids.utenti.length - remainingUsers.length} su ${ids.utenti.length}`,
    `- Utenti Auth rimasti in totale: ${authUsers}`,
    `- Oggetti nello storage (cartella principale del bucket): ${objects}`,
    `- Bucket: ${buckets.join(', ')}`,
    `- Errori: ${errors.length ? errors.join('; ') : 'nessuno'}`,
    '',
    '## Conteggi finali (righe)',
    '',
    '| Tabella | Righe |',
    '|---|---|',
    ...Object.entries(counts).map(([t, n]) => `| ${t} | ${n} |`),
    '',
    'Le righe di `audit_logs` restano per scelta (audit minimo, senza legame a organizzazioni o utenti eliminati).',
    '',
  ];
  writeFileSync(`docs/reports/supabase-cleanup-${day}.md`, lines.join('\n'));
  console.log(ok ? 'Pulizia completata e verificata.' : 'PULIZIA NON COMPLETA: vedi report.');
  console.log(JSON.stringify({ remainingOrgs: remainingOrgs.length, remainingUsers: remainingUsers.length, authUsers, objects, appRowsLeft, catalogo: counts.forecast_model_versions, buckets, errori: errors.length }));
  process.exitCode = ok ? 0 : 1;
}
