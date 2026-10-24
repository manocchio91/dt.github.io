-- Micro Digital Twin — sposta PostGIS dallo schema public allo schema extensions
-- (raccomandazione Supabase; risolve rls_disabled_in_public su spatial_ref_sys, extension_in_public
-- e st_estimatedextent esposta via REST).
--
-- Sicurezza della migrazione:
-- * controllo iniziale: procede solo se PostGIS è in public e le colonne geometriche sono
--   esattamente quelle dell'inventario (scripts/supabase-real/postgis-inventory.sql);
-- * le geometrie sono conservate in EWKB (con SRID) in una tabella temporanea e ripristinate;
-- * le dipendenze vengono rimosse esplicitamente, poi DROP EXTENSION SENZA CASCADE: qualsiasi
--   dipendenza non prevista blocca la migrazione invece di essere eliminata in silenzio;
-- * durante il ripristino i trigger utente delle tabelle toccate sono disattivati (niente audit
--   spurio, nessuna guardia attivata da una scrittura tecnica) e riattivati subito dopo;
-- * tutto avviene in una transazione: un errore annulla l'intera migrazione.
-- Le colonne ricreate vanno in fondo alla tabella (l'app usa sempre i nomi, mai la posizione).

-- 0 ---------------------------------------------------------------- precondizioni
do $$
declare
  v_schema text;
  v_cols text[];
  v_expected text[] := array[
    'areas.geom geometry(Polygon,4326)',
    'data_points.location geometry(Point,4326)',
    'field_observations.location geometry(Point,4326)',
    'interventions.geom geometry(Geometry,4326)',
    'media_assets.location geometry(Point,4326)',
    'parcels.geom geometry(Polygon,4326)',
    'projects.area_geom geometry(Polygon,4326)',
    'sensors.location geometry(Point,4326)',
    'verification_campaigns.points geometry(MultiPoint,4326)'
  ];
begin
  select extnamespace::regnamespace::text into v_schema from pg_extension where extname = 'postgis';
  if v_schema is distinct from 'public' then
    raise exception 'Precondizione non soddisfatta: PostGIS è nello schema % (atteso public). Migrazione già applicata?', coalesce(v_schema, '(assente)');
  end if;
  select array_agg(x order by x) into v_cols from (
  select c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) as x
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'app') and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
    and format_type(a.atttypid, a.atttypmod) ~* '(geometry|geography)' and c.relname <> 'spatial_ref_sys') cols;
  if v_cols is distinct from (select array_agg(x order by x) from unnest(v_expected) x) then
    raise exception 'Precondizione non soddisfatta: colonne geometriche diverse dall''inventario: %', v_cols;
  end if;
end $$;

-- 1 ---------------------------------------------------------------- schema di destinazione
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- 2 ---------------------------------------------------------------- copia delle geometrie (EWKB conserva lo SRID)
create temporary table _mdt_geo_backup (tbl text not null, id text not null, col text not null, ewkb bytea not null) on commit drop;
insert into _mdt_geo_backup select 'areas', id::text, 'geom', ST_AsEWKB(geom) from public.areas;
insert into _mdt_geo_backup select 'parcels', id::text, 'geom', ST_AsEWKB(geom) from public.parcels;
insert into _mdt_geo_backup select 'projects', id::text, 'area_geom', ST_AsEWKB(area_geom) from public.projects where area_geom is not null;
insert into _mdt_geo_backup select 'interventions', id::text, 'geom', ST_AsEWKB(geom) from public.interventions;
insert into _mdt_geo_backup select 'data_points', id::text, 'location', ST_AsEWKB(location) from public.data_points where location is not null;
insert into _mdt_geo_backup select 'field_observations', id::text, 'location', ST_AsEWKB(location) from public.field_observations where location is not null;
insert into _mdt_geo_backup select 'media_assets', id::text, 'location', ST_AsEWKB(location) from public.media_assets where location is not null;
insert into _mdt_geo_backup select 'sensors', id::text, 'location', ST_AsEWKB(location) from public.sensors where location is not null;
insert into _mdt_geo_backup select 'verification_campaigns', id::text, 'points', ST_AsEWKB(points) from public.verification_campaigns where points is not null;
create temporary table _mdt_geo_counts on commit drop as select tbl, count(*) as n from _mdt_geo_backup group by tbl;

-- 3 ---------------------------------------------------------------- rimozione controllata delle dipendenze
drop index public.areas_geom_idx;
drop index public.parcels_geom_idx;
drop index public.projects_area_geom_idx;
alter table public.areas drop column area_m2;                 -- generata da geom
alter table public.areas drop column geom;                    -- con areas_geom_check
alter table public.parcels drop column geom;                  -- con parcels_geom_check
alter table public.projects drop column area_geom;            -- con projects_area_geom_check (projects.area_m2 resta)
alter table public.interventions drop column geom;
alter table public.data_points drop column location;
alter table public.field_observations drop column location;   -- con field_observations_check
alter table public.media_assets drop column location;         -- con media_location_ck
alter table public.sensors drop column location;
alter table public.verification_campaigns drop column points;

-- 4 ---------------------------------------------------------------- PostGIS: da public a extensions
drop extension postgis;   -- senza CASCADE: fallisce se resta una dipendenza non prevista
create extension postgis with schema extensions;

