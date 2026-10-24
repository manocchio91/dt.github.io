import type { Feature, FeatureCollection } from 'geojson';
import type { AgriWeather, FieldObservation, VineyardSetup, VineyardZone } from '../agri/agriDemo';
import { verifyBaselineIntegrity, type Baseline } from '../baseline/baseline';
import type { ModelVersionProposal, MeasurementRecord, VerificationPlan } from '../expost/expost';
import { buildGrid, type Aoi } from '../geo/geo';
import { hashOf, newId } from '../hash/hash';
import type { ProjectMode } from '../models/adapter';
import { suggestedCellSize } from '../models/urbanDemo';
import { verifyReproducibility, type Scenario, type ScenarioRun } from '../scenario/scenario';
import type { ForecastRecord } from '../forecast/record';

export type Sector = 'urban' | 'agriculture';

export interface Project {
  id: string;
  name: string;
  sector: Sector;
  mode: ProjectMode;
  isDemoSeed: boolean;
  description: string;
  createdAt: string;
}

export type DecisionOutcome = 'accettata' | 'modificata' | 'rifiutata' | 'inviata_a_esperto';

export interface DecisionEvent {
  at: string;
  actor: string;
  action: string;
  rationale: string;
}

export interface Decision {
  id: string;
  projectId: string;
  sector: Sector;
  /** id di scenari (urbano) o misure per zona (agricolo) considerati */
  alternatives: string[];
  chosen: string | null;
  outcome: DecisionOutcome;
  rationale: string;
  author: string;
  supervisor: string | null;
  state: 'bozza' | 'inviata_a_revisione';
  history: DecisionEvent[];
  /** Agricolo: stato della zona al momento della decisione, per la verifica successiva */
  assessmentSnapshot?: { zoneId: string; priority: string; confidence: string; levels: Record<string, string>; at: string };
  createdAt: string;
}

export interface AuditEntry {
  at: string;
  action: string;
  detail: string;
}

export interface AgriState {
  setup: VineyardSetup;
  zones: VineyardZone[];
  observations: FieldObservation[];
  weather: AgriWeather | null;
  weatherNote: string;
  today: string;
}

export interface ProjectBundle {
  schemaVersion: 1;
  project: Project;
  area: Aoi | null;
  baselines: Baseline[];
  scenarios: Scenario[];
  runs: ScenarioRun[];
  agri: AgriState | null;
  decisions: Decision[];
  verificationPlans: VerificationPlan[];
  measurements: MeasurementRecord[];
  modelProposals: ModelVersionProposal[];
  audit: AuditEntry[];
  /** previsioni registrate (F31); assente nei progetti creati prima */
  forecasts?: ForecastRecord[];
}

export function emptyBundle(p: Omit<Project, 'id' | 'createdAt'>, now: Date, id: string = newId()): ProjectBundle {
  return {
    schemaVersion: 1,
    project: { ...p, id, createdAt: now.toISOString() },
    area: null,
    baselines: [],
    scenarios: [],
    runs: [],
    agri: null,
    decisions: [],
    verificationPlans: [],
    measurements: [],
    modelProposals: [],
    audit: [{ at: now.toISOString(), action: 'creazione', detail: `Progetto "${p.name}" creato` }],
  };
}

export function withAudit(b: ProjectBundle, action: string, detail: string, now: Date): ProjectBundle {
  return { ...b, audit: [...b.audit, { at: now.toISOString(), action, detail }] };
}

export function validateDecision(d: Pick<Decision, 'rationale' | 'alternatives' | 'outcome' | 'chosen'>): string[] {
  const e: string[] = [];
  if (d.alternatives.length < 2) e.push('Servono almeno due alternative considerate.');
  if (d.rationale.trim().length < 20) e.push('La motivazione deve contenere almeno 20 caratteri.');
  if ((d.outcome === 'accettata' || d.outcome === 'modificata') && !d.chosen) e.push("Indica l'alternativa scelta.");
  return e;
}

// ---------------------------------------------------------------- export JSON

export interface ProjectExport {
  format: 'mdt-project';
  formatVersion: 1;
  exportedAt: string;
  watermark: string | null;
  bundleHash: string;
  bundle: ProjectBundle;
}

export function exportProject(b: ProjectBundle, now: Date): ProjectExport {
  return {
    format: 'mdt-project',
    formatVersion: 1,
    exportedAt: now.toISOString(),
    watermark: b.project.mode === 'demo' ? 'DEMO — stime illustrative, non validate. Non utilizzabile come atto tecnico.' : null,
    bundleHash: hashOf(b),
    bundle: b,
  };
}

