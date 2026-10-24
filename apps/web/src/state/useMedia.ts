import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth';
import { useStore } from './store';
import { LocalMediaStore, SupabaseMediaStore } from './mediaStore';

let local: LocalMediaStore | null = null;

/** Archivio locale condiviso (IndexedDB). Nei test si può ricreare con un nome diverso. */
export function localMediaStore(): LocalMediaStore {
  if (!local) local = new LocalMediaStore();
  return local;
}

export function resetLocalMediaStore(name: string) {
  local = new LocalMediaStore(name);
}

/** Archivio remoto se l'utente lavora in un'organizzazione, sempre affiancato da quello locale. */
export function useMediaStores() {
  const { kind } = useStore();
  const { client, session, current } = useAuth();
  const orgId = kind === 'supabase' && client && session && current ? current.organizationId : null;
  const userId = session?.user.id ?? null;
  const remote = useMemo(() => (orgId && client && userId ? new SupabaseMediaStore(client, orgId, userId) : null), [orgId, client, userId]);
  return { local: localMediaStore(), remote, organizationId: orgId, userId };
}

/** Stato della connessione (eventi online/offline del browser). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}
