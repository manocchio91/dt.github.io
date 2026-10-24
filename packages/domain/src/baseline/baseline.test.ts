import { describe, expect, it } from 'vitest';
import { createBaseline, deriveBaselineVersion, verifyBaselineIntegrity, type BaselineContent } from './baseline';
import { userValue } from '../data/dataValue';

const now = new Date('2026-10-24T08:00:00Z');
const content: BaselineContent = {
  projectId: 'p',
  areaId: 'a',
  periodStart: '2025-07-15',
  periodEnd: '2025-08-15',
  referenceHourLocal: 15,
  values: [userValue('t_air_ref_hour', 'T aria', '°C', 29, now.toISOString())],
  qaNotes: [],
  sourceSummary: 'test',
  isDemo: true,
};

describe('Baseline immutabile e versionata', () => {
  it('è congelata dopo il salvataggio', () => {
    const b = createBaseline(content, now, 'b1');
    expect(Object.isFrozen(b)).toBe(true);
    expect(() => {
      (b as { periodEnd: string }).periodEnd = '2025-09-01';
    }).toThrow();
    expect(() => {
      (b.values[0] as { value: number }).value = 10;
    }).toThrow();
    expect(verifyBaselineIntegrity(b)).toBe(true);
  });

  it('una variazione crea una nuova versione e lascia invariata la precedente', () => {
    const v1 = createBaseline(content, now, 'b1');
    const v2 = deriveBaselineVersion(v1, { referenceHourLocal: 14 }, now, 'b2');
    expect(v2.version).toBe(2);
    expect(v2.parentId).toBe('b1');
    expect(v1.referenceHourLocal).toBe(15);
    expect(v2.contentHash).not.toBe(v1.contentHash);
  });

  it("l'hash rileva manomissioni", () => {
    const b = createBaseline(content, now, 'b1');
    const tampered = { ...structuredClone(b), referenceHourLocal: 9 };
    expect(verifyBaselineIntegrity(tampered)).toBe(false);
  });

  it('valida periodo e ora', () => {
    expect(() => createBaseline({ ...content, periodStart: '2025-09-01' }, now)).toThrow(/inizio/);
    expect(() => createBaseline({ ...content, referenceHourLocal: 25 }, now)).toThrow(/Ora/);
  });
});
