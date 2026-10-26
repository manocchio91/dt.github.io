-- Micro Digital Twin — provenienza dello storico Open-Meteo e completezza su ore valide (F04, F21, F31).
--
-- Migrazione NON distruttiva: una colonna facoltativa, un vincolo valido per tutte le righe esistenti
-- (la colonna nasce vuota) e due funzioni sostituite con la stessa firma. Nessun dato modificato o
-- cancellato; RLS, trigger e vincoli esistenti invariati.
--
-- * weather_observations.fetch_run_id: l'acquisizione che ha fornito l'ora storica, quindi ora di
--   acquisizione, cella della griglia, quota e modello (weather_fetch_runs). Solo per la fonte
--   open_meteo; scritta solo dal servizio di acquisizione (i client non possono inserire righe
--   open_meteo: guard e policy della 0007).
-- * weather_history_status: "ora valida" = ora passata con TUTTE le variabili obbligatorie
--   Open-Meteo registrate (non il semplice numero di righe); continuità, ore per variabile e livello:
--   disponibile (168 ore valide nella finestra di 7 giorni), consolidamento (almeno 72 ore valide
--   continue), insufficiente (meno di 72). Le lacune sono elencate, mai riempite.

alter table public.weather_observations add column fetch_run_id uuid references public.weather_fetch_runs (id) on delete set null;
alter table public.weather_observations add constraint weather_observations_run_source check (fetch_run_id is null or source = 'open_meteo');
create index weather_obs_run_idx on public.weather_observations (fetch_run_id) where fetch_run_id is not null;
comment on column public.weather_observations.fetch_run_id is 'Acquisizione Open-Meteo che ha fornito il valore (ora di acquisizione, cella, modello).';

