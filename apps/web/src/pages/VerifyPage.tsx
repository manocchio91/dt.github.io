import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  compareExPost,
  DEMO_EXPOST_CSV,
  DEMO_EXPOST_POINTS,
  newId,
  parseMeasurementsCsv,
  pointInPolygon,
  proposeRecalibration,
  type MonitoringPoint,
  type VerificationPlan,
} from '@mdt/domain';
import { ClassChip, DataBadge, formatNumber } from '../components/DataBadge';
import { MapView } from '../components/MapView';
import { Alert, Field, Section } from '../components/ui';
import { ProjectMissing, useProject } from '../state/useProject';
import { usePermissions } from '../state/permissions';
import { PathGuide } from '../components/guide';
import { useWorkMode } from '../state/preferences';

const OUTPUT_OPTIONS = [
  { key: 'delta_t_surface', variable: 'temperatura_superficiale', label: 'Riduzione T superficiale media' },
  { key: 'delta_t_air', variable: 'temperatura_aria', label: 'Riduzione T aria 2 m' },
];

export default function VerifyPage() {
  const { bundle, ready, update } = useProject();
  const [scenarioId, setScenarioId] = useState('');
  const [outputKey, setOutputKey] = useState('delta_t_surface');
  const [points, setPoints] = useState<MonitoringPoint[]>([]);
  const [placing, setPlacing] = useState(false);
  const [form, setForm] = useState({ start: '', end: '', frequency: 'giornaliera, ore 15:00', tolerance: 1, notes: 'giornate serene, vento debole' });
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [rationale, setRationale] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const { canEdit } = usePermissions();
  const technical = useWorkMode() === 'tecnica';

  if (!bundle) return <ProjectMissing ready={ready} />;
  const withRuns = bundle.scenarios.filter((s) => bundle.runs.some((r) => r.scenarioId === s.id && r.outputs.length));
  const plans = bundle.verificationPlans;
  const plan = plans.at(-1) ?? null;
  const planScenario = plan && bundle.scenarios.find((s) => s.id === plan.scenarioId);
  const planRun = plan && bundle.runs.find((r) => r.scenarioId === plan.scenarioId);
  const predicted = planRun?.outputs.find((o) => o.key === plan?.outputKey);
  const cmp = plan && predicted ? compareExPost(plan, predicted, bundle.measurements) : null;
  const sid = scenarioId || withRuns[0]?.id || '';
  const baseline = bundle.baselines.find((b) => b.id === bundle.scenarios.find((s) => s.id === sid)?.baselineId);

  const savePlan = async () => {
    const opt = OUTPUT_OPTIONS.find((o) => o.key === outputKey)!;
    if (!sid || points.length === 0 || !form.start || !form.end) return setMsg('Completa scenario, punti di misura e periodo.');
    const p: VerificationPlan = {
      id: newId(),
      projectId: bundle.project.id,
      scenarioId: sid,
      outputKey,
      variable: opt.variable,
      unit: '°C',
      points,
      periodStart: form.start,
      periodEnd: form.end,
      frequency: form.frequency,
      homogeneity: { referenceHourLocal: baseline?.referenceHourLocal ?? 15, toleranceHours: form.tolerance, notes: form.notes },
      createdAt: new Date().toISOString(),
    };
    await update((b) => ({ ...b, verificationPlans: [...b.verificationPlans, p] }), { action: 'verifica', detail: 'Piano di monitoraggio definito' });
    setMsg('Piano salvato. La data di creazione resta registrata prima delle misure.');
  };

  const importCsv = async (text: string, label: string) => {
    const res = parseMeasurementsCsv(text);
    setCsvErrors(res.errors);
    if (res.records.length) {
      await update((b) => ({ ...b, measurements: [...b.measurements, ...res.records] }), { action: 'misure', detail: `${res.records.length} misure importate (${label})` });
    }
  };

  const patchPlan = (patch: Partial<VerificationPlan>) =>
    plan && update((b) => ({ ...b, verificationPlans: b.verificationPlans.map((p) => (p.id === plan.id ? { ...p, ...patch } : p)) }));

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-sand-600">{bundle.project.name}</p>
        <h1 className="text-2xl font-extrabold text-petrol-900">Verifica ex-post</h1>
        <p className="text-sm">osservare → simulare → decidere → intervenire → misurare → apprendere</p>
      </div>
      <PathGuide where={{ step: 7, what: 'quanto previsto confrontato con quanto misurato dopo l’intervento.', why: 'solo la verifica dice se la scelta ha funzionato e cosa migliorare la prossima volta.' }} />
      {msg && <Alert tone="info">{msg}</Alert>}

      {!technical && bundle.decisions.some((d) => d.sector === 'urban') && (
        <Alert tone="ok" title="Decisione registrata">
          <p>Dopo la realizzazione potrai confrontare il risultato previsto con quello osservato.</p>
          <a className="mt-2 inline-block font-semibold underline" href="#verification-plan">Pianifica la verifica</a>
        </Alert>
      )}

      <div id="verification-plan">
      {withRuns.length === 0 ? (
        <Alert tone="warn">
          Prima calcola almeno uno scenario. <Link to={`/progetti/${bundle.project.id}/urbano`} className="underline">Vai al Lab</Link>
        </Alert>
      ) : !canEdit ? (
        <Section step={1} title="Piano di monitoraggio (prima dell’intervento)">
          <p className="text-sm text-sand-600">
            {plan ? `Piano definito il ${new Date(plan.createdAt).toLocaleDateString('it-IT')} per i punti ${plan.points.map((x) => x.id).join(', ')}.` : 'Nessun piano definito.'} Solo chi ha il ruolo “modifica” può definirlo o importare misure.
          </p>
        </Section>
      ) : (
        <Section step={1} title="Piano di monitoraggio (prima dell’intervento)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Scenario da verificare" htmlFor="vs">
              <select id="vs" className="input" value={sid} onChange={(e) => setScenarioId(e.target.value)}>
                {withRuns.map((s) => (
                  <option key={s.id} value={s.id}>
                    Scenario {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Output previsto da verificare" htmlFor="vo">
              <select id="vo" className="input" value={outputKey} onChange={(e) => setOutputKey(e.target.value)}>
                {OUTPUT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Inizio campagna post" htmlFor="vstart">
              <input id="vstart" type="date" className="input" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
            </Field>
            <Field label="Fine campagna post" htmlFor="vend">
              <input id="vend" type="date" className="input" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
            </Field>
            <Field label="Frequenza" htmlFor="vf">
              <input id="vf" className="input" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} />
            </Field>
            <Field label={`Tolleranza oraria attorno alle ${String(baseline?.referenceHourLocal ?? 15).padStart(2, '0')}:00 (ore)`} htmlFor="vt">
              <input id="vt" type="number" min={0} max={3} className="input" value={form.tolerance} onChange={(e) => setForm({ ...form, tolerance: Number(e.target.value) })} />
            </Field>
            <Field label="Condizioni confrontabili" htmlFor="vn">
              <input id="vn" className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          <p className="text-sm font-semibold">Punti di misura ({points.length})</p>
          {bundle.area && (
            <MapView
              ariaLabel="Mappa dei punti di misura"
              polygons={[{ id: 'aoi', geometry: bundle.area.geometry, kind: 'aoi' }]}
              points={points.map((p) => ({ id: p.id, coordinates: [p.lon, p.lat], kind: 'punto' }))}
              fitTo={bundle.area.geometry}
              drawMode={placing ? 'points' : null}
              onDrawComplete={(v) => {
                const inside = v.filter((c) => pointInPolygon(c[0]!, c[1]!, bundle.area!.geometry));
                setPoints((ps) => [...ps, ...inside.map((c, k) => ({ id: `P${ps.length + k + 1}`, label: `P${ps.length + k + 1}`, lon: c[0]!, lat: c[1]! }))]);
                if (inside.length < v.length) setMsg('Alcuni punti fuori dall’area sono stati scartati.');
                setPlacing(false);
              }}
              onDrawCancel={() => setPlacing(false)}
              height="18rem"
            />
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={() => setPlacing(true)}>
              Posiziona punti
            </button>
            {bundle.project.isDemoSeed && (
              <button type="button" className="btn-ghost" onClick={() => setPoints(DEMO_EXPOST_POINTS)}>
                Usa punti DEMO
              </button>
            )}
            <button type="button" className="btn-primary" onClick={savePlan}>
              Salva piano
            </button>
          </div>
        </Section>
      )}
      </div>

      {plan && (
        <Section
          step={2}
          title="Misure ante e post"
          aside={
            <a className="btn-ghost" href={`/progetti/${bundle.project.id}/documenti?categoria=verifica_ex_post&scenario=${plan.scenarioId}`}>
              Allega foto o documenti alla verifica
            </a>
          }
        >
          <p className="text-sm">
            Piano del {new Date(plan.createdAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })} · scenario {planScenario?.label} · variabile <code>{plan.variable}</code> [{plan.unit}] · punti{' '}
            {plan.points.map((p) => p.id).join(', ')}
          </p>
          <p className="text-xs text-sand-600">CSV: punto,fase,variabile,timestamp,valore,unita,sensore,classe — fase = ante|post; classe = MISURATO | OSSERVATO_DA_DATASET | SIMULATO.</p>
          {canEdit && (
          <div className="flex flex-wrap gap-2">
            <label className="btn-secondary cursor-pointer">
              Importa CSV misure
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => e.target.files?.[0] && importCsv(await e.target.files[0].text(), e.target.files[0].name)} />
            </label>
            {bundle.project.isDemoSeed && (
              <button type="button" className="btn-ghost" onClick={() => importCsv(DEMO_EXPOST_CSV, 'esempio DEMO SIMULATO')}>
                Carica misure di esempio (SIMULATE)
              </button>
            )}
          </div>
          )}
          {csvErrors.length > 0 && (
            <Alert tone="error" title="Righe scartate">
              {csvErrors.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </Alert>
          )}
          <p className="text-sm">{bundle.measurements.length} misure registrate.</p>
        </Section>
      )}

      {plan && cmp && predicted && (
        <Section step={3} title="Previsto e osservato">
          {cmp.notes.map((n) => (
            <Alert key={n} tone={n.includes('SIMULATI') ? 'warn' : 'info'}>
              {n}
            </Alert>
          ))}
          <div className="overflow-x-auto">
            <table className="table-base">
              <tbody>
                <tr>
                  <th scope="row">Previsto (scenario {planScenario?.label})</th>
                  <td>
                    <DataBadge value={predicted} />
                  </td>
                </tr>
                <tr>
                  <th scope="row">Osservato (media post − media ante)</th>
                  <td>
                    {cmp.observed === null ? 'non disponibile' : formatNumber(cmp.observed, cmp.unit)} <ClassChip dataClass={cmp.observedClass} />
                  </td>
                </tr>
                <tr>
                  <th scope="row">Scarto (osservato − previsto)</th>
                  <td className="font-bold">{cmp.residual === null ? '—' : formatNumber(cmp.residual, cmp.unit)}</td>
                </tr>
                <tr>
                  <th scope="row">Dentro l’intervallo illustrativo?</th>
                  <td>{cmp.withinRange === null ? '—' : cmp.withinRange ? 'sì ✔' : 'no ✖'}</td>
                </tr>
                <tr>
                  <th scope="row">Misure utilizzate</th>
                  <td>
                    ante {cmp.nAnte} · post {cmp.nPost} · escluse {cmp.excluded.count}
                    {cmp.excluded.reasons.length > 0 && ` (${cmp.excluded.reasons.join('; ')})`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Cause possibili dello scarto" htmlFor="causes">
              <textarea id="causes" className="input" rows={3} defaultValue={plan.possibleCauses} readOnly={!canEdit} onBlur={(e) => canEdit && patchPlan({ possibleCauses: e.target.value })} />
            </Field>
            <Field label="Lezioni apprese" htmlFor="lessons">
              <textarea id="lessons" className="input" rows={3} defaultValue={plan.lessonsLearned} readOnly={!canEdit} onBlur={(e) => canEdit && patchPlan({ lessonsLearned: e.target.value })} />
            </Field>
            <Field label="Azione correttiva" htmlFor="corr">
              <textarea id="corr" className="input" rows={3} defaultValue={plan.correctiveAction} readOnly={!canEdit} onBlur={(e) => canEdit && patchPlan({ correctiveAction: e.target.value })} />
            </Field>
          </div>

          {canEdit && cmp.observed !== null && planRun && (
            <div className="space-y-2 rounded-lg border-2 border-dashed border-petrol-500 p-3">
              <p className="font-semibold">Proponi una nuova calibrazione</p>
              <p className="text-sm">La versione attuale del modello ({planRun.modelRef}) resta invariata: la proposta crea una nuova versione da validare.</p>
              <Field label="Motivazione" htmlFor="recal">
                <textarea id="recal" className="input" rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} />
              </Field>
              <button
                type="button"
                className="btn-secondary"
                disabled={rationale.trim().length < 20}
                onClick={async () => {
                  const prop = proposeRecalibration(planRun.modelRef, cmp, rationale, bundle.modelProposals, new Date());
                  await update((b) => ({ ...b, modelProposals: [...b.modelProposals, prop] }), { action: 'ricalibrazione', detail: `Proposta ${prop.proposedVersion}` });
                  setRationale('');
                }}
              >
                Registra proposta
              </button>
              {bundle.modelProposals.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {bundle.modelProposals.map((p) => (
                    <li key={p.id} className="rounded bg-sand-100 p-2">
                      <code>{p.parentModelRef.split('@')[0]}@{p.proposedVersion}</code> — {p.status} · fattore suggerito {p.suggestedScaling ?? 'n.d.'} · {p.rationale}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
