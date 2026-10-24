import type { Baseline } from '../baseline/baseline';
import type { DataValue } from '../data/dataValue';
import { buildGrid, type Aoi } from '../geo/geo';
import { hashOf, newId } from '../hash/hash';
import { estimateCosts, type CostBreakdown } from '../models/costDemo';
import { DEMO_URBAN_META, runDemoUrbanModel, suggestedCellSize, type CellResult } from '../models/urbanDemo';
import { modelRef } from '../models/adapter';
import { checkInterventions, type Horizon, type Intervention, type PlausibilityIssue } from './interventions';

export interface Scenario {
  id: string;
  projectId: string;
  label: string;
  description: string;
  baselineId: string;
  modelRef: string;
  horizon: Horizon;
  interventions: Intervention[];
  /** id degli scenari combinati (es. A+B) */
  combines: string[];
  createdAt: string;
}

export interface ScenarioRun {
  scenarioId: string;
  baselineId: string;
  baselineHash: string;
  modelRef: string;
  costModelRef: string;
  inputHash: string;
  outputHash: string;
  cellSizeM: number;
  outputs: DataValue[];
  cells: CellResult[];
  costs: CostBreakdown;
  checks: PlausibilityIssue[];
  notes: string[];
  computedAt: string;
}

export function createScenario(
  p: Pick<Scenario, 'projectId' | 'label' | 'description' | 'baselineId' | 'horizon'> & Partial<Pick<Scenario, 'interventions' | 'combines'>>,
  now: Date,
  id: string = newId(),
): Scenario {
  return {
    id,
    projectId: p.projectId,
    label: p.label,
    description: p.description,
    baselineId: p.baselineId,
    modelRef: modelRef(DEMO_URBAN_META),
    horizon: p.horizon,
    interventions: p.interventions ?? [],
    combines: p.combines ?? [],
    createdAt: now.toISOString(),
  };
}

/** Combinazione A+B: unione degli interventi, stessa baseline e stesso modello. */
export function combineScenarios(a: Scenario, b: Scenario, now: Date, id: string = newId()): Scenario {
  const cmp = checkComparability([a, b]);
  if (!cmp.comparable) throw new Error(`Impossibile combinare: ${cmp.reasons.join(' ')}`);
  return {
    ...createScenario(
      {
        projectId: a.projectId,
        label: `${a.label}+${b.label}`,
        description: `Combinazione di ${a.label} e ${b.label}. Gli effetti non sono sommati: il modello applica la regola di non additività.`,
        baselineId: a.baselineId,
        horizon: a.horizon,
        interventions: [...a.interventions, ...b.interventions],
        combines: [a.id, b.id],
      },
      now,
      id,
    ),
    modelRef: a.modelRef,
  };
}

export interface Comparability {
  comparable: boolean;
  reasons: string[];
}

/** Confronto equo (§4.6): stessa baseline, stesso periodo, stessa versione del modello, stesso orizzonte. */
export function checkComparability(scenarios: readonly Pick<Scenario, 'label' | 'baselineId' | 'modelRef' | 'horizon'>[]): Comparability {
  const reasons: string[] = [];
  const [first, ...rest] = scenarios;
  if (!first) return { comparable: false, reasons: ['Nessuno scenario selezionato.'] };
  for (const s of rest) {
    if (s.baselineId !== first.baselineId) reasons.push(`${s.label} usa una baseline diversa da ${first.label}.`);
    if (s.modelRef !== first.modelRef) reasons.push(`${s.label} usa il modello ${s.modelRef}, ${first.label} usa ${first.modelRef}.`);
    if (s.horizon !== first.horizon) reasons.push(`${s.label} è valutato a ${s.horizon}, ${first.label} a ${first.horizon}.`);
  }
  return { comparable: reasons.length === 0, reasons };
}

