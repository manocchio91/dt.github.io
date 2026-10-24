import type { Polygon } from 'geojson';
import { pointInPolygon } from '../geo/geo';
import type { QualityLevel } from './dataValue';

/** Controlli QA/QC sulle serie (§8). */

export interface SeriesPoint {
  t: string; // ISO 8601
  value: number | null;
  unit: string;
  lon?: number;
  lat?: number;
}

export type QaCode =
  | 'UNITA_INCOMPATIBILE'
  | 'TIMESTAMP_FUTURO'
  | 'TIMESTAMP_NON_VALIDO'
  | 'DUPLICATO'
  | 'FUORI_RANGE'
  | 'VALORE_ASSENTE'
  | 'GAP'
  | 'FUORI_AREA'
  | 'DATO_OBSOLETO';

export interface QaFlag {
  index: number;
  code: QaCode;
  message: string;
}

export interface QaOptions {
  expectedUnit: string;
  validMin: number;
  validMax: number;
  now: Date;
  maxGapMinutes?: number;
  staleAfterHours?: number;
  aoi?: Polygon;
}

export interface QaReport {
  checkedAt: string;
  total: number;
  valid: number;
  flags: QaFlag[];
  quality: QualityLevel;
}

export function qaSeries(points: readonly SeriesPoint[], o: QaOptions): QaReport {
  const flags: QaFlag[] = [];
  const seen = new Set<string>();
  const times: { i: number; ms: number }[] = [];

  points.forEach((p, i) => {
    const ms = Date.parse(p.t);
    if (Number.isNaN(ms)) {
      flags.push({ index: i, code: 'TIMESTAMP_NON_VALIDO', message: `Timestamp non valido: ${p.t}` });
      return;
    }
    if (ms > o.now.getTime()) {
      flags.push({ index: i, code: 'TIMESTAMP_FUTURO', message: `Timestamp nel futuro: ${p.t}` });
    }
    if (seen.has(p.t)) flags.push({ index: i, code: 'DUPLICATO', message: `Timestamp duplicato: ${p.t}` });
    seen.add(p.t);
    times.push({ i, ms });

    if (p.unit !== o.expectedUnit) {
      flags.push({ index: i, code: 'UNITA_INCOMPATIBILE', message: `Unità "${p.unit}" ≠ attesa "${o.expectedUnit}"` });
    }
    if (p.value === null || !Number.isFinite(p.value)) {
      flags.push({ index: i, code: 'VALORE_ASSENTE', message: 'Valore assente' });
    } else if (p.value < o.validMin || p.value > o.validMax) {
      flags.push({ index: i, code: 'FUORI_RANGE', message: `${p.value} fuori da [${o.validMin}, ${o.validMax}]` });
    }
    if (o.aoi && p.lon !== undefined && p.lat !== undefined && !pointInPolygon(p.lon, p.lat, o.aoi)) {
      flags.push({ index: i, code: 'FUORI_AREA', message: 'Coordinate fuori dall’area di interesse' });
    }
  });

  times.sort((a, b) => a.ms - b.ms);
  if (o.maxGapMinutes !== undefined) {
    for (let k = 1; k < times.length; k++) {
      const gap = (times[k]!.ms - times[k - 1]!.ms) / 60000;
      if (gap > o.maxGapMinutes) {
        flags.push({ index: times[k]!.i, code: 'GAP', message: `Gap di ${Math.round(gap)} min prima di questo punto` });
      }
    }
  }
  const lastTime = times.at(-1);
  if (o.staleAfterHours !== undefined && lastTime) {
    const ageH = (o.now.getTime() - lastTime.ms) / 3_600_000;
    if (ageH > o.staleAfterHours) {
      flags.push({ index: lastTime.i, code: 'DATO_OBSOLETO', message: `Ultimo dato di ${Math.round(ageH)} h fa` });
    }
  }

  const badIdx = new Set(
    flags.filter((f) => f.code !== 'GAP' && f.code !== 'DATO_OBSOLETO').map((f) => f.index),
  );
  const valid = points.length - badIdx.size;
  const ratio = points.length ? valid / points.length : 0;
  const quality: QualityLevel = points.length === 0 ? 'non valutata' : ratio >= 0.95 ? 'alta' : ratio >= 0.8 ? 'media' : 'bassa';
  return { checkedAt: o.now.toISOString(), total: points.length, valid, flags, quality };
}
