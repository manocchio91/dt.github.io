import { describe, expect, it } from 'vitest';
import agriFixture from '../connectors/fixtures/open-meteo-forecast-agricultural.json' with { type: 'json' };
import { issuedHour, parseForecastResponse, splitAtIssue, toPointRows } from '../connectors/openMeteoForecast';
import { buildHistoryContext, buildTimestralRequestFromWeather, type ObservationRow } from './weatherSource';
import { TimestralForecastAdapter } from './timestral';
import { ForecastInputError, ForecastUnavailableError } from './types';
import { validateForecastRequest } from './validate';

// storico: 10 giorni di analisi Open-Meteo terminanti all'emissione della fixture (15:00 UTC)
const ISSUED = issuedHour(new Date('2026-10-24T15:20:00Z'));
const hours = Array.from({ length: 240 }, (_, i) => new Date(Date.parse(ISSUED) - (240 - i) * 3_600_000).toISOString());
const analysis: ObservationRow[] = hours.flatMap((t, i) => [
  { observed_at: t, variable: 'temperature_2m', value: 14 + 5 * Math.sin((2 * Math.PI * (i - 9)) / 24), unit: '°C', source: 'open_meteo' },
  { observed_at: t, variable: 'soil_moisture_9_to_27cm', value: 0.3 - i * 0.0001, unit: 'm³/m³', source: 'open_meteo' },
]);
const parsed = parseForecastResponse(agriFixture, 'agricultural');
const points = toPointRows(splitAtIssue(parsed, ISSUED).forecast).map((p) => ({ ...p, issued_at: ISSUED, unit_metadata: parsed.units }));

describe('Timestral da storico Supabase con previsione Open-Meteo come covariata nota', () => {
  it('richiesta valida: target dallo storico, covariata Open-Meteo su contesto + orizzonte, calendario', () => {
    const { request, provenance } = buildTimestralRequestFromWeather({ target: 'temperature_2m', observations: analysis, forecastPoints: points, horizon: 48 });
    expect(validateForecastRequest(request)).toEqual([]);
    expect(request.targets[0]!.variable).toBe('temperatura_aria');
    expect(request.targets[0]!.values).toHaveLength(240);
    const cov = request.knownCovariates.find((c) => c.name === 'previsione_open_meteo_temperature_2m')!;
    expect(cov.kind).toBe('previsione_meteo');
    expect(cov.values).toHaveLength(240 + 48);
    // sull'orizzonte: esattamente i valori della previsione Open-Meteo registrata
    expect(cov.values.slice(240)).toEqual(points.slice(0, 48).map((p) => p.temperature_2m));
    expect(provenance).toMatchObject({ targetSource: 'open_meteo', covariateSource: 'open_meteo', forecastIssuedAt: ISSUED });
  });

  it('misure da sensore prevalgono sull’analisi Open-Meteo nella stessa ora (provenienza “misto”)', () => {
    const sensors: ObservationRow[] = hours.slice(-24).map((t) => ({ observed_at: t, variable: 'temperature_2m', value: 99, unit: '°C', source: 'sensore' }));
    const { request, provenance } = buildTimestralRequestFromWeather({ target: 'temperature_2m', observations: [...analysis, ...sensors], forecastPoints: points, horizon: 24 });
    expect(request.targets[0]!.values.at(-1)).toBe(99);
    expect(provenance).toMatchObject({ targetSource: 'misto', sensorHours: 24, openMeteoHours: 216 });
  });

  it('agricolo: umidità del suolo con unità m³/m³; il target non entra tra le covariate (niente leakage)', () => {
    const { request } = buildTimestralRequestFromWeather({ target: 'soil_moisture_9_to_27cm', observations: analysis, forecastPoints: points, horizon: 72 });
    expect(request.targets[0]).toMatchObject({ variable: 'umidita_suolo', unit: 'm³/m³' });
    expect(request.knownCovariates.map((c) => c.name)).not.toContain('umidita_suolo');
  });

  it('previsione che non copre l’orizzonte o storico assente: errore esplicito', () => {
    expect(() => buildTimestralRequestFromWeather({ target: 'temperature_2m', observations: analysis, forecastPoints: points.slice(0, 10), horizon: 48 })).toThrow(/non copre l’orizzonte/);
    expect(() => buildTimestralRequestFromWeather({ target: 'temperature_2m', observations: [], forecastPoints: points, horizon: 24 })).toThrow(ForecastInputError);
    expect(() => buildTimestralRequestFromWeather({ target: 'wind_gusts_10m', observations: analysis, forecastPoints: points, horizon: 24 })).toThrow(/non supportata/);
  });

  it('senza servizio: “Motore Timestral non configurato”; nessun ripiego che si presenti come Timestral', async () => {
    const { request } = buildTimestralRequestFromWeather({ target: 'temperature_2m', observations: analysis, forecastPoints: points, horizon: 24 });
    const a = new TimestralForecastAdapter({ baseUrl: null, model: 'mistralai/Timestral-5M' });
    await expect(a.forecast(request)).rejects.toThrow(new ForecastUnavailableError('Motore Timestral non configurato'));
  });
});

