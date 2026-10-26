import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { isStale, OM_ATTRIBUTION, validateAoi, type ProjectBundle } from '@mdt/domain';
import { useAuth } from '../state/auth';
import { useStore } from '../state/store';
import { usePermissions } from '../state/permissions';
import {
  createLocation,
  listLocations,
  loadSnapshot,
  MANUAL_COOLDOWN_MS,
  requestRefresh,
  WEATHER_LABEL,
  WeatherRefreshError,
  type HistoryStatus,
  type WeatherPoint,
  type WeatherSnapshot,
} from '../state/weather';
import { Alert } from './ui';
import { formatNumber } from './DataBadge';
import { SourceBadge } from './SourceBadge';
import { useWorkMode } from '../state/preferences';
import { LEVEL_LABEL, summarizeWeather, type WeatherSummary } from '../state/weatherSummary';

export const MODELLED_NOTICE = 'Dato territoriale modellato, non rilevato da sensore locale.';
export const NOT_CONNECTED = { title: 'Dati meteo non ancora collegati.', text: 'Puoi continuare usando la modalità dimostrativa.' };
export const NOT_YET_AVAILABLE = 'Il progetto è stato salvato, ma i dati meteo non sono ancora disponibili. Riprova più tardi.';
/** Durante la prima acquisizione il pannello si aggiorna da solo per circa un minuto. */
const PREPARATION_POLL_MS = 5_000;
const PREPARATION_POLLS = 12;

const VARIABLE_UNITS = 'temperatura °C · umidità % · precipitazioni mm · vento m/s · radiazione W/m² · ET0 mm · VPD kPa · umidità del suolo m³/m³';

const COMMON_COLS = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation', 'precipitation_probability', 'wind_speed_10m', 'wind_gusts_10m', 'shortwave_radiation'];
const AGRI_COLS = ['temperature_2m', 'relative_humidity_2m', 'precipitation', 'et0_fao_evapotranspiration', 'vapour_pressure_deficit', 'soil_temperature_6cm', 'soil_moisture_9_to_27cm'];
const SOIL_ROWS = ['soil_temperature_0cm', 'soil_temperature_6cm', 'soil_temperature_18cm', 'soil_temperature_54cm', 'soil_moisture_0_to_1cm', 'soil_moisture_1_to_3cm', 'soil_moisture_3_to_9cm', 'soil_moisture_9_to_27cm', 'soil_moisture_27_to_81cm'];

type Status = { kind: 'idle' | 'loading' } | { kind: 'ready' } | { kind: 'offline' } | { kind: 'error'; message: string };

const fmtTime = (iso: string) => new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome' }).format(Date.parse(iso));
const fmtHour = (iso: string) => new Intl.DateTimeFormat('it-IT', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }).format(Date.parse(iso));
const cacheKey = (id: string) => `mdt-weather-${id}`;

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function value(p: WeatherPoint | undefined, v: string): string {
  const x = p?.[v];
  if (typeof x !== 'number') return 'n.d.';
  const unit = p!.unit_metadata?.[v] ?? '';
  return formatNumber(x, unit);
}

