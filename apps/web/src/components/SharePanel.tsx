import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../state/auth';
import { Alert } from './ui';
import { appUrl } from '../state/appUrl';

interface LinkRow {
  id: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

/** Link in sola lettura, con scadenza (1–90 giorni) e revoca. Il token è mostrato una sola volta. */
export function SharePanel({ projectId }: { projectId: string }) {
  const { client, current } = useAuth();
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [days, setDays] = useState(14);
  const [fresh, setFresh] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const canEdit = current && current.role !== 'viewer';

  const load = useCallback(async () => {
    if (!client) return;
    const { data, error } = await client.from('shared_links').select('id, created_at, expires_at, revoked_at').eq('project_id', projectId).order('created_at', { ascending: false });
    if (error) setErr(error.message);
    else setLinks((data ?? []) as LinkRow[]);
  }, [client, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!client) return null;

  const create = async () => {
    setErr(null);
    const { data, error } = await client.rpc('create_shared_link', { p_project: projectId, p_days: days });
    if (error) return setErr(error.message);
    setFresh(appUrl(`/condiviso/${data as string}`));
    await load();
  };

  const revoke = async (id: string) => {
    const { error } = await client.rpc('revoke_shared_link', { p_link: id });
    if (error) setErr(error.message);
    await load();
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' });

  return (
    <details className="rounded-lg border border-sand-200 p-2 text-sm">
      <summary className="cursor-pointer font-semibold text-petrol-700">Condividi in sola lettura</summary>
      <div className="mt-2 space-y-2">
        {err && <Alert tone="error">{err}</Alert>}
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="label">Scadenza (giorni)</span>
              <input type="number" min={1} max={90} className="input w-24" value={days} onChange={(e) => setDays(Number(e.target.value))} />
            </label>
            <button type="button" className="btn-secondary" onClick={create}>
              Crea link
            </button>
          </div>
        ) : (
          <p className="text-xs text-sand-600">Il tuo ruolo consente di vedere i link, non di crearli.</p>
        )}
        {fresh && (
          <Alert tone="ok" title="Copia ora il link: non sarà più mostrato">
            <p className="font-mono text-xs break-all">{fresh}</p>
            <button type="button" className="btn-ghost" onClick={() => navigator.clipboard?.writeText(fresh)}>
              Copia
            </button>
          </Alert>
        )}
        <ul className="space-y-1">
          {links.map((l) => {
            const active = !l.revoked_at && Date.parse(l.expires_at) > Date.now();
            return (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-sand-100 px-2 py-1">
                <span>
                  creato {fmt(l.created_at)} · scade {fmt(l.expires_at)} · <strong>{l.revoked_at ? `revocato ${fmt(l.revoked_at)}` : active ? 'attivo' : 'scaduto'}</strong>
                </span>
                {active && canEdit && (
                  <button type="button" className="btn-ghost text-alert-800" onClick={() => revoke(l.id)}>
                    Revoca
                  </button>
                )}
              </li>
            );
          })}
          {links.length === 0 && <li className="text-xs text-sand-600">Nessun link creato.</li>}
        </ul>
      </div>
    </details>
  );
}
