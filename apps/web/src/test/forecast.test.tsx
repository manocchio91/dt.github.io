import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QUANTILE_LEVELS, seedCampobasso, seedVineyard, TIMESTRAL_MODELS, type ProjectBundle } from '@mdt/domain';
import ForecastPage from '../pages/ForecastPage';
import { fakeAuth, fakeSession, localRepo, member, remoteRepo, renderApp } from './utils';
import type { Repository } from '../state/repository';

let urban: ProjectBundle;
let agri: ProjectBundle;

beforeEach(() => {
  localStorage.clear();
  urban = seedCampobasso(new Date('2026-10-24T08:00:00Z'));
  agri = seedVineyard(new Date('2026-08-20T08:00:00Z'), '2026-08-20');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const open = (b: ProjectBundle, repo: Repository = localRepo([b]), auth = fakeAuth()) =>
  renderApp(<ForecastPage />, { repo, auth, route: `/progetti/${b.project.id}/previsioni`, path: '/progetti/:id/previsioni' });

describe('F31 — Previsioni nel caso urbano (Campobasso)', () => {
  it('mostra baseline, “ora”, banda, soglia e il disclaimer sugli interventi', async () => {
    open(urban);
    const badge = await screen.findByTestId('forecast-badge');
    expect(badge.textContent).toMatch(/STIMATO DA MODELLO — Persistenza stagionale/);
    expect(badge.textContent).not.toMatch(/Timestral/);
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
    await screen.findByTestId('forecast-badge');
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
    expect(t.getAllByText(/non eseguito — Motore Timestral non configurato/)).toHaveLength(2);
  });

  it('grafico navigabile da tastiera con annuncio testuale', async () => {
    open(urban);
    await screen.findByTestId('forecast-badge');
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
    await screen.findByTestId('forecast-badge');
    fireEvent.change(screen.getByLabelText('Modello'), { target: { value: 'mistralai/Timestral-5M' } });
    expect(await screen.findByText('Motore Timestral non configurato', { selector: 'p.font-bold' })).toBeTruthy();
    expect(screen.queryByTestId('forecast-badge')).toBeNull();
    expect(screen.queryByText('Valori previsti ora per ora')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
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
    open(urban, localRepo([urban]), fakeAuth({ session }));
    await screen.findByTestId('forecast-badge');
    fireEvent.change(screen.getByLabelText('Modello'), { target: { value: 'mistralai/Timestral-5M' } });
    await waitFor(() => expect(screen.getByTestId('forecast-badge').textContent).toMatch(/STIMATO DA MODELLO — Timestral 5M \[bdd20cf\]/));
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://proxy.example/forecast/v1/forecast');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer jwt-di-sessione');
  });

  it('registra la previsione nel progetto (dossier) e poi aggiunge il confronto ex-post', async () => {
    const repo = localRepo([urban]);
    open(urban, repo);
    await screen.findByTestId('forecast-badge');
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
    await screen.findByTestId('forecast-badge');
    expect(screen.queryByRole('button', { name: /Registra/ })).toBeNull();
    expect(screen.getByText(/riservata a chi modifica il progetto/)).toBeTruthy();
  });
});

describe('F31 — Previsioni nel caso vigneto', () => {
  it('testo obbligatorio, orizzonte 72 h e zone segnalate dalle soglie dell’agronomo', async () => {
    open(agri);
    await screen.findByTestId('forecast-badge');
    expect(screen.getByText('Previsione prodotta da un modello e non misurazione sul terreno. Verificare in campo e confrontarsi con un agronomo prima di intervenire.')).toBeTruthy();
    expect((screen.getByLabelText('Orizzonte') as HTMLSelectElement).value).toBe('72');
    const zt = within(await screen.findByTestId('zone-table'));
    expect(zt.getAllByRole('row')).toHaveLength(1 + agri.agri!.zones.length);
    expect(zt.getByText('0,16')).toBeTruthy(); // 0,12 + 0,3 × (0,25 − 0,12)
    expect(screen.getByText(/una cella di rianalisi\): le zone cambiano solo per la soglia/)).toBeTruthy();
  });
});