create or replace function public.weather_complete_fetch(p_run uuid, p_meta jsonb, p_points jsonb, p_observations jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r weather_fetch_runs;
  n_points int;
  n_obs int;
begin
  if not app.is_service_role() then raise exception 'Riservato al servizio di acquisizione.' using errcode = '42501'; end if;
  select * into r from weather_fetch_runs where id = p_run for update;
  if r.id is null or r.status <> 'in_corso' then raise exception 'Acquisizione non in corso.' using errcode = '55000'; end if;

  insert into weather_forecast_points (organization_id, fetch_run_id, location_id, issued_at, valid_at,
    temperature_2m, apparent_temperature, relative_humidity_2m, precipitation, precipitation_probability,
    wind_speed_10m, wind_direction_10m, wind_gusts_10m, shortwave_radiation, et0_fao_evapotranspiration,
    vapour_pressure_deficit, soil_temperature_0cm, soil_temperature_6cm, soil_temperature_18cm, soil_temperature_54cm,
    soil_moisture_0_to_1cm, soil_moisture_1_to_3cm, soil_moisture_3_to_9cm, soil_moisture_9_to_27cm, soil_moisture_27_to_81cm,
    model, unit_metadata)
  select r.organization_id, r.id, r.location_id, (p_meta ->> 'issued_at')::timestamptz, x.valid_at,
    x.temperature_2m, x.apparent_temperature, x.relative_humidity_2m, x.precipitation, x.precipitation_probability,
    x.wind_speed_10m, x.wind_direction_10m, x.wind_gusts_10m, x.shortwave_radiation, x.et0_fao_evapotranspiration,
    x.vapour_pressure_deficit, x.soil_temperature_0cm, x.soil_temperature_6cm, x.soil_temperature_18cm, x.soil_temperature_54cm,
    x.soil_moisture_0_to_1cm, x.soil_moisture_1_to_3cm, x.soil_moisture_3_to_9cm, x.soil_moisture_9_to_27cm, x.soil_moisture_27_to_81cm,
    p_meta ->> 'model', p_meta -> 'units'
  from jsonb_to_recordset(p_points) as x(valid_at timestamptz,
    temperature_2m double precision, apparent_temperature double precision, relative_humidity_2m double precision,
    precipitation double precision, precipitation_probability double precision, wind_speed_10m double precision,
    wind_direction_10m double precision, wind_gusts_10m double precision, shortwave_radiation double precision,
    et0_fao_evapotranspiration double precision, vapour_pressure_deficit double precision,
    soil_temperature_0cm double precision, soil_temperature_6cm double precision, soil_temperature_18cm double precision,
    soil_temperature_54cm double precision, soil_moisture_0_to_1cm double precision, soil_moisture_1_to_3cm double precision,
    soil_moisture_3_to_9cm double precision, soil_moisture_9_to_27cm double precision, soil_moisture_27_to_81cm double precision)
  on conflict do nothing;
  get diagnostics n_points = row_count;

  -- ogni ora storica conserva l'acquisizione che l'ha fornita (ora, cella, modello); una riga già presente non cambia
  insert into weather_observations (organization_id, location_id, observed_at, variable, value, unit, source, quality_flag, fetch_run_id)
  select r.organization_id, r.location_id, o.observed_at, o.variable, o.value, o.unit, 'open_meteo', 'modellato', r.id
  from jsonb_to_recordset(p_observations) as o(observed_at timestamptz, variable text, value double precision, unit text)
  on conflict do nothing;
  get diagnostics n_obs = row_count;

  update weather_fetch_runs set
    status = 'completata', completed_at = now(),
    model_returned = p_meta ->> 'model_returned',
    response_grid_latitude = (p_meta ->> 'grid_latitude')::double precision,
    response_grid_longitude = (p_meta ->> 'grid_longitude')::double precision,
    response_elevation = (p_meta ->> 'elevation')::double precision,
    generation_time_ms = (p_meta ->> 'generation_time_ms')::double precision,
    issued_at = (p_meta ->> 'issued_at')::timestamptz,
    valid_from = (p_meta ->> 'valid_from')::timestamptz,
    valid_to = (p_meta ->> 'valid_to')::timestamptz,
    points_count = n_points
  where id = r.id;
  return jsonb_build_object('points', n_points, 'observations', n_obs);
end $$;

create or replace function public.weather_history_status(p_location uuid, p_at timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public set timezone = 'UTC' as $$
declare
  -- variabili senza le quali la risposta Open-Meteo è rifiutata (openMeteoForecast.ts, REQUIRED)
  required text[] := array['temperature_2m', 'relative_humidity_2m', 'precipitation', 'wind_speed_10m', 'shortwave_radiation'];
  l weather_locations;
  ref timestamptz := date_trunc('hour', p_at, 'UTC');
  first_h timestamptz;
  last_h timestamptz;
  n_hist int := 0;
  n_window int := 0;
  n_cont int := 0;
  n_future int := 0;
  gaps jsonb := '[]';
  vars jsonb := '[]';
  per_var jsonb := '{}';
  missing_req jsonb := '[]';
  last_run weather_fetch_runs;
  last_ok weather_fetch_runs;
  running boolean;
  fresh boolean;
  stato text;
  livello text;
  valid timestamptz[];
begin
  select * into l from weather_locations where id = p_location;
  if l.id is null or not (app.is_service_role() or app.has_role(l.organization_id, 'viewer')) then
    raise exception 'Località non trovata.' using errcode = 'P0002';
  end if;

  -- ore valide: ore passate distinte in cui tutte le variabili obbligatorie hanno un valore
  select coalesce(array_agg(observed_at order by observed_at), '{}') into valid from (
    select observed_at from weather_observations
    where location_id = l.id and source = 'open_meteo' and observed_at < ref and variable = any (required)
    group by observed_at
    having count(distinct variable) = cardinality(required)
  ) x;
  n_hist := cardinality(valid);
  first_h := valid[1];
  last_h := valid[n_hist];

  if last_h is not null then
    select count(*) into n_window from unnest(valid) h where h between last_h - interval '167 hours' and last_h;

    -- lacune nella finestra: ore non valide consecutive raggruppate in intervalli
    with hours as (
      select g as h from generate_series(last_h - interval '167 hours', last_h, interval '1 hour') g
    ), missing as (
      select hours.h, hours.h - (row_number() over (order by hours.h)) * interval '1 hour' as grp
      from hours where not (hours.h = any (valid))
    ), ranges as (
      select min(h) as da, max(h) as a, count(*)::int as ore from missing group by grp
    )
    select coalesce(jsonb_agg(jsonb_build_object('da', da, 'a', a, 'ore', ore) order by da), '[]') into gaps from ranges;

    -- ore valide continue che terminano all'ultima ora valida
    select coalesce(min(extract(epoch from last_h - (r ->> 'a')::timestamptz)::int / 3600), n_window) into n_cont
    from jsonb_array_elements(gaps) r;

    select coalesce(jsonb_agg(variable order by variable), '[]'), coalesce(jsonb_object_agg(variable, ore), '{}')
    into vars, per_var
    from (
      select variable, count(distinct observed_at)::int as ore from weather_observations
      where location_id = l.id and source = 'open_meteo' and observed_at between last_h - interval '167 hours' and last_h
      group by variable
    ) x;
  end if;

  select coalesce(jsonb_agg(v order by v), '[]') into missing_req from unnest(required) v where not (per_var ? v);

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
  livello := case when n_window >= 168 then 'disponibile' when n_cont >= 72 then 'consolidamento' else 'insufficiente' end;

  return jsonb_build_object(
    'stato', stato,
    'livello', livello,
    'ore_obiettivo', 168,
    'variabili_richieste', to_jsonb(required),
    'variabili_richieste_mancanti', missing_req,
    'prima_ora', first_h,
    'ultima_ora', last_h,
    'ore_storiche', n_hist,
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
    'ore_per_variabile', per_var,
    'ultimo_aggiornamento', last_ok.completed_at,
    'ultimo_errore', case when last_run.status = 'errore' then jsonb_build_object('codice', last_run.error_code, 'il', last_run.completed_at) end
  );
end $$;
