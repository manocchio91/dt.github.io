// Verifica dell'accesso ANONIMO sul progetto Supabase reale (solo chiave anon pubblica).
// Nessun dato viene creato: ogni scrittura deve essere rifiutata.
// Uso: node scripts/supabase-real/anon-check.mjs   (legge .env.supabase-test)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.supabase-test', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const URL_ = env.SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY;
if (!URL_ || !ANON) throw new Error('SUPABASE_URL o SUPABASE_ANON_KEY mancanti in .env.supabase-test');
const h = { apikey: ANON, authorization: `Bearer ${ANON}`, 'content-type': 'application/json' };
const results = [];
const rec = (id, title, ok, evidence) => {
  results.push({ id, title, ok, evidence });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${id} ${title} — ${evidence}`);
};
const uuid = '00000000-0000-4000-8000-000000000000';

const TABLES = ['organizations', 'memberships', 'users', 'projects', 'project_documents', 'shared_links', 'audit_logs', 'user_preferences', 'media_assets',
  'forecast_runs', 'forecast_series', 'forecast_quantiles', 'forecast_thresholds', 'forecast_alerts', 'forecast_backtests', 'forecast_model_versions',
  'weather_locations', 'weather_fetch_runs', 'weather_forecast_points', 'weather_observations', 'baselines', 'scenarios', 'decisions', 'sensors', 'sensor_measurements'];

for (const t of TABLES) {
  const r = await fetch(`${URL_}/rest/v1/${t}?select=*&limit=1`, { headers: h });
  const body = await r.text();
  const empty = r.status === 200 && body.trim() === '[]';
  const denied = r.status === 401 || r.status === 403;
  rec('A-R', `lettura anonima di ${t}`, empty || denied, `HTTP ${r.status}${empty ? ', nessuna riga' : denied ? ', negato' : `, corpo di ${body.length} byte`}`);
}

const writes = [
  ['organizations', { name: 'anon' }],
  ['projects', { organization_id: uuid, name: 'anon', sector: 'urban' }],
  ['weather_locations', { organization_id: uuid, project_id: uuid, name: 'anon', scope: 'urban', latitude: 41, longitude: 14 }],
  ['weather_observations', { organization_id: uuid, location_id: uuid, observed_at: new Date().toISOString(), variable: 'temperature_2m', value: 1, unit: '°C', source: 'open_meteo' }],
  ['weather_fetch_runs', { organization_id: uuid, location_id: uuid, trigger: 'manuale', model_requested: 'best_match', request_hash: 'a'.repeat(64) }],
  ['forecast_runs', { organization_id: uuid, project_id: uuid, model_version_id: 'baseline-persistenza@n/a', context: 'urbano', horizon: 24, issued_at: new Date().toISOString(), input_hash: 'x', data_class: 'STIMATO_DA_MODELLO', lineage: { source: 'x', period: {}, variable: 'x' } }],
];
for (const [t, row] of writes) {
  const r = await fetch(`${URL_}/rest/v1/${t}`, { method: 'POST', headers: { ...h, prefer: 'return=minimal' }, body: JSON.stringify(row) });
  rec('A-W', `scrittura anonima in ${t}`, r.status >= 400, `HTTP ${r.status}`);
}

const rpcs = [
  ['create_organization', { p_name: 'anon' }],
  ['add_member_by_email', { p_org: uuid, p_email: 'x@example.test', p_role: 'admin' }],
  ['save_project', { p_organization_id: uuid, p_bundle: {}, p_bundle_hash: 'h', p_expected_version: 0 }],
  ['weather_authorize_manual', { p_location: uuid }],
  ['weather_begin_fetch', { p_location: uuid, p_request_hash: 'a'.repeat(64), p_trigger: 'manuale', p_model: 'best_match' }],
  ['weather_complete_fetch', { p_run: uuid, p_meta: {}, p_points: [] }],
  ['weather_active_locations', {}],
  ['weather_history_status', { p_location: uuid }],
  ['delete_organization', { p_org: uuid, p_confirm_name: 'anon' }],
  ['log_media_access', { p_media: uuid }],
  ['media_authorize_delete', { p_media: uuid }],
];
for (const [fn, args] of rpcs) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: h, body: JSON.stringify(args) });
  const body = await r.text();
  rec('A-F', `funzione ${fn} da anonimo`, r.status >= 400, `HTTP ${r.status} ${body.slice(0, 80).replace(/\s+/g, ' ')}`);
}

// PostGIS non più esposto nello schema dell'API (migrazione 0009)
{
  const srs = await fetch(`${URL_}/rest/v1/spatial_ref_sys?select=srid&limit=1`, { headers: h });
  rec('A-PG', 'spatial_ref_sys non raggiungibile via REST', [401, 403, 404].includes(srs.status), `HTTP ${srs.status}`);
  const del = await fetch(`${URL_}/rest/v1/spatial_ref_sys?srid=eq.4326`, { method: 'DELETE', headers: h });
  rec('A-PG', 'spatial_ref_sys non modificabile via REST', del.status >= 400, `HTTP ${del.status}`);
  const ext = await fetch(`${URL_}/rest/v1/rpc/st_estimatedextent`, { method: 'POST', headers: h, body: JSON.stringify({}) });
  rec('A-PG', 'st_estimatedextent non esposta via REST', [401, 403, 404].includes(ext.status), `HTTP ${ext.status}`);
}

{
  const r = await fetch(`${URL_}/rest/v1/rpc/get_shared_project`, { method: 'POST', headers: h, body: JSON.stringify({ p_token: 'token-inesistente-di-verifica' }) });
  const body = await r.text();
  const noData = r.status >= 400 || body.trim() === 'null';
  rec('A-S', 'link condiviso inesistente: nessun progetto restituito', noData, `HTTP ${r.status} ${body.slice(0, 80).replace(/\s+/g, ' ')}`);
}

{
  const list = await fetch(`${URL_}/storage/v1/object/list/project-media`, { method: 'POST', headers: h, body: JSON.stringify({ prefix: '', limit: 10 }) });
  const lb = await list.text();
  rec('A-ST', 'elenco anonimo del bucket project-media', list.status >= 400 || lb.trim() === '[]', `HTTP ${list.status}`);
  const up = await fetch(`${URL_}/storage/v1/object/project-media/${uuid}/${uuid}/verifica.txt`, { method: 'POST', headers: { apikey: ANON, authorization: `Bearer ${ANON}`, 'content-type': 'text/plain' }, body: 'verifica' });
  rec('A-ST', 'caricamento anonimo nel bucket project-media', up.status >= 400, `HTTP ${up.status}`);
  const pub = await fetch(`${URL_}/storage/v1/object/public/project-media/${uuid}/x.jpg`);
  rec('A-ST', 'bucket non pubblico (URL pubblico non servito)', pub.status >= 400, `HTTP ${pub.status}`);
}

const failed = results.filter((r) => !r.ok);
const date = new Date().toISOString().slice(0, 10);
mkdirSync('docs/reports', { recursive: true });
const host = new URL(URL_).host.replace(/^[^.]+/, '****');
writeFileSync(
  `docs/reports/supabase-anon-check-${date}.md`,
  [
    `# Accesso anonimo su Supabase reale — ${date}`,
    '',
    `Progetto: \`${host}\` (riferimento mascherato). Solo chiave anon pubblica; nessun dato creato.`,
    '',
    `Esito: **${results.length - failed.length}/${results.length} controlli superati**.`,
    '',
    '| Esito | Codice | Controllo | Evidenza |',
    '|---|---|---|---|',
    ...results.map((r) => `| ${r.ok ? 'OK' : '**FALLITO**'} | ${r.id} | ${r.title} | ${r.evidence.replace(/\|/g, '/')} |`),
    '',
  ].join('\n'),
);
console.log(`\n${results.length - failed.length}/${results.length} controlli superati. Report: docs/reports/supabase-anon-check-${date}.md`);
process.exitCode = failed.length ? 1 : 0;
