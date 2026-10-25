-- Controlli dopo la migrazione 0010 e la pulizia dei dati di prova (sola lettura).
select jsonb_build_object(
  'migrazioni', (select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
  'postgis', (select extversion || ' @ ' || extnamespace::regnamespace::text from pg_extension where extname = 'postgis'),
  'public_spatial_ref_sys', to_regclass('public.spatial_ref_sys') is not null,
  'tabelle_app', (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'),
  'tabelle_senza_rls', (select coalesce(jsonb_agg(relname), '[]') from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity),
  'last_admin_trigger', (select jsonb_build_object('differibile', tgdeferrable, 'differito', tginitdeferred) from pg_trigger where tgname = 'memberships_last_admin'),
  'funzioni_con_40001', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app') and p.prosrc like '%40001%'),
  'delete_organization_anon', has_function_privilege('anon', 'public.delete_organization(uuid,text)', 'execute'),
  'fk_users_bloccanti', (select coalesce(jsonb_agg(conrelid::regclass::text || '.' || conname), '[]') from pg_constraint where contype = 'f' and confrelid = 'public.users'::regclass and confdeltype not in ('c', 'n')),
  'audit', jsonb_build_object(
      'righe', (select count(*) from audit_logs),
      'con_organizzazione', (select count(*) from audit_logs where organization_id is not null),
      'con_attore', (select count(*) from audit_logs where actor_id is not null),
      'con_email_nei_dettagli', (select count(*) from audit_logs where details::text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}')),
  'righe', jsonb_build_object('auth_users', (select count(*) from auth.users), 'users', (select count(*) from public.users), 'organizations', (select count(*) from organizations),
      'projects', (select count(*) from projects), 'weather_locations', (select count(*) from weather_locations), 'storage_objects', (select count(*) from storage.objects),
      'catalogo', (select count(*) from forecast_model_versions), 'bucket', (select jsonb_agg(id) from storage.buckets))
) as verifica;
