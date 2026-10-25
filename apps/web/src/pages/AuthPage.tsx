import { useEffect, useState, type FormEvent } from 'react';
import { useAuth, ROLE_LABEL, type OrgRole } from '../state/auth';
import { Alert, Field, Section, StatusBadge } from '../components/ui';
import { GuestImport } from '../components/GuestImport';

export function AuthPage() {
  const auth = useAuth();
  const [mode, setMode] = useState<'login' | 'signup' | 'magic'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<OrgRole>('viewer');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ tone: 'ok', text });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!auth.client) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-extrabold text-petrol-900">Accesso e organizzazione</h1>
        <Section title="Archivio condiviso" aside={<StatusBadge status="non_disponibile" />}>
          <p className="text-sm">
            Supabase non è configurato per questa installazione: i progetti restano solo in questo browser. Per attivare account, organizzazioni e permessi, l’amministratore deve impostare
            <code className="mx-1">VITE_SUPABASE_URL</code> e <code className="mx-1">VITE_SUPABASE_PUBLISHABLE_KEY</code> e applicare le migrazioni in <code>supabase/migrations</code>.
          </p>
        </Section>
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (mode === 'login') await auth.signIn(email, password);
      else if (mode === 'signup') {
        const r = await auth.signUp(email, password, displayName.trim() || email.split('@')[0]!);
        return r === 'confirm_email' ? 'Controlla la posta: conferma l’indirizzo per completare la registrazione.' : 'Account creato.';
      } else {
        await auth.sendMagicLink(email);
        return 'Ti abbiamo inviato un link di accesso via email.';
      }
    });
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold text-petrol-900">Accesso e organizzazione</h1>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {!auth.session ? (
        <Section title="Accedi">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Modalità di accesso">
            {(
              [
                ['login', 'Email e password'],
                ['magic', 'Link via email'],
                ['signup', 'Registrati'],
              ] as const
            ).map(([m, l]) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} className={`btn ${mode === m ? 'bg-petrol-700 text-white' : 'border-2 border-sand-400 bg-white'}`} onClick={() => setMode(m)}>
                {l}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="grid max-w-md gap-3">
            {mode === 'signup' && (
              <Field label="Nome visualizzato" htmlFor="dn">
                <input id="dn" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
              </Field>
            )}
            <Field label="Email" htmlFor="em">
              <input id="em" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </Field>
            {mode !== 'magic' && (
              <Field label="Password" htmlFor="pw" hint={mode === 'signup' ? 'Almeno 8 caratteri.' : undefined}>
                <input
                  id="pw"
                  type="password"
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={mode === 'signup' ? 8 : undefined}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                />
              </Field>
            )}
            <button type="submit" className="btn-primary" disabled={busy}>
              {mode === 'login' ? 'Accedi' : mode === 'signup' ? 'Crea account' : 'Invia link'}
            </button>
          </form>
          <p className="text-xs text-sand-600">Raccogliamo solo email e nome visualizzato. La sessione è gestita da Supabase Auth.</p>
        </Section>
      ) : (
        <>
          <Section title="Il tuo account" aside={<button type="button" className="btn-ghost" onClick={() => run(auth.signOut)}>Esci</button>}>
            <p className="text-sm">
              Accesso effettuato come <strong>{auth.session.user.email}</strong>.
            </p>
          </Section>

          <Section title="Organizzazione di lavoro">
            {auth.memberships.length === 0 ? (
              <p className="text-sm">Non fai ancora parte di un’organizzazione. Creane una oppure chiedi a un amministratore di aggiungerti.</p>
            ) : (
              <fieldset>
                <legend className="label">Seleziona dove salvare e leggere i progetti</legend>
                <div className="space-y-2">
                  <label className="flex min-h-11 items-center gap-2 rounded-lg border-2 border-sand-200 px-3 text-sm">
                    <input type="radio" name="org" className="size-5" checked={!auth.current} onChange={() => auth.selectOrganization(null)} />
                    Solo questo browser (nessuna condivisione)
                  </label>
                  {auth.memberships.map((m) => (
                    <label key={m.organizationId} className="flex min-h-11 items-center gap-2 rounded-lg border-2 border-sand-200 px-3 text-sm">
                      <input type="radio" name="org" className="size-5 shrink-0" checked={auth.current?.organizationId === m.organizationId} onChange={() => auth.selectOrganization(m.organizationId)} />
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        <strong>{m.organizationName}</strong> — ruolo: {ROLE_LABEL[m.role]}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await auth.createOrganization(orgName);
                  setOrgName('');
                  return 'Organizzazione creata: sei amministratore.';
                });
              }}
            >
              <Field label="Nuova organizzazione" htmlFor="on">
                <input id="on" className="input" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="es. Comune di Campobasso — Ufficio Verde" minLength={2} required />
              </Field>
              <button type="submit" className="btn-secondary" disabled={busy}>
                Crea
              </button>
            </form>
          </Section>

          {auth.current && (
            <Section title={`Archivio di ${auth.current.organizationName}`}>
              <p className="text-sm">
                I progetti sono salvati nel database dell’organizzazione e visibili ai suoi membri secondo il ruolo. Ogni modifica è versionata; baseline, decisioni e registro di audit sono protetti
                lato server.
              </p>
            </Section>
          )}

          {auth.current && <GuestImport />}

          {auth.current?.role === 'admin' && auth.client && <RetentionDefault orgId={auth.current.organizationId} />}

          {auth.current?.role === 'admin' && (
            <Section title="Membri">
              <form
                className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await auth.addMember(memberEmail, memberRole);
                    setMemberEmail('');
                    return 'Membro aggiunto o aggiornato.';
                  });
                }}
              >
                <Field label="Email di un utente già registrato" htmlFor="me">
                  <input id="me" type="email" className="input" value={memberEmail} onChange={(e) => setMemberEmail(e.target.value)} required />
                </Field>
                <Field label="Ruolo" htmlFor="mr">
                  <select id="mr" className="input" value={memberRole} onChange={(e) => setMemberRole(e.target.value as OrgRole)}>
                    {(Object.keys(ROLE_LABEL) as OrgRole[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </Field>
                <button type="submit" className="btn-primary" disabled={busy}>
                  Aggiungi
                </button>
              </form>
              <p className="text-xs text-sand-600">Lettura: consulta. Modifica: crea e aggiorna progetti. Approvazione: modifica + approva (workflow). Amministrazione: gestisce membri ed elimina progetti.</p>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

/** Periodo di conservazione predefinito dei file dell'organizzazione (solo amministratori). */
function RetentionDefault({ orgId }: { orgId: string }) {
  const auth = useAuth();
  const [years, setYears] = useState<number | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    auth.client
      ?.from('organizations')
      .select('media_retention_years')
      .eq('id', orgId)
      .maybeSingle()
      .then(({ data }) => setYears((data as { media_retention_years?: number } | null)?.media_retention_years ?? 5));
  }, [auth.client, orgId]);
  if (years === null) return null;
  return (
    <Section title="Conservazione dei file">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Conserva i nuovi file per (anni)" htmlFor="ret-years" hint="Vale per i file caricati da ora in poi; la data dei singoli file si modifica nella pagina Foto e documenti.">
          <input id="ret-years" type="number" min={1} max={30} className="input w-28" value={years} onChange={(e) => setYears(Number(e.target.value))} />
        </Field>
        <button
          type="button"
          className="btn-secondary"
          onClick={async () => {
            const { error } = await auth.client!.from('organizations').update({ media_retention_years: years }).eq('id', orgId);
            setSaved(error ? `Non salvato: ${error.message}` : 'Periodo di conservazione aggiornato.');
          }}
        >
          Salva
        </button>
      </div>
      {saved && <p className="text-sm" role="status">{saved}</p>}
    </Section>
  );
}
