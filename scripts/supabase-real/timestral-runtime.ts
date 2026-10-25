/**
 * Timestral reale (container locale) + Supabase di TEST + Open-Meteo reale.
 *
 * Dati temporanei con prefisso MDT_TIMESTRAL_TEST_<timestamp>, creati con le procedure normali
 * (Auth Admin per gli utenti di prova, create_organization, add_member_by_email, save_project,
 * località con RLS, acquisizione tramite la Edge Function open-meteo-ingest).
 * Le previsioni passano dalla logica del proxy (supabase/functions/_shared/forecastProxy.ts), eseguita
 * qui nell'ambiente di test locale: il container NON è esposto in rete.
 *
 * Uso (variabili da .env.supabase-test e supabase/.temp/forecast.env, esclusi da Git):
 *   npx vite-node scripts/supabase-real/timestral-runtime.ts setup | run | cleanup
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { coverage, hashOf, mae, NaivePersistenceAdapter, SeasonalNaiveAdapter, seedCampobasso, seedVineyard, VARIABLE_UNITS, wql, type ForecastRequest } from '../../packages/domain/src/index';
import { buildIngestUrl, fetchForecastJson, parseForecastResponse, type HourlyVariable } from '../../packages/domain/src/connectors/openMeteoForecast';
import { boundsFor, PROXY_MODELS, proxyForecast, type ProxyClient, type ProxyRequest, type ServiceResponse } from '../../supabase/functions/_shared/forecastProxy';

const readEnv = (f: string) =>
  Object.fromEntries(
    readFileSync(f, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
  );
const env = readEnv('.env.supabase-test');
if (env.MDT_CONFIRM_TEST_PROJECT !== 'yes') throw new Error('Il progetto deve essere confermato come TEST.');
const fenv = readEnv('supabase/.temp/forecast.env');
const SERVICE_URL = process.env.FORECAST_SERVICE_URL ?? 'http://127.0.0.1:8080';
const SERVICE_TOKEN = fenv.FORECAST_SERVICE_TOKEN!;
const M5 = 'mistralai/Timestral-5M';
const STATE = 'supabase/.temp/timestral-state.json';
const admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

interface State {
  prefix: string;
  password: string;
  users: Record<'admin' | 'lettore' | 'esterno', { id: string; email: string }>;
  orgs: Record<'A' | 'B', { id: string; name: string }>;
  projects: Record<'urbano' | 'agricolo', string>;
  locations: Record<'urbano' | 'agricolo', string>;
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login ${email.split('@')[0]}: ${error.message}`);
  return c;
}

/** Variabili inviate al modello (≤ 8, contratto del servizio): solo grandezze orarie fisicamente continue o cumulate. */
const VARIABLES: Record<'urbano' | 'agricolo', HourlyVariable[]> = {
  urbano: ['temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'precipitation', 'wind_speed_10m', 'shortwave_radiation'],
  agricolo: ['temperature_2m', 'relative_humidity_2m', 'precipitation', 'wind_speed_10m', 'et0_fao_evapotranspiration', 'vapour_pressure_deficit', 'soil_temperature_6cm', 'soil_moisture_9_to_27cm'],
};
const RANGE: Partial<Record<HourlyVariable, [number, number]>> = {
  temperature_2m: [-40, 50], apparent_temperature: [-50, 60], relative_humidity_2m: [0, 100], precipitation: [0, 100], wind_speed_10m: [0, 60],
  shortwave_radiation: [0, 1400], et0_fao_evapotranspiration: [0, 2], vapour_pressure_deficit: [0, 10], soil_temperature_6cm: [-30, 60], soil_moisture_9_to_27cm: [0, 0.8],
};
/** Nomi interni accettati dalle baseline del dominio (VARIABLE_UNITS). */
const DOMAIN_NAME: Partial<Record<HourlyVariable, string>> = { temperature_2m: 'temperatura_aria', relative_humidity_2m: 'umidita_relativa', precipitation: 'precipitazione', wind_speed_10m: 'vento', shortwave_radiation: 'radiazione', soil_temperature_6cm: 'temperatura_suolo', soil_moisture_9_to_27cm: 'umidita_suolo' };
const LOC = { urbano: { lat: 41.5603, lon: 14.6627, scope: 'urban' as const }, agricolo: { lat: 41.8, lon: 14.92, scope: 'agricultural' as const } };

// ------------------------------------------------------------------ setup
async function setup() {
  if (existsSync(STATE)) throw new Error('Stato esistente: eseguire cleanup.');
  const prefix = `MDT_TIMESTRAL_TEST_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
  const s = { prefix, password: randomBytes(15).toString('base64url'), users: {}, orgs: {}, projects: {}, locations: {} } as State;
  const save = () => {
    mkdirSync('supabase/.temp', { recursive: true });
    writeFileSync(STATE, JSON.stringify(s, null, 1), { mode: 0o600 });
  };
  save();
  for (const label of ['admin', 'lettore', 'esterno'] as const) {
    const email = `${prefix.toLowerCase()}-${label}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: s.password, email_confirm: true, user_metadata: { display_name: `${prefix} ${label}` } });
    if (error) throw new Error(`utente ${label}: ${error.message}`);
    s.users[label] = { id: data.user.id, email };
    save();
  }
  const A = await signIn(s.users.admin.email, s.password);
  const a = await A.rpc('create_organization', { p_name: `${prefix} Comune` });
  if (a.error) throw new Error(a.error.message);
  s.orgs.A = { id: a.data as string, name: `${prefix} Comune` };
  save();
  const m = await A.rpc('add_member_by_email', { p_org: s.orgs.A.id, p_email: s.users.lettore.email, p_role: 'viewer' });
  if (m.error) throw new Error(m.error.message);
  const O = await signIn(s.users.esterno.email, s.password);
  const b = await O.rpc('create_organization', { p_name: `${prefix} Esterna` });
  if (b.error) throw new Error(b.error.message);
  s.orgs.B = { id: b.data as string, name: `${prefix} Esterna` };
  save();
  const now = new Date();
  for (const [key, bundle] of [['urbano', seedCampobasso(now)], ['agricolo', seedVineyard(now, now.toISOString().slice(0, 10))]] as const) {
    bundle.project.name = `${prefix} ${key}`;
    bundle.project.isDemoSeed = false;
    const r = await A.rpc('save_project', { p_organization_id: s.orgs.A.id, p_bundle: bundle, p_bundle_hash: hashOf(bundle), p_expected_version: 0 });
    if (r.error) throw new Error(`progetto ${key}: ${r.error.message}`);
    s.projects[key] = bundle.project.id;
    save();
    const l = LOC[key];
    const ins = await A.from('weather_locations').insert({ organization_id: s.orgs.A.id, project_id: bundle.project.id, name: `${prefix} ${key}`, scope: l.scope, latitude: l.lat, longitude: l.lon }).select('id').single();
    if (ins.error) throw new Error(`località ${key}: ${ins.error.message}`);
    s.locations[key] = ins.data.id;
    save();
    const inv = await A.functions.invoke('open-meteo-ingest', { body: { location_id: ins.data.id } });
    if (inv.error) throw new Error(`acquisizione ${key}: ${inv.error.message}`);
    console.log(`${key}: acquisizione Open-Meteo ${(inv.data as { status: string; points: number }).status}, ${(inv.data as { points: number }).points} ore`);
  }
  console.log(`Creati per ${prefix}: 3 utenti, 2 organizzazioni, 2 progetti, 2 località. Password non mostrata.`);
}

