import type { ReactNode } from 'react';
import { permissionsFor, type Permissions } from '@mdt/domain';
import { useAuth } from './auth';
import { useStore } from './store';

/** Permessi dell'interfaccia: dipendono solo dall'archivio e dal ruolo nell'organizzazione. */
export function usePermissions(): Permissions {
  const { kind } = useStore();
  const { current } = useAuth();
  return permissionsFor(kind === 'supabase' ? 'organizzazione' : 'locale', current?.role ?? null);
}

/** Mostra i comandi di modifica solo a chi può modificare (B-120). */
export function CanEdit({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return <>{usePermissions().canEdit ? children : fallback}</>;
}
