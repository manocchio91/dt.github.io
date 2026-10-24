import { describe, expect, it } from 'vitest';
import { qaSeries } from './qa';
import { CAMPOBASSO_AOI } from '../seeds/seeds';

const now = new Date('2026-07-10T12:00:00Z');
const base = { expectedUnit: '°C', validMin: -30, validMax: 60, now, maxGapMinutes: 90, staleAfterHours: 24, aoi: CAMPOBASSO_AOI };

describe('QA/QC serie', () => {
  it('rileva unità, futuro, duplicati, fuori range, gap, fuori area, obsolescenza', () => {
    const r = qaSeries(
      [
        { t: '2026-07-08T10:00:00Z', value: 25, unit: '°C', lon: 14.6633, lat: 41.5606 },
        { t: '2026-07-08T10:00:00Z', value: 25, unit: '°C' },
        { t: '2026-07-08T11:00:00Z', value: 80, unit: '°C' },
        { t: '2026-07-08T15:00:00Z', value: 77, unit: '°F' },
        { t: '2026-07-08T16:00:00Z', value: 26, unit: '°C', lon: 15, lat: 42 },
        { t: '2026-07-11T10:00:00Z', value: 26, unit: '°C' },
      ],
      base,
    );
    const codes = new Set(r.flags.map((f) => f.code));
    for (const c of ['DUPLICATO', 'FUORI_RANGE', 'UNITA_INCOMPATIBILE', 'GAP', 'FUORI_AREA', 'TIMESTAMP_FUTURO']) {
      expect(codes.has(c as never), c).toBe(true);
    }
    expect(r.quality).toBe('bassa');
  });

  it('segnala dati obsoleti e qualità alta su serie pulita', () => {
    const clean = qaSeries(
      [
        { t: '2026-07-08T10:00:00Z', value: 25, unit: '°C' },
        { t: '2026-07-08T11:00:00Z', value: 26, unit: '°C' },
      ],
      base,
    );
    expect(clean.quality).toBe('alta');
    expect(clean.flags.some((f) => f.code === 'DATO_OBSOLETO')).toBe(true);
  });
});
