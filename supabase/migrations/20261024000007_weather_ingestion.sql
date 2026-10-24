-- Micro Digital Twin — acquisizione meteo Open-Meteo su Supabase (F04).
--
-- * weather_locations: punti di acquisizione per progetto (urbano / agricolo);
-- * weather_fetch_runs: ogni acquisizione con provider, modello, cella effettiva, esito, hash;
-- * weather_forecast_points: previsioni orarie MAI sovrascritte (issued_at + valid_at) per backtest;
-- * weather_observations: osservazioni (sensori, inserimenti manuali, analisi Open-Meteo).
-- Regole: solo il ruolo di servizio (Edge Function open-meteo-ingest) scrive dati Open-Meteo;
-- un client non può presentarsi come Open-Meteo; un errore non cancella l'ultimo dato valido.

create type weather_scope as enum ('urban', 'agricultural');
create type weather_run_status as enum ('in_corso', 'completata', 'errore');
create type weather_run_trigger as enum ('pianificata', 'manuale');

-- ---------------------------------------------------------------- località
create table weather_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  scope weather_scope not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  elevation double precision check (elevation is null or elevation between -500 and 9000),
  timezone text not null default 'Europe/Rome' check (timezone = 'Europe/Rome'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);
create index weather_locations_active_idx on weather_locations (active) where active;

-- ------------------------------------------------------------- acquisizioni
create table weather_fetch_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  location_id uuid not null references weather_locations (id) on delete cascade,
  provider text not null default 'open_meteo' check (provider = 'open_meteo'),
  trigger weather_run_trigger not null,
  requested_by uuid references users (id) on delete set null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  status weather_run_status not null default 'in_corso',
  model_requested text not null,
  model_returned text,
  response_grid_latitude double precision,
  response_grid_longitude double precision,
  response_elevation double precision,
  generation_time_ms double precision,
  issued_at timestamptz,
  valid_from timestamptz,
  valid_to timestamptz,
  points_count int not null default 0,
  error_code text,
  error_message text check (error_message is null or length(error_message) <= 500),
  request_hash text not null check (length(request_hash) = 64)
);
-- idempotenza: la stessa richiesta (località, parametri, ora di emissione) si registra una volta;
-- un tentativo fallito non blocca il successivo
create unique index weather_fetch_runs_idem on weather_fetch_runs (location_id, request_hash) where status <> 'errore';
create index weather_fetch_runs_loc_idx on weather_fetch_runs (location_id, requested_at desc);

-- --------------------------------------------------------- previsioni orarie
create table weather_forecast_points (
  id bigserial primary key,
  organization_id uuid not null references organizations (id) on delete cascade,
  fetch_run_id uuid not null references weather_fetch_runs (id) on delete cascade,
  location_id uuid not null references weather_locations (id) on delete cascade,
  issued_at timestamptz not null,
  valid_at timestamptz not null,
  temperature_2m double precision,
  apparent_temperature double precision,
  relative_humidity_2m double precision check (relative_humidity_2m is null or relative_humidity_2m between 0 and 100),
  precipitation double precision check (precipitation is null or precipitation >= 0),
  precipitation_probability double precision check (precipitation_probability is null or precipitation_probability between 0 and 100),
  wind_speed_10m double precision check (wind_speed_10m is null or wind_speed_10m >= 0),
  wind_direction_10m double precision check (wind_direction_10m is null or wind_direction_10m between 0 and 360),
  wind_gusts_10m double precision check (wind_gusts_10m is null or wind_gusts_10m >= 0),
  shortwave_radiation double precision check (shortwave_radiation is null or shortwave_radiation >= 0),
  et0_fao_evapotranspiration double precision,
  vapour_pressure_deficit double precision,
  soil_temperature_0cm double precision,
  soil_temperature_6cm double precision,
  soil_temperature_18cm double precision,
  soil_temperature_54cm double precision,
  soil_moisture_0_to_1cm double precision,
  soil_moisture_1_to_3cm double precision,
  soil_moisture_3_to_9cm double precision,
  soil_moisture_9_to_27cm double precision,
  soil_moisture_27_to_81cm double precision,
  source text not null default 'open_meteo' check (source = 'open_meteo'),
  model text not null,
  unit_metadata jsonb not null,
  created_at timestamptz not null default now(),
  unique (fetch_run_id, valid_at),
  unique (location_id, issued_at, valid_at, model)
);
create index weather_points_loc_valid_idx on weather_forecast_points (location_id, valid_at, issued_at desc);

-- ---------------------------------------------------------------- osservazioni
create table weather_observations (
  id bigserial primary key,
  organization_id uuid not null references organizations (id) on delete cascade,
  location_id uuid not null references weather_locations (id) on delete cascade,
  observed_at timestamptz not null,
  variable text not null check (variable ~ '^[a-z0-9_]{2,40}$'),
  value double precision not null,
  unit text not null check (length(unit) between 1 and 20),
  source text not null check (source in ('open_meteo', 'sensore', 'manuale', 'dataset')),
  quality_flag text not null default 'non_verificato' check (quality_flag in ('non_verificato', 'valido', 'sospetto', 'errato', 'modellato')),
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (location_id, observed_at, variable, source)
);
create index weather_obs_loc_idx on weather_observations (location_id, variable, observed_at);