describe('Contesto multivariato dallo storico Supabase (Timestral)', () => {
  const rows = (vars: string[], hours: number, skip: (v: string, i: number) => boolean = () => false): ObservationRow[] =>
    vars.flatMap((v) =>
      Array.from({ length: hours }, (_, i) => ({ observed_at: new Date(Date.parse('2026-10-20T00:00:00Z') + i * 3_600_000).toISOString(), variable: v, value: 10 + i / 10, unit: v === 'relative_humidity_2m' ? '%' : '°C', source: 'open_meteo' })).filter((_, i) => !skip(v, i)),
    );

  it('168 ore ordinate e consecutive, una riga per variabile, unità coerenti', () => {
    const c = buildHistoryContext(rows(['temperature_2m', 'relative_humidity_2m'], 168), ['temperature_2m', 'relative_humidity_2m']);
    expect(c.timestamps).toHaveLength(168);
    expect(c.timestamps.every((t, i) => i === 0 || Date.parse(t) - Date.parse(c.timestamps[i - 1]!) === 3_600_000)).toBe(true);
    expect(c.units).toEqual(['°C', '%']);
    expect(c.missing).toEqual([0, 0]);
    expect(c.provenance).toMatchObject({ source: 'open_meteo', hours: 168, to: '2026-10-26T23:00:00.000Z' });
  });

  it('lacune lasciate vuote, mai interpolate; nessuna riga da sensore o simulata', () => {
    const r = rows(['temperature_2m'], 168, (_, i) => i >= 10 && i < 16);
    r.push({ observed_at: '2026-10-20T12:00:00Z', variable: 'temperature_2m', value: 99, unit: '°C', source: 'sensore' });
    const c = buildHistoryContext(r, ['temperature_2m']);
    expect(c.missing).toEqual([6]);
    expect(c.context[0]!.slice(10, 16)).toEqual([null, null, null, null, null, null]);
    expect(c.context[0]).not.toContain(99);
  });

  it('meno di 72 ore continue: il modello avanzato non parte', () => {
    expect(() => buildHistoryContext(rows(['temperature_2m'], 60), ['temperature_2m'])).toThrow(/servono almeno 72 ore/);
    expect(() => buildHistoryContext(rows(['temperature_2m'], 168, (_, i) => i === 150), ['temperature_2m'])).toThrow(/Storico continuo di 17 ore/);
  });

  it('unità diverse o variabile assente: errore esplicito, nessuna conversione nascosta', () => {
    const r = rows(['temperature_2m'], 100);
    r[5] = { ...r[5]!, unit: 'K' };
    expect(() => buildHistoryContext(r, ['temperature_2m'])).toThrow(/unità non coerenti/);
    expect(() => buildHistoryContext(rows(['temperature_2m'], 100), ['temperature_2m', 'relative_humidity_2m'])).toThrow(/relative_humidity_2m: nessuno storico/);
  });

  it('solo le ore precedenti all’emissione', () => {
    const c = buildHistoryContext(rows(['temperature_2m'], 168), ['temperature_2m'], { before: '2026-10-26T00:00:00Z' });
    expect(c.timestamps.at(-1)).toBe('2026-10-25T23:00:00.000Z');
  });
});
