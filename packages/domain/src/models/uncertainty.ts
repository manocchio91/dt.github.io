import type { ModelAdapterMeta } from './adapter';

/**
 * UncertaintyAdapter DEMO: l'intervallo deriva dalla propagazione dei valori
 * low/high dei parametri illustrativi. Non è un intervallo statistico.
 */
export const DEMO_UNCERTAINTY_META: ModelAdapterMeta = {
  id: 'demo-uncertainty-envelope',
  version: '0.1.0',
  kind: 'uncertainty',
  name: 'Inviluppo dei parametri (illustrativo)',
  maturity: 'demo-illustrative',
  validityScope: 'Qualunque output dei modelli DEMO di questa applicazione.',
  requiredInputs: ['esito del modello con parametri low, central, high'],
  outputs: [{ key: 'range', unit: 'come output', description: 'intervallo illustrativo arrotondato verso l’esterno' }],
  assumptions: [
    "Gli estremi dell'intervallo corrispondono ai parametri low e high: non c'è una distribuzione di probabilità.",
    "L'arrotondamento dipende dall'ampiezza dell'intervallo per evitare falsa precisione.",
  ],
  scientificSource: 'Analisi di sensitività a un fattore per volta / inviluppo: metodo dichiarato, non validato.',
  uncertaintyMethod: 'Inviluppo min–max dei parametri; etichetta "intervallo illustrativo".',
  validationDate: null,
  reviewer: null,
  parameters: [],
  testFile: 'packages/domain/src/models/uncertainty.test.ts',
};

export interface IllustrativeInterval {
  value: number;
  range: [number, number];
  step: number;
  label: 'intervallo illustrativo';
  isStatistical: false;
  method: string;
}

/** Passo di arrotondamento coerente con l'ampiezza dell'intervallo. */
export function roundingStep(width: number): number {
  if (width >= 5) return 1;
  if (width >= 1) return 0.5;
  if (width >= 0.2) return 0.1;
  return 0.05;
}

function roundTo(x: number, step: number, mode: 'round' | 'floor' | 'ceil'): number {
  const r = Math[mode](x / step) * step;
  // evita -0 e artefatti binari
  return Number((r === 0 ? 0 : r).toFixed(2));
}

export function illustrativeInterval(a: number, central: number, b: number): IllustrativeInterval {
  const lo = Math.min(a, central, b);
  const hi = Math.max(a, central, b);
  const step = roundingStep(hi - lo);
  return {
    value: roundTo(central, step, 'round'),
    range: [roundTo(lo, step, 'floor'), roundTo(hi, step, 'ceil')],
    step,
    label: 'intervallo illustrativo',
    isStatistical: false,
    method: DEMO_UNCERTAINTY_META.uncertaintyMethod,
  };
}
