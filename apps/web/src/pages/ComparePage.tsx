import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  buildGrid,
  checkComparability,
  checkRunsComparability,
  exportProject,
  INTERVENTION_LABEL,
  newId,
  scenarioToGeoJson,
  suggestedCellSize,
  validateDecision,
  type DataValue,
  type Decision,
  type DecisionOutcome,
  type ScenarioRun,
} from '@mdt/domain';
import { DataBadge, formatNumber } from '../components/DataBadge';
import { coolingColor, CoolingLegend, MapView, type MapPolygon } from '../components/MapView';
import { Alert, DemoRibbon, Field, Section, Term } from '../components/ui';
import { ProjectMissing, useProject } from '../state/useProject';
import { downloadText } from '../state/store';
import { usePermissions } from '../state/permissions';

type Triple = [number, number, number];
const eur = (t: Triple, unit = '€') =>
  t[2] === 0 ? `0 ${unit}` : `${formatNumber(t[0], '')} – ${formatNumber(t[2], unit)} (centrale ${formatNumber(t[1], unit)})`;

const OUTCOMES: { value: DecisionOutcome; label: string }[] = [
  { value: 'accettata', label: 'Accetto l’alternativa scelta' },
  { value: 'modificata', label: 'Accetto con modifiche' },
  { value: 'rifiutata', label: 'Rifiuto tutte le alternative' },
  { value: 'inviata_a_esperto', label: 'Invio a un esperto prima di decidere' },
];

function IntervalChart({ rows, title }: { rows: { label: string; v: DataValue | undefined }[]; title: string }) {
  const valid = rows.filter((r): r is { label: string; v: DataValue } => !!r.v && r.v.value !== null);
  if (valid.length === 0) return null;
  const min = Math.min(-1, ...valid.map((r) => r.v.range?.[0] ?? r.v.value!));
  const W = 560;
  const L = 70;
  const R = 20;
  const x = (v: number) => L + ((v - min) / (0 - min)) * (W - L - R);
  const H = 28 * valid.length + 34;
  const ticks = Array.from({ length: 5 }, (_, k) => (min * (4 - k)) / 4);
  return (
    <figure>
      <figcaption className="mb-1 text-sm font-semibold">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-2xl" role="img" aria-label={`${title}: ${valid.map((r) => `${r.label} ${r.v.value} (da ${r.v.range?.[0]} a ${r.v.range?.[1]}) °C`).join('; ')}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={6} y2={H - 22} stroke="#e6dfd2" />
            <text x={x(t)} y={H - 6} fontSize="11" textAnchor="middle" fill="#5f574b">
              {t.toFixed(1).replace('.', ',')}
            </text>
          </g>
        ))}
        {valid.map((r, i) => {
          const y = 18 + i * 28;
          const [lo, hi] = r.v.range ?? [r.v.value!, r.v.value!];
          return (
            <g key={r.label}>
              <text x={L - 8} y={y + 4} fontSize="12" textAnchor="end" fontWeight="600" fill="#2b2724">
                {r.label}
              </text>
              <line x1={x(lo)} x2={x(hi)} y1={y} y2={y} stroke="#2a7186" strokeWidth="8" strokeLinecap="round" opacity="0.35" />
              <circle cx={x(r.v.value!)} cy={y} r="6" fill="#0f4c5c" />
            </g>
          );
        })}
      </svg>
      <p className="text-xs text-sand-600">Punto = valore centrale; barra = intervallo illustrativo (non statistico). Valori negativi = riduzione.</p>
    </figure>
  );
}

