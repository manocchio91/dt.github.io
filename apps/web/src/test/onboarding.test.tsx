import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { finalizeOnboarding, seedCampobasso, seedVineyard } from '@mdt/domain';
import { OnboardingPage } from '../pages/OnboardingPage';
import { AuthContext } from '../state/auth';
import { PreferencesProvider, usePreferences } from '../state/preferences';
import { DataScope } from '../state/DataScope';
import { useStore } from '../state/store';
import { usePermissions } from '../state/permissions';
import { fakeAuth, fakeSession, fakeSupabase, member, ORG_A, ORG_B, remoteRepo, renderApp } from './utils';

const LOCAL_KEY = 'mdt:onboarding:v1';
const storedPrefs = () => JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null');

beforeEach(() => localStorage.clear());

async function answer(user: ReturnType<typeof userEvent.setup>, name: RegExp | null, role: 'radio' | 'checkbox' = 'radio') {
  if (name) await user.click(screen.getByRole(role, { name }));
  await user.click(screen.getByRole('button', { name: /Avanti|Inizia|Salva e apri/ }));
}

/** Tab fino al pulsante indicato, come farebbe chi usa solo la tastiera. */
async function tabTo(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  for (let i = 0; i < 30; i++) {
    await user.tab();
    const el = document.activeElement as HTMLElement | null;
    if (el?.tagName === 'BUTTON' && name.test(el.textContent ?? '')) return;
  }
  throw new Error(`pulsante ${name} non raggiungibile con Tab`);
}

describe('Onboarding — percorso urbano da ospite', () => {
  it('sei domande, salvataggio locale e arrivo al Lab urbano', async () => {
    const user = userEvent.setup();
    renderApp(<OnboardingPage />, { route: '/benvenuto', path: '/benvenuto' });
    expect(screen.getByRole('heading', { name: 'Chi sei?' })).toHaveFocus();
    expect(screen.getByText(/Non cambia i tuoi permessi/)).toBeInTheDocument();
    await answer(user, /Tecnico comunale/);
    expect(screen.getByRole('heading', { name: 'Dove vuoi lavorare?' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Città/ })).toBeChecked(); // suggerito dal profilo
    await answer(user, null);
    await answer(user, /Ridurre il calore/);
    await answer(user, /Area dimostrativa/);
    expect(screen.queryByText(/sonda|vigneto/i)).toBeNull();
    await answer(user, /Temperature delle superfici/, 'checkbox');
    await answer(user, /Guidata/);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/^\/progetti\/[^/]+\/urbano$/));
    expect(storedPrefs()).toMatchObject({ profile: 'tecnico_comunale', sector: 'urban', decision: 'ridurre_calore', data: ['temperature_superfici'], mode: 'guidata' });
    expect(storedPrefs()).not.toHaveProperty('role');
  });

  it('si completa solo da tastiera', async () => {
    const user = userEvent.setup();
    renderApp(<OnboardingPage />, { route: '/benvenuto', path: '/benvenuto' });
    const select = async () => {
      await user.tab(); // dal titolo al primo controllo del gruppo
      await user.keyboard(' ');
    };
    const proceed = async () => {
      await tabTo(user, /Avanti|Inizia/);
      await user.keyboard('{Enter}');
    };
    await select(); // profilo: primo = tecnico comunale
    expect(screen.getByRole('radio', { name: /Tecnico comunale/ })).toBeChecked();
    await proceed();
    await proceed(); // ambito già suggerito (Città)
    await select(); // decisione
    await proceed();
    await select(); // area: demo
    await proceed();
    await proceed(); // dati: nessuno
    await select(); // modalità: guidata
    await proceed();
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/\/urbano$/));
    expect(storedPrefs()).toMatchObject({ profile: 'tecnico_comunale', mode: 'guidata', data: [] });
  });

  it('non permette di proseguire senza risposta e lo spiega', async () => {
    const user = userEvent.setup();
    renderApp(<OnboardingPage />, { route: '/benvenuto', path: '/benvenuto' });
    await user.click(screen.getByRole('button', { name: /Avanti/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Scegli il profilo/);
  });
});

