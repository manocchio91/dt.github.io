import { describe, expect, it } from 'vitest';
import { DEMO_EXPOST_CSV, DEMO_EXPOST_POINTS, seedCampobasso } from '../seeds/seeds';
import { compareExPost, parseMeasurementsCsv, proposeRecalibration, romeHour, type VerificationPlan } from './expost';

const now = new Date('2026-10-24T08:00:00Z');

describe('Verifica ex-post', () => {
  const b = seedCampobasso(now);
  const predicted = b.runs[0]!.outputs.find((o) => o.key === 'delta_t_surface')!;
  const plan: VerificationPlan = {
    id: 'v1',
    projectId: b.project.id,
    scenarioId: b.scenarios[0]!.id,
    outputKey: 'delta_t_surface',
    variable: 'temperatura_superficiale',
    unit: '°C',
    points: DEMO_EXPOST_POINTS,
    periodStart: '2030-07-01',
    periodEnd: '2030-08-31',
    frequency: 'giornaliera alle 15:00',
    homogeneity: { referenceHourLocal: 15, toleranceHours: 1, notes: 'giornate serene' },
    createdAt: now.toISOString(),
  };

  it('legge il CSV e rifiuta righe non valide', () => {
    const ok = parseMeasurementsCsv(DEMO_EXPOST_CSV);
    expect(ok.errors).toEqual([]);
    expect(ok.records).toHaveLength(7);
    const bad = parseMeasurementsCsv('punto,fase,variabile,timestamp,valore,unita,sensore,classe\nP1,dopo,x,2025-01-01T00:00:00Z,abc,°C,s,MISURATO');
    expect(bad.errors.length).toBe(1);
    expect(parseMeasurementsCsv('a,b\n1,2').errors[0]).toMatch(/Colonne mancanti/);
  });

  it('calcola ora locale Europe/Rome', () => {
    expect(romeHour('2025-07-20T13:00:00Z')).toBe(15);
  });

  it('confronta previsto e osservato a condizioni omogenee ed esclude le misure fuori finestra', () => {
    const recs = parseMeasurementsCsv(DEMO_EXPOST_CSV).records;
    const c = compareExPost(plan, predicted, recs);
    expect(c.excluded.count).toBe(1); // la misura delle 09:00
    expect(c.nAnte).toBe(3);
    expect(c.nPost).toBe(3);
    expect(c.observed).toBeCloseTo(-3.3, 1);
    expect(c.residual).toBeCloseTo(c.observed! - c.predicted, 5);
    expect(c.observedClass).toBe('SIMULATO');
    expect(c.notes.join(' ')).toMatch(/dimostrativo/);
  });

  it('senza misure post non inventa un osservato', () => {
    const recs = parseMeasurementsCsv(DEMO_EXPOST_CSV).records.filter((r) => r.phase === 'ante');
    const c = compareExPost(plan, predicted, recs);
    expect(c.observed).toBeNull();
    expect(c.observedClass).toBe('DATO_MANCANTE');
  });

  it('la ricalibrazione è una proposta di nuova versione, non una sovrascrittura', () => {
    const c = compareExPost(plan, predicted, parseMeasurementsCsv(DEMO_EXPOST_CSV).records);
    const p1 = proposeRecalibration('demo-urban-illustrative@0.1.0', c, 'Riduzione osservata minore del previsto centrale.', [], now);
    expect(p1.proposedVersion).toBe('0.1.0-cal.1');
    expect(p1.status).toMatch(/richiede validazione/);
    const p2 = proposeRecalibration('demo-urban-illustrative@0.1.0', c, 'Seconda proposta dopo nuova campagna.', [p1], now);
    expect(p2.proposedVersion).toBe('0.1.0-cal.2');
    expect(() => proposeRecalibration('m@1', c, 'corta', [], now)).toThrow();
  });
});
