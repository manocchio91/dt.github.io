import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { hashOf, seedCampobasso } from '@mdt/domain';
import { actAs, createAuthUser, createDb } from './harness';
import { pgliteClient } from './pgliteClient';
import { PROXY_MODELS, ProxyError, proxyForecast, QUANTILE_LEVELS, type ProxyClient, type ProxyRequest } from '../functions/_shared/forecastProxy.ts';

/** Proxy Timestral (B-131/B-165): permessi, registrazione immutabile, risposte del servizio controllate. */
const ids = {
  alice: '00000000-0000-4000-8000-00000000a11c', // admin A
  dave: '00000000-0000-4000-8000-00000000da7e', // editor A
  carol: '00000000-0000-4000-8000-0000000ca201', // viewer A
  bob: '00000000-0000-4000-8000-000000000b0b', // admin B (esterno)
};
const M5 = 'mistralai/Timestral-5M';
let db: PGlite;
let orgA: string;
let pid: string;

const rows = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows;
let clockShift = 0;

function request(over: Partial<ProxyRequest> = {}, H = 24, V = 1): ProxyRequest {
  const ctx = Array.from({ length: V }, (_, v) => Array.from({ length: 96 }, (_, t) => 20 + v + Math.sin(t / 4)));
  return {
    schema_version: 1,
    model: M5,
    revision: PROXY_MODELS[M5]!,
    frequency: '1h',
    prediction_length: H,
    context: [ctx],
    mdt: {
      project_id: pid,
      context: 'urbano',
      variables: Array.from({ length: V }, (_, v) => ({ name: v ? 'umidita_relativa' : 'temperatura_aria', unit: v ? '%' : '°C' })),
      issued_at: '2026-10-25T18:00:00Z',
      lineage: { source: 'Open-Meteo (Edge Function)', period: { from: '2026-10-21T19:00:00Z', to: '2026-10-25T18:00:00Z' } },
    },
    ...over,
  };
}

/**
 * Risposta di servizio coerente con la richiesta, che emula il vincolo fisico del servizio reale per le
 * variate con `physical_bounds`; `center` sposta i valori (es. umidità vicina a 100) e `mutate` simula errori.
 */
function serviceResponse(req: ProxyRequest & { physical_bounds?: ([number, number] | null)[] }, mutate?: (o: Record<string, unknown>) => void, center = 20, clip = true) {
  const V = req.context[0]!.length;
  const H = req.prediction_length;
  const raw = Array.from({ length: V }, () => Array.from({ length: H }, (_, h) => QUANTILE_LEVELS.map((l) => center + h * 0.01 + (l - 0.5) * 40)));
  const constraints = raw.map((rows, v) => {
    const b = req.physical_bounds?.[v];
    if (!b) return null;
    const flat = rows.flat();
    const adjusted = flat.filter((x) => x < b[0] || x > b[1]).length;
    if (clip) rows.forEach((row) => row.forEach((x, i) => (row[i] = Math.min(b[1], Math.max(b[0], x)))));
    return { physical_constraint_applied: adjusted > 0, physical_min: b[0], physical_max: b[1], adjusted_values_count: adjusted, total_values: flat.length, maximum_raw_value: Math.max(...flat), minimum_raw_value: Math.min(...flat), method: 'physical_clipping_v1', adapter_version: 'mdt-forecasting 0.2.0' };
  });
  const quantiles = [raw];
  const median = [raw.map((v) => v.map((row) => row[10]!))];
  const o: Record<string, unknown> = { schema_version: 1, model: req.model, revision: req.revision, code_commit: 'a534bdb', quantile_levels: QUANTILE_LEVELS, quantiles, median, inference_ms: 120, warnings: [], input_hash: 'x', adapter_version: 'mdt-forecasting 0.2.0', constraints };
  mutate?.(o);
  return o;
}

function fakeFetch(handler: (body: Record<string, unknown>, headers: Record<string, string>) => { status: number; body?: unknown; delayMs?: number }) {
  const calls: { body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const headers = init.headers as Record<string, string>;
    calls.push({ body, headers });
    const r = handler(body, headers);
    if (r.delayMs) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, r.delayMs);
        init.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    }
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function deps(userId: string, fetchImpl?: typeof fetch, extra: Record<string, unknown> = {}) {
  return {
    user: pgliteClient(db, { as: { id: userId } }) as unknown as ProxyClient,
    admin: pgliteClient(db, { as: 'service' }) as unknown as ProxyClient,
    userId,
    serviceUrl: 'http://forecasting.test',
    serviceToken: 'token-di-servizio-di-prova',
    fetchImpl,
    timeoutMs: 2_000,
    ...extra,
  };
}