export default function ComparePage() {
  const { bundle, ready, update } = useProject();
  const [selected, setSelected] = useState<string[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [outcome, setOutcome] = useState<DecisionOutcome>('accettata');
  const [rationale, setRationale] = useState('');
  const [author, setAuthor] = useState('');
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const perms = usePermissions();

  const grid = useMemo(() => (bundle?.area ? buildGrid(bundle.area.geometry, suggestedCellSize(bundle.area.areaM2)) : null), [bundle?.area]);
  if (!bundle) return <ProjectMissing ready={ready} />;

  const withRuns = bundle.scenarios.filter((s) => bundle.runs.some((r) => r.scenarioId === s.id && r.outputs.length > 0));
  const sel = (selected ?? withRuns.map((s) => s.id)).filter((id) => withRuns.some((s) => s.id === id));
  const scen = withRuns.filter((s) => sel.includes(s.id));
  const runs = scen.map((s) => bundle.runs.find((r) => r.scenarioId === s.id)!) as ScenarioRun[];
  const labels = Object.fromEntries(bundle.scenarios.map((s) => [s.id, s.label]));
  const cmp = checkComparability(scen);
  const cmpRuns = checkRunsComparability(runs, labels);
  const comparable = scen.length >= 2 && cmp.comparable && cmpRuns.comparable;
  const baseline = bundle.baselines.find((b) => b.id === scen[0]?.baselineId);
  const out = (r: ScenarioRun, key: string) => r.outputs.find((o) => o.key === key);
  const baseVal = (key: string) => baseline?.values.find((v) => v.key === key);

  const row = (label: ReactNode, base: ReactNode, cell: (r: ScenarioRun, i: number) => ReactNode) => (
    <tr>
      <th scope="row" className="font-semibold">
        {label}
      </th>
      <td className="bg-sand-50">{base}</td>
      {runs.map((r, i) => (
        <td key={r.scenarioId}>{cell(r, i)}</td>
      ))}
    </tr>
  );
  const groupRow = (title: string) => (
    <tr>
      <th colSpan={runs.length + 2} scope="colgroup" className="!bg-petrol-100 !text-petrol-900">
        {title}
      </th>
    </tr>
  );

  const saveDecision = async () => {
    const d = { alternatives: scen.map((s) => s.id), chosen: chosen || null, outcome, rationale };
    const errs = validateDecision(d);
    if (!author.trim()) errs.push('Indica l’autore della decisione.');
    setFormErrors(errs);
    if (errs.length) return;
    const now = new Date().toISOString();
    const decision: Decision = {
      id: newId(),
      projectId: bundle.project.id,
      sector: 'urban',
      ...d,
      author: author.trim(),
      supervisor: null,
      state: 'bozza',
      history: [{ at: now, actor: author.trim(), action: 'creazione (bozza)', rationale }],
      createdAt: now,
    };
    await update((b) => ({ ...b, decisions: [...b.decisions, decision] }), { action: 'decisione', detail: `Decisione registrata: ${outcome}${chosen ? ` (${labels[chosen]})` : ''}` });
    setRationale('');
  };

  const sendToReview = (d: Decision) =>
    update(
      (b) => ({
        ...b,
        decisions: b.decisions.map((x) =>
          x.id === d.id
            ? { ...x, state: 'inviata_a_revisione' as const, history: [...x.history, { at: new Date().toISOString(), actor: x.author, action: 'invio a revisione', rationale: 'Pronta per la validazione tecnica' }] }
            : x,
        ),
      }),
      { action: 'decisione', detail: 'Decisione inviata a revisione' },
    );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-sand-600">{bundle.project.name}</p>
        <h1 className="text-2xl font-extrabold text-petrol-900">Confronto scenari e decisione</h1>
      </div>
      {bundle.project.mode === 'demo' && <DemoRibbon />}

      <Section title="Scenari da confrontare">
        {withRuns.length < 2 ? (
          <Alert tone="warn">
            Servono almeno due scenari calcolati. <Link to={`/progetti/${bundle.project.id}/urbano`} className="underline">Torna al Lab</Link>
          </Alert>
        ) : (
          <div className="flex flex-wrap gap-3">
            {withRuns.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" className="size-5" checked={sel.includes(s.id)} onChange={(e) => setSelected(e.target.checked ? [...sel, s.id] : sel.filter((x) => x !== s.id))} />
                {s.label} — {s.description.slice(0, 50)}
              </label>
            ))}
          </div>
        )}
        {scen.length >= 2 && !comparable && (
          <Alert tone="error" title="Confronto non equo: bloccato">
            {[...cmp.reasons, ...cmpRuns.reasons].map((r) => (
              <p key={r}>{r}</p>
            ))}
            <p>Ricalcola gli scenari sulla stessa baseline e con lo stesso modello.</p>
          </Alert>
        )}
        {comparable && baseline && (
          <Alert tone="ok">
            Stessa baseline (v{baseline.version}, {baseline.periodStart} → {baseline.periodEnd}, ore {String(baseline.referenceHourLocal).padStart(2, '0')}:00), stesso modello ({runs[0]!.modelRef}), stessa griglia ({runs[0]!.cellSizeM} m), stesso orizzonte.
          </Alert>
        )}
      </Section>

      {comparable && (
        <>
          <Section title="Tabella di confronto">
            <div className="overflow-x-auto">
              <table className="table-base min-w-[44rem]">
                <caption className="sr-only">Confronto tra baseline e scenari</caption>
                <thead>
                  <tr>
                    <th scope="col">Voce</th>
                    <th scope="col">Baseline</th>
                    {scen.map((s) => (
                      <th key={s.id} scope="col">
                        Scenario {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groupRow('Effetti climatici (ora di riferimento)')}
                  {row('Riduzione termica stimata — aria 2 m', '—', (r) => out(r, 'delta_t_air') && <DataBadge value={out(r, 'delta_t_air')!} />)}
                  {row('Riduzione stimata — T superficiale media', '—', (r) => out(r, 'delta_t_surface') && <DataBadge value={out(r, 'delta_t_surface')!} />)}
                  {row('Massima riduzione superficiale in una cella', '—', (r) => out(r, 'delta_t_surface_max_cell') && <DataBadge value={out(r, 'delta_t_surface_max_cell')!} />)}
                  {row('Temperatura aria 2 m', baseVal('t_air_ref_hour') ? <DataBadge value={baseVal('t_air_ref_hour')!} compact /> : '—', (r) => out(r, 't_air_scenario') && <DataBadge value={out(r, 't_air_scenario')!} />)}
                  {row('Temperatura superficiale', baseVal('t_surface_ref_hour') ? <DataBadge value={baseVal('t_surface_ref_hour')!} compact /> : '—', (r) => out(r, 't_surface_scenario') && <DataBadge value={out(r, 't_surface_scenario')!} />)}
                  {row('Superficie con riduzione superficiale ≥ 2 °C', '—', (r) => out(r, 'area_benefited') && <DataBadge value={out(r, 'area_benefited')!} />)}
                  {row(<Term k="utci">Comfort UTCI/WBGT</Term>, 'Dato mancante', (r) => out(r, 'comfort_index') && <DataBadge value={out(r, 'comfort_index')!} compact />)}

                  {groupRow('Costi (parametri illustrativi DEMO)')}
                  {row('Costo del prototipo software', '—', (r) => (
                    <span title={r.costs.prototype.note}>
                      {r.costs.prototype.value} € <span className="text-xs text-sand-600">(separato: non include l’intervento)</span>
                    </span>
                  ))}
                  {row(<Term k="capex">CAPEX intervento</Term>, '—', (r) => eur(r.costs.capex))}
                  {row(<Term k="opex">OPEX annuo</Term>, '—', (r) => eur(r.costs.opexYear, '€/anno'))}
                  {row('Consumo idrico', '—', (r) => eur(r.costs.waterM3Year, 'm³/anno'))}
                  {row('Tempo di realizzazione', '—', (r) => `${r.costs.realizationWeeks[0]}–${r.costs.realizationWeeks[2]} settimane`)}

                  {groupRow('Fattibilità')}
                  {row('Interventi e quantità', '—', (r) => (
                    <ul className="space-y-0.5">
                      {r.costs.lines.map((l) => (
                        <li key={l.interventionId}>
                          {l.label}: {formatNumber(l.quantity, l.unit)}
                        </li>
                      ))}
                    </ul>
                  ))}
                  {row('Manutenzione', '—', (r) => (
                    <ul className="list-disc space-y-0.5 pl-4 text-xs">
                      {[...new Set(r.costs.lines.map((l) => `${INTERVENTION_LABEL[l.type]}: ${l.maintenance}`))].map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  ))}
                  {row('Vincoli', '—', (r) => <span className="text-xs">{[...new Set(r.costs.lines.flatMap((l) => l.constraints))].join(', ')}</span>)}
                  {row('Co-benefici', '—', (r) => <span className="text-xs">{[...new Set(r.costs.lines.flatMap((l) => l.coBenefits))].join(', ')}</span>)}
                  {row('Avvisi di plausibilità', '—', (r) => <span className="text-xs">{r.checks.map((c) => c.message).join(' ') || 'nessuno'}</span>)}

                  {groupRow('Dati, qualità e modello')}
                  {row('Qualità e copertura dati', baseline ? `${baseline.sourceSummary}${baseline.isDemo && !baseline.sourceSummary.includes('DEMO') ? ' (DEMO)' : ''}` : '—', () => 'come baseline')}
                  {row('Dati mancanti', baseline?.values.filter((v) => v.dataClass === 'DATO_MANCANTE').map((v) => v.label).join(', ') || 'nessuno', (r) => r.outputs.filter((o) => o.dataClass === 'DATO_MANCANTE').map((o) => o.label).join(', ') || 'nessuno')}
                  {row('Modello e versione', '—', (r) => <code className="text-xs">{r.modelRef}</code>)}
                  {row('Hash input / output', baseline ? <code className="text-xs">bl {baseline.contentHash.slice(0, 8)}</code> : '—', (r) => (
                    <code className="text-xs">
                      {r.inputHash.slice(0, 8)} / {r.outputHash.slice(0, 8)}
                    </code>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Incertezza a colpo d’occhio">
            <div className="grid gap-4 lg:grid-cols-2">
              <IntervalChart title="Riduzione stimata T superficiale media (°C)" rows={runs.map((r) => ({ label: labels[r.scenarioId]!, v: out(r, 'delta_t_surface') }))} />
              <IntervalChart title="Riduzione termica stimata aria 2 m (°C)" rows={runs.map((r) => ({ label: labels[r.scenarioId]!, v: out(r, 'delta_t_air') }))} />
            </div>
          </Section>

          {grid && bundle.area && (
            <Section title="Mappe delle differenze affiancate">
              <CoolingLegend title="ΔT superficiale per cella (scenario − baseline), SIMULATO, stessa scala per tutte le mappe" />
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {runs.slice(0, 3).map((r) => {
                  const byId = new Map(grid.cells.map((c) => [c.id, c]));
                  const polys: MapPolygon[] = [{ id: 'aoi', geometry: bundle.area!.geometry, kind: 'aoi' }];
                  for (const c of r.cells) {
                    const g = byId.get(c.id);
                    if (g && c.dTs < -0.05) polys.push({ id: c.id, geometry: g.polygon, kind: 'cella', color: coolingColor(c.dTs) });
                  }
                  return (
                    <div key={r.scenarioId}>
                      <p className="mb-1 text-sm font-bold">Scenario {labels[r.scenarioId]}</p>
                      <MapView ariaLabel={`Mappa delle differenze scenario ${labels[r.scenarioId]}`} polygons={polys} fitTo={bundle.area!.geometry} height="16rem" />
                    </div>
                  );
                })}
              </div>
              {runs.length > 3 && <p className="text-xs text-sand-600">Mostrate le prime 3 mappe; i valori di tutti gli scenari sono in tabella.</p>}
            </Section>
          )}

          {perms.canEdit ? (
          <Section title="Decisione motivata">
            <p className="text-sm">L’app non sceglie: registra la tua scelta, le alternative considerate e la motivazione. Nessuna validità legale automatica.</p>
            {formErrors.length > 0 && (
              <Alert tone="error" title="Completa la decisione">
                {formErrors.map((e) => (
                  <p key={e}>{e}</p>
                ))}
              </Alert>
            )}
            <fieldset>
              <legend className="label">Esito</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {OUTCOMES.map((o) => (
                  <label key={o.value} className="flex min-h-11 items-center gap-2 rounded-lg border-2 border-sand-200 px-3 text-sm">
                    <input type="radio" name="outcome" className="size-5" checked={outcome === o.value} onChange={() => setOutcome(o.value)} />
                    {o.label}
                  </label>
                ))}
              </div>
            </fieldset>
            {(outcome === 'accettata' || outcome === 'modificata') && (
              <Field label="Alternativa scelta" htmlFor="chosen">
                <select id="chosen" className="input" value={chosen} onChange={(e) => setChosen(e.target.value)}>
                  <option value="">— seleziona —</option>
                  {scen.map((s) => (
                    <option key={s.id} value={s.id}>
                      Scenario {s.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Motivazione (benefici, costi, vincoli, incertezza)" htmlFor="rat" hint="Almeno 20 caratteri. Sarà riportata nel dossier.">
              <textarea id="rat" className="input" rows={4} value={rationale} onChange={(e) => setRationale(e.target.value)} />
            </Field>
            <Field label="Autore" htmlFor="author">
              <input id="author" className="input" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Nome e ruolo" autoComplete="name" />
            </Field>
            <button type="button" className="btn-primary" onClick={saveDecision}>
              Registra decisione (bozza)
            </button>
          </Section>
          ) : (
            <Section title="Decisione motivata">
              <p className="text-sm text-sand-600">Sola lettura: le decisioni le registra chi ha il ruolo “modifica”. Qui sotto trovi quelle già registrate.</p>
            </Section>
          )}
        </>
      )}

      {bundle.decisions.length > 0 && (
        <Section title="Registro delle decisioni">
          <ul className="space-y-3">
            {bundle.decisions.map((d) => (
              <li key={d.id} className="rounded-lg border border-sand-200 p-3 text-sm">
                <p className="font-bold">
                  {d.outcome}
                  {d.chosen && ` — scenario ${labels[d.chosen] ?? '?'}`} · stato: {d.state === 'bozza' ? 'bozza' : 'inviata a revisione'}
                </p>
                <p className="mt-1">{d.rationale}</p>
                <p className="mt-1 text-xs text-sand-600">Alternative: {d.alternatives.map((a) => labels[a] ?? a).join(', ')}</p>
                <ol className="mt-2 space-y-0.5 text-xs text-sand-600">
                  {d.history.map((h) => (
                    <li key={h.at + h.action}>
                      {new Date(h.at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })} · {h.actor} · {h.action}
                    </li>
                  ))}
                </ol>
                {perms.canEdit && d.state === 'bozza' && (
                  <button type="button" className="btn-secondary mt-2" onClick={() => sendToReview(d)}>
                    Invia a revisione
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-sand-600">Workflow completo (validazione tecnica → approvazione → esecuzione → monitoraggio → chiusura) in Milestone 1.</p>
        </Section>
      )}

      <Section title="Esporta">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => downloadText(`${bundle.project.name.replace(/[^\w-]+/g, '_')}.mdt.json`, JSON.stringify(exportProject(bundle, new Date()), null, 2))}
          >
            Progetto completo (JSON reimportabile)
          </button>
          {withRuns.map((s) => (
            <button
              key={s.id}
              type="button"
              className="btn-ghost"
              onClick={() => downloadText(`scenario_${s.label}.geojson`, JSON.stringify(scenarioToGeoJson(bundle, s.id, new Date()), null, 2), 'application/geo+json')}
            >
              GeoJSON scenario {s.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-sand-600">Ogni export contiene hash, baseline, modello, versione, fonti, ipotesi, output e decisioni. PDF tecnico e CSV con dizionario campi: Milestone 1.</p>
      </Section>
    </div>
  );
}