-- ------------------------------------------------------------------ guardie
create function app.guard_weather_location() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.organization_id is distinct from app.project_org(new.project_id) then
    raise exception 'La località deve appartenere all''organizzazione del progetto.';
  end if;
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id or new.project_id <> old.project_id or new.created_at <> old.created_at then
      raise exception 'Organizzazione, progetto e data di creazione non sono modificabili.';
    end if;
    new.updated_at := now();
  else
    new.created_at := now();
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger guard_weather_location before insert or update on weather_locations for each row execute function app.guard_weather_location();

-- dati Open-Meteo: solo dal ruolo di servizio; previsioni immutabili
create function app.guard_weather_provider_data() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j jsonb := to_jsonb(new);
begin
  if tg_op = 'UPDATE' and tg_table_name = 'weather_forecast_points' then
    raise exception 'Le previsioni registrate non si sovrascrivono.';
  end if;
  if tg_table_name in ('weather_fetch_runs', 'weather_forecast_points') and not app.is_service_role() then
    raise exception 'Solo la funzione di acquisizione registra dati Open-Meteo.';
  end if;
  if tg_table_name = 'weather_observations' then
    if j ->> 'source' = 'open_meteo' and not app.is_service_role() then
      raise exception 'Un client non può registrare dati con fonte Open-Meteo.';
    end if;
    if tg_op = 'UPDATE' then
      if (j - array['quality_flag']) <> (to_jsonb(old) - array['quality_flag']) then
        raise exception 'Di un''osservazione si modifica solo il flag di qualità.';
      end if;
      if old.source = 'open_meteo' and not app.is_service_role() then
        raise exception 'I dati Open-Meteo non sono modificabili dai client.';
      end if;
    elsif not app.is_service_role() then
      new.created_by := auth.uid();
    end if;
  end if;
  if tg_op = 'INSERT' and (j ->> 'organization_id')::uuid is distinct from (select organization_id from weather_locations where id = (j ->> 'location_id')::uuid) then
    raise exception 'Organizzazione incoerente con la località.';
  end if;
  return new;
end $$;
create trigger guard_weather_runs before insert or update on weather_fetch_runs for each row execute function app.guard_weather_provider_data();
create trigger guard_weather_points before insert or update on weather_forecast_points for each row execute function app.guard_weather_provider_data();
create trigger guard_weather_obs before insert or update on weather_observations for each row execute function app.guard_weather_provider_data();

-- ------------------------------------------------------------------- audit
create function app.audit_weather() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j jsonb;
  keys text[];
begin
  if tg_op = 'DELETE' then j := to_jsonb(old); else j := to_jsonb(new); end if;
  keys := case tg_table_name
    when 'weather_locations' then array['name', 'scope', 'latitude', 'longitude', 'active']
    when 'weather_fetch_runs' then array['location_id', 'trigger', 'status', 'points_count', 'error_code', 'request_hash']
    when 'weather_observations' then array['location_id', 'variable', 'source', 'quality_flag']
  end;
  insert into audit_logs (organization_id, actor_id, action, entity, entity_id, details)
  values ((j ->> 'organization_id')::uuid, auth.uid(), lower(tg_op), tg_table_name, app.try_uuid(j ->> 'id'),
          (select coalesce(jsonb_object_agg(k, j -> k), '{}'::jsonb) from unnest(keys) k));
  return null;
end $$;
create trigger audit_weather_locations after insert or update or delete on weather_locations for each row execute function app.audit_weather();
create trigger audit_weather_runs after insert or update on weather_fetch_runs for each row execute function app.audit_weather();
create trigger audit_weather_obs after insert or update on weather_observations for each row execute function app.audit_weather();

-- ---------------------------------------------------------------------- RLS
alter table weather_locations enable row level security;
alter table weather_fetch_runs enable row level security;
alter table weather_forecast_points enable row level security;
alter table weather_observations enable row level security;

create policy wloc_select on weather_locations for select to authenticated using (app.can_read_project(project_id));
create policy wloc_insert on weather_locations for insert to authenticated with check (app.can_edit_project(project_id));
create policy wloc_update on weather_locations for update to authenticated using (app.can_edit_project(project_id)) with check (app.can_edit_project(project_id));
create policy wloc_delete on weather_locations for delete to authenticated using (app.has_role(organization_id, 'admin'));

-- acquisizioni e previsioni: sola lettura per i client (nessuna policy di scrittura)
create policy wrun_select on weather_fetch_runs for select to authenticated using (app.has_role(organization_id, 'viewer'));
create policy wpts_select on weather_forecast_points for select to authenticated using (app.has_role(organization_id, 'viewer'));

