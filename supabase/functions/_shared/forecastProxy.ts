// Logica del proxy Timestral (browser → Edge Function → servizio Timestral → Supabase),
// indipendente da Deno: testata su PGlite (supabase/tests/forecastProxy.test.ts) con fetch simulato.
// Il browser non chiama mai il servizio direttamente e non conosce il token di servizio.
// Solo il ruolo di servizio (admin) registra esecuzioni e output Timestral; il client dell'utente
// serve a verificare, con le sue policy RLS, che il progetto gli sia visibile.

type Res = { data: unknown; error: { message: string; code?: string } | null };
interface Query extends PromiseLike<Res> {
  select(cols?: string): Query;
  insert(v: Record<string, unknown>): Query;
  update(v: Record<string, unknown>): Query;
  eq(col: string, val: unknown): Query;
  maybeSingle(): Query;
}
export interface ProxyClient {
  from(table: string): Query;
}

export class ProxyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProxyError';
  }
}

/** Modelli ammessi e revisioni bloccate: devono coincidere con services/forecasting/app/config.py. */
export const PROXY_MODELS: Record<string, string> = {
  'mistralai/Timestral-5M': 'bdd20cfc15a3fea0e4cb5ccef37f8d3ca7aa335f',
  'mistralai/Timestral-28M': '49b26409ac87b5935539a5d8ffe7f397b720db47',
};
export const QUANTILE_LEVELS = [0.01, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.99];
/**
 * Limiti fisici stabiliti lato server per nome di variabile (mai dal browser). Solo le grandezze
 * elencate vengono vincolate; per tutte le altre l'output del modello resta invariato.
 */
export const PHYSICAL_BOUNDS: Record<string, [number, number]> = {
  relative_humidity_2m: [0, 100],
  umidita_relativa: [0, 100],
};
export const CONSTRAINT_METHOD = 'physical_clipping_v1';

