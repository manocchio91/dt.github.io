import type { Polygon } from 'geojson';
import { dataValue, missingValue, numericOrNull, type DataValue, type Lineage } from '../data/dataValue';
import { pointInPolygon, toLocal, type Grid } from '../geo/geo';
import type { Horizon, Intervention } from '../scenario/interventions';
import type { ModelAdapterMeta, ModelParameter } from './adapter';
import { illustrativeInterval } from './uncertainty';

/**
 * DemoIllustrativeAdapter urbano.
 *
 * Modello a copertura: per ogni punto di campionamento di ogni cella si
 * individuano gli interventi che lo coprono; l'effetto per unità di copertura
 * è un parametro ILLUSTRATIVO (low/central/high). Gli effetti di ombra non si
 * sommano (si prende il maggiore); gli altri si combinano con smorzamento 50%
 * (regola di non additività dichiarata, non validata).
 */

const DEMO_SOURCE =
  'Parametro illustrativo DEMO: ordine di grandezza indicativo, non validato su Campobasso né su altri siti. Da sostituire con modello calibrato (backlog M-01).';

type CoefKey =
  | 'ombra_albero'
  | 'ombra_schermatura'
  | 'depaving_verde'
  | 'depaving_permeabile'
  | 'depaving_ghiaia'
  | 'albedo_per_0_1'
  | 'nebulizzazione'
  | 'verde_tecnico';

const COEF_LABEL: Record<CoefKey, string> = {
  ombra_albero: 'Ombra di chioma arborea (copertura piena)',
  ombra_schermatura: 'Ombra di schermatura (copertura piena)',
  depaving_verde: 'Depaving con superficie a verde',
  depaving_permeabile: 'Depaving con pavimentazione drenante',
  depaving_ghiaia: 'Depaving con ghiaia/stabilizzato',
  albedo_per_0_1: 'Aumento albedo di 0,1',
  nebulizzazione: 'Micro-nebulizzazione attiva (entro il raggio)',
  verde_tecnico: 'Tetto/parete verde (effetto sul piano pedonale)',
};

/** Magnitudini (°C di riduzione) per [low, central, high]: low = ipotesi prudente. */
const COEF_SURFACE: Record<CoefKey, [number, number, number]> = {
  ombra_albero: [8, 12, 16],
  ombra_schermatura: [6, 10, 14],
  depaving_verde: [4, 8, 12],
  depaving_permeabile: [2, 4, 6],
  depaving_ghiaia: [1, 2, 4],
  albedo_per_0_1: [2, 3, 4],
  nebulizzazione: [0, 1, 2],
  verde_tecnico: [0, 0, 0],
};

const COEF_AIR: Record<CoefKey, [number, number, number]> = {
  ombra_albero: [0.5, 1, 2],
  ombra_schermatura: [0.2, 0.5, 1],
  depaving_verde: [0.2, 0.5, 1],
  depaving_permeabile: [0.1, 0.2, 0.4],
  depaving_ghiaia: [0, 0.1, 0.2],
  albedo_per_0_1: [0.02, 0.05, 0.1],
  nebulizzazione: [0.5, 1.5, 3],
  verde_tecnico: [0, 0.05, 0.1],
};

const PARAMETERS: ModelParameter[] = (Object.keys(COEF_LABEL) as CoefKey[]).flatMap((k) => [
  {
    key: `${k}.superficie`,
    label: `${COEF_LABEL[k]} — riduzione T superficiale`,
    unit: '°C',
    low: -COEF_SURFACE[k][0],
    central: -COEF_SURFACE[k][1],
    high: -COEF_SURFACE[k][2],
    source: DEMO_SOURCE,
  },
  {
    key: `${k}.aria`,
    label: `${COEF_LABEL[k]} — riduzione T aria 2 m`,
    unit: '°C',
    low: -COEF_AIR[k][0],
    central: -COEF_AIR[k][1],
    high: -COEF_AIR[k][2],
    source: DEMO_SOURCE,
  },
]);

