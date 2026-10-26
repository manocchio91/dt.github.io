import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { issuedHour, parseForecastResponse, seedCampobasso, seedVineyard, splitAtIssue, toPointRows, type ProjectBundle } from '@mdt/domain';
import urbanFixture from '../../../../packages/domain/src/connectors/fixtures/open-meteo-forecast-urban.json' with { type: 'json' };
import agriFixture from '../../../../packages/domain/src/connectors/fixtures/open-meteo-forecast-agricultural.json' with { type: 'json' };
import { MODELLED_NOTICE, WeatherPanel } from '../components/WeatherPanel';
import { fakeAuth, fakeSession, localRepo, member, ORG_A, remoteRepo, renderApp } from './utils';

const NOW = new Date('2026-10-24T15:20:00Z');
const ISSUED = issuedHour(NOW);

interface Tables {
  weather_locations: Record<string, unknown>[];
  weather_fetch_runs: Record<string, unknown>[];
  weather_forecast_points: Record<string, unknown>[];
  weather_observations: Record<string, unknown>[];
  /** risposta di weather_history_status per località (assente = funzione non disponibile) */
  history?: Record<string, unknown>;
}

function pointsFrom(fixture: unknown, scope: 'urban' | 'agricultural', runId: string) {
  const p = parseForecastResponse(fixture, scope);
  return toPointRows(splitAtIssue(p, ISSUED).forecast).map((r) => ({ ...r, fetch_run_id: runId, issued_at: ISSUED, model: 'best_match', unit_metadata: p.units, source: 'open_meteo' }));
}

function run(id: string, locId: string, over: Record<string, unknown> = {}) {
  return { id, location_id: locId, status: 'completata', trigger: 'pianificata', requested_at: '2026-10-24T15:07:00Z', completed_at: '2026-10-24T15:07:03Z', model_requested: 'best_match', model_returned: null, response_grid_latitude: 41.586098, response_grid_longitude: 14.661439, response_elevation: 700, issued_at: ISSUED, valid_from: ISSUED, valid_to: '2026-10-27T21:00:00Z', points_count: 79, error_code: null, error_message: null, ...over };
}

