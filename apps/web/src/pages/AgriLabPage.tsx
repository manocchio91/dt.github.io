import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchAgriWeather,
  formatArea,
  geodesicAreaM2,
  newId,
  PHENOLOGY_LABEL,
  PHENOLOGY_STAGES,
  PRIORITY_RANK,
  runDemoAgriModel,
  validateAoi,
  validateDecision,
  type AgriState,
  type ConnectorError,
  type Decision,
  type DecisionOutcome,
  type FieldObservation,
  type PhenologyStage,
  type VineyardSetup,
  type VineyardZone,
} from '@mdt/domain';
import { ClassChip, DataBadge } from '../components/DataBadge';
import { MapView, type MapPolygon } from '../components/MapView';
import { Alert, DemoRibbon, Field, LevelPill, Section, Term } from '../components/ui';
import { ProjectMissing, useProject } from '../state/useProject';
import { todayRome } from '../state/store';
import { usePermissions } from '../state/permissions';
import { GuideBanner } from '../components/guide';

const num = (s: string): number | null => {
  if (s.trim() === '') return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const ZONE_COLORS = { alta: '#8a2417', media: '#c8963e', bassa: '#3d7a47', 'non determinabile': '#a99d8a' } as const;

export default function AgriLabPage() {
  const { bundle, ready, update } = useProject();
  const [draft, setDraft] = useState<{ setup: VineyardSetup; zones: VineyardZone[] } | null>(null);
  const [confirmer, setConfirmer] = useState('');
  const [fetchState, setFetchState] = useState<{ status: 'idle' | 'loading' | 'error' | 'ok'; error?: ConnectorError }>({ status: 'idle' });
  const [obs, setObs] = useState<{ zoneId: string; category: FieldObservation['category']; note: string; value: string; cls: 'INSERITO_DALL_UTENTE' | 'MISURATO' }>({
    zoneId: '',
    category: 'visivo',
    note: '',
    value: '',
    cls: 'INSERITO_DALL_UTENTE',
  });
  const [zoneSel, setZoneSel] = useState<string | null>(null);
  const [dec, setDec] = useState<{ alternatives: string[]; chosen: string; outcome: DecisionOutcome; rationale: string; author: string; supervisor: string }>({
    alternatives: [],
    chosen: '',
    outcome: 'accettata',
    rationale: '',
    author: '',
    supervisor: '',
  });
  const [decErrors, setDecErrors] = useState<string[]>([]);
  const { canEdit } = usePermissions();

  const agri = bundle?.agri ?? null;
  const assessments = useMemo(
    () =>
      agri
        ? runDemoAgriModel({
            setup: agri.setup,
            zones: agri.zones,
            weather: agri.weather,
            observations: agri.observations,
            today: agri.today,
            computedAt: new Date().toISOString(),
            isDemo: bundle?.project.mode === 'demo',
          })
        : [],
    [agri, bundle?.project.mode],
  );

  if (!bundle) return <ProjectMissing ready={ready} />;
  if (!bundle.area || !agri) {
    return (
      <Alert tone="warn" title="Parcella non definita">
        <Link to={`/progetti/${bundle.project.id}/area`} className="underline">
          Disegna o importa la parcella
        </Link>
      </Alert>
    );
  }

  const view = draft ?? { setup: agri.setup, zones: agri.zones };
  const editSetup = (patch: Partial<VineyardSetup>) => setDraft({ ...view, setup: { ...view.setup, ...patch } });
  const editZone = (id: string, patch: Partial<VineyardZone>) => setDraft({ ...view, zones: view.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) });
  const saveAgri = (patch: Partial<AgriState>, detail: string) => update((b) => ({ ...b, agri: b.agri ? { ...b.agri, ...patch } : b.agri }), { action: 'agricolo', detail });

  const sorted = [...assessments].sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
  const first = sorted[0];
  const selected = assessments.find((a) => a.zoneId === zoneSel) ?? first;
  const stale = (Date.parse(todayRome()) - Date.parse(agri.today)) / 86_400_000 > 3;
  const lastDecision = [...bundle.decisions].reverse().find((d) => d.sector === 'agriculture');

  const polygons: MapPolygon[] = [
    { id: 'parcel', geometry: bundle.area.geometry, kind: 'aoi' },
    ...agri.zones.map((z) => {
      const a = assessments.find((x) => x.zoneId === z.id);
      return { id: z.id, geometry: z.geometry, kind: 'zona' as const, color: ZONE_COLORS[a?.priority ?? 'non determinabile'] };
    }),
  ];

  const refreshWeather = async () => {
    const c = validateAoi(bundle.area!.geometry).centroid;
    if (!c) return;
    setFetchState({ status: 'loading' });
    const today = todayRome();
    const res = await fetchAgriWeather({ lat: c.lat, lon: c.lon, today });
    if (!res.ok) return setFetchState({ status: 'error', error: res.error });
    await saveAgri({ weather: res.value, today, weatherNote: `Open-Meteo Forecast (giorni passati), acquisito il ${today}${res.fromCache ? ' (cache)' : ''}.` }, 'Meteo aggiornato da Open-Meteo');
    setFetchState({ status: 'ok' });
  };

  const addObservation = async () => {
    const zoneId = obs.zoneId || agri.zones[0]?.id;
    if (!zoneId || !obs.note.trim()) return;
    const value = obs.category === 'misura_suolo' ? num(obs.value) : null;
    if (obs.category === 'misura_suolo' && (value === null || value <= 0 || value >= 0.7)) return;
    const o: FieldObservation = {
      id: newId(),
      zoneId,
      date: todayRome(),
      category: obs.category,
      note: obs.note.trim(),
      ...(value !== null ? { value, unit: 'm³/m³' } : {}),
      dataClass: obs.cls,
    };
    await saveAgri({ observations: [...agri.observations, o], today: todayRome() }, `Osservazione registrata (${o.category})`);
    setObs({ ...obs, note: '', value: '' });
  };

  const saveDecision = async () => {
    if (!selected) return;
    const errs = validateDecision({ alternatives: dec.alternatives, chosen: dec.chosen || null, outcome: dec.outcome, rationale: dec.rationale });
    if (!dec.author.trim()) errs.push('Indica chi registra la decisione.');
    if (!dec.supervisor.trim()) errs.push('Indica l’agronomo o il supervisore consultato (oppure "da consultare").');
    setDecErrors(errs);
    if (errs.length) return;
    const now = new Date().toISOString();
    const d: Decision = {
      id: newId(),
      projectId: bundle.project.id,
      sector: 'agriculture',
      alternatives: dec.alternatives,
      chosen: dec.chosen || null,
      outcome: dec.outcome,
      rationale: dec.rationale,
      author: dec.author.trim(),
      supervisor: dec.supervisor.trim(),
      state: 'bozza',
      history: [{ at: now, actor: dec.author.trim(), action: `decisione per ${selected.zoneName}`, rationale: dec.rationale }],
      createdAt: now,
      assessmentSnapshot: {
        zoneId: selected.zoneId,
        priority: selected.priority,
        confidence: selected.confidence,
        levels: Object.fromEntries(selected.components.map((c) => [c.label, c.level])),
        at: now,
      },
    };
    await update((b) => ({ ...b, decisions: [...b.decisions, d] }), { action: 'decisione', detail: `Decisione registrata per ${selected.zoneName}` });
    setDec({ ...dec, rationale: '', alternatives: [], chosen: '' });
  };

  const snapshotZone = lastDecision?.assessmentSnapshot && assessments.find((a) => a.zoneId === lastDecision.assessmentSnapshot!.zoneId);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-sand-600">{bundle.project.name}</p>
        <h1 className="text-2xl font-extrabold text-petrol-900">Decision Lab agricolo</h1>
      </div>
      {bundle.project.mode === 'demo' && <DemoRibbon />}
      <GuideBanner
        readOnlyHint="Sola lettura: consulta la zona da controllare, le componenti e il confronto tra misure."
        steps={[
          { done: agri.zones.length > 0, label: 'definisci le sottozone della parcella', anchor: 'a1' },
          { done: agri.zones.every((z) => z.fieldCapacity !== null && z.wiltingPoint !== null), label: 'completa i dati del suolo per ogni zona', anchor: 'a2' },
          { done: agri.setup.phenology.confirmed, label: 'conferma la fase della vite osservata in campo', anchor: 'a3' },
          { done: !!agri.weather, label: 'aggiorna i dati meteo', anchor: 'a4' },
          { done: bundle.decisions.some((d) => d.sector === 'agriculture'), label: 'confronta le misure e registra la decisione', anchor: 'a7' },
        ]}
      />

      {first && (
        <section className="card border-l-8 border-l-alert-800" aria-labelledby="first-zone">
          <p className="text-xs font-bold tracking-wide text-sand-600 uppercase">Prima zona da controllare</p>
          <h2 id="first-zone" className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-extrabold text-petrol-900">
            {first.zoneName} <LevelPill level={first.priority} prefix="priorità" />
            <span className="rounded border border-sand-400 px-2 py-0.5 text-xs font-bold text-sand-600">fiducia {first.confidence}</span>
          </h2>
          <p className="mt-2">{first.motivation}</p>
          {first.missingData.length > 0 && <p className="mt-1 text-sm text-sand-600">Per aumentare la fiducia servono: {first.missingData.join(', ')}.</p>}
          <p className="mt-2 text-sm font-semibold">Questo è un segnale da verificare, non una diagnosi né una prescrizione.</p>
          {stale && <Alert tone="warn">Dati riferiti al {agri.today}: aggiorna meteo e osservazioni prima di decidere.</Alert>}
        </section>
      )}

      <Section id="a1" step={1} title="Parcelle e sottozone">
        <MapView ariaLabel="Mappa della parcella con sottozone colorate per priorità" polygons={polygons} fitTo={bundle.area.geometry} height="18rem" />
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {Object.entries(ZONE_COLORS).map(([k, c]) => (
            <li key={k} className="flex items-center gap-1">
              <span className="inline-block size-4 rounded-sm" style={{ background: c }} aria-hidden="true" /> priorità {k}
            </li>
          ))}
        </ul>
        <p className="text-sm">
          Parcella {formatArea(bundle.area.areaM2)} · {agri.zones.length} sottozone ({agri.zones.map((z) => `${z.name} ${formatArea(geodesicAreaM2(z.geometry))}`).join(', ')}) ·{' '}
          <Link to={`/progetti/${bundle.project.id}/area`} className="font-semibold text-petrol-700 underline">
            modifica
          </Link>
        </p>
        {bundle.area.isDemonstrativeGeometry && <p className="text-xs font-semibold text-ochre-800">Geometria dimostrativa approssimata.</p>}
        {agri.zones.length === 0 && <Alert tone="warn">Aggiungi almeno una sottozona nella pagina Parcelle.</Alert>}
      </Section>

      <Section
        id="a2"
        step={2}
        title="Input agronomici"
        aside={
          canEdit && draft && (
            <div className="flex gap-2">
              <button type="button" className="btn-primary" onClick={async () => { await saveAgri({ setup: draft.setup, zones: draft.zones }, 'Input agronomici aggiornati'); setDraft(null); }}>
                Salva input
              </button>
              <button type="button" className="btn-ghost" onClick={() => setDraft(null)}>
                Annulla
              </button>
            </div>
          )
        }
      >
        {draft && <Alert tone="warn">Modifiche non salvate: la valutazione usa ancora gli input salvati.</Alert>}
        {!canEdit ? (
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[14rem_1fr]">
            <dt className="font-semibold text-sand-600">Coltura</dt>
            <dd>Vite · {agri.setup.cultivar || 'cultivar n.d.'} · portinnesto {agri.setup.rootstock || 'n.d.'} · sesto {agri.setup.spacing || 'n.d.'}</dd>
            <dt className="font-semibold text-sand-600">Irrigazione</dt>
            <dd>
              {agri.setup.irrigationSystem} · capacità {agri.setup.irrigationCapacityMmDay ?? 'n.d.'} mm/giorno
            </dd>
            <dt className="font-semibold text-sand-600">Soglia Tmax (DEMO)</dt>
            <dd>{agri.setup.heatThresholdC} °C</dd>
            {agri.zones.map((z) => (
              <div key={z.id} className="contents">
                <dt className="font-semibold text-sand-600">{z.name}</dt>
                <dd>
                  {z.soilTexture || 'tessitura n.d.'} · θcc {z.fieldCapacity ?? 'n.d.'} · θpa {z.wiltingPoint ?? 'n.d.'} · esposizione {z.aspectDeg ?? 'n.d.'}° · pendenza {z.slopePct ?? 'n.d.'}%
                </dd>
              </div>
            ))}
          </dl>
        ) : (
        <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Coltura" htmlFor="crop">
            <input id="crop" className="input" value="Vite" disabled />
          </Field>
          <Field label="Cultivar" htmlFor="cv">
            <input id="cv" className="input" value={view.setup.cultivar} onChange={(e) => editSetup({ cultivar: e.target.value })} />
          </Field>
          <Field label="Portinnesto" htmlFor="rs">
            <input id="rs" className="input" value={view.setup.rootstock} onChange={(e) => editSetup({ rootstock: e.target.value })} />
          </Field>
          <Field label="Sesto d’impianto" htmlFor="sp">
            <input id="sp" className="input" value={view.setup.spacing} onChange={(e) => editSetup({ spacing: e.target.value })} />
          </Field>
          <Field label="Sistema irriguo" htmlFor="irr">
            <select id="irr" className="input" value={view.setup.irrigationSystem} onChange={(e) => editSetup({ irrigationSystem: e.target.value as VineyardSetup['irrigationSystem'] })}>
              <option value="nessuno">Nessuno (asciutto)</option>
              <option value="goccia">Goccia</option>
              <option value="soccorso_mobile">Soccorso mobile</option>
            </select>
          </Field>
          <Field label="Capacità irrigua disponibile (mm/giorno)" htmlFor="cap">
            <input id="cap" inputMode="decimal" className="input" value={view.setup.irrigationCapacityMmDay ?? ''} onChange={(e) => editSetup({ irrigationCapacityMmDay: num(e.target.value) })} />
          </Field>
          <Field label="Soglia Tmax stress termico (°C)" htmlFor="thr" hint="Parametro DEMO da validare con l’agronomo per cultivar e fase.">
            <input id="thr" inputMode="decimal" className="input" value={view.setup.heatThresholdC} onChange={(e) => editSetup({ heatThresholdC: num(e.target.value) ?? 35 })} />
          </Field>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base min-w-[44rem]">
            <caption className="text-left text-sm font-semibold">Suolo e morfologia per sottozona</caption>
            <thead>
              <tr>
                <th scope="col">Zona</th>
                <th scope="col">Tessitura / profondità</th>
                <th scope="col">
                  <Term k="capacita_campo">θ capacità di campo</Term> (m³/m³)
                </th>
                <th scope="col">
                  <Term k="appassimento">θ appassimento</Term> (m³/m³)
                </th>
                <th scope="col">Esposizione (°)</th>
                <th scope="col">Pendenza (%)</th>
              </tr>
            </thead>
            <tbody>
              {view.zones.map((z) => (
                <tr key={z.id}>
                  <th scope="row">{z.name}</th>
                  <td>
                    <input aria-label={`Tessitura ${z.name}`} className="input" value={z.soilTexture} onChange={(e) => editZone(z.id, { soilTexture: e.target.value })} />
                  </td>
                  <td>
                    <input aria-label={`Capacità di campo ${z.name}`} inputMode="decimal" className="input w-24" value={z.fieldCapacity ?? ''} onChange={(e) => editZone(z.id, { fieldCapacity: num(e.target.value) })} />
                  </td>
                  <td>
                    <input aria-label={`Punto di appassimento ${z.name}`} inputMode="decimal" className="input w-24" value={z.wiltingPoint ?? ''} onChange={(e) => editZone(z.id, { wiltingPoint: num(e.target.value) })} />
                  </td>
                  <td>
                    <input aria-label={`Esposizione ${z.name}`} inputMode="decimal" className="input w-20" value={z.aspectDeg ?? ''} onChange={(e) => editZone(z.id, { aspectDeg: num(e.target.value) })} />
                  </td>
                  <td>
                    <input aria-label={`Pendenza ${z.name}`} inputMode="decimal" className="input w-20" value={z.slopePct ?? ''} onChange={(e) => editZone(z.id, { slopePct: num(e.target.value) })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
        )}
        <p className="text-xs text-sand-600">Tutti i valori sono INSERITI DALL’UTENTE: un campo vuoto resta un dato mancante e riduce la fiducia.</p>
      </Section>

      <Section id="a3" step={3} title="Fase fenologica (conferma obbligatoria)">
        <div className="grid gap-3 sm:grid-cols-2">
          {canEdit ? (
          <Field label={<Term k="fenologia">Fase osservata</Term>} htmlFor="ph">
            <select
              id="ph"
              className="input"
              value={agri.setup.phenology.stage ?? ''}
              onChange={(e) =>
                saveAgri(
                  { setup: { ...agri.setup, phenology: { stage: (e.target.value || null) as PhenologyStage | null, confirmed: false, confirmedBy: null, confirmedAt: null } } },
                  'Fase fenologica selezionata (da confermare)',
                )
              }
            >
              <option value="">— seleziona —</option>
              {PHENOLOGY_STAGES.map((s) => (
                <option key={s} value={s}>
                  {PHENOLOGY_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          ) : (
            <p className="text-sm">
              Fase selezionata: <strong>{agri.setup.phenology.stage ? PHENOLOGY_LABEL[agri.setup.phenology.stage] : 'nessuna'}</strong>
            </p>
          )}
          {agri.setup.phenology.confirmed ? (
            <Alert tone="ok">
              Confermata da {agri.setup.phenology.confirmedBy} il {new Date(agri.setup.phenology.confirmedAt!).toLocaleDateString('it-IT')}.
            </Alert>
          ) : !canEdit ? (
            <Alert tone="warn">Fase non ancora confermata da chi lavora in campo.</Alert>
          ) : (
            <div className="space-y-2">
              <Field label="Chi conferma (osservazione in campo)" htmlFor="cf">
                <input id="cf" className="input" value={confirmer} onChange={(e) => setConfirmer(e.target.value)} placeholder="Nome e ruolo" />
              </Field>
              <button
                type="button"
                className="btn-primary"
                disabled={!agri.setup.phenology.stage || !confirmer.trim()}
                onClick={() =>
                  saveAgri(
                    { setup: { ...agri.setup, phenology: { ...agri.setup.phenology, confirmed: true, confirmedBy: confirmer.trim(), confirmedAt: new Date().toISOString() } } },
                    `Fase fenologica confermata da ${confirmer.trim()}`,
                  )
                }
              >
                Confermo la fase osservata
              </button>
              <p className="text-xs text-sand-600">L’app non deduce la fase: senza conferma è un dato mancante.</p>
            </div>
          )}
        </div>
      </Section>

      <Section id="a4" step={4} title="Dati disponibili">
        <p className="text-sm">
          {agri.weatherNote} Data di riferimento dell’analisi: <strong>{agri.today}</strong>.
        </p>
        {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary" onClick={refreshWeather} disabled={fetchState.status === 'loading'}>
            {fetchState.status === 'loading' ? 'Richiesta…' : 'Aggiorna da Open-Meteo'}
          </button>
          <span className="text-xs text-sand-600">Stime modellistiche alle coordinate della parcella, non stazione nel vigneto.</span>
        </div>
        )}
        {fetchState.status === 'error' && fetchState.error && (
          <Alert tone="error" title={`Meteo non disponibile (${fetchState.error.code})`}>
            <p>{fetchState.error.message} Nessun valore sostitutivo è stato inserito: restano i dati precedenti con la loro data.</p>
          </Alert>
        )}
        {agri.weather ? (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-sand-200 p-3">
              <p className="text-sm font-semibold">Umidità del suolo</p>
              <DataBadge value={agri.weather.soilMoisture} />
              <p className="mt-1 text-xs text-sand-600">{agri.weather.soilMoisture.lineage.depth} · stima riferita all’area, non misurata sul terreno</p>
            </div>
            <div className="rounded-lg border border-sand-200 p-3">
              <p className="text-sm font-semibold">Precipitazione 14 giorni</p>
              <DataBadge value={agri.weather.precipitation14d} />
            </div>
            <div className="rounded-lg border border-sand-200 p-3">
              <p className="text-sm font-semibold">
                Tmax giornaliera ({agri.weather.dailyTmax.length} gg) <ClassChip dataClass={agri.weather.dailyTmaxClass} />
              </p>
              <ol className="mt-1 flex flex-wrap gap-1 text-xs tabular-nums" aria-label="Temperature massime giornaliere">
                {agri.weather.dailyTmax.map((d) => (
                  <li key={d.date} className={`rounded px-1 ${d.value >= agri.setup.heatThresholdC ? 'bg-alert-100 font-bold text-alert-800' : 'bg-sand-100'}`} title={d.date}>
                    {d.date.slice(8)}: {d.value.toFixed(0)}°{d.value >= agri.setup.heatThresholdC ? '▲' : ''}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : (
          <Alert tone="warn">Nessun dato meteo: stress termico e idrico non determinabili.</Alert>
        )}

        <h3 className="pt-2 font-bold">Osservazioni in campo</h3>
        <ul className="space-y-1 text-sm">
          {agri.observations.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-2 rounded bg-sand-100 px-3 py-1.5">
              <span>{o.date}</span>
              <strong>{agri.zones.find((z) => z.id === o.zoneId)?.name}</strong>
              <span>
                {o.category}: {o.note}
                {o.value !== undefined && ` — ${o.value} ${o.unit}`}
              </span>
              <ClassChip dataClass={o.dataClass} />
            </li>
          ))}
          {agri.observations.length === 0 && <li>Nessuna osservazione.</li>}
        </ul>
        {canEdit && (
        <fieldset className="grid gap-3 rounded-lg border-2 border-sand-200 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="px-1 font-semibold">Registra osservazione (oggi)</legend>
          <Field label="Zona" htmlFor="oz">
            <select id="oz" className="input" value={obs.zoneId || agri.zones[0]?.id} onChange={(e) => setObs({ ...obs, zoneId: e.target.value })}>
              {agri.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tipo" htmlFor="oc">
            <select id="oc" className="input" value={obs.category} onChange={(e) => setObs({ ...obs, category: e.target.value as FieldObservation['category'] })}>
              <option value="visivo">Osservazione visiva</option>
              <option value="trappola">Trappola</option>
              <option value="misura_suolo">Misura umidità suolo</option>
              <option value="altro">Altro</option>
            </select>
          </Field>
          <Field label="Nota" htmlFor="on">
            <input id="on" className="input" value={obs.note} onChange={(e) => setObs({ ...obs, note: e.target.value })} placeholder="es. foglie basali ingiallite" />
          </Field>
          {obs.category === 'misura_suolo' && (
            <>
              <Field label="θ misurata (m³/m³)" htmlFor="ov">
                <input id="ov" inputMode="decimal" className="input" value={obs.value} onChange={(e) => setObs({ ...obs, value: e.target.value })} placeholder="0,18" />
              </Field>
              <Field label="Origine" htmlFor="ocl">
                <select id="ocl" className="input" value={obs.cls} onChange={(e) => setObs({ ...obs, cls: e.target.value as typeof obs.cls })}>
                  <option value="INSERITO_DALL_UTENTE">Stima/lettura manuale</option>
                  <option value="MISURATO">Sensore identificato e controllato</option>
                </select>
              </Field>
            </>
          )}
          <div className="flex items-end">
            <button type="button" className="btn-primary" onClick={addObservation}>
              Registra
            </button>
          </div>
        </fieldset>
        )}
        <p className="text-xs text-sand-600">
          <Link to={`/progetti/${bundle.project.id}/documenti`} className="font-semibold text-petrol-700 underline">
            Foto e documenti della parcella
          </Link>{' '}
          — una fotografia documenta l’osservazione, non costituisce una diagnosi agronomica.
        </p>
      </Section>

      <Section id="a5" step={5} title="Componenti per zona (lette separatamente)">
        <div className="overflow-x-auto">
          <table className="table-base min-w-[48rem]">
            <thead>
              <tr>
                <th scope="col">Zona</th>
                {assessments[0]?.components.map((c) => (
                  <th key={c.key} scope="col">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assessments.map((a) => (
                <tr key={a.zoneId}>
                  <th scope="row">{a.zoneName}</th>
                  {a.components.map((c) => (
                    <td key={c.key} className="space-y-1">
                      <LevelPill level={c.level} />
                      <div>
                        <DataBadge value={c.value} compact />
                      </div>
                      <p className="text-xs text-sand-600">{c.explanation}</p>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-sand-600">
          Nessun indice unico. Regola di priorità dichiarata: {assessments[0]?.priorityRule} Modello <code>demo-vineyard-components@0.1.0</code>.
        </p>
      </Section>

      <Section id="a6" step={6} title="Zone da controllare">
        <ol className="space-y-2">
          {sorted.map((a, i) => (
            <li key={a.zoneId} className="rounded-lg border border-sand-200 p-3">
              <p className="flex flex-wrap items-center gap-2 font-bold">
                {i + 1}. {a.zoneName} <LevelPill level={a.priority} prefix="priorità" /> <span className="text-sm font-semibold text-sand-600">fiducia {a.confidence}</span>
              </p>
              <p className="mt-1 text-sm">{a.motivation}</p>
              {a.confidenceReasons.length > 0 && (
                <details className="mt-1 text-sm">
                  <summary className="cursor-pointer font-semibold text-petrol-700">Perché la fiducia è {a.confidence}</summary>
                  <ul className="list-disc pl-5">
                    {a.confidenceReasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ol>
      </Section>

      {selected && (
        <Section
          id="a7"
          step={7}
          title={`Confronto tra misure — ${selected.zoneName}`}
          aside={
            assessments.length > 1 && (
              <select className="input w-auto" aria-label="Zona" value={selected.zoneId} onChange={(e) => setZoneSel(e.target.value)}>
                {assessments.map((a) => (
                  <option key={a.zoneId} value={a.zoneId}>
                    {a.zoneName}
                  </option>
                ))}
              </select>
            )
          }
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {selected.measures.map((m) => (
              <article key={m.id} className={`rounded-lg border-2 p-3 ${m.availability === 'valutabile' ? 'border-sand-200' : 'border-dashed border-sand-400 bg-sand-100'}`}>
                <h3 className="font-bold">{m.label}</h3>
                <p className="text-xs font-semibold text-sand-600">
                  {m.availability === 'valutabile' ? 'Valutabile' : 'Non valutabile'} · {m.timeframe}
                </p>
                <p className="mt-2 text-sm">{m.text}</p>
                <p className="mt-2 text-xs">
                  <strong>Pro:</strong> {m.pros.join(', ')}
                </p>
                <p className="text-xs">
                  <strong>Contro:</strong> {m.cons.join(', ')}
                </p>
              </article>
            ))}
          </div>
        </Section>
      )}

      {selected && canEdit && (
        <Section id="a8" step={8} title="Decisione sotto supervisione">
          {decErrors.length > 0 && (
            <Alert tone="error" title="Completa la decisione">
              {decErrors.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </Alert>
          )}
          <fieldset>
            <legend className="label">Misure considerate (almeno due)</legend>
            <div className="flex flex-wrap gap-3">
              {selected.measures.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={dec.alternatives.includes(m.id)}
                    onChange={(e) => setDec({ ...dec, alternatives: e.target.checked ? [...dec.alternatives, m.id] : dec.alternatives.filter((x) => x !== m.id) })}
                  />
                  {m.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Esito" htmlFor="dout">
              <select id="dout" className="input" value={dec.outcome} onChange={(e) => setDec({ ...dec, outcome: e.target.value as DecisionOutcome })}>
                <option value="accettata">Procedo con la misura scelta</option>
                <option value="modificata">Procedo con modifiche</option>
                <option value="rifiutata">Nessuna delle misure</option>
                <option value="inviata_a_esperto">Consulto l’agronomo prima di decidere</option>
              </select>
            </Field>
            <Field label="Misura scelta" htmlFor="dch">
              <select id="dch" className="input" value={dec.chosen} onChange={(e) => setDec({ ...dec, chosen: e.target.value })}>
                <option value="">—</option>
                {selected.measures
                  .filter((m) => dec.alternatives.includes(m.id) && m.availability === 'valutabile')
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Chi registra" htmlFor="dau">
              <input id="dau" className="input" value={dec.author} onChange={(e) => setDec({ ...dec, author: e.target.value })} />
            </Field>
            <Field label="Agronomo / supervisore" htmlFor="dsu">
              <input id="dsu" className="input" value={dec.supervisor} onChange={(e) => setDec({ ...dec, supervisor: e.target.value })} placeholder='es. "Dott.ssa Rossi" o "da consultare"' />
            </Field>
          </div>
          <Field label="Motivazione" htmlFor="drat">
            <textarea id="drat" className="input" rows={3} value={dec.rationale} onChange={(e) => setDec({ ...dec, rationale: e.target.value })} />
          </Field>
          <button type="button" className="btn-primary" onClick={saveDecision}>
            Registra decisione
          </button>
        </Section>
      )}

      {lastDecision && (
        <Section id="a9" step={9} title="Verifica successiva della risposta del vigneto">
          <p className="text-sm">
            Ultima decisione del {new Date(lastDecision.createdAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })} · {lastDecision.outcome}
            {lastDecision.chosen && ` · ${lastDecision.chosen.replace(/_/g, ' ')}`} · supervisore: {lastDecision.supervisor}
          </p>
          {lastDecision.assessmentSnapshot && snapshotZone ? (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th scope="col">{snapshotZone.zoneName}</th>
                    <th scope="col">Al momento della decisione</th>
                    <th scope="col">Oggi</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Priorità</th>
                    <td>
                      <LevelPill level={lastDecision.assessmentSnapshot.priority} />
                    </td>
                    <td>
                      <LevelPill level={snapshotZone.priority} />
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Fiducia</th>
                    <td>{lastDecision.assessmentSnapshot.confidence}</td>
                    <td>{snapshotZone.confidence}</td>
                  </tr>
                  {snapshotZone.components.map((c) => (
                    <tr key={c.key}>
                      <th scope="row">{c.label}</th>
                      <td>
                        <LevelPill level={lastDecision.assessmentSnapshot!.levels[c.label] ?? 'non determinabile'} />
                      </td>
                      <td>
                        <LevelPill level={c.level} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {canEdit && <p className="text-sm">Registra al passo 4 una misura di umidità del suolo o un’osservazione di follow-up per documentare la risposta.</p>}
        </Section>
      )}
    </div>
  );
}