create policy wobs_select on weather_observations for select to authenticated using (app.has_role(organization_id, 'viewer'));
create policy wobs_insert on weather_observations for insert to authenticated with check (app.has_role(organization_id, 'editor') and source <> 'open_meteo');
create policy wobs_update on weather_observations for update to authenticated using (app.has_role(organization_id, 'editor') and source <> 'open_meteo') with check (app.has_role(organization_id, 'editor') and source <> 'open_meteo');

-- ------------------------------------------------------- funzioni per il servizio
-- Autorizzazione di un aggiornamento manuale: utente con ruolo "modifica" e limite di frequenza.
create function public.weather_authorize_manual(p_location uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l weather_locations;
  last_manual timestamptz;
begin
  select * into l from weather_locations where id = p_location;
  if l.id is null or not app.has_role(l.organization_id, 'viewer') then
    raise exception 'Località non trovata.' using errcode = 'P0002';
  end if;
  if not app.has_role(l.organization_id, 'editor') then
    raise exception 'Serve il ruolo "modifica" per aggiornare i dati.' using errcode = '42501';
  end if;
  if not l.active then
    raise exception 'Località disattivata.' using errcode = '55000';
  end if;
  select max(requested_at) into last_manual from weather_fetch_runs where location_id = p_location and trigger = 'manuale';
  if last_manual > now() - interval '10 minutes' then
    raise exception 'Aggiornamento già richiesto alle % : riprova tra qualche minuto.', to_char(last_manual at time zone 'Europe/Rome', 'HH24:MI') using errcode = 'P0429';
  end if;
  return jsonb_build_object('id', l.id, 'user_id', auth.uid());
end $$;
revoke all on function public.weather_authorize_manual(uuid) from public, anon;
grant execute on function public.weather_authorize_manual(uuid) to authenticated;

-- Le funzioni seguenti sono riservate al ruolo di servizio (Edge Function).
create function public.weather_begin_fetch(p_location uuid, p_request_hash text, p_trigger weather_run_trigger, p_model text, p_requested_by uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l weather_locations;
  existing weather_fetch_runs;
  r weather_fetch_runs;
begin
  if not app.is_service_role() then raise exception 'Riservato al servizio di acquisizione.' using errcode = '42501'; end if;
  select * into l from weather_locations where id = p_location;
  if l.id is null then raise exception 'Località non trovata.' using errcode = 'P0002'; end if;
  if not l.active then raise exception 'Località disattivata.' using errcode = '55000'; end if;
  select * into existing from weather_fetch_runs where location_id = p_location and request_hash = p_request_hash and status <> 'errore';
  if existing.id is not null then
    return jsonb_build_object('duplicate', true, 'run', to_jsonb(existing), 'location', to_jsonb(l));
  end if;
  insert into weather_fetch_runs (organization_id, location_id, trigger, requested_by, model_requested, request_hash)
  values (l.organization_id, l.id, p_trigger, p_requested_by, p_model, p_request_hash) returning * into r;
  return jsonb_build_object('duplicate', false, 'run', to_jsonb(r), 'location', to_jsonb(l));
end $$;

-- Registrazione atomica: esito, previsioni (mai sovrascritte) e analisi delle ore passate.
create function public.weather_complete_fetch(p_run uuid, p_meta jsonb, p_points jsonb, p_observations jsonb default '[]') returns jsonb
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

  insert into weather_observations (organization_id, location_id, observed_at, variable, value, unit, source, quality_flag)
  select r.organization_id, r.location_id, o.observed_at, o.variable, o.value, o.unit, 'open_meteo', 'modellato'
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

-- Un errore chiude l'acquisizione senza toccare i dati già registrati.
create function public.weather_fail_fetch(p_run uuid, p_code text, p_message text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.is_service_role() then raise exception 'Riservato al servizio di acquisizione.' using errcode = '42501'; end if;
  update weather_fetch_runs set status = 'errore', completed_at = now(), error_code = left(p_code, 40), error_message = left(p_message, 500)
  where id = p_run and status = 'in_corso';
end $$;

-- Località attive per il job pianificato.
create function public.weather_active_locations() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id order by created_at), '{}') from weather_locations where active and app.is_service_role()
$$;

revoke all on function public.weather_begin_fetch(uuid, text, weather_run_trigger, text, uuid), public.weather_complete_fetch(uuid, jsonb, jsonb, jsonb),
  public.weather_fail_fetch(uuid, text, text), public.weather_active_locations() from public, anon, authenticated;
grant execute on function public.weather_begin_fetch(uuid, text, weather_run_trigger, text, uuid), public.weather_complete_fetch(uuid, jsonb, jsonb, jsonb),
  public.weather_fail_fetch(uuid, text, text), public.weather_active_locations() to service_role;
grant execute on function app.guard_weather_location(), app.guard_weather_provider_data(), app.audit_weather() to authenticated;