export const DEMO_URBAN_META: ModelAdapterMeta = {
  id: 'demo-urban-illustrative',
  version: '0.1.0',
  kind: 'urban',
  name: 'Modello urbano a copertura (illustrativo)',
  maturity: 'demo-illustrative',
  validityScope:
    'Spazi aperti urbani di piccola scala (≤ qualche ettaro), condizioni estive soleggiate, ora di riferimento diurna. Non valido di notte, con cielo coperto, né per interni.',
  requiredInputs: ['AOI valida', 'griglia di celle', 'interventi geolocalizzati', 'baseline: T aria 2 m (opzionale), T superficiale (opzionale), UR (per nebulizzazione)'],
  outputs: [
    { key: 'delta_t_air', unit: '°C', description: 'Riduzione termica stimata dell’aria a 2 m, media AOI, all’ora di riferimento' },
    { key: 'delta_t_surface', unit: '°C', description: 'Riduzione stimata della temperatura superficiale, media AOI' },
    { key: 'delta_t_surface_max_cell', unit: '°C', description: 'Massima riduzione superficiale in una cella' },
    { key: 'area_benefited', unit: 'm²', description: 'Superficie con riduzione superficiale ≥ 2 °C' },
    { key: 'comfort_index', unit: '°C', description: 'UTCI/WBGT — non calcolato: input insufficienti' },
  ],
  assumptions: [
    'Effetto proporzionale alla quota di superficie coperta da ciascun intervento.',
    'Ombre sovrapposte non si sommano: prevale l’effetto maggiore.',
    'Effetti diversi si combinano con smorzamento del 50% per ogni effetto aggiuntivo (non additività dichiarata).',
    'Nessun trasporto d’aria tra celle, nessuna geometria 3D degli edifici, nessuna ombra portata degli edifici.',
    'La nebulizzazione è considerata attiva solo se l’umidità relativa di baseline è sotto la soglia di attivazione.',
    'Temperatura percepita (UTCI/WBGT) non calcolata: mancano temperatura media radiante e vento a quota pedone.',
  ],
  scientificSource: DEMO_SOURCE,
  uncertaintyMethod: 'Inviluppo dei parametri low/high (intervallo illustrativo, non statistico).',
  validationDate: null,
  reviewer: null,
  parameters: PARAMETERS,
  testFile: 'packages/domain/src/models/urbanDemo.test.ts',
};

export interface UrbanModelInput {
  aoi: Polygon;
  grid: Grid;
  baselineValues: readonly DataValue[];
  referenceHourLocal: number;
  interventions: readonly Intervention[];
  horizon: Horizon;
  computedAt: string;
  isDemo: boolean;
}

export interface CellResult {
  id: string;
  dTs: number;
  dTsRange: [number, number];
  dTa: number;
  dTaRange: [number, number];
}

export interface UrbanModelOutput {
  outputs: DataValue[];
  cells: CellResult[];
  notes: string[];
}

const SAMPLES_PER_SIDE = 3;
const SET_INDEX = { low: 0, central: 1, high: 2 } as const;
type SetName = keyof typeof SET_INDEX;

interface PreparedIntervention {
  i: Intervention;
  /** coordinate locali dei punti (alberi, nebulizzatori) */
  localPoints: [number, number][];
  radiusM: number;
}

