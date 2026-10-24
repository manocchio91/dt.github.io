import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Client Supabase. Nel browser si usano solo URL e chiave anon pubblica:
 * l'accesso ai dati è governato dalle policy RLS. La service key non entra mai nel client.
 */
export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function readSupabaseConfig(env: ImportMetaEnv = import.meta.env): SupabaseConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  if (!/^https?:\/\//.test(url)) return null;
  return { url, anonKey };
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  const cfg = readSupabaseConfig();
  if (!cfg) return null;
  client = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

/** Superficie minima del client usata dai repository: facilita i test con un doppio. */
export type SupabaseLike = Pick<SupabaseClient, 'from' | 'rpc' | 'storage' | 'functions'>;
