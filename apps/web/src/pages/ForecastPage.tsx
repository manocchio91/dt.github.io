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
  type ForecastRequest,
  type ForecastResult,
  type ProjectBundle,
  type WeatherInputProvenance,
} from '@mdt/domain';
import { Alert, Section, StatusBadge } from '../components/ui';
import { formatNumber } from '../components/DataBadge';
import { ForecastChart } from '../components/ForecastChart';
import { SourceBadge } from '../components/SourceBadge';
import { useWorkMode } from '../state/preferences';
import { PathGuide } from '../components/guide';
import { ProjectMissing, useProject } from '../state/useProject';
import { usePermissions } from '../state/permissions';
import { useAuth } from '../state/auth';
import { useStore } from '../state/store';
import { fmtDay, fmtHour, forecastServiceUrl, makeAdapter, MODEL_CHOICES, VARIABLE_LABEL, type ModelChoice } from '../state/forecast';
import { listLocations, loadHistoryStatus, loadTimestralInput } from '../state/weather';

const CONTEXT_DAYS = 28;
const MIN_DAYS = 14;
const HISTORY_SHOWN = 72;

/** Nella modalità guidata: due scelte con parole semplici; nomi e versioni dei modelli restano nei dettagli tecnici. */
const GUIDED_MODEL_LABEL: Partial<Record<ModelChoice, string>> = {
  'baseline-persistenza-stagionale': 'Previsione di base',
  'mistralai/Timestral-5M': 'Timestral-5M',
};

export const ADVANCED_UNAVAILABLE = { title: 'Il modello avanzato non è disponibile.', text: 'Puoi continuare con la previsione di base.' };
/** Servizio configurato ma spento o non raggiungibile in questo momento. */
export const ADVANCED_DOWN = { title: 'Il modello avanzato non è disponibile.', text: 'Puoi continuare con la previsione di base.' };
/** Archivio collegato ma storico meteo sotto il minimo: il modello avanzato non parte. */
export const HISTORY_TOO_SHORT = { title: 'Storico non ancora sufficiente per il modello avanzato.', text: 'Puoi continuare con la previsione di base.' };
const HISTORY_SHORT_MARK = 'storico-insufficiente';
/** Grandezze della pagina → variabili Open-Meteo dello storico salvato. */
const OM_VARIABLE: Record<string, string> = { temperatura_aria: 'temperature_2m', umidita_relativa: 'relative_humidity_2m', umidita_suolo: 'soil_moisture_9_to_27cm' };
type LiveInput =
  | { status: 'off' | 'loading' }
  | { status: 'short'; hours: number; target: number }
  | { status: 'ready'; locationId: string; request: ForecastRequest; provenance: WeatherInputProvenance }
  | { status: 'error'; message: string };
export const HUMIDITY_CLIPPED_NOTE = 'L’intervallo è stato riportato entro i limiti fisici dell’umidità, da 0% a 100%.';

const BAND_PLAIN: Record<ForecastBand, string> = { '80': '8 casi su 10', '90': '9 casi su 10', '98': '98 casi su 100' };

type RunState = { status: 'idle' | 'loading' } | { status: 'ok'; result: ForecastResult } | { status: 'unavailable'; message: string } | { status: 'error'; message: string };

export default function ForecastPage() {
  const { bundle, ready, update } = useProject();
  if (!bundle) return <ProjectMissing ready={ready} />;
  return <ForecastView key={bundle.project.id} bundle={bundle} update={update} />;
}