describe('Onboarding — percorso agricolo e separazione degli ambiti', () => {
  it('mostra solo decisioni e dati agricoli e porta al Lab agricolo', async () => {
    const user = userEvent.setup();
    renderApp(<OnboardingPage />, { route: '/benvenuto', path: '/benvenuto' });
    await answer(user, /Agricoltore/);
    expect(screen.getByRole('radio', { name: /Campagna/ })).toBeChecked();
    await answer(user, null);
    expect(screen.queryByText(/calore|piazza/i)).toBeNull();
    await answer(user, /quale zona controllare/);
    await answer(user, /Vigneto dimostrativo/);
    expect(screen.queryByText(/superfici|prezzari/i)).toBeNull();
    expect(screen.getByText(/la fiducia sarà più bassa/)).toBeInTheDocument();
    await answer(user, /Sonda di umidità/, 'checkbox');
    await answer(user, /Tecnica/);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/\/agricolo$/));
    expect(storedPrefs()).toMatchObject({ sector: 'agriculture', decision: 'zona_da_controllare', data: ['sonda_suolo'], mode: 'tecnica' });
  });

  it('tornando indietro e cambiando ambito, le scelte dell’altro ambito vengono azzerate', async () => {
    const user = userEvent.setup();
    renderApp(<OnboardingPage />, { route: '/benvenuto', path: '/benvenuto' });
    await answer(user, /Revisore/);
    await answer(user, /Città/);
    await answer(user, /Ridurre il calore/);
    await user.click(screen.getByRole('button', { name: /Indietro/ }));
    await user.click(screen.getByRole('button', { name: /Indietro/ }));
    await answer(user, /Campagna/);
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);
  });
});

describe('Demo senza registrazione e preferenze modificabili', () => {
  it('si può saltare l’onboarding e aprire la demo', async () => {
    const user = userEvent.setup();
    renderApp(<OnboardingPage />, { route: '/benvenuto', path: '/benvenuto' });
    await user.click(screen.getByRole('button', { name: /Salta e apri la demo agricola/ }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/\/agricolo$/));
    expect(localStorage.getItem('mdt:onboarding:skipped')).toBe('1');
    expect(storedPrefs()).toBeNull();
  });

  it('le preferenze salvate si riaprono e si modificano', async () => {
    const saved = finalizeOnboarding(
      { profile: 'gestore_verde', sector: 'urban', decision: 'scegliere_intervento', area: { kind: 'demo' }, data: [], mode: 'guidata' },
      new Date('2026-10-24T09:00:00Z'),
    );
    localStorage.setItem(LOCAL_KEY, JSON.stringify(saved));
    const user = userEvent.setup();
    renderApp(<OnboardingPage />, { route: '/benvenuto?modifica=1', path: '/benvenuto' });
    expect(screen.getByText(/Modifica preferenze/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('radio', { name: /Gestore del verde/ })).toBeChecked());
    for (let i = 0; i < 5; i++) await user.click(screen.getByRole('button', { name: /Avanti/ }));
    await answer(user, /Tecnica/);
    await waitFor(() => expect(storedPrefs()).toMatchObject({ profile: 'gestore_verde', mode: 'tecnica', decision: 'scegliere_intervento' }));
  });

  it('nuovo progetto: crea il progetto e apre la pagina dell’area', async () => {
    const user = userEvent.setup();
    renderApp(<OnboardingPage />, { route: '/benvenuto', path: '/benvenuto' });
    await answer(user, /Tecnico comunale/);
    await answer(user, null);
    await answer(user, /Scegliere tra due/);
    await user.click(screen.getByRole('radio', { name: /Un mio nuovo progetto/ }));
    await user.type(screen.getByLabelText('Nome del progetto'), 'Piazza del mercato');
    await answer(user, null);
    await answer(user, null);
    await answer(user, /Guidata/);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/^\/progetti\/[^/]+\/area$/));
  });
});

describe('Il profilo non aumenta i permessi', () => {
  it('con ruolo "lettura": niente nuovo progetto, il ruolo resta "lettura" dopo aver scelto "Revisore"', async () => {
    const user = userEvent.setup();
    const urban = seedCampobasso(new Date('2026-10-24T08:00:00Z'));
    const auth = fakeAuth({ session: fakeSession(), memberships: [member('viewer')], current: member('viewer') });
    function Probe() {
      const p = usePermissions();
      return <p data-testid="perms">{`${p.role}:${p.canEdit}`}</p>;
    }
    renderApp(
      <>
        <OnboardingPage />
        <Probe />
      </>,
      { auth, repo: remoteRepo([urban]), route: '/benvenuto', path: '/benvenuto' },
    );
    expect(screen.getByText(/il tuo ruolo è:/)).toHaveTextContent('lettura');
    await answer(user, /Revisore/);
    expect(screen.getByTestId('perms')).toHaveTextContent('viewer:false');
    await answer(user, /Città/);
    await answer(user, /Preparare una proposta/);
    expect(screen.queryByRole('radio', { name: /Un mio nuovo progetto/ })).toBeNull();
    expect(screen.getByText(/non crearne di nuovi/)).toBeInTheDocument();
    await answer(user, /Area dimostrativa/);
    await answer(user, null);
    await answer(user, /Guidata/);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toMatch(/\/urbano$/));
  });
});

