-- Istantanea logica dello schema dell'app (sola lettura): definizioni sufficienti a confrontare
-- prima/dopo una migrazione e a ricostruire gli oggetti. Non contiene dati né credenziali.
-- Uso: npx supabase db query --linked -f scripts/supabase-real/schema-snapshot.sql -o json > <cartella fuori dal repository>
select jsonb_build_object(
  'migrazioni', (select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
  'estensioni', (select jsonb_object_agg(extname, extversion || ' @ ' || extnamespace::regnamespace::text) from pg_extension),
  'tabelle', (select jsonb_agg(c.oid::regclass::text order by 1) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'app') and c.relkind = 'r'),
  'colonne', (select jsonb_object_agg(k, v) from (
      select c.relname || '.' || a.attname k, format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' NOT NULL' else '' end
             || coalesce(' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid), '') || case when a.attgenerated = 's' then ' GENERATED' else '' end v
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
      where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped and c.relname <> 'spatial_ref_sys') x),
  'vincoli', (select jsonb_object_agg(conrelid::regclass::text || '.' || conname, pg_get_constraintdef(oid)) from pg_constraint
      where connamespace::regnamespace::text = 'public' and conrelid <> 0 and conrelid::regclass::text <> 'spatial_ref_sys'),
  'indici', (select jsonb_object_agg(indexname, indexdef) from pg_indexes where schemaname = 'public' and tablename <> 'spatial_ref_sys'),
  'funzioni', (select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) || ' ' || coalesce(array_to_string(p.proconfig, ','), '') || case when p.prosecdef then ' SECURITY DEFINER' else '' end)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app') and p.prokind = 'f' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  'trigger', (select jsonb_object_agg(t.tgrelid::regclass::text || '.' || t.tgname, pg_get_triggerdef(t.oid) || ' [' || t.tgenabled::text || ']') from pg_trigger t
      join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname in ('public', 'auth', 'storage') and (n.nspname = 'public' or t.tgname = 'on_auth_user_created')),
  'policy', (select jsonb_object_agg(schemaname || '.' || tablename || '.' || policyname, cmd || ' ' || array_to_string(roles, ',') || ' USING ' || coalesce(qual, '-') || ' CHECK ' || coalesce(with_check, '-'))
      from pg_policies where schemaname in ('public', 'storage')),
  'rls', (select jsonb_object_agg(c.relname, c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'),
  'privilegi_tabelle', (select jsonb_object_agg(table_name || ':' || grantee, privs) from (
      select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) privs from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role') group by 1, 2) g),
  'bucket', (select jsonb_agg(jsonb_build_object('id', id, 'public', public, 'limite', file_size_limit, 'mime', allowed_mime_types)) from storage.buckets),
  'righe', (select jsonb_build_object('organizations', (select count(*) from public.organizations), 'projects', (select count(*) from public.projects),
      'forecast_model_versions', (select count(*) from public.forecast_model_versions), 'weather_locations', (select count(*) from public.weather_locations), 'auth_users', (select count(*) from auth.users)))
) as istantanea;