-- 5 ---------------------------------------------------------------- colonne con tipi qualificati
alter table public.areas add column geom extensions.geometry(Polygon, 4326);
alter table public.parcels add column geom extensions.geometry(Polygon, 4326);
alter table public.projects add column area_geom extensions.geometry(Polygon, 4326);
alter table public.interventions add column geom extensions.geometry(Geometry, 4326);
alter table public.data_points add column location extensions.geometry(Point, 4326);
alter table public.field_observations add column location extensions.geometry(Point, 4326);
alter table public.media_assets add column location extensions.geometry(Point, 4326);
alter table public.sensors add column location extensions.geometry(Point, 4326);
alter table public.verification_campaigns add column points extensions.geometry(MultiPoint, 4326);

-- 6 ---------------------------------------------------------------- ripristino dei valori (trigger utente sospesi)
alter table public.areas disable trigger user;
alter table public.parcels disable trigger user;
alter table public.projects disable trigger user;
alter table public.interventions disable trigger user;
alter table public.data_points disable trigger user;
alter table public.field_observations disable trigger user;
alter table public.media_assets disable trigger user;
alter table public.sensors disable trigger user;
alter table public.verification_campaigns disable trigger user;

update public.areas t set geom = extensions.ST_GeomFromEWKB(b.ewkb) from _mdt_geo_backup b where b.tbl = 'areas' and b.id = t.id::text;
update public.parcels t set geom = extensions.ST_GeomFromEWKB(b.ewkb) from _mdt_geo_backup b where b.tbl = 'parcels' and b.id = t.id::text;
update public.projects t set area_geom = extensions.ST_GeomFromEWKB(b.ewkb) from _mdt_geo_backup b where b.tbl = 'projects' and b.id = t.id::text;
update public.interventions t set geom = extensions.ST_GeomFromEWKB(b.ewkb) from _mdt_geo_backup b where b.tbl = 'interventions' and b.id = t.id::text;
update public.data_points t set location = extensions.ST_GeomFromEWKB(b.ewkb) from _mdt_geo_backup b where b.tbl = 'data_points' and b.id = t.id::text;
update public.field_observations t set location = extensions.ST_GeomFromEWKB(b.ewkb) from _mdt_geo_backup b where b.tbl = 'field_observations' and b.id = t.id::text;
update public.media_assets t set location = extensions.ST_GeomFromEWKB(b.ewkb) from _mdt_geo_backup b where b.tbl = 'media_assets' and b.id = t.id::text;
update public.sensors t set location = extensions.ST_GeomFromEWKB(b.ewkb) from _mdt_geo_backup b where b.tbl = 'sensors' and b.id = t.id::text;
update public.verification_campaigns t set points = extensions.ST_GeomFromEWKB(b.ewkb) from _mdt_geo_backup b where b.tbl = 'verification_campaigns' and b.id = t.id::text;

alter table public.areas enable trigger user;
alter table public.parcels enable trigger user;
alter table public.projects enable trigger user;
alter table public.interventions enable trigger user;
alter table public.data_points enable trigger user;
alter table public.field_observations enable trigger user;
alter table public.media_assets enable trigger user;
alter table public.sensors enable trigger user;
alter table public.verification_campaigns enable trigger user;

-- verifica: ogni geometria salvata è stata ripristinata
do $$
declare
  r record;
  n_now bigint;
begin
  for r in select tbl, n from _mdt_geo_counts loop
    execute format('select count(*) from public.%I where %I is not null', r.tbl,
      case r.tbl when 'projects' then 'area_geom' when 'verification_campaigns' then 'points' when 'areas' then 'geom' when 'parcels' then 'geom' when 'interventions' then 'geom' else 'location' end)
      into n_now;
    if n_now <> r.n then raise exception 'Ripristino incompleto su %: % su %', r.tbl, n_now, r.n; end if;
  end loop;
end $$;

-- 7 ---------------------------------------------------------------- nullability, vincoli e colonna generata (nomi originali)
alter table public.areas alter column geom set not null;
alter table public.parcels alter column geom set not null;
alter table public.interventions alter column geom set not null;
alter table public.areas add constraint areas_geom_check check (extensions.ST_IsValid(geom));
alter table public.parcels add constraint parcels_geom_check check (extensions.ST_IsValid(geom));
alter table public.projects add constraint projects_area_geom_check check (area_geom is null or extensions.ST_IsValid(area_geom));
alter table public.field_observations add constraint field_observations_check check (location is null or location_consent);
alter table public.media_assets add constraint media_location_ck check (location is null or location_consent);
alter table public.areas add column area_m2 double precision generated always as (extensions.ST_Area(geom::extensions.geography)) stored;

-- 8 ---------------------------------------------------------------- indici spaziali
create index areas_geom_idx on public.areas using gist (geom);
create index parcels_geom_idx on public.parcels using gist (geom);
create index projects_area_geom_idx on public.projects using gist (area_geom);

-- 9 ---------------------------------------------------------------- funzioni che usano PostGIS
-- save_project chiama ST_* senza schema: search_path esplicito e fisso (public per le tabelle dell'app,
-- extensions per PostGIS). Nessun'altra funzione dell'app usa PostGIS (inventario).
alter function public.save_project(uuid, jsonb, text, integer) set search_path = public, extensions;
