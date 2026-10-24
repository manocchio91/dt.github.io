import { describe, expect, it } from 'vitest';
import { fetchAgriWeather, fetchUrbanBaselineWeather } from './openMeteo';

const now = new Date('2026-10-24T08:00:00Z');
const req = { lat: 41.5606, lon: 14.663, start: '2025-07-15', end: '2025-07-16', referenceHourLocal: 15 };

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

function archiveBody() {
  const time = ['2025-07-15T14:00', '2025-07-15T15:00', '2025-07-16T15:00'];
  return {
    latitude: 41.55,
    longitude: 14.65,
    hourly: {
      time,
      temperature_2m: [27, 29, 30],
      relative_humidity_2m: [40, 38, 36],
      wind_speed_10m: [2, 2.5, 3],
      shortwave_radiation: [800, 760, 740],
    },
    daily: { time: ['2025-07-15', '2025-07-16'], temperature_2m_max: [30, 31] },
  };
}

describe('Connettore Open-Meteo', () => {
  it('marca i valori come STIMATO DA MODELLO, mai MISURATO, con lineage completo', async () => {
    const res = await fetchUrbanBaselineWeather(req, { now, cache: new Map(), fetchImpl: async () => jsonResponse(archiveBody()) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const t = res.value.values.find((v) => v.key === 't_air_ref_hour')!;
    expect(t.value).toBe(29.5);
    expect(t.dataClass).toBe('STIMATO_DA_MODELLO');
    expect(t.lineage.coordinates).toEqual({ lat: 41.55, lon: 14.65 });
    expect(t.lineage.license).toMatch(/CC BY 4.0/);
    expect(t.lineage.limitations.join(' ')).toMatch(/non è un sensore sul posto/);
    expect(res.value.values.every((v) => v.dataClass !== 'MISURATO')).toBe(true);
    expect(res.value.values.find((v) => v.key === 't_surface_ref_hour')!.dataClass).toBe('DATO_MANCANTE');
  });

  it('HTTP 500 → errore esplicito, nessun valore', async () => {
    const res = await fetchUrbanBaselineWeather(req, { now, cache: new Map(), fetchImpl: async () => jsonResponse({ reason: 'boom' }, 500) });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('HTTP');
    expect(res).not.toHaveProperty('value');
  });

  it('rete assente → errore RETE', async () => {
    const res = await fetchUrbanBaselineWeather(req, {
      now,
      cache: new Map(),
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(res.ok === false && res.error.code).toBe('RETE');
  });

  it('timeout → errore TIMEOUT', async () => {
    const res = await fetchUrbanBaselineWeather(req, {
      now,
      cache: new Map(),
      timeoutMs: 10,
      fetchImpl: (_url, init) =>
        new Promise((_r, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
    });
    expect(res.ok === false && res.error.code).toBe('TIMEOUT');
  });

  it('risposta senza dati → DATI_ASSENTI; struttura errata → FORMATO', async () => {
    const empty = archiveBody();
    empty.hourly.temperature_2m = [null, null, null] as unknown as number[];
    const r1 = await fetchUrbanBaselineWeather(req, { now, cache: new Map(), fetchImpl: async () => jsonResponse(empty) });
    expect(r1.ok === false && r1.error.code).toBe('DATI_ASSENTI');
    const r2 = await fetchUrbanBaselineWeather(req, { now, cache: new Map(), fetchImpl: async () => jsonResponse({ foo: 1 }) });
    expect(r2.ok === false && r2.error.code).toBe('FORMATO');
  });

  it("rifiuta periodi più recenti del ritardo dell'archivio", async () => {
    const r = await fetchUrbanBaselineWeather({ ...req, end: '2026-10-23' }, { now, cache: new Map(), fetchImpl: async () => jsonResponse(archiveBody()) });
    expect(r.ok === false && r.error.code).toBe('PARAMETRI');
  });

  it('usa la cache per richieste identiche', async () => {
    let calls = 0;
    const cache = new Map();
    const f = async () => {
      calls++;
      return jsonResponse(archiveBody());
    };
    await fetchUrbanBaselineWeather(req, { now, cache, fetchImpl: f });
    const second = await fetchUrbanBaselineWeather(req, { now, cache, fetchImpl: f });
    expect(calls).toBe(1);
    expect(second.ok && second.fromCache).toBe(true);
  });

  it('meteo agricolo: suolo con profondità e dicitura "stima riferita all’area"', async () => {
    const days = Array.from({ length: 15 }, (_, k) => `2026-08-${String(6 + k).padStart(2, '0')}`);
    const body = {
      latitude: 41.8,
      longitude: 14.92,
      daily: { time: days, temperature_2m_max: days.map(() => 33), precipitation_sum: days.map(() => 0) },
      hourly: { time: ['2026-08-20T10:00', '2026-08-20T11:00'], soil_moisture_9_to_27cm: [0.16, 0.18] },
    };
    const r = await fetchAgriWeather({ lat: 41.8, lon: 14.92, today: '2026-08-20' }, { now, cache: new Map(), fetchImpl: async () => jsonResponse(body) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.dailyTmax).toHaveLength(14);
    expect(r.value.soilMoisture.value).toBe(0.17);
    expect(r.value.soilMoisture.lineage.depth).toBe('9–27 cm');
    expect(r.value.soilMoisture.lineage.limitations[0]).toBe("Stima riferita all'area, non misurata sul terreno.");
  });
});
