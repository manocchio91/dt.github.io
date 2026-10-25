#!/usr/bin/env node
/**
 * Runtime Open-Meteo → Supabase su un progetto REALE di TEST (mai produzione).
 *
 * Crea dati temporanei con prefisso MDT_RUNTIME_TEST_<timestamp> tramite le procedure normali
 * (Auth Admin per gli utenti di prova, create_organization, add_member_by_email, save_project,
 * inserimento delle località con RLS), esegue acquisizioni reali tramite la Edge Function
 * open-meteo-ingest e verifica dati, idempotenza, limiti e permessi. Nessun trigger o RLS viene
 * disattivato. Il report non contiene credenziali né il riferimento del progetto.
 *
 * Uso (variabili da .env.supabase-test, escluso da Git; segreto del job da un file escluso da Git):
 *   node scripts/supabase-real/open-meteo-runtime.mjs setup
 *   node scripts/supabase-real/open-meteo-runtime.mjs verify  <file-con-OPEN_METEO_CRON_SECRET>
 *   node scripts/supabase-real/open-meteo-runtime.mjs cleanup
 * Lo stato (id, email, password casuale di prova) resta in supabase/.temp/runtime-state.json
 * fino alla pulizia, che lo elimina.
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
const STATE = 'supabase/.temp/runtime-state.json';
const FN = `${URL_}/functions/v1/open-meteo-ingest`;
const cmd = process.argv[2];

const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const results = [];
function record(id, title, status, evidence = '') {
  results.push({ id, title, status, evidence });
  console.log(`${status === 'ok' ? '✔' : status === 'ko' ? '✖' : '·'} ${id} ${title}${evidence ? ` — ${evidence}` : ''}`);
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
  if (error) throw new Error(`login ${email.split('@')[0]}: ${error.message}`);
  return client;
}

/** Progetto minimo con area valida (stesso formato dell'app). */
function bundle(name, sector, ring) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    project: { id, name, sector, mode: 'demo', isDemoSeed: false, description: 'Dati temporanei di verifica del runtime Open-Meteo', createdAt: now },
    area: { id: `${id}-area`, name: 'Area di prova', geometry: { type: 'Polygon', coordinates: [ring] }, crs: 'EPSG:4326', areaM2: 5000, source: 'seed', isDemonstrativeGeometry: true, createdAt: now },
    baselines: [],
    scenarios: [],
    runs: [],
    agri: sector === 'agriculture' ? { setup: {}, zones: [], observations: [], weather: null, weatherNote: '', today: now.slice(0, 10) } : undefined,
    decisions: [],
    verificationPlans: [],
    measurements: [],
    modelProposals: [],
    audit: [{ at: now, action: 'creazione', detail: 'verifica runtime' }],
  };
}

const URBAN = { lat: 41.5603, lon: 14.6627, ring: [[14.6622, 41.56], [14.6632, 41.56], [14.6632, 41.5606], [14.6622, 41.5606], [14.6622, 41.56]] };
const AGRI = { lat: 41.8, lon: 14.92, ring: [[14.919, 41.7993], [14.92141, 41.7993], [14.92141, 41.80065], [14.919, 41.80065], [14.919, 41.7993]] };

