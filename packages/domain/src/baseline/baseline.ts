import type { DataValue } from '../data/dataValue';
import { deepFreeze, hashOf, newId } from '../hash/hash';

/**
 * Baseline immutabile e versionata. Una variazione non modifica la baseline
 * esistente: crea una nuova versione con parentId.
 */
export interface Baseline {
  readonly id: string;
  readonly projectId: string;
  readonly areaId: string;
  readonly version: number;
  readonly parentId: string | null;
  readonly periodStart: string; // YYYY-MM-DD
  readonly periodEnd: string;
  readonly referenceHourLocal: number; // 0–23, Europe/Rome
  readonly timezone: 'Europe/Rome';
  readonly values: readonly DataValue[];
  readonly qaNotes: readonly string[];
  readonly sourceSummary: string;
  readonly isDemo: boolean;
  readonly contentHash: string;
  readonly lockedAt: string;
}

export type BaselineContent = Omit<Baseline, 'id' | 'version' | 'parentId' | 'contentHash' | 'lockedAt' | 'timezone'>;

function contentHash(c: BaselineContent): string {
  return hashOf({
    projectId: c.projectId,
    areaId: c.areaId,
    periodStart: c.periodStart,
    periodEnd: c.periodEnd,
    referenceHourLocal: c.referenceHourLocal,
    values: c.values,
    qaNotes: c.qaNotes,
    sourceSummary: c.sourceSummary,
    isDemo: c.isDemo,
  });
}

export function validateBaselineContent(c: BaselineContent): string[] {
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(c.periodEnd)) {
    errors.push('Periodo non valido (formato AAAA-MM-GG).');
  } else if (c.periodStart > c.periodEnd) {
    errors.push('La data di inizio è successiva alla data di fine.');
  }
  if (!Number.isInteger(c.referenceHourLocal) || c.referenceHourLocal < 0 || c.referenceHourLocal > 23) {
    errors.push("Ora di riferimento non valida (0–23).");
  }
  if (c.values.length === 0) errors.push('La baseline non contiene valori.');
  return errors;
}

export function createBaseline(c: BaselineContent, now: Date, id: string = newId()): Baseline {
  const errors = validateBaselineContent(c);
  if (errors.length) throw new Error(errors.join(' '));
  return deepFreeze({
    ...structuredClone(c),
    id,
    version: 1,
    parentId: null,
    timezone: 'Europe/Rome' as const,
    contentHash: contentHash(c),
    lockedAt: now.toISOString(),
  });
}

/** Crea una nuova versione a partire da una baseline esistente, che resta invariata. */
export function deriveBaselineVersion(
  previous: Baseline,
  changes: Partial<Pick<BaselineContent, 'periodStart' | 'periodEnd' | 'referenceHourLocal' | 'values' | 'qaNotes' | 'sourceSummary' | 'isDemo'>>,
  now: Date,
  id: string = newId(),
): Baseline {
  const content: BaselineContent = {
    projectId: previous.projectId,
    areaId: previous.areaId,
    periodStart: changes.periodStart ?? previous.periodStart,
    periodEnd: changes.periodEnd ?? previous.periodEnd,
    referenceHourLocal: changes.referenceHourLocal ?? previous.referenceHourLocal,
    values: changes.values ?? previous.values,
    qaNotes: changes.qaNotes ?? previous.qaNotes,
    sourceSummary: changes.sourceSummary ?? previous.sourceSummary,
    isDemo: changes.isDemo ?? previous.isDemo,
  };
  const errors = validateBaselineContent(content);
  if (errors.length) throw new Error(errors.join(' '));
  return deepFreeze({
    ...structuredClone(content),
    id,
    version: previous.version + 1,
    parentId: previous.id,
    timezone: 'Europe/Rome' as const,
    contentHash: contentHash(content),
    lockedAt: now.toISOString(),
  });
}

export function verifyBaselineIntegrity(b: Baseline): boolean {
  return contentHash(b) === b.contentHash;
}

export function latestBaseline(baselines: readonly Baseline[], areaId: string): Baseline | undefined {
  return baselines.filter((b) => b.areaId === areaId).sort((a, b) => b.version - a.version)[0];
}
