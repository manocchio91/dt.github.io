-- Micro Digital Twin — schema core (Milestone 0)
-- PostgreSQL 15+ con PostGIS. Timestamp in UTC (timestamptz). Geometrie in EPSG:4326.
-- Non ancora collegato all'app in M0 (persistenza locale IndexedDB); vedi docs/04-schema-database.md

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- Enum ------------------------------------------------------------------------
create type data_class as enum (
  'MISURATO', 'OSSERVATO_DA_DATASET', 'STIMATO_DA_MODELLO', 'PREVISIONE',
  'SIMULATO', 'INSERITO_DALL_UTENTE', 'DATO_MANCANTE'
);
create type project_sector as enum ('urban', 'agriculture');
create type project_mode as enum ('demo', 'pilot_calibrated');
create type membership_role as enum ('viewer', 'editor', 'approver', 'admin');
create type model_maturity as enum ('demo_illustrative', 'calibrated');
create type workflow_state as enum (
  'bozza', 'validazione_tecnica', 'revisione', 'approvazione', 'esecuzione', 'monitoraggio', 'chiusura'
);
create type feature_status as enum ('operativa', 'beta', 'dimostrativa', 'roadmap', 'non_disponibile');

-- Tenant e utenti ---------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key, -- = auth.users.id
  display_name text not null,
  app_role text not null default 'guest'
    check (app_role in ('guest','tecnico_comunale','gestore_verde','agricoltore','agronomo','revisore','admin_org','admin_platform')),
  created_at timestamptz not null default now()
);

create table memberships (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role membership_role not null,
  primary key (organization_id, user_id)
);

-- Progetti e aree ---------------------------------------------------------------
create table projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  sector project_sector not null,
  mode project_mode not null default 'demo',
  is_demo_seed boolean not null default false,
  owner_id uuid references users(id),
  created_at timestamptz not null default now()
);

create table areas (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  geom geometry(Polygon, 4326) not null check (ST_IsValid(geom)),
  crs text not null default 'EPSG:4326',
  area_m2 double precision generated always as (ST_Area(geom::geography)) stored,
  is_demonstrative_geometry boolean not null default false,
  owner_id uuid references users(id),
  created_at timestamptz not null default now()
);
create index areas_geom_idx on areas using gist (geom);

create table parcels (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references areas(id) on delete cascade,
  parent_parcel_id uuid references parcels(id), -- sottozone
  name text not null,
  geom geometry(Polygon, 4326) not null check (ST_IsValid(geom)),
  crop text, cultivar text, rootstock text, spacing text, soil text,
  aspect_deg double precision, slope_pct double precision,
  irrigation_system text, irrigation_capacity_mm_day double precision,
  created_at timestamptz not null default now()
);
create index parcels_geom_idx on parcels using gist (geom);

-- Fonti e dati ------------------------------------------------------------------
create table sources (
  id uuid primary key default gen_random_uuid(),
  title text not null, publisher text, url text, license text, accessed_at timestamptz
);

create table data_sources (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references sources(id),
  name text not null,
  endpoint text,
  license text,
  spatial_resolution text,
  temporal_resolution text,
  limitations text
);

create table datasets (
  id uuid primary key default gen_random_uuid(),
  data_source_id uuid not null references data_sources(id),
  project_id uuid references projects(id) on delete cascade,
  acquired_at timestamptz not null,
  request_params jsonb not null default '{}',
  transforms jsonb not null default '[]',
  is_demo boolean not null default false
);

create table data_points (
  id bigserial primary key,
  dataset_id uuid not null references datasets(id) on delete cascade,
  variable text not null,
  unit text not null,
  observed_at timestamptz not null,
  value double precision,
  data_class data_class not null,
  location geometry(Point, 4326),
  height_m double precision,
  depth_m double precision,
  quality_flags text[] not null default '{}'
);

create table sensors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  manufacturer text, model text, serial text,
  variable text not null, unit text not null,
  location geometry(Point, 4326), height_m double precision, depth_m double precision,
  frequency text, calibration jsonb, valid_min double precision, valid_max double precision
);

create table sensor_measurements (
  id bigserial primary key,
  sensor_id uuid not null references sensors(id) on delete cascade,
  observed_at timestamptz not null,
  value double precision,
  quality_flags text[] not null default '{}',
  unique (sensor_id, observed_at)
);

-- Modelli, baseline, scenari ------------------------------------------------------
create table model_versions (
  id uuid primary key default gen_random_uuid(),
  adapter_id text not null,
  version text not null,
  kind text not null check (kind in ('urban','agriculture','cost','uncertainty')),
  maturity model_maturity not null,
  validity_scope text not null,
  required_inputs jsonb not null,
  outputs jsonb not null,
  assumptions jsonb not null,
  scientific_source text not null,
  uncertainty_method text not null,
  validation_date date,
  reviewer text,
  parent_version_id uuid references model_versions(id), -- ricalibrazione senza sovrascrittura
  calibration_notes text,
  created_at timestamptz not null default now(),
  unique (adapter_id, version),
  check (maturity = 'demo_illustrative' or (validation_date is not null and reviewer is not null))
);

