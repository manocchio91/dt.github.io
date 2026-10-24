import { useCallback, useEffect, useState } from 'react';
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
  type WeatherPoint,
  type WeatherSnapshot,
} from '../state/weather';
import { Alert } from './ui';
import { formatNumber } from './DataBadge';
import { SourceBadge } from './SourceBadge';

export const MODELLED_NOTICE = 'Dato territoriale modellato, non rilevato da sensore locale';

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
  const online = useOnline();
  const agri = bundle.project.sector === 'agriculture';
  const [snap, setSnap] = useState<WeatherSnapshot | null>(null);
  const [noLocation, setNoLocation] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [horizon, setHorizon] = useState<24 | 72>(agri ? 72 : 24);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [localCooldownUntil, setLocalCooldownUntil] = useState(0);
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

  if (!connected) {
    return (
      <section aria-labelledby="meteo-h" className="card space-y-2" data-testid="weather-panel">
        <h2 id="meteo-h" className="h-section">
          Dati meteorologici
        </h2>
        <Alert tone="info" title="Archivio meteo non collegato">
          <p>I dati meteorologici ufficiali sono acquisiti dal server (Open-Meteo → Supabase, ogni 3 ore) e si consultano accedendo a un’organizzazione. In questo browser non viene eseguita alcuna acquisizione.</p>
        </Alert>
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

  const refresh = async () => {
    if (!client || !snap) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await requestRefresh(client, snap.location.id);
      setLocalCooldownUntil(Date.now() + MANUAL_COOLDOWN_MS);
      setMsg(r.status === 'gia_acquisita' ? { tone: 'ok', text: 'Dati già acquisiti per quest’ora: nessuna nuova richiesta a Open-Meteo.' } : { tone: 'ok', text: `Dati aggiornati: ${r.points} ore di previsione registrate.` });
      await load();
    } catch (e) {
      const err = e as WeatherRefreshError;
      if (err.status === 429) setLocalCooldownUntil(Date.now() + MANUAL_COOLDOWN_MS);
      setMsg({ tone: err.status === 429 ? 'warn' : 'error', text: err.status === 429 ? `Limite di frequenza: ${err.message}` : `Aggiornamento non riuscito: ${err.message} Restano visibili gli ultimi dati validi.` });
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
        <h2 id="meteo-h" className="h-section flex flex-wrap items-center gap-2">
          Dati meteorologici <SourceBadge kind="OPEN_METEO" />
        </h2>
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

      <p className="rounded border-l-4 border-meteo-700 bg-meteo-50 p-2 text-sm font-semibold text-meteo-900" role="note">
        {MODELLED_NOTICE}
      </p>

      {status.kind === 'loading' && !snap && <p className="text-sm">Caricamento dei dati meteorologici…</p>}
      {(status.kind === 'offline' || !online) && (
        <Alert tone="warn" title="Nessuna connessione">
          <p>{snap ? 'Mostrati gli ultimi dati scaricati in questo browser.' : 'Dati non disponibili finché la rete non torna.'}</p>
        </Alert>
      )}
      {status.kind === 'error' && <Alert tone="error" title="Dati meteorologici non disponibili">{status.message}</Alert>}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {noLocation && (
        <div className="space-y-2 text-sm">
          <p>Nessun punto di acquisizione per questo progetto: il job pianificato non ha ancora dati da raccogliere.</p>
          {canEdit && bundle.area && (
            <button type="button" className="btn-secondary" onClick={createHere}>
              Crea punto di acquisizione nel baricentro dell’area
            </button>
          )}
        </div>
      )}

      {snap && !run && <p className="text-sm">Punto “{snap.location.name}” registrato: nessuna acquisizione completata finora. Il job pianificato gira ogni 3 ore.</p>}

      {snap && run && (
        <>
          {stale && (
            <Alert tone="warn" title="Dato non aggiornato">
              <p>Ultima emissione {fmtTime(run.issued_at!)}: più vecchia di 6 ore. Verificare il job pianificato.</p>
            </Alert>
          )}
          {lastFailed && (
            <Alert tone="warn" title="Ultimo tentativo non riuscito">
              <p>
                {fmtTime(lastFailed.requested_at)} — {lastFailed.error_code ?? 'errore'}. Mostrati gli ultimi dati validi.
              </p>
            </Alert>
          )}
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_1fr]" data-testid="weather-meta">
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
            <dt className="font-semibold text-sand-600">Validità</dt>
            <dd>
              {run.valid_from && fmtTime(run.valid_from)} → {run.valid_to && fmtTime(run.valid_to)}
            </dd>
          </dl>

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
              <button key={h} type="button" className={h === horizon ? 'btn-primary' : 'btn-secondary'} aria-pressed={h === horizon} onClick={() => setHorizon(h)}>
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

      <Legend />
      <p className="text-xs text-sand-600">{OM_ATTRIBUTION}</p>
    </section>
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
