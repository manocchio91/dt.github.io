import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Client Supabase. Nel browser si usano solo URL e chiave pubblica (publishable key, oppure la
 * vecchia anon key): l'accesso ai dati è governato dalle policy RLS. Una chiave segreta o di
 * servizio non entra mai nel client: se configurata per errore viene rifiutata.
 */
export interface SupabaseConfig {
  url: string;
  key: string;
}

/** Chiavi che danno accesso completo al progetto: mai nel browser. */
export function isSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  const payload = key.split('.')[1];
  if (!key.startsWith('eyJ') || !payload) return false;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string };
    return claims.role !== 'anon';
  } catch {
    return true;
  }
}

export function readSupabaseConfig(env: ImportMetaEnv = import.meta.env): SupabaseConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY)?.trim();
  if (!url || !key) return null;
  if (!/^https?:\/\//.test(url)) return null;
  if (isSecretKey(key)) {
    console.error('Configurazione Supabase rifiutata: nel browser è ammessa solo la chiave pubblica.');
    return null;
  }
  return { url, key };
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  const cfg = readSupabaseConfig();
  if (!cfg) return null;
  client = createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

/** Superficie minima del client usata dai repository: facilita i test con un doppio. */
export type SupabaseLike = Pick<SupabaseClient, 'from' | 'rpc' | 'storage' | 'functions'>;
