import {
  NaivePersistenceAdapter,
  SeasonalNaiveAdapter,
  TimestralForecastAdapter,
  type ForecastResult,
  type TimeSeriesForecastAdapter,
  type TimestralModelId,
} from '@mdt/domain';

/**
 * Motori di previsione disponibili nell'interfaccia.
 * Timestral gira solo nel servizio esterno (services/forecasting) raggiunto
 * tramite un proxy autenticato (VITE_FORECAST_URL). Nessun token di servizio
 * nel bundle: il proxy riceve il token di sessione dell'utente.
 */
export type ModelChoice = 'baseline-persistenza-stagionale' | 'baseline-persistenza' | TimestralModelId;

export const MODEL_CHOICES: { id: ModelChoice; label: string; timestral: boolean }[] = [
  { id: 'baseline-persistenza-stagionale', label: 'Persistenza stagionale (baseline)', timestral: false },
  { id: 'baseline-persistenza', label: 'Persistenza (baseline)', timestral: false },
  { id: 'mistralai/Timestral-5M', label: 'Timestral 5M (Beta)', timestral: true },
  { id: 'mistralai/Timestral-28M', label: 'Timestral 28M (Beta, confronto)', timestral: true },
];

export function forecastServiceUrl(): string | null {
  return import.meta.env.VITE_FORECAST_URL || null;
}

const timestralCache = new Map<string, ForecastResult>();

export function makeAdapter(choice: ModelChoice, opts: { baseUrl?: string | null; token?: () => Promise<string | null>; fetchImpl?: typeof fetch } = {}): TimeSeriesForecastAdapter {
  if (choice === 'baseline-persistenza') return new NaivePersistenceAdapter();
  if (choice === 'baseline-persistenza-stagionale') return new SeasonalNaiveAdapter();
  return new TimestralForecastAdapter({
    baseUrl: opts.baseUrl === undefined ? forecastServiceUrl() : opts.baseUrl,
    model: choice,
    authorization: async () => {
      const t = opts.token ? await opts.token() : null;
      return t ? `Bearer ${t}` : null;
    },
    timeoutMs: 60_000,
    cache: timestralCache,
    fetchImpl: opts.fetchImpl,
  });
}

export const VARIABLE_LABEL: Record<string, string> = {
  temperatura_aria: 'Temperatura dell’aria (2 m)',
  umidita_relativa: 'Umidità relativa',
  umidita_suolo: 'Umidità del suolo (7–28 cm)',
  temperatura_suolo: 'Temperatura del suolo',
};

export function fmtHour(iso: string): string {
  return new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }).format(Date.parse(iso));
}

export function fmtDay(iso: string): string {
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Rome' }).format(Date.parse(iso));
}
