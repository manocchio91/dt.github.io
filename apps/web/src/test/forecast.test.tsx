import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { finalizeOnboarding, QUANTILE_LEVELS, seedCampobasso, seedVineyard, TIMESTRAL_MODELS, type ProjectBundle } from '@mdt/domain';
import ForecastPage from '../pages/ForecastPage';
import { fakeAuth, fakeSession, localRepo, member, remoteRepo, renderApp } from './utils';
import type { Repository } from '../state/repository';
import { clearForecastCache } from '../state/forecast';

let urban: ProjectBundle;
let agri: ProjectBundle;

beforeEach(() => {
  localStorage.clear();
  clearForecastCache();
  urban = seedCampobasso(new Date('2026-10-24T08:00:00Z'));
  agri = seedVineyard(new Date('2026-08-20T08:00:00Z'), '2026-08-20');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Preferenze salvate con la modalità tecnica: tutti i dettagli aperti. */
function setTechnicalMode() {
  const p = finalizeOnboarding({ profile: 'tecnico_comunale', sector: 'urban', decision: 'ridurre_calore', area: { kind: 'demo' }, data: [], mode: 'tecnica' }, new Date());
  localStorage.setItem('mdt:onboarding:v1', JSON.stringify(p));
}

const open = (b: ProjectBundle, repo: Repository = localRepo([b]), auth = fakeAuth()) =>
  renderApp(<ForecastPage />, { repo, auth, route: `/progetti/${b.project.id}/previsioni`, path: '/progetti/:id/previsioni' });

describe('F31 — Previsioni nel caso urbano (Campobasso)', () => {
  it('mostra baseline, “ora”, banda, soglia e il disclaimer sugli interventi', async () => {
    open(urban);
    const badge = await screen.findByTestId('forecast-badge', {}, { timeout: 10_000 });
    expect(badge.textContent).toMatch(/STIMATO DA MODELLO — previsione di base/);
    expect(badge.textContent).not.toMatch(/Timestral/);
    // il nome del modello resta nell'approfondimento tecnico
    expect(within(screen.getByTestId('forecast-technical')).getAllByText(/Persistenza stagionale/).length).toBeGreaterThan(0);
    expect(screen.getByText(/non stima l’effetto di alberi/)).toBeTruthy();
    expect(screen.getByText(/ora: emissione della previsione/)).toBeTruthy();
    expect(screen.getAllByText(/intervallo 80% \(q0,10–q0,90\)/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/affidabilità 9\d ?%/i)).toBeNull();
    // tabella alternativa: una riga per ora prevista
    const table = within(screen.getByText('Valori previsti ora per ora').closest('table')!);
    expect(table.getAllByRole('row')).toHaveLength(25);
  });

  it('banda selezionabile e confronto ex-post con l’osservazione successiva', async () => {
    open(urban);
    await screen.findByTestId('forecast-badge', {}, { timeout: 10_000 });
    fireEvent.change(screen.getByLabelText('Intervallo mostrato'), { target: { value: '98' } });
    expect(screen.getAllByText(/intervallo 98%/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText(/Mostra l’osservazione successiva/));
    const ex = await screen.findByTestId('expost-now');
    expect(ex.textContent).toMatch(/Persistenza stagionale.*errore medio su questa emissione/);
    expect(screen.getByText(/osservazione successiva \(rianalisi\)/)).toBeTruthy();
  });

  it('backtest: baseline con metriche, Timestral dichiarato “non eseguito”', async () => {
    open(urban);
    const t = within(await screen.findByTestId('backtest-table'));
    expect(t.getByText('Persistenza stagionale (stessa ora del giorno prima)')).toBeTruthy();
    // Timestral-5M eseguito davvero nel backtest; il 28M dichiarato non avviato (confronto successivo)
    expect(t.getByText('Timestral-5M')).toBeTruthy();
    expect(t.getAllByText(/non eseguito — non avviato: opzione di confronto successiva/)).toHaveLength(1);
  });

  it('grafico navigabile da tastiera con annuncio testuale', async () => {
    open(urban);
    await screen.findByTestId('forecast-badge', {}, { timeout: 10_000 });
    const chart = screen.getByRole('group', { name: /Storico e previsione/ });
    chart.focus();
    fireEvent.keyDown(chart, { key: 'Home' });
    expect(await screen.findByText(/mediana .* intervallo 80% .* da .* a .*probabilità di superare la soglia/)).toBeTruthy();
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(await screen.findByText(/: storico [0-9-]/)).toBeTruthy();
  });

  it('Timestral senza servizio: “Motore Timestral non configurato”, nessun valore sostitutivo', async () => {
    vi.stubEnv('VITE_FORECAST_URL', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    open(urban);
    await screen.findByTestId('forecast-badge', {}, { timeout: 10_000 });
    fireEvent.change(screen.getByLabelText('Modello'), { target: { value: 'mistralai/Timestral-5M' } });
    expect(await screen.findByText('Il modello avanzato non è ancora disponibile.', { selector: 'p.font-bold' })).toBeTruthy();
    expect(screen.getByText('Puoi consultare la previsione di base.')).toBeTruthy();
    expect(screen.getByText('Motore Timestral non configurato', { selector: 'details p' })).toBeTruthy();
    expect(screen.queryByTestId('forecast-badge')).toBeNull();
    expect(screen.queryByText('Valori previsti ora per ora')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    // un clic riporta alla previsione di base, dichiarata come tale
    fireEvent.click(screen.getByRole('button', { name: 'Mostra la previsione di base' }));
    expect((await screen.findByTestId('forecast-badge')).textContent).toMatch(/previsione di base/);
  });

  it('Timestral con servizio configurato: badge con versione e token di sessione, mai la chiave di servizio', async () => {
    vi.stubEnv('VITE_FORECAST_URL', 'https://proxy.example/forecast');
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { prediction_length: number };
      const q = Array.from({ length: body.prediction_length }, () => QUANTILE_LEVELS.map((l) => 25 + (l - 0.5) * 4));
      return { ok: true, status: 200, json: async () => ({ schema_version: 1, model: 'mistralai/Timestral-5M', revision: TIMESTRAL_MODELS['mistralai/Timestral-5M'].revision, quantile_levels: QUANTILE_LEVELS, quantiles: [[q]], median: [[q.map((r) => r[10])]], inference_ms: 40, warnings: [] }) } as Response;
    });
    vi.stubGlobal('fetch', fetchSpy);
    const session = { ...fakeSession(), access_token: 'jwt-di-sessione' } as ReturnType<typeof fakeSession>;
    setTechnicalMode();
    open(urban, remoteRepo([urban]), fakeAuth({ session, memberships: [member('editor')], current: member('editor') }));
    await screen.findByTestId('forecast-badge', {}, { timeout: 10_000 });
    fireEvent.change(screen.getByLabelText('Modello'), { target: { value: 'mistralai/Timestral-5M' } });
    await waitFor(() => expect(screen.getByTestId('forecast-badge').textContent).toMatch(/STIMATO DA MODELLO — Timestral-5M \[bdd20cf\]/));
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://proxy.example/forecast/v1/forecast');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer jwt-di-sessione');
    // il proxy riceve progetto, contesto e variabile; nessun limite fisico deciso dal browser
    const sent = JSON.parse(init.body as string) as { mdt: { project_id: string; context: string; variables: { name: string }[] }; physical_bounds?: unknown };
    expect(sent.mdt).toMatchObject({ project_id: urban.project.id, context: 'urbano', variables: [{ name: 'temperatura_aria' }] });
    expect(sent.physical_bounds).toBeUndefined();
  });

  describe('Timestral reale tramite proxy: badge, vincolo fisico dell’umidità, ripiego', () => {
    const editor = () => fakeAuth({ session: { ...fakeSession(), access_token: 'jwt' } as ReturnType<typeof fakeSession>, memberships: [member('editor')], current: member('editor') });
    const constraint = (applied: boolean) => ({ physical_constraint_applied: applied, physical_min: 0, physical_max: 100, adjusted_values_count: applied ? 7 : 0, total_values: 504, maximum_raw_value: applied ? 112.4 : 96.1, minimum_raw_value: 30.2, method: 'physical_clipping_v1', adapter_version: 'mdt-forecasting 0.2.0' });
    const proxy = (opts: { center?: number; constraints?: unknown[] | null; status?: number } = {}) =>
      vi.fn(async (_url: string, init: RequestInit) => {
        if (opts.status) return { ok: false, status: opts.status, json: async () => ({ detail: 'Il modello avanzato non è disponibile. Puoi continuare con la previsione di base.' }) } as Response;
        const body = JSON.parse(init.body as string) as { prediction_length: number };
        const q = Array.from({ length: body.prediction_length }, () => QUANTILE_LEVELS.map((l) => (opts.center ?? 25) + (l - 0.5) * 8));
        return { ok: true, status: 200, json: async () => ({ schema_version: 1, model: 'mistralai/Timestral-5M', revision: TIMESTRAL_MODELS['mistralai/Timestral-5M'].revision, quantile_levels: QUANTILE_LEVELS, quantiles: [[q]], median: [[q.map((r) => r[10])]], inference_ms: 40, warnings: [], adapter_version: 'mdt-forecasting 0.2.0', ...(opts.constraints ? { constraints: opts.constraints } : {}), run_id: 'run-1' }) } as Response;
      });
    const chooseHumidityAndAdvanced = async () => {
      await screen.findByTestId('forecast-badge', {}, { timeout: 10_000 });
      fireEvent.change(screen.getByLabelText('Grandezza'), { target: { value: 'umidita_relativa' } });
      fireEvent.change(screen.getByLabelText('Modello'), { target: { value: 'mistralai/Timestral-5M' } });
    };

    it('guidata: badge “STIMATO DA MODELLO — Timestral-5M”, nota breve se il vincolo è applicato, nessun dettaglio tecnico in primo piano', async () => {
      vi.stubEnv('VITE_FORECAST_URL', 'https://proxy.example/forecast');
      vi.stubGlobal('fetch', proxy({ center: 92, constraints: [constraint(true)] }));
      open(urban, remoteRepo([urban]), editor());
      await chooseHumidityAndAdvanced();
      await waitFor(() => expect(screen.getByTestId('forecast-badge').textContent).toMatch(/^.?STIMATO DA MODELLO — Timestral-5M:/));
      expect(screen.getByTestId('forecast-constraint-note').textContent).toBe('L’intervallo è stato riportato entro i limiti fisici dell’umidità, da 0% a 100%.');
      expect(screen.getByTestId('forecast-technical')).not.toHaveAttribute('open');
      expect(screen.getByTestId('forecast-constraint-tech')).not.toBeVisible();
    });

    it('tecnica: nell’approfondimento vincolo applicato, valori corretti, massimo grezzo, metodo e avviso di calibrazione', async () => {
      vi.stubEnv('VITE_FORECAST_URL', 'https://proxy.example/forecast');
      vi.stubGlobal('fetch', proxy({ center: 92, constraints: [constraint(true)] }));
      setTechnicalMode();
      open(urban, remoteRepo([urban]), editor());
      await chooseHumidityAndAdvanced();
      const tech = await screen.findByTestId('forecast-constraint-tech');
      expect(tech.textContent).toMatch(/Applicato: 7 valori su 504 riportati entro 0–100/);
      expect(tech.textContent).toMatch(/massimo grezzo 112(,4)?\s?%/);
      expect(tech.textContent).toMatch(/physical_clipping_v1 \(mdt-forecasting 0\.2\.0\)/);
      expect(tech.textContent).toMatch(/può modificare la calibrazione probabilistica/);
    });

    it('vincolo non necessario: nessuna nota nella guidata', async () => {
      vi.stubEnv('VITE_FORECAST_URL', 'https://proxy.example/forecast');
      vi.stubGlobal('fetch', proxy({ center: 60, constraints: [constraint(false)] }));
      open(urban, remoteRepo([urban]), editor());
      await chooseHumidityAndAdvanced();
      await waitFor(() => expect(screen.getByTestId('forecast-badge').textContent).toMatch(/Timestral-5M/));
      expect(screen.queryByTestId('forecast-constraint-note')).toBeNull();
    });

    it('nessun dato non plausibile mostrato: umidità oltre 100% nella risposta → risultato scartato', async () => {
      vi.stubEnv('VITE_FORECAST_URL', 'https://proxy.example/forecast');
      vi.stubGlobal('fetch', proxy({ center: 99, constraints: null }));
      open(urban, remoteRepo([urban]), editor());
      await chooseHumidityAndAdvanced();
      expect(await screen.findByText('Previsione non disponibile in questo momento', {}, { timeout: 10_000 })).toBeTruthy();
      expect(screen.queryByTestId('forecast-badge')).toBeNull();
    });

    it('badge Timestral solo per esecuzioni reali: la previsione di base resta “previsione di base”', async () => {
      vi.stubEnv('VITE_FORECAST_URL', 'https://proxy.example/forecast');
      const spy = proxy();
      vi.stubGlobal('fetch', spy);
      open(urban, remoteRepo([urban]), editor());
      const badge = await screen.findByTestId('forecast-badge', {}, { timeout: 10_000 });
      expect(badge.textContent).toMatch(/previsione di base/);
      expect(badge.textContent).not.toMatch(/Timestral/);
      expect(spy).not.toHaveBeenCalled();
    });

    it('servizio configurato ma spento: messaggio semplice e ripiego sulla previsione di base', async () => {
      vi.stubEnv('VITE_FORECAST_URL', 'https://proxy.example/forecast');
      vi.stubGlobal('fetch', proxy({ status: 503 }));
      open(urban, remoteRepo([urban]), editor());
      await chooseHumidityAndAdvanced();
      expect(await screen.findByText('Il modello avanzato non è disponibile.', { selector: 'p.font-bold' })).toBeTruthy();
      expect(screen.getByText('Puoi continuare con la previsione di base.')).toBeTruthy();
      expect(screen.queryByTestId('forecast-badge')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Mostra la previsione di base' }));
      expect((await screen.findByTestId('forecast-badge')).textContent).toMatch(/previsione di base/);
    });

    it('ospite (progetto solo nel browser): il modello avanzato non chiama il proxy', async () => {
      vi.stubEnv('VITE_FORECAST_URL', 'https://proxy.example/forecast');
      const spy = proxy();
      vi.stubGlobal('fetch', spy);
      open(urban);
      await chooseHumidityAndAdvanced();
      expect(await screen.findByText('Il modello avanzato non è ancora disponibile.', { selector: 'p.font-bold' })).toBeTruthy();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it('registra la previsione nel progetto (dossier) e poi aggiunge il confronto ex-post', async () => {
    const repo = localRepo([urban]);
    open(urban, repo);
    await screen.findByTestId('forecast-badge', {}, { timeout: 10_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Registra questa previsione nel progetto' }));
    expect(await screen.findByText(/compare nell’export del dossier/)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Confronta con l’osservazione successiva' }));
    expect(await screen.findByText(/Confronto ex-post: errore medio/)).toBeTruthy();
    const saved = (await repo.get(urban.project.id))!;
    expect(saved.forecasts).toHaveLength(1);
    expect(saved.forecasts![0]).toMatchObject({ context: 'urbano', variable: 'temperatura_aria', dataClass: 'STIMATO_DA_MODELLO', horizon: 24 });
    expect(saved.forecasts![0]!.expost!.points).toBe(24);
    expect(saved.forecasts![0]!.lineage.source).toMatch(/Open-Meteo/);
    expect(saved.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['previsione', 'verifica previsione']));
  });

  it('il ruolo “lettura” consulta ma non registra', async () => {
    const auth = fakeAuth({ session: fakeSession(), memberships: [member('viewer')], current: member('viewer') });
    open(urban, remoteRepo([urban]), auth);
    await screen.findByTestId('forecast-badge', {}, { timeout: 10_000 });
    expect(screen.queryByRole('button', { name: /Registra/ })).toBeNull();
    expect(screen.getByText(/riservata a chi modifica il progetto/)).toBeTruthy();
  });
});

describe('F31 — Previsioni nel caso vigneto', () => {
  it('testo obbligatorio, orizzonte 72 h e zone segnalate dalle soglie dell’agronomo', async () => {
    open(agri);
    await screen.findByTestId('forecast-badge', {}, { timeout: 10_000 });
    expect(screen.getByText('Previsione prodotta da un modello e non misurazione sul terreno. Verificare in campo e confrontarsi con un agronomo prima di intervenire.')).toBeTruthy();
    expect((screen.getByLabelText('Orizzonte') as HTMLSelectElement).value).toBe('72');
    const zt = within(await screen.findByTestId('zone-table'));
    expect(zt.getAllByRole('row')).toHaveLength(1 + agri.agri!.zones.length);
    expect(zt.getByText('0,16')).toBeTruthy(); // 0,12 + 0,3 × (0,25 − 0,12)
    expect(screen.getByText(/una cella di rianalisi\): le zone cambiano solo per la soglia/)).toBeTruthy();
  });
});

describe('Previsioni — modalità guidata (Audit Anno Luce)', () => {
  it('in primo piano: cosa, quando, valore centrale, fascia, probabilità, fonte, verifica; niente quantili, WQL, MASE, hash', async () => {
    open(urban);
    const s = within(await screen.findByTestId('forecast-summary', {}, { timeout: 10_000 }));
    for (const t of ['Che cosa potrebbe accadere', 'Quando', 'Valore centrale stimato', 'Fascia di possibile variazione', 'Probabilità di superare la soglia', 'Fonte della previsione']) expect(s.getByText(t)).toBeTruthy();
    expect(s.getByText(/8 casi su 10/)).toBeTruthy();
    expect(s.getByText(/Verifica consigliata:/)).toBeTruthy();
    expect(screen.getByTestId('forecast-summary').textContent).not.toMatch(/q0,|quantil|WQL|MASE|MAE|Timestral|hash/i);
    const tech = screen.getByTestId('forecast-technical') as HTMLDetailsElement;
    expect(tech.open).toBe(false);
    // tutto resta disponibile nell'approfondimento tecnico
    for (const t of ['WQL', 'Impronta dell’input', 'Intervallo mostrato']) expect(within(tech).getAllByText(t).length).toBeGreaterThan(0);
  });

  it('modello: due scelte in parole semplici; Timestral non risulta mai attivo senza servizio', async () => {
    vi.stubEnv('VITE_FORECAST_URL', '');
    open(urban);
    await screen.findByTestId('forecast-badge', {}, { timeout: 10_000 });
    const options = [...(screen.getByLabelText('Modello') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual(['Previsione di base', 'Modello avanzato (Beta)']);
    fireEvent.change(screen.getByLabelText('Modello'), { target: { value: 'mistralai/Timestral-5M' } });
    expect(await screen.findByText('Il modello avanzato non è ancora disponibile.')).toBeTruthy();
    expect(screen.queryByTestId('forecast-summary')).toBeNull();
    expect(screen.getByText(/Beta da validare — Motore Timestral non configurato/)).toBeTruthy(); // solo nei dettagli tecnici
  });

  it('agricolo: verifica consigliata in campo o con l’agronomo, mai un intervento automatico', async () => {
    open(agri);
    const s = await screen.findByTestId('forecast-summary', {}, { timeout: 10_000 });
    expect(s.textContent).toMatch(/campo|agronomo|zone da controllare/);
    expect(s.textContent).not.toMatch(/irriga|tratta|automatic/i);
    // la fascia di variazione dell'umidità del suolo non mostra due estremi uguali per arrotondamento
    const [, lo, hi] = s.textContent!.match(/tra ([\d,]+) e ([\d,]+) m³\/m³/)!;
    expect(lo).not.toBe(hi);
  });
});

describe('Modello avanzato sullo storico Open-Meteo salvato su Supabase', () => {
  const LOC = '00000000-0000-4000-8000-0000000c0c01';
  /** Doppio minimo di supabase-js per località, stato dello storico, storico e previsione Open-Meteo. */
  function weatherClient(hours: number, livello = hours >= 168 ? 'disponibile' : hours >= 72 ? 'consolidamento' : 'insufficiente') {
    const H = 3_600_000;
    const last = Math.floor(Date.now() / H) * H - H;
    const obs = ['temperature_2m', 'relative_humidity_2m'].flatMap((variable) =>
      Array.from({ length: hours }, (_, i) => ({ observed_at: new Date(last - (hours - 1 - i) * H).toISOString(), variable, value: variable === 'temperature_2m' ? 15 + (i % 24) / 3 : 70, unit: variable === 'temperature_2m' ? '°C' : '%', source: 'open_meteo' })),
    );
    const issued = new Date(last + H).toISOString();
    const points = Array.from({ length: 100 }, (_, i) => ({ fetch_run_id: 'run-1', issued_at: issued, valid_at: new Date(last + (i + 1) * H).toISOString(), temperature_2m: 18, relative_humidity_2m: 65, unit_metadata: { temperature_2m: '°C' } }));
    const tables: Record<string, Record<string, unknown>[]> = {
      weather_locations: [{ id: LOC, project_id: urban.project.id, organization_id: 'org', active: true, created_at: issued }],
      weather_observations: obs.map((o) => ({ ...o, location_id: LOC })),
      weather_fetch_runs: [{ id: 'run-1', location_id: LOC, status: 'completata', issued_at: issued }],
      weather_forecast_points: points,
    };
    const calls: string[] = [];
    const from = (table: string) => {
      const filters: [string, unknown, 'eq' | 'gte'][] = [];
      let one = false;
      const q = {
        select: () => q,
        maybeSingle: () => ((one = true), q),
        eq: (c: string, v: unknown) => (filters.push([c, v, 'eq']), q),
        gte: (c: string, v: unknown) => (filters.push([c, v, 'gte']), q),
        order: () => q,
        limit: () => q,
        then(ok: (r: { data: unknown; error: null }) => unknown) {
          calls.push(table);
          const rows = (tables[table] ?? []).filter((r) => filters.every(([c, v, op]) => (op === 'eq' ? r[c] === v : String(r[c]) >= String(v))));
          return Promise.resolve({ data: one ? (rows[0] ?? null) : rows, error: null }).then(ok);
        },
      };
      return q;
    };
    const status = { stato: hours >= 72 ? 'sufficiente' : 'incompleto', livello, ore_obiettivo: 168, ore_finestra: Math.min(hours, 168), ore_continue: hours, sufficiente_timestral: hours >= 72, buchi: [], variabili: [], ore_per_variabile: {}, variabili_richieste_mancanti: [] };
    const client = { from, rpc: async () => ({ data: status, error: null }), functions: { invoke: async () => ({ data: null, error: null }) } };
    return { client: client as unknown as NonNullable<ReturnType<typeof fakeAuth>['client']>, calls };
  }
  const proxyOk = () =>
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { prediction_length: number };
      const q = Array.from({ length: body.prediction_length }, () => QUANTILE_LEVELS.map((l) => 20 + (l - 0.5) * 4));
      return { ok: true, status: 200, json: async () => ({ schema_version: 1, model: 'mistralai/Timestral-5M', revision: TIMESTRAL_MODELS['mistralai/Timestral-5M'].revision, quantile_levels: QUANTILE_LEVELS, quantiles: [[q]], median: [[q.map((r) => r[10])]], inference_ms: 30, warnings: [], run_id: 'run-t' }) } as Response;
    });
  const editorWith = (client: unknown) => fakeAuth({ client: client as never, session: { ...fakeSession(), access_token: 'jwt' } as ReturnType<typeof fakeSession>, memberships: [member('editor')], current: member('editor') });

  it('storico di 7 giorni: il contesto arriva da Supabase (ore, località, provenienza), nessuna richiesta a Open-Meteo', async () => {
    vi.stubEnv('VITE_FORECAST_URL', 'https://proxy.example/forecast');
    const spy = proxyOk();
    vi.stubGlobal('fetch', spy);
    const w = weatherClient(168);
    open(urban, remoteRepo([urban]), editorWith(w.client));
    await screen.findByTestId('forecast-badge', {}, { timeout: 10_000 });
    fireEvent.change(screen.getByLabelText('Modello'), { target: { value: 'mistralai/Timestral-5M' } });
    await waitFor(() => expect(screen.getByTestId('forecast-badge').textContent).toMatch(/Timestral-5M/));
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).not.toMatch(/open-meteo/);
    const sent = JSON.parse(init.body as string) as { context: number[][][]; mdt: { location_id: string; lineage: { source: string; period: { to: string } } } };
    expect(sent.context[0]![0]).toHaveLength(168);
    expect(sent.mdt.location_id).toBe(LOC);
    expect(sent.mdt.lineage.source).toMatch(/storico salvato su Supabase/);
    expect(w.calls).toEqual(expect.arrayContaining(['weather_locations', 'weather_observations', 'weather_forecast_points']));
    expect(screen.getByTestId('forecast-summary').textContent).toMatch(/dati storici Open-Meteo salvati per quest’area/);
  });

  it('storico sotto le 72 ore: il modello avanzato non parte e lo dice in parole semplici', async () => {
    vi.stubEnv('VITE_FORECAST_URL', 'https://proxy.example/forecast');
    const spy = proxyOk();
    vi.stubGlobal('fetch', spy);
    open(urban, remoteRepo([urban]), editorWith(weatherClient(40).client));
    await screen.findByTestId('forecast-badge', {}, { timeout: 10_000 });
    fireEvent.change(screen.getByLabelText('Modello'), { target: { value: 'mistralai/Timestral-5M' } });
    expect(await screen.findByText('Storico non ancora sufficiente per il modello avanzato.', { selector: 'p.font-bold' })).toBeTruthy();
    expect(screen.getByText('Puoi continuare con la previsione di base.')).toBeTruthy();
    expect(screen.getByTestId('forecast-history-short').textContent).toMatch(/40 ore valide su 168/);
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('forecast-badge')).toBeNull();
  });
});
