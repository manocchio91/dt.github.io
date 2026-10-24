/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** proxy autenticato verso services/forecasting (Timestral); assente = motore non configurato */
  readonly VITE_FORECAST_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
