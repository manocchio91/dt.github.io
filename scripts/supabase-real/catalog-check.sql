-- Verifica del catalogo sul progetto Supabase collegato (sola lettura, nessun dato personale).
-- Uso: npx supabase db query --linked -f scripts/supabase-real/catalog-check.sql -o json
with app_tables as (
  select c.oid, c.relname, c.relrowsecurity as rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
)
select jsonb_build_object(
  'migrazioni', (select jsonb_agg(version || ' ' || name order by version) from supabase_migrations.schema_migrations),
  'tabelle', (select jsonb_agg(jsonb_build_object('t', relname, 'rls', rls,
                'policy', (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = relname)) order by relname) from app_tables),
  'tabelle_senza_rls', (select coalesce(jsonb_agg(relname), '[]') from app_tables where not rls),
  'policy_storage_objects', (select coalesce(jsonb_agg(policyname order by policyname), '[]') from pg_policies where schemaname = 'storage' and tablename = 'objects'),
  'funzioni', (select jsonb_build_object(
      'public', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
      'app', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app'))),
  'funzioni_eseguibili_da_anon', (select coalesce(jsonb_agg(p.proname order by p.proname), '[]') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  'funzioni_servizio_eseguibili_da_authenticated', (select coalesce(jsonb_agg(p.proname), '[]') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('weather_begin_fetch', 'weather_complete_fetch', 'weather_fail_fetch', 'weather_active_locations')
        and has_function_privilege('authenticated', p.oid, 'execute')),
  'trigger', (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname = 'public'),
  'trigger_auth_users', (select coalesce(jsonb_agg(t.tgname), '[]') from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal),
  'indici', (select count(*) from pg_indexes where schemaname = 'public'),
  'vincoli', (select jsonb_object_agg(contype, n) from (select con.contype, count(*) n from pg_constraint con join pg_namespace ns on ns.oid = con.connamespace where ns.nspname = 'public' group by con.contype) x),
  'bucket', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'public', public, 'limite_byte', file_size_limit, 'mime', allowed_mime_types)), '[]') from storage.buckets),
  'estensioni', (select jsonb_agg(extname || ' ' || extversion || ' in ' || extnamespace::regnamespace::text order by extname) from pg_extension where extname in ('postgis', 'pgcrypto', 'pg_cron', 'pg_net')),
  'righe', jsonb_build_object(
      'organizations', (select count(*) from organizations),
      'projects', (select count(*) from projects),
      'forecast_model_versions', (select count(*) from forecast_model_versions),
      'weather_locations', (select count(*) from weather_locations)),
  'cron_job', (select case when exists (select 1 from pg_extension where extname = 'pg_cron') then 'pg_cron installato' else 'pg_cron non installato' end)
) as verifica;
