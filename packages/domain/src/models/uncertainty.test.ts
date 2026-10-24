import { describe, expect, it } from 'vitest';
import { illustrativeInterval, roundingStep } from './uncertainty';

describe('Incertezza illustrativa', () => {
  it('non è statistica ed è etichettata come intervallo illustrativo', () => {
    const iv = illustrativeInterval(-0.4, -1.13, -2.27);
    expect(iv.isStatistical).toBe(false);
    expect(iv.label).toBe('intervallo illustrativo');
  });

  it("arrotonda in modo coerente con l'ampiezza (niente falsa precisione)", () => {
    const iv = illustrativeInterval(-4.1, -7.37, -11.6);
    expect(iv.step).toBe(1);
    expect(iv.value).toBe(-7);
    expect(iv.range).toEqual([-12, -4]);
    expect(roundingStep(0.5)).toBe(0.1);
    expect(roundingStep(2)).toBe(0.5);
  });

  it("arrotonda l'intervallo verso l'esterno", () => {
    const iv = illustrativeInterval(-0.62, -1.1, -1.88);
    expect(iv.range[0]).toBeLessThanOrEqual(-1.88);
    expect(iv.range[1]).toBeGreaterThanOrEqual(-0.62);
  });
});
