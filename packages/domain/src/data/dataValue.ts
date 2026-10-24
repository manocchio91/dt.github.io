/**
 * Classificazione obbligatoria dei dati (§6). Ogni numero mostrato in UI
 * passa da un DataValue: valore (o range), unità, classe e lineage.
 */

export const DATA_CLASSES = [
  'MISURATO',
  'OSSERVATO_DA_DATASET',
  'STIMATO_DA_MODELLO',
  'PREVISIONE',
  'SIMULATO',
  'INSERITO_DALL_UTENTE',
  'DATO_MANCANTE',
] as const;

export type DataClass = (typeof DATA_CLASSES)[number];

export const DATA_CLASS_LABEL: Record<DataClass, string> = {
  MISURATO: 'MISURATO',
  OSSERVATO_DA_DATASET: 'OSSERVATO DA DATASET',
  STIMATO_DA_MODELLO: 'STIMATO DA MODELLO',
  PREVISIONE: 'PREVISIONE',
  SIMULATO: 'SIMULATO',
  INSERITO_DALL_UTENTE: "INSERITO DALL'UTENTE",
  DATO_MANCANTE: 'DATO MANCANTE',
};

export const DATA_CLASS_DESCRIPTION: Record<DataClass, string> = {
  MISURATO: 'Valore rilevato da un sensore fisico identificato e controllato.',
  OSSERVATO_DA_DATASET: 'Dato storico o territoriale proveniente da una fonte dichiarata.',
  STIMATO_DA_MODELLO: 'Valore derivato da un modello (non è una misura sul posto).',
  PREVISIONE: 'Valore futuro con orizzonte temporale dichiarato.',
  SIMULATO: 'Risultato di uno scenario o dato dimostrativo sintetico.',
  INSERITO_DALL_UTENTE: "Valore inserito manualmente dall'utente.",
  DATO_MANCANTE: 'Il dato non è disponibile: non viene sostituito con valori fittizi.',
};

export type QualityLevel = 'alta' | 'media' | 'bassa' | 'non valutata';

export interface Lineage {
  source: string;
  endpoint?: string;
  /** ISO 8601 UTC */
  acquiredAt: string;
  license?: string;
  coordinates?: { lat: number; lon: number } | 'area';
  spatialResolution?: string;
  temporalResolution?: string;
  height?: string;
  depth?: string;
  forecastHorizon?: string;
  transforms: string[];
  formula?: string;
  modelId?: string;
  modelVersion?: string;
  quality: QualityLevel;
  qualityFlags?: string[];
  limitations: string[];
  /** Come il valore entra nel calcolo */
  usage?: string;
  isDemo: boolean;
}

export interface DataValue {
  key: string;
  label: string;
  unit: string;
  /** null soltanto quando dataClass === 'DATO_MANCANTE' */
  value: number | null;
  range?: [number, number];
  /** Etichetta dell'intervallo: 'intervallo illustrativo' se non statistico */
  rangeLabel?: string;
  dataClass: DataClass;
  lineage: Lineage;
  missingReason?: string;
}

export function dataValue(v: DataValue): DataValue {
  if (v.dataClass === 'DATO_MANCANTE' && v.value !== null) {
    throw new Error(`${v.key}: un DATO MANCANTE non può avere un valore numerico`);
  }
  if (v.dataClass !== 'DATO_MANCANTE' && (v.value === null || !Number.isFinite(v.value))) {
    throw new Error(`${v.key}: valore non finito per la classe ${v.dataClass}; usa DATO_MANCANTE`);
  }
  if (v.range && v.range[0] > v.range[1]) {
    throw new Error(`${v.key}: range invertito`);
  }
  return v;
}

export function missingValue(
  key: string,
  label: string,
  unit: string,
  reason: string,
  lineage: Partial<Lineage> = {},
): DataValue {
  return dataValue({
    key,
    label,
    unit,
    value: null,
    dataClass: 'DATO_MANCANTE',
    missingReason: reason,
    lineage: {
      source: lineage.source ?? 'Nessuna fonte disponibile',
      acquiredAt: lineage.acquiredAt ?? new Date(0).toISOString(),
      transforms: lineage.transforms ?? [],
      quality: 'non valutata',
      limitations: lineage.limitations ?? [reason],
      isDemo: lineage.isDemo ?? false,
      ...lineage,
    },
  });
}

export function userValue(
  key: string,
  label: string,
  unit: string,
  value: number,
  acquiredAt: string,
  usage?: string,
  isDemo = false,
): DataValue {
  return dataValue({
    key,
    label,
    unit,
    value,
    dataClass: 'INSERITO_DALL_UTENTE',
    lineage: {
      source: "Inserimento manuale dell'utente",
      acquiredAt,
      transforms: [],
      quality: 'non valutata',
      limitations: ["Valore non verificato automaticamente: la correttezza dipende dall'utente."],
      usage,
      isDemo,
    },
  });
}

export function findValue(values: readonly DataValue[], key: string): DataValue | undefined {
  return values.find((v) => v.key === key);
}

/** Valore numerico utilizzabile nel calcolo, oppure null se mancante. */
export function numericOrNull(values: readonly DataValue[], key: string): number | null {
  const v = findValue(values, key);
  return v && v.dataClass !== 'DATO_MANCANTE' ? v.value : null;
}
