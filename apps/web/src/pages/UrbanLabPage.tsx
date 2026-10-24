import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  buildGrid,
  combineScenarios,
  createBaseline,
  createScenario,
  deriveBaselineVersion,
  fetchUrbanBaselineWeather,
  findValue,
  formatArea,
  INTERVENTION_GEOMETRY,
  INTERVENTION_LABEL,
  interventionQuantity,
  missingValue,
  runScenario,
  suggestedCellSize,
  userValue,
  validateAoi,
  verifyBaselineIntegrity,
  type ConnectorError,
  type DataValue,
  type Horizon,
  type InterventionType,
  type Scenario,
} from '@mdt/domain';
import { DataBadge, formatNumber } from '../components/DataBadge';
import { coolingColor, CoolingLegend, MapView, type MapPoint, type MapPolygon } from '../components/MapView';
import { Alert, DemoRibbon, Field, Section, Term } from '../components/ui';
import { ProjectMissing, useProject } from '../state/useProject';
import { buildIntervention, nextScenarioLabel, PARAM_DEFAULTS, PARAM_LABEL, PARAM_OPTIONS, refreshCombined, type ParamValue } from './urbanForms';

const INDICATORS: { key: string; title: string; termKey?: string; note: string }[] = [
  { key: 't_air_ref_hour', title: 'Temperatura dell’aria (2 m)', note: 'Quota 2 m, all’ora di riferimento. Non coincide con la temperatura delle superfici.' },
  { key: 't_surface_ref_hour', title: 'Temperatura superficiale', note: 'Temperatura delle pavimentazioni al sole: può superare di molto quella dell’aria.' },
  { key: 'comfort_index', title: 'Comfort termico (UTCI/WBGT)', termKey: 'utci', note: 'Calcolabile solo con input adeguati (temperatura media radiante, vento a quota pedone).' },
];

