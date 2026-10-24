import { useEffect, useMemo, useState } from 'react';
import {
  BACKTEST_CASES,
  BACKTEST_SUMMARY as backtestSummary,
  buildForecastRecord,
  evaluateThreshold,
  expostComparison,
  FORECAST_BANDS,
  FORECAST_TEXT,
  ForecastUnavailableError,
  forecastLineage,
  MEDIAN_INDEX,
  newId,
  requestAtOrigin,
  soilMoistureThreshold,
  URBAN_DATASET,
  VINEYARD_DATASET,
  type BacktestConfig,
  type ExpertThreshold,
  type ForecastBand,
  type ForecastRecord,
  type ForecastResult,
  type ProjectBundle,
} from '@mdt/domain';
import { Alert, Section, StatusBadge } from '../components/ui';
import { formatNumber } from '../components/DataBadge';
import { ForecastChart } from '../components/ForecastChart';
import { ProjectMissing, useProject } from '../state/useProject';
import { usePermissions } from '../state/permissions';
import { useAuth } from '../state/auth';
import { fmtDay, fmtHour, forecastServiceUrl, makeAdapter, MODEL_CHOICES, VARIABLE_LABEL, type ModelChoice } from '../state/forecast';

const CONTEXT_DAYS = 28;
const MIN_DAYS = 14;
const HISTORY_SHOWN = 72;

type RunState = { status: 'idle' | 'loading' } | { status: 'ok'; result: ForecastResult } | { status: 'unavailable'; message: string } | { status: 'error'; message: string };

export default function ForecastPage() {
  const { bundle, ready, update } = useProject();
  if (!bundle) return <ProjectMissing ready={ready} />;
  return <ForecastView key={bundle.project.id} bundle={bundle} update={update} />;
}