export interface ImportCheck {
  ok: boolean;
  bundle: ProjectBundle | null;
  errors: string[];
  hashOk: boolean;
  baselinesIntact: boolean;
  reproducible: Record<string, boolean>;
}

export function importProject(text: string): ImportCheck {
  const out: ImportCheck = { ok: false, bundle: null, errors: [], hashOk: false, baselinesIntact: false, reproducible: {} };
  let parsed: ProjectExport;
  try {
    parsed = JSON.parse(text) as ProjectExport;
  } catch {
    out.errors.push('File non JSON.');
    return out;
  }
  if (parsed.format !== 'mdt-project' || parsed.formatVersion !== 1 || !parsed.bundle) {
    out.errors.push('Formato non riconosciuto (atteso mdt-project v1).');
    return out;
  }
  const b = parsed.bundle;
  out.hashOk = hashOf(b) === parsed.bundleHash;
  if (!out.hashOk) out.errors.push('Hash del progetto non corrispondente: il file è stato modificato dopo l’esportazione.');
  out.baselinesIntact = b.baselines.every(verifyBaselineIntegrity);
  if (!out.baselinesIntact) out.errors.push('Almeno una baseline non corrisponde al proprio hash di contenuto.');
  for (const run of b.runs) {
    const sc = b.scenarios.find((s) => s.id === run.scenarioId);
    const bl = b.baselines.find((x) => x.id === run.baselineId);
    if (!sc || !bl || !b.area || !run.outputHash) continue;
    out.reproducible[run.scenarioId] = verifyReproducibility(run, sc, { aoi: b.area, baseline: bl });
  }
  if (Object.values(out.reproducible).some((v) => !v)) out.errors.push('Almeno uno scenario non è riproducibile con il modello attuale.');
  out.bundle = b;
  out.ok = out.errors.length === 0;
  return out;
}

// ------------------------------------------------------------- export GeoJSON

export function scenarioToGeoJson(b: ProjectBundle, scenarioId: string, now: Date): FeatureCollection & { mdt: unknown } {
  const sc = b.scenarios.find((s) => s.id === scenarioId);
  if (!sc || !b.area) throw new Error('Scenario o area mancanti.');
  const run = b.runs.find((r) => r.scenarioId === scenarioId);
  const baseline = b.baselines.find((x) => x.id === sc.baselineId);
  const features: Feature[] = [
    { type: 'Feature', geometry: b.area.geometry, properties: { ruolo: 'aoi', nome: b.area.name, superficie_m2: Math.round(b.area.areaM2), crs: b.area.crs } },
    ...sc.interventions.map(
      (i): Feature => ({ type: 'Feature', geometry: i.geometry, properties: { ruolo: 'intervento', id: i.id, tipo: i.type, etichetta: i.label, ...i.params } }),
    ),
  ];
  if (run && run.cells.length) {
    const grid = buildGrid(b.area.geometry, suggestedCellSize(b.area.areaM2));
    const byId = new Map(grid.cells.map((c) => [c.id, c]));
    for (const c of run.cells) {
      const g = byId.get(c.id);
      if (!g) continue;
      features.push({
        type: 'Feature',
        geometry: g.polygon,
        properties: { ruolo: 'cella', id: c.id, dTs_C: c.dTs, dTs_min_C: c.dTsRange[0], dTs_max_C: c.dTsRange[1], dTa_C: c.dTa, classe: 'SIMULATO' },
      });
    }
  }
  return {
    type: 'FeatureCollection',
    features,
    // membro esterno ammesso da RFC 7946 §6.1: metadati per la ricostruzione
    mdt: {
      format: 'mdt-scenario-geojson',
      exportedAt: now.toISOString(),
      watermark: b.project.mode === 'demo' ? 'DEMO — stime illustrative' : null,
      scenario: sc,
      baselineId: baseline?.id,
      baselineHash: baseline?.contentHash,
      baselineVersion: baseline?.version,
      modelRef: sc.modelRef,
      inputHash: run?.inputHash ?? null,
      outputHash: run?.outputHash ?? null,
      outputs: run?.outputs.map((o) => ({ key: o.key, unit: o.unit, value: o.value, range: o.range, classe: o.dataClass })) ?? [],
    },
  };
}

export function scenarioFromGeoJson(text: string): Scenario {
  const j = JSON.parse(text) as { mdt?: { format?: string; scenario?: Scenario } };
  if (j.mdt?.format !== 'mdt-scenario-geojson' || !j.mdt.scenario) throw new Error('GeoJSON senza metadati di scenario mdt.');
  return j.mdt.scenario;
}