create table baselines (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references areas(id) on delete cascade,
  version int not null,
  parent_baseline_id uuid references baselines(id),
  period_start date not null,
  period_end date not null,
  reference_hour_local smallint check (reference_hour_local between 0 and 23),
  timezone text not null default 'Europe/Rome',
  payload jsonb not null,  -- DataValue[] con lineage
  qa jsonb not null,
  content_hash text not null,
  locked_at timestamptz not null default now(),
  unique (area_id, version)
);

-- Immutabilità della baseline: nessun UPDATE consentito
create function forbid_baseline_update() returns trigger language plpgsql as $$
begin
  raise exception 'Le baseline sono immutabili: crea una nuova versione (parent_baseline_id).';
end $$;
create trigger baselines_immutable before update on baselines
  for each row execute function forbid_baseline_update();

create table scenarios (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  baseline_id uuid not null references baselines(id),
  model_version_id uuid not null references model_versions(id),
  label text not null, -- 'A', 'B', 'A+B', ...
  combines uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table interventions (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references scenarios(id) on delete cascade,
  type text not null,
  geom geometry(Geometry, 4326) not null,
  params jsonb not null,
  quantity double precision not null,
  unit text not null,
  timing text,
  constraints jsonb not null default '[]'
);

create table scenario_outputs (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references scenarios(id) on delete cascade,
  variable text not null,
  unit text not null,
  value double precision,
  range_low double precision,
  range_high double precision,
  spatial_resolution text,
  data_class data_class not null default 'SIMULATO',
  model_version_id uuid not null references model_versions(id),
  input_hash text not null
);

create table uncertainty_records (
  id uuid primary key default gen_random_uuid(),
  scenario_output_id uuid not null references scenario_outputs(id) on delete cascade,
  method text not null,
  is_statistical boolean not null,
  label text not null, -- 'intervallo illustrativo' se non statistico
  missing_inputs text[] not null default '{}'
);

create table cost_assumptions (
  id uuid primary key default gen_random_uuid(),
  model_version_id uuid not null references model_versions(id),
  intervention_type text not null,
  cost_category text not null check (cost_category in ('prototipo','capex','opex','acqua')),
  unit text not null,
  low double precision not null, central double precision not null, high double precision not null,
  source text not null
);

-- Decisioni e workflow ------------------------------------------------------------
create table decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  alternatives uuid[] not null,
  chosen_scenario_id uuid references scenarios(id),
  outcome text not null check (outcome in ('accettata','modificata','rifiutata','inviata_a_esperto')),
  rationale text not null check (length(rationale) >= 20),
  author_id uuid references users(id),
  state workflow_state not null default 'bozza',
  attachments jsonb not null default '[]',
  decided_at timestamptz not null default now()
);

create table approval_events (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references decisions(id) on delete cascade,
  from_state workflow_state not null,
  to_state workflow_state not null,
  actor_id uuid references users(id),
  rationale text not null,
  attachments jsonb not null default '[]',
  occurred_at timestamptz not null default now()
);

-- Osservazioni e media -------------------------------------------------------------
create table field_observations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  parcel_id uuid references parcels(id),
  observed_at timestamptz not null,
  category text not null,
  note text,
  location geometry(Point, 4326), -- solo con consenso esplicito
  location_consent boolean not null default false,
  check (location is null or location_consent)
);

create table media_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  observation_id uuid references field_observations(id),
  storage_path text not null,
  mime text not null,
  exif_stripped boolean not null default true,
  retention_until date,
  deleted_at timestamptz
);

-- Verifica ex-post ----------------------------------------------------------------
create table verification_campaigns (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references scenarios(id),
  variables text[] not null,
  points geometry(MultiPoint, 4326),
  period_start date not null, period_end date not null,
  frequency text not null,
  homogeneity_criteria jsonb not null,
  results jsonb not null default '[]', -- previsto, osservato, scarto per variabile
  possible_causes text,
  lessons_learned text,
  corrective_action text,
  proposed_model_version_id uuid references model_versions(id)
);

-- Report, casi studio, audit -------------------------------------------------------
create table reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  format text not null check (format in ('pdf','csv','geojson','json')),
  scenario_hash text not null,
  created_at timestamptz not null default now(),
  storage_path text
);

create table case_studies (
  id uuid primary key default gen_random_uuid(),
  place text not null, scale text, problem text, approach text, data text, metric text,
  declared_result text, source_id uuid references sources(id), limits text, transferability text
);

create table audit_logs (
  id bigserial primary key,
  organization_id uuid references organizations(id),
  actor_id uuid references users(id),
  action text not null,
  entity text not null,
  entity_id uuid,
  occurred_at timestamptz not null default now(),
  details jsonb not null default '{}'
);

-- Row Level Security (tenant) — politiche dettagliate in M1
alter table projects enable row level security;
alter table areas enable row level security;
alter table baselines enable row level security;
alter table scenarios enable row level security;
alter table decisions enable row level security;
