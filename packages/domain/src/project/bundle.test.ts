import { describe, expect, it } from 'vitest';
import { seedCampobasso } from '../seeds/seeds';
import { exportProject, importProject, scenarioFromGeoJson, scenarioToGeoJson, validateDecision } from './bundle';
import { FEATURES } from '../features/features';

const now = new Date('2026-10-24T08:00:00Z');

describe('Export e reimport', () => {
  const b = seedCampobasso(now);

  it('JSON: hash, watermark DEMO e scenari riproducibili dopo il reimport', () => {
    const exp = exportProject(b, now);
    expect(exp.watermark).toMatch(/DEMO/);
    const imp = importProject(JSON.stringify(exp));
    expect(imp.errors).toEqual([]);
    expect(imp.hashOk).toBe(true);
    expect(imp.baselinesIntact).toBe(true);
    expect(Object.values(imp.reproducible)).toEqual([true, true, true]);
  });

  it('rileva un file modificato dopo l’esportazione', () => {
    const exp = exportProject(b, now);
    const tampered = JSON.parse(JSON.stringify(exp));
    tampered.bundle.runs[0].outputs[0].value = -9;
    const imp = importProject(JSON.stringify(tampered));
    expect(imp.hashOk).toBe(false);
    expect(imp.ok).toBe(false);
  });

  it('GeoJSON: AOI, interventi, celle e metadati; ricostruisce lo scenario', () => {
    const gj = scenarioToGeoJson(b, b.scenarios[0]!.id, now);
    const roles = new Set(gj.features.map((f) => (f.properties as { ruolo: string }).ruolo));
    expect([...roles]).toEqual(['aoi', 'intervento', 'cella']);
    const back = scenarioFromGeoJson(JSON.stringify(gj));
    expect(back).toEqual(b.scenarios[0]);
  });
});

describe('Decisione umana', () => {
  it('richiede due alternative, una scelta e una motivazione', () => {
    expect(validateDecision({ alternatives: ['a'], rationale: 'breve', outcome: 'accettata', chosen: null })).toHaveLength(3);
    expect(validateDecision({ alternatives: ['a', 'b'], rationale: 'Scelgo A per minore OPEX e maggiore ombra.', outcome: 'accettata', chosen: 'a' })).toEqual([]);
  });
});

describe('Registro F01–F30', () => {
  it('contiene 30 requisiti con stato e, se operativi, evidenza', () => {
    expect(FEATURES.map((f) => f.id)).toEqual(Array.from({ length: 30 }, (_, i) => `F${String(i + 1).padStart(2, '0')}`));
    for (const f of FEATURES.filter((x) => x.status === 'operativa')) expect(f.evidence.length, f.id).toBeGreaterThan(0);
    expect(FEATURES.find((f) => f.id === 'F23')!.status).toBe('roadmap');
  });
});
