import { describe, expect, it } from 'vitest';
import type { WeatherPoint } from '../state/weather';
import { dayPhrase, summarizeWeather } from '../state/weatherSummary';

const NOW = new Date('2026-07-14T07:30:00Z'); // 09:30 a Roma

/** Punti orari da adesso, con temperatura e umidità del suolo date ora per ora. */
function points(temps: number[], soil?: number[]): WeatherPoint[] {
  const start = Date.parse('2026-07-14T07:00:00Z');
  return temps.map((t, i) => ({
    valid_at: new Date(start + i * 3_600_000).toISOString(),
    issued_at: '2026-07-14T06:00:00Z',
    model: 'best_match',
    unit_metadata: { temperature_2m: '°C', soil_moisture_9_to_27cm: 'm³/m³' },
    temperature_2m: t,
    ...(soil ? { soil_moisture_9_to_27cm: soil[i]! } : {}),
  })) as WeatherPoint[];
}

describe('Sintesi del pannello meteo (modalità guidata)', () => {
  it('urbano regolare: nessuna soglia superata, prossimo passo verso gli indicatori', () => {
    const s = summarizeWeather(points(Array(48).fill(25)), 'urban', NOW)!;
    expect(s.level).toBe('regolare');
    expect(s.window).toBeNull();
    expect(s.current).toBe(25);
    expect(s.headline).toBe('Nessun superamento della soglia di caldo previsto nelle prossime 48 ore.');
  });

  it('urbano: caldo elevato domani tra le 13:00 e le 16:00, con il prossimo passo del piano comunale', () => {
    const temps = Array(48).fill(28);
    // domani 13:00–15:59 ora di Roma = 11:00–13:59 UTC del 15 luglio → indici 28, 29, 30
    temps[28] = 33;
    temps[29] = 34;
    temps[30] = 33.5;
    const s = summarizeWeather(points(temps), 'urban', NOW)!;
    expect(s.level).toBe('attenzione');
    expect(s.headline).toBe('Possibile caldo elevato domani tra le 13:00 e le 16:00.');
    expect(s.nextStep).toBe('Verifica le aree più frequentate e valuta le misure previste dal piano comunale.');
    expect(s.threshold).toMatchObject({ value: 32, direction: 'sopra', who: 'tecnico comunale' });
  });

  it('urbano critico oltre soglia + 4 °C', () => {
    const temps = Array(48).fill(30);
    temps[5] = 37;
    expect(summarizeWeather(points(temps), 'urban', NOW)!.level).toBe('critico');
  });

  it('agricolo: umidità del suolo stimata sotto soglia nelle prossime 48 ore, senza prescrivere interventi', () => {
    const soil = Array(48).fill(0.2);
    for (let i = 20; i < 30; i++) soil[i] = 0.15;
    const s = summarizeWeather(points(Array(48).fill(26), soil), 'agriculture', NOW)!;
    expect(s.level).toBe('attenzione');
    expect(s.headline).toMatch(/^L’umidità stimata del terreno potrebbe scendere sotto la soglia nelle prossime 48 ore/);
    expect(s.nextStep).toBe('Controlla la parcella o consulta l’agronomo prima di intervenire.');
    expect(`${s.headline} ${s.nextStep}`).not.toMatch(/irriga|tratta/i);
  });

  it('agricolo: caldo per la coltura dalla soglia dell’agronomo quando il suolo è regolare', () => {
    const temps = Array(48).fill(30);
    temps[6] = 36;
    const s = summarizeWeather(points(temps, Array(48).fill(0.25)), 'agriculture', NOW, { heatThresholdC: 35 })!;
    expect(s.level).toBe('attenzione');
    expect(s.headline).toMatch(/^Possibile caldo elevato per la coltura oggi tra le 15:00 e le 16:00\.$/);
  });

  it('nessun punto futuro: nessuna sintesi inventata', () => {
    expect(summarizeWeather(points([20, 21]), 'urban', new Date('2026-07-20T00:00:00Z'))).toBeNull();
  });

  it('giorni in linguaggio semplice nel fuso di Roma', () => {
    expect(dayPhrase('2026-07-14T20:00:00Z', NOW)).toBe('oggi');
    expect(dayPhrase('2026-07-14T22:30:00Z', NOW)).toBe('domani'); // 00:30 del 15 a Roma
    expect(dayPhrase('2026-07-16T10:00:00Z', NOW)).toBe('giovedì');
  });
});
