import { describe, expect, it, vi } from 'vitest';
import urbanFixture from './fixtures/open-meteo-forecast-urban.json' with { type: 'json' };
import agriFixture from './fixtures/open-meteo-forecast-agricultural.json' with { type: 'json' };
import {
  AGRI_HOURLY,
  buildIngestUrl,
  COMMON_HOURLY,
  EXPECTED_UNITS,
  fetchForecastJson,
  hourlyVariables,
  ingestRequestHash,
  isStale,
  issuedHour,
  OpenMeteoError,
  parseForecastResponse,
  splitAtIssue,
  toObservationRows,
  validateCoordinates,
} from './openMeteoForecast';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const urban = { id: '00000000-0000-4000-8000-000000000001', latitude: 41.5606, longitude: 14.663, scope: 'urban' as const };
const agri = { id: '00000000-0000-4000-8000-000000000002', latitude: 41.8, longitude: 14.92, scope: 'agricultural' as const };
const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;

describe('Richiesta Open-Meteo: parametri e separazione urbano/agricolo', () => {
  it('timezone Europe/Rome, istanti assoluti, vento in m/s, 4 giorni + 1 passato, modello dichiarato', () => {
    const u = new URL(buildIngestUrl(urban));
    expect(u.origin + u.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ timezone: 'Europe/Rome', timeformat: 'unixtime', wind_speed_unit: 'ms', forecast_days: '4', past_days: '1', models: 'best_match', latitude: '41.56060', longitude: '14.66300' });
  });

  it('urbano: solo le 9 variabili comuni; agricolo: anche ET0, VPD, temperatura e umidità del suolo a tutte le profondità', () => {
    expect(new URL(buildIngestUrl(urban)).searchParams.get('hourly')!.split(',')).toEqual([...COMMON_HOURLY]);
    const a = new URL(buildIngestUrl(agri)).searchParams.get('hourly')!.split(',');
    expect(a).toEqual([...COMMON_HOURLY, ...AGRI_HOURLY]);
    expect(a.filter((v) => v.startsWith('soil_temperature'))).toHaveLength(4);
    expect(a.filter((v) => v.startsWith('soil_moisture'))).toHaveLength(5);
  });

  it('coordinate non valide rifiutate', () => {
    expect(validateCoordinates(91, 10)).toMatch(/Latitudine/);
    expect(validateCoordinates(41, 200)).toMatch(/Longitudine/);
    expect(validateCoordinates(0, 0)).toMatch(/0,0/);
    expect(validateCoordinates(Number.NaN, 14)).toMatch(/Latitudine/);
    expect(() => buildIngestUrl({ ...urban, latitude: 123 })).toThrow(OpenMeteoError);
  });
});

describe('Parser: risposta reale (fixture controllata)', () => {
  it('urbano: cella effettiva, quota, unità e serie oraria regolare in UTC anche al cambio dell’ora legale', () => {
    const p = parseForecastResponse(urbanFixture, 'urban');
    expect(p.grid.latitude).toBeCloseTo(41.586, 2);
    expect(p.grid.elevation).toBe(700);
    expect(p.variables).toEqual([...COMMON_HOURLY]);
    for (const v of p.variables) expect(p.units[v]).toBe(EXPECTED_UNITS[v]);
    expect(p.hours.length).toBeGreaterThan(96);
    for (let i = 1; i < p.hours.length; i++) expect(Date.parse(p.hours[i]!.validAt) - Date.parse(p.hours[i - 1]!.validAt)).toBe(3_600_000);
    // la serie attraversa il ritorno all’ora solare del 25/10/2026 senza buchi né doppioni
    expect(p.hours.some((h) => h.validAt === '2026-10-25T00:00:00.000Z')).toBe(true);
    expect(p.hours.some((h) => h.validAt === '2026-10-25T01:00:00.000Z')).toBe(true);
    expect(p.timezone).toBe('Europe/Rome');
  });

  it('agricolo: 20 variabili con unità di suolo, ET0 e VPD', () => {
    const p = parseForecastResponse(agriFixture, 'agricultural');
    expect(p.variables).toHaveLength(20);
    expect(p.units.soil_moisture_9_to_27cm).toBe('m³/m³');
    expect(p.units.vapour_pressure_deficit).toBe('kPa');
    expect(p.units.et0_fao_evapotranspiration).toBe('mm');
    const h = p.hours.find((x) => x.values.soil_moisture_9_to_27cm != null)!;
    expect(h.values.soil_moisture_9_to_27cm).toBeGreaterThan(0);
    expect(h.values.soil_moisture_9_to_27cm).toBeLessThan(1);
  });

  it('formato locale (senza unixtime): conversione con lo scostamento dichiarato', () => {
    const body = { latitude: 41.5, longitude: 14.6, utc_offset_seconds: 7200, hourly_units: { temperature_2m: '°C', relative_humidity_2m: '%', precipitation: 'mm', wind_speed_10m: 'm/s', shortwave_radiation: 'W/m²' }, hourly: { time: ['2026-07-01T14:00', '2026-07-01T15:00'], temperature_2m: [30, 31], relative_humidity_2m: [40, 38], precipitation: [0, 0], wind_speed_10m: [2, 3], shortwave_radiation: [800, 750] } };
    const p = parseForecastResponse(body, 'urban');
    expect(p.hours.map((h) => h.validAt)).toEqual(['2026-07-01T12:00:00.000Z', '2026-07-01T13:00:00.000Z']);
    expect(p.warnings.join(' ')).toMatch(/apparent_temperature: non disponibile/);
  });
});