export function WeatherPanel({ bundle, now = () => new Date() }: { bundle: ProjectBundle; now?: () => Date }) {
  const { client, session, current } = useAuth();
  const { kind } = useStore();
  const { canEdit } = usePermissions();
  const technical = useWorkMode() === 'tecnica';
  const online = useOnline();
  const agri = bundle.project.sector === 'agriculture';
  const [snap, setSnap] = useState<WeatherSnapshot | null>(null);
  const [noLocation, setNoLocation] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [horizon, setHorizon] = useState<24 | 72>(agri ? 72 : 24);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [localCooldownUntil, setLocalCooldownUntil] = useState(0);
  const [polls, setPolls] = useState(0);
  const connected = kind === 'supabase' && !!client && !!session;

  const load = useCallback(async () => {
    if (!connected || !client) return;
    setStatus({ kind: 'loading' });
    try {
      const locs = await listLocations(client, bundle.project.id);
      if (locs.length === 0) {
        setNoLocation(true);
        setSnap(null);
        setStatus({ kind: 'ready' });
        return;
      }
      setNoLocation(false);
      const s = await loadSnapshot(client, locs[0]!);
      setSnap(s);
      try {
        localStorage.setItem(cacheKey(bundle.project.id), JSON.stringify(s));
      } catch {
        /* archiviazione del browser non disponibile */
      }
      setStatus({ kind: 'ready' });
    } catch (e) {
      // senza rete si mostrano gli ultimi dati scaricati, dichiarandolo
      let cached: WeatherSnapshot | null = null;
      try {
        const raw = localStorage.getItem(cacheKey(bundle.project.id));
        cached = raw ? (JSON.parse(raw) as WeatherSnapshot) : null;
      } catch {
        cached = null;
      }
      if (cached) setSnap(cached);
      setStatus(!navigator.onLine || /fetch|network|rete/i.test((e as Error).message) ? { kind: 'offline' } : { kind: 'error', message: (e as Error).message });
    }
  }, [client, connected, bundle.project.id]);

  useEffect(() => {
    void load();
  }, [load, online]);

  // prima acquisizione avviata dal server alla creazione della località: si ricontrolla per un minuto
  const preparing = !!snap && (!snap.run || snap.history?.stato === 'in_preparazione') && snap.history?.stato !== 'non_riuscito';
  useEffect(() => {
    if (!preparing || polls >= PREPARATION_POLLS) return;
    const t = setTimeout(() => {
      setPolls((n) => n + 1);
      void load();
    }, PREPARATION_POLL_MS);
    return () => clearTimeout(t);
  }, [preparing, polls, load]);

  if (!connected) {
    return (
      <section aria-labelledby="meteo-h" className="card space-y-2" data-testid="weather-panel">
        <h2 id="meteo-h" className="h-section">
          SITUAZIONE ATTUALE
        </h2>
        <Alert tone="info" title={NOT_CONNECTED.title}>
          <p>{NOT_CONNECTED.text}</p>
        </Alert>
        <details className="text-sm" open={technical}>
          <summary className="cursor-pointer font-semibold text-petrol-700">Perché?</summary>
          <p className="mt-1">I dati meteorologici ufficiali sono acquisiti dal server (Open-Meteo → archivio dell’organizzazione, ogni 3 ore) e si consultano accedendo a un’organizzazione. In questo browser non viene eseguita alcuna acquisizione.</p>
        </details>
        <Legend />
      </section>
    );
  }

  const run = snap?.run ?? null;
  const t = now();
  const stale = run ? isStale(run.issued_at, t) : false;
  const nowPoint = snap?.points.find((p) => Date.parse(p.valid_at) + 3_600_000 > t.getTime()) ?? snap?.points[0];
  const startIdx = snap && nowPoint ? snap.points.indexOf(nowPoint) : 0;
  const shown = snap ? snap.points.slice(startIdx, startIdx + horizon) : [];
  const cols = agri ? AGRI_COLS : COMMON_COLS;
  const cooldownUntil = Math.max(localCooldownUntil, snap?.lastManualAt ? Date.parse(snap.lastManualAt) + MANUAL_COOLDOWN_MS : 0);
  const coolingDown = cooldownUntil > t.getTime();
  const lastFailed = snap?.lastAttempt?.status === 'errore' ? snap.lastAttempt : null;
  const summary = snap && run ? summarizeWeather(snap.points, agri ? 'agriculture' : 'urban', t, { heatThresholdC: bundle.agri?.setup.heatThresholdC }) : null;

  const refresh = async () => {
    if (!client || !snap) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await requestRefresh(client, snap.location.id);
      setLocalCooldownUntil(Date.now() + MANUAL_COOLDOWN_MS);
      setPolls(0);
      setMsg(r.status === 'gia_acquisita' ? { tone: 'ok', text: 'Dati già acquisiti per quest’ora: nessuna nuova richiesta a Open-Meteo.' } : { tone: 'ok', text: `Dati aggiornati: ${r.points} ore di previsione registrate.` });
      await load();
    } catch (e) {
      const err = e as WeatherRefreshError;
      if (err.status === 429) setLocalCooldownUntil(Date.now() + MANUAL_COOLDOWN_MS);
      setMsg({ tone: err.status === 429 ? 'warn' : 'error', text: err.status === 429 ? `Limite di frequenza: ${err.message}` : `${snap.run ? 'Aggiornamento non riuscito: restano visibili gli ultimi dati validi.' : NOT_YET_AVAILABLE}${technical ? ` (${err.message})` : ''}` });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const createHere = async () => {
    if (!client || !bundle.area || !current) return;
    const c = validateAoi(bundle.area.geometry).centroid;
    if (!c) return setMsg({ tone: 'error', text: 'Area senza baricentro valido.' });
    try {
      await createLocation(client, {
        organization_id: current.organizationId,
        project_id: bundle.project.id,
        name: agri ? 'Parcella (baricentro)' : 'Area (baricentro)',
        scope: agri ? 'agricultural' : 'urban',
        latitude: Math.round(c.lat * 1e5) / 1e5,
        longitude: Math.round(c.lon * 1e5) / 1e5,
        elevation: null,
      });
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };

  return (
    <section aria-labelledby="meteo-h" className="card space-y-3" data-testid="weather-panel" aria-busy={status.kind === 'loading'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="meteo-h" className="h-section">
            SITUAZIONE ATTUALE
          </h2>
          <SourceBadge kind="OPEN_METEO" />
        </div>
        {canEdit && snap && (
          <div className="flex flex-col items-end gap-1">
            <button type="button" className="btn-secondary" onClick={refresh} disabled={busy || coolingDown || !online} aria-describedby="meteo-cooldown">
              {busy ? 'Aggiornamento…' : 'Aggiorna dati'}
            </button>
            <span id="meteo-cooldown" className="text-xs text-sand-600">
              {!online ? 'Non disponibile senza rete' : coolingDown ? `Nuovo aggiornamento manuale dalle ${new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }).format(cooldownUntil)}` : 'Al massimo una richiesta ogni 10 minuti'}
            </span>
          </div>
        )}
      </div>

      <p className="text-sm text-sand-600">Dati meteorologici aggiornati relativi all’area.</p>

      <p className="rounded border-l-4 border-meteo-700 bg-meteo-50 p-2 text-sm font-semibold text-meteo-900" role="note">
        {MODELLED_NOTICE}
      </p>

      {status.kind === 'loading' && !snap && <p className="text-sm">Caricamento dei dati meteorologici…</p>}
      {(status.kind === 'offline' || !online) && (
        <Alert tone="warn" title="Nessuna connessione">
          <p>{snap ? 'Mostrati gli ultimi dati scaricati in questo browser.' : 'Dati non disponibili finché la rete non torna.'}</p>
        </Alert>
      )}
      {status.kind === 'error' && (
        <Alert tone="error" title="Dati meteo non disponibili in questo momento">
          <p>{snap ? 'Restano visibili gli ultimi dati validi.' : 'Puoi continuare con gli altri indicatori e riprovare più tardi.'}</p>
          <details className="mt-1 text-xs" open={technical}>
            <summary className="cursor-pointer font-semibold">Dettagli tecnici</summary>
            <p>{status.message}</p>
          </details>
        </Alert>
      )}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {noLocation && (
        <div className="space-y-2 text-sm">
          <p>Nessun punto di acquisizione per questo progetto: l’acquisizione automatica non ha ancora un luogo da seguire.</p>
          {canEdit && bundle.area && (
            <button type="button" className="btn-secondary" onClick={createHere}>
              Crea punto di acquisizione nel baricentro dell’area
            </button>
          )}
        </div>
      )}

      {snap && (
        <HistoryNote
          history={snap.history}
          hasRun={!!run}
          preparing={preparing && polls < PREPARATION_POLLS}
          retry={canEdit && online && !coolingDown && (!run || snap.history?.stato === 'non_riuscito') && !(preparing && polls < PREPARATION_POLLS) ? refresh : null}
          busy={busy}
          forecastTo={`/progetti/${bundle.project.id}/previsioni`}
        />
      )}

      {snap && run && (
        <>
          {stale && (
            <Alert tone="warn" title="Dato non aggiornato">
              <p>Ultima emissione {fmtTime(run.issued_at!)}: più vecchia di 6 ore. Verificare l’acquisizione pianificata.</p>
            </Alert>
          )}
          {lastFailed && (
            <Alert tone="warn" title="Ultimo tentativo non riuscito">
              <p>
                {fmtTime(lastFailed.requested_at)} — {technical ? (lastFailed.error_code ?? 'errore') : 'aggiornamento non riuscito'}. Mostrati gli ultimi dati validi.
              </p>
            </Alert>
          )}
          {summary && <SummaryCard summary={summary} updatedAt={run.completed_at ?? run.requested_at} />}

          <details className="rounded border border-sand-200 p-2 text-sm" open={technical} data-testid="weather-source-details">
            <summary className="cursor-pointer font-semibold text-petrol-700">Dettagli della fonte</summary>
            <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]" data-testid="weather-meta">
              <dt className="font-semibold text-sand-600">Ultimo aggiornamento</dt>
              <dd>
                {fmtTime(run.completed_at ?? run.requested_at)} (emissione {fmtTime(run.issued_at!)}, {run.trigger === 'manuale' ? 'aggiornamento manuale' : 'acquisizione pianificata'})
              </dd>
              <dt className="font-semibold text-sand-600">Fonte</dt>
              <dd>Open-Meteo Forecast API</dd>
              <dt className="font-semibold text-sand-600">Modello</dt>
              <dd>{run.model_returned ?? `${run.model_requested} (modello effettivo non dichiarato dalla risposta)`}</dd>
              <dt className="font-semibold text-sand-600">Cella del modello</dt>
              <dd>
                {run.response_grid_latitude?.toFixed(4)}, {run.response_grid_longitude?.toFixed(4)} — quota {run.response_elevation ?? 'n.d.'} m (punto richiesto {snap.location.latitude.toFixed(4)}, {snap.location.longitude.toFixed(4)})
              </dd>
              <dt className="font-semibold text-sand-600">Intervallo temporale</dt>
              <dd>
                {run.valid_from && fmtTime(run.valid_from)} → {run.valid_to && fmtTime(run.valid_to)}
              </dd>
              <dt className="font-semibold text-sand-600">Variabili e unità</dt>
              <dd>{VARIABLE_UNITS}</dd>
              <dt className="font-semibold text-sand-600">Limiti spaziali</dt>
              <dd>Valore medio di una cella di griglia di alcuni chilometri: non descrive differenze tra una via e l’altra o tra una parcella e l’altra.</dd>
              <dt className="font-semibold text-sand-600">Licenza e attribuzione</dt>
              <dd>{OM_ATTRIBUTION}</dd>
              {snap.history && <HistoryDetails h={snap.history} />}
            </dl>
          </details>

          <details className="rounded border border-sand-200 p-2 text-sm" open={technical} data-testid="weather-values-details">
            <summary className="cursor-pointer font-semibold text-petrol-700">Tutti i valori ora per ora</summary>
            <div className="mt-2 space-y-3">

              {nowPoint && (
                <div>
                  <h3 className="text-sm font-bold">Ora {fmtHour(nowPoint.valid_at)}</h3>
                  <ul className="mt-1 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-4" data-testid="weather-now">
                    {[
                      'temperature_2m',
                      'apparent_temperature',
                      'relative_humidity_2m',
                      'precipitation',
                      'wind_speed_10m',
                      'shortwave_radiation',
                      ...(agri ? ['et0_fao_evapotranspiration', 'vapour_pressure_deficit', 'soil_temperature_6cm', 'soil_moisture_9_to_27cm'] : []),
                    ].map((v) => (
                      <li key={v} className="rounded border border-sand-200 p-2">
                        <span className="block text-xs text-sand-600">{WEATHER_LABEL[v]}</span>
                        <span className="font-bold tabular-nums">{value(nowPoint, v)}</span>
                        {v === 'precipitation' && typeof nowPoint.precipitation_probability === 'number' && <span className="block text-xs">probabilità {value(nowPoint, 'precipitation_probability')}</span>}
                        {v === 'wind_speed_10m' && typeof nowPoint.wind_direction_10m === 'number' && <span className="block text-xs">da {value(nowPoint, 'wind_direction_10m')}, raffiche {value(nowPoint, 'wind_gusts_10m')}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {agri && nowPoint && (
                <details className="rounded border border-sand-200 p-2 text-sm">
                  <summary className="cursor-pointer font-semibold">Suolo a tutte le profondità disponibili</summary>
                  <table className="table-base mt-2">
                    <caption className="sr-only">Temperatura e umidità del suolo per profondità</caption>
                    <tbody>
                      {SOIL_ROWS.map((v) => (
                        <tr key={v}>
                          <th scope="row">{WEATHER_LABEL[v]}</th>
                          <td className="tabular-nums">{value(nowPoint, v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}

              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Orizzonte della previsione oraria">
                <span className="text-sm font-semibold">Previsione oraria:</span>
                {([24, 72] as const).map((h) => (
                  <button key={h} type="button" className={`btn-secondary ${h === horizon ? 'border-petrol-700 bg-petrol-700 text-white' : ''}`} aria-pressed={h === horizon} onClick={() => setHorizon(h)}>
                    {h} ore
                  </button>
                ))}
              </div>
              <div className="max-h-96 overflow-auto rounded border border-sand-200" tabIndex={0} role="region" aria-label={`Tabella oraria delle prossime ${horizon} ore`}>
                <table className="table-base text-sm" data-testid="weather-hourly">
                  <caption className="sr-only">Previsione Open-Meteo ora per ora, prossime {horizon} ore</caption>
                  <thead>
                    <tr>
                      <th scope="col">Ora (Europe/Rome)</th>
                      {cols.map((c) => (
                        <th key={c} scope="col">
                          {WEATHER_LABEL[c]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((p) => (
                      <tr key={p.valid_at}>
                        <th scope="row" className="font-normal whitespace-nowrap">
                          {fmtHour(p.valid_at)}
                        </th>
                        {cols.map((c) => (
                          <td key={c} className="tabular-nums whitespace-nowrap">
                            {value(p, c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {shown.length < horizon && <p className="text-xs text-sand-600">Disponibili {shown.length} ore su {horizon} richieste.</p>}
            </div>
          </details>
        </>
      )}

      {snap && snap.sensors.length > 0 && (
        <div className="text-sm" data-testid="weather-sensors">
          <h3 className="flex items-center gap-2 font-bold">
            Ultime misure in campo <SourceBadge kind="SENSORE" />
          </h3>
          <ul>
            {snap.sensors.slice(0, 5).map((o) => (
              <li key={`${o.variable}-${o.observed_at}`}>
                {WEATHER_LABEL[o.variable] ?? o.variable}: {formatNumber(o.value, o.unit)} — {fmtTime(o.observed_at)} ({o.quality_flag})
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="text-sm" open={technical}>
        <summary className="cursor-pointer font-semibold text-petrol-700">Fonti e metodo</summary>
        <div className="mt-2"><Legend /></div>
      </details>
    </section>
  );
}

function SummaryCard({ summary, updatedAt }: { summary: WeatherSummary; updatedAt: string }) {
  const l = LEVEL_LABEL[summary.level];
  return (
    <div className="space-y-2 rounded-lg border border-sand-200 p-3" data-testid="weather-summary">
      <p className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded border-2 px-2 py-0.5 text-sm font-bold ${l.cls}`} data-testid="weather-level">
          <span aria-hidden="true">{l.symbol}</span>
          Stato: {l.text}
        </span>
        <span className="font-semibold">{summary.headline}</span>
      </p>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]">
        <dt className="font-semibold text-sand-600">Valore principale</dt>
        <dd className="tabular-nums">{WEATHER_LABEL[summary.variable]}: {summary.current === null ? 'n.d.' : formatNumber(summary.current, summary.unit)}</dd>
        {summary.window && (
          <>
            <dt className="font-semibold text-sand-600">Andamento delle prossime ore</dt>
            <dd>
              {fmtHour(summary.window.from)} → {fmtHour(summary.window.to)}
            </dd>
          </>
        )}
        <dt className="font-semibold text-sand-600">Ultimo aggiornamento</dt>
        <dd>{fmtTime(updatedAt)}</dd>
        <dt className="font-semibold text-sand-600">Fonte</dt>
        <dd>Open-Meteo, previsione da modello meteorologico</dd>
      </dl>
      <p className="rounded bg-petrol-100 p-2 text-sm text-petrol-900">
        <strong>Prossimo passo:</strong> {summary.nextStep}
      </p>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Legenda delle fonti">
      <span className="font-semibold">Legenda fonti:</span>
      <SourceBadge kind="OPEN_METEO" />
      <SourceBadge kind="SENSORE" />
      <SourceBadge kind="STIMATO_DA_MODELLO" />
      <SourceBadge kind="SIMULATO" />
    </div>
  );
}

/** Modalità guidata: lo stato dello storico in una frase, senza termini tecnici. */
function HistoryNote({ history: h, hasRun, preparing, retry, busy, forecastTo }: { history: HistoryStatus | null; hasRun: boolean; preparing: boolean; retry: (() => void) | null; busy: boolean; forecastTo: string }) {
  let text: string;
  let tone = 'bg-sand-100 text-sand-900';
  if (h?.stato === 'non_riuscito' || (!hasRun && !preparing)) {
    text = NOT_YET_AVAILABLE;
    tone = 'bg-ochre-100 text-ochre-800';
  } else if (!hasRun || h?.stato === 'in_preparazione') {
    text = 'Preparazione dei dati meteo: stiamo raccogliendo lo storico dei 7 giorni precedenti.';
  } else if (!h) {
    // server senza lo stato dello storico: nessuna frase invece di una supposizione
    return null;
  } else if (h.livello === 'disponibile') {
    text = 'Storico disponibile: 7 giorni. Previsione avanzata disponibile.';
  } else {
    text = `Stiamo raccogliendo lo storico necessario. Sono disponibili ${h.ore_finestra} delle ${h.ore_obiettivo} ore previste.`;
    text += h.livello === 'consolidamento' ? ' Storico ancora in consolidamento: il modello avanzato si può usare con cautela.' : ' Storico non ancora sufficiente per il modello avanzato.';
  }
  const missing = h ? h.buchi.reduce((n, b) => n + b.ore, 0) : 0;
  return (
    <div className={`space-y-1 rounded p-2 text-sm ${tone}`} data-testid="weather-history" role="status">
      <p>{text}</p>
      {h?.livello === 'disponibile' && hasRun && (
        <Link className="inline-block font-semibold text-petrol-700 underline" to={forecastTo}>Apri le previsioni</Link>
      )}
      {h && hasRun && missing > 0 && <p>Mancano {missing} ore nello storico: non vengono stimate né riempite.</p>}
      {retry && (
        <button type="button" className="btn-secondary" onClick={retry} disabled={busy}>
          {busy ? 'Aggiornamento…' : 'Riprova aggiornamento'}
        </button>
      )}
    </div>
  );
}

const fmtUtc = (iso: string | null) => (iso ? fmtTime(iso) : 'n.d.');

/** Modalità tecnica e "Dettagli della fonte": completezza calcolata dal server. */
function HistoryDetails({ h }: { h: HistoryStatus }) {
  return (
    <>
      <dt className="font-semibold text-sand-600">Storico</dt>
      <dd data-testid="weather-history-details">
        {h.ore_finestra} ore valide su {h.ore_obiettivo} ({h.completezza_pct}%), {h.ore_continue} continue, {h.ore_future} ore future; dal {fmtUtc(h.prima_ora)} al {fmtUtc(h.ultima_ora)}. Ora valida = tutte le
        variabili obbligatorie presenti.
        {h.variabili_richieste_mancanti.length > 0 && <> Variabili obbligatorie assenti: {h.variabili_richieste_mancanti.join(', ')}.</>}
        {h.buchi.length > 0 && <> Lacune: {h.buchi.map((b) => `${fmtUtc(b.da)} → ${fmtUtc(b.a)} (${b.ore} h)`).join('; ')}.</>}
        {' '}Variabili: {h.variabili.map((v) => `${WEATHER_LABEL[v] ?? v} ${h.ore_per_variabile[v] ?? 0} h`).join(', ')}.
      </dd>
    </>
  );
}