/** Doppio minimo di supabase-js: filtri eq/gte, ordinamento ignorato, functions.invoke simulato. */
function fakeClient(t: Tables, invoke: (body: { location_id: string }) => { data: unknown; error: unknown } = () => ({ data: { status: 'completata', points: 79 }, error: null })) {
  const calls = { invoke: [] as unknown[], inserts: [] as unknown[], fail: null as Error | null };
  const from = (table: Exclude<keyof Tables, 'history'>) => {
    const filters: [string, unknown][] = [];
    let one = false;
    let payload: Record<string, unknown> | null = null;
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push([c, v]), q),
      gte: () => q,
      order: () => q,
      limit: () => q,
      single: () => ((one = true), q),
      maybeSingle: () => ((one = true), q),
      insert: (v: Record<string, unknown>) => ((payload = v), q),
      then(ok: (r: { data: unknown; error: unknown }) => unknown, ko?: (e: unknown) => unknown) {
        if (calls.fail) return Promise.reject(calls.fail).then(ok, ko);
        if (payload) {
          const row = { id: `new-${t[table].length}`, active: true, ...payload };
          t[table].push(row);
          calls.inserts.push({ table, row });
          return Promise.resolve({ data: row, error: null }).then(ok);
        }
        let rows = (t[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
        if (table === 'weather_fetch_runs') rows = [...rows].sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at)));
        return Promise.resolve({ data: one ? (rows[0] ?? null) : rows, error: null }).then(ok);
      },
    };
    return q;
  };
  const client = {
    from,
    rpc: async (fn: string, args: { p_location: string }) =>
      fn === 'weather_history_status' && t.history?.[args.p_location] ? { data: t.history[args.p_location], error: null } : { data: null, error: { message: 'non disponibile' } },
    functions: {
      invoke: async (_name: string, { body }: { body: { location_id: string } }) => {
        calls.invoke.push(body);
        return invoke(body);
      },
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

let urban: ProjectBundle;
let agri: ProjectBundle;
let tables: Tables;

beforeEach(() => {
  localStorage.clear();
  urban = seedCampobasso(new Date('2026-10-24T08:00:00Z'));
  agri = seedVineyard(new Date('2026-08-20T08:00:00Z'), '2026-08-20');
  tables = {
    weather_locations: [
      { id: 'loc-u', organization_id: ORG_A, project_id: urban.project.id, name: 'Piazza', scope: 'urban', latitude: 41.5606, longitude: 14.663, elevation: null, active: true },
      { id: 'loc-a', organization_id: ORG_A, project_id: agri.project.id, name: 'Vigneto', scope: 'agricultural', latitude: 41.8, longitude: 14.92, elevation: null, active: true },
    ],
    weather_fetch_runs: [run('run-u', 'loc-u'), run('run-a', 'loc-a', { response_grid_latitude: 41.80364, response_grid_longitude: 14.905517, response_elevation: 427 })],
    weather_forecast_points: [...pointsFrom(urbanFixture, 'urban', 'run-u'), ...pointsFrom(agriFixture, 'agricultural', 'run-a')],
    weather_observations: [{ location_id: 'loc-u', observed_at: '2026-10-24T14:00:00Z', variable: 'temperature_2m', value: 17.2, unit: '°C', source: 'sensore', quality_flag: 'valido' }],
  };
});

function open(b: ProjectBundle, role: 'editor' | 'viewer' = 'editor', client?: SupabaseClient) {
  const c = client ?? fakeClient(tables).client;
  const auth = fakeAuth({ client: c, session: fakeSession(), memberships: [member(role)], current: member(role) });
  return renderApp(<WeatherPanel bundle={b} now={() => NOW} />, { auth, repo: remoteRepo([b]), route: '/', path: '/' });
}

describe('Pannello “Dati meteorologici”', () => {
  it('senza archivio Supabase: nessuna acquisizione dal browser, stato dichiarato', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderApp(<WeatherPanel bundle={urban} />, { repo: localRepo([urban]) });
    expect(await screen.findByText('Dati meteo non ancora collegati.')).toBeTruthy();
    expect(screen.getByText('Puoi continuare usando la modalità dimostrativa.')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('urbano: fonte, modello, cella, timestamp, avviso di dato modellato, valori attuali e 24 ore', async () => {
    open(urban);
    const meta = within(await screen.findByTestId('weather-meta'));
    expect(meta.getByText('Open-Meteo Forecast API')).toBeTruthy();
    expect(meta.getByText(/best_match \(modello effettivo non dichiarato dalla risposta\)/)).toBeTruthy();
    expect(meta.getByText(/41,5861|41\.5861/)).toBeTruthy();
    expect(screen.getByText(MODELLED_NOTICE)).toBeTruthy();
    expect(MODELLED_NOTICE).toBe('Dato territoriale modellato, non rilevato da sensore locale.');
    const now = within(screen.getByTestId('weather-now'));
    for (const l of ['Temperatura aria (2 m)', 'Temperatura percepita', 'Umidità relativa', 'Precipitazioni', 'Vento (10 m)', 'Radiazione solare']) expect(now.getByText(l)).toBeTruthy();
    expect(now.queryByText('ET0 (FAO)')).toBeNull();
    const table = screen.getByTestId('weather-hourly');
    expect(within(table).getAllByRole('row')).toHaveLength(25);
    expect(within(table).queryByText(/suolo/)).toBeNull();
  });

  it('etichette di fonte distinte; un dato Open-Meteo non è mai etichettato come Timestral', async () => {
    open(urban);
    await screen.findByTestId('weather-meta');
    const panel = screen.getByTestId('weather-panel');
    expect(panel.querySelector('[data-source=OPEN_METEO]')!.textContent).toMatch(/DATO OPEN-METEO/);
    expect(within(screen.getByTestId('weather-sensors')).getByText(/MISURATO DA SENSORE/)).toBeTruthy();
    const kinds = [...panel.querySelectorAll('[data-source]')].map((e) => e.getAttribute('data-source'));
    expect(new Set(kinds)).toEqual(new Set(['OPEN_METEO', 'SENSORE', 'STIMATO_DA_MODELLO', 'SIMULATO']));
    expect(panel.textContent).not.toMatch(/Timestral/);
  });

  it('agricolo: ET0, VPD, suolo a tutte le profondità e 72 ore predefinite', async () => {
    open(agri);
    const now = within(await screen.findByTestId('weather-now'));
    for (const l of ['ET0 (FAO)', 'VPD', 'T suolo 6 cm', 'Umidità suolo 9–27 cm']) expect(now.getByText(l)).toBeTruthy();
    expect(screen.getByText('Umidità suolo 27–81 cm')).toBeTruthy();
    expect(within(screen.getByTestId('weather-hourly')).getAllByRole('row')).toHaveLength(73);
    expect(screen.getByRole('button', { name: '72 ore' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('orizzonte 24/72 con pulsanti a stato e tabella raggiungibile da tastiera', async () => {
    open(urban);
    await screen.findByTestId('weather-hourly');
    const b72 = screen.getByRole('button', { name: '72 ore' });
    b72.focus();
    expect(document.activeElement).toBe(b72);
    fireEvent.click(b72);
    expect(b72.getAttribute('aria-pressed')).toBe('true');
    expect(within(screen.getByTestId('weather-hourly')).getAllByRole('row')).toHaveLength(73);
    expect(screen.getByRole('region', { name: 'Tabella oraria delle prossime 72 ore' }).tabIndex).toBe(0);
  });

  it('dato non aggiornato (emissione oltre 6 ore) e ultimo tentativo fallito: dichiarati, ultimi dati validi visibili', async () => {
    tables.weather_fetch_runs = [
      run('run-fail', 'loc-u', { status: 'errore', requested_at: '2026-10-24T15:07:00Z', error_code: 'TIMEOUT', issued_at: null }),
      run('run-u', 'loc-u', { requested_at: '2026-10-24T06:07:00Z', issued_at: '2026-10-24T06:00:00Z' }),
    ];
    tables.weather_forecast_points = tables.weather_forecast_points.map((p) => (p.fetch_run_id === 'run-u' ? { ...p, issued_at: '2026-10-24T06:00:00Z' } : p));
    open(urban);
    expect(await screen.findByText('Dato non aggiornato')).toBeTruthy();
    expect(screen.getByText('Ultimo tentativo non riuscito')).toBeTruthy();
    expect(screen.getByText(/aggiornamento non riuscito\. Mostrati gli ultimi dati validi/)).toBeTruthy();
    expect(screen.queryByText(/TIMEOUT/)).toBeNull(); // il codice tecnico resta alla modalità tecnica
    expect(screen.getByTestId('weather-hourly')).toBeTruthy();
  });

  it('“Aggiorna dati”: chiama la Edge Function, poi limita la frequenza', async () => {
    const f = fakeClient(tables);
    open(urban, 'editor', f.client);
    const btn = await screen.findByRole('button', { name: 'Aggiorna dati' });
    fireEvent.click(btn);
    expect(await screen.findByText('Dati aggiornati: 79 ore di previsione registrate.')).toBeTruthy();
    expect(f.calls.invoke).toEqual([{ location_id: 'loc-u' }]);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Aggiorna dati' }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(/Nuovo aggiornamento manuale dalle/)).toBeTruthy();
  });

  it('limite di frequenza dal server (429) e servizio in errore: messaggi distinti', async () => {
    const ctx = (status: number, error: string) => ({ data: null, error: { message: 'x', context: { status, json: async () => ({ error }) } } });
    const f = fakeClient(tables, () => ctx(429, 'Aggiornamento già richiesto alle 17:12'));
    open(urban, 'editor', f.client);
    fireEvent.click(await screen.findByRole('button', { name: 'Aggiorna dati' }));
    expect(await screen.findByText('Limite di frequenza: Aggiornamento già richiesto alle 17:12')).toBeTruthy();
  });

  it('errore della funzione: dichiarato, ultimi dati validi restano', async () => {
    const f = fakeClient(tables, () => ({ data: null, error: { message: 'x', context: { status: 502, json: async () => ({ error: 'Open-Meteo ha risposto 503' }) } } }));
    open(urban, 'editor', f.client);
    fireEvent.click(await screen.findByRole('button', { name: 'Aggiorna dati' }));
    expect(await screen.findByText('Aggiornamento non riuscito: restano visibili gli ultimi dati validi.')).toBeTruthy();
    expect(screen.queryByText(/Open-Meteo ha risposto 503/)).toBeNull(); // il dettaglio tecnico resta alla modalità tecnica
    expect(screen.getByTestId('weather-hourly')).toBeTruthy();
  });

  it('ruolo lettura: consulta i dati ma non vede “Aggiorna dati”', async () => {
    open(urban, 'viewer');
    await screen.findByTestId('weather-meta');
    expect(screen.queryByRole('button', { name: 'Aggiorna dati' })).toBeNull();
  });

  it('senza rete: ultimi dati scaricati nel browser, dichiarato; aggiornamento non disponibile', async () => {
    const f = fakeClient(tables);
    open(urban, 'editor', f.client);
    await screen.findByTestId('weather-hourly');
    f.calls.fail = new TypeError('Failed to fetch');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
    expect(await screen.findByText('Nessuna connessione')).toBeTruthy();
    expect(screen.getByText('Mostrati gli ultimi dati scaricati in questo browser.')).toBeTruthy();
    expect(screen.getByTestId('weather-hourly')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Aggiorna dati' }) as HTMLButtonElement).disabled).toBe(true);
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  });

  it('progetto senza punto di acquisizione: l’editor lo crea nel baricentro dell’area', async () => {
    tables.weather_locations = [];
    const f = fakeClient(tables);
    open(urban, 'editor', f.client);
    fireEvent.click(await screen.findByRole('button', { name: 'Crea punto di acquisizione nel baricentro dell’area' }));
    await waitFor(() => expect(f.calls.inserts).toHaveLength(1));
    expect((f.calls.inserts[0] as { row: Record<string, unknown> }).row).toMatchObject({ project_id: urban.project.id, scope: 'urban', organization_id: ORG_A });
  });
});

describe('Pannello meteo — modalità guidata e tecnica (Audit Anno Luce)', () => {
  // per l'utente autenticato le preferenze arrivano dalla propria riga di user_preferences
  const setMode = (mode: 'guidata' | 'tecnica') => {
    const preferences = { version: 1, completedAt: NOW.toISOString(), profile: 'tecnico_comunale', sector: 'urban', decision: 'ridurre_calore', area: { kind: 'demo' }, data: [], mode };
    (tables as unknown as Record<string, unknown[]>).user_preferences = [{ user_id: fakeSession().user.id, preferences }];
  };

  it('guidata: sintesi con stato, valore, soglia, aggiornamento, fonte e prossimo passo; dettagli chiusi', async () => {
    setMode('guidata');
    open(urban);
    const summary = within(await screen.findByTestId('weather-summary'));
    expect(summary.getByTestId('weather-level').textContent).toMatch(/Stato: (Regolare|Attenzione|Critico)/);
    expect(summary.getByText(/Temperatura aria \(2 m\) ora/)).toBeTruthy();
    expect(summary.getByText(/sopra 32 °C — dimostrativa, da confermare \(tecnico comunale\)/)).toBeTruthy();
    expect(summary.getByText('Ultimo aggiornamento')).toBeTruthy();
    expect(summary.getByText('Open-Meteo, previsione da modello meteorologico')).toBeTruthy();
    expect(summary.getByText(/Prossimo passo:/)).toBeTruthy();
    expect(screen.getByText(MODELLED_NOTICE)).toBeTruthy();
    expect((screen.getByTestId('weather-source-details') as HTMLDetailsElement).open).toBe(false);
    expect((screen.getByTestId('weather-values-details') as HTMLDetailsElement).open).toBe(false);
    // la sintesi non mostra coordinate della cella né nomi di modello
    expect(screen.getByTestId('weather-summary').textContent).not.toMatch(/41[.,]58|best_match/);
  });

  it('“Dettagli della fonte” si apre su richiesta: Open-Meteo, modello, cella, quota, variabili, unità, limiti, licenza', async () => {
    setMode('guidata');
    open(urban);
    const details = (await screen.findByTestId('weather-source-details')) as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(within(details).getByText('Dettagli della fonte'));
    await waitFor(() => expect(details.open).toBe(true));
    const meta = within(screen.getByTestId('weather-meta'));
    for (const t of ['Fonte', 'Modello', 'Cella del modello', 'Intervallo temporale', 'Variabili e unità', 'Limiti spaziali', 'Licenza e attribuzione']) expect(meta.getByText(t)).toBeTruthy();
    expect(meta.getByText(/quota 700 m/)).toBeTruthy();
    expect(meta.getByText(/CC BY 4\.0/)).toBeTruthy();
  });

  it('tecnica: dettagli della fonte e valori orari già aperti', async () => {
    setMode('tecnica');
    open(urban);
    await waitFor(() => expect((screen.getByTestId('weather-source-details') as HTMLDetailsElement).open).toBe(true));
    expect((screen.getByTestId('weather-values-details') as HTMLDetailsElement).open).toBe(true);
  });

  it('agricolo: sintesi sull’umidità stimata del suolo con soglia dell’agronomo, senza prescrizioni', async () => {
    setMode('guidata');
    open(agri);
    const summary = await screen.findByTestId('weather-summary');
    expect(summary.textContent).toMatch(/Umidità suolo 9–27 cm ora|Temperatura aria \(2 m\) ora/);
    expect(summary.textContent).toMatch(/\(agronomo\)/);
    expect(summary.textContent).not.toMatch(/irriga|tratta/i);
  });
});

describe('Pannello meteo — storico di 7 giorni (stato calcolato dal server)', () => {
  const hist = (over: Record<string, unknown> = {}) => ({
    stato: 'sufficiente', livello: 'disponibile', ore_obiettivo: 168, prima_ora: '2026-10-16T00:00:00+00:00', ultima_ora: '2026-10-24T14:00:00+00:00', ore_finestra: 168, ore_continue: 206, ore_future: 79,
    completezza_pct: 100, sufficiente_timestral: true, aggiornato: true, in_corso: false, buchi: [], variabili: ['temperature_2m', 'relative_humidity_2m'], ore_per_variabile: { temperature_2m: 168, relative_humidity_2m: 168 },
    variabili_richieste_mancanti: [], ultimo_aggiornamento: '2026-10-24T15:07:03Z', ultimo_errore: null, ...over,
  });

  it('storico completo: “Storico disponibile: 7 giorni”, dettagli (ore valide, continuità) solo nella sezione della fonte', async () => {
    tables.history = { 'loc-u': hist() };
    open(urban);
    expect((await screen.findByTestId('weather-history')).textContent).toBe('Storico disponibile: 7 giorni. Il modello avanzato può essere utilizzato.');
    const details = screen.getByTestId('weather-history-details');
    expect(details.closest('details')!.open).toBe(false);
    expect(details.textContent).toContain('168 ore valide su 168 (100%), 206 continue, 79 ore future');
    expect(screen.getByTestId('weather-history').textContent).not.toMatch(/backfill|inferenza|covariat|hash|ore valide/i);
  });

  it('storico in consolidamento: ore disponibili su 168 e lacune dichiarate, senza valori inventati', async () => {
    tables.history = { 'loc-u': hist({ livello: 'consolidamento', ore_finestra: 96, ore_continue: 90, completezza_pct: 57.1, buchi: [{ da: '2026-10-18T00:00:00+00:00', a: '2026-10-18T05:00:00+00:00', ore: 6 }] }) };
    open(urban);
    const t = (await screen.findByTestId('weather-history')).textContent!;
    expect(t.startsWith('Stiamo raccogliendo lo storico necessario. Sono disponibili 96 delle 168 ore previste. Storico ancora in consolidamento')).toBe(true);
    expect(t).toContain('Mancano 6 ore nello storico: non vengono stimate né riempite.');
  });

  it('meno di 72 ore: storico non ancora sufficiente per il modello avanzato', async () => {
    tables.history = { 'loc-u': hist({ livello: 'insufficiente', stato: 'incompleto', ore_finestra: 30, ore_continue: 30 }) };
    open(urban);
    expect((await screen.findByTestId('weather-history')).textContent).toContain('Sono disponibili 30 delle 168 ore previste. Storico non ancora sufficiente per il modello avanzato.');
  });

  it('località appena creata: “Preparazione dei dati meteo” senza pulsanti, poi il pannello si aggiorna da solo', async () => {
    tables.weather_fetch_runs = [];
    tables.history = { 'loc-u': hist({ stato: 'in_preparazione', livello: 'insufficiente', ultima_ora: null, ore_finestra: 0, ore_continue: 0 }) };
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      open(urban);
      expect((await screen.findByTestId('weather-history')).textContent).toMatch(/^Preparazione dei dati meteo/);
      expect(screen.queryByRole('button', { name: 'Riprova aggiornamento' })).toBeNull();
      tables.weather_fetch_runs = [run('run-u', 'loc-u')];
      tables.history = { 'loc-u': hist() };
      await vi.advanceTimersByTimeAsync(5_100);
      await waitFor(() => expect(screen.getByTestId('weather-history').textContent).toMatch(/^Storico disponibile/));
    } finally {
      vi.useRealTimers();
    }
  });

  it('prima acquisizione non riuscita: messaggio semplice e “Riprova aggiornamento” per chi modifica', async () => {
    tables.weather_fetch_runs = [run('run-x', 'loc-u', { status: 'errore', error_code: 'TIMEOUT', issued_at: null })];
    tables.history = { 'loc-u': hist({ stato: 'non_riuscito', livello: 'insufficiente', ultima_ora: null, ore_finestra: 0, ultimo_errore: { codice: 'TIMEOUT', il: '2026-10-24T15:07:00Z' } }) };
    const f = fakeClient(tables);
    open(urban, 'editor', f.client);
    expect((await screen.findByTestId('weather-history')).textContent).toContain('Il progetto è stato salvato, ma i dati meteo non sono ancora disponibili. Riprova più tardi.');
    expect(screen.queryByText(/TIMEOUT/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova aggiornamento' }));
    await waitFor(() => expect(f.calls.invoke).toEqual([{ location_id: 'loc-u' }]));
  });

  it('ruolo lettura: vede lo stato dello storico ma nessun “Riprova aggiornamento”', async () => {
    tables.weather_fetch_runs = [run('run-x', 'loc-u', { status: 'errore', issued_at: null })];
    tables.history = { 'loc-u': hist({ stato: 'non_riuscito', livello: 'insufficiente', ultima_ora: null, ore_finestra: 0 }) };
    open(urban, 'viewer');
    expect((await screen.findByTestId('weather-history')).textContent).toMatch(/dati meteo non sono ancora disponibili/);
    expect(screen.queryByRole('button', { name: 'Riprova aggiornamento' })).toBeNull();
  });

  it('server senza la funzione dello storico: il pannello continua a funzionare', async () => {
    delete tables.history;
    open(urban);
    await screen.findByTestId('weather-summary');
    expect(screen.queryByTestId('weather-history-details')).toBeNull();
    expect(screen.queryByTestId('weather-history')).toBeNull();
  });
});