const okFetch = () => fakeFetch((body) => ({ status: 200, body: serviceResponse(body as unknown as ProxyRequest) }));

beforeAll(async () => {
  db = await createDb();
  for (const [k, email] of [['alice', 'alice@a.it'], ['dave', 'dave@a.it'], ['carol', 'carol@a.it'], ['bob', 'bob@b.it']] as const) await createAuthUser(db, ids[k], email);
  await actAs(db, { id: ids.alice });
  orgA = (await db.query<{ id: string }>(`select public.create_organization('Comune A') as id`)).rows[0]!.id;
  await db.query(`select public.add_member_by_email($1, 'dave@a.it', 'editor')`, [orgA]);
  await db.query(`select public.add_member_by_email($1, 'carol@a.it', 'viewer')`, [orgA]);
  const b = seedCampobasso(new Date('2026-10-24T08:00:00Z'));
  pid = b.project.id;
  await db.query('select public.save_project($1, $2, $3, 0)', [orgA, JSON.stringify(b), hashOf(b)]);
  await actAs(db, { id: ids.bob });
  await db.query(`select public.create_organization('Comune B')`);
}, 180_000);

describe('Proxy Timestral — esecuzione e registrazione', () => {
  it('editor: previsione registrata con modello, revisione, hash, provenienza, mediana e 21 quantili', async () => {
    const f = okFetch();
    const out = await proxyForecast(deps(ids.dave, f.impl), request({}, 24, 2));
    expect(f.calls).toHaveLength(1);
    // al servizio arrivano solo i campi dello schema (limiti fisici decisi dal server), con il token di servizio
    expect(Object.keys(f.calls[0]!.body).sort()).toEqual(['context', 'frequency', 'model', 'physical_bounds', 'prediction_length', 'revision', 'schema_version']);
    expect(f.calls[0]!.body.physical_bounds).toEqual([null, [0, 100]]);
    expect(f.calls[0]!.headers.authorization).toBe('Bearer token-di-servizio-di-prova');
    await actAs(db, 'superuser');
    const [run] = await rows('select status, model_version_id, input_hash, lineage, started_by, data_class, inference_ms from forecast_runs where id = $1', [out.run_id]);
    expect(run).toMatchObject({ status: 'completata', model_version_id: `${M5}@${PROXY_MODELS[M5]}`, started_by: ids.dave, data_class: 'STIMATO_DA_MODELLO', inference_ms: 120 });
    expect(String(run!.input_hash)).toHaveLength(64);
    expect(run!.lineage).toMatchObject({ source: 'Open-Meteo (Edge Function)', variable: 'temperatura_aria,umidita_relativa', model: M5, revision: PROXY_MODELS[M5] });
    const series = await rows('select s.variable, s.unit, cardinality(s.timestamps) n, (select count(*) from forecast_quantiles q where q.series_id = s.id)::int q from forecast_series s where run_id = $1 order by variable', [out.run_id]);
    expect(series).toEqual([
      { variable: 'temperatura_aria', unit: '°C', n: 24, q: 21 },
      { variable: 'umidita_relativa', unit: '%', n: 24, q: 21 },
    ]);
  });

  it('lettore: non può avviare previsioni (403), nessuna chiamata al servizio', async () => {
    const f = okFetch();
    await expect(proxyForecast(deps(ids.carol, f.impl), request())).rejects.toMatchObject({ status: 403 });
    expect(f.calls).toHaveLength(0);
  });

  it('esterno: il progetto di un’altra organizzazione non esiste per lui (404)', async () => {
    const f = okFetch();
    await expect(proxyForecast(deps(ids.bob, f.impl), request())).rejects.toMatchObject({ status: 404 });
    expect(f.calls).toHaveLength(0);
  });

  it('esterno: non vede esecuzioni, serie né quantili dell’organizzazione', async () => {
    await actAs(db, { id: ids.bob });
    expect(await rows('select id from forecast_runs')).toHaveLength(0);
    expect(await rows('select id from forecast_series')).toHaveLength(0);
    await actAs(db, { id: ids.carol });
    expect((await rows('select id from forecast_runs')).length).toBeGreaterThan(0);
  });

  it('un client non registra un’esecuzione Timestral né la spaccia per reale', async () => {
    await actAs(db, { id: ids.dave });
    await expect(
      db.query(`insert into forecast_runs (organization_id, project_id, model_version_id, context, horizon, issued_at, input_hash, data_class, lineage) values ($1, $2, $3, 'urbano', 24, now(), 'h', 'STIMATO_DA_MODELLO', '{"source":"x","period":{},"variable":"t"}')`, [orgA, pid, `${M5}@${PROXY_MODELS[M5]}`]),
    ).rejects.toThrow(/solo dal servizio/);
  });

  it('esecuzioni concluse immutabili', async () => {
    await actAs(db, 'service');
    const [r] = await rows(`select id from forecast_runs where status = 'completata' limit 1`);
    await expect(db.query(`update forecast_runs set status = 'errore' where id = $1`, [r!.id])).rejects.toThrow(/conclusa/);
    await expect(db.query(`update forecast_series set median = '{1}' where run_id = $1`, [r!.id])).rejects.toThrow(/immutabile/);
  });
});

