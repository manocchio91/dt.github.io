import { describe, expect, it } from 'vitest';
import { DATA_CLASSES, DATA_CLASS_LABEL, dataValue, missingValue, numericOrNull, userValue } from './dataValue';

const lineage = { source: 's', acquiredAt: '2026-01-01T00:00:00Z', transforms: [], quality: 'alta' as const, limitations: [], isDemo: false };

describe('DataValue', () => {
  it('definisce le 7 classi obbligatorie con etichetta', () => {
    expect(DATA_CLASSES).toHaveLength(7);
    expect(DATA_CLASS_LABEL.STIMATO_DA_MODELLO).toBe('STIMATO DA MODELLO');
    expect(DATA_CLASS_LABEL.INSERITO_DALL_UTENTE).toBe("INSERITO DALL'UTENTE");
  });

  it('rifiuta un DATO MANCANTE con valore numerico', () => {
    expect(() => dataValue({ key: 'k', label: 'l', unit: '°C', value: 3, dataClass: 'DATO_MANCANTE', lineage })).toThrow();
  });

  it('rifiuta valori non finiti al posto di un dato mancante', () => {
    expect(() => dataValue({ key: 'k', label: 'l', unit: '°C', value: Number.NaN, dataClass: 'SIMULATO', lineage })).toThrow();
    expect(() => dataValue({ key: 'k', label: 'l', unit: '°C', value: null, dataClass: 'MISURATO', lineage })).toThrow();
  });

  it('il dato mancante porta una motivazione e non entra nel calcolo', () => {
    const m = missingValue('t', 'T', '°C', 'sensore assente');
    expect(m.value).toBeNull();
    expect(m.missingReason).toBe('sensore assente');
    expect(numericOrNull([m], 't')).toBeNull();
  });

  it('il valore inserito dall’utente ha lineage dichiarato', () => {
    const v = userValue('fc', 'Capacità di campo', 'm³/m³', 0.25, '2026-01-01T00:00:00Z');
    expect(v.dataClass).toBe('INSERITO_DALL_UTENTE');
    expect(v.lineage.limitations.length).toBeGreaterThan(0);
  });
});
