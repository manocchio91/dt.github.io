import { useState } from 'react';
import { NavLink, Outlet, useMatch } from 'react-router-dom';
import { ConflictNotice } from '../components/ConflictNotice';
import { useStore, lastProjectId } from '../state/store';
import { useAuth, ROLE_LABEL } from '../state/auth';
import { usePreferences } from '../state/preferences';
import { PROFILE_LABEL } from '@mdt/domain';
import { assetUrl } from '../state/appUrl';

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? 'bg-petrol-700 text-white' : 'text-petrol-900 hover:bg-petrol-100'}`;

export function Layout() {
  const { get, persistent, error, clearError, kind, conflict, resolveConflict } = useStore();
  const [reloading, setReloading] = useState(false);
  const { current, session, client } = useAuth();
  const { preferences } = usePreferences();
  const guided = (preferences?.mode ?? 'guidata') === 'guidata';
  const match = useMatch('/progetti/:id/*');
  const pid = match?.params.id ?? lastProjectId() ?? undefined;
  const project = get(pid);
  const sector = project?.project.sector;
  const labPath = project ? `/progetti/${project.project.id}/${sector === 'urban' ? 'urbano' : 'agricolo'}` : '/progetti';

  return (
    <div className="min-h-dvh pb-20 md:pb-0">
      <a href="#main" className="sr-only z-50 rounded bg-white p-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Vai al contenuto
      </a>
      <header className="sticky top-0 z-20 border-b border-sand-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2">
          <NavLink to="/" className="flex items-center gap-2">
            <img src={assetUrl('favicon.svg')} alt="" className="size-8" />
            <span className="leading-tight">
              <span className="block text-sm font-extrabold text-petrol-900 md:text-base">Micro Digital Twin</span>
              <span className="block text-xs text-sand-600">Climate Decision Lab</span>
            </span>
          </NavLink>
          {/* il nome dell'organizzazione può essere lungo: va a capo dentro l'intestazione */}
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <NavLink
              to="/accesso"
              className="max-w-full rounded-full border-2 border-petrol-500 bg-white px-3 py-1 text-xs font-bold text-petrol-900 [overflow-wrap:anywhere]"
              title={kind === 'supabase' ? 'Archivio condiviso dell’organizzazione' : 'I progetti restano in questo browser'}
            >
              {kind === 'supabase' && current ? `${current.organizationName} · ${ROLE_LABEL[current.role]}` : session ? 'Questo browser · scegli organizzazione' : client ? 'Questo browser · Accedi' : 'Questo browser'}
            </NavLink>
            <p className="rounded-full border-2 border-ochre-500 bg-ochre-100 px-3 py-1 text-xs font-bold text-ochre-800" title="Stime illustrative, modelli non validati">
              Modalità Demo
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-4 md:py-6">
        <nav aria-label="Navigazione principale" className="hidden w-56 shrink-0 md:block">
          <div className="sticky top-20 space-y-1">
            <NavLink to="/" end className={linkCls}>
              Home
            </NavLink>
            <NavLink to="/progetti" end className={linkCls}>
              Progetti
            </NavLink>
            {project && (
              <div className="my-3 rounded-lg border border-sand-200 bg-white p-2">
                <p className="truncate px-2 pb-1 text-xs font-bold text-sand-600" title={project.project.name}>
                  {project.project.name}
                </p>
                <p className="px-2 pt-1 text-[0.7rem] font-bold tracking-wide text-sand-600 uppercase">Progetto</p>
                <NavLink to={`/progetti/${project.project.id}/area`} className={linkCls}>
                  {sector === 'urban' ? 'Area' : 'Parcelle'}
                </NavLink>
                <NavLink to={labPath} className={linkCls}>
                  Analisi
                </NavLink>
                {sector === 'urban' && (
                  <NavLink to={`/progetti/${project.project.id}/confronto`} className={linkCls}>
                    Confronto
                  </NavLink>
                )}
                {sector === 'urban' && (
                  <NavLink to={`/progetti/${project.project.id}/verifica`} className={linkCls}>
                    Decisioni e verifica
                  </NavLink>
                )}
                <NavLink to={`/progetti/${project.project.id}/documenti`} className={linkCls}>
                  Allegati e prove
                </NavLink>
                {!guided && <NavLink to={`/progetti/${project.project.id}/previsioni`} className={linkCls}>Previsioni</NavLink>}
              </div>
            )}
            <details open={!guided} className="rounded-lg border border-sand-200 bg-white p-2">
              <summary className="cursor-pointer px-2 py-2 text-sm font-bold text-petrol-900">Informazioni</summary>
              <NavLink to="/metodo" className={linkCls}>Fonti e metodo</NavLink>
              <NavLink to="/limiti" className={linkCls}>Limiti e responsabilità</NavLink>
              <NavLink to="/stato" className={linkCls}>Stato del prototipo</NavLink>
            </details>
            <NavLink to="/accesso" className={linkCls}>
              Accesso e organizzazione
            </NavLink>
            <NavLink to={preferences ? '/benvenuto?modifica=1' : '/benvenuto'} className={linkCls}>
              {preferences ? 'Le mie preferenze' : 'Inizia (2 minuti)'}
            </NavLink>
            {preferences && (
              <p className="px-3 pt-2 text-xs text-sand-600">
                Profilo: {PROFILE_LABEL[preferences.profile].title} · modalità {preferences.mode}
                <br />
                Il profilo non modifica i permessi.
              </p>
            )}
          </div>
        </nav>

        <main id="main" className="min-w-0 flex-1 space-y-4" tabIndex={-1}>
          {!persistent && (
            <p className="rounded-md bg-alert-100 p-2 text-sm text-alert-800" role="status">
              Archiviazione locale non disponibile: i dati restano solo fino alla chiusura della pagina. Esporta il progetto per conservarlo.
            </p>
          )}
          {kind === 'supabase' && current?.role === 'viewer' && (
            <p className="rounded-md bg-petrol-100 p-2 text-sm text-petrol-900" role="status">
              Ruolo “lettura” in {current.organizationName}: puoi consultare i progetti, le modifiche verranno rifiutate dal server.
            </p>
          )}
          {conflict && (
            <ConflictNotice
              info={conflict}
              busy={reloading}
              onReload={async () => {
                setReloading(true);
                try {
                  await resolveConflict('reload');
                } finally {
                  setReloading(false);
                }
              }}
              onCancel={() => void resolveConflict('cancel')}
            />
          )}
          {error && (
            <div className="flex items-start justify-between gap-2 rounded-md bg-alert-100 p-2 text-sm text-alert-800" role="alert">
              <span>{error}</span>
              <button type="button" className="font-semibold underline" onClick={clearError}>
                Chiudi
              </button>
            </div>
          )}
          <Outlet />
        </main>
      </div>

      <nav aria-label="Navigazione mobile" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-sand-200 bg-white md:hidden">
        {[
          { to: '/', label: 'Home', icon: '⌂', end: true },
          { to: '/progetti', label: 'Progetti', icon: '▤', end: true },
          { to: project ? `/progetti/${project.project.id}/area` : '/progetti', label: sector === 'agriculture' ? 'Parcella' : 'Area', icon: '◇', end: false },
          { to: labPath, label: 'Analisi', icon: '◎', end: false },
          guided
            ? { to: project && sector === 'urban' ? `/progetti/${project.project.id}/confronto` : labPath, label: 'Confronto', icon: '⇄', end: false }
            : { to: '/metodo', label: 'Tecnica', icon: 'ℹ', end: false },
        ].map((l) => (
          <NavLink
            key={l.label}
            to={l.to}
            end={l.end}
            className={({ isActive }) => `flex min-h-14 flex-col items-center justify-center text-xs font-semibold ${isActive ? 'text-petrol-700' : 'text-sand-600'}`}
          >
            <span aria-hidden="true" className="text-lg leading-none">
              {l.icon}
            </span>
            {l.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