describe('Parser: risposte incomplete o non valide', () => {
  it('variabile obbligatoria assente → DATI_ASSENTI', () => {
    const b = clone(urbanFixture) as { hourly: Record<string, unknown> };
    delete b.hourly.temperature_2m;
    expect(() => parseForecastResponse(b, 'urban')).toThrow(expect.objectContaining({ code: 'DATI_ASSENTI' }));
  });

  it('profondità del suolo non disponibile → avviso, non errore', () => {
    const b = clone(agriFixture) as { hourly: Record<string, unknown> };
    delete b.hourly.soil_moisture_27_to_81cm;
    const p = parseForecastResponse(b, 'agricultural');
    expect(p.variables).not.toContain('soil_moisture_27_to_81cm');
    expect(p.warnings.join(' ')).toMatch(/soil_moisture_27_to_81cm: non disponibile/);
  });

  it('unità diversa da quella attesa → rifiuto (es. vento in km/h)', () => {
    const b = clone(urbanFixture) as { hourly_units: Record<string, string> };
    b.hourly_units.wind_speed_10m = 'km/h';
    expect(() => parseForecastResponse(b, 'urban')).toThrow(/Unità inattesa per wind_speed_10m/);
  });

  it('lunghezze diverse, istanti irregolari, corpo non oggetto, errore dichiarato, coordinate assenti', () => {
    const short = clone(urbanFixture) as { hourly: Record<string, unknown[]> };
    short.hourly.temperature_2m = short.hourly.temperature_2m!.slice(1);
    expect(() => parseForecastResponse(short, 'urban')).toThrow(/lunghezza diversa/);
    const irregular = clone(urbanFixture) as { hourly: { time: number[] } };
    irregular.hourly.time[5]! += 60;
    expect(() => parseForecastResponse(irregular, 'urban')).toThrow(/non regolare/);
    expect(() => parseForecastResponse([], 'urban')).toThrow(/oggetto atteso/);
    expect(() => parseForecastResponse({ error: true, reason: 'Cannot initialize' }, 'urban')).toThrow(/Cannot initialize/);
    expect(() => parseForecastResponse({ ...clone(urbanFixture), latitude: 'x' }, 'urban')).toThrow(/Coordinate/);
    expect(() => parseForecastResponse({ latitude: 41, longitude: 14, hourly: { time: [] } }, 'urban')).toThrow(expect.objectContaining({ code: 'DATI_ASSENTI' }));
  });

  it('valori non plausibili scartati con avviso (umidità > 100, vento negativo, stringhe)', () => {
    const b = clone(urbanFixture) as { hourly: Record<string, unknown[]> };
    b.hourly.relative_humidity_2m![0] = 140;
    b.hourly.wind_speed_10m![1] = -3;
    b.hourly.temperature_2m![2] = 'n/d';
    const p = parseForecastResponse(b, 'urban');
    expect(p.hours[0]!.values.relative_humidity_2m).toBeNull();
    expect(p.hours[1]!.values.wind_speed_10m).toBeNull();
    expect(p.hours[2]!.values.temperature_2m).toBeNull();
    expect(p.warnings.join(' ')).toMatch(/relative_humidity_2m: 1 valori non plausibili/);
  });
});

