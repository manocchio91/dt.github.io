import { describe, expect, it } from 'vitest';
import agriFixture from '../connectors/fixtures/open-meteo-forecast-agricultural.json' with { type: 'json' };
import { issuedHour, parseForecastResponse, splitAtIssue, toPointRows } from '../connectors/openMeteoForecast';
import { buildTimestralRequestFromWeather, type ObservationRow } from './weatherSource';
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
