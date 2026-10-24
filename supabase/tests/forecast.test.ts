import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { hashOf, QUANTILE_LEVELS, seedCampobasso } from '@mdt/domain';
import { actAs, createAuthUser, createDb } from './harness';

const ids = {
  alice: '00000000-0000-4000-8000-00000000a11c', // admin A
  dave: '00000000-0000-4000-8000-00000000da7e', // editor A
  carol: '00000000-0000-4000-8000-0000000ca201', // viewer A
  bob: '00000000-0000-4000-8000-000000000b0b', // admin B
};
const T5 = 'mistralai/Timestral-5M@bdd20cfc15a3fea0e4cb5ccef37f8d3ca7aa335f';
const SEASONAL = 'baseline-persistenza-stagionale@n/a';
const lineage = { source: 'Open-Meteo ERA5', period: { from: '2025-06-01', to: '2025-08-31' }, variable: 'temperatura_aria' };

let db: PGlite;
let orgA: string;
let orgB: string;
let pid: string;

const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
const rows = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

async function insertRun(model: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await one<{ id: string }>(
    `insert into forecast_runs (organization_id, project_id, model_version_id, context, horizon, issued_at, input_hash, data_class, lineage, started_by)
     values ($1, $2, $3, 'urbano', 24, '2025-08-31T23:00:00Z', 'h1', $4, $5, $6) returning id`,
    [extra.org ?? orgA, pid, model, extra.dataClass ?? 'STIMATO_DA_MODELLO', JSON.stringify(lineage), extra.startedBy ?? null],
  );
  return r.id;
}

async function insertOutput(run: string, h = 3) {
  const ts = Array.from({ length: h }, (_, i) => new Date(Date.parse('2025-09-01T00:00:00Z') + i * 3_600_000).toISOString());
  const s = await one<{ id: string }>(`insert into forecast_series (run_id, variable, unit, timestamps, median) values ($1, 'temperatura_aria', '°C', $2, $3) returning id`, [run, ts, ts.map(() => 20)]);
  for (const l of QUANTILE_LEVELS) await db.query(`insert into forecast_quantiles (series_id, level, "values") values ($1, $2, $3)`, [s.id, l, ts.map(() => 20 + l)]);
  return s.id;
}

beforeAll(async () => {
  db = await createDb();
  for (const [k, email] of [['alice', 'alice@a.it'], ['dave', 'dave@a.it'], ['carol', 'carol@a.it'], ['bob', 'bob@b.it']] as const) await createAuthUser(db, ids[k], email);
  await actAs(db, { id: ids.alice });
  orgA = (await one<{ id: string }>(`select public.create_organization('Comune A') as id`)).id;
  await db.query(`select public.add_member_by_email($1, 'dave@a.it', 'editor')`, [orgA]);
  await db.query(`select public.add_member_by_email($1, 'carol@a.it', 'viewer')`, [orgA]);
  const b = seedCampobasso(new Date('2026-10-24T08:00:00Z'));
  pid = b.project.id;
  await db.query('select public.save_project($1, $2, $3, 0)', [orgA, JSON.stringify(b), hashOf(b)]);
  await actAs(db, { id: ids.bob });
  orgB = (await one<{ id: string }>(`select public.create_organization('Comune B') as id`)).id;
}, 180_000);

describe('F31 — catalogo dei modelli', () => {
  it('leggibile dagli utenti, con revisione bloccata; scrivibile solo dal servizio', async () => {
    await actAs(db, { id: ids.carol });
    const m = await rows(`select id, kind, status, license_code, license_weights from forecast_model_versions where kind = 'timestral' order by id`);
    expect(m).toEqual([
      { id: 'mistralai/Timestral-28M@49b26409ac87b5935539a5d8ffe7f397b720db47', kind: 'timestral', status: 'beta', license_code: 'Apache-2.0', license_weights: 'Modified MIT' },
      { id: T5, kind: 'timestral', status: 'beta', license_code: 'Apache-2.0', license_weights: 'Modified MIT' },
    ]);
    await actAs(db, { id: ids.alice });
    await expect(db.query(`update forecast_model_versions set status = 'validato' where id = $1`, [T5])).resolves.toMatchObject({ affectedRows: 0 });
    await expect(db.query(`insert into forecast_model_versions (id, model, revision, kind, license_code) values ('x', 'x', 'x', 'timestral', 'x')`)).rejects.toThrow();
  });
});

