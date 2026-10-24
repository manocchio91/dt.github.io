import { useCallback, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ProjectBundle } from '@mdt/domain';
import { rememberProject, useStore } from './store';

export function useProject() {
  const { id = '' } = useParams();
  const store = useStore();
  const bundle = store.get(id);
  useEffect(() => {
    if (bundle) rememberProject(id);
  }, [id, bundle]);
  const { update: storeUpdate } = store;
  const update = useCallback(
    (fn: (b: ProjectBundle) => ProjectBundle, audit?: { action: string; detail: string }) => storeUpdate(id, fn, audit),
    [storeUpdate, id],
  );
  return { id, bundle, ready: store.ready, update };
}

export function ProjectMissing({ ready }: { ready: boolean }) {
  if (!ready) return <p className="card">Caricamento progetto…</p>;
  return (
    <div className="card space-y-2">
      <p className="font-semibold">Progetto non trovato in questo browser.</p>
      <Link to="/progetti" className="btn-secondary">
        Vai ai progetti
      </Link>
    </div>
  );
}

export function nowIso() {
  return new Date().toISOString();
}
