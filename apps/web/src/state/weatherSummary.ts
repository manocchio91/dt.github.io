import type { WeatherPoint } from './weather';

/**
 * Sintesi del pannello meteo per la modalità guidata: stato, valore principale, eventuale
 * soglia superata, quando e cosa fare. Solo lettura dei punti Open-Meteo già registrati:
 * nessun valore inventato, nessuna prescrizione (la decisione resta a tecnico o agronomo).
 */
export type WeatherLevel = 'regolare' | 'attenzione' | 'critico';

/** Soglie dimostrative, le stesse proposte nella pagina Previsioni: vanno confermate da chi decide. */
export const DEMO_THRESHOLDS = {
  urbanHeatC: 32,
  urbanCriticalMarginC: 4,
  agriSoilMoisture: 0.16,
  agriSoilCritical: 0.12,
  agriCriticalMarginC: 3,
} as const;

export const LOOKAHEAD_HOURS = 48;

export interface WeatherSummary {
  level: WeatherLevel;
  /** variabile principale mostrata */
  variable: 'temperature_2m' | 'soil_moisture_9_to_27cm';
  current: number | null;
  unit: string;
  threshold: { value: number; direction: 'sopra' | 'sotto'; who: string };
  window: { from: string; to: string } | null;
  headline: string;
  nextStep: string;
}

const TZ = 'Europe/Rome';
const hourFmt = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const dayKey = (t: number) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ }).format(t);

/** "oggi", "domani" o il giorno della settimana, nel fuso di Roma. */
export function dayPhrase(iso: string, now: Date): string {
  const t = Date.parse(iso);
  if (dayKey(t) === dayKey(now.getTime())) return 'oggi';
  if (dayKey(t) === dayKey(now.getTime() + 86_400_000)) return 'domani';
  return new Intl.DateTimeFormat('it-IT', { weekday: 'long', timeZone: TZ }).format(t);
}

const num = (p: WeatherPoint, v: string): number | null => (typeof p[v] === 'number' ? (p[v] as number) : null);

/** Primo blocco di ore consecutive che supera la soglia: dall'inizio della prima ora alla fine dell'ultima. */
function firstRun(points: WeatherPoint[], v: string, hit: (x: number) => boolean) {
  const start = points.findIndex((p) => {
    const x = num(p, v);
    return x !== null && hit(x);
  });
  if (start < 0) return null;
  let end = start;
  while (end + 1 < points.length) {
    const x = num(points[end + 1]!, v);
    if (x === null || !hit(x)) break;
    end++;
  }
  const block = points.slice(start, end + 1).map((p) => num(p, v)!);
  return { from: points[start]!.valid_at, to: new Date(Date.parse(points[end]!.valid_at) + 3_600_000).toISOString(), values: block };
}

function when(w: { from: string; to: string }, now: Date): string {
  const d = dayPhrase(w.from, now);
  return `${d} tra le ${hourFmt.format(Date.parse(w.from))} e le ${hourFmt.format(Date.parse(w.to))}`;
}

export function summarizeWeather(allPoints: WeatherPoint[], sector: 'urban' | 'agriculture', now: Date, opts: { heatThresholdC?: number } = {}): WeatherSummary | null {
  const nowMs = now.getTime();
  const points = allPoints.filter((p) => Date.parse(p.valid_at) + 3_600_000 > nowMs).slice(0, LOOKAHEAD_HOURS);
  if (points.length === 0) return null;
  const first = points[0]!;

  if (sector === 'urban') {
    const thr = DEMO_THRESHOLDS.urbanHeatC;
    const run = firstRun(points, 'temperature_2m', (x) => x >= thr);
    const level: WeatherLevel = !run ? 'regolare' : Math.max(...run.values) >= thr + DEMO_THRESHOLDS.urbanCriticalMarginC ? 'critico' : 'attenzione';
    return {
      level,
      variable: 'temperature_2m',
      current: num(first, 'temperature_2m'),
      unit: first.unit_metadata?.temperature_2m ?? '°C',
      threshold: { value: thr, direction: 'sopra', who: 'tecnico comunale' },
      window: run && { from: run.from, to: run.to },
      headline: run
        ? `${level === 'critico' ? 'Possibile caldo molto elevato' : 'Possibile caldo elevato'} ${when(run, now)}.`
        : `Nessun superamento della soglia di caldo previsto nelle prossime ${points.length} ore.`,
      nextStep: run ? 'Verifica le aree più frequentate e valuta le misure previste dal piano comunale.' : 'Prosegui con gli indicatori dell’area e gli scenari del Decision Lab.',
    };
  }

  // agricolo: prima l'umidità del suolo stimata, poi il caldo per la coltura
  const soil = DEMO_THRESHOLDS.agriSoilMoisture;
  const dry = firstRun(points, 'soil_moisture_9_to_27cm', (x) => x < soil);
  const heatThr = opts.heatThresholdC ?? 35;
  const hot = firstRun(points, 'temperature_2m', (x) => x >= heatThr);
  if (dry || !hot) {
    const level: WeatherLevel = !dry ? 'regolare' : Math.min(...dry.values) < DEMO_THRESHOLDS.agriSoilCritical ? 'critico' : 'attenzione';
    return {
      level,
      variable: 'soil_moisture_9_to_27cm',
      current: num(first, 'soil_moisture_9_to_27cm'),
      unit: first.unit_metadata?.soil_moisture_9_to_27cm ?? 'm³/m³',
      threshold: { value: soil, direction: 'sotto', who: 'agronomo' },
      window: dry && { from: dry.from, to: dry.to },
      headline: dry
        ? `L’umidità stimata del terreno potrebbe scendere sotto la soglia nelle prossime ${points.length} ore (${dayPhrase(dry.from, now)} dalle ${hourFmt.format(Date.parse(dry.from))}).`
        : `Nessuna soglia superata nelle prossime ${points.length} ore.`,
      nextStep: dry ? 'Controlla la parcella o consulta l’agronomo prima di intervenire.' : 'Prosegui con le zone da controllare nel Decision Lab.',
    };
  }
  const level: WeatherLevel = Math.max(...hot.values) >= heatThr + DEMO_THRESHOLDS.agriCriticalMarginC ? 'critico' : 'attenzione';
  return {
    level,
    variable: 'temperature_2m',
    current: num(first, 'temperature_2m'),
    unit: first.unit_metadata?.temperature_2m ?? '°C',
    threshold: { value: heatThr, direction: 'sopra', who: 'agronomo' },
    window: { from: hot.from, to: hot.to },
    headline: `${level === 'critico' ? 'Possibile caldo molto elevato' : 'Possibile caldo elevato'} per la coltura ${when(hot, now)}.`,
    nextStep: 'Programma un sopralluogo nelle zone più esposte e confrontati con l’agronomo prima di intervenire.',
  };
}

export const LEVEL_LABEL: Record<WeatherLevel, { text: string; symbol: string; cls: string }> = {
  regolare: { text: 'Regolare', symbol: '✓', cls: 'border-leaf-800 bg-leaf-100 text-leaf-800' },
  attenzione: { text: 'Attenzione', symbol: '!', cls: 'border-ochre-800 bg-ochre-100 text-ochre-800' },
  critico: { text: 'Critico', symbol: '▲', cls: 'border-alert-800 bg-alert-100 text-alert-800' },
};
