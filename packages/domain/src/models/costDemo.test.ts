import { describe, expect, it } from 'vitest';
import { seedCampobasso } from '../seeds/seeds';
import { estimateCosts } from './costDemo';

describe('Costi DEMO', () => {
  const b = seedCampobasso(new Date('2026-10-24T08:00:00Z'));

  it('separa prototipo, CAPEX, OPEX e acqua', () => {
    const c = estimateCosts(b.scenarios[0]!.interventions);
    expect(c.prototype.value).toBe(0);
    expect(c.prototype.note).toMatch(/Non include l’intervento/);
    expect(c.capex[1]).toBeGreaterThan(0);
    expect(c.opexYear[1]).toBeGreaterThan(0);
    expect(c.capex[0]).toBeLessThanOrEqual(c.capex[1]);
    expect(c.capex[1]).toBeLessThanOrEqual(c.capex[2]);
  });

  it('quantità derivate dalla geometria (12 alberi)', () => {
    const c = estimateCosts(b.scenarios[0]!.interventions);
    expect(c.lines[0]!.quantity).toBe(12);
    expect(c.lines[0]!.unit).toBe('alberi');
  });

  it('acqua della nebulizzazione calcolata dai parametri', () => {
    const c = estimateCosts([
      {
        id: 'm',
        label: 'n',
        type: 'nebulizzazione',
        geometry: { type: 'MultiPoint', coordinates: [[0, 0], [0, 0.0001]] },
        params: { portataLH: 10, durataOreGiorno: 5, giorniAnno: 60, raggioInfluenzaM: 4, urMassimaAttivazionePct: 60 },
      },
    ]);
    expect(c.waterM3Year).toEqual([6, 6, 6]);
  });
});