describe('Emissione, ore passate e idempotenza', () => {
  it('previsione dalle ore successive all’emissione; ore passate come storico modellato', () => {
    const p = parseForecastResponse(agriFixture, 'agricultural');
    const issued = issuedHour(new Date('2026-10-24T15:42:10Z'));
    expect(issued).toBe('2026-10-24T15:00:00.000Z');
    const { forecast, past } = splitAtIssue(p, issued);
    expect(forecast[0]!.validAt).toBe(issued);
    expect(forecast.length).toBeGreaterThanOrEqual(72);
    expect(past.every((h) => Date.parse(h.validAt) < Date.parse(issued))).toBe(true);
    const obs = toObservationRows(p, past, 'agricultural');
    expect(new Set(obs.map((o) => o.variable))).toEqual(new Set(['temperature_2m', 'relative_humidity_2m', 'precipitation', 'shortwave_radiation', 'et0_fao_evapotranspiration', 'soil_temperature_6cm', 'soil_moisture_9_to_27cm']));
    expect(obs.find((o) => o.variable === 'soil_moisture_9_to_27cm')!.unit).toBe('m³/m³');
  });

  it('hash stabile per stessa località e ora; diverso per ora, ambito o coordinate', async () => {
    const h1 = await ingestRequestHash(urban, 'best_match', '2026-10-24T15:00:00.000Z');
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(await ingestRequestHash(urban, 'best_match', '2026-10-24T15:00:00.000Z')).toBe(h1);
    expect(await ingestRequestHash(urban, 'best_match', '2026-10-24T16:00:00.000Z')).not.toBe(h1);
    expect(await ingestRequestHash({ ...urban, scope: 'agricultural' }, 'best_match', '2026-10-24T15:00:00.000Z')).not.toBe(h1);
    expect(await ingestRequestHash({ ...urban, latitude: 41.6 }, 'best_match', '2026-10-24T15:00:00.000Z')).not.toBe(h1);
  });

  it('dato non aggiornato oltre 6 ore (due cicli da 3 h)', () => {
    const now = new Date('2026-10-24T15:00:00Z');
    expect(isStale('2026-10-24T10:00:00Z', now)).toBe(false);
    expect(isStale('2026-10-24T08:59:00Z', now)).toBe(true);
    expect(isStale(null, now)).toBe(true);
  });

  it('variabili per ambito coerenti con le unità attese', () => {
    for (const s of ['urban', 'agricultural'] as const) for (const v of hourlyVariables(s)) expect(EXPECTED_UNITS[v]).toBeTruthy();
  });
});

describe('Rete: timeout e tentativi limitati', () => {
  const sleep = vi.fn(async () => {});

  it('5xx poi successo: ripete con attesa crescente', async () => {
    const f = vi.fn().mockResolvedValueOnce(res(502, {})).mockResolvedValueOnce(res(200, { ok: 1 }));
    const r = await fetchForecastJson('https://x', { fetchImpl: f, sleep, baseDelayMs: 100 });
    expect(r).toEqual({ body: { ok: 1 }, attempts: 2 });
    expect(sleep).toHaveBeenCalledWith(100);
  });

  it('429 ripetuto: si ferma dopo i tentativi massimi con codice LIMITE', async () => {
    const f = vi.fn().mockResolvedValue(res(429, { reason: 'Too many requests' }));
    await expect(fetchForecastJson('https://x', { fetchImpl: f, sleep, retries: 2 })).rejects.toMatchObject({ code: 'LIMITE' });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('400 (parametri errati): nessun nuovo tentativo, motivo riportato', async () => {
    const f = vi.fn().mockResolvedValue(res(400, { error: true, reason: 'Invalid hourly variable' }));
    await expect(fetchForecastJson('https://x', { fetchImpl: f, sleep })).rejects.toThrow(/400: Invalid hourly variable/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('timeout per tentativo e rete assente: codici TIMEOUT e RETE', async () => {
    const hang: typeof fetch = (_u, init) => new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
    await expect(fetchForecastJson('https://x', { fetchImpl: hang, timeoutMs: 10, retries: 1, sleep })).rejects.toMatchObject({ code: 'TIMEOUT' });
    const down = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(fetchForecastJson('https://x', { fetchImpl: down, retries: 1, sleep })).rejects.toMatchObject({ code: 'RETE' });
    expect(down).toHaveBeenCalledTimes(2);
  });

  it('i tentativi aggiuntivi sono al massimo 3', async () => {
    const f = vi.fn().mockResolvedValue(res(503, {}));
    await expect(fetchForecastJson('https://x', { fetchImpl: f, sleep, retries: 10 })).rejects.toBeInstanceOf(OpenMeteoError);
    expect(f).toHaveBeenCalledTimes(4);
  });
});