describe('Persistenza su Supabase e cambio di organizzazione', () => {
  it('per l’utente autenticato le preferenze vanno su user_preferences (propria riga, senza ruoli)', async () => {
    const user = userEvent.setup();
    const sb = fakeSupabase({ docs: { [ORG_A]: [] }, prefs: {} });
    const session = fakeSession('00000000-0000-4000-8000-0000000000u7');
    const auth = fakeAuth({ client: sb.client, session, memberships: [member('editor')], current: member('editor') });
    renderApp(<OnboardingPage />, { auth, repo: remoteRepo([seedVineyard(new Date(), '2026-08-20')]), route: '/benvenuto', path: '/benvenuto' });
    await answer(user, /Agronomo/);
    await answer(user, null);
    await answer(user, /Registrare cosa vedo/);
    await answer(user, /Vigneto dimostrativo/);
    await answer(user, null);
    await answer(user, /Tecnica/);
    await waitFor(() => expect(sb.calls.some((c) => c.op === 'upsert')).toBe(true));
    const up = sb.calls.find((c) => c.op === 'upsert')!;
    expect(up.table).toBe('user_preferences');
    expect(up.payload).toMatchObject({ user_id: session.user.id, profile: 'agronomo', sector: 'agriculture', mode: 'tecnica' });
    expect(JSON.stringify(up.payload)).not.toMatch(/"role"|canEdit|organization/);
    expect(localStorage.getItem(LOCAL_KEY)).toBeNull();
  });

  it('le preferenze dell’account vengono rilette al rientro', async () => {
    const saved = finalizeOnboarding(
      { profile: 'agronomo', sector: 'agriculture', decision: 'valutare_irrigazione', area: { kind: 'demo' }, data: [], mode: 'tecnica' },
      new Date(),
    );
    const session = fakeSession('00000000-0000-4000-8000-0000000000u8');
    const sb = fakeSupabase({ docs: {}, prefs: { [session.user.id]: { ...saved, role: 'admin' } } });
    function Show() {
      const { preferences, where } = usePreferences();
      return <p data-testid="p">{preferences ? `${where}:${preferences.profile}:${'role' in preferences}` : 'none'}</p>;
    }
    render(
      <AuthContext.Provider value={fakeAuth({ client: sb.client, session })}>
        <PreferencesProvider>
          <Show />
        </PreferencesProvider>
      </AuthContext.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId('p')).toHaveTextContent('account:agronomo:false'));
  });

  it('cambiando organizzazione cambiano archivio, progetti e permessi', async () => {
    const sb = fakeSupabase({
      docs: { [ORG_A]: [seedCampobasso(new Date())], [ORG_B]: [seedVineyard(new Date(), '2026-08-20')] },
      prefs: {},
    });
    const session = fakeSession();
    const memberships = [member('viewer', ORG_A, 'Comune A'), member('admin', ORG_B, 'Azienda B')];
    function Probe() {
      const { kind, projects } = useStore();
      const p = usePermissions();
      return <p data-testid="ctx">{`${kind}|${p.role}|${p.canEdit}|${projects.map((x) => x.project.sector).join(',')}`}</p>;
    }
    const tree = (current: (typeof memberships)[number] | null) => (
      <AuthContext.Provider value={fakeAuth({ client: sb.client, session, memberships, current })}>
        <PreferencesProvider>
          <DataScope>
            <Probe />
          </DataScope>
        </PreferencesProvider>
      </AuthContext.Provider>
    );
    const view = render(tree(memberships[0]!));
    await waitFor(() => expect(screen.getByTestId('ctx')).toHaveTextContent('supabase|viewer|false|urban'));
    act(() => view.rerender(tree(memberships[1]!)));
    await waitFor(() => expect(screen.getByTestId('ctx')).toHaveTextContent('supabase|admin|true|agriculture'));
    act(() => view.rerender(tree(null)));
    await waitFor(() => expect(screen.getByTestId('ctx').textContent).toMatch(/^local\|null\|true\|/));
  });
});
