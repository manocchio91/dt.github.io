// Backtest walk-forward delle previsioni: baseline sempre, Timestral solo se il servizio è configurato.
// Uso: npx vite-node scripts/backtest.ts
//   FORECAST_SERVICE_URL e FORECAST_SERVICE_TOKEN (opzionali, da ambiente locale) abilitano Timestral.
// Scrive packages/domain/src/forecast/data/backtest_summary.json e docs/reports/backtest-previsioni-<data>.md
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  BACKTEST_CASES,
  caseConfig,
  NaivePersistenceAdapter,
  runBacktest,
  SeasonalNaiveAdapter,
  TimestralForecastAdapter,
  type BacktestMetrics,
  type TimeSeriesForecastAdapter,
} from '../packages/domain/src/index';

const url = process.env.FORECAST_SERVICE_URL;
const token = process.env.FORECAST_SERVICE_TOKEN;
const adapters: TimeSeriesForecastAdapter[] = [new NaivePersistenceAdapter(), new SeasonalNaiveAdapter()];
const timestralModels = ['mistralai/Timestral-5M', 'mistralai/Timestral-28M'] as const;
// FORECAST_MODELS sceglie i modelli da eseguire (predefinito: solo il 5M); gli altri restano "non avviati"
const wanted = new Set((process.env.FORECAST_MODELS ?? 'mistralai/Timestral-5M').split(',').map((m) => m.trim()));
if (url && token) for (const m of timestralModels) if (wanted.has(m)) adapters.push(new TimestralForecastAdapter({ baseUrl: url, model: m, authorization: `Bearer ${token}`, timeoutMs: 120_000 }));

interface CaseSummary {
  id: string;
  context: string;
  label: string;
  variable: string;
  unit: string;
  horizon: number;
  period: { from: string; to: string };
  alertNote: string;
  results: BacktestMetrics[];
  notRun: { adapter: string; reason: string }[];
}

const summary: { generatedAt: string; protocol: string; dataSource: string; cases: CaseSummary[] } = {
  generatedAt: new Date().toISOString().slice(0, 10),
  protocol: 'Walk-forward con origini giornaliere; storico minimo 14 giorni, contesto 28 giorni; covariate note: solo calendario; nessun dato successivo all’origine nell’input.',
  dataSource: 'Rianalisi Open-Meteo (ERA5/ERA5-Land, CC BY 4.0): stime da modello su cella di griglia, non misure in campo.',
  cases: [],
};

for (const c of BACKTEST_CASES) {
  const cfg = caseConfig(c);
  const results: BacktestMetrics[] = [];
  const notRun: CaseSummary['notRun'] = [];
  for (const a of adapters) {
    try {
      results.push((await runBacktest(cfg, a)).metrics);
    } catch (e) {
      notRun.push({ adapter: a.meta.id, reason: (e as Error).message });
    }
  }
  if (!(url && token)) for (const m of timestralModels) notRun.push({ adapter: m, reason: 'Motore Timestral non configurato (servizio non disponibile in questo ambiente)' });
  else for (const m of timestralModels) if (!wanted.has(m)) notRun.push({ adapter: m, reason: 'non avviato: opzione di confronto successiva (FORECAST_MODELS)' });
  summary.cases.push({ id: c.id, context: c.context, label: c.label, variable: c.variable, unit: cfg.series.unit, horizon: c.horizon, period: { from: cfg.series.timestamps[0]!, to: cfg.series.timestamps.at(-1)! }, alertNote: c.alert.note, results, notRun });
  console.log(c.id, results.map((r) => `${r.adapter}: MAE ${r.mae} MASE ${r.mase} WQL ${r.wql} cop80 ${r.coverage80}`).join(' | '));
}

writeFileSync('packages/domain/src/forecast/data/backtest_summary.json', JSON.stringify(summary, null, 1) + '\n');

const fmt = (x: number) => (Number.isFinite(x) ? x.toLocaleString('it-IT', { maximumFractionDigits: 3 }) : '—');
const lines: string[] = [
  `# Backtest delle previsioni — ${summary.generatedAt}`,
  '',
  `**Protocollo.** ${summary.protocol}`,
  '',
  `**Dati.** ${summary.dataSource}`,
  '',
  'Nota: per serie molto lisce (umidità del suolo) l’errore della persistenza stagionale sullo storico è minimo, quindi il MASE risulta molto alto anche con MAE piccolo: per confrontare i modelli su queste serie usare MAE, WQL e copertura.',
  '',
  'Metriche: MAE della mediana (unità della variabile), MASE (rispetto all’errore della persistenza a un passo sullo storico iniziale), pinball medio e WQL sui 21 quantili, copertura empirica degli intervalli 80% (q0,10–q0,90) e 98% (q0,01–q0,99), confusione degli avvisi rispetto alla soglia dimostrativa.',
  '',
];
for (const c of summary.cases) {
  lines.push(`## ${c.label}`, '', `Contesto: **${c.context}** · variabile \`${c.variable}\` (${c.unit}) · periodo ${c.period.from.slice(0, 10)} → ${c.period.to.slice(0, 10)} · ${c.alertNote}.`, '');
  lines.push('| Modello | Origini | MAE | MASE | Pinball medio | WQL | Copertura 80% | Copertura 98% | Veri positivi | Falsi allarmi | Criticità mancate |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of c.results) lines.push(`| ${r.name} | ${r.origins} | ${fmt(r.mae)} | ${fmt(r.mase)} | ${fmt(r.meanPinball)} | ${fmt(r.wql)} | ${fmt(r.coverage80)} | ${fmt(r.coverage98)} | ${r.alerts?.veriPositivi ?? '—'} | ${r.alerts?.falsiAllarmi ?? '—'} | ${r.alerts?.criticitaMancate ?? '—'} |`);
  for (const n of c.notRun) lines.push(`| ${n.adapter} | non eseguito | ${n.reason} | | | | | | | | |`);
  lines.push('');
}
lines.push(
  '## Esito',
  '',
  url && token
    ? 'Timestral è stato confrontato con le baseline sugli stessi tagli temporali. Resta **Beta** finché non supera le baseline su MAE/WQL e copertura, per ciascun contesto separatamente, e non è validato con utenti ed esperti.'
    : 'Timestral **non è stato eseguito**: resta **Beta da validare**. Le baseline sono il riferimento minimo che un modello deve superare. I benchmark pubblici di Mistral non sono usati come prova di efficacia sul Molise.',
  '',
);
mkdirSync('docs/reports', { recursive: true });
const out = `docs/reports/backtest-previsioni-${summary.generatedAt}.md`;
writeFileSync(out, lines.join('\n'));
console.log('scritto', out);
