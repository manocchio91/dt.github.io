import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  changeSector,
  DATA_SOURCES,
  dataConsequences,
  DECISIONS,
  emptyBundle,
  finalizeOnboarding,
  labPath,
  MODE_LABEL,
  ONBOARDING_STEPS,
  onboardingTarget,
  OPERATIONAL_PROFILES,
  PROFILE_DEFAULT_SECTOR,
  PROFILE_LABEL,
  SECTOR_LABEL,
  validateStep,
  type OnboardingDraft,
  type Sector,
  type WorkMode,
} from '@mdt/domain';
import { useStore } from '../state/store';
import { useAuth, ROLE_LABEL } from '../state/auth';
import { usePermissions } from '../state/permissions';
import { usePreferences } from '../state/preferences';
import { Alert } from '../components/ui';

const QUESTIONS: Record<(typeof ONBOARDING_STEPS)[number], string> = {
  profilo: 'Chi sei?',
  ambito: 'Dove vuoi lavorare?',
  decisione: 'Quale decisione devi affrontare?',
  area: 'Quale area o progetto vuoi analizzare?',
  dati: 'Quali dati hai già?',
  modalita: 'Come preferisci lavorare?',
};

function Choice({ name, value, checked, onChange, title, hint, type = 'radio' }: { name: string; value: string; checked: boolean; onChange: () => void; title: string; hint: string; type?: 'radio' | 'checkbox' }) {
  return (
    <label
      className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition-colors ${checked ? 'border-petrol-700 bg-petrol-100' : 'border-sand-200 bg-white hover:border-petrol-500'}`}
    >
      <input type={type} name={name} value={value} checked={checked} onChange={onChange} className="mt-1 size-5 shrink-0 accent-petrol-700" />
      <span>
        <span className="block font-bold text-sand-900">{title}</span>
        <span className="block text-sm text-sand-600">{hint}</span>
      </span>
    </label>
  );
}

export function OnboardingPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const editing = params.get('modifica') === '1';
  const prefs = usePreferences();
  const { projects, save, openDemo } = useStore();
  const { current } = useAuth();
  const perms = usePermissions();
  const [draft, setDraft] = useState<OnboardingDraft>(() => (editing && prefs.preferences ? { ...prefs.preferences } : { data: [] }));
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const key = ONBOARDING_STEPS[step]!;

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // in modifica, le preferenze dell'account possono arrivare dopo il primo render
  const savedPrefs = prefs.preferences;
  useEffect(() => {
    if (editing && savedPrefs && !draft.profile) queueMicrotask(() => setDraft({ ...savedPrefs }));
  }, [editing, savedPrefs, draft.profile]);

  const sector = draft.sector;
  const sectorProjects = projects.filter((p) => p.project.sector === sector);

  const next = async (e?: FormEvent) => {
    e?.preventDefault();
    const errs = validateStep(key, draft);
    setErrors(errs);
    if (errs.length) return;
    if (step < ONBOARDING_STEPS.length - 1) {
      // all'ingresso nel passo "ambito" proponi quello tipico del profilo
      if (key === 'profilo' && !draft.sector && draft.profile && PROFILE_DEFAULT_SECTOR[draft.profile]) {
        setDraft((d) => changeSector(d, PROFILE_DEFAULT_SECTOR[draft.profile!]!));
      }
      setStep(step + 1);
      return;
    }
    await finish();
  };

  const finish = async () => {
    setBusy(true);
    try {
      const p = finalizeOnboarding(draft, new Date());
      await prefs.save(p);
      const target = onboardingTarget(
        p,
        projects.map((b) => ({ id: b.project.id, sector: b.project.sector, hasArea: !!b.area })),
      );
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      try {
        sessionStorage.setItem('mdt:onboarding:seconds', String(seconds));
      } catch {
        /* facoltativo */
      }
      if (target.kind === 'demo') {
        const id = await openDemo(target.sector);
        nav(labPath(id, target.sector));
      } else if (target.kind === 'nuovo') {
        const b = emptyBundle({ name: target.name, sector: target.sector, mode: 'demo', isDemoSeed: false, description: '' }, new Date());
        await save(b);
        nav(`/progetti/${b.project.id}/area`);
      } else nav(target.path);
    } catch (e) {
      setErrors([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  };

  const skipTo = async (s: Sector) => {
    prefs.skip();
    try {
      const id = await openDemo(s);
      nav(labPath(id, s));
    } catch (e) {
      setErrors([(e as Error).message]);
    }
  };

  let body: ReactNode = null;
  if (key === 'profilo') {
    body = (
      <>
        <div className="grid gap-2 sm:grid-cols-2">
          {OPERATIONAL_PROFILES.map((p) => (
            <Choice key={p} name="profilo" value={p} checked={draft.profile === p} onChange={() => setDraft({ ...draft, profile: p })} title={PROFILE_LABEL[p].title} hint={PROFILE_LABEL[p].hint} />
          ))}
        </div>
        <p className="rounded-lg bg-sand-100 p-3 text-sm" id="nota-permessi">
          Il profilo serve ad adattare testi e percorso. <strong>Non cambia i tuoi permessi</strong>: chi può leggere o modificare i progetti lo decide l’amministratore della tua organizzazione.
          {current && (
            <>
              {' '}
              In <strong>{current.organizationName}</strong> il tuo ruolo è: <strong>{ROLE_LABEL[current.role]}</strong>.
            </>
          )}
        </p>
      </>
    );
  } else if (key === 'ambito') {
    body = (
      <div className="grid gap-2 sm:grid-cols-2">
        {(['urban', 'agriculture'] as const).map((s) => (
          <Choice key={s} name="ambito" value={s} checked={draft.sector === s} onChange={() => setDraft(changeSector(draft, s))} title={SECTOR_LABEL[s].title} hint={SECTOR_LABEL[s].hint} />
        ))}
      </div>
    );
  } else if (key === 'decisione' && sector) {
    body = (
      <div className="grid gap-2">
        {DECISIONS[sector].map((o) => (
          <Choice key={o.id} name="decisione" value={o.id} checked={draft.decision === o.id} onChange={() => setDraft({ ...draft, decision: o.id })} title={o.title} hint={o.hint} />
        ))}
      </div>
    );
  } else if (key === 'area') {
    const nuovoName = draft.area?.kind === 'nuovo' ? draft.area.name : '';
    body = (
      <div className="grid gap-2">
        <Choice
          name="area"
          value="demo"
          checked={draft.area?.kind === 'demo'}
          onChange={() => setDraft({ ...draft, area: { kind: 'demo' } })}
          title={sector === 'agriculture' ? 'Vigneto dimostrativo (Molise)' : 'Area dimostrativa: Campobasso, Piazza Vittorio Emanuele II'}
          hint="Dati simulati, pronti da esplorare. Consigliato per iniziare."
        />
        {perms.canEdit && (
          <Choice
            name="area"
            value="nuovo"
            checked={draft.area?.kind === 'nuovo'}
            onChange={() => setDraft({ ...draft, area: { kind: 'nuovo', name: nuovoName } })}
            title="Un mio nuovo progetto"
            hint="Disegnerai l’area sulla mappa o inserirai le coordinate."
          />
        )}
        {draft.area?.kind === 'nuovo' && (
          <div className="ml-8">
            <label htmlFor="nome-progetto" className="label">
              Nome del progetto
            </label>
            <input
              id="nome-progetto"
              className="input"
              value={nuovoName}
              onChange={(e) => setDraft({ ...draft, area: { kind: 'nuovo', name: e.target.value } })}
              placeholder={sector === 'agriculture' ? 'es. Vigna sotto casa' : 'es. Piazza del mercato'}
              autoFocus
            />
          </div>
        )}
        {sectorProjects.length > 0 && (
          <Choice
            name="area"
            value="esistente"
            checked={draft.area?.kind === 'esistente'}
            onChange={() => setDraft({ ...draft, area: { kind: 'esistente', projectId: sectorProjects[0]!.project.id } })}
            title="Un progetto che ho già"
            hint={`${sectorProjects.length} progetti disponibili in questo ambito.`}
          />
        )}
        {draft.area?.kind === 'esistente' && (
          <div className="ml-8">
            <label htmlFor="progetto-esistente" className="label">
              Progetto
            </label>
            <select id="progetto-esistente" className="input" value={draft.area.projectId} onChange={(e) => setDraft({ ...draft, area: { kind: 'esistente', projectId: e.target.value } })}>
              {sectorProjects.map((b) => (
                <option key={b.project.id} value={b.project.id}>
                  {b.project.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {!perms.canEdit && <p className="text-sm text-sand-600">Con il ruolo “lettura” puoi esplorare i progetti esistenti e la demo, ma non crearne di nuovi.</p>}
      </div>
    );
  } else if (key === 'dati' && sector) {
    const toggle = (id: string) => setDraft({ ...draft, data: draft.data?.includes(id) ? draft.data.filter((x) => x !== id) : [...(draft.data ?? []), id] });
    const consequences = dataConsequences({ sector, data: draft.data ?? [] });
    body = (
      <>
        <p className="text-sm text-sand-600">Seleziona tutto quello che hai. Se non hai niente, va bene lo stesso: vai avanti.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {DATA_SOURCES[sector].map((o) => (
            <Choice key={o.id} type="checkbox" name="dati" value={o.id} checked={!!draft.data?.includes(o.id)} onChange={() => toggle(o.id)} title={o.title} hint={o.hint} />
          ))}
        </div>
        {consequences.length > 0 && (
          <div className="rounded-lg bg-ochre-100 p-3 text-sm text-ochre-800" aria-live="polite">
            <p className="font-bold">Cosa cambia senza questi dati</p>
            <ul className="mt-1 list-disc pl-5">
              {consequences.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
      </>
    );
  } else if (key === 'modalita') {
    body = (
      <div className="grid gap-2 sm:grid-cols-2">
        {(['guidata', 'tecnica'] as WorkMode[]).map((m) => (
          <Choice key={m} name="modalita" value={m} checked={draft.mode === m} onChange={() => setDraft({ ...draft, mode: m })} title={MODE_LABEL[m].title} hint={MODE_LABEL[m].hint} />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-sand-600" aria-live="polite">
          {editing ? 'Modifica preferenze · ' : ''}Domanda {step + 1} di {ONBOARDING_STEPS.length}
        </p>
        <p className="text-xs text-sand-600">Circa 1 minuto · le risposte si possono cambiare dopo</p>
      </div>
      <progress className="h-2 w-full accent-petrol-700" max={ONBOARDING_STEPS.length} value={step + 1} aria-label="Avanzamento" />

      <form onSubmit={next} className="card space-y-4" noValidate>
        <fieldset className="space-y-3">
          <legend className="sr-only">{QUESTIONS[key]}</legend>
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-extrabold text-petrol-900 outline-none md:text-3xl">
            {QUESTIONS[key]}
          </h1>
          {body}
        </fieldset>

        {errors.length > 0 && (
          <Alert tone="error">
            {errors.map((e) => (
              <p key={e}>{e}</p>
            ))}
          </Alert>
        )}
        {prefs.error && <Alert tone="error">{prefs.error}</Alert>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sand-200 pt-4">
          <button type="button" className="btn-ghost" onClick={() => (step === 0 ? nav(-1) : setStep(step - 1))}>
            ← Indietro
          </button>
          <button type="submit" className="btn-primary min-w-40" disabled={busy}>
            {step === ONBOARDING_STEPS.length - 1 ? (busy ? 'Avvio…' : editing ? 'Salva e apri' : 'Inizia') : 'Avanti →'}
          </button>
        </div>
      </form>

      {!editing && (
        <section aria-labelledby="salta" className="flex flex-wrap items-center gap-2 text-sm">
          <h2 id="salta" className="font-semibold text-sand-600">
            Vuoi solo dare un’occhiata?
          </h2>
          {(sector ? [sector] : (['urban', 'agriculture'] as Sector[])).map((s) => (
            <button key={s} type="button" className="btn-ghost underline" onClick={() => skipTo(s)}>
              Salta e apri la demo {s === 'urban' ? 'urbana' : 'agricola'}
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