describe('Proxy Timestral — servizio assente o risposte non valide', () => {
  it('servizio non configurato: 503 con messaggio semplice, esecuzione chiusa in errore', async () => {
    const before = await countRuns('completata');
    const err = await proxyForecast(deps(ids.dave, undefined, { serviceUrl: null }), request()).catch((e) => e);
    expect(err).toBeInstanceOf(ProxyError);
    expect(err).toMatchObject({ status: 503, message: 'Il modello avanzato non è disponibile. Puoi continuare con la previsione di base.' });
    expect(await countRuns('completata')).toBe(before); // nessun risultato valido toccato
  });

  it('timeout del servizio → 504, esecuzione in errore', async () => {
    const f = fakeFetch(() => ({ status: 200, delayMs: 5_000 }));
    await expect(proxyForecast(deps(ids.dave, f.impl, { timeoutMs: 50 }), request())).rejects.toMatchObject({ status: 504 });
    await actAs(db, 'superuser');
    const [last] = await rows(`select status, error from forecast_runs order by created_at desc limit 1`);
    expect(last).toMatchObject({ status: 'errore' });
  });

  it.each([
    ['quantili incrociati', (o: Record<string, unknown>) => ((o.quantiles as number[][][][])[0]![0]![3]![5] = -999), /incrociati/],
    ['revisione diversa', (o: Record<string, unknown>) => (o.revision = 'deadbeef'), /revisione/],
    ['valori non finiti', (o: Record<string, unknown>) => ((o.median as number[][][])[0]![0]![0] = null as unknown as number), /non finiti/],
    ['orizzonte diverso', (o: Record<string, unknown>) => ((o.quantiles as number[][][][])[0]![0]!.pop()), /orizzonte|forma/],
    ['livelli inattesi', (o: Record<string, unknown>) => (o.quantile_levels = [0.1, 0.5, 0.9]), /livelli/],
  ])('risposta non valida (%s) → 502, nulla di registrato come completato', async (_n, mutate, msg) => {
    const before = await countRuns('completata');
    const f = fakeFetch((body) => ({ status: 200, body: serviceResponse(body as unknown as ProxyRequest, mutate) }));
    // orologio spostato in avanti: la finestra del limite di frequenza riparte per ogni caso
    const now = () => new Date(Date.now() + 86_400_000 * ++clockShift);
    await expect(proxyForecast(deps(ids.dave, f.impl, { now }), request())).rejects.toMatchObject({ status: 502, message: expect.stringMatching(msg) });
    expect(await countRuns('completata')).toBe(before);
  });

  it.each([
    ['revisione errata', { revision: 'deadbeef' }],
    ['modello non ammesso', { model: 'altro/modello' }],
    ['storico troppo corto', { context: [[Array.from({ length: 24 }, () => 20)]] }],
    ['valori non numerici', { context: [[[...Array.from({ length: 95 }, () => 20), 'x' as unknown as number]]] }],
  ])('richiesta non valida (%s) → 422 prima di registrare', async (_n, over) => {
    const before = await countRuns();
    const f = okFetch();
    await expect(proxyForecast(deps(ids.dave, f.impl), request(over as Partial<ProxyRequest>))).rejects.toMatchObject({ status: 422 });
    expect(f.calls).toHaveLength(0);
    expect(await countRuns()).toBe(before);
  });

  it('limite di frequenza: oltre 5 previsioni avanzate in 10 minuti per utente e progetto → 429', async () => {
    const f = okFetch();
    let status = 200;
    for (let i = 0; i < 8 && status === 200; i++) {
      status = await proxyForecast(deps(ids.dave, f.impl), request({ prediction_length: 12 + i })).then(
        () => 200,
        (e: ProxyError) => e.status,
      );
    }
    expect(status).toBe(429);
  });
});

