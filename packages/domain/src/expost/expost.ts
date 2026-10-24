import type { DataClass, DataValue } from '../data/dataValue';
import { newId } from '../hash/hash';

/**
 * Verifica ex-post (§13): piano definito prima dell'intervento, misure ante e
 * post, confronto a condizioni omogenee, scarto, lezioni apprese, proposta di
 * ricalibrazione che NON sovrascrive la versione del modello esistente.
 */

export interface MonitoringPoint {
  id: string;
  label: string;
  lon: number;
  lat: number;
}

export interface VerificationPlan {
  id: string;
  projectId: string;
  scenarioId: string;
  /** chiave dell'output previsto da verificare, es. delta_t_surface */
  outputKey: string;
  variable: string;
  unit: string;
  points: MonitoringPoint[];
  periodStart: string;
  periodEnd: string;
  frequency: string;
  homogeneity: { referenceHourLocal: number; toleranceHours: number; notes: string };
  createdAt: string;
  possibleCauses?: string;
  lessonsLearned?: string;
  correctiveAction?: string;
}

export interface MeasurementRecord {
  pointId: string;
  phase: 'ante' | 'post';
  variable: string;
  timestamp: string; // ISO con offset
  value: number;
  unit: string;
  sensorId: string;
  dataClass: Extract<DataClass, 'MISURATO' | 'OSSERVATO_DA_DATASET' | 'SIMULATO'>;
}

export interface CsvParseResult {
  records: MeasurementRecord[];
  errors: string[];
}

const HEADER = ['punto', 'fase', 'variabile', 'timestamp', 'valore', 'unita', 'sensore', 'classe'];

/** CSV con intestazione: punto,fase,variabile,timestamp,valore,unita,sensore,classe (separatore , o ;). */
export function parseMeasurementsCsv(text: string): CsvParseResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const errors: string[] = [];
  const records: MeasurementRecord[] = [];
  if (lines.length === 0) return { records, errors: ['File vuoto.'] };
  const sep = lines[0]!.includes(';') ? ';' : ',';
  const header = lines[0]!.split(sep).map((h) => h.trim().toLowerCase());
  const missingCols = HEADER.filter((h) => !header.includes(h));
  if (missingCols.length) return { records, errors: [`Colonne mancanti: ${missingCols.join(', ')}.`] };
  const col = (row: string[], name: string) => row[header.indexOf(name)]?.trim() ?? '';
  lines.slice(1).forEach((line, k) => {
    const row = line.split(sep);
    const n = k + 2;
    const phase = col(row, 'fase');
    const value = Number(col(row, 'valore').replace(',', '.'));
    const ts = col(row, 'timestamp');
    const cls = col(row, 'classe').toUpperCase();
    if (phase !== 'ante' && phase !== 'post') return errors.push(`Riga ${n}: fase deve essere "ante" o "post".`);
    if (!Number.isFinite(value)) return errors.push(`Riga ${n}: valore non numerico.`);
    if (Number.isNaN(Date.parse(ts))) return errors.push(`Riga ${n}: timestamp non valido.`);
    if (cls !== 'MISURATO' && cls !== 'OSSERVATO_DA_DATASET' && cls !== 'SIMULATO')
      return errors.push(`Riga ${n}: classe deve essere MISURATO, OSSERVATO_DA_DATASET o SIMULATO.`);
    records.push({
      pointId: col(row, 'punto'),
      phase,
      variable: col(row, 'variabile'),
      timestamp: ts,
      value,
      unit: col(row, 'unita'),
      sensorId: col(row, 'sensore'),
      dataClass: cls,
    });
  });
  return { records, errors };
}

/** Ora locale Europe/Rome di un timestamp. */
export function romeHour(iso: string): number {
  const h = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  return Number(h);
}

export interface ExPostComparison {
  outputKey: string;
  unit: string;
  predicted: number;
  predictedRange: [number, number];
  observed: number | null;
  observedClass: DataClass;
  residual: number | null;
  withinRange: boolean | null;
  nAnte: number;
  nPost: number;
  excluded: { count: number; reasons: string[] };
  homogeneityOk: boolean;
  notes: string[];
}

