import { geodesicAreaM2 } from '../geo/geo';
import { INTERVENTION_LABEL, interventionQuantity, type Intervention, type InterventionType } from '../scenario/interventions';
import type { ModelAdapterMeta, ModelParameter } from './adapter';

/**
 * CostModelAdapter DEMO. Costo prototipo/software, CAPEX, OPEX e acqua sono
 * SEMPRE separati: il costo zero del prototipo non è il costo dell'intervento.
 */

const COST_SOURCE =
  'Costo parametrico illustrativo DEMO, non derivato da prezzario. Da sostituire con prezzario regionale vigente o preventivi (backlog M-04).';

type Triple = [number, number, number];

interface UnitCost {
  unit: string;
  capex: Triple;
  opexYear: Triple;
  waterM3Year: Triple | 'da_parametri';
  maintenance: string;
  realizationWeeks: Triple;
  coBenefits: string[];
  constraints: string[];
}

const UNIT_COSTS: Record<InterventionType, UnitCost> = {
  albero: {
    unit: '€/albero',
    capex: [500, 1200, 3000],
    opexYear: [30, 60, 120],
    waterM3Year: [0.5, 1.5, 3],
    maintenance: 'Irrigazione di soccorso nei primi 3 anni, potature, controllo stabilità.',
    realizationWeeks: [2, 4, 8],
    coBenefits: ['biodiversità', 'qualità percepita dello spazio', 'intercettazione pioggia'],
    constraints: ['sottoservizi', 'distanze da edifici', 'tempo di crescita della chioma'],
  },
  depaving: {
    unit: '€/m²',
    capex: [60, 120, 250],
    opexYear: [1, 3, 6],
    waterM3Year: [0, 0.2, 0.4],
    maintenance: 'Pulizia drenaggi, sfalcio se a verde, ripristino giunti.',
    realizationWeeks: [3, 6, 12],
    coBenefits: ['infiltrazione acque meteoriche', 'riduzione carico fognario'],
    constraints: ['portanza per mezzi', 'accessibilità e superfici calpestabili', 'sottoservizi'],
  },
  schermatura: {
    unit: '€/m²',
    capex: [80, 150, 300],
    opexYear: [3, 6, 12],
    waterM3Year: [0, 0, 0],
    maintenance: 'Montaggio/smontaggio stagionale, verifica ancoraggi e carico vento.',
    realizationWeeks: [2, 4, 8],
    coBenefits: ['protezione UV', 'uso stagionale flessibile'],
    constraints: ['vincoli paesaggistici e storici', 'carico vento', 'ancoraggi a facciate'],
  },
  albedo: {
    unit: '€/m²',
    capex: [15, 30, 60],
    opexYear: [0.5, 1, 2],
    waterM3Year: [0, 0, 0],
    maintenance: 'Pulizia per conservare la riflettanza, rifacimento periodico.',
    realizationWeeks: [1, 2, 4],
    coBenefits: ['minor accumulo di calore nella pavimentazione'],
    constraints: ['abbagliamento', 'radiazione riflessa sui pedoni', 'decadimento riflettanza'],
  },
  nebulizzazione: {
    unit: '€/punto',
    capex: [800, 1500, 3000],
    opexYear: [100, 200, 400],
    waterM3Year: 'da_parametri',
    maintenance: 'Pulizia ugelli, controllo Legionella, svuotamento invernale.',
    realizationWeeks: [1, 3, 6],
    coBenefits: ['raffrescamento locale immediato'],
    constraints: ['consumo idrico', 'efficacia solo con aria secca', 'igiene dell’acqua'],
  },
  verde_tecnico: {
    unit: '€/m²',
    capex: [60, 100, 180],
    opexYear: [2, 4, 8],
    waterM3Year: [0.1, 0.3, 0.5],
    maintenance: 'Ispezioni, irrigazione, sostituzione fallanze.',
    realizationWeeks: [4, 8, 16],
    coBenefits: ['isolamento edificio', 'ritenzione idrica', 'biodiversità'],
    constraints: ['portata strutturale', 'impermeabilizzazione', 'accesso per manutenzione'],
  },
};

