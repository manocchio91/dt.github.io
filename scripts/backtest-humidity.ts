// Backtest dell'umidità relativa: Timestral-5M grezzo contro lo stesso output con il vincolo fisico
// 0–100% (physical_clipping_v1), sulle stesse origini walk-forward della rianalisi urbana.
// Il vincolo migliora la plausibilità fisica ma può alterare la calibrazione degli intervalli:
// il confronto serve a misurarlo, non a dichiarare un miglioramento del modello.
// Uso: FORECAST_SERVICE_URL=http://127.0.0.1:8080 FORECAST_SERVICE_TOKEN=... npx vite-node scripts/backtest-humidity.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { backtestOrigins, coverage, mae, QUANTILE_LEVELS, URBAN_DATASET, wql } from '../packages/domain/src/index';

const url = process.env.FORECAST_SERVICE_URL;
const token = process.env.FORECAST_SERVICE_TOKEN;
if (!url || !token) throw new Error('FORECAST_SERVICE_URL e FORECAST_SERVICE_TOKEN richiesti (servizio locale).');
const M5 = 'mistralai/Timestral-5M';
const REV = 'bdd20cfc15a3fea0e4cb5ccef37f8d3ca7aa335f';
const series = URBAN_DATASET.series('umidita_relativa');

async function forecast(context: (number | null)[], H: number, bounded: boolean) {
  const r = await fetch(`${url}/v1/forecast`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ schema_version: 1, model: M5, revision: REV, frequency: '1h', prediction_length: H, context: [[context]], ...(bounded ? { physical_bounds: [[0, 100]] } : {}) }),
  });
  if (!r.ok) throw new Error(`servizio ${r.status}`);
  return (await r.json()) as { quantiles: number[][][][]; median: number[][][]; constraints: ({ adjusted_values_count: number; total_values: number; maximum_raw_value: number; minimum_raw_value: number } | null)[] };
}