function ForecastView({ bundle, update }: { bundle: ProjectBundle; update: ReturnType<typeof useProject>['update'] }) {
  const { canEdit } = usePermissions();
  const { session } = useAuth();
  const urban = bundle.project.sector !== 'agriculture';
  const context = urban ? 'urbano' : 'agricolo';
  const dataset = urban ? URBAN_DATASET : VINEYARD_DATASET;
  const variables = urban ? ['temperatura_aria', 'umidita_relativa'] : ['umidita_suolo', 'temperatura_aria'];
  const horizons = urban ? [24, 48] : [48, 72];

  const [variable, setVariable] = useState(variables[0]!);
  const [horizon, setHorizon] = useState(horizons[urban ? 0 : 1]!);
  const [model, setModel] = useState<ModelChoice>('baseline-persistenza-stagionale');
  const [band, setBand] = useState<ForecastBand>('80');
  const [showObserved, setShowObserved] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const series = useMemo(() => dataset.series(variable), [dataset, variable]);
  const cfg: BacktestConfig = useMemo(() => ({ series, horizon, step: 24, minContext: 24 * MIN_DAYS, maxContext: 24 * CONTEXT_DAYS }), [series, horizon]);
  const origins = useMemo(() => {
    const out: number[] = [];
    for (let o = cfg.minContext; o + horizon <= series.values.length; o += 24) out.push(o);
    return out;
  }, [cfg.minContext, horizon, series.values.length]);
  const [originIdx, setOriginIdx] = useState<number | null>(null);
  const origin = originIdx !== null && origins.includes(originIdx) ? originIdx : origins.at(-1)!;

  const defaultThreshold = (): ExpertThreshold => {
    if (variable === 'temperatura_aria') return { value: urban ? 32 : (bundle.agri?.setup.heatThresholdC ?? 35), direction: 'sopra', minProbability: 0.3, expertRole: urban ? 'tecnico comunale' : 'agronomo', rationale: 'Soglia dimostrativa di caldo intenso, da confermare' };
    if (variable === 'umidita_relativa') return { value: 30, direction: 'sotto', minProbability: 0.5, expertRole: 'tecnico comunale', rationale: 'Soglia dimostrativa di aria secca, da confermare' };
    return { value: 0.16, direction: 'sotto', minProbability: 0.5, expertRole: 'agronomo', rationale: 'Soglia dimostrativa di umidità bassa, da sostituire con quella dell’agronomo' };
  };
  const [threshold, setThreshold] = useState<ExpertThreshold>(defaultThreshold);
  const [depletion, setDepletion] = useState(0.3);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setThreshold(defaultThreshold()), [variable]);

  const request = useMemo(() => requestAtOrigin(cfg, origin), [cfg, origin]);
  const [run, setRun] = useState<RunState>({ status: 'idle' });
  const [baselines, setBaselines] = useState<ForecastResult[]>([]);
  const token = session?.access_token ?? null;

  useEffect(() => {
    let alive = true;
    setRun({ status: 'loading' });
    makeAdapter(model, { token: async () => token })
      .forecast(request)
      .then((result) => alive && setRun({ status: 'ok', result }))
      .catch((e: Error) => alive && setRun(e instanceof ForecastUnavailableError ? { status: 'unavailable', message: e.message } : { status: 'error', message: e.message }));
    Promise.all((['baseline-persistenza-stagionale', 'baseline-persistenza'] as const).map((m) => makeAdapter(m).forecast(request))).then((r) => alive && setBaselines(r));
    return () => {
      alive = false;
    };
  }, [model, request, token]);

  const result = run.status === 'ok' ? run.result : null;
  const b = FORECAST_BANDS[band];
  const q = result?.quantiles[0];
  const observed = series.values.slice(origin, origin + horizon);
  const finding = result ? evaluateThreshold(result, threshold) : null;
  const chartForecast = q && result ? { timestamps: result.timestamps, median: q.map((r) => r[MEDIAN_INDEX]!), lower: q.map((r) => r[b.lo]!), upper: q.map((r) => r[b.hi]!), probabilities: finding?.probabilities } : null;
  const history = { timestamps: series.timestamps.slice(origin - HISTORY_SHOWN, origin), values: series.values.slice(origin - HISTORY_SHOWN, origin) };
  const issuedAt = series.timestamps[origin - 1]!;
  const isTimestral = MODEL_CHOICES.find((m) => m.id === model)!.timestral;
  const lineage = forecastLineage(dataset, request.targets[0]!, result?.model ?? { id: model, revision: '—', status: 'beta' }, {
    covariates: request.knownCovariates.map((c) => `${c.name} (${c.kind})`),
    horizon,
    startedBy: session?.user.email ?? 'utente locale',
    executedAt: new Date().toISOString(),
  });
  const btCase = BACKTEST_CASES.find((c) => c.context === context && c.variable === variable && c.horizon === horizon);
  const btSummary = btCase ? backtestSummary.cases.find((c) => c.id === btCase.id) : undefined;
  const zones = !urban && variable === 'umidita_suolo' ? (bundle.agri?.zones ?? []) : [];
  const records = bundle.forecasts ?? [];

  const save = async () => {
    if (!result) return;
    const rec = buildForecastRecord({ id: newId(), now: new Date(), context, result, variable, unit: series.unit, band, thresholds: [threshold], lineage, note: urban ? FORECAST_TEXT.urban : FORECAST_TEXT.agri });
    await update((x) => ({ ...x, forecasts: [...(x.forecasts ?? []), rec] }), { action: 'previsione', detail: `${result.model.name}: ${VARIABLE_LABEL[variable] ?? variable}, ${horizon} h dalle ${fmtHour(rec.issuedAt)}` });
    setMsg('Previsione registrata nel progetto: compare nell’export del dossier.');
  };

  const addExpost = async (rec: ForecastRecord) => {
    const s = (rec.context === 'urbano' ? URBAN_DATASET : VINEYARD_DATASET).series(rec.variable);
    const t0 = Date.parse(rec.timestamps[0]!);
    const start = s.timestamps.findIndex((t) => Date.parse(t) === t0);
    if (start < 0) return setMsg('Osservazione successiva non disponibile per questa previsione.');
    const obs = s.values.slice(start, start + rec.timestamps.length);
    const cmp = expostComparison(rec, obs, `${s.variable} — ${(rec.context === 'urbano' ? URBAN_DATASET : VINEYARD_DATASET).meta.source}`, new Date());
    await update((x) => ({ ...x, forecasts: (x.forecasts ?? []).map((r) => (r.id === rec.id ? { ...r, expost: cmp } : r)) }), { action: 'verifica previsione', detail: `Confronto ex-post: MAE ${cmp.mae ?? 'n.d.'} ${rec.unit}` });
  };

  const mae = (r: ForecastResult) => {
    const med = r.quantiles[0]!.map((x) => x[MEDIAN_INDEX]!);
    const pairs = med.map((m, i) => [m, observed[i]] as const).filter(([, o]) => typeof o === 'number');
    return pairs.length ? pairs.reduce((s, [m, o]) => s + Math.abs((o as number) - m), 0) / pairs.length : null;
  };

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-extrabold text-petrol-900">Previsioni</h1>
          <StatusBadge status="beta" />
        </div>
        <p className="text-sm">
          Previsione probabilistica oraria {urban ? 'nell’area urbana' : 'per il vigneto'}: una <strong>stima da modello</strong>, non una misura. Ogni ora ha una mediana e un intervallo; la decisione resta umana.
        </p>
        <Alert tone="warn" title={urban ? 'Che cosa non dice questa previsione' : 'Avvertenza obbligatoria'}>
          <p>{urban ? FORECAST_TEXT.urban : FORECAST_TEXT.agri}</p>
        </Alert>
      </header>

      <Section id="impostazioni" title="Impostazioni">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block text-sm font-semibold">
            Grandezza
            <select className="input mt-1" value={variable} onChange={(e) => setVariable(e.target.value)}>
              {variables.map((v) => (
                <option key={v} value={v}>
                  {VARIABLE_LABEL[v] ?? v}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Orizzonte
            <select className="input mt-1" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
              {horizons.map((h) => (
                <option key={h} value={h}>
                  {h} ore
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Modello
            <select className="input mt-1" value={model} onChange={(e) => setModel(e.target.value as ModelChoice)}>
              {MODEL_CHOICES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Emissione (“ora”)
            <select className="input mt-1" value={origin} onChange={(e) => setOriginIdx(Number(e.target.value))}>
              {origins.map((o) => (
                <option key={o} value={o}>
                  {fmtDay(series.timestamps[o - 1]!)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Intervallo mostrato
            <select className="input mt-1" value={band} onChange={(e) => setBand(e.target.value as ForecastBand)}>
              {(Object.keys(FORECAST_BANDS) as ForecastBand[]).map((k) => (
                <option key={k} value={k}>
                  {FORECAST_BANDS[k].label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 self-end text-sm font-semibold">
            <input type="checkbox" className="size-5" checked={showObserved} onChange={(e) => setShowObserved(e.target.checked)} />
            Mostra l’osservazione successiva (confronto ex-post)
          </label>
        </div>
        <p className="text-xs text-sand-600">
          Dati: {dataset.meta.title} — {dataset.meta.source}, cella {dataset.meta.gridCell.lat.toFixed(3)}, {dataset.meta.gridCell.lon.toFixed(3)}. {dataset.meta.note} Le emissioni disponibili sono nel passato, così ogni previsione si può confrontare con quanto accaduto dopo.
        </p>
      </Section>

      <Section
        id="previsione"
        title={`${VARIABLE_LABEL[variable] ?? variable}: prossime ${horizon} ore`}
        aside={
          result ? (
            <span
              data-testid="forecast-badge"
              className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-bold ${result.dataClass === 'SIMULATO' ? 'border-ochre-800 bg-ochre-100 text-ochre-800' : 'border-petrol-700 bg-petrol-100 text-petrol-900'}`}
            >
              <span aria-hidden="true">{result.dataClass === 'SIMULATO' ? '◇' : '≈'}</span>
              {result.dataClass === 'SIMULATO' ? 'SIMULATO' : 'STIMATO DA MODELLO'} — {result.model.kind === 'timestral' ? `${result.model.name} [${result.model.revision.slice(0, 7)}]` : result.model.name}
            </span>
          ) : null
        }
      >
        {run.status === 'unavailable' && (
          <Alert tone="warn" title={FORECAST_TEXT.notConfigured}>
            <p>
              {run.message !== FORECAST_TEXT.notConfigured && <>{run.message}. </>}Il servizio di inferenza Timestral non è raggiungibile da questa installazione, quindi non viene mostrata alcuna previsione Timestral e nessun valore viene sostituito. Le baseline restano disponibili.
            </p>
          </Alert>
        )}
        {run.status === 'error' && <Alert tone="error" title="Previsione non disponibile">{run.message}</Alert>}
        {run.status === 'loading' && <p className="text-sm">Calcolo in corso…</p>}
        <ForecastChart
          title={`Storico e previsione di ${VARIABLE_LABEL[variable] ?? variable}`}
          unit={series.unit}
          history={history}
          forecast={chartForecast}
          observed={showObserved ? observed : null}
          threshold={{ value: threshold.value, label: `${threshold.direction} ${formatNumber(threshold.value, series.unit)}` }}
          bandLabel={b.label}
        />
        {result && finding && (
          <div className="rounded-lg border border-sand-200 p-3 text-sm" data-testid="threshold-finding">
            {finding.flagged ? (
              <p>
                <strong>Soglia raggiunta nella previsione</strong>: probabilità di valori {threshold.direction} {formatNumber(threshold.value, series.unit)} pari al {Math.round(finding.maxProbability * 100)}% (massimo), oltre il
                minimo del {Math.round(threshold.minProbability * 100)}% dalle {fmtHour(finding.firstAt!)}. Da verificare {urban ? 'sul posto' : 'in campo'} prima di decidere.
              </p>
            ) : (
              <p>
                Probabilità massima di valori {threshold.direction} {formatNumber(threshold.value, series.unit)}: {Math.round(finding.maxProbability * 100)}%, sotto il minimo indicato ({Math.round(threshold.minProbability * 100)}%).
              </p>
            )}
            <p className="mt-1 text-xs text-sand-600">La probabilità è letta dai 21 quantili previsti: non è una “affidabilità” del modello.</p>
          </div>
        )}
        {chartForecast && (
          <details className="rounded-lg border border-sand-200 p-2">
            <summary className="cursor-pointer text-sm font-semibold">Tabella dei valori (alternativa al grafico)</summary>
            <div className="mt-2 max-h-96 overflow-auto">
              <table className="table-base text-sm">
                <caption className="sr-only">Valori previsti ora per ora</caption>
                <thead>
                  <tr>
                    <th scope="col">Ora (Europe/Rome)</th>
                    <th scope="col">Mediana</th>
                    <th scope="col">{b.label}</th>
                    <th scope="col">Prob. soglia</th>
                    {showObserved && <th scope="col">Osservato dopo</th>}
                  </tr>
                </thead>
                <tbody>
                  {chartForecast.timestamps.map((t, i) => (
                    <tr key={t}>
                      <th scope="row" className="font-normal whitespace-nowrap">
                        {fmtHour(t)}
                      </th>
                      <td className="tabular-nums">{formatNumber(chartForecast.median[i]!, series.unit)}</td>
                      <td className="tabular-nums">
                        {formatNumber(chartForecast.lower[i]!, '')} … {formatNumber(chartForecast.upper[i]!, series.unit)}
                      </td>
                      <td className="tabular-nums">{Math.round((chartForecast.probabilities?.[i] ?? 0) * 100)}%</td>
                      {showObserved && <td className="tabular-nums">{observed[i] == null ? 'n.d.' : formatNumber(observed[i]!, series.unit)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </Section>

      <Section id="soglia" title={urban ? 'Soglia dell’esperto' : 'Soglie dell’agronomo'}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm font-semibold">
            Valore soglia ({series.unit})
            <input className="input mt-1" type="number" step="any" value={threshold.value} onChange={(e) => setThreshold({ ...threshold, value: Number(e.target.value) })} />
          </label>
          <label className="block text-sm font-semibold">
            Direzione
            <select className="input mt-1" value={threshold.direction} onChange={(e) => setThreshold({ ...threshold, direction: e.target.value as 'sopra' | 'sotto' })}>
              <option value="sopra">sopra la soglia</option>
              <option value="sotto">sotto la soglia</option>
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Probabilità minima per segnalare (%)
            <input className="input mt-1" type="number" min={1} max={99} value={Math.round(threshold.minProbability * 100)} onChange={(e) => setThreshold({ ...threshold, minProbability: Math.min(0.99, Math.max(0.01, Number(e.target.value) / 100)) })} />
          </label>
          <label className="block text-sm font-semibold">
            Ruolo di chi fissa la soglia
            <input className="input mt-1" value={threshold.expertRole} onChange={(e) => setThreshold({ ...threshold, expertRole: e.target.value })} />
          </label>
        </div>
        <label className="block text-sm font-semibold">
          Motivazione
          <input className="input mt-1" value={threshold.rationale} onChange={(e) => setThreshold({ ...threshold, rationale: e.target.value })} />
        </label>
        {zones.length > 0 && result && (
          <div className="space-y-2">
            <label className="block max-w-xs text-sm font-semibold">
              Frazione di acqua disponibile già consumata che fa scattare l’attenzione
              <input className="input mt-1" type="number" step={0.05} min={0.1} max={0.9} value={depletion} onChange={(e) => setDepletion(Number(e.target.value))} />
            </label>
            <p className="text-xs text-sand-600">Soglia di zona = punto di appassimento + frazione × (capacità di campo − punto di appassimento). La previsione è la stessa per tutto il vigneto (una cella di rianalisi): le zone cambiano solo per la soglia.</p>
            <div className="overflow-x-auto">
              <table className="table-base text-sm" data-testid="zone-table">
                <caption className="sr-only">Zone segnalate rispetto alle soglie agronomiche</caption>
                <thead>
                  <tr>
                    <th scope="col">Zona</th>
                    <th scope="col">Soglia (m³/m³)</th>
                    <th scope="col">Prob. massima sotto soglia</th>
                    <th scope="col">Esito</th>
                  </tr>
                </thead>
                <tbody>
                  {zones.map((z) => {
                    const thr = soilMoistureThreshold(z.fieldCapacity, z.wiltingPoint, depletion);
                    const f = thr === null ? null : evaluateThreshold(result, { value: thr, direction: 'sotto', minProbability: threshold.minProbability });
                    return (
                      <tr key={z.id}>
                        <th scope="row">{z.name}</th>
                        <td className="tabular-nums">{thr === null ? 'manca capacità di campo o appassimento' : formatNumber(thr, '')}</td>
                        <td className="tabular-nums">{f ? `${Math.round(f.maxProbability * 100)}%` : '—'}</td>
                        <td>{f === null ? 'non determinabile' : f.flagged ? `▲ da verificare in campo (dalle ${fmtHour(f.firstAt!)})` : '▽ sotto il minimo di probabilità'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      <Section id="confronto" title="Confronto con le baseline">
        <p className="text-sm">Un modello è utile solo se fa meglio delle baseline sugli stessi dati. Qui il confronto sui tagli storici (backtest) e, se mostri l’osservazione, su questa emissione.</p>
        {btSummary ? (
          <div className="overflow-x-auto">
            <table className="table-base text-sm" data-testid="backtest-table">
              <caption className="text-left text-xs text-sand-600">
                Backtest walk-forward ({btSummary.results[0]?.origins ?? 0} emissioni, {btSummary.period.from.slice(0, 10)} → {btSummary.period.to.slice(0, 10)}): {backtestSummary.protocol}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Modello</th>
                  <th scope="col">Errore medio (MAE)</th>
                  <th scope="col">WQL</th>
                  <th scope="col">Copertura 80%</th>
                  <th scope="col">Falsi allarmi</th>
                  <th scope="col">Criticità mancate</th>
                </tr>
              </thead>
              <tbody>
                {btSummary.results.map((r) => (
                  <tr key={r.adapter}>
                    <th scope="row">{r.name}</th>
                    <td className="tabular-nums">{formatNumber(r.mae, btSummary.unit)}</td>
                    <td className="tabular-nums">{formatNumber(r.wql, '')}</td>
                    <td className="tabular-nums">{Math.round(r.coverage80 * 100)}% (atteso 80%)</td>
                    <td className="tabular-nums">{r.alerts?.falsiAllarmi ?? '—'}</td>
                    <td className="tabular-nums">{r.alerts?.criticitaMancate ?? '—'}</td>
                  </tr>
                ))}
                {btSummary.notRun.map((n) => (
                  <tr key={n.adapter}>
                    <th scope="row">{n.adapter}</th>
                    <td colSpan={5}>non eseguito — {n.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm">Backtest non ancora eseguito per questa combinazione di grandezza e orizzonte.</p>
        )}
        {showObserved && (
          <ul className="text-sm" data-testid="expost-now">
            {[...(result && isTimestral ? [result] : []), ...baselines].map((r) => {
              const m = mae(r);
              return (
                <li key={r.model.id}>
                  {r.model.name}: errore medio su questa emissione {m === null ? 'n.d.' : formatNumber(m, series.unit)}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section id="modello" title="Modello, dati e provenienza">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
          <dt className="font-semibold text-sand-600">Modello</dt>
          <dd>{result ? `${result.model.name} — versione ${result.model.version}, revisione ${result.model.revision}` : MODEL_CHOICES.find((m) => m.id === model)!.label}</dd>
          <dt className="font-semibold text-sand-600">Stato</dt>
          <dd>{isTimestral ? (forecastServiceUrl() ? 'Beta da validare — servizio configurato' : `Beta da validare — ${FORECAST_TEXT.notConfigured}`) : 'Baseline statistica di riferimento'}</dd>
          <dt className="font-semibold text-sand-600">Licenza</dt>
          <dd>{result?.model.license ?? (isTimestral ? 'Codice: Apache-2.0 · Pesi: Modified MIT (Hugging Face)' : 'codice del progetto')}</dd>
          <dt className="font-semibold text-sand-600">Emissione (“ora”)</dt>
          <dd>{fmtDay(issuedAt)} (ultimo dato dello storico)</dd>
          <dt className="font-semibold text-sand-600">Dati in ingresso</dt>
          <dd>
            {lineage.source}, {lineage.period.from.slice(0, 16)} → {lineage.period.to.slice(0, 16)} UTC, {request.targets[0]!.values.length} ore, mancanti {lineage.missingPct}%
          </dd>
          <dt className="font-semibold text-sand-600">Covariate note</dt>
          <dd>{lineage.covariates.join(', ') || 'nessuna'}</dd>
          <dt className="font-semibold text-sand-600">Licenza dei dati</dt>
          <dd>{lineage.license}</dd>
          {result && (
            <>
              <dt className="font-semibold text-sand-600">Impronta dell’input</dt>
              <dd className="font-mono text-xs break-all">{result.inputHash}</dd>
              <dt className="font-semibold text-sand-600">Tempo di calcolo</dt>
              <dd>{result.inferenceMs} ms</dd>
            </>
          )}
          <dt className="font-semibold text-sand-600">Avvertenze</dt>
          <dd>
            <ul className="list-disc pl-5">
              {(result?.warnings ?? []).map((w) => (
                <li key={w}>{w}</li>
              ))}
              {lineage.qaFlags.map((w) => (
                <li key={w}>{w}</li>
              ))}
              {(result?.model.limitations ?? []).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </dd>
        </dl>
      </Section>

      <Section id="registro" title="Previsioni registrate e verifica ex-post">
        {msg && <Alert tone="ok">{msg}</Alert>}
        {canEdit ? (
          <button type="button" className="btn-primary" disabled={!result} onClick={save}>
            Registra questa previsione nel progetto
          </button>
        ) : (
          <p className="text-sm">Il tuo ruolo consente la consultazione: la registrazione è riservata a chi modifica il progetto.</p>
        )}
        {records.length === 0 ? (
          <p className="text-sm">Nessuna previsione registrata.</p>
        ) : (
          <ul className="space-y-2" data-testid="forecast-records">
            {records.map((r) => (
              <li key={r.id} className="rounded-lg border border-sand-200 p-3 text-sm">
                <p className="font-semibold">
                  {r.model.name} · {VARIABLE_LABEL[r.variable] ?? r.variable} · {r.horizon} h dalle {fmtHour(r.issuedAt)}
                </p>
                <p className="text-xs text-sand-600">
                  {FORECAST_BANDS[r.band].label} · soglia {r.thresholds[0] ? `${r.thresholds[0].direction} ${formatNumber(r.thresholds[0].value, r.unit)} (${r.thresholds[0].expertRole}): ${r.thresholds[0].flagged ? 'segnalata' : 'non segnalata'}` : 'nessuna'}
                </p>
                {r.expost ? (
                  <p>
                    Confronto ex-post: errore medio {r.expost.mae === null ? 'n.d.' : formatNumber(r.expost.mae, r.unit)}; osservazioni dentro l’intervallo {r.expost.insideBand === null ? 'n.d.' : `${Math.round(r.expost.insideBand * 100)}%`} ({r.expost.points} ore).
                  </p>
                ) : (
                  canEdit && (
                    <button type="button" className="btn-secondary mt-1" onClick={() => addExpost(r)}>
                      Confronta con l’osservazione successiva
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