describe('F31 — esecuzioni e output', () => {
  it('un editor registra una baseline; il viewer la legge, non la scrive', async () => {
    await actAs(db, { id: ids.dave });
    const run = await insertRun(SEASONAL);
    await insertOutput(run);
    await db.query(`update forecast_runs set status = 'completata', inference_ms = 3 where id = $1`, [run]);
    const r = await one<{ status: string; started_by: string; completed_at: string | null }>('select status, started_by, completed_at from forecast_runs where id = $1', [run]);
    expect(r.status).toBe('completata');
    expect(r.started_by).toBe(ids.dave);
    expect(r.completed_at).not.toBeNull();
    await actAs(db, { id: ids.carol });
    expect(await rows(`select level from forecast_quantiles q join forecast_series s on s.id = q.series_id where s.run_id = $1`, [run])).toHaveLength(21);
    await expect(insertRun(SEASONAL)).rejects.toThrow();
  });

  it('un client non può registrare come Timestral valori calcolati altrove', async () => {
    await actAs(db, { id: ids.alice });
    await expect(insertRun(T5)).rejects.toThrow(/solo dal servizio/);
  });

  it('il servizio registra un’esecuzione Timestral; l’editor non ne altera output né stato', async () => {
    await actAs(db, 'service');
    const run = await insertRun(T5, { startedBy: ids.dave });
    await insertOutput(run);
    await actAs(db, { id: ids.dave });
    await expect(db.query(`update forecast_runs set status = 'errore' where id = $1`, [run])).rejects.toThrow(/solo dal servizio/);
    await actAs(db, 'service');
    await db.query(`update forecast_runs set status = 'completata' where id = $1`, [run]);
    await actAs(db, { id: ids.carol });
    expect((await one<{ model_version_id: string }>('select model_version_id from forecast_runs where id = $1', [run])).model_version_id).toBe(T5);
  });

  it('esecuzione immutabile: lineage, input e output non si modificano dopo la registrazione', async () => {
    await actAs(db, { id: ids.dave });
    const run = await insertRun(SEASONAL);
    const sid = await insertOutput(run);
    await expect(db.query(`update forecast_runs set lineage = '{"source":"x","period":{},"variable":"y"}' where id = $1`, [run])).rejects.toThrow(/immutabile/);
    // nessuna policy di modifica: l'aggiornamento non tocca righe; anche il servizio è bloccato dal trigger
    await expect(db.query(`update forecast_series set median = '{1,2,3}' where id = $1`, [sid])).resolves.toMatchObject({ affectedRows: 0 });
    await actAs(db, 'service');
    await expect(db.query(`update forecast_series set median = '{1,2,3}' where id = $1`, [sid])).rejects.toThrow(/immutabile/);
    await actAs(db, { id: ids.dave });
    await db.query(`update forecast_runs set status = 'completata' where id = $1`, [run]);
    await expect(db.query(`update forecast_runs set warnings = '{"x"}' where id = $1`, [run])).rejects.toThrow(/conclusa/);
    await expect(insertOutput(run)).rejects.toThrow(/conclusa/);
  });

  it('classe del dato coerente: niente SIMULATO per modelli reali; lineage obbligatoria; 21 livelli soltanto', async () => {
    await actAs(db, { id: ids.dave });
    await expect(insertRun(SEASONAL, { dataClass: 'SIMULATO' })).rejects.toThrow(/incoerente/);
    await expect(
      db.query(`insert into forecast_runs (organization_id, project_id, model_version_id, context, horizon, issued_at, input_hash, data_class, lineage) values ($1, $2, $3, 'urbano', 24, now(), 'h', 'STIMATO_DA_MODELLO', '{}')`, [orgA, pid, SEASONAL]),
    ).rejects.toThrow();
    const run = await insertRun(SEASONAL);
    const sid = (await one<{ id: string }>(`insert into forecast_series (run_id, variable, unit, timestamps, median) values ($1, 'v', 'u', '{2025-09-01T00:00:00Z}', '{1}') returning id`, [run])).id;
    await expect(db.query(`insert into forecast_quantiles (series_id, level, "values") values ($1, 0.42, '{1}')`, [sid])).rejects.toThrow();
  });

  it('isolamento tra organizzazioni', async () => {
    await actAs(db, { id: ids.bob });
    expect(await rows('select id from forecast_runs')).toEqual([]);
    expect(await rows('select series_id from forecast_quantiles')).toEqual([]);
    await expect(insertRun(SEASONAL)).rejects.toThrow();
    await expect(insertRun(SEASONAL, { org: orgB })).rejects.toThrow();
  });
});