function activeCoefs(
  p: PreparedIntervention,
  lon: number,
  lat: number,
  x: number,
  y: number,
  mistActive: boolean,
): { key: CoefKey; factor: number; shade: boolean }[] {
  const i = p.i;
  switch (i.type) {
    case 'albero':
      return p.localPoints.some(([tx, ty]) => Math.hypot(tx - x, ty - y) <= p.radiusM)
        ? [{ key: 'ombra_albero', factor: 1, shade: true }]
        : [];
    case 'nebulizzazione':
      return mistActive && p.localPoints.some(([tx, ty]) => Math.hypot(tx - x, ty - y) <= p.radiusM)
        ? [{ key: 'nebulizzazione', factor: 1, shade: false }]
        : [];
    case 'schermatura':
      return i.params.ombraAllOraDiRiferimento && pointInPolygon(lon, lat, i.geometry)
        ? [{ key: 'ombra_schermatura', factor: 1, shade: true }]
        : [];
    case 'depaving': {
      if (!pointInPolygon(lon, lat, i.geometry)) return [];
      const key: CoefKey =
        i.params.nuovaSuperficie === 'verde'
          ? 'depaving_verde'
          : i.params.nuovaSuperficie === 'permeabile_drenante'
            ? 'depaving_permeabile'
            : 'depaving_ghiaia';
      return [{ key, factor: 1, shade: false }];
    }
    case 'albedo':
      return pointInPolygon(lon, lat, i.geometry)
        ? [{ key: 'albedo_per_0_1', factor: (i.params.albedoFinale - i.params.albedoIniziale) / 0.1, shade: false }]
        : [];
    case 'verde_tecnico':
      return i.params.tipo === 'parete' && pointInPolygon(lon, lat, i.geometry)
        ? [{ key: 'verde_tecnico', factor: 1, shade: false }]
        : [];
  }
}

function combine(effects: number[], shadeEffects: number[]): number {
  const all = [...effects];
  if (shadeEffects.length) all.push(Math.max(...shadeEffects));
  all.sort((a, b) => b - a);
  return all.reduce((s, e, k) => s + e * 0.5 ** k, 0);
}

