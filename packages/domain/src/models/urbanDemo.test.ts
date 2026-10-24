import { describe, expect, it } from 'vitest';
import { seedCampobasso } from '../seeds/seeds';
import { runScenario, type ScenarioRun } from '../scenario/scenario';
import { createDefaultRegistry } from './registry';
import { DEMO_URBAN_META } from './urbanDemo';
import { modelRef } from './adapter';

const now = new Date('2026-10-24T08:00:00Z');

describe('Modello urbano DEMO', () => {
  const b = seedCampobasso(now);
  const runA = b.runs[0]!;
  const runB = b.runs[1]!;
  const runAB = b.runs[2]!;

  it('separa temperatura aria, superficiale e comfort', () => {
    const keys = runA.outputs.map((o) => o.key);
    expect(keys).toEqual(expect.arrayContaining(['delta_t_air', 'delta_t_surface', 'comfort_index']));
    const comfort = runA.outputs.find((o) => o.key === 'comfort_index')!;
    expect(comfort.dataClass).toBe('DATO_MANCANTE');
    expect(comfort.value).toBeNull();
  });

  it('ogni output è SIMULATO o DATO MANCANTE, con modello e versione nel lineage', () => {
    for (const o of runA.outputs) {
      expect(['SIMULATO', 'DATO_MANCANTE']).toContain(o.dataClass);
      if (o.dataClass === 'SIMULATO') {
        expect(o.lineage.modelId).toBe(DEMO_URBAN_META.id);
        expect(o.lineage.modelVersion).toBe(DEMO_URBAN_META.version);
        expect(o.range).toBeDefined();
        expect(o.rangeLabel).toBe('intervallo illustrativo');
      }
    }
  });

  it('usa "riduzione termica stimata" e mai "temperatura percepita"', () => {
    const dTa = runA.outputs.find((o) => o.key === 'delta_t_air')!;
    expect(dTa.label).toMatch(/Riduzione termica stimata/);
    expect(runA.outputs.map((o) => o.label).join(' ')).not.toMatch(/percepita/i);
  });

  it('produce riduzioni (valori ≤ 0) e celle collegate', () => {
    const dTs = runA.outputs.find((o) => o.key === 'delta_t_surface')!;
    expect(dTs.value!).toBeLessThan(0);
    expect(runA.cells.length).toBeGreaterThan(100);
    expect(runA.cells.every((c) => c.dTs <= 0 && c.dTsRange[0] <= c.dTs && c.dTs <= c.dTsRange[1])).toBe(true);
  });

  it('è deterministico: stesso input → stesso hash', () => {
    const again = runScenario(b.scenarios[0]!, { aoi: b.area!, baseline: b.baselines[0]!, computedAt: 'altro momento' });
    expect(again.inputHash).toBe(runA.inputHash);
    expect(again.outputHash).toBe(runA.outputHash);
  });

  it('la combinazione A+B non è la somma degli effetti', () => {
    const v = (r: ScenarioRun) => r.outputs.find((o) => o.key === 'delta_t_surface')!.value!;
    expect(v(runAB)).toBeLessThanOrEqual(Math.min(v(runA), v(runB)));
    const cellSum = runA.cells.reduce((s, c, k) => s + c.dTs + runB.cells[k]!.dTs, 0);
    const cellAB = runAB.cells.reduce((s, c) => s + c.dTs, 0);
    expect(cellAB).toBeGreaterThan(cellSum);
  });

  it('nebulizzazione esclusa se UR di baseline sopra soglia', () => {
    const sc = {
      ...b.scenarios[0]!,
      interventions: [
        {
          id: 'm',
          label: 'Nebulizzatori',
          type: 'nebulizzazione' as const,
          geometry: { type: 'MultiPoint' as const, coordinates: [[14.6633, 41.5606]] },
          params: { portataLH: 20, durataOreGiorno: 6, giorniAnno: 60, raggioInfluenzaM: 5, urMassimaAttivazionePct: 30 },
        },
      ],
    };
    const r = runScenario(sc, { aoi: b.area!, baseline: b.baselines[0]!, computedAt: 'x' });
    expect(r.notes.join(' ')).toMatch(/non attivo/);
    expect(r.outputs.find((o) => o.key === 'delta_t_air')!.value).toBe(0);
  });

  it("il registro rifiuta l'adapter DEMO in modalità Pilota calibrato", () => {
    const reg = createDefaultRegistry();
    expect(() => reg.resolve(modelRef(DEMO_URBAN_META), 'pilota')).toThrow(/Pilota/);
    expect(reg.resolve(modelRef(DEMO_URBAN_META), 'demo').id).toBe(DEMO_URBAN_META.id);
    expect(reg.availableFor('urban', 'pilota')).toHaveLength(0);
    expect(() => reg.register({ ...DEMO_URBAN_META, maturity: 'calibrated' })).toThrow(/revisore/);
  });
});