export function checkRunsComparability(runs: readonly ScenarioRun[], labels: Record<string, string>): Comparability {
  const reasons: string[] = [];
  const [first, ...rest] = runs;
  if (!first) return { comparable: false, reasons: ['Nessun risultato da confrontare.'] };
  for (const r of rest) {
    const l = labels[r.scenarioId] ?? r.scenarioId;
    if (r.baselineHash !== first.baselineHash) reasons.push(`${l}: baseline (contenuto) diversa.`);
    if (r.modelRef !== first.modelRef) reasons.push(`${l}: versione del modello diversa.`);
    if (r.costModelRef !== first.costModelRef) reasons.push(`${l}: modello dei costi diverso.`);
    if (r.cellSizeM !== first.cellSizeM) reasons.push(`${l}: griglia diversa.`);
  }
  return { comparable: reasons.length === 0, reasons };
}

export interface RunContext {
  aoi: Aoi;
  baseline: Baseline;
  computedAt: string;
}

/** Esecuzione deterministica: stesso input → stesso inputHash → stesso outputHash. */
export function runScenario(scenario: Scenario, ctx: RunContext): ScenarioRun {
  if (scenario.baselineId !== ctx.baseline.id) throw new Error('Lo scenario non appartiene a questa baseline.');
  if (scenario.modelRef !== modelRef(DEMO_URBAN_META)) throw new Error(`Modello ${scenario.modelRef} non disponibile.`);
  const checks = checkInterventions(scenario.interventions, ctx.aoi.geometry, ctx.aoi.areaM2, scenario.horizon);
  const cellSize = suggestedCellSize(ctx.aoi.areaM2);
  const inputHash = hashOf({
    aoi: ctx.aoi.geometry,
    baseline: ctx.baseline.contentHash,
    model: scenario.modelRef,
    horizon: scenario.horizon,
    interventions: scenario.interventions,
    cellSize,
  });
  const blocking = checks.filter((c) => c.severity === 'errore');
  const costs = estimateCosts(scenario.interventions);
  if (blocking.length) {
    return {
      scenarioId: scenario.id,
      baselineId: ctx.baseline.id,
      baselineHash: ctx.baseline.contentHash,
      modelRef: scenario.modelRef,
      costModelRef: costs.modelRef,
      inputHash,
      outputHash: '',
      cellSizeM: cellSize,
      outputs: [],
      cells: [],
      costs,
      checks,
      notes: ['Calcolo non eseguito: correggi gli errori di plausibilità.'],
      computedAt: ctx.computedAt,
    };
  }
  const grid = buildGrid(ctx.aoi.geometry, cellSize);
  const result = runDemoUrbanModel({
    aoi: ctx.aoi.geometry,
    grid,
    baselineValues: ctx.baseline.values,
    referenceHourLocal: ctx.baseline.referenceHourLocal,
    interventions: scenario.interventions,
    horizon: scenario.horizon,
    computedAt: ctx.computedAt,
    isDemo: ctx.baseline.isDemo,
  });
  const outputHash = hashOf({
    cells: result.cells,
    outputs: result.outputs.map((o) => ({ key: o.key, value: o.value, range: o.range, cls: o.dataClass })),
    costs: { capex: costs.capex, opex: costs.opexYear, water: costs.waterM3Year },
  });
  return {
    scenarioId: scenario.id,
    baselineId: ctx.baseline.id,
    baselineHash: ctx.baseline.contentHash,
    modelRef: scenario.modelRef,
    costModelRef: costs.modelRef,
    inputHash,
    outputHash,
    cellSizeM: grid.cellSizeM,
    outputs: result.outputs,
    cells: result.cells,
    costs,
    checks,
    notes: result.notes,
    computedAt: ctx.computedAt,
  };
}

/** Ricalcola e verifica che il risultato coincida con quello salvato. */
export function verifyReproducibility(saved: ScenarioRun, scenario: Scenario, ctx: Omit<RunContext, 'computedAt'>): boolean {
  const again = runScenario(scenario, { ...ctx, computedAt: saved.computedAt });
  return again.inputHash === saved.inputHash && again.outputHash === saved.outputHash;
}