// ------------------------------------------------------------------ run
const results: { id: string; title: string; ok: boolean; evidence: string }[] = [];
const record = (id: string, title: string, ok: boolean, evidence: string) => {
  results.push({ id, title, ok, evidence });
  console.log(`${ok ? '✔' : '✖'} ${id} ${title} — ${evidence}`);
};
const fmt = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '—');

async function callService(context: (number | null)[][], H: number, bounds: ([number, number] | null)[] = []): Promise<ServiceResponse> {
  const r = await fetch(`${SERVICE_URL}/v1/forecast`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SERVICE_TOKEN}` },
    body: JSON.stringify({ schema_version: 1, model: M5, revision: PROXY_MODELS[M5], frequency: '1h', prediction_length: H, context: [context], ...(bounds.some(Boolean) ? { physical_bounds: bounds } : {}) }),
  });
  if (!r.ok) throw new Error(`servizio ${r.status}: ${await r.text()}`);
  return (await r.json()) as ServiceResponse;
}

async function run() {
  const s = JSON.parse(readFileSync(STATE, 'utf8')) as State;
  const A = await signIn(s.users.admin.email, s.password);
  const R = await signIn(s.users.lettore.email, s.password);
  const O = await signIn(s.users.esterno.email, s.password);
  const health = (await (await fetch(`${SERVICE_URL}/health`)).json()) as { models: Record<string, { status: string; revision: string }>; code_commit: string };
  record('T0', 'Container Timestral: modello caricato', health.models[M5]?.status === 'pronto', `${M5} ${health.models[M5]?.status}, revisione ${health.models[M5]?.revision.slice(0, 7)}, codice ${health.code_commit.slice(0, 7)}`);
  const proxyDeps = (userClient: SupabaseClient, userId: string, extra: Record<string, unknown> = {}) => ({
    user: userClient as unknown as ProxyClient,
    admin: admin as unknown as ProxyClient,
    userId,
    serviceUrl: SERVICE_URL,
    serviceToken: SERVICE_TOKEN,
    timeoutMs: 60_000,
    ...extra,
  });
  const runIds: string[] = [];

  for (const key of ['urbano', 'agricolo'] as const) {
    const vars = VARIABLES[key];
    const { data: fr } = await admin.from('weather_fetch_runs').select('id, issued_at, response_grid_latitude, response_grid_longitude, response_elevation').eq('location_id', s.locations[key]).eq('status', 'completata').order('requested_at', { ascending: false }).limit(1).single();
    const issued = Date.parse(fr!.issued_at);
    const { data: stored } = await admin.from('weather_observations').select('observed_at, variable, value').eq('location_id', s.locations[key]).eq('source', 'open_meteo');
    const storedHours = new Set((stored ?? []).map((o) => o.observed_at)).size;
    // storico di 7 giorni dalla stessa API e dalla stessa cella (la Edge Function ne conserva ~24 h: sotto il minimo di 72)
    const l = LOC[key];
    const { body } = await fetchForecastJson(buildIngestUrl({ latitude: l.lat, longitude: l.lon, scope: l.scope }, { pastDays: 7, forecastDays: 1 }), { timeoutMs: 15_000, retries: 2 });
    const parsed = parseForecastResponse(body, l.scope);
    const past = parsed.hours.filter((h) => Date.parse(h.validAt) < issued);
    const T = past.length;
    // coerenza: sulle ore in comune lo storico integrato coincide con quello salvato dalla Edge Function
    const storedT = new Map((stored ?? []).filter((o) => o.variable === 'temperature_2m').map((o) => [Date.parse(o.observed_at), o.value as number]));
    const diffs = past.filter((h) => storedT.has(Date.parse(h.validAt))).map((h) => Math.abs((h.values.temperature_2m ?? NaN) - storedT.get(Date.parse(h.validAt))!));
    record(`S-${key}`, `Storico (${key}): Edge Function + integrazione dalla stessa cella`, T >= 72 && diffs.length > 0 && Math.max(...diffs) <= 0.5, `${storedHours} ore salvate dalla Edge Function; ${T} ore usate come contesto (7 giorni, stessa API e cella ${parsed.grid.latitude}/${parsed.grid.longitude}); scarto massimo sulle ${diffs.length} ore in comune ${fmt(Math.max(...diffs), 2)} °C`);
    const context = vars.map((v) => past.map((h) => h.values[v] ?? null));
    const lastTs = past.at(-1)!.validAt;

    // (A) previsione reale registrata su Supabase tramite il proxy
    const req: ProxyRequest = {
      schema_version: 1, model: M5, revision: PROXY_MODELS[M5]!, frequency: '1h', prediction_length: 24, context: [context],
      mdt: {
        project_id: s.projects[key], location_id: s.locations[key], context: key, issued_at: lastTs,
        variables: vars.map((v) => ({ name: v, unit: parsed.units[v] ?? '' })),
        lineage: {
          source: 'Open-Meteo Forecast API (best_match), stessa cella della Edge Function; ultime 24 h verificate con i dati salvati dalla Edge Function',
          period: { from: past[0]!.validAt, to: lastTs }, coordinates: { latitude: parsed.grid.latitude, longitude: parsed.grid.longitude, elevation: parsed.grid.elevation },
          note: 'Test tecnico: storico di 7 giorni, non sufficiente per una validazione scientifica.',
        },
      },
    };
    const t0 = Date.now();
    const out = await proxyForecast(proxyDeps(A, s.users.admin.id), req);
    runIds.push(out.run_id);
    const plausible = vars.every((v, i) => out.quantiles[0]![i]!.every((row) => row.every((x) => x >= RANGE[v]![0] - 1e-6 && x <= RANGE[v]![1] + 1e-6)));
    record(`P-${key}`, `Previsione Timestral-5M reale (${key}) registrata su Supabase`, !!out.run_id && plausible, `${vars.length} variabili × 24 h, inferenza ${out.inference_ms} ms, totale ${Date.now() - t0} ms, valori plausibili: ${plausible}, esecuzione ${out.run_id.slice(0, 8)}`);
    const { data: dbRun } = await admin.from('forecast_runs').select('status, model_version_id, input_hash, lineage').eq('id', out.run_id).single();
    const { count: nq } = await admin.from('forecast_quantiles').select('series_id, forecast_series!inner(run_id)', { count: 'exact', head: true }).eq('forecast_series.run_id', out.run_id);
    record(`R-${key}`, `Registrazione (${key}): stato, modello, revisione, hash, provenienza, località, quantili`, dbRun?.status === 'completata' && dbRun.model_version_id === `${M5}@${PROXY_MODELS[M5]}` && dbRun.input_hash.length === 64 && (dbRun.lineage as { location_id: string }).location_id === s.locations[key] && nq === 21 * vars.length, `${dbRun?.status}, ${dbRun?.model_version_id.slice(0, 32)}…, hash ${dbRun?.input_hash.slice(0, 12)}, ${nq} righe di quantili`);
    // vincolo fisico dell'umidità: metadati nella provenienza, nessuna voce per le altre variabili
    const pc = ((dbRun?.lineage as { physical_constraints?: Record<string, Record<string, unknown>> }).physical_constraints ?? {}) as Record<string, { physical_constraint_applied: boolean; adjusted_values_count: number; total_values: number; maximum_raw_value: number; minimum_raw_value: number; method: string; adapter_version: string; revision: string }>;
    const rh = pc.relative_humidity_2m;
    const rhIdx = vars.indexOf('relative_humidity_2m');
    const rhVals = out.quantiles[0]![rhIdx]!.flat();
    record(`V-${key}-umidita`, `Vincolo fisico dell’umidità (${key}): metadati registrati, valori entro 0–100, altre variabili non vincolate`, !!rh && rh.method === 'physical_clipping_v1' && rh.revision === PROXY_MODELS[M5] && Object.keys(pc).length === 1 && Math.max(...rhVals) <= 100 && Math.min(...rhVals) >= 0, rh ? `applicato: ${rh.physical_constraint_applied}, ${rh.adjusted_values_count}/${rh.total_values} valori corretti, grezzo ${fmt(rh.minimum_raw_value, 1)}…${fmt(rh.maximum_raw_value, 1)} %, metodo ${rh.method}, ${rh.adapter_version}; mediana ${fmt(Math.min(...out.median[0]![rhIdx]!), 1)}…${fmt(Math.max(...out.median[0]![rhIdx]!), 1)} %` : 'metadati assenti');

    // confronto con la previsione Open-Meteo salvata (stesse ore): scostamento, non accuratezza
    const { data: om } = await admin.from('weather_forecast_points').select('*').eq('fetch_run_id', fr!.id).order('valid_at');
    const omByTs = new Map((om ?? []).map((p) => [Date.parse(p.valid_at), p]));
    const futureTs = Array.from({ length: 24 }, (_, h) => Date.parse(lastTs) + (h + 1) * 3_600_000);
    const tIdx = vars.indexOf('temperature_2m');
    const omT = futureTs.map((t) => (omByTs.get(t)?.temperature_2m as number | null) ?? null);
    const tsQ = out.quantiles[0]![tIdx]!;
    const devT = mae(out.median[0]![tIdx]!, omT);
    const inside = omT.filter((v, h) => v !== null && v >= tsQ[h]![2]! && v <= tsQ[h]![18]!).length;
    // le baseline del dominio accettano i nomi interni: per temperatura percepita, ET0 e VPD non esiste una baseline
    const tsReq = (vi: number, hist = past): ForecastRequest | null => {
      const name = DOMAIN_NAME[vars[vi]!];
      if (!name) return null;
      return { frequency: '1h', horizon: 24, timezone: 'Europe/Rome', pastCovariates: [], knownCovariates: [], targets: [{ variable: name, unit: VARIABLE_UNITS[name]!, timestamps: hist.map((h) => h.validAt), values: hist.map((h) => h.values[vars[vi]!] ?? null) }] };
    };
    const naive = await new NaivePersistenceAdapter().forecast(tsReq(tIdx)!);
    const seas = await new SeasonalNaiveAdapter().forecast(tsReq(tIdx)!);
    record(`C-${key}`, `Confronto con la previsione Open-Meteo delle prossime 24 h (${key}, temperatura)`, true, `scostamento medio da Open-Meteo: Timestral ${fmt(devT.value, 2)} °C, persistenza ${fmt(mae(naive.median[0]!, omT).value, 2)} °C, stagionale ${fmt(mae(seas.median[0]!, omT).value, 2)} °C; Open-Meteo dentro la banda 80% di Timestral in ${inside}/${omT.filter((v) => v !== null).length} ore. Le osservazioni future non esistono ancora: accuratezza non misurabile.`);

    // (B) verifica a posteriori sulle ultime 24 h osservate (analisi Open-Meteo), storico precedente come contesto
    const hist = past.slice(0, -24);
    const obs = past.slice(-24);
    const ho = await callService(vars.map((v) => hist.map((h) => h.values[v] ?? null)), 24, boundsFor(vars.map((name) => ({ name }))));
    const lines: string[] = [];
    for (const [vi, v] of vars.entries()) {
      const y = obs.map((h) => h.values[v] ?? null);
      const r = tsReq(vi, hist);
      const nv = r ? await new NaivePersistenceAdapter().forecast(r) : null;
      const sv = r ? await new SeasonalNaiveAdapter().forecast(r) : null;
      const tq = ho.quantiles[0]![vi]!;
      const base = nv && sv ? ` / pers ${fmt(mae(nv.median[0]!, y).value)} / stag ${fmt(mae(sv.median[0]!, y).value)}` : ' (baseline non disponibile)';
      const baseW = nv && sv ? ` / pers ${fmt(wql(nv.quantiles[0]!, y))} / stag ${fmt(wql(sv.quantiles[0]!, y))}` : '';
      lines.push(`${v}: MAE T ${fmt(mae(ho.median[0]![vi]!, y).value)}${base}; WQL T ${fmt(wql(tq, y))}${baseW}; cop80 T ${fmt(coverage(tq, y, 0.1, 0.9).value, 2)}`);
    }
    // previsione Open-Meteo emessa il giorno prima per le stesse ore (Previous Runs API), solo temperatura
    let omPrev = 'non disponibile';
    try {
      const u = `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${l.lat}&longitude=${l.lon}&hourly=temperature_2m_previous_day1&past_days=2&forecast_days=1&timeformat=unixtime&timezone=GMT`;
      const pj = (await (await fetch(u)).json()) as { hourly?: { time: number[]; temperature_2m_previous_day1: (number | null)[] } };
      const m = new Map((pj.hourly?.time ?? []).map((t, i) => [t * 1000, pj.hourly!.temperature_2m_previous_day1[i] ?? null]));
      const pred = obs.map((h) => m.get(Date.parse(h.validAt)) ?? null);
      const yT = obs.map((h) => h.values.temperature_2m ?? null);
      const pairs = pred.map((p, i) => [p, yT[i]] as const).filter(([p, y]) => p !== null && y !== null);
      if (pairs.length) omPrev = `${fmt(pairs.reduce((a, [p, y]) => a + Math.abs(p! - y!), 0) / pairs.length)} °C su ${pairs.length} ore`;
    } catch {
      /* API non raggiungibile: dichiarato */
    }
    record(`V-${key}`, `Verifica a posteriori sulle ultime 24 h (${key})`, true, `${lines.join(' · ')} · temperatura, previsione Open-Meteo del giorno prima: MAE ${omPrev}. Test tecnico completato; accuratezza non ancora validabile per insufficienza dello storico (1 sola origine, 24 h).`);
  }

  // ---------------------------------------------------------------- permessi e immutabilità sul database reale
  const baseReq = async (): Promise<ProxyRequest> => {
    const { data: r } = await admin.from('forecast_runs').select('lineage').eq('id', runIds[0]!).single();
    return { schema_version: 1, model: M5, revision: PROXY_MODELS[M5]!, frequency: '1h', prediction_length: 12, context: [[Array.from({ length: 96 }, (_, t) => 10 + Math.sin(t / 4))]], mdt: { project_id: s.projects.urbano, context: 'urbano', issued_at: new Date().toISOString(), variables: [{ name: 'temperature_2m', unit: '°C' }], lineage: r!.lineage as ProxyRequest['mdt']['lineage'] } };
  };
  const reader = await proxyForecast(proxyDeps(R, s.users.lettore.id), await baseReq()).then(() => 200, (e) => e.status);
  record('A1', 'Lettore: non può avviare previsioni', reader === 403, `HTTP ${reader}`);
  const outsider = await proxyForecast(proxyDeps(O, s.users.esterno.id), await baseReq()).then(() => 200, (e) => e.status);
  record('A2', 'Esterno: progetto non visibile, nessuna previsione', outsider === 404, `HTTP ${outsider}`);
  const rr = await R.from('forecast_runs').select('id').in('id', runIds);
  const ro = await O.from('forecast_runs').select('id').in('id', runIds);
  const so = await O.from('forecast_series').select('id').in('run_id', runIds);
  record('A3', 'Lettura: il lettore vede i risultati, l’esterno no', (rr.data ?? []).length === runIds.length && (ro.data ?? []).length === 0 && (so.data ?? []).length === 0, `lettore ${(rr.data ?? []).length}/${runIds.length}, esterno ${(ro.data ?? []).length} esecuzioni e ${(so.data ?? []).length} serie`);
  const fake = await A.from('forecast_runs').insert({ organization_id: s.orgs.A.id, project_id: s.projects.urbano, model_version_id: `${M5}@${PROXY_MODELS[M5]}`, context: 'urbano', horizon: 24, issued_at: new Date().toISOString(), input_hash: 'x'.repeat(64), data_class: 'STIMATO_DA_MODELLO', lineage: { source: 'finto', period: {}, variable: 'temperature_2m' } });
  const fakeSim = await A.from('forecast_runs').insert({ organization_id: s.orgs.A.id, project_id: s.projects.urbano, model_version_id: `${M5}@${PROXY_MODELS[M5]}`, context: 'urbano', horizon: 24, issued_at: new Date().toISOString(), input_hash: 'x'.repeat(64), data_class: 'SIMULATO', lineage: { source: 'finto', period: {}, variable: 'temperature_2m' } });
  record('A4', 'Un client (anche amministratore) non registra previsioni Timestral né simulate spacciate per Timestral', !!fake.error && !!fakeSim.error, `${fake.error?.message ?? 'accettata!'} / ${fakeSim.error?.message ?? 'accettata!'}`);
  const upd = await admin.from('forecast_runs').update({ status: 'errore' }).eq('id', runIds[0]!);
  record('A5', 'Esecuzioni concluse immutabili (anche per il ruolo di servizio)', !!upd.error, upd.error?.message ?? 'modificata!');
  const before = (await admin.from('forecast_runs').select('id').eq('status', 'completata').in('id', runIds)).data?.length;
  const down = await proxyForecast(proxyDeps(A, s.users.admin.id, { serviceUrl: 'http://127.0.0.1:9' }), await baseReq()).then(() => 200, (e) => e.status);
  const after = (await admin.from('forecast_runs').select('id').eq('status', 'completata').in('id', runIds)).data?.length;
  const { data: lastErr } = await admin.from('forecast_runs').select('status, error').eq('project_id', s.projects.urbano).order('created_at', { ascending: false }).limit(1).single();
  record('A6', 'Servizio non raggiungibile: messaggio semplice, esecuzione in errore, risultati precedenti intatti', down === 503 && before === after && lastErr?.status === 'errore', `HTTP ${down}, “${lastErr?.error}”, completate prima ${before} dopo ${after}`);
  report(s);
}

function report(s: State) {
  const day = new Date().toISOString().slice(0, 10);
  const ok = results.filter((r) => r.ok).length;
  mkdirSync('docs/reports', { recursive: true });
  const file = `docs/reports/timestral-runtime-${day}.md`;
  writeFileSync(file, [
    `# Timestral-5M reale — test tecnico su Supabase di TEST (${day})`, '',
    `- Modello: ${M5} @ ${PROXY_MODELS[M5]} (pesi Modified MIT, codice Apache-2.0), container locale su CPU, non esposto in rete`,
    `- Dati: Open-Meteo reale (Edge Function + storico di 7 giorni della stessa cella); dati temporanei \`${s.prefix}\`, eliminati a fine test`,
    `- Esito: ${ok}/${results.length} controlli superati`, '',
    '| ID | Controllo | Esito | Evidenza |', '|---|---|---|---|',
    ...results.map((r) => `| ${r.id} | ${r.title} | ${r.ok ? '✔' : '✖'} | ${r.evidence.replace(/\|/g, '/')} |`), '',
    '**Test tecnico completato; accuratezza non ancora validabile per insufficienza dello storico.** Il confronto con la previsione Open-Meteo futura è uno scostamento, non un errore: le osservazioni corrispondenti non esistono ancora.', '',
    'Nessuna credenziale è riportata in questo file.', '',
  ].join('\n'));
  console.log(`\n${ok}/${results.length} controlli superati. Report: ${file}`);
  process.exitCode = ok === results.length ? 0 : 1;
}