export function runDemoUrbanModel(input: UrbanModelInput): UrbanModelOutput {
  const { grid, interventions, horizon } = input;
  const notes: string[] = [];
  const rh = numericOrNull(input.baselineValues, 'rh_ref_hour');

  const prepared: PreparedIntervention[] = interventions.map((i) => {
    if (i.type === 'albero') {
      const d = horizon === 'maturita' ? i.params.diametroChiomaMaturaM : i.params.diametroChiomaInizialeM;
      return {
        i,
        localPoints: i.geometry.coordinates.map((c) => toLocal(grid.frame, c[0]!, c[1]!)),
        radiusM: d / 2,
      };
    }
    if (i.type === 'nebulizzazione') {
      return {
        i,
        localPoints: i.geometry.coordinates.map((c) => toLocal(grid.frame, c[0]!, c[1]!)),
        radiusM: i.params.raggioInfluenzaM,
      };
    }
    return { i, localPoints: [], radiusM: 0 };
  });

  const mistActiveById = new Map<string, boolean>();
  for (const p of prepared) {
    if (p.i.type !== 'nebulizzazione') continue;
    if (rh === null) {
      notes.push(`${p.i.label}: umidità relativa di baseline mancante, nebulizzazione non valutabile (effetto escluso).`);
      mistActiveById.set(p.i.id, false);
    } else if (rh > p.i.params.urMassimaAttivazionePct) {
      notes.push(`${p.i.label}: UR di baseline ${Math.round(rh)}% > soglia ${p.i.params.urMassimaAttivazionePct}%: sistema non attivo all'ora di riferimento.`);
      mistActiveById.set(p.i.id, false);
    } else mistActiveById.set(p.i.id, true);
  }
  if (interventions.some((i) => i.type === 'verde_tecnico' && i.params.tipo === 'tetto')) {
    notes.push('Tetti verdi: nessun effetto calcolato sul piano pedonale; benefici su edificio e drenaggio non modellati in M0.');
  }

  const size = grid.cellSizeM;
  const cells: CellResult[] = grid.cells.map((cell) => {
    const sums = { ts: [0, 0, 0], ta: [0, 0, 0] };
    for (let sx = 0; sx < SAMPLES_PER_SIDE; sx++) {
      for (let sy = 0; sy < SAMPLES_PER_SIDE; sy++) {
        const x = (cell.col + (sx + 0.5) / SAMPLES_PER_SIDE) * size;
        const y = (cell.row + (sy + 0.5) / SAMPLES_PER_SIDE) * size;
        const lon = grid.frame.lon0 + x / grid.frame.mPerDegLon;
        const lat = grid.frame.lat0 + y / grid.frame.mPerDegLat;
        const active = prepared.flatMap((p) =>
          activeCoefs(p, lon, lat, x, y, mistActiveById.get(p.i.id) ?? false),
        );
        for (const set of ['low', 'central', 'high'] as SetName[]) {
          const k = SET_INDEX[set];
          const ts = combine(
            active.filter((a) => !a.shade).map((a) => COEF_SURFACE[a.key][k] * a.factor),
            active.filter((a) => a.shade).map((a) => COEF_SURFACE[a.key][k] * a.factor),
          );
          const ta = combine(
            active.filter((a) => !a.shade).map((a) => COEF_AIR[a.key][k] * a.factor),
            active.filter((a) => a.shade).map((a) => COEF_AIR[a.key][k] * a.factor),
          );
          sums.ts[k]! += ts;
          sums.ta[k]! += ta;
        }
      }
    }
    const n = SAMPLES_PER_SIDE * SAMPLES_PER_SIDE;
    const ts = sums.ts.map((v) => -v / n) as [number, number, number];
    const ta = sums.ta.map((v) => -v / n) as [number, number, number];
    return {
      id: cell.id,
      dTs: round3(ts[1]),
      dTsRange: [round3(Math.min(...ts)), round3(Math.max(...ts))],
      dTa: round3(ta[1]),
      dTaRange: [round3(Math.min(...ta)), round3(Math.max(...ta))],
    };
  });

  const meanBy = (k: 0 | 1 | 2, which: 'ts' | 'ta') => {
    if (cells.length === 0) return 0;
    const pick = (c: CellResult) =>
      which === 'ts' ? (k === 1 ? c.dTs : k === 0 ? c.dTsRange[1] : c.dTsRange[0]) : k === 1 ? c.dTa : k === 0 ? c.dTaRange[1] : c.dTaRange[0];
    return cells.reduce((s, c) => s + pick(c), 0) / cells.length;
  };
  const cellArea = grid.cellSizeM ** 2;
  const areaBenefited = (pick: (c: CellResult) => number) => cells.filter((c) => pick(c) <= -2).length * cellArea;

  const lineage = (formula: string, extra: Partial<Lineage> = {}): Lineage => ({
    source: 'Scenario simulato con modello dichiarato',
    acquiredAt: input.computedAt,
    coordinates: 'area',
    spatialResolution: `celle ${grid.cellSizeM} m`,
    temporalResolution: `ora di riferimento ${String(input.referenceHourLocal).padStart(2, '0')}:00 Europe/Rome`,
    transforms: [grid.method, `${SAMPLES_PER_SIDE}×${SAMPLES_PER_SIDE} punti di campionamento per cella`],
    formula,
    modelId: DEMO_URBAN_META.id,
    modelVersion: DEMO_URBAN_META.version,
    quality: 'non valutata',
    limitations: [...DEMO_URBAN_META.assumptions.slice(3), 'Coefficienti illustrativi DEMO non validati.'],
    usage: 'Confronto tra scenari a parità di baseline e modello.',
    isDemo: input.isDemo,
    ...extra,
  });

  const outputs: DataValue[] = [];
  const pushInterval = (key: string, label: string, low: number, central: number, high: number, formula: string) => {
    const iv = illustrativeInterval(low, central, high);
    outputs.push(
      dataValue({ key, label, unit: '°C', value: iv.value, range: iv.range, rangeLabel: iv.label, dataClass: 'SIMULATO', lineage: lineage(formula) }),
    );
    return iv;
  };

  const hh = String(input.referenceHourLocal).padStart(2, '0');
  const dTa = pushInterval(
    'delta_t_air',
    `Riduzione termica stimata — aria a 2 m (media AOI, ore ${hh}:00)`,
    meanBy(0, 'ta'),
    meanBy(1, 'ta'),
    meanBy(2, 'ta'),
    'ΔTa = media celle [ Σ_k e_k · 0,5^k ], e_k = coefficiente aria × copertura; ombre: max',
  );
  const dTs = pushInterval(
    'delta_t_surface',
    `Riduzione stimata — temperatura superficiale (media AOI, ore ${hh}:00)`,
    meanBy(0, 'ts'),
    meanBy(1, 'ts'),
    meanBy(2, 'ts'),
    'ΔTs = media celle [ Σ_k e_k · 0,5^k ], e_k = coefficiente superficie × copertura; ombre: max',
  );
  const minCell = (pick: (c: CellResult) => number) => (cells.length ? Math.min(...cells.map(pick)) : 0);
  pushInterval(
    'delta_t_surface_max_cell',
    'Massima riduzione superficiale stimata in una cella',
    minCell((c) => c.dTsRange[1]),
    minCell((c) => c.dTs),
    minCell((c) => c.dTsRange[0]),
    'min sulle celle di ΔTs',
  );

  const tAir = numericOrNull(input.baselineValues, 't_air_ref_hour');
  if (tAir === null) {
    outputs.push(missingValue('t_air_scenario', 'Temperatura aria 2 m nello scenario', '°C', 'Baseline senza temperatura dell’aria.'));
  } else {
    const iv = illustrativeInterval(tAir + dTa.range[0], tAir + dTa.value, tAir + dTa.range[1]);
    outputs.push(
      dataValue({ key: 't_air_scenario', label: `Temperatura aria 2 m nello scenario (ore ${hh}:00)`, unit: '°C', value: iv.value, range: iv.range, rangeLabel: iv.label, dataClass: 'SIMULATO', lineage: lineage('T aria baseline + ΔTa') }),
    );
  }
  const tSurf = numericOrNull(input.baselineValues, 't_surface_ref_hour');
  if (tSurf === null) {
    outputs.push(missingValue('t_surface_scenario', 'Temperatura superficiale nello scenario', '°C', 'Baseline senza temperatura superficiale (serve prodotto satellitare LST o misura).'));
  } else {
    const iv = illustrativeInterval(tSurf + dTs.range[0], tSurf + dTs.value, tSurf + dTs.range[1]);
    outputs.push(
      dataValue({ key: 't_surface_scenario', label: `Temperatura superficiale nello scenario (ore ${hh}:00)`, unit: '°C', value: iv.value, range: iv.range, rangeLabel: iv.label, dataClass: 'SIMULATO', lineage: lineage('T superficiale baseline + ΔTs') }),
    );
  }

  const aLow = areaBenefited((c) => c.dTsRange[1]);
  const aCen = areaBenefited((c) => c.dTs);
  const aHigh = areaBenefited((c) => c.dTsRange[0]);
  const r10 = (v: number) => Math.round(v / 10) * 10;
  outputs.push(
    dataValue({
      key: 'area_benefited',
      label: 'Superficie con riduzione superficiale ≥ 2 °C',
      unit: 'm²',
      value: r10(aCen),
      range: [r10(Math.min(aLow, aHigh)), r10(Math.max(aLow, aHigh))],
      rangeLabel: 'intervallo illustrativo',
      dataClass: 'SIMULATO',
      lineage: lineage('Σ aree celle con ΔTs ≤ −2 °C (soglia descrittiva, non normativa)'),
    }),
  );
  outputs.push(
    missingValue(
      'comfort_index',
      'Indice di comfort termico (UTCI / WBGT)',
      '°C',
      'Non calcolato: servono temperatura media radiante, vento a quota pedone e radiazione locale validata (backlog M-02).',
      { isDemo: input.isDemo },
    ),
  );

  return { outputs, cells, notes };
}

function round3(v: number): number {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
}

/** Dimensione di cella adatta alla superficie (circa 600 celle, minimo 2 m). */
export function suggestedCellSize(areaM2: number): number {
  return Math.max(2, Math.ceil(Math.sqrt(areaM2 / 600)));
}
