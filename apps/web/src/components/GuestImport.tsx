import { useEffect, useMemo, useState } from 'react';
import { PROFILE_LABEL, type MediaRecord, type OnboardingPreferences, type ProjectBundle } from '@mdt/domain';
import { useAuth } from '../state/auth';
import { useStore } from '../state/store';
import { LocalRepository } from '../state/repository';
import { readLocalPreferences, usePreferences } from '../state/preferences';
import { useMediaStores } from '../state/useMedia';
import { uploadLocalRecords } from '../state/mediaSync';
import { Alert, Section } from './ui';

/**
 * B-121 — Dopo l'accesso, propone di importare nell'organizzazione ciò che era
 * stato salvato come ospite in questo browser. Niente è automatico: l'utente
 * vede cosa verrà trasferito, sceglie e può annullare.
 */
export function GuestImport({ repo = new LocalRepository() }: { repo?: LocalRepository } = {}) {
  const { current } = useAuth();
  const store = useStore();
  const prefs = usePreferences();
  const { local, remote, userId } = useMediaStores();
  const [localProjects, setLocalProjects] = useState<ProjectBundle[]>([]);
  const [localMedia, setLocalMedia] = useState<MediaRecord[]>([]);
  const [localPrefs] = useState<OnboardingPreferences | null>(() => readLocalPreferences());
  const [selProjects, setSelProjects] = useState<Set<string>>(new Set());
  const [selMediaProjects, setSelMediaProjects] = useState<Set<string>>(new Set());
  const [selPrefs, setSelPrefs] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'warn'; lines: string[] } | null>(null);
  const canEdit = !!current && current.role !== 'viewer';

  useEffect(() => {
    let alive = true;
    Promise.all([repo.list().catch(() => []), local.listAll().catch(() => [])]).then(([p, m]) => {
      if (!alive) return;
      setLocalProjects(p);
      setLocalMedia(m.filter((r) => r.organizationId === null));
    });
    return () => {
      alive = false;
    };
  }, [repo, local, result]);

  const inOrg = useMemo(() => new Set(store.projects.map((p) => p.project.id)), [store.projects]);
  const mediaByProject = useMemo(() => {
    const m = new Map<string, MediaRecord[]>();
    for (const r of localMedia) m.set(r.projectId, [...(m.get(r.projectId) ?? []), r]);
    return m;
  }, [localMedia]);
  const prefsOffer = !!localPrefs && !prefs.preferences;
  const projectsOffer = localProjects.length > 0;
  const nothing = !prefsOffer && !projectsOffer && localMedia.length === 0;

  if (!current || store.kind !== 'supabase' || dismissed || (nothing && !result)) return null;

  const plan = {
    progetti: [...selProjects].filter((id) => !inOrg.has(id)),
    file: [...selMediaProjects].flatMap((id) => mediaByProject.get(id) ?? []),
    preferenze: selPrefs && prefsOffer,
  };
  const empty = plan.progetti.length === 0 && plan.file.length === 0 && !plan.preferenze;

  const run = async () => {
    setBusy(true);
    const lines: string[] = [];
    let warn = false;
    try {
      for (const id of plan.progetti) {
        const b = localProjects.find((p) => p.project.id === id);
        if (!b) continue;
        try {
          await store.save(b);
          lines.push(`Progetto “${b.project.name}” copiato.`);
        } catch (e) {
          warn = true;
          lines.push(`Progetto “${b.project.name}” non copiato: ${(e as Error).message}`);
        }
      }
      if (plan.file.length && remote) {
        const r = await uploadLocalRecords(remote, local, plan.file, userId);
        lines.push(`${r.ok} file caricati nell’archivio privato.`);
        if (r.failed.length) {
          warn = true;
          lines.push(`Non caricati: ${r.failed.join('; ')}`);
        }
      }
      if (plan.preferenze && localPrefs) {
        await prefs.save(localPrefs);
        lines.push('Preferenze salvate nel tuo account.');
      }
    } finally {
      setBusy(false);
      setSelProjects(new Set());
      setSelMediaProjects(new Set());
      setSelPrefs(false);
      setResult({ tone: warn ? 'warn' : 'ok', lines: [...lines, 'Le copie locali dei progetti restano nel browser.'] });
    }
  };

  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const n = new Set(set);
    if (on) n.add(id);
    else n.delete(id);
    return n;
  };

  return (
    <Section title="Dati salvati come ospite in questo browser">
      {result && (
        <Alert tone={result.tone}>
          {result.lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </Alert>
      )}
      {!nothing && (
        <>
          <p className="text-sm">
            Prima di accedere hai lavorato come ospite. Nulla viene trasferito automaticamente: scegli cosa importare in <strong>{current.organizationName}</strong>.
          </p>
          {!canEdit && <Alert tone="info">Con il ruolo “lettura” non puoi importare progetti o file in questa organizzazione.</Alert>}
          <fieldset className="space-y-2" disabled={!canEdit || busy}>
            <legend className="label">Cosa vuoi importare?</legend>
            {prefsOffer && localPrefs && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-5" checked={selPrefs} onChange={(e) => setSelPrefs(e.target.checked)} />
                <span>
                  Preferenze: {PROFILE_LABEL[localPrefs.profile].title}, modalità {localPrefs.mode} <span className="text-sand-600">(il profilo non cambia i permessi)</span>
                </span>
              </label>
            )}
            {localProjects.map((b) => {
              const files = mediaByProject.get(b.project.id) ?? [];
              const present = inOrg.has(b.project.id);
              return (
                <div key={b.project.id} className="rounded-lg border border-sand-200 p-2 text-sm">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-5"
                      checked={present || selProjects.has(b.project.id)}
                      disabled={present}
                      onChange={(e) => setSelProjects(toggle(selProjects, b.project.id, e.target.checked))}
                    />
                    <span>
                      Progetto “{b.project.name}” {present && <span className="text-sand-600">(già presente nell’organizzazione)</span>}
                    </span>
                  </label>
                  {files.length > 0 && (
                    <label className="mt-1 ml-7 flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-5"
                        checked={selMediaProjects.has(b.project.id)}
                        disabled={!present && !selProjects.has(b.project.id)}
                        onChange={(e) => setSelMediaProjects(toggle(selMediaProjects, b.project.id, e.target.checked))}
                      />
                      <span>
                        {files.length} file locali di questo progetto (verranno verificati dal server prima di essere disponibili)
                      </span>
                    </label>
                  )}
                </div>
              );
            })}
          </fieldset>
          <p className="text-sm" aria-live="polite">
            {empty
              ? 'Nessun elemento selezionato.'
              : `Verranno trasferiti: ${plan.progetti.length} progetti, ${plan.file.length} file${plan.preferenze ? ', le preferenze' : ''}.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={empty || busy || !canEdit} onClick={run}>
              {busy ? 'Importazione…' : 'Importa la selezione'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setDismissed(true)}>
              Non ora
            </button>
          </div>
        </>
      )}
    </Section>
  );
}