// ------------------------------------------------------------------ cleanup
async function cleanup() {
  const s = JSON.parse(readFileSync(STATE, 'utf8')) as State;
  console.log(`Pulizia ${s.prefix}: organizzazioni ${Object.values(s.orgs).map((o) => o.id).join(', ')}; progetti ${Object.values(s.projects).join(', ')}; località ${Object.values(s.locations).join(', ')}; utenti ${Object.values(s.users).map((u) => u.id).join(', ')}`);
  const errors: string[] = [];
  for (const [k, o] of Object.entries(s.orgs)) {
    const c = await signIn(s.users[k === 'A' ? 'admin' : 'esterno'].email, s.password);
    const r = await c.rpc('delete_organization', { p_org: o.id, p_confirm_name: o.name });
    if (r.error) errors.push(`org ${k}: ${r.error.message}`);
  }
  for (const [k, u] of Object.entries(s.users)) {
    const r = await admin.auth.admin.deleteUser(u.id);
    if (r.error) errors.push(`utente ${k}: ${r.error.message}`);
  }
  const orgs = Object.values(s.orgs).map((o) => o.id);
  const left: Record<string, number> = {};
  for (const t of ['organizations', 'memberships', 'projects', 'weather_locations', 'weather_fetch_runs', 'weather_forecast_points', 'weather_observations', 'forecast_runs', 'forecast_backtests', 'forecast_thresholds', 'forecast_alerts', 'media_assets']) {
    left[t] = (await admin.from(t).select('*', { count: 'exact', head: true }).in(t === 'organizations' ? 'id' : 'organization_id', orgs)).count ?? -1;
  }
  left.users = (await admin.from('users').select('*', { count: 'exact', head: true }).in('id', Object.values(s.users).map((u) => u.id))).count ?? -1;
  left.auth_users = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.filter((u) => u.email?.startsWith(s.prefix.toLowerCase())).length;
  console.log('rilettura:', JSON.stringify(left));
  const residual = Object.entries(left).filter(([, n]) => n !== 0);
  if (errors.length || residual.length) {
    console.log(`PULIZIA NON RIUSCITA: ${[...errors, ...residual.map(([t, n]) => `${t}=${n}`)].join('; ')}`);
    process.exitCode = 1;
    return;
  }
  rmSync(STATE);
  console.log('Pulizia riuscita: ogni conteggio riletto è 0; stato locale eliminato.');
}