export interface ConstraintReport {
  physical_constraint_applied: boolean;
  physical_min: number | null;
  physical_max: number | null;
  adjusted_values_count: number;
  total_values: number;
  maximum_raw_value: number;
  minimum_raw_value: number;
  method: string;
  adapter_version: string;
}
export const PROXY_LIMITS = { maxBodyBytes: 2_000_000, maxVariates: 8, minContext: 72, maxContext: 8760, maxHorizon: 168, maxRunsPer10Min: 5 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VARIABLE = /^[a-z0-9_]{2,40}$/;

export interface ProxyMeta {
  project_id: string;
  context: 'urbano' | 'agricolo';
  /** una voce per variata del contesto, nello stesso ordine */
  variables: { name: string; unit: string }[];
  /** istante dell'ultimo dato dello storico (ISO); le previsioni partono dall'ora successiva */
  issued_at: string;
  location_id?: string | null;
  /** provenienza dichiarata: fonte, periodo, mancanti, covariate */
  lineage: { source: string; period: { from: string; to: string }; [k: string]: unknown };
}

export interface ProxyRequest {
  schema_version: 1;
  model: string;
  revision: string;
  frequency: '1h';
  prediction_length: number;
  context: (number | null)[][][];
  past_covariates?: (number | null)[][][] | null;
  known_covariates?: (number | null)[][][] | null;
  input_hash?: string | null;
  mdt: ProxyMeta;
}

export interface ServiceResponse {
  schema_version: number;
  model: string;
  revision: string;
  code_commit: string;
  quantile_levels: number[];
  quantiles: number[][][][];
  median: number[][][];
  inference_ms: number;
  warnings: string[];
  input_hash: string;
  cached?: boolean;
  adapter_version?: string;
  /** una voce per variata: rapporto del vincolo fisico o null */
  constraints?: (ConstraintReport | null)[];
}

/** Limiti per variata, nell'ordine del contesto (null = nessun limite). */
export function boundsFor(variables: { name: string }[]): ([number, number] | null)[] {
  return variables.map((v) => PHYSICAL_BOUNDS[v.name] ?? null);
}

export interface ProxyDeps {
  /** client con il token dell'utente: le policy RLS decidono cosa vede */
  user: ProxyClient;
  /** client con il ruolo di servizio: unico autorizzato a registrare output Timestral */
  admin: ProxyClient;
  userId: string;
  serviceUrl: string | null | undefined;
  serviceToken: string | null | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
  /** solo identificativi tecnici, esiti e durate (mai valori delle serie o dati personali) */
  log?: (msg: string) => void;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Controlli di forma e limiti prima di registrare o inoltrare qualsiasi cosa. */
export function validateProxyRequest(b: ProxyRequest): void {
  const bad = (m: string) => {
    throw new ProxyError(422, 'INPUT', m);
  };
  if (!b || typeof b !== 'object') bad('Corpo della richiesta non valido.');
  if (b.schema_version !== 1) bad('Versione dello schema non supportata.');
  if (!(b.model in PROXY_MODELS)) bad('Modello non ammesso.');
  if (b.revision !== PROXY_MODELS[b.model]) bad('Revisione del modello diversa da quella bloccata.');
  if (b.frequency !== '1h') bad('Frequenza non supportata.');
  if (!Number.isInteger(b.prediction_length) || b.prediction_length < 1 || b.prediction_length > PROXY_LIMITS.maxHorizon) bad('Orizzonte fuori dai limiti.');
  const m = b.mdt;
  if (!m || !UUID.test(m.project_id ?? '')) bad('Progetto non indicato.');
  if (m.location_id != null && !UUID.test(m.location_id)) bad('Località non valida.');
  if (m.context !== 'urbano' && m.context !== 'agricolo') bad('Contesto non valido.');
  if (!m.lineage || typeof m.lineage.source !== 'string' || !m.lineage.period?.from || !m.lineage.period?.to) bad('Provenienza dei dati mancante.');
  if (Number.isNaN(Date.parse(m.issued_at))) bad('Istante di emissione non valido.');
  if (!Array.isArray(b.context) || b.context.length !== 1) bad('Serve una sola serie.');
  const vars = b.context[0]!;
  if (!Array.isArray(vars) || vars.length < 1 || vars.length > PROXY_LIMITS.maxVariates) bad('Numero di variabili fuori dai limiti.');
  if (!Array.isArray(m.variables) || m.variables.length !== vars.length) bad('Le variabili dichiarate non corrispondono al contesto.');
  for (const v of m.variables) if (!VARIABLE.test(v?.name ?? '') || typeof v.unit !== 'string' || v.unit.length < 1 || v.unit.length > 20) bad('Nome o unità di una variabile non validi.');
  const T = vars[0]?.length ?? 0;
  if (T < PROXY_LIMITS.minContext || T > PROXY_LIMITS.maxContext) bad(`Storico di ${T} ore fuori dai limiti (${PROXY_LIMITS.minContext}–${PROXY_LIMITS.maxContext}).`);
  for (const row of vars) {
    if (!Array.isArray(row) || row.length !== T) bad('Le variabili devono avere la stessa lunghezza.');
    for (const x of row) if (x !== null && !isNum(x)) bad('Valori non numerici nello storico.');
  }
}

/** Controllo della risposta del servizio prima di registrarla o restituirla. */
export function checkServiceResponse(out: ServiceResponse, req: ProxyRequest): string[] {
  const V = req.context[0]!.length;
  const H = req.prediction_length;
  const problems: string[] = [];
  if (out.schema_version !== 1) problems.push('versione dello schema di risposta inattesa');
  if (out.model !== req.model || out.revision !== PROXY_MODELS[req.model]) problems.push('modello o revisione diversi da quelli richiesti');
  if (out.quantile_levels?.length !== QUANTILE_LEVELS.length || out.quantile_levels.some((l, i) => Math.abs(l - QUANTILE_LEVELS[i]!) > 1e-9)) problems.push('livelli dei quantili inattesi');
  const q = out.quantiles?.[0];
  const med = out.median?.[0];
  if (!q || q.length !== V || !med || med.length !== V) return [...problems, 'forma della risposta inattesa'];
  for (let v = 0; v < V; v++) {
    if (q[v]!.length !== H || med[v]!.length !== H) return [...problems, 'orizzonte della risposta inatteso'];
    for (let h = 0; h < H; h++) {
      const row = q[v]![h]!;
      if (row.length !== QUANTILE_LEVELS.length || !row.every(isNum) || !isNum(med[v]![h])) return [...problems, 'valori non finiti nella risposta'];
      for (let i = 1; i < row.length; i++) if (row[i]! < row[i - 1]! - 1e-9) return [...problems, 'quantili incrociati nella risposta'];
      if (Math.abs(row[10]! - med[v]![h]!) > 1e-6) return [...problems, 'mediana incoerente con il quantile 0,5'];
    }
  }
  // seconda verifica di sicurezza: nessun valore fuori dai limiti fisici, vincolo dichiarato
  const bounds = boundsFor(req.mdt.variables);
  for (let v = 0; v < V; v++) {
    const b = bounds[v];
    if (!b) continue;
    if (q[v]!.some((row) => row.some((x) => x < b[0] - 1e-9 || x > b[1] + 1e-9))) return [...problems, `${req.mdt.variables[v]!.name}: valori fuori dai limiti fisici`];
    const rep = out.constraints?.[v];
    if (!rep || rep.method !== CONSTRAINT_METHOD || rep.physical_min !== b[0] || rep.physical_max !== b[1]) return [...problems, `${req.mdt.variables[v]!.name}: vincolo fisico non dichiarato dal servizio`];
  }
  return problems;
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ROLE_RANK: Record<string, number> = { viewer: 1, editor: 2, admin: 3 };

/**
 * Esegue una previsione Timestral per conto dell'utente e la registra su Supabase.
 * Ordine: forma → progetto visibile all'utente → ruolo "modifica" → limite di frequenza →
 * registrazione "in corso" → servizio (con timeout) → controllo della risposta → output e "completata".
 * Un errore chiude solo questa esecuzione: le esecuzioni valide precedenti non vengono toccate.
 */
export async function proxyForecast(deps: ProxyDeps, req: ProxyRequest): Promise<ServiceResponse & { run_id: string }> {
  const log = deps.log ?? (() => {});
  validateProxyRequest(req);
  const m = req.mdt;

  const proj = await deps.user.from('projects').select('id, organization_id').eq('id', m.project_id).maybeSingle();
  if (proj.error) throw new ProxyError(500, 'DATABASE', proj.error.message);
  const p = proj.data as { id: string; organization_id: string } | null;
  if (!p) throw new ProxyError(404, 'AUTORIZZAZIONE', 'Progetto non trovato.');

  const mem = await deps.admin.from('memberships').select('role').eq('organization_id', p.organization_id).eq('user_id', deps.userId).maybeSingle();
  if (mem.error) throw new ProxyError(500, 'DATABASE', mem.error.message);
  const role = (mem.data as { role: string } | null)?.role;
  if ((ROLE_RANK[role ?? ''] ?? 0) < ROLE_RANK.editor!) throw new ProxyError(403, 'AUTORIZZAZIONE', 'Serve il ruolo "modifica" per avviare una previsione.');

  if (m.location_id) {
    const loc = await deps.admin.from('weather_locations').select('id, project_id').eq('id', m.location_id).maybeSingle();
    if (loc.error) throw new ProxyError(500, 'DATABASE', loc.error.message);
    if ((loc.data as { project_id: string } | null)?.project_id !== p.id) throw new ProxyError(422, 'INPUT', 'La località non appartiene al progetto.');
  }

  const now = (deps.now ?? (() => new Date()))();
  const recent = await deps.admin.from('forecast_runs').select('id, created_at, model_version_id').eq('project_id', p.id).eq('started_by', deps.userId);
  if (recent.error) throw new ProxyError(500, 'DATABASE', recent.error.message);
  const last10 = ((recent.data as { created_at: string; model_version_id: string }[]) ?? []).filter(
    (r) => r.model_version_id.startsWith('mistralai/Timestral') && Date.parse(r.created_at) > now.getTime() - 10 * 60_000,
  );
  if (last10.length >= PROXY_LIMITS.maxRunsPer10Min) throw new ProxyError(429, 'LIMITE', 'Troppe previsioni avanzate in poco tempo: riprova tra qualche minuto.');

  const bounds = boundsFor(m.variables);
  // solo i campi dello schema del servizio, elencati: qualsiasi altro campo del client (anche physical_bounds)
  // viene scartato; i limiti fisici li decide il server (tabella PHYSICAL_BOUNDS), mai il browser
  const rest = {
    schema_version: req.schema_version,
    model: req.model,
    revision: req.revision,
    frequency: req.frequency,
    prediction_length: req.prediction_length,
    context: req.context,
    ...(req.past_covariates ? { past_covariates: req.past_covariates } : {}),
    ...(req.known_covariates ? { known_covariates: req.known_covariates } : {}),
  };
  const servicePayload = bounds.some(Boolean) ? { ...rest, physical_bounds: bounds } : rest;
  const inputHash = await sha256Hex(JSON.stringify(servicePayload));
  const modelVersion = `${req.model}@${PROXY_MODELS[req.model]}`;
  const baseLineage = { ...m.lineage, variable: m.variables.map((v) => v.name).join(','), location_id: m.location_id ?? null, model: req.model, revision: PROXY_MODELS[req.model] };

  /** Registra l'esecuzione (la provenienza è immutabile: si scrive una volta, con i metadati noti). */
  const register = async (lineage: Record<string, unknown>): Promise<string> => {
    const ins = await deps.admin
      .from('forecast_runs')
      .insert({
        organization_id: p.organization_id,
        project_id: p.id,
        model_version_id: modelVersion,
        context: m.context,
        horizon: req.prediction_length,
        issued_at: m.issued_at,
        input_hash: inputHash,
        data_class: 'STIMATO_DA_MODELLO',
        lineage,
        started_by: deps.userId,
      })
      .select('id')
      .maybeSingle();
    if (ins.error || !ins.data) throw new ProxyError(500, 'DATABASE', ins.error?.message ?? 'Esecuzione non registrata.');
    return String((ins.data as { id: string }).id);
  };
  const closeWithError = async (runId: string, status: number, code: string, message: string): Promise<never> => {
    // chiude solo questa esecuzione; le precedenti restano intatte
    await deps.admin.from('forecast_runs').update({ status: 'errore', error: message.slice(0, 300) }).eq('id', runId);
    log(`forecast-proxy run=${runId} esito=errore codice=${code}`);
    throw new ProxyError(status, code, message);
  };
  /** Errore prima di avere un output valido: l'esecuzione resta tracciata come "errore". */
  const fail = async (status: number, code: string, message: string): Promise<never> => closeWithError(await register(baseLineage), status, code, message);

  const unavailable = 'Il modello avanzato non è disponibile. Puoi continuare con la previsione di base.';
  if (!deps.serviceUrl || !deps.serviceToken) return fail(503, 'NON_DISPONIBILE', unavailable);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 60_000);
  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)(`${deps.serviceUrl.replace(/\/$/, '')}/v1/forecast`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${deps.serviceToken}` },
      body: JSON.stringify(servicePayload),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    return fail((e as Error).name === 'AbortError' ? 504 : 503, 'NON_DISPONIBILE', unavailable);
  }
  clearTimeout(timer);
  if (res.status === 503 || res.status === 429 || res.status === 504) return fail(res.status === 429 ? 429 : 503, 'NON_DISPONIBILE', unavailable);
  if (!res.ok) return fail(502, 'SERVIZIO', `Il servizio di previsione ha rifiutato la richiesta (${res.status}).`);
  let out: ServiceResponse;
  try {
    out = (await res.json()) as ServiceResponse;
  } catch {
    return fail(502, 'SERVIZIO', 'Risposta del servizio di previsione non leggibile.');
  }
  const problems = checkServiceResponse(out, req);
  if (problems.length) return fail(502, 'RISPOSTA', `Risposta non valida: ${problems.join('; ')}.`);

  // metadati del vincolo fisico per le sole variabili vincolate (i valori grezzi non vengono conservati)
  const physical_constraints = Object.fromEntries(
    m.variables.flatMap((v, i) => {
      const r = out.constraints?.[i];
      return r ? [[v.name, { ...r, model: req.model, revision: PROXY_MODELS[req.model] }]] : [];
    }),
  );
  const runId = await register({ ...baseLineage, adapter_version: out.adapter_version ?? null, physical_constraints });

  const issued = Date.parse(m.issued_at);
  const timestamps = Array.from({ length: req.prediction_length }, (_, h) => new Date(issued + (h + 1) * 3_600_000).toISOString());
  for (let v = 0; v < m.variables.length; v++) {
    const s = await deps.admin
      .from('forecast_series')
      .insert({ run_id: runId, variable: m.variables[v]!.name, unit: m.variables[v]!.unit, timestamps, median: out.median[0]![v]! })
      .select('id')
      .maybeSingle();
    if (s.error || !s.data) return closeWithError(runId, 500, 'DATABASE', 'Serie della previsione non registrata.');
    const seriesId = String((s.data as { id: string }).id);
    for (let i = 0; i < QUANTILE_LEVELS.length; i++) {
      const qi = await deps.admin
        .from('forecast_quantiles')
        .insert({ series_id: seriesId, level: QUANTILE_LEVELS[i], values: out.quantiles[0]![v]!.map((row) => row[i]!) });
      if (qi.error) return closeWithError(runId, 500, 'DATABASE', 'Quantili della previsione non registrati.');
    }
  }
  const done = await deps.admin.from('forecast_runs').update({ status: 'completata', inference_ms: out.inference_ms, warnings: out.warnings ?? [] }).eq('id', runId);
  if (done.error) return closeWithError(runId, 500, 'DATABASE', done.error.message);
  const adjusted = Object.values(physical_constraints).reduce((a, r) => a + ((r as ConstraintReport).adjusted_values_count ?? 0), 0);
  log(`forecast-proxy run=${runId} esito=completata modello=${req.model} variate=${m.variables.length} h=${req.prediction_length} ms=${out.inference_ms} corretti=${adjusted}`);
  return { ...out, input_hash: inputHash, run_id: runId };
}