// ------------------------------------------------------------------ setup
async function setup() {
  if (existsSync(STATE)) throw new Error(`${STATE} esiste: eseguire prima cleanup.`);
  const prefix = `MDT_RUNTIME_TEST_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
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
    const r = await E.rpc('save_project', { p_organization_id: s.orgs.A.id, p_bundle: p, p_bundle_hash: 'runtime', p_expected_version: 0 });
    if (r.error) throw new Error(`progetto ${key}: ${r.error.message}`);
    s.projects[key] = { id: p.project.id };
    save();
  }
  const locs = [
    ['urbano', 'urbano', 'urban', URBAN, true],
    ['agricolo', 'agricolo', 'agricultural', AGRI, true],
    ['inattiva', 'urbano', 'urban', { lat: 41.561, lon: 14.663 }, false],
  ];
  for (const [key, proj, scope, geo, active] of locs) {
    const r = await E.from('weather_locations')
      .insert({ organization_id: s.orgs.A.id, project_id: s.projects[proj].id, name: `${prefix} ${key}`, scope, latitude: geo.lat, longitude: geo.lon, active })
      .select('id')
      .single();
    if (r.error) throw new Error(`località ${key}: ${r.error.message}`);
    s.locations[key] = { id: r.data.id, scope, active };
    save();
  }
  console.log(`Creati per ${prefix}: 4 utenti, 2 organizzazioni, 2 progetti, 3 località (1 inattiva). Stato in ${STATE} (password non mostrata).`);
}

// ------------------------------------------------------------------ verify
const UNITS = {
  temperature_2m: '°C', apparent_temperature: '°C', relative_humidity_2m: '%', precipitation: 'mm', precipitation_probability: '%',
  wind_speed_10m: 'm/s', wind_gusts_10m: 'm/s', wind_direction_10m: '°', shortwave_radiation: 'W/m²',
  et0_fao_evapotranspiration: 'mm', vapour_pressure_deficit: 'kPa', soil_temperature_0cm: '°C', soil_moisture_0_to_1cm: 'm³/m³',
};
const COMMON = ['temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'precipitation', 'precipitation_probability', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'shortwave_radiation'];
const AGRI_VARS = ['et0_fao_evapotranspiration', 'vapour_pressure_deficit', 'soil_temperature_0cm', 'soil_temperature_6cm', 'soil_temperature_18cm', 'soil_temperature_54cm', 'soil_moisture_0_to_1cm', 'soil_moisture_1_to_3cm', 'soil_moisture_3_to_9cm', 'soil_moisture_9_to_27cm', 'soil_moisture_27_to_81cm'];
const RANGE = {
  temperature_2m: [-40, 50], apparent_temperature: [-50, 60], relative_humidity_2m: [0, 100], precipitation: [0, 100], precipitation_probability: [0, 100],
  wind_speed_10m: [0, 60], wind_gusts_10m: [0, 80], wind_direction_10m: [0, 360], shortwave_radiation: [0, 1400],
  et0_fao_evapotranspiration: [0, 2], vapour_pressure_deficit: [0, 10], soil_temperature_0cm: [-30, 70], soil_temperature_6cm: [-30, 60], soil_temperature_18cm: [-20, 50], soil_temperature_54cm: [-10, 40],
  soil_moisture_0_to_1cm: [0, 0.8], soil_moisture_1_to_3cm: [0, 0.8], soil_moisture_3_to_9cm: [0, 0.8], soil_moisture_9_to_27cm: [0, 0.8], soil_moisture_27_to_81cm: [0, 0.8],
};

async function counts(locationId) {
  const p = await admin.from('weather_forecast_points').select('id', { count: 'exact', head: true }).eq('location_id', locationId);
  const r = await admin.from('weather_fetch_runs').select('id', { count: 'exact', head: true }).eq('location_id', locationId);
  return { points: p.count, runs: r.count };
}
const invoke = async (client, body) => {
  const r = await client.functions.invoke('open-meteo-ingest', { body });
  return { status: r.error?.context?.status ?? (r.error ? 0 : 200), data: r.data, error: r.error };
};
const cronPost = async (secret, body) => {
  const r = await fetch(FN, { method: 'POST', headers: { 'content-type': 'application/json', 'x-cron-secret': secret }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
};

async function verifyAll(secretFile) {
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  const secret = readEnv(secretFile).OPEN_METEO_CRON_SECRET;
  expect(secret, 'segreto del job mancante');
  const E = await signIn(s.users.editor.email, s.password);
  const V = await signIn(s.users.viewer.email, s.password);
  const A = await signIn(s.users.admin.email, s.password);
  const O = await signIn(s.users.esterno.email, s.password);
  const runs = {};

  for (const key of ['urbano', 'agricolo']) {
    await check(`R-${key}`, `Acquisizione manuale reale (${key}) dall’editor via Edge Function`, async () => {
      const r = await invoke(E, { location_id: s.locations[key].id });
      expect(r.status === 200 && r.data?.status === 'completata', `stato ${r.status} ${JSON.stringify(r.data ?? r.error?.message).slice(0, 200)}`);
      runs[key] = r.data;
      return `${r.data.points} ore, ${r.data.observations} osservazioni, emissione ${r.data.issued_at}, cella ${r.data.grid.latitude}/${r.data.grid.longitude} quota ${r.data.grid.elevation} m${r.data.warnings.length ? `, avvisi: ${r.data.warnings.join('; ')}` : ''}`;
    });
  }

  for (const key of ['urbano', 'agricolo']) {
    if (!runs[key]) continue;
    const loc = s.locations[key];
    const vars = key === 'agricolo' ? [...COMMON, ...AGRI_VARS] : COMMON;
    const { data: run } = await admin.from('weather_fetch_runs').select('*').eq('id', runs[key].run_id).single();
    const { data: pts } = await admin.from('weather_forecast_points').select('*').eq('fetch_run_id', run.id).order('valid_at');

    await check(`D-${key}-run`, `Acquisizione registrata (${key}): stato, emissione, validità, cella, quota, fonte`, async () => {
      expect(run.status === 'completata' && run.provider === 'open_meteo' && run.trigger === 'manuale', `run ${run.status}/${run.provider}/${run.trigger}`);
      const issued = new Date(run.issued_at);
      expect(issued.getUTCMinutes() === 0 && issued.getUTCSeconds() === 0, 'issued_at non arrotondato all’ora');
      expect(Math.abs(Date.now() - issued.getTime()) < 2 * 3600e3, 'issued_at lontano da adesso');
      expect(new Date(run.valid_from) >= issued && new Date(run.valid_to) > new Date(run.valid_from), 'intervallo di validità incoerente');
      const { data: l } = await admin.from('weather_locations').select('latitude, longitude').eq('id', loc.id).single();
      expect(Math.abs(run.response_grid_latitude - l.latitude) < 0.2 && Math.abs(run.response_grid_longitude - l.longitude) < 0.2, 'cella lontana dal punto richiesto');
      expect(typeof run.response_elevation === 'number', 'quota assente');
      expect(run.request_hash.length === 64 && run.points_count === pts.length, 'hash o conteggio incoerenti');
      return `${pts.length} ore da ${run.valid_from} a ${run.valid_to}; richiesta ${l.latitude}/${l.longitude} → cella ${run.response_grid_latitude}/${run.response_grid_longitude}, quota ${run.response_elevation} m; modello richiesto ${run.model_requested}, restituito ${run.model_returned ?? 'non dichiarato da Open-Meteo'}`;
    });

    await check(`D-${key}-orari`, `Ore future consecutive, issued_at fisso, fonte open_meteo (${key})`, async () => {
      expect(pts.length >= 72, `solo ${pts.length} ore`);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        expect(p.source === 'open_meteo' && p.issued_at === pts[0].issued_at, 'fonte o emissione incoerenti');
        expect(new Date(p.valid_at) >= new Date(p.issued_at), 'valid_at precedente all’emissione');
        if (i) expect(new Date(p.valid_at) - new Date(pts[i - 1].valid_at) === 3600e3, `ore non consecutive a ${p.valid_at}`);
      }
      return `${pts.length} ore consecutive, issued_at ${pts[0].issued_at}`;
    });

    await check(`D-${key}-variabili`, `Variabili presenti e plausibili (${key})`, async () => {
      const out = [];
      for (const v of vars) {
        const vals = pts.map((p) => p[v]).filter((x) => x !== null && x !== undefined);
        const [lo, hi] = RANGE[v];
        const bad = vals.filter((x) => x < lo || x > hi);
        expect(bad.length === 0, `${v}: ${bad.length} valori fuori da [${lo}, ${hi}]`);
        if (COMMON.includes(v)) expect(vals.length >= pts.length * 0.9, `${v}: solo ${vals.length}/${pts.length} valori`);
        out.push(`${v} ${vals.length ? `${Math.min(...vals).toFixed(2)}…${Math.max(...vals).toFixed(2)}` : 'non disponibile'} (${vals.length}/${pts.length})`);
      }
      if (key === 'agricolo') {
        for (const v of ['et0_fao_evapotranspiration', 'vapour_pressure_deficit', 'soil_temperature_0cm', 'soil_moisture_0_to_1cm']) {
          expect(pts.some((p) => p[v] !== null), `${v} assente`);
        }
      } else {
        expect(pts.every((p) => AGRI_VARS.every((v) => p[v] === null)), 'variabili agricole registrate per l’urbano');
      }
      return out.join('; ');
    });

    await check(`D-${key}-unita`, `Unità registrate (${key})`, async () => {
      const u = pts[0].unit_metadata;
      const wrong = Object.entries(UNITS).filter(([k]) => vars.includes(k) && u[k] !== undefined).filter(([k, v]) => u[k] !== v);
      expect(wrong.length === 0, `unità inattese: ${JSON.stringify(wrong)}`);
      expect(COMMON.every((k) => u[k]), 'unità mancanti');
      return Object.entries(u).filter(([k]) => vars.includes(k)).map(([k, v]) => `${k}=${v}`).join(', ');
    });

    await check(`D-${key}-osservazioni`, `Ore passate registrate come analisi modellata (${key})`, async () => {
      const { data: obs } = await admin.from('weather_observations').select('source, quality_flag, observed_at').eq('location_id', loc.id);
      expect(obs.length > 0 && obs.every((o) => o.source === 'open_meteo' && o.quality_flag === 'modellato'), 'osservazioni assenti o non marcate come modellate');
      return `${obs.length} valori, fonte open_meteo, flag “modellato”`;
    });
  }

  await check('I1', 'Idempotenza: stessa ora rieseguita dal job → già acquisita, nessun duplicato', async () => {
    const out = [];
    for (const key of ['urbano', 'agricolo']) {
      const before = await counts(s.locations[key].id);
      const r = await cronPost(secret, { location_id: s.locations[key].id });
      const after = await counts(s.locations[key].id);
      expect(r.status === 200 && r.data.status === 'gia_acquisita', `${key}: stato ${r.status} ${r.data.status}`);
      expect(before.points === after.points && before.runs === after.runs, `${key}: righe cambiate`);
      out.push(`${key} ${after.points} punti, ${after.runs} acquisizione`);
    }
    const dup = await admin.rpc('weather_active_locations');
    expect(!dup.error, dup.error?.message);
    return out.join('; ');
  });

  await check('I2', 'Job pianificato su tutte le località attive: la località inattiva è esclusa', async () => {
    const r = await cronPost(secret, { all_active: true });
    expect(r.status === 200, `stato ${r.status}`);
    const ours = r.data.results.filter((x) => Object.values(s.locations).some((l) => l.id === x.location_id));
    expect(!ours.some((x) => x.location_id === s.locations.inattiva.id), 'località inattiva acquisita');
    expect(ours.length === 2 && ours.every((x) => x.status === 'gia_acquisita'), `esiti ${JSON.stringify(ours.map((x) => x.status))}`);
    const inactive = await counts(s.locations.inattiva.id);
    expect(inactive.runs === 0, 'acquisizioni registrate per la località inattiva');
    return `${r.data.results.length} località attive, entrambe già acquisite; inattiva: 0 acquisizioni`;
  });

  await check('I3', 'Località inattiva richiesta esplicitamente → 409, nessuna acquisizione', async () => {
    const r = await cronPost(secret, { location_id: s.locations.inattiva.id });
    expect(r.status === 409, `stato ${r.status}`);
    return r.data.error;
  });

  await check('L1', 'Limite manuale: secondo aggiornamento dell’editor entro 10 minuti → 429', async () => {
    const r = await invoke(E, { location_id: s.locations.urbano.id });
    expect(r.status === 429, `stato ${r.status}`);
    return '429';
  });

  await check('P1', 'Ruoli: il lettore non può chiedere un aggiornamento (403)', async () => {
    const r = await invoke(V, { location_id: s.locations.agricolo.id });
    expect(r.status === 403, `stato ${r.status}`);
    return '403';
  });

  await check('P2', 'Isolamento: un’altra organizzazione non vede né aggiorna (404, 0 righe)', async () => {
    const r = await invoke(O, { location_id: s.locations.urbano.id });
    expect(r.status === 404, `aggiornamento: stato ${r.status}`);
    for (const t of ['weather_locations', 'weather_fetch_runs', 'weather_forecast_points', 'weather_observations']) {
      const q = await O.from(t).select('*', { count: 'exact', head: true }).eq('organization_id', s.orgs.A.id);
      expect((q.count ?? 0) === 0, `${t} visibile all’esterno`);
    }
    const v = await V.from('weather_forecast_points').select('id', { count: 'exact', head: true }).eq('location_id', s.locations.urbano.id);
    expect(v.count > 0, 'il lettore non vede le previsioni');
    return `esterno: 404 e 0 righe in 4 tabelle; lettore: ${v.count} righe`;
  });

  await check('P3', 'Nessun client registra dati con fonte Open-Meteo', async () => {
    const loc = s.locations.urbano.id;
    const o = await A.from('weather_observations').insert({ organization_id: s.orgs.A.id, location_id: loc, observed_at: new Date().toISOString(), variable: 'temperature_2m', value: 20, unit: '°C', source: 'open_meteo' });
    const p = await A.from('weather_forecast_points').insert({ organization_id: s.orgs.A.id, fetch_run_id: runs.urbano?.run_id, location_id: loc, issued_at: new Date().toISOString(), valid_at: new Date().toISOString(), model: 'x', unit_metadata: {} });
    const f = await A.from('weather_fetch_runs').insert({ organization_id: s.orgs.A.id, location_id: loc, trigger: 'manuale', model_requested: 'best_match', request_hash: 'a'.repeat(64) });
    const b = await E.rpc('weather_begin_fetch', { p_location: loc, p_request_hash: 'b'.repeat(64), p_trigger: 'manuale', p_model: 'best_match' });
    expect(o.error && p.error && f.error && b.error, 'una scrittura come Open-Meteo è stata accettata');
    return 'osservazione, previsione, acquisizione e funzione di servizio rifiutate';
  });

  await check('P4', 'Previsioni registrate immutabili (anche per il ruolo di servizio)', async () => {
    const { data: one } = await admin.from('weather_forecast_points').select('id, temperature_2m').eq('location_id', s.locations.urbano.id).limit(1).single();
    const u = await admin.from('weather_forecast_points').update({ temperature_2m: 99 }).eq('id', one.id);
    const { data: again } = await admin.from('weather_forecast_points').select('temperature_2m').eq('id', one.id).single();
    expect(!!u.error && again.temperature_2m === one.temperature_2m, 'previsione sovrascritta');
    return u.error.message;
  });

  await check('E1', 'Errore simulato: un tentativo fallito non tocca i dati validi', async () => {
    const loc = s.locations.urbano.id;
    const before = await counts(loc);
    const b = await admin.rpc('weather_begin_fetch', { p_location: loc, p_request_hash: 'e'.repeat(64), p_trigger: 'pianificata', p_model: 'best_match' });
    expect(!b.error && b.data.duplicate === false, b.error?.message ?? 'inizio non registrato');
    const f = await admin.rpc('weather_fail_fetch', { p_run: b.data.run.id, p_code: 'SIMULATO', p_message: 'errore simulato dalla verifica del runtime' });
    expect(!f.error, f.error?.message);
    const after = await counts(loc);
    const { data: failed } = await admin.from('weather_fetch_runs').select('status, error_code').eq('id', b.data.run.id).single();
    const { data: valid } = await admin.from('weather_fetch_runs').select('status').eq('id', runs.urbano.run_id).single();
    expect(failed.status === 'errore' && failed.error_code === 'SIMULATO', 'errore non registrato');
    expect(after.points === before.points && valid.status === 'completata', 'dati validi modificati');
    return `acquisizione fallita registrata (SIMULATO); ${after.points} previsioni intatte, ultima acquisizione valida ancora “completata”`;
  });

  await check('T1', 'Nessuna previsione Timestral creata', async () => {
    const r = await admin.from('forecast_runs').select('id', { count: 'exact', head: true });
    expect(!r.error && r.count === 0, r.error?.message ?? `${r.count} previsioni`);
    return '0 righe in forecast_runs';
  });

  report(s);
}

function report(s) {
  const ok = results.filter((r) => r.status === 'ok').length;
  const ko = results.filter((r) => r.status === 'ko').length;
  const day = new Date().toISOString().slice(0, 10);
  const host = new URL(URL_).host.replace(/^[^.]+/, '****');
  mkdirSync('docs/reports', { recursive: true });
  const file = `docs/reports/open-meteo-runtime-${day}.md`;
  writeFileSync(
    file,
    [
      `# Runtime Open-Meteo → Supabase — verifica reale ${day}`,
      '',
      `- Ambiente: progetto di TEST su \`${host}\` (riferimento oscurato); Edge Function \`open-meteo-ingest\`; Open-Meteo Forecast API reale`,
      `- Dati temporanei: prefisso \`${s.prefix}\` (eliminati a fine verifica con \`cleanup\`)`,
      `- Esito: ${ok} superati, ${ko} falliti`,
      '',
      '| ID | Controllo | Esito | Evidenza |',
      '|---|---|---|---|',
      ...results.map((r) => `| ${r.id} | ${r.title} | ${r.status === 'ok' ? '✔' : '✖'} | ${String(r.evidence).replace(/\|/g, '/')} |`),
      '',
      'Nessuna credenziale è riportata in questo file.',
      '',
    ].join('\n'),
  );
  console.log(`\n${ok}/${results.length} controlli superati. Report: ${file}`);
  process.exitCode = ko ? 1 : 0;
}