/** Da eseguire con il container SPENTO: messaggio semplice, esecuzione in errore, risultati precedenti intatti. */
async function fallback() {
  const s = JSON.parse(readFileSync(STATE, 'utf8')) as State;
  const A = await signIn(s.users.admin.email, s.password);
  const health = await fetch(`${SERVICE_URL}/health`).then(() => 'raggiungibile', () => 'spento');
  const { data: done } = await admin.from('forecast_runs').select('id').eq('organization_id', s.orgs.A.id).eq('status', 'completata');
  const { data: one } = await admin.from('forecast_runs').select('lineage').eq('organization_id', s.orgs.A.id).limit(1).single();
  const req: ProxyRequest = { schema_version: 1, model: M5, revision: PROXY_MODELS[M5]!, frequency: '1h', prediction_length: 24, context: [[Array.from({ length: 96 }, (_, t) => 10 + Math.sin(t / 4))]], mdt: { project_id: s.projects.urbano, context: 'urbano', issued_at: new Date().toISOString(), variables: [{ name: 'temperature_2m', unit: '°C' }], lineage: one!.lineage as ProxyRequest['mdt']['lineage'] } };
  const err = await proxyForecast({ user: A as unknown as ProxyClient, admin: admin as unknown as ProxyClient, userId: s.users.admin.id, serviceUrl: SERVICE_URL, serviceToken: SERVICE_TOKEN, timeoutMs: 10_000 }, req).then(() => null, (e) => e as { status: number; message: string });
  const { data: after } = await admin.from('forecast_runs').select('id').eq('organization_id', s.orgs.A.id).eq('status', 'completata');
  const { data: last } = await admin.from('forecast_runs').select('status, error').eq('organization_id', s.orgs.A.id).order('created_at', { ascending: false }).limit(1).single();
  const ok = health === 'spento' && err?.status === 503 && last?.status === 'errore' && (after ?? []).length === (done ?? []).length;
  const line = `| F1 | Container spento: messaggio semplice, esecuzione in errore, risultati precedenti intatti | ${ok ? '✔' : '✖'} | servizio ${health}; HTTP ${err?.status} “${err?.message}”; completate prima ${(done ?? []).length}, dopo ${(after ?? []).length} |`;
  console.log(line);
  const file = `docs/reports/timestral-runtime-${new Date().toISOString().slice(0, 10)}.md`;
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8').replace('\n\n**Test tecnico completato', `\n${line}\n\n**Test tecnico completato`);
    writeFileSync(file, text);
  }
  process.exitCode = ok ? 0 : 1;
}

const cmd = process.argv[2];
if (cmd === 'setup') await setup();
else if (cmd === 'run') await run();
else if (cmd === 'fallback') await fallback();
else if (cmd === 'cleanup') await cleanup();
else console.error('Uso: timestral-runtime.ts setup | run | fallback | cleanup');