function ForecastView({ bundle, update }: { bundle: ProjectBundle; update: ReturnType<typeof useProject>['update'] }) {
  const { canEdit } = usePermissions();
  const technical = useWorkMode() === 'tecnica';
  const { session, client } = useAuth();
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
  const [timestralRequested, setTimestralRequested] = useState(0);
  const [baselines, setBaselines] = useState<ForecastResult[]>([]);
  const token = session?.access_token ?? null;
  const { kind } = useStore();
  // il modello avanzato passa dal proxy autenticato: serve un progetto dell'organizzazione (archivio condiviso)
  const connected = kind === 'supabase' && !!token;
  const isTimestralChoice = MODEL_CHOICES.find((m) => m.id === model)?.timestral ?? false;

  // con l'archivio dell'organizzazione il modello avanzato legge lo storico Open-Meteo salvato su Supabase
  // (mai un secondo storico scaricato da Open-Meteo) e parte solo se lo storico è sufficiente
  const useHistory = connected && !!client && !!forecastServiceUrl();
  const [live, setLive] = useState<LiveInput>({ status: 'off' });
  useEffect(() => {
    if (!useHistory || !client) {
      setLive({ status: 'off' });
      return;
    }
    let alive = true;
    setLive({ status: 'loading' });
    (async () => {
      const locs = await listLocations(client, bundle.project.id);
      if (!locs[0]) return { status: 'short', hours: 0, target: 168 } as LiveInput;
      const h = await loadHistoryStatus(client, locs[0].id);
      if (!h?.sufficiente_timestral) return { status: 'short', hours: h?.ore_finestra ?? 0, target: h?.ore_obiettivo ?? 168 } as LiveInput;
      const { request: req, provenance } = await loadTimestralInput(client, locs[0].id, OM_VARIABLE[variable]!, horizon);
      return { status: 'ready', locationId: locs[0].id, request: req, provenance } as LiveInput;
    })()
      .then((x) => alive && setLive(x))
      .catch((e: Error) => alive && setLive({ status: 'error', message: e.message }));
    return () => {
      alive = false;
    };
  }, [useHistory, client, bundle.project.id, variable, horizon]);
  const liveRequest = live.status === 'ready' ? live.request : null;
  const effectiveRequest = liveRequest ?? request;

  useEffect(() => {
    let alive = true;
    if (isTimestralChoice && timestralRequested === 0) {
      setRun({ status: 'idle' });
      return;
    }
    setRun({ status: 'loading' });
    if (isTimestralChoice && useHistory) {
      if (live.status === 'loading' || live.status === 'off') return;
      if (live.status === 'short') {
        setRun({ status: 'unavailable', message: HISTORY_SHORT_MARK });
        return;
      }
      if (live.status === 'error') {
        setRun({ status: 'error', message: live.message });
        return;
      }
    }
    const envelope = (req: typeof request) => ({
      project_id: bundle.project.id,
      context,
      variables: req.targets.map((t) => ({ name: t.variable, unit: t.unit })),
      issued_at: req.targets[0]!.timestamps.at(-1)!,
      ...(live.status === 'ready'
        ? {
            location_id: live.locationId,
            lineage: {
              source: 'Open-Meteo, storico salvato su Supabase (dato territoriale modellato, non rilevato da sensore locale)',
              period: { from: live.provenance.contextFrom, to: live.provenance.contextTo },
              target_source: live.provenance.targetSource,
              covariates: `previsione Open-Meteo emessa ${live.provenance.forecastIssuedAt}`,
            },
          }
        : { lineage: { source: `${dataset.meta.title} — ${dataset.meta.source}`, period: { from: req.targets[0]!.timestamps[0]!, to: req.targets[0]!.timestamps.at(-1)! } } }),
    });
    makeAdapter(model, { token: async () => token, ...(connected ? { envelope } : { baseUrl: null }) })
      .forecast(effectiveRequest)
      .then((result) => alive && setRun({ status: 'ok', result }))
      .catch((e: Error) => alive && setRun(e instanceof ForecastUnavailableError ? { status: 'unavailable', message: e.message } : { status: 'error', message: e.message }));
    Promise.all((['baseline-persistenza-stagionale', 'baseline-persistenza'] as const).map((m) => makeAdapter(m).forecast(request))).then((r) => alive && setBaselines(r));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, request, token, connected, live, isTimestralChoice, timestralRequested, useHistory]);

  const result = run.status === 'ok' ? run.result : null;
  const b = FORECAST_BANDS[band];
  const q = result?.quantiles[0];
  // previsione sullo storico reale: le osservazioni successive non esistono ancora
  const observed = liveRequest ? [] : series.values.slice(origin, origin + horizon);
  const finding = result ? evaluateThreshold(result, threshold) : null;
  const chartForecast = q && result ? { timestamps: result.timestamps, median: q.map((r) => r[MEDIAN_INDEX]!), lower: q.map((r) => r[b.lo]!), upper: q.map((r) => r[b.hi]!), probabilities: finding?.probabilities } : null;
  const liveTarget = liveRequest?.targets[0];
  const history = liveTarget
    ? { timestamps: liveTarget.timestamps.slice(-HISTORY_SHOWN), values: liveTarget.values.slice(-HISTORY_SHOWN) }
    : { timestamps: series.timestamps.slice(origin - HISTORY_SHOWN, origin), values: series.values.slice(origin - HISTORY_SHOWN, origin) };
  const issuedAt = liveTarget ? liveTarget.timestamps.at(-1)! : series.timestamps[origin - 1]!;
  const isTimestral = MODEL_CHOICES.find((m) => m.id === model)?.timestral ?? false;
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

  const advancedAvailable = connected && !!forecastServiceUrl();
  const visibleModels = MODEL_CHOICES.filter((m) => !m.timestral || advancedAvailable || m.id === model);
  const guidedModels = visibleModels.filter((m) => GUIDED_MODEL_LABEL[m.id]);
  const modelOptions = technical ? visibleModels.map((m) => ({ id: m.id, label: m.label })) : guidedModels.map((m) => ({ id: m.id, label: GUIDED_MODEL_LABEL[m.id]! }));
  if (!modelOptions.some((m) => m.id === model)) modelOptions.push({ id: model, label: MODEL_CHOICES.find((m) => m.id === model)!.label });
  // badge: il nome Timestral compare solo per un risultato prodotto davvero dal modello
  const modelPlain = result?.model.kind === 'timestral' ? result.model.name : isTimestral ? 'modello avanzato (Beta)' : 'previsione di base';
  const constraint = result?.model.kind === 'timestral' ? (result.constraints?.[0] ?? null) : null;
  const unavailableText = run.status === 'unavailable' && run.message === HISTORY_SHORT_MARK ? HISTORY_TOO_SHORT : connected && forecastServiceUrl() ? ADVANCED_DOWN : ADVANCED_UNAVAILABLE;
  const peak = chartForecast ? peakIndex(chartForecast.median, threshold.direction) : -1;

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-extrabold text-petrol-900">Previsioni</h1>
          <StatusBadge status="beta" />
        </div>
        <p className="text-sm">
          {liveRequest
            ? `Che cosa potrebbe accadere nelle prossime ${horizon} ore ${urban ? 'nell’area urbana' : 'nel vigneto'}.`
            : `Caso dimostrativo: ${horizon} ore successive nel periodo storico ${series.timestamps[origin]!.slice(0, 10)}–${series.timestamps[origin + horizon - 1]!.slice(0, 10)}.`}{' '}
          È una <strong>stima da modello</strong>, non una misura: la decisione resta umana.
        </p>
        <Alert tone="warn" title={urban ? 'Che cosa non dice questa previsione' : 'Avvertenza obbligatoria'}>
          <p>{urban ? FORECAST_TEXT.urban : FORECAST_TEXT.agri}</p>
        </Alert>
      </header>
      <PathGuide
        where={{
          step: 4,
          what: liveRequest
            ? (urban ? 'quanto potrebbe salire la temperatura nelle prossime ore e con quale probabilità supera la soglia.' : 'come potrebbero cambiare umidità del suolo e temperatura e con quale probabilità superano la soglia dell’agronomo.')
            : 'come si comporta la previsione nel caso dimostrativo storico selezionato.',
          why: 'sapere in anticipo quando potrebbe esserci una criticità aiuta a verificarla in tempo.',
          next: urban ? { label: 'confronta gli scenari e registra la decisione', to: `/progetti/${bundle.project.id}/confronto` } : { label: 'torna alle zone da controllare nel Decision Lab', to: `/progetti/${bundle.project.id}/agricolo` },
        }}
      />

      {result && finding && chartForecast && peak >= 0 && (
        <section aria-labelledby="sintesi-h" className="card space-y-2" data-testid="forecast-summary">
          <h2 id="sintesi-h" className="h-section">
            In sintesi
          </h2>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[14rem_1fr]">
            <dt className="font-semibold text-sand-600">Che cosa potrebbe accadere</dt>
            <dd>
              {finding.flagged
                ? `Possibile superamento della soglia: ${VARIABLE_LABEL[variable]?.toLowerCase() ?? variable} ${threshold.direction} ${formatNumber(threshold.value, series.unit)}.`
                : `Nessun superamento della soglia (${threshold.direction} ${formatNumber(threshold.value, series.unit)}) atteso con la probabilità indicata.`}
            </dd>
            <dt className="font-semibold text-sand-600">Quando</dt>
            <dd>{finding.flagged ? `dalle ${fmtHour(finding.firstAt!)}` : `valore più ${threshold.direction === 'sopra' ? 'alto' : 'basso'} atteso ${fmtHour(chartForecast.timestamps[peak]!)}`}</dd>
            <dt className="font-semibold text-sand-600">Valore centrale stimato</dt>
            <dd className="tabular-nums">
              {formatNumber(chartForecast.median[peak]!, series.unit)} ({fmtHour(chartForecast.timestamps[peak]!)})
            </dd>
            <dt className="font-semibold text-sand-600">Fascia di possibile variazione</dt>
            <dd className="tabular-nums">
              {rangeText(chartForecast.lower[peak]!, chartForecast.upper[peak]!, series.unit)} ({BAND_PLAIN[band]})
            </dd>
            <dt className="font-semibold text-sand-600">Probabilità di superare la soglia</dt>
            <dd className="tabular-nums">{Math.round(finding.maxProbability * 100)}% al massimo</dd>
            <dt className="font-semibold text-sand-600">Fonte della previsione</dt>
            <dd>
              {isTimestral ? 'Modello avanzato (Beta)' : 'Previsione di base'} calcolata sui dati storici Open-Meteo {liveRequest ? 'salvati per quest’area' : 'dell’area'}
            </dd>
          </dl>
          <p className="rounded bg-petrol-100 p-2 text-sm text-petrol-900">
            <strong>Verifica consigliata:</strong>{' '}
            {finding.flagged
              ? urban
                ? 'controlla sul posto le aree più frequentate prima di decidere.'
                : 'controlla in campo le zone segnalate o consulta l’agronomo prima di intervenire.'
              : urban
                ? 'nessuna urgenza, puoi proseguire con gli scenari del Decision Lab.'
                : 'nessuna urgenza, prosegui con le zone da controllare nel Decision Lab.'}
          </p>
        </section>
      )}

      <Section id="impostazioni" title="Che cosa vuoi prevedere">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm font-semibold">
            Grandezza
            <select className="input mt-1" value={variable} onChange={(e) => { setVariable(e.target.value); setTimestralRequested(0); }}>
              {variables.map((v) => (
                <option key={v} value={v}>
                  {VARIABLE_LABEL[v] ?? v}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Orizzonte
            <select className="input mt-1" value={horizon} onChange={(e) => { setHorizon(Number(e.target.value)); setTimestralRequested(0); }}>
              {horizons.map((h) => (
                <option key={h} value={h}>
                  {h} ore
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Modello
            <select className="input mt-1" value={model} onChange={(e) => { setModel(e.target.value as ModelChoice); setTimestralRequested(0); }}>
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {advancedAvailable && <p className="text-sm text-petrol-800">Previsione avanzata disponibile. Timestral è un’elaborazione previsionale sperimentale; Open-Meteo fornisce i dati meteorologici.</p>}
      </Section>

      <Section
        id="previsione"
        title={liveRequest ? `${VARIABLE_LABEL[variable] ?? variable}: prossime ${horizon} ore` : `${VARIABLE_LABEL[variable] ?? variable}: ${horizon} ore successive nel caso dimostrativo`}
        aside={result ? <SourceBadge kind={result.dataClass === 'SIMULATO' ? 'SIMULATO' : 'STIMATO_DA_MODELLO'} detail={technical ? (result.model.kind === 'timestral' ? `${result.model.name} [${result.model.revision.slice(0, 7)}]` : result.model.name) : modelPlain} testId="forecast-badge" /> : null}
      >
        {isTimestral && run.status === 'idle' && (
          <div className="rounded-lg border border-sand-200 p-3 text-sm">
            <p>Timestral-5M è un’elaborazione previsionale sperimentale e non una previsione scientificamente validata.</p>
            <button type="button" className="btn-secondary mt-2" onClick={() => setTimestralRequested((n) => n + 1)}>Avvia Timestral-5M</button>
          </div>
        )}
        {run.status === 'unavailable' && (
          <Alert tone="warn" title={unavailableText.title}>
            <p>{unavailableText.text}</p>
            <button type="button" className="btn-secondary mt-2" onClick={() => setModel('baseline-persistenza-stagionale')}>
              Mostra la previsione di base
            </button>
            <details className="mt-2 text-xs" open={technical}>
              <summary className="cursor-pointer font-semibold">Dettagli tecnici</summary>
              {run.message === HISTORY_SHORT_MARK ? (
                <p data-testid="forecast-history-short">
                  Storico Open-Meteo salvato per quest’area: {live.status === 'short' ? `${live.hours} ore valide su ${live.target}` : 'non disponibile'}. Timestral parte con almeno 72 ore continue (weather_history_status): nessuna
                  richiesta inviata al servizio e nessun valore sostituito.
                </p>
              ) : (
                <>
                  <p className="font-semibold">{FORECAST_TEXT.notConfigured}</p>
                  <p>
                    {run.message !== FORECAST_TEXT.notConfigured && <>{run.message}. </>}Il servizio di inferenza Timestral ({MODEL_CHOICES.find((m) => m.id === model)!.label}) non è raggiungibile da questa installazione: non viene mostrata alcuna previsione Timestral e nessun valore viene sostituito.
                  </p>
                </>
              )}
            </details>
          </Alert>
        )}
        {run.status === 'error' && (
          <Alert tone="error" title="Previsione non disponibile in questo momento">
            <p>Riprova più tardi o consulta la previsione di base.</p>
            <details className="mt-1 text-xs" open={technical}>
              <summary className="cursor-pointer font-semibold">Dettagli tecnici</summary>
              <p>{run.message}</p>
            </details>
          </Alert>
        )}
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
        {constraint?.physical_constraint_applied && (
          <p className="text-sm text-sand-600" data-testid="forecast-constraint-note">
            {HUMIDITY_CLIPPED_NOTE}
          </p>
        )}
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
                    <th scope="col">Data e orario (Europe/Rome)</th>
                    <th scope="col">{technical ? 'Mediana' : 'Valore centrale'}</th>
                    <th scope="col">{technical ? b.label : 'Fascia di variazione'}</th>
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
        <p className="text-sm" data-testid="threshold-plain">
          Segnala quando la probabilità di valori {threshold.direction} {formatNumber(threshold.value, series.unit)} supera il {Math.round(threshold.minProbability * 100)}%. Soglia fissata da: {threshold.expertRole} — {threshold.rationale}.
        </p>
        <details className="text-sm" open={technical}>
          <summary className="cursor-pointer font-semibold text-petrol-700">Modifica la soglia</summary>
          <div className="mt-2 space-y-3">
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
              <label className="block max-w-xs text-sm font-semibold">
                Frazione di acqua disponibile già consumata che fa scattare l’attenzione
                <input className="input mt-1" type="number" step={0.05} min={0.1} max={0.9} value={depletion} onChange={(e) => setDepletion(Number(e.target.value))} />
              </label>
            )}
          </div>
        </details>
        {zones.length > 0 && result && (
          <div className="space-y-2">
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

      <details className="card space-y-4" open={technical} data-testid="forecast-technical">
        <summary className="cursor-pointer text-lg font-bold text-petrol-900">Approfondimento tecnico</summary>
        <p className="text-sm text-sand-600">Emissione, intervalli probabilistici, confronto con le baseline, modello, dati e provenienza: le informazioni per la verifica e l’audit.</p>

        <section aria-labelledby="opzioni-h" className="space-y-3">
          <h2 id="opzioni-h" className="h-section">
            Opzioni avanzate
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm font-semibold">
              Inizio della simulazione
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
          <p className="text-xs text-sand-600">La probabilità di superare la soglia è letta dai 21 quantili previsti: non è una “affidabilità” del modello.</p>
        </section>

        <section aria-labelledby="confronto-h" className="space-y-3" id="confronto">
          <h2 id="confronto-h" className="h-section">
            Confronto con le baseline
          </h2>
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
        </section>

        <section aria-labelledby="modello-h" className="space-y-3" id="modello">
          <h2 id="modello-h" className="h-section">
            Modello, dati e provenienza
          </h2>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="font-semibold text-sand-600">Modello</dt>
            <dd>{result ? `${result.model.name} — versione ${result.model.version}, revisione ${result.model.revision}` : MODEL_CHOICES.find((m) => m.id === model)!.label}</dd>
            <dt className="font-semibold text-sand-600">Stato</dt>
            <dd>{isTimestral ? (forecastServiceUrl() ? 'Beta da validare — servizio configurato' : `Beta da validare — ${FORECAST_TEXT.notConfigured}`) : 'Baseline statistica di riferimento'}</dd>
            <dt className="font-semibold text-sand-600">Licenza</dt>
            <dd>{result?.model.license ?? (isTimestral ? 'Codice: Apache-2.0 · Pesi: Modified MIT (Hugging Face)' : 'codice del progetto')}</dd>
            <dt className="font-semibold text-sand-600">Inizio della simulazione</dt>
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
                {constraint && (
                  <>
                    <dt className="font-semibold text-sand-600">Vincolo fisico</dt>
                    <dd data-testid="forecast-constraint-tech">
                      {constraint.physical_constraint_applied
                        ? `Applicato: ${constraint.adjusted_values_count} valori su ${constraint.total_values} riportati entro ${constraint.physical_min}–${constraint.physical_max} ${series.unit}`
                        : 'Non necessario: nessun valore fuori dai limiti fisici'}
                      ; massimo grezzo {formatNumber(constraint.maximum_raw_value, series.unit)}; metodo {constraint.method} ({constraint.adapter_version}). Il taglio dei valori estremi può modificare la calibrazione probabilistica degli intervalli.
                    </dd>
                  </>
                )}
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
        </section>
      </details>

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

/** "tra X e Y": con una cifra decimale in più quando l'arrotondamento renderebbe uguali i due estremi. */
function rangeText(lo: number, hi: number, unit: string): string {
  let a = formatNumber(lo, '');
  let b = formatNumber(hi, unit);
  if (a === formatNumber(hi, '') && lo !== hi) {
    const fmt = (v: number) => v.toLocaleString('it-IT', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    a = fmt(lo);
    b = unit ? `${fmt(hi)} ${unit}` : fmt(hi);
  }
  return `tra ${a} e ${b}`;
}

/** Ora del valore centrale più vicino alla soglia: il massimo se la soglia è "sopra", il minimo se è "sotto". */
function peakIndex(median: number[], direction: 'sopra' | 'sotto'): number {
  let best = -1;
  for (let i = 0; i < median.length; i++) {
    if (best < 0 || (direction === 'sopra' ? median[i]! > median[best]! : median[i]! < median[best]!)) best = i;
  }
  return best;
}