export function compareExPost(plan: VerificationPlan, predicted: DataValue, records: readonly MeasurementRecord[]): ExPostComparison {
  const reasons = new Set<string>();
  let excluded = 0;
  const pointIds = new Set(plan.points.map((p) => p.id));
  const usable = records.filter((r) => {
    if (r.variable !== plan.variable) return false;
    if (!pointIds.has(r.pointId)) {
      excluded++;
      reasons.add('punto non previsto dal piano');
      return false;
    }
    if (r.unit !== plan.unit) {
      excluded++;
      reasons.add(`unità diversa da ${plan.unit}`);
      return false;
    }
    const h = romeHour(r.timestamp);
    if (Math.abs(h - plan.homogeneity.referenceHourLocal) > plan.homogeneity.toleranceHours) {
      excluded++;
      reasons.add(`fuori dalla finestra oraria ${plan.homogeneity.referenceHourLocal}:00 ± ${plan.homogeneity.toleranceHours} h`);
      return false;
    }
    return true;
  });
  const ante = usable.filter((r) => r.phase === 'ante');
  const post = usable.filter((r) => r.phase === 'post');
  const avg = (xs: MeasurementRecord[]) => xs.reduce((s, r) => s + r.value, 0) / xs.length;
  const notes: string[] = [];
  const pred = predicted.value ?? 0;
  const range = predicted.range ?? [pred, pred];
  const classes = new Set(usable.map((r) => r.dataClass));
  const observedClass: DataClass = classes.has('SIMULATO') ? 'SIMULATO' : classes.has('OSSERVATO_DA_DATASET') ? 'OSSERVATO_DA_DATASET' : 'MISURATO';
  if (classes.has('SIMULATO')) notes.push('Le misure contengono dati SIMULATI: il confronto è dimostrativo, non una verifica reale.');

  if (ante.length === 0 || post.length === 0) {
    notes.push('Servono misure sia ante sia post intervento.');
    return {
      outputKey: plan.outputKey, unit: plan.unit, predicted: pred, predictedRange: range,
      observed: null, observedClass: 'DATO_MANCANTE', residual: null, withinRange: null,
      nAnte: ante.length, nPost: post.length, excluded: { count: excluded, reasons: [...reasons] },
      homogeneityOk: false, notes,
    };
  }
  const observed = Math.round((avg(post) - avg(ante)) * 10) / 10;
  const residual = Math.round((observed - pred) * 10) / 10;
  if (ante.length < 3 || post.length < 3) notes.push('Meno di 3 misure per fase: risultato fragile, non generalizzabile.');
  notes.push('Il confronto ante/post non controlla le differenze meteo tra i due periodi oltre al filtro orario: annota le condizioni.');
  return {
    outputKey: plan.outputKey,
    unit: plan.unit,
    predicted: pred,
    predictedRange: range,
    observed,
    observedClass,
    residual,
    withinRange: observed >= range[0] && observed <= range[1],
    nAnte: ante.length,
    nPost: post.length,
    excluded: { count: excluded, reasons: [...reasons] },
    // omogeneità accettabile se almeno metà delle misure rientra nei criteri del piano
    homogeneityOk: excluded <= usable.length,
    notes,
  };
}

export interface ModelVersionProposal {
  id: string;
  parentModelRef: string;
  proposedVersion: string;
  status: 'proposta — richiede validazione';
  basedOnComparison: { observed: number; predicted: number; residual: number };
  suggestedScaling: number | null;
  rationale: string;
  createdAt: string;
}

/** Propone una nuova versione: la versione esistente resta invariata e utilizzabile. */
export function proposeRecalibration(
  parentModelRef: string,
  cmp: ExPostComparison,
  rationale: string,
  existing: readonly ModelVersionProposal[],
  now: Date,
): ModelVersionProposal {
  if (cmp.observed === null || cmp.residual === null) throw new Error('Serve un confronto con valore osservato.');
  if (rationale.trim().length < 20) throw new Error('Motiva la proposta (almeno 20 caratteri).');
  const [, version = '0.0.0'] = parentModelRef.split('@');
  const n = existing.filter((p) => p.parentModelRef === parentModelRef).length + 1;
  return {
    id: newId(),
    parentModelRef,
    proposedVersion: `${version}-cal.${n}`,
    status: 'proposta — richiede validazione',
    basedOnComparison: { observed: cmp.observed, predicted: cmp.predicted, residual: cmp.residual },
    suggestedScaling: cmp.predicted !== 0 ? Math.round((cmp.observed / cmp.predicted) * 100) / 100 : null,
    rationale,
    createdAt: now.toISOString(),
  };
}