export default function UrbanLabPage() {
  const { bundle, ready, update } = useProject();
  const [baselineSel, setBaselineSel] = useState<string | null>(null);
  const [period, setPeriod] = useState<{ start: string; end: string; hour: number } | null>(null);
  const [fetchState, setFetchState] = useState<{ status: 'idle' | 'loading' | 'error' | 'ok'; error?: ConnectorError; info?: string }>({ status: 'idle' });
  const [scenarioSel, setScenarioSel] = useState<string | null>(null);
  const [newDesc, setNewDesc] = useState('');
  const [horizon, setHorizon] = useState<Horizon>('maturita');
  const [iType, setIType] = useState<InterventionType>('albero');
  const [iLabel, setILabel] = useState('');
  const [iParams, setIParams] = useState<Record<string, ParamValue>>(PARAM_DEFAULTS.albero);
  const [placing, setPlacing] = useState(false);
  const [surfaceInput, setSurfaceInput] = useState('');
  const [showCells, setShowCells] = useState(true);
  const [combineSel, setCombineSel] = useState<string[]>([]);

  const area = bundle?.area ?? null;
  const aoiOk = area ? validateAoi(area.geometry).valid : false;
  const baselines = useMemo(() => [...(bundle?.baselines ?? [])].sort((a, b) => b.version - a.version), [bundle?.baselines]);
  const baseline = baselines.find((b) => b.id === baselineSel) ?? baselines[0] ?? null;
  const scenarios = bundle?.scenarios.filter((s) => s.baselineId === baseline?.id) ?? [];
  const scenario = scenarios.find((s) => s.id === scenarioSel) ?? scenarios[0] ?? null;
  const run = bundle?.runs.find((r) => r.scenarioId === scenario?.id) ?? null;
  const grid = useMemo(() => (area && aoiOk ? buildGrid(area.geometry, suggestedCellSize(area.areaM2)) : null), [area, aoiOk]);

  if (!bundle) return <ProjectMissing ready={ready} />;
  const p = period ?? { start: baseline?.periodStart ?? '2025-07-15', end: baseline?.periodEnd ?? '2025-08-15', hour: baseline?.referenceHourLocal ?? 15 };
  const isDemo = bundle.project.mode === 'demo';

  // ----------------------------------------------------------------- azioni
  const fetchBaseline = async () => {
    if (!area) return;
    const v = validateAoi(area.geometry);
    if (!v.centroid) return;
    setFetchState({ status: 'loading' });
    const res = await fetchUrbanBaselineWeather({ lat: v.centroid.lat, lon: v.centroid.lon, start: p.start, end: p.end, referenceHourLocal: p.hour });
    if (!res.ok) return setFetchState({ status: 'error', error: res.error });
    const now = new Date();
    const content = {
      periodStart: p.start,
      periodEnd: p.end,
      referenceHourLocal: p.hour,
      values: res.value.values,
      qaNotes: [`${res.value.hoursUsed} valori orari utilizzati alle ${String(p.hour).padStart(2, '0')}:00.`, res.fromCache ? 'Risposta servita dalla cache locale.' : 'Risposta acquisita dal servizio.'],
      sourceSummary: `Open-Meteo Historical (cella ${res.value.gridLat.toFixed(3)}, ${res.value.gridLon.toFixed(3)})`,
      isDemo: false,
    };
    const latest = baselines[0];
    const nb = latest ? deriveBaselineVersion(latest, content, now) : createBaseline({ ...content, projectId: bundle.project.id, areaId: area.id }, now);
    await update((b) => ({ ...b, baselines: [...b.baselines, nb] }), { action: 'baseline', detail: `Baseline v${nb.version} da Open-Meteo (${p.start}→${p.end}, ore ${p.hour})` });
    setBaselineSel(nb.id);
    setFetchState({ status: 'ok', info: `Creata baseline v${nb.version}. Le versioni precedenti restano invariate.` });
  };

  const addSurfaceVersion = async () => {
    if (!baseline) return;
    const v = Number(surfaceInput.replace(',', '.'));
    if (!Number.isFinite(v) || v < -10 || v > 80) return;
    const now = new Date();
    const values = [
      ...baseline.values.filter((x) => x.key !== 't_surface_ref_hour'),
      userValue('t_surface_ref_hour', `Temperatura superficiale, ore ${String(baseline.referenceHourLocal).padStart(2, '0')}:00`, '°C', v, now.toISOString(), 'Riferimento per lo scenario', baseline.isDemo),
    ];
    const nb = deriveBaselineVersion(baseline, { values, qaNotes: [...baseline.qaNotes, 'T superficiale inserita manualmente dall’utente.'] }, now);
    await update((b) => ({ ...b, baselines: [...b.baselines, nb] }), { action: 'baseline', detail: `Baseline v${nb.version}: T superficiale inserita (${v} °C)` });
    setBaselineSel(nb.id);
    setSurfaceInput('');
  };

  const saveScenarios = async (next: Scenario[], detail: string) => {
    const refreshed = refreshCombined(next);
    const changed = new Set(refreshed.filter((s, i) => s !== bundle.scenarios[i]).map((s) => s.id));
    await update(
      (b) => ({ ...b, scenarios: refreshed, runs: b.runs.filter((r) => !changed.has(r.scenarioId) && refreshed.some((s) => s.id === r.scenarioId)) }),
      { action: 'scenario', detail },
    );
  };

  const addScenario = async () => {
    if (!baseline) return;
    const s = createScenario(
      { projectId: bundle.project.id, label: nextScenarioLabel(scenarios), description: newDesc.trim() || 'Scenario senza descrizione', baselineId: baseline.id, horizon: scenarios[0]?.horizon ?? horizon },
      new Date(),
    );
    await saveScenarios([...bundle.scenarios, s], `Scenario ${s.label} creato`);
    setScenarioSel(s.id);
    setNewDesc('');
  };

  const placeIntervention = async (vertices: [number, number][] | number[][]) => {
    if (!scenario) return;
    const label = iLabel.trim() || INTERVENTION_LABEL[iType];
    const i = buildIntervention(iType, label, iParams, vertices as [number, number][]);
    setPlacing(false);
    await saveScenarios(
      bundle.scenarios.map((s) => (s.id === scenario.id ? { ...s, interventions: [...s.interventions, i] } : s)),
      `Intervento "${label}" aggiunto a ${scenario.label}`,
    );
    setILabel('');
  };

  const removeIntervention = (id: string) =>
    scenario &&
    saveScenarios(
      bundle.scenarios.map((s) => (s.id === scenario.id ? { ...s, interventions: s.interventions.filter((i) => i.id !== id) } : s)),
      `Intervento rimosso da ${scenario.label}`,
    );

  const calc = async (targets: Scenario[]) => {
    if (!area || !baseline) return;
    const computedAt = new Date().toISOString();
    const runs = targets.map((s) => runScenario(s, { aoi: area, baseline, computedAt }));
    const ids = new Set(targets.map((t) => t.id));
    await update((b) => ({ ...b, runs: [...b.runs.filter((r) => !ids.has(r.scenarioId)), ...runs] }), {
      action: 'calcolo',
      detail: `Calcolati: ${targets.map((t) => t.label).join(', ')}`,
    });
  };

  const combine = async () => {
    const [a, b] = combineSel.map((id) => scenarios.find((s) => s.id === id));
    if (!a || !b) return;
    const ab = combineScenarios(a, b, new Date());
    await saveScenarios([...bundle.scenarios, ab], `Scenario combinato ${ab.label} creato`);
    setCombineSel([]);
    setScenarioSel(ab.id);
  };

  // ----------------------------------------------------------------- mappa
  const polygons: MapPolygon[] = [];
  const points: MapPoint[] = [];
  if (area) polygons.push({ id: 'aoi', geometry: area.geometry, kind: 'aoi' });
  if (showCells && run && grid) {
    const byId = new Map(grid.cells.map((c) => [c.id, c]));
    for (const c of run.cells) {
      const g = byId.get(c.id);
      if (g && c.dTs < -0.05) polygons.push({ id: c.id, geometry: g.polygon, kind: 'cella', color: coolingColor(c.dTs) });
    }
  }
  for (const i of scenario?.interventions ?? []) {
    if (i.geometry.type === 'Polygon') polygons.push({ id: i.id, geometry: i.geometry, kind: 'intervento' });
    else
      i.geometry.coordinates.forEach((c, k) =>
        points.push({
          id: `${i.id}-${k}`,
          coordinates: c,
          kind: i.type === 'albero' ? 'albero' : 'nebulizzatore',
          radiusM: i.type === 'albero' ? (scenario!.horizon === 'maturita' ? i.params.diametroChiomaMaturaM : i.params.diametroChiomaInizialeM) / 2 : i.type === 'nebulizzazione' ? i.params.raggioInfluenzaM : undefined,
        }),
      );
  }

  const baselineValue = (key: string): DataValue =>
    key === 'comfort_index'
      ? missingValue('comfort_index', 'Indice di comfort termico (UTCI/WBGT)', '°C', 'Non calcolato: servono temperatura media radiante, vento a quota pedone e radiazione locale validata.')
      : (baseline && findValue(baseline.values, key)) ?? missingValue(key, key, '°C', 'Non presente nella baseline.');

  const blocking = run?.checks.filter((c) => c.severity === 'errore') ?? [];
  const warnings = run?.checks.filter((c) => c.severity === 'avviso') ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm text-sand-600">{bundle.project.name}</p>
          <h1 className="text-2xl font-extrabold text-petrol-900">Decision Lab urbano</h1>
        </div>
        <Link to={`/progetti/${bundle.project.id}/confronto`} className="btn-primary">
          Confronta e decidi →
        </Link>
      </div>
      {isDemo && <DemoRibbon />}

      <Section id="u1" step={1} title="Area reale">
        {area && aoiOk ? (
          <p className="text-sm">
            <strong>{area.name}</strong> · {formatArea(area.areaM2)} · {area.crs}
            {grid && ` · griglia di ${grid.cells.length} celle da ${grid.cellSizeM} m`}{' '}
            <Link className="font-semibold text-petrol-700 underline" to={`/progetti/${bundle.project.id}/area`}>
              dettagli
            </Link>
          </p>
        ) : (
          <Alert tone="error" title="Simulazione bloccata">
            Definisci un’area valida prima di procedere. <Link to={`/progetti/${bundle.project.id}/area`} className="underline">Vai all’area</Link>
          </Alert>
        )}
      </Section>

      {area && aoiOk && (
        <>
          <Section id="u2" step={2} title="Periodo e ora di riferimento">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Dal" htmlFor="pstart">
                <input id="pstart" type="date" className="input" value={p.start} onChange={(e) => setPeriod({ ...p, start: e.target.value })} />
              </Field>
              <Field label="Al" htmlFor="pend">
                <input id="pend" type="date" className="input" value={p.end} onChange={(e) => setPeriod({ ...p, end: e.target.value })} />
              </Field>
              <Field label="Ora (Europe/Rome)" htmlFor="phour">
                <select id="phour" className="input" value={p.hour} onChange={(e) => setPeriod({ ...p, hour: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-secondary" onClick={fetchBaseline} disabled={fetchState.status === 'loading'}>
                {fetchState.status === 'loading' ? 'Richiesta in corso…' : baselines.length ? 'Crea nuova versione della baseline da Open-Meteo' : 'Crea baseline da Open-Meteo'}
              </button>
              <span className="text-xs text-sand-600">Stima modellistica riferita alla cella di griglia, non sensore sul posto.</span>
            </div>
            {fetchState.status === 'error' && fetchState.error && (
              <Alert tone="error" title={`Dati meteo non disponibili (${fetchState.error.code})`}>
                <p>{fetchState.error.message}</p>
                <p className="text-xs">
                  {fetchState.error.endpoint} · {new Date(fetchState.error.at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}. Nessun valore sostitutivo è stato inserito.
                </p>
              </Alert>
            )}
            {fetchState.status === 'ok' && <Alert tone="ok">{fetchState.info}</Alert>}
          </Section>

          <Section
            id="u3"
            step={3}
            title="Baseline"
            aside={
              baselines.length > 1 && (
                <label className="flex items-center gap-2 text-sm">
                  Versione
                  <select className="input min-h-9 w-auto py-1" value={baseline?.id} onChange={(e) => setBaselineSel(e.target.value)}>
                    {baselines.map((b) => (
                      <option key={b.id} value={b.id}>
                        v{b.version} — {b.sourceSummary.slice(0, 40)}
                      </option>
                    ))}
                  </select>
                </label>
              )
            }
          >
            {!baseline ? (
              <p className="text-sm">Nessuna baseline. Creala dal passo 2.</p>
            ) : (
              <>
                <p className="text-sm">
                  <Term k="baseline">Baseline</Term> <strong>v{baseline.version}</strong> · {baseline.periodStart} → {baseline.periodEnd}, ore {String(baseline.referenceHourLocal).padStart(2, '0')}:00 Europe/Rome · {baseline.sourceSummary}
                  {baseline.isDemo && <span className="ml-2 font-bold text-ochre-800">DEMO</span>}
                </p>
                <p className="text-xs text-sand-600">
                  Bloccata il {new Date(baseline.lockedAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })} · hash <code>{baseline.contentHash.slice(0, 12)}…</code> · integrità{' '}
                  {verifyBaselineIntegrity(baseline) ? '✔ verificata' : '✖ NON corrispondente'} {baseline.parentId && `· deriva da v${baselines.find((b) => b.id === baseline.parentId)?.version ?? '?'}`}
                </p>
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th scope="col">Variabile</th>
                        <th scope="col">Valore e classe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {baseline.values.map((v) => (
                        <tr key={v.key}>
                          <td>{v.label}</td>
                          <td>
                            <DataBadge value={v} />
                            {v.missingReason && <p className="text-xs text-sand-600">{v.missingReason}</p>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {baseline.qaNotes.length > 0 && <p className="text-xs text-sand-600">QA: {baseline.qaNotes.join(' ')}</p>}
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-petrol-700">Aggiungi una temperatura superficiale nota (crea una nuova versione)</summary>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <Field label="T superficiale (°C)" htmlFor="tsurf" hint="Es. da termocamera o prodotto satellitare: verrà marcata INSERITO DALL’UTENTE.">
                      <input id="tsurf" inputMode="decimal" className="input w-40" value={surfaceInput} onChange={(e) => setSurfaceInput(e.target.value)} />
                    </Field>
                    <button type="button" className="btn-secondary" onClick={addSurfaceVersion} disabled={!surfaceInput}>
                      Crea v{baseline.version + 1}
                    </button>
                  </div>
                </details>
              </>
            )}
          </Section>

          {baseline && (
            <Section id="u4" step={4} title="Indicatori, letti separatamente">
              <div className="grid gap-3 md:grid-cols-3">
                {INDICATORS.map((ind) => {
                  const v = baselineValue(ind.key);
                  return (
                    <div key={ind.key} className="rounded-lg border border-sand-200 bg-sand-50 p-3">
                      <h3 className="font-bold">{ind.termKey ? <Term k={ind.termKey}>{ind.title}</Term> : ind.title}</h3>
                      <div className="mt-2 text-lg">
                        <DataBadge value={v} />
                      </div>
                      <p className="mt-2 text-xs text-sand-600">{v.missingReason ?? ind.note}</p>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {baseline && (
            <Section id="u5" step={5} title="Scenari alternativi">
              <p className="text-sm">
                Tutti gli scenari di questa pagina usano la baseline v{baseline.version} e il modello <code>demo-urban-illustrative@0.1.0</code>: il confronto resta equo.
              </p>
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Scenari">
                {scenarios.map((s) => (
                  <button
                    key={s.id}
                    role="tab"
                    aria-selected={s.id === scenario?.id}
                    type="button"
                    className={`btn ${s.id === scenario?.id ? 'bg-petrol-700 text-white' : 'border-2 border-sand-400 bg-white'}`}
                    onClick={() => setScenarioSel(s.id)}
                  >
                    {s.label}
                    {bundle.runs.some((r) => r.scenarioId === s.id) ? ' ✔' : ''}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
                <Field label="Nuovo scenario — descrizione" htmlFor="sdesc">
                  <input id="sdesc" className="input" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="es. Alberature lungo il lato sud" />
                </Field>
                {scenarios.length === 0 && (
                  <Field label="Orizzonte" htmlFor="shor">
                    <select id="shor" className="input" value={horizon} onChange={(e) => setHorizon(e.target.value as Horizon)}>
                      <option value="maturita">Chiome a maturità</option>
                      <option value="impianto">All’impianto</option>
                    </select>
                  </Field>
                )}
                <button type="button" className="btn-secondary" onClick={addScenario}>
                  Aggiungi scenario {nextScenarioLabel(scenarios)}
                </button>
              </div>
              {scenarios.filter((s) => s.combines.length === 0).length >= 2 && (
                <fieldset className="rounded-lg border border-sand-200 p-3">
                  <legend className="px-1 text-sm font-semibold">Combina due scenari (effetti non additivi)</legend>
                  <div className="flex flex-wrap items-center gap-3">
                    {scenarios
                      .filter((s) => s.combines.length === 0)
                      .map((s) => (
                        <label key={s.id} className="flex items-center gap-1 text-sm">
                          <input
                            type="checkbox"
                            className="size-5"
                            checked={combineSel.includes(s.id)}
                            onChange={(e) => setCombineSel((c) => (e.target.checked ? [...c, s.id].slice(-2) : c.filter((x) => x !== s.id)))}
                          />
                          {s.label}
                        </label>
                      ))}
                    <button type="button" className="btn-ghost" disabled={combineSel.length !== 2} onClick={combine}>
                      Crea combinazione
                    </button>
                  </div>
                </fieldset>
              )}
            </Section>
          )}

          {scenario && baseline && (
            <Section
              id="u6"
              step={6}
              title={`Interventi dello scenario ${scenario.label}`}
              aside={<span className="text-xs text-sand-600">Orizzonte: {scenario.horizon === 'maturita' ? 'chiome a maturità' : 'all’impianto'}</span>}
            >
              <p className="text-sm text-sand-600">{scenario.description}</p>
              {scenario.combines.length > 0 && (
                <Alert tone="info">Scenario combinato: gli interventi derivano dagli scenari sorgente e si aggiornano con essi.</Alert>
              )}
              <MapView
                ariaLabel={`Mappa dello scenario ${scenario.label}`}
                polygons={polygons}
                points={points}
                fitTo={area.geometry}
                drawMode={placing ? INTERVENTION_GEOMETRY[iType] : null}
                onDrawComplete={placeIntervention}
                onDrawCancel={() => setPlacing(false)}
                height="24rem"
              />
              {run && run.cells.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CoolingLegend title={`Mappa delle differenze: ΔT superficiale per cella (scenario ${scenario.label} − baseline), SIMULATO`} />
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-5" checked={showCells} onChange={(e) => setShowCells(e.target.checked)} />
                    Mostra celle
                  </label>
                </div>
              )}

              <ul className="space-y-2">
                {scenario.interventions.map((i) => {
                  const q = interventionQuantity(i);
                  return (
                    <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-sand-100 p-3 text-sm">
                      <div>
                        <p className="font-bold">
                          {i.label} <span className="font-normal text-sand-600">· {INTERVENTION_LABEL[i.type]}</span>
                        </p>
                        <p>
                          Quantità dalla geometria: <strong>{formatNumber(q.value, q.unit)}</strong>
                        </p>
                        <p className="text-xs text-sand-600">
                          {Object.entries(i.params)
                            .map(([k, v]) => `${PARAM_LABEL[k] ?? k}: ${typeof v === 'boolean' ? (v ? 'sì' : 'no') : v}`)
                            .join(' · ')}
                        </p>
                      </div>
                      {scenario.combines.length === 0 && (
                        <button type="button" className="btn-ghost text-alert-800" onClick={() => removeIntervention(i.id)}>
                          Rimuovi
                        </button>
                      )}
                    </li>
                  );
                })}
                {scenario.interventions.length === 0 && <li className="text-sm">Nessun intervento: aggiungine uno qui sotto.</li>}
              </ul>

              {scenario.combines.length === 0 && (
                <fieldset className="space-y-3 rounded-lg border-2 border-sand-200 p-3">
                  <legend className="px-1 font-semibold">Aggiungi intervento</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Tipo" htmlFor="itype">
                      <select
                        id="itype"
                        className="input"
                        value={iType}
                        onChange={(e) => {
                          const t = e.target.value as InterventionType;
                          setIType(t);
                          setIParams(PARAM_DEFAULTS[t]);
                        }}
                      >
                        {(Object.keys(INTERVENTION_LABEL) as InterventionType[]).map((t) => (
                          <option key={t} value={t}>
                            {INTERVENTION_LABEL[t]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Etichetta" htmlFor="ilabel">
                      <input id="ilabel" className="input" value={iLabel} onChange={(e) => setILabel(e.target.value)} placeholder={INTERVENTION_LABEL[iType]} />
                    </Field>
                    {Object.entries(iParams).map(([k, v]) => {
                      const id = `ip-${k}`;
                      if (typeof v === 'boolean')
                        return (
                          <label key={k} className="flex min-h-11 items-center gap-2 text-sm font-semibold">
                            <input id={id} type="checkbox" className="size-5" checked={v} onChange={(e) => setIParams({ ...iParams, [k]: e.target.checked })} />
                            {PARAM_LABEL[k] ?? k}
                          </label>
                        );
                      if (PARAM_OPTIONS[k])
                        return (
                          <Field key={k} label={PARAM_LABEL[k] ?? k} htmlFor={id}>
                            <select id={id} className="input" value={String(v)} onChange={(e) => setIParams({ ...iParams, [k]: e.target.value })}>
                              {PARAM_OPTIONS[k]!.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </Field>
                        );
                      return (
                        <Field key={k} label={k.startsWith('albedo') ? <Term k="albedo">{PARAM_LABEL[k]}</Term> : (PARAM_LABEL[k] ?? k)} htmlFor={id}>
                          <input
                            id={id}
                            className="input"
                            type={typeof v === 'number' ? 'number' : 'text'}
                            step="any"
                            value={String(v)}
                            onChange={(e) => setIParams({ ...iParams, [k]: typeof v === 'number' ? Number(e.target.value) : e.target.value })}
                          />
                        </Field>
                      );
                    })}
                  </div>
                  <button type="button" className="btn-primary" onClick={() => setPlacing(true)} disabled={placing}>
                    {INTERVENTION_GEOMETRY[iType] === 'points' ? 'Posiziona i punti sulla mappa' : 'Disegna il poligono sulla mappa'}
                  </button>
                </fieldset>
              )}
            </Section>
          )}

          {scenario && baseline && (
            <Section
              id="u7"
              step={7}
              title="Calcolo trasparente"
              aside={
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primary" onClick={() => calc([scenario])} disabled={scenario.interventions.length === 0}>
                    Calcola {scenario.label}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => calc(scenarios.filter((s) => s.interventions.length > 0))}>
                    Calcola tutti
                  </button>
                </div>
              }
            >
              {!run ? (
                <p className="text-sm">Scenario non ancora calcolato (o modificato dopo l’ultimo calcolo).</p>
              ) : (
                <>
                  {blocking.length > 0 && (
                    <Alert tone="error" title="Calcolo non eseguito: dati non plausibili">
                      {blocking.map((c) => (
                        <p key={c.message}>{c.message}</p>
                      ))}
                    </Alert>
                  )}
                  {warnings.map((c) => (
                    <Alert key={c.message} tone="warn">
                      {c.message}
                    </Alert>
                  ))}
                  {run.notes.map((n) => (
                    <Alert key={n} tone="info">
                      {n}
                    </Alert>
                  ))}
                  {run.outputs.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {run.outputs.map((o) => (
                        <div key={o.key} className="rounded-lg border border-sand-200 p-3">
                          <p className="text-sm font-semibold">{o.label}</p>
                          <div className="mt-1">
                            <DataBadge value={o} />
                          </div>
                          {o.missingReason && <p className="mt-1 text-xs text-sand-600">{o.missingReason}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-sand-600">
                    Modello {run.modelRef} · costi {run.costModelRef} · input <code>{run.inputHash.slice(0, 12)}…</code> · output <code>{run.outputHash ? `${run.outputHash.slice(0, 12)}…` : '—'}</code> · calcolato il{' '}
                    {new Date(run.computedAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}. Stesso input → stesso output: il calcolo è deterministico.
                  </p>
                  <details>
                    <summary className="cursor-pointer text-sm font-semibold text-petrol-700">Come è calcolato</summary>
                    <p className="mt-2 text-sm">
                      L’area è divisa in celle; per ogni cella si stimano le quote coperte da ombra, verde, materiali e nebulizzazione. Ogni copertura riduce la temperatura secondo coefficienti
                      illustrativi (prudente / centrale / favorevole). Le ombre sovrapposte non si sommano e gli effetti diversi si combinano con smorzamento. L’<Term k="intervallo">intervallo</Term>{' '}
                      deriva dai coefficienti estremi. Dettagli e parametri in{' '}
                      <Link to="/metodo" className="underline">
                        Fonti e metodo
                      </Link>
                      .
                    </p>
                  </details>
                </>
              )}
            </Section>
          )}

          {scenarios.length >= 2 && (
            <Section id="u8" step={8} title="Confronto, costi e decisione">
              <p className="text-sm">Confronta gli scenari affiancati, valuta costi, acqua, manutenzione, vincoli e incertezza, poi motiva la scelta.</p>
              <Link to={`/progetti/${bundle.project.id}/confronto`} className="btn-primary">
                Apri il confronto
              </Link>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
