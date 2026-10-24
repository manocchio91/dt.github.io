import { useMemo, type ReactNode } from 'react';
import { useAuth } from './auth';
import { StoreProvider } from './store';
import { SupabaseRepository } from './supabaseRepository';

/**
 * Sceglie l'archivio: Supabase per l'organizzazione selezionata se l'utente è
 * autenticato, altrimenti IndexedDB locale. Cambiare organizzazione ricrea lo store.
 */
export function DataScope({ children }: { children: ReactNode }) {
  const { client, session, current, ready } = useAuth();
  const remote = client && session && current ? { client, orgId: current.organizationId } : null;
  const key = remote ? `sb:${remote.orgId}` : 'local';
  const repository = useMemo(
    () => (remote ? new SupabaseRepository(remote.client, remote.orgId) : undefined),
    // la chiave identifica univocamente client + organizzazione
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  if (!ready) return <p className="p-6 text-sm">Verifica della sessione…</p>;
  return (
    <StoreProvider key={key} repository={repository}>
      {children}
    </StoreProvider>
  );
}