// ------------------------------------------------------------------ cleanup
async function cleanup() {
  if (!existsSync(STATE)) throw new Error(`${STATE} assente: niente da pulire.`);
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  console.log(`Pulizia ${s.prefix}:`);
  console.log(`  organizzazioni ${Object.values(s.orgs).map((o) => o.id).join(', ')}`);
  console.log(`  progetti       ${Object.values(s.projects).map((p) => p.id).join(', ')}`);
  console.log(`  località       ${Object.values(s.locations).map((l) => l.id).join(', ')}`);
  console.log(`  utenti         ${Object.values(s.users).map((u) => u.id).join(', ')}`);
  const errors = [];
  for (const [key, o] of Object.entries(s.orgs)) {
    const ownerLabel = key === 'A' ? 'admin' : 'esterno';
    const client = await signIn(s.users[ownerLabel].email, s.password);
    const r = await client.rpc('delete_organization', { p_org: o.id, p_confirm_name: o.name });
    if (r.error) errors.push(`organizzazione ${key}: ${r.error.message}`);
  }
  for (const [label, u] of Object.entries(s.users)) {
    const r = await admin.auth.admin.deleteUser(u.id);
    if (r.error) errors.push(`utente ${label}: ${r.error.message}`);
  }
  // rilettura: la pulizia è riuscita solo se non resta nulla
  const orgIds = Object.values(s.orgs).map((o) => o.id);
  const left = {
    auth_users: (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.filter((u) => u.email?.startsWith(s.prefix.toLowerCase())).length,
  };
  for (const [t, col, ids] of [
    ['users', 'id', Object.values(s.users).map((u) => u.id)],
    ['organizations', 'id', orgIds],
    ['memberships', 'organization_id', orgIds],
    ['projects', 'id', Object.values(s.projects).map((p) => p.id)],
    ['project_documents', 'project_id', Object.values(s.projects).map((p) => p.id)],
    ['weather_locations', 'id', Object.values(s.locations).map((l) => l.id)],
    ['weather_fetch_runs', 'organization_id', orgIds],
    ['weather_forecast_points', 'organization_id', orgIds],
    ['weather_observations', 'organization_id', orgIds],
    ['media_assets', 'organization_id', orgIds],
  ]) {
    const q = await admin.from(t).select('*', { count: 'exact', head: true }).in(col, ids);
    if (q.error) errors.push(`${t}: ${q.error.message}`);
    left[t] = q.count ?? -1;
  }
  const byName = await admin.from('organizations').select('id', { count: 'exact', head: true }).like('name', `${s.prefix}%`);
  left.organizations_per_nome = byName.count ?? -1;
  const storage = await admin.storage.from('project-media').list(s.orgs.A.id);
  left.storage_files = storage.data?.length ?? 0;
  const residual = Object.entries(left).filter(([, n]) => n !== 0);
  console.log(`  rilettura: ${JSON.stringify(left)}`);
  if (errors.length || residual.length) {
    console.log(`PULIZIA NON RIUSCITA: ${[...errors, ...residual.map(([t, n]) => `${t}=${n}`)].join('; ')}`);
    process.exitCode = 1;
    return;
  }
  rmSync(STATE);
  console.log('Pulizia riuscita: ogni conteggio riletto è 0; stato locale eliminato.');
}

if (cmd === 'setup') await setup();
else if (cmd === 'verify') await verifyAll(process.argv[3]);
else if (cmd === 'cleanup') await cleanup();
else {
  console.error('Uso: open-meteo-runtime.mjs setup | verify <file-segreto> | cleanup');
  process.exitCode = 2;
}