describe('F31 — soglie degli esperti, avvisi e verifica ex-post', () => {
  let thr: string;
  let run: string;

  it('soglia firmata con ruolo esperto; versionata, non sovrascritta', async () => {
    await actAs(db, { id: ids.dave });
    thr = (await one<{ id: string }>(
      `insert into forecast_thresholds (organization_id, project_id, context, zone, variable, unit, threshold, direction, min_probability, expert_role, rationale, set_by)
       values ($1, $2, 'agricolo', 'Parcella nord', 'umidita_suolo', 'm³/m³', 0.16, 'sotto', 0.5, 'agronomo', 'Soglia di intervento concordata in campo', $3) returning id`,
      [orgA, pid, ids.alice],
    )).id;
    expect((await one<{ set_by: string }>('select set_by from forecast_thresholds where id = $1', [thr])).set_by).toBe(ids.dave);
    await expect(db.query('update forecast_thresholds set threshold = 0.2 where id = $1', [thr])).rejects.toThrow(/versionate/);
    const v2 = (await one<{ id: string }>(
      `insert into forecast_thresholds (organization_id, project_id, context, zone, variable, unit, threshold, direction, min_probability, expert_role, rationale, set_by)
       values ($1, $2, 'agricolo', 'Parcella nord', 'umidita_suolo', 'm³/m³', 0.17, 'sotto', 0.5, 'agronomo', 'Revisione dopo il sopralluogo', $3) returning id`,
      [orgA, pid, ids.dave],
    )).id;
    await db.query('update forecast_thresholds set superseded_by = $2 where id = $1', [thr, v2]);
    await expect(db.query('update forecast_thresholds set superseded_by = null where id = $1', [thr])).rejects.toThrow(/versionate/);
    thr = v2;
    await actAs(db, { id: ids.carol });
    await expect(db.query(`insert into forecast_thresholds (organization_id, project_id, context, variable, unit, threshold, direction, min_probability, expert_role, rationale, set_by) values ($1, $2, 'urbano', 'x', 'u', 1, 'sopra', 0.5, 'x', 'motivazione lunga', $3)`, [orgA, pid, ids.carol])).rejects.toThrow();
  });

  it('avviso aperto, poi verificato in campo; solo stato ed ex-post modificabili', async () => {
    await actAs(db, { id: ids.dave });
    run = await insertRun(SEASONAL);
    const a = (await one<{ id: string }>(
      `insert into forecast_alerts (organization_id, run_id, threshold_id, zone, first_exceedance, probability) values ($1, $2, $3, 'Parcella nord', '2025-09-02T12:00:00Z', 0.62) returning id`,
      [orgA, run, thr],
    )).id;
    await expect(db.query('update forecast_alerts set probability = 0.9 where id = $1', [a])).rejects.toThrow(/ex-post/);
    await db.query(`update forecast_alerts set status = 'verificato_in_campo', observed_value = 0.151, observed_at = '2025-09-02T13:00:00Z', review_note = 'sonda in campo' where id = $1`, [a]);
    const r = await one<{ status: string; reviewed_by: string }>('select status, reviewed_by from forecast_alerts where id = $1', [a]);
    expect(r).toEqual({ status: 'verificato_in_campo', reviewed_by: ids.dave });
    await actAs(db, { id: ids.bob });
    expect(await rows('select id from forecast_alerts')).toEqual([]);
  });

  it('audit di esecuzioni, soglie, avvisi e backtest, leggibile dall’admin', async () => {
    await actAs(db, { id: ids.dave });
    await db.query(
      `insert into forecast_backtests (organization_id, case_id, context, model_version_id, variable, horizon, protocol, period, metrics) values ($1, 'urbano-temperatura-24h', 'urbano', $2, 'temperatura_aria', 24, 'walk-forward', '{}', '{"mae":1.7}')`,
      [orgA, SEASONAL],
    );
    await actAs(db, { id: ids.alice });
    const ent = await rows(`select distinct entity from audit_logs where organization_id = $1 and entity like 'forecast%' order by entity`, [orgA]);
    expect(ent.map((e) => (e as { entity: string }).entity)).toEqual(['forecast_alerts', 'forecast_backtests', 'forecast_runs', 'forecast_thresholds']);
    const alert = await one<{ details: Record<string, unknown> }>(`select details from audit_logs where entity = 'forecast_alerts' and action = 'update' order by id desc limit 1`);
    expect(alert.details).toEqual({ status: 'verificato_in_campo', observed_value: 0.151 });
    await actAs(db, { id: ids.carol });
    expect(await rows(`select id from audit_logs where entity like 'forecast%'`)).toEqual([]);
  });
});