const rows: string[] = [];
const summary: Record<string, unknown>[] = [];
for (const H of [24, 48, 72]) {
  const cfg = { series, horizon: H, step: 24, minContext: 24 * 14, maxContext: 24 * 28 };
  const origins = backtestOrigins(cfg);
  const acc = { raw: { q: [] as number[][], m: [] as number[], y: [] as (number | null)[] }, clip: { q: [] as number[][], m: [] as number[], y: [] as (number | null)[] } };
  let adjusted = 0, total = 0, originsAdjusted = 0, medianAdjusted = 0, maxRaw = -Infinity, minRaw = Infinity, outRaw = 0, at100 = 0, medianOut = 0, crossed = 0;
  for (const o of origins) {
    const start = Math.max(0, o - cfg.maxContext);
    const ctx = series.values.slice(start, o);
    const y = series.values.slice(o, o + H);
    const raw = await forecast(ctx, H, false);
    const cl = await forecast(ctx, H, true);
    const rq = raw.quantiles[0]![0]!, cq = cl.quantiles[0]![0]!;
    acc.raw.q.push(...rq); acc.raw.m.push(...raw.median[0]![0]!); acc.raw.y.push(...y);
    acc.clip.q.push(...cq); acc.clip.m.push(...cl.median[0]![0]!); acc.clip.y.push(...y);
    const c = cl.constraints[0]!;
    adjusted += c.adjusted_values_count; total += c.total_values;
    if (c.adjusted_values_count > 0) originsAdjusted++;
    medianAdjusted += raw.median[0]![0]!.filter((x) => x > 100 || x < 0).length;
    maxRaw = Math.max(maxRaw, c.maximum_raw_value); minRaw = Math.min(minRaw, c.minimum_raw_value);
    outRaw += rq.flat().filter((x) => x > 100 || x < 0).length;
    at100 += cq.flat().filter((x) => x === 100).length;
    medianOut += cl.median[0]![0]!.filter((x) => x < 0 || x > 100).length;
    crossed += cq.filter((row) => row.some((x, i) => i > 0 && x < row[i - 1]! - 1e-9)).length;
  }
  const m = (k: 'raw' | 'clip') => ({ mae: mae(acc[k].m, acc[k].y).value, wql: wql(acc[k].q, acc[k].y, QUANTILE_LEVELS), cov80: coverage(acc[k].q, acc[k].y, 0.1, 0.9, QUANTILE_LEVELS).value });
  const r = m('raw'), c = m('clip');
  summary.push({ horizon: H, origins: origins.length, raw: r, clipped: c, adjusted, total, adjustedPct: (100 * adjusted) / total, originsAdjusted, originsAdjustedPct: (100 * originsAdjusted) / origins.length, rawMedianOutOfRange: medianAdjusted, outOfRangeRaw: outRaw, maxRaw, minRaw, quantilesAt100Pct: (100 * at100) / total, medianOutOfRange: medianOut, crossedRows: crossed });
  const f = (x: number, d = 3) => x.toLocaleString('it-IT', { maximumFractionDigits: d });
  rows.push(`| ${H} h | ${origins.length} | ${f(r.mae)} → ${f(c.mae)} | ${f(r.wql, 4)} → ${f(c.wql, 4)} | ${f(r.cov80, 3)} → ${f(c.cov80, 3)} | ${adjusted} / ${total} (${f((100 * adjusted) / total, 2)}%) | ${f(maxRaw, 1)} % | ${f((100 * at100) / total, 2)}% | ${medianOut} | ${crossed} | ${originsAdjusted} / ${origins.length} (${f((100 * originsAdjusted) / origins.length, 1)}%) |`);
  console.log(`h=${H}: origini ${origins.length}, MAE ${r.mae.toFixed(3)}→${c.mae.toFixed(3)}, WQL ${r.wql.toFixed(4)}→${c.wql.toFixed(4)}, cop80 ${r.cov80.toFixed(3)}→${c.cov80.toFixed(3)}, corretti ${adjusted}/${total} (${((100 * adjusted) / total).toFixed(2)}%), max grezzo ${maxRaw.toFixed(1)}, quantili a 100 ${((100 * at100) / total).toFixed(2)}%, mediane fuori ${medianOut}, righe incrociate ${crossed}, previsioni con almeno un valore corretto ${originsAdjusted}/${origins.length}, mediane grezze fuori ${medianAdjusted}`);
}
const day = new Date().toISOString().slice(0, 10);
mkdirSync('docs/reports', { recursive: true });
writeFileSync(`docs/reports/backtest-umidita-vincolo-${day}.md`, [
  `# Umidità relativa — Timestral-5M grezzo e con vincolo fisico 0–100% (${day})`, '',
  `**Dati.** ${URBAN_DATASET.meta.title} — ${URBAN_DATASET.meta.source} (rianalisi: stime da modello su cella di griglia, non misure).`, '',
  '**Protocollo.** Walk-forward con origini giornaliere, storico minimo 14 giorni, contesto massimo 28 giorni; stesse origini e stesso input per il risultato grezzo e per quello vincolato (physical_clipping_v1).', '',
  '| Orizzonte | Origini | MAE (%) grezzo → vincolato | WQL grezzo → vincolato | Copertura 80% grezzo → vincolato | Valori corretti | Massimo grezzo | Quantili esattamente a 100% | Mediane fuori 0–100 | Righe di quantili incrociate | Previsioni con almeno un valore corretto |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows, '',
  'Il vincolo **migliora la plausibilità fisica** (nessun valore oltre 100% o sotto 0%) ma **può alterare la calibrazione** degli intervalli probabilistici: i quantili tagliati si accumulano sul limite. Le differenze di MAE, WQL e copertura qui riportate non sono un miglioramento scientifico del modello.', '',
  'Soluzione da valutare con storico più lungo (backlog): trasformazione limitata dell’umidità prima della previsione (logit/sigmoide) confrontata con questo vincolo successivo.', '',
].join('\n'));
writeFileSync('docs/reports/backtest-umidita-vincolo.json', JSON.stringify({ generatedAt: day, model: `${M5}@${REV}`, method: 'physical_clipping_v1', summary }, null, 1) + '\n');
console.log(`scritto docs/reports/backtest-umidita-vincolo-${day}.md`);
