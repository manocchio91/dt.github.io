#!/usr/bin/env node
/**
 * Storico Open-Meteo di 7 giorni su un progetto Supabase REALE di TEST (mai produzione).
 *
 * Crea dati temporanei con prefisso MDT_SEVENDAYS_TEST_<timestamp> con le procedure normali
 * (Auth Admin, create_organization, add_member_by_email, save_project, località inserite con RLS).
 * La creazione della località avvia il recupero iniziale dal server (trigger weather_initial_fetch →
 * Edge Function open-meteo-ingest, migrazione 0012): lo script NON chiama Open-Meteo per l'acquisizione.
 * Verifica storico, lacune, duplicati, provenienza, separazione storico/previsione, aggiornamento
 * incrementale e permessi. Nessun trigger o RLS viene disattivato; nessuna credenziale nel report.
 *
 *   node scripts/supabase-real/weather-history-runtime.mjs setup
 *   node scripts/supabase-real/weather-history-runtime.mjs verify
 *   node scripts/supabase-real/weather-history-runtime.mjs cleanup [PREFISSO_AGGIUNTIVO ...]
 * Lo stato (id, email, password casuale) resta in supabase/.temp/history-state.json (escluso da Git)
 * fino alla pulizia. cleanup accetta prefissi di altre esecuzioni di prova (es. MDT_BACKFILL_TEST_…).
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const readEnv = (f) =>
  Object.fromEntries(
    readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
  );
const env = readEnv('.env.supabase-test');
if (env.MDT_CONFIRM_TEST_PROJECT !== 'yes') throw new Error('MDT_CONFIRM_TEST_PROJECT=yes mancante: il progetto deve essere di TEST.');
const URL_ = env.SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY;
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const STATE = 'supabase/.temp/history-state.json';
const cmd = process.argv[2];

const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const results = [];
function record(id, title, status, evidence = '') {
  results.push({ id, title, status, evidence });
  console.log(`${status === 'ok' ? '✔' : '✖'} ${id} ${title}${evidence ? ` — ${evidence}` : ''}`);
}
async function check(id, title, fn) {
  try {
    record(id, title, 'ok', (await fn()) ?? '');
  } catch (e) {
    record(id, title, 'ko', e.message);
  }
}
async function signIn(email, password) {
  const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`accesso ${email.split('@')[0]}: ${error.message}`);
  return client;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bundle(name, sector, ring) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    project: { id, name, sector, mode: 'demo', isDemoSeed: false, description: 'Dati temporanei di verifica dello storico Open-Meteo', createdAt: now },
    area: { id: `${id}-area`, name: 'Area di prova', geometry: { type: 'Polygon', coordinates: [ring] }, crs: 'EPSG:4326', areaM2: 5000, source: 'seed', isDemonstrativeGeometry: true, createdAt: now },
    baselines: [], scenarios: [], runs: [],
    agri: sector === 'agriculture' ? { setup: {}, zones: [], observations: [], weather: null, weatherNote: '', today: now.slice(0, 10) } : undefined,
    decisions: [], verificationPlans: [], measurements: [], modelProposals: [],
    audit: [{ at: now, action: 'creazione', detail: 'verifica storico' }],
  };
}
// Campobasso (piazza) e vigneto molisano
const URBAN = { lat: 41.5603, lon: 14.6627, ring: [[14.6622, 41.56], [14.6632, 41.56], [14.6632, 41.5606], [14.6622, 41.5606], [14.6622, 41.56]] };
const AGRI = { lat: 41.8, lon: 14.92, ring: [[14.919, 41.7993], [14.92141, 41.7993], [14.92141, 41.80065], [14.919, 41.80065], [14.919, 41.7993]] };
const COMMON = ['temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'precipitation', 'precipitation_probability', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'shortwave_radiation'];
const AGRI_VARS = ['et0_fao_evapotranspiration', 'vapour_pressure_deficit', 'soil_temperature_0cm', 'soil_temperature_6cm', 'soil_temperature_18cm', 'soil_temperature_54cm', 'soil_moisture_0_to_1cm', 'soil_moisture_1_to_3cm', 'soil_moisture_3_to_9cm', 'soil_moisture_9_to_27cm', 'soil_moisture_27_to_81cm'];

async function setup() {
  if (existsSync(STATE)) throw new Error(`${STATE} esiste: eseguire prima cleanup.`);
  const prefix = `MDT_SEVENDAYS_TEST_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
  const password = randomBytes(18).toString('base64url');
  const s = { prefix, password, users: {}, orgs: {}, projects: {}, locations: {} };
  const save = () => {
    mkdirSync('supabase/.temp', { recursive: true });
    writeFileSync(STATE, JSON.stringify(s, null, 2), { mode: 0o600 });
  };
  save();
  for (const label of ['admin', 'editor', 'viewer', 'esterno']) {
    const email = `${prefix.toLowerCase()}-${label}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `${prefix} ${label}` } });
    if (error) throw new Error(`utente ${label}: ${error.message}`);
    s.users[label] = { id: data.user.id, email };
    save();
  }
  const A = await signIn(s.users.admin.email, password);
  const E = await signIn(s.users.editor.email, password);
  const O = await signIn(s.users.esterno.email, password);
  const a = await A.rpc('create_organization', { p_name: `${prefix} Comune` });
  if (a.error) throw new Error(`organizzazione A: ${a.error.message}`);
  s.orgs.A = { id: a.data, name: `${prefix} Comune` };
  save();
  for (const [u, role] of [['editor', 'editor'], ['viewer', 'viewer']]) {
    const r = await A.rpc('add_member_by_email', { p_org: s.orgs.A.id, p_email: s.users[u].email, p_role: role });
    if (r.error) throw new Error(`membro ${u}: ${r.error.message}`);
  }
  const b = await O.rpc('create_organization', { p_name: `${prefix} Esterna` });
  if (b.error) throw new Error(`organizzazione B: ${b.error.message}`);
  s.orgs.B = { id: b.data, name: `${prefix} Esterna` };
  save();
  for (const [key, sector, geo] of [['urbano', 'urban', URBAN], ['agricolo', 'agriculture', AGRI]]) {
    const p = bundle(`${prefix} ${key}`, sector, geo.ring);
    const r = await E.rpc('save_project', { p_organization_id: s.orgs.A.id, p_bundle: p, p_bundle_hash: 'storico', p_expected_version: 0 });
    if (r.error) throw new Error(`progetto ${key}: ${r.error.message}`);
    s.projects[key] = { id: p.project.id };
    save();
  }
  for (const [key, scope, geo] of [['urbano', 'urban', URBAN], ['agricolo', 'agricultural', AGRI]]) {
    const r = await E.from('weather_locations')
      .insert({ organization_id: s.orgs.A.id, project_id: s.projects[key].id, name: `${prefix} ${key}`, scope, latitude: geo.lat, longitude: geo.lon })
      .select('id, created_at')
      .single();
    if (r.error) throw new Error(`località ${key}: ${r.error.message}`);
    s.locations[key] = { id: r.data.id, scope, created_at: r.data.created_at };
    save();
  }
  console.log(`Creati per ${prefix}: 4 utenti, 2 organizzazioni, 2 progetti, 2 località (recupero iniziale avviato dal server). Stato in ${STATE}.`);
}

async function allRows(table, cols, locationId) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await admin.from(table).select(cols).eq('location_id', locationId).order('id').range(from, from + 999);
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    out.push(...r.data);
    if (r.data.length < 1000) return out;
  }
}

async function verify() {
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  const E = await signIn(s.users.editor.email, s.password);
  const V = await signIn(s.users.viewer.email, s.password);
  const O = await signIn(s.users.esterno.email, s.password);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const out = { prefix: s.prefix, locations: {} };

  for (const key of ['urbano', 'agricolo']) {
    const loc = s.locations[key];
    let st = null;
    await check(`I-${key}`, `Recupero iniziale avviato dal server alla creazione della località (${key})`, async () => {
      for (let i = 0; i < 36; i++) {
        const r = await E.rpc('weather_history_status', { p_location: loc.id });
        if (r.error) throw new Error(r.error.message);
        st = r.data;
        if (st.stato !== 'in_preparazione') break;
        await sleep(5000);
      }
      const { data: runs } = await admin.from('weather_fetch_runs').select('id, trigger, status, requested_at, issued_at').eq('location_id', loc.id).order('requested_at');
      expect(runs.length >= 1 && runs[0].status === 'completata' && runs[0].trigger === 'pianificata', `acquisizioni ${JSON.stringify(runs.map((r) => [r.trigger, r.status]))}`);
      const delay = (Date.parse(runs[0].requested_at) - Date.parse(loc.created_at)) / 1000;
      return `prima acquisizione ${delay.toFixed(0)} s dopo la creazione (trigger del server, senza attendere il job); stato ${st.stato}`;
    });
    await check(`S-${key}`, `Storico di 7 giorni (${key}): ore valide, continuità, lacune`, async () => {
      expect(st && st.livello === 'disponibile' && st.ore_finestra === 168 && st.buchi.length === 0, `livello ${st?.livello}, ore ${st?.ore_finestra}, lacune ${JSON.stringify(st?.buchi)}`);
      out.locations[key] = { status: st };
      return `${st.ore_finestra}/168 ore valide, ${st.ore_continue} continue, ${st.ore_future} future, dal ${st.prima_ora} al ${st.ultima_ora}; variabili obbligatorie mancanti: ${st.variabili_richieste_mancanti.length}`;
    });
    const expected = key === 'agricolo' ? [...COMMON, ...AGRI_VARS] : COMMON;
    const obs = await allRows('weather_observations', 'id, observed_at, variable, unit, source, quality_flag, fetch_run_id', loc.id);
    await check(`V-${key}`, `Variabili salvate nello storico (${key}), ore distinte per variabile`, async () => {
      const per = {};
      for (const o of obs) (per[o.variable] ??= new Set()).add(o.observed_at);
      const missing = expected.filter((v) => !per[v]);
      out.locations[key].variables = Object.fromEntries(Object.entries(per).map(([v, set]) => [v, set.size]));
      expect(expected.filter((v) => !['precipitation_probability'].includes(v)).every((v) => per[v]), `mancano: ${missing.join(', ')}`);
      return `${Object.keys(per).length} variabili; ${Object.entries(per).map(([v, set]) => `${v} ${set.size}`).join(', ')}${missing.length ? `; non disponibili per le ore passate (non stimate): ${missing.join(', ')}` : ''}`;
    });
    await check(`D-${key}`, `Nessun duplicato, fonte Open-Meteo modellata, provenienza su ogni riga (${key})`, async () => {
      const keys = new Set(obs.map((o) => `${o.observed_at}|${o.variable}`));
      expect(keys.size === obs.length, `${obs.length - keys.size} duplicati`);
      expect(obs.every((o) => o.source === 'open_meteo' && o.quality_flag === 'modellato'), 'fonte o qualità inattesa');
      expect(obs.every((o) => o.fetch_run_id), 'righe senza acquisizione');
      const runIds = [...new Set(obs.map((o) => o.fetch_run_id))];
      const { data: runs } = await admin.from('weather_fetch_runs').select('id, response_grid_latitude, response_grid_longitude, response_elevation, model_requested, issued_at, requested_at').in('id', runIds);
      expect(runs.every((r) => r.response_grid_latitude !== null && r.model_requested && r.issued_at), 'acquisizione senza cella o modello');
      return `${obs.length} righe, 0 duplicati, ${runIds.length} acquisizioni di provenienza (cella ${runs[0].response_grid_latitude}/${runs[0].response_grid_longitude}, quota ${runs[0].response_elevation} m, modello ${runs[0].model_requested})`;
    });
    await check(`P-${key}`, `Storico e previsione separati (${key})`, async () => {
      const { data: runs } = await admin.from('weather_fetch_runs').select('id, issued_at').eq('location_id', loc.id).eq('status', 'completata');
      for (const r of runs) {
        const mine = obs.filter((o) => o.fetch_run_id === r.id);
        expect(mine.every((o) => Date.parse(o.observed_at) < Date.parse(r.issued_at)), 'storico dopo l’emissione');
        const { data: pts } = await admin.from('weather_forecast_points').select('valid_at').eq('fetch_run_id', r.id).order('valid_at').limit(1);
        expect(pts.length === 0 || Date.parse(pts[0].valid_at) >= Date.parse(r.issued_at), 'previsione prima dell’emissione');
      }
      return `${runs.length} acquisizioni: storico sempre prima dell’emissione, previsioni dall’emissione in poi`;
    });
  }

  await check('M-incrementale', 'Aggiornamento manuale dell’editor: solo i giorni mancanti, nessun duplicato', async () => {
    const loc = s.locations.urbano;
    const before = (await allRows('weather_observations', 'id', loc.id)).length;
    const r = await E.functions.invoke('open-meteo-ingest', { body: { location_id: loc.id } });
    const status = r.error?.context?.status ?? 200;
    expect(status === 200 && ['completata', 'gia_acquisita'].includes(r.data?.status), `stato ${status} ${JSON.stringify(r.data ?? '').slice(0, 160)}`);
    const after = await allRows('weather_observations', 'observed_at, variable', loc.id);
    expect(new Set(after.map((o) => `${o.observed_at}|${o.variable}`)).size === after.length, 'duplicati dopo l’aggiornamento');
    return `esito ${r.data.status}, past_days ${r.data.past_days ?? 'n.d.'} (prima acquisizione: 8), righe ${before} → ${after.length}`;
  });
  await check('M-limite', 'Secondo aggiornamento manuale ravvicinato: rifiutato (429) o, nella stessa ora già acquisita, nessuna chiamata a Open-Meteo', async () => {
    const { data: manual } = await admin.from('weather_fetch_runs').select('requested_at').eq('location_id', s.locations.urbano.id).eq('trigger', 'manuale').order('requested_at', { ascending: false }).limit(1);
    const r = await E.functions.invoke('open-meteo-ingest', { body: { location_id: s.locations.urbano.id } });
    const status = r.error?.context?.status ?? 200;
    if (manual.length && Date.now() - Date.parse(manual[0].requested_at) < 10 * 60_000) {
      expect(status === 429, `stato ${status}`);
      return 'rifiutato con 429 (limite di 10 minuti)';
    }
    // nessuna acquisizione manuale eseguita: la richiesta precedente era già coperta dall'acquisizione di quest'ora
    expect(status === 200 && r.data?.status === 'gia_acquisita', `stato ${status} ${r.data?.status}`);
    return 'ora già acquisita: nessuna nuova acquisizione e nessuna chiamata a Open-Meteo, limite non necessario';
  });
  await check('A-lettura', 'Ruolo lettura: legge lo stato, non avvia acquisizioni (403)', async () => {
    const st = await V.rpc('weather_history_status', { p_location: s.locations.agricolo.id });
    expect(!st.error && st.data.livello, `stato: ${st.error?.message}`);
    const r = await V.functions.invoke('open-meteo-ingest', { body: { location_id: s.locations.agricolo.id } });
    expect(r.error?.context?.status === 403, `stato ${r.error?.context?.status ?? 200}`);
  });
  await check('A-esterno', 'Organizzazione esterna: non vede lo stato, lo storico né la località (404)', async () => {
    const st = await O.rpc('weather_history_status', { p_location: s.locations.urbano.id });
    expect(st.error, 'stato visibile all’esterno');
    const o = await O.from('weather_observations').select('id').eq('location_id', s.locations.urbano.id).limit(1);
    expect(!o.error && o.data.length === 0, 'storico visibile all’esterno');
    const r = await O.functions.invoke('open-meteo-ingest', { body: { location_id: s.locations.urbano.id } });
    expect(r.error?.context?.status === 404, `stato ${r.error?.context?.status ?? 200}`);
  });
  await check('A-anonimo', 'Anonimo: nessun accesso a stato e storico', async () => {
    const st = await anon.rpc('weather_history_status', { p_location: s.locations.urbano.id });
    expect(st.error, 'stato visibile all’anonimo');
    const o = await anon.from('weather_observations').select('id').limit(1);
    expect(o.error || o.data.length === 0, 'storico visibile all’anonimo');
  });

  mkdirSync('supabase/.temp', { recursive: true });
  writeFileSync('supabase/.temp/history-results.json', JSON.stringify({ results, out }, null, 2));
  const ko = results.filter((r) => r.status === 'ko').length;
  console.log(`\n${results.length - ko} superati, ${ko} falliti. Dettagli in supabase/.temp/history-results.json`);
  process.exitCode = ko ? 1 : 0;
}

async function cleanup(extraPrefixes) {
  const s = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null;
  const prefixes = [...(s ? [s.prefix] : []), ...extraPrefixes];
  expect(prefixes.length > 0, 'nessun prefisso da pulire');
  for (const p of prefixes) expect(/^MDT_[A-Z_]+_TEST_\d{14}$/.test(p), `prefisso non di prova: ${p}`);
  // elenco preciso: solo organizzazioni e utenti con i prefissi di prova
  const { data: orgs } = await admin.from('organizations').select('id, name');
  const testOrgs = orgs.filter((o) => prefixes.some((p) => o.name.startsWith(`${p} `)));
  const users = [];
  for (let page = 1; ; page++) {
    const r = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (r.error) throw new Error(r.error.message);
    users.push(...r.data.users);
    if (r.data.users.length < 200) break;
  }
  const testUsers = users.filter((u) => prefixes.some((p) => (u.email ?? '').startsWith(`${p.toLowerCase()}-`) && u.email.endsWith('@example.test')));
  const otherOrgs = orgs.length - testOrgs.length;
  const otherUsers = users.length - testUsers.length;
  console.log(`Da eliminare: ${testOrgs.length} organizzazioni, ${testUsers.length} utenti di prova. Altri presenti: ${otherOrgs} organizzazioni, ${otherUsers} utenti.`);
  const errors = [];
  for (const o of testOrgs) {
    const r = await admin.rpc('delete_organization', { p_org: o.id, p_confirm_name: o.name });
    if (r.error) errors.push(`organizzazione ${o.id}: ${r.error.message}`);
  }
  for (const u of testUsers) {
    const r = await admin.auth.admin.deleteUser(u.id);
    if (r.error) errors.push(`utente ${u.id}: ${r.error.message}`);
  }
  // rilettura dal database
  const left = {};
  for (const t of ['organizations', 'memberships', 'projects', 'project_documents', 'weather_locations', 'weather_fetch_runs', 'weather_forecast_points', 'weather_observations', 'forecast_runs', 'users']) {
    const r = await admin.from(t).select('*', { count: 'exact', head: true });
    left[t] = r.error ? `errore: ${r.error.message}` : r.count;
  }
  const remainingUsers = [];
  for (let page = 1; ; page++) {
    const r = await admin.auth.admin.listUsers({ page, perPage: 200 });
    remainingUsers.push(...r.data.users);
    if (r.data.users.length < 200) break;
  }
  left.auth_users = remainingUsers.length;
  console.log(JSON.stringify({ errori: errors, conteggi: left }, null, 2));
  if (s && !errors.length) rmSync(STATE);
  process.exitCode = errors.length ? 1 : 0;
}

if (cmd === 'setup') await setup();
else if (cmd === 'verify') await verify();
else if (cmd === 'cleanup') await cleanup(process.argv.slice(3));
else throw new Error('Uso: setup | verify | cleanup [prefissi]');
