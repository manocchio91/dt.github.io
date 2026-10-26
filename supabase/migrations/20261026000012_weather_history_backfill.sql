-- Micro Digital Twin — storico Open-Meteo di 7 giorni per ogni località (F04).
--
-- Migrazione NON distruttiva: solo nuove funzioni e un trigger; nessuna tabella, colonna o dato
-- modificato o cancellato. Riusa weather_locations, weather_fetch_runs, weather_forecast_points e
-- weather_observations (0007).
--
-- * weather_history_status(località, istante): completezza dello storico calcolata dal server
--   (prima/ultima ora, ore storiche e future, variabili, buchi, completezza, stato). Lettura per
--   chi vede la località (ruolo "lettura" o superiore) e per il servizio di acquisizione, che la usa
--   per scaricare solo le ore mancanti.
-- * trigger weather_initial_fetch: alla creazione di una località attiva chiede subito alla Edge
--   Function open-meteo-ingest il recupero iniziale (pg_net, asincrono, dopo il commit). URL e
--   segreto sono letti dal Vault come per il job pianificato (0011). Se pg_net o il Vault mancano,
--   o la richiesta non si accoda, la località resta salvata: la acquisisce il job delle 3 ore.

-- ------------------------------------------------------------ completezza dello storico
-- Ore dello storico = ore con temperature_2m Open-Meteo registrata (variabile obbligatoria).
-- Finestra di riferimento: le 168 ore (7 giorni) che terminano all'ultima ora registrata.
-- Istanti restituiti sempre in UTC (set timezone), indipendentemente dalla sessione.
create or replace function public.weather_history_status(p_location uuid, p_at timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public set timezone = 'UTC' as $$
declare
  l weather_locations;
  ref timestamptz := date_trunc('hour', p_at, 'UTC');
  first_h timestamptz;
  last_h timestamptz;
  n_hist int;
  n_window int := 0;
  n_cont int := 0;
  n_future int := 0;
  gaps jsonb := '[]';
  vars jsonb := '[]';
  last_run weather_fetch_runs;
  last_ok weather_fetch_runs;
  running boolean;
  fresh boolean;
  stato text;
begin
  select * into l from weather_locations where id = p_location;
  if l.id is null or not (app.is_service_role() or app.has_role(l.organization_id, 'viewer')) then
    raise exception 'Località non trovata.' using errcode = 'P0002';
  end if;

  select min(observed_at), max(observed_at), count(*) into first_h, last_h, n_hist
  from weather_observations
  where location_id = l.id and source = 'open_meteo' and variable = 'temperature_2m' and observed_at < ref;

  if last_h is not null then
    select count(*) into n_window from weather_observations
    where location_id = l.id and source = 'open_meteo' and variable = 'temperature_2m'
      and observed_at between last_h - interval '167 hours' and last_h;

    -- buchi nella finestra: ore consecutive mancanti raggruppate in intervalli
    with hours as (
      select g as h from generate_series(last_h - interval '167 hours', last_h, interval '1 hour') g
    ), missing as (
      select h, h - (row_number() over (order by h)) * interval '1 hour' as grp from hours
      where not exists (select 1 from weather_observations o where o.location_id = l.id and o.source = 'open_meteo'
                        and o.variable = 'temperature_2m' and o.observed_at = hours.h)
    ), ranges as (
      select min(h) as da, max(h) as a, count(*)::int as ore from missing group by grp
    )
    select coalesce(jsonb_agg(jsonb_build_object('da', da, 'a', a, 'ore', ore) order by da), '[]') into gaps from ranges;

    -- ore continue che terminano all'ultima ora registrata
    select coalesce(min(gap_h), 0) into n_cont from (
      select extract(epoch from last_h - (r ->> 'a')::timestamptz)::int / 3600 as gap_h from jsonb_array_elements(gaps) r
    ) x;
    if n_cont = 0 then n_cont := n_window; end if;

    select coalesce(jsonb_agg(distinct variable order by variable), '[]') into vars from weather_observations
    where location_id = l.id and source = 'open_meteo' and observed_at between last_h - interval '167 hours' and last_h;
  end if;

  select * into last_run from weather_fetch_runs where location_id = l.id order by requested_at desc limit 1;
  select * into last_ok from weather_fetch_runs where location_id = l.id and status = 'completata' order by issued_at desc limit 1;
  if last_ok.id is not null then
    select count(*) into n_future from weather_forecast_points where fetch_run_id = last_ok.id and valid_at >= ref;
  end if;

  -- un'acquisizione "in corso" da oltre 10 minuti è considerata interrotta
  running := last_run.id is not null and last_run.status = 'in_corso' and last_run.requested_at > p_at - interval '10 minutes';
  -- il job passa ogni 3 ore: oltre 6 ore senza nuove ore lo storico non è aggiornato
  fresh := last_h is not null and last_h >= ref - interval '6 hours';

  stato := case
    when last_h is null and (last_run.id is null or running) then 'in_preparazione'
    when last_h is null then 'non_riuscito'
    when last_run.status = 'errore' and not fresh then 'non_riuscito'
    when n_cont >= 72 and fresh then 'sufficiente'
    else 'incompleto'
  end;

  return jsonb_build_object(
    'stato', stato,
    'prima_ora', first_h,
    'ultima_ora', last_h,
    'ore_storiche', coalesce(n_hist, 0),
    'ore_finestra', n_window,
    'ore_continue', n_cont,
    'ore_future', n_future,
    'completezza_pct', round(n_window * 100.0 / 168, 1),
    'sette_giorni', n_window >= 168,
    'sufficiente_timestral', n_cont >= 72 and fresh,
    'aggiornato', fresh,
    'in_corso', running,
    'buchi', gaps,
    'variabili', vars,
    'ultimo_aggiornamento', last_ok.completed_at,
    'ultimo_errore', case when last_run.status = 'errore' then jsonb_build_object('codice', last_run.error_code, 'il', last_run.completed_at) end
  );
end $$;

revoke all on function public.weather_history_status(uuid, timestamptz) from public, anon;

grant execute on function public.weather_history_status(uuid, timestamptz) to authenticated, service_role;

-- ------------------------------------------------- recupero iniziale alla creazione
create or replace function app.weather_request_initial_fetch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.active
     or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;
  -- freno: al massimo 5 richieste immediate ogni 10 minuti per organizzazione; le altre località
  -- restano in attesa del job pianificato
  if (select count(*) from weather_locations where organization_id = new.organization_id and created_at > now() - interval '10 minutes') > 5 then
    return null;
  end if;
  begin
    execute $q$
      select net.http_post(
        url := s.url,
        headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', s.secret),
        body := jsonb_build_object('location_id', $1),
        timeout_milliseconds := 60000
      )
      from (
        select (select decrypted_secret from vault.decrypted_secrets where name = 'open_meteo_ingest_url') as url,
               (select decrypted_secret from vault.decrypted_secrets where name = 'open_meteo_cron_secret') as secret
      ) s
      where s.url is not null and s.secret is not null
    $q$ using new.id;
  exception when others then
    -- la creazione della località non fallisce mai per l'acquisizione
    raise warning 'Recupero iniziale Open-Meteo non accodato (%).', sqlstate;
  end;
  return null;
end $$;

revoke all on function app.weather_request_initial_fetch() from public, anon;

grant execute on function app.weather_request_initial_fetch() to authenticated;

create trigger weather_initial_fetch after insert on weather_locations for each row execute function app.weather_request_initial_fetch();