describe('Proxy Timestral — vincolo fisico dell’umidità (physical_clipping_v1)', () => {
  const humReq = (H: number) => {
    const r = request({ prediction_length: H }, H, 2);
    r.mdt.variables = [{ name: 'temperature_2m', unit: '°C' }, { name: 'relative_humidity_2m', unit: '%' }];
    return r;
  };
  const later = () => new Date(Date.now() + 86_400_000 * ++clockShift);

  it.each([24, 48, 72])('orizzonte %i h: umidità entro 0–100, metadati di provenienza registrati, temperatura non vincolata', async (H) => {
    const f = fakeFetch((body) => ({ status: 200, body: serviceResponse(body as never, undefined, 90) }));
    const out = await proxyForecast(deps(ids.dave, f.impl, { now: later }), humReq(H));
    expect(f.calls[0]!.body.physical_bounds).toEqual([null, [0, 100]]);
    await actAs(db, 'superuser');
    const [run] = await rows('select lineage from forecast_runs where id = $1', [out.run_id]);
    const pc = (run!.lineage as { physical_constraints: Record<string, Record<string, unknown>>; adapter_version: string }).physical_constraints;
    expect(Object.keys(pc)).toEqual(['relative_humidity_2m']); // nessuna voce per la temperatura
    expect(pc.relative_humidity_2m).toMatchObject({ physical_constraint_applied: true, physical_min: 0, physical_max: 100, method: 'physical_clipping_v1', adapter_version: 'mdt-forecasting 0.2.0', model: M5, revision: PROXY_MODELS[M5] });
    expect(Number(pc.relative_humidity_2m!.adjusted_values_count)).toBeGreaterThan(0);
    expect(Number(pc.relative_humidity_2m!.maximum_raw_value)).toBeGreaterThan(100);
    const q = await rows(`select q."values" v from forecast_quantiles q join forecast_series s on s.id = q.series_id where s.run_id = $1 and s.variable = 'relative_humidity_2m'`, [out.run_id]);
    const all = q.flatMap((r) => r.v as number[]);
    expect(Math.max(...all)).toBeLessThanOrEqual(100);
    expect(Math.min(...all)).toBeGreaterThanOrEqual(0);
    const t = await rows(`select q."values" v from forecast_quantiles q join forecast_series s on s.id = q.series_id where s.run_id = $1 and s.variable = 'temperature_2m'`, [out.run_id]);
    expect(Math.max(...t.flatMap((r) => r.v as number[]))).toBeGreaterThan(100); // valori della temperatura del test: mai tagliati
  });

  it('il proxy rifiuta una risposta in cui l’umidità resta fuori dai limiti (servizio senza vincolo)', async () => {
    const before = await countRuns('completata');
    const f = fakeFetch((body) => ({ status: 200, body: serviceResponse(body as never, undefined, 90, false) }));
    await expect(proxyForecast(deps(ids.dave, f.impl, { now: later }), humReq(24))).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/fuori dai limiti fisici/) });
    expect(await countRuns('completata')).toBe(before);
  });

  it('il proxy rifiuta una risposta senza vincolo dichiarato per l’umidità', async () => {
    const f = fakeFetch((body) => ({ status: 200, body: serviceResponse(body as never, (o) => (o.constraints = [null, null]), 50) }));
    await expect(proxyForecast(deps(ids.dave, f.impl, { now: later }), humReq(24))).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/non dichiarato/) });
  });

  it('nessun limite inviato né metadato registrato per variabili che non lo richiedono', async () => {
    const f = okFetch();
    const out = await proxyForecast(deps(ids.dave, f.impl, { now: later }), request());
    expect(f.calls[0]!.body.physical_bounds).toBeUndefined();
    await actAs(db, 'superuser');
    const [run] = await rows('select lineage from forecast_runs where id = $1', [out.run_id]);
    expect((run!.lineage as { physical_constraints: object }).physical_constraints).toEqual({});
  });

  it('il browser non può imporre limiti: un campo physical_bounds del client viene scartato', async () => {
    const f = okFetch();
    const r = { ...request(), physical_bounds: [[-1000, 1000]] } as unknown as ProxyRequest;
    await proxyForecast(deps(ids.dave, f.impl, { now: later }), r);
    expect(f.calls[0]!.body.physical_bounds).toBeUndefined();
  });
});

async function countRuns(status?: string): Promise<number> {
  await actAs(db, 'superuser');
  const r = await rows(status ? 'select count(*)::int n from forecast_runs where status = $1' : 'select count(*)::int n from forecast_runs', status ? [status] : []);
  return Number(r[0]!.n);
}
