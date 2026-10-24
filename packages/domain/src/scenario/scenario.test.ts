import { describe, expect, it } from 'vitest';
import { seedCampobasso } from '../seeds/seeds';
import { deriveBaselineVersion } from '../baseline/baseline';
import { checkComparability, checkRunsComparability, combineScenarios, runScenario } from './scenario';
import { checkInterventions } from './interventions';

const now = new Date('2026-10-24T08:00:00Z');

describe('Confronto equo tra scenari', () => {
  const b = seedCampobasso(now);
  const [a, bb] = b.scenarios;

  it('A e B del seed sono confrontabili', () => {
    expect(checkComparability([a!, bb!]).comparable).toBe(true);
    const labels = Object.fromEntries(b.scenarios.map((s) => [s.id, s.label]));
    expect(checkRunsComparability(b.runs, labels).comparable).toBe(true);
  });

  it('baseline, modello o orizzonte diversi bloccano il confronto', () => {
    const r1 = checkComparability([a!, { ...bb!, baselineId: 'altra' }]);
    expect(r1.comparable).toBe(false);
    expect(r1.reasons[0]).toMatch(/baseline/);
    expect(checkComparability([a!, { ...bb!, modelRef: 'x@2' }]).comparable).toBe(false);
    expect(checkComparability([a!, { ...bb!, horizon: 'impianto' }]).comparable).toBe(false);
  });

  it('non combina scenari non confrontabili', () => {
    expect(() => combineScenarios(a!, { ...bb!, baselineId: 'altra' }, now)).toThrow(/combinare/);
  });

  it('i run su versioni diverse della baseline non sono confrontabili', () => {
    const v2 = deriveBaselineVersion(b.baselines[0]!, { referenceHourLocal: 13 }, now, 'v2');
    const runV2 = runScenario({ ...bb!, baselineId: v2.id }, { aoi: b.area!, baseline: v2, computedAt: 'x' });
    const res = checkRunsComparability([b.runs[0]!, runV2], {});
    expect(res.comparable).toBe(false);
  });

  it('errori di plausibilità bloccano il calcolo senza produrre numeri', () => {
    const outside = {
      ...a!,
      interventions: [
        {
          ...a!.interventions[0]!,
          geometry: { type: 'MultiPoint' as const, coordinates: [[15, 42]] },
        },
      ],
    } as typeof a;
    const r = runScenario(outside!, { aoi: b.area!, baseline: b.baselines[0]!, computedAt: 'x' });
    expect(r.outputs).toHaveLength(0);
    expect(r.outputHash).toBe('');
    expect(r.checks.some((c) => c.severity === 'errore')).toBe(true);
  });
});

describe('Plausibilità interventi (F08)', () => {
  const b = seedCampobasso(now);
  it('il seed non ha errori bloccanti', () => {
    for (const s of b.scenarios) {
      const issues = checkInterventions(s.interventions, b.area!.geometry, b.area!.areaM2, s.horizon);
      expect(issues.filter((i) => i.severity === 'errore')).toEqual([]);
    }
  });
  it('rileva parametri fisicamente non plausibili', () => {
    const issues = checkInterventions(
      [
        {
          id: 'x',
          label: 'Albedo',
          type: 'albedo',
          geometry: b.scenarios[1]!.interventions[0]!.geometry as never,
          params: { albedoIniziale: 0.5, albedoFinale: 0.3, materiale: 'x' },
        },
        {
          id: 'y',
          label: 'Alberi',
          type: 'albero',
          geometry: { type: 'MultiPoint', coordinates: [[14.6633, 41.5606]] },
          params: { tipologia: 't', diametroChiomaInizialeM: 6, diametroChiomaMaturaM: 4, etaAnni: 2 },
        },
      ],
      b.area!.geometry,
      b.area!.areaM2,
      'maturita',
    );
    expect(issues.filter((i) => i.severity === 'errore').map((i) => i.interventionId)).toEqual(['x', 'y']);
  });
});
