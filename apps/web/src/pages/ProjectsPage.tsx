import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { emptyBundle, exportProject, importProject, type ImportCheck, type Sector } from '@mdt/domain';
import { downloadText, useStore } from '../state/store';
import { Alert, Field } from '../components/ui';
import { formatArea } from '@mdt/domain';
import { SharePanel } from '../components/SharePanel';
import { CanEdit, usePermissions } from '../state/permissions';
import { PathGuide } from '../components/guide';

export function ProjectsPage() {
  const { projects, save, remove, openDemo, ready, kind } = useStore();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [sector, setSector] = useState<Sector>('urban');
  const [imp, setImp] = useState<ImportCheck | null>(null);
  const perms = usePermissions();

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const b = emptyBundle({ name: name.trim(), sector, mode: 'demo', isDemoSeed: false, description: '' }, new Date());
    await save(b);
    nav(`/progetti/${b.project.id}/area`);
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    const res = importProject(await file.text());
    setImp(res);
    if (res.bundle && res.hashOk && res.baselinesIntact) await save(res.bundle);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold text-petrol-900">Progetti</h1>
      <p className="text-sm text-sand-600">
        {kind === 'supabase'
          ? 'Progetti condivisi con l’organizzazione selezionata. Ogni persona vede e modifica solo ciò che il suo ruolo consente.'
          : 'I progetti sono salvati in questo browser. Per conservarli o condividerli accedi a un’organizzazione o usa “Esporta”.'}
      </p>
      <PathGuide where={{ step: 1, what: 'i progetti salvati e le due demo con valori SIMULATI.', why: 'ogni analisi, decisione e verifica resta legata a un progetto, con il suo storico.' }} />

      <CanEdit fallback={<p className="text-sm text-sand-600">Hai il ruolo “lettura”: puoi aprire ed esportare i progetti dell’organizzazione, non crearli o modificarli.</p>}>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" disabled={!ready} onClick={async () => nav(`/progetti/${await openDemo('urban')}/urbano`)}>
          Carica demo urbana
        </button>
        <button type="button" className="btn-secondary" disabled={!ready} onClick={async () => nav(`/progetti/${await openDemo('agriculture')}/agricolo`)}>
          Carica demo agricola
        </button>
        <label className="btn-ghost cursor-pointer">
          Importa progetto (JSON)
          <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => onImport(e.target.files?.[0])} />
        </label>
      </div>
      </CanEdit>

      {imp && (
        <Alert tone={imp.ok ? 'ok' : imp.bundle && imp.hashOk ? 'warn' : 'error'} title={imp.ok ? 'Progetto importato e verificato' : 'Esito importazione'}>
          <p>Hash del file: {imp.hashOk ? 'corrispondente ✔' : 'non corrispondente ✖'} · Baseline integre: {imp.baselinesIntact ? 'sì ✔' : 'no ✖'}</p>
          {Object.keys(imp.reproducible).length > 0 && (
            <p>
              Scenari riproducibili: {Object.values(imp.reproducible).filter(Boolean).length}/{Object.keys(imp.reproducible).length}
            </p>
          )}
          {imp.errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
          {!(imp.hashOk && imp.baselinesIntact) && <p>Il progetto non è stato salvato.</p>}
        </Alert>
      )}

      <CanEdit>
      <section className="card" aria-labelledby="nuovo">
        <h2 id="nuovo" className="h-section">
          Nuovo progetto
        </h2>
        <form onSubmit={create} className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
          <Field label="Nome" htmlFor="pname">
            <input id="pname" className="input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="es. Viale alberato via Roma" />
          </Field>
          <fieldset>
            <legend className="label">Settore</legend>
            <div className="flex gap-2">
              {(['urban', 'agriculture'] as const).map((s) => (
                <label key={s} className={`btn ${sector === s ? 'bg-petrol-700 text-white' : 'border-2 border-sand-400 bg-white'}`}>
                  <input type="radio" name="sector" value={s} checked={sector === s} onChange={() => setSector(s)} className="sr-only" />
                  {s === 'urban' ? 'Urbano' : 'Agricolo'}
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" className="btn-primary">
            Crea e definisci l’area
          </button>
        </form>
      </section>
      </CanEdit>

      <ul className="grid gap-3 md:grid-cols-2">
        {projects.map((b) => {
          const p = b.project;
          const lab = `/progetti/${p.id}/${p.sector === 'urban' ? 'urbano' : 'agricolo'}`;
          return (
            <li key={p.id} className="card space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs font-bold ${p.sector === 'urban' ? 'bg-petrol-100 text-petrol-900' : 'bg-leaf-100 text-leaf-800'}`}>
                  {p.sector === 'urban' ? 'Urbano' : 'Agricolo'}
                </span>
                <span className="rounded bg-ochre-100 px-2 py-0.5 text-xs font-bold text-ochre-800">{p.mode === 'demo' ? 'Demo' : 'Pilota'}</span>
                {p.isDemoSeed && <span className="rounded border border-ochre-800 px-2 py-0.5 text-xs font-bold text-ochre-800">DATI DEMO</span>}
              </div>
              <h3 className="font-bold text-petrol-900">
                <Link to={b.area ? lab : `/progetti/${p.id}/area`} className="hover:underline">
                  {p.name}
                </Link>
              </h3>
              <p className="text-sm text-sand-600">
                {b.area ? `Area ${formatArea(b.area.areaM2)}` : 'Area non definita'} · {b.scenarios.length} scenari · {b.decisions.length} decisioni
              </p>
              <div className="flex flex-wrap gap-2">
                <Link to={b.area ? lab : `/progetti/${p.id}/area`} className="btn-secondary">
                  Apri
                </Link>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => downloadText(`${p.name.replace(/[^\w-]+/g, '_')}.mdt.json`, JSON.stringify(exportProject(b, new Date()), null, 2))}
                >
                  Esporta JSON
                </button>
                {perms.canAdmin && (
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => {
                    const where = kind === 'supabase' ? "dall'archivio dell'organizzazione (per tutti i membri)" : 'da questo browser';
                    if (confirm(`Eliminare definitivamente "${p.name}" ${where}? L'operazione non è reversibile.`)) remove(p.id).catch(() => undefined);
                  }}
                >
                  Elimina
                </button>
                )}
              </div>
              {kind === 'supabase' && <SharePanel projectId={p.id} />}
            </li>
          );
        })}
      </ul>
      {ready && projects.length === 0 && <p className="text-sm text-sand-600">Nessun progetto salvato.</p>}
    </div>
  );
}
