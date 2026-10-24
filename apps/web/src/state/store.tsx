import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { seedCampobasso, seedVineyard, withAudit, type ProjectBundle } from '@mdt/domain';
import { createRepository, type Repository } from './repository';
import { PermissionError } from './supabaseRepository';

interface StoreValue {
  ready: boolean;
  persistent: boolean;
  projects: ProjectBundle[];
  get(id: string | undefined): ProjectBundle | undefined;
  save(bundle: ProjectBundle): Promise<void>;
  update(id: string, fn: (b: ProjectBundle) => ProjectBundle, audit?: { action: string; detail: string }): Promise<ProjectBundle>;
  remove(id: string): Promise<void>;
  openDemo(kind: 'urban' | 'agriculture'): Promise<string>;
  error: string | null;
  clearError(): void;
  kind: Repository['kind'];
  reload(): Promise<void>;
}

const Ctx = createContext<StoreValue | null>(null);

export function todayRome(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(now);
}

export function StoreProvider({
  children,
  repository,
  persistent: persistentProp,
  readOnly = false,
}: {
  children: ReactNode;
  repository?: Repository;
  persistent?: boolean;
  /** ruolo "lettura": il client non tenta scritture (il server le rifiuterebbe comunque) */
  readOnly?: boolean;
}) {
  const [{ repo, persistent }] = useState(() =>
    repository ? { repo: repository, persistent: persistentProp ?? repository.kind === 'supabase' } : createRepository(),
  );
  const [projects, setProjects] = useState<ProjectBundle[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // riferimento sempre aggiornato: evita aggiornamenti persi con chiamate ravvicinate
  const latest = useRef<ProjectBundle[]>([]);
  latest.current = projects;

  const reload = useCallback(async () => {
    try {
      const list = await repo.list();
      setProjects(list.sort((a, b) => b.project.createdAt.localeCompare(a.project.createdAt)));
      setError(null);
    } catch (e) {
      setError(
        repo.kind === 'supabase'
          ? `Impossibile leggere i progetti dell’organizzazione: ${(e as Error).message}`
          : 'Impossibile leggere i progetti salvati nel browser.',
      );
    } finally {
      setReady(true);
    }
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (bundle: ProjectBundle) => {
      try {
        if (readOnly) throw new PermissionError('Hai il ruolo “lettura” in questa organizzazione: non puoi salvare modifiche.');
        await repo.save(bundle);
        latest.current = [bundle, ...latest.current.filter((p) => p.project.id !== bundle.project.id)];
        setProjects(latest.current);
      } catch (e) {
        const name = (e as Error).name;
        setError(
          name === 'ConflictError' || name === 'PermissionError'
            ? (e as Error).message
            : `Salvataggio non riuscito: i dati potrebbero non essere persistiti. ${(e as Error).message ?? ''}`,
        );
        throw e;
      }
    },
    [repo, readOnly],
  );

  const get = useCallback((id: string | undefined) => projects.find((p) => p.project.id === id), [projects]);

  const update = useCallback(
    async (id: string, fn: (b: ProjectBundle) => ProjectBundle, audit?: { action: string; detail: string }) => {
      const current = latest.current.find((p) => p.project.id === id);
      if (!current) throw new Error('Progetto non trovato');
      let next = fn(current);
      if (audit) next = withAudit(next, audit.action, audit.detail, new Date());
      await save(next);
      return next;
    },
    [save],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        if (readOnly) throw new PermissionError();
        await repo.remove(id);
      } catch (e) {
        setError((e as Error).message);
        throw e;
      }
      latest.current = latest.current.filter((p) => p.project.id !== id);
      setProjects(latest.current);
    },
    [repo, readOnly],
  );

  const openDemo = useCallback(
    async (kind: 'urban' | 'agriculture') => {
      const existing = projects.find((p) => p.project.isDemoSeed && p.project.sector === kind);
      if (existing) return existing.project.id;
      const now = new Date();
      const b = kind === 'urban' ? seedCampobasso(now) : seedVineyard(now, todayRome(now));
      await save(b);
      return b.project.id;
    },
    [projects, save],
  );

  const value = useMemo(
    () => ({ ready, persistent, projects, get, save, update, remove, openDemo, error, clearError: () => setError(null), kind: repo.kind, reload }),
    [ready, persistent, projects, get, save, update, remove, openDemo, error, repo.kind, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore fuori da StoreProvider');
  return v;
}

export function rememberProject(id: string) {
  try {
    localStorage.setItem('mdt:lastProject', id);
  } catch {
    /* storage non disponibile */
  }
}

export function lastProjectId(): string | null {
  try {
    return localStorage.getItem('mdt:lastProject');
  } catch {
    return null;
  }
}

export function downloadText(filename: string, text: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