export const DEMO_COST_META: ModelAdapterMeta = {
  id: 'demo-cost-parametric',
  version: '0.1.0',
  kind: 'cost',
  name: 'Costi parametrici (illustrativi)',
  maturity: 'demo-illustrative',
  validityScope: 'Ordine di grandezza per confronto tra alternative; non utilizzabile per computi metrici o gare.',
  requiredInputs: ['interventi con quantità derivate dalla geometria'],
  outputs: [
    { key: 'prototype', unit: '€', description: 'Costo del prototipo software (separato)' },
    { key: 'capex', unit: '€', description: 'Investimento iniziale dell’intervento' },
    { key: 'opex', unit: '€/anno', description: 'Costo annuo di gestione e manutenzione' },
    { key: 'water', unit: 'm³/anno', description: 'Consumo idrico annuo stimato' },
  ],
  assumptions: [
    'Costo = quantità × costo unitario; nessuna economia di scala.',
    'IVA, progettazione, sicurezza e oneri accessori non inclusi.',
    'Il costo del prototipo software è distinto e non riduce il costo dell’intervento.',
  ],
  scientificSource: COST_SOURCE,
  uncertaintyMethod: 'Inviluppo dei costi unitari low/high.',
  validationDate: null,
  reviewer: null,
  parameters: (Object.keys(UNIT_COSTS) as InterventionType[]).flatMap((t): ModelParameter[] => [
    { key: `${t}.capex`, label: `${INTERVENTION_LABEL[t]} — CAPEX`, unit: UNIT_COSTS[t].unit, low: UNIT_COSTS[t].capex[0], central: UNIT_COSTS[t].capex[1], high: UNIT_COSTS[t].capex[2], source: COST_SOURCE },
    { key: `${t}.opex`, label: `${INTERVENTION_LABEL[t]} — OPEX annuo`, unit: `${UNIT_COSTS[t].unit}/anno`, low: UNIT_COSTS[t].opexYear[0], central: UNIT_COSTS[t].opexYear[1], high: UNIT_COSTS[t].opexYear[2], source: COST_SOURCE },
  ]),
  testFile: 'packages/domain/src/models/costDemo.test.ts',
};

export interface CostLine {
  interventionId: string;
  label: string;
  type: InterventionType;
  quantity: number;
  unit: string;
  capex: Triple;
  opexYear: Triple;
  waterM3Year: Triple;
  maintenance: string;
  realizationWeeks: Triple;
  coBenefits: string[];
  constraints: string[];
}

export interface CostBreakdown {
  /** Costo del prototipo software: separato dall'intervento */
  prototype: { value: number; unit: '€'; note: string };
  lines: CostLine[];
  capex: Triple;
  opexYear: Triple;
  waterM3Year: Triple;
  realizationWeeks: Triple;
  modelRef: string;
}

const mul = (t: Triple, q: number): Triple => [t[0] * q, t[1] * q, t[2] * q];
const add = (a: Triple, b: Triple): Triple => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const r = (t: Triple, step: number): Triple => t.map((v) => Math.round(v / step) * step) as Triple;

export function estimateCosts(interventions: readonly Intervention[]): CostBreakdown {
  const lines: CostLine[] = interventions.map((i) => {
    const uc = UNIT_COSTS[i.type];
    const q = interventionQuantity(i);
    let water: Triple;
    if (uc.waterM3Year === 'da_parametri' && i.type === 'nebulizzazione') {
      const m3 = (i.params.portataLH * i.params.durataOreGiorno * i.params.giorniAnno * q.value) / 1000;
      water = [m3, m3, m3];
    } else if (uc.waterM3Year === 'da_parametri') {
      water = [0, 0, 0];
    } else if (i.type === 'depaving' && i.params.nuovaSuperficie !== 'verde') {
      water = [0, 0, 0];
    } else if (i.type === 'verde_tecnico' && !i.params.irrigato) {
      water = [0, 0, 0];
    } else {
      water = mul(uc.waterM3Year, i.geometry.type === 'Polygon' ? geodesicAreaM2(i.geometry) : q.value);
    }
    return {
      interventionId: i.id,
      label: i.label,
      type: i.type,
      quantity: q.value,
      unit: q.unit,
      capex: r(mul(uc.capex, q.value), 100),
      opexYear: r(mul(uc.opexYear, q.value), 10),
      waterM3Year: r(water, 1),
      maintenance: uc.maintenance,
      realizationWeeks: uc.realizationWeeks,
      coBenefits: uc.coBenefits,
      constraints: uc.constraints,
    };
  });
  const zero: Triple = [0, 0, 0];
  return {
    prototype: {
      value: 0,
      unit: '€',
      note: 'Prototipo software dimostrativo open source: costo 0 € per il Comune in fase Demo. Non include l’intervento, la progettazione né l’eventuale servizio in modalità Pilota.',
    },
    lines,
    capex: lines.reduce((s, l) => add(s, l.capex), zero),
    opexYear: lines.reduce((s, l) => add(s, l.opexYear), zero),
    waterM3Year: lines.reduce((s, l) => add(s, l.waterM3Year), zero),
    // interventi realizzabili in parallelo: la durata è il massimo, non la somma
    realizationWeeks: lines.reduce<Triple>(
      (s, l) => [Math.max(s[0], l.realizationWeeks[0]), Math.max(s[1], l.realizationWeeks[1]), Math.max(s[2], l.realizationWeeks[2])],
      zero,
    ),
    modelRef: `${DEMO_COST_META.id}@${DEMO_COST_META.version}`,
  };
}
