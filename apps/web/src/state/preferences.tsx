import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { parsePreferences, type OnboardingPreferences } from '@mdt/domain';
import { useAuth } from './auth';

/**
 * Preferenze di onboarding: su Supabase (tabella user_preferences, solo la
 * propria riga) per gli utenti autenticati, in localStorage per gli ospiti.
 * Le preferenze non contengono e non modificano permessi.
 */
const LOCAL_KEY = 'mdt:onboarding:v1';
const SKIP_KEY = 'mdt:onboarding:skipped';

export function readLocalPreferences(): OnboardingPreferences | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? parsePreferences(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage non disponibile: le preferenze valgono solo per questa visita */
  }
}

interface PreferencesValue {
  ready: boolean;
  preferences: OnboardingPreferences | null;
  /** dove sono salvate */
  where: 'account' | 'browser';
  skipped: boolean;
  save(p: OnboardingPreferences): Promise<void>;
  skip(): void;
  error: string | null;
}

const Ctx = createContext<PreferencesValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { client, session } = useAuth();
  const userId = client && session ? session.user.id : null;
  const [preferences, setPreferences] = useState<OnboardingPreferences | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(() => {
    try {
      return localStorage.getItem(SKIP_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let alive = true;
    if (!userId || !client) {
      queueMicrotask(() => {
        if (!alive) return;
        setPreferences(readLocalPreferences());
        setReady(true);
      });
      return () => {
        alive = false;
      };
    }
    client
      .from('user_preferences')
      .select('preferences')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error: e }) => {
        if (!alive) return;
        if (e) setError(`Preferenze non lette: ${e.message}`);
        setPreferences(data ? parsePreferences((data as { preferences: unknown }).preferences) : null);
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [client, userId]);

  const save = useCallback(
    async (p: OnboardingPreferences) => {
      setError(null);
      if (userId && client) {
        const { error: e } = await client
          .from('user_preferences')
          .upsert({ user_id: userId, profile: p.profile, sector: p.sector, mode: p.mode, preferences: p }, { onConflict: 'user_id' });
        if (e) {
          setError(`Preferenze non salvate: ${e.message}`);
          throw new Error(e.message);
        }
      } else {
        writeLocal(LOCAL_KEY, JSON.stringify(p));
      }
      setPreferences(p);
    },
    [client, userId],
  );

  const skip = useCallback(() => {
    writeLocal(SKIP_KEY, '1');
    setSkipped(true);
  }, []);

  const value = useMemo<PreferencesValue>(
    () => ({ ready, preferences, where: userId ? 'account' : 'browser', skipped, save, skip, error }),
    [ready, preferences, userId, skipped, save, skip, error],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferences(): PreferencesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePreferences fuori da PreferencesProvider');
  return v;
}

/** Modalità di lavoro corrente (guidata per default). */
export function useWorkMode() {
  const { preferences } = usePreferences();
  return preferences?.mode ?? 'guidata';
}
