-- Controlli immediati dopo la migrazione 0009 (sola lettura).
-- Uso: npx supabase db query --linked -f scripts/supabase-real/post-0009-check.sql -o json
with app_tables as (
  select c.oid, c.relname, c.relrowsecurity rls,
         (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) policy
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
),
geo as (
  select c.relname || '.' || a.attname col, format_type(a.atttypid, a.atttypmod) tipo, a.attnotnull nn,
         extensions.postgis_typmod_srid(a.atttypmod) srid
  from pg_attribute a join pg_class c on c.oid = a.attrelid
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
    and format_type(a.atttypid, a.atttypmod) ~* 'geometry|geography'
)
select jsonb_build_object(
  '01_migrazioni', (select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
  '02_postgis', (select extversion || ' @ ' || extnamespace::regnamespace::text from pg_extension where extname = 'postgis'),
  '03_public_spatial_ref_sys_esiste', to_regclass('public.spatial_ref_sys') is not null,
  '04_extensions_spatial_ref_sys_esiste', to_regclass('extensions.spatial_ref_sys') is not null,
  '05_tabelle_app', (select count(*) from app_tables),
  '06_tabelle_senza_rls_o_policy', (select coalesce(jsonb_agg(relname), '[]') from app_tables where not rls or policy = 0),
  '06_policy_public_totali', (select count(*) from pg_policies where schemaname = 'public'),
  '07_08_colonne_geometriche', (select jsonb_agg(col || ' ' || tipo || ' srid=' || srid || case when nn then ' NOT NULL' else '' end order by col) from geo),
  '09_vincoli', (select jsonb_object_agg(conname, pg_get_constraintdef(oid)) from pg_constraint
      where conname in ('areas_geom_check', 'parcels_geom_check', 'projects_area_geom_check', 'field_observations_check', 'media_location_ck')),
  '09_indici_gist', (select jsonb_object_agg(indexname, indexdef) from pg_indexes where schemaname = 'public' and indexdef ~* 'using gist'),
  '10_area_m2', (select format_type(atttypid, atttypmod) || ' generata=' || (attgenerated = 's') || ' expr=' || pg_get_expr(d.adbin, d.adrelid)
      from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = 'public.areas'::regclass and a.attname = 'area_m2'),
  '11_save_project', (select proconfig from pg_proc where oid = 'public.save_project(uuid,jsonb,text,integer)'::regprocedure),
  '12_bucket', (select jsonb_agg(jsonb_build_object('id', id, 'public', public, 'limite', file_size_limit, 'mime', allowed_mime_types)) from storage.buckets),
  '12_policy_storage', (select jsonb_agg(policyname order by policyname) from pg_policies where schemaname = 'storage'),
  '13_catalogo', (select count(*) from public.forecast_model_versions),
  '14_dati', jsonb_build_object('auth_users', (select count(*) from auth.users), 'organizations', (select count(*) from public.organizations),
      'projects', (select count(*) from public.projects), 'areas', (select count(*) from public.areas), 'weather_locations', (select count(*) from public.weather_locations),
      'media_assets', (select count(*) from public.media_assets), 'storage_objects', (select count(*) from storage.objects), 'audit_logs', (select count(*) from public.audit_logs)),
  'oggetti_postgis_in_public', jsonb_build_object(
      'tipi', (select count(*) from pg_type where typnamespace = 'public'::regnamespace and typname in ('geometry', 'geography', 'box2d', 'box3d')),
      'funzioni_st', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'st\_%'),
      'viste_geometry_columns', (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('geometry_columns', 'geography_columns'))),
  'trigger_disabilitati', (select coalesce(jsonb_agg(tgrelid::regclass::text || '.' || tgname), '[]') from pg_trigger where not tgisinternal and tgenabled = 'D')
) as verifica;
