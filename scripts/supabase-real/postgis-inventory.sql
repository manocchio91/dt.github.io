-- Inventario delle dipendenze da PostGIS (sola lettura).
-- Uso: npx supabase db query --linked -f scripts/supabase-real/postgis-inventory.sql -o json
with ext as (
  select e.oid, e.extname, e.extversion, e.extnamespace::regnamespace::text as schema, pg_get_userbyid(e.extowner) as owner
  from pg_extension e where e.extname = 'postgis'
),
members as (
  select d.classid, d.objid from pg_depend d, ext where d.refclassid = 'pg_extension'::regclass and d.refobjid = ext.oid and d.deptype = 'e'
),
direct_dependents as (
  -- oggetti NON appartenenti all'estensione che dipendono da un suo membro: sono ciò che DROP EXTENSION ... CASCADE eliminerebbe direttamente
  select distinct d.classid, d.objid, d.objsubid, d.deptype
  from pg_depend d join members m on d.refclassid = m.classid and d.refobjid = m.objid
  where not exists (select 1 from members x where x.classid = d.classid and x.objid = d.objid)
    and d.deptype in ('n', 'a')
),
geo_cols as (
  select n.nspname as schema, c.relname as tabella, a.attname as colonna, format_type(a.atttypid, a.atttypmod) as tipo,
         a.attnotnull as not_null, a.attgenerated <> '' as generata, pg_get_expr(ad.adbin, ad.adrelid) as espressione_default
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid and c.relkind in ('r', 'p', 'v', 'm')
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
  where a.attnum > 0 and not a.attisdropped
    and n.nspname not in ('pg_catalog', 'information_schema', 'extensions')
    and (format_type(a.atttypid, a.atttypmod) ~* '(geometry|geography)' or pg_get_expr(ad.adbin, ad.adrelid) ~* '\mst_[a-z0-9_]+\s*\(')
    and c.relname <> 'spatial_ref_sys'
)
select jsonb_build_object(
  'estensione', (select to_jsonb(ext) - 'oid' from ext),
  'colonne_geografiche', (select coalesce(jsonb_agg(to_jsonb(g) order by schema, tabella, colonna), '[]') from geo_cols g),
  'vincoli_check_postgis', (select coalesce(jsonb_agg(jsonb_build_object('tabella', conrelid::regclass::text, 'nome', conname, 'def', pg_get_constraintdef(oid)) order by conrelid::regclass::text, conname), '[]')
      from pg_constraint where contype = 'c' and pg_get_constraintdef(oid) ~* '\mst_[a-z0-9_]+\s*\(' and connamespace::regnamespace::text in ('public', 'app')),
  'indici_spaziali', (select coalesce(jsonb_agg(jsonb_build_object('tabella', schemaname || '.' || tablename, 'nome', indexname, 'def', indexdef) order by indexname), '[]')
      from pg_indexes where (indexdef ~* 'using (gist|spgist|brin)') and schemaname in ('public', 'app')),
  'viste', (select coalesce(jsonb_agg(c.oid::regclass::text), '[]') from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('v', 'm') and n.nspname in ('public', 'app')),
  'funzioni_che_usano_postgis', (select coalesce(jsonb_agg(jsonb_build_object('funzione', p.oid::regprocedure::text, 'search_path', p.proconfig, 'security_definer', p.prosecdef) order by p.oid::regprocedure::text), '[]')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app') and not exists (select 1 from members m where m.classid = 'pg_proc'::regclass and m.objid = p.oid)
        and (p.prosrc ~* '(\mst_[a-z0-9_]+\s*\(|\mgeometry\M|\mgeography\M|\mgeometrytype\s*\()')),
  'trigger_su_tabelle_geografiche', (select coalesce(jsonb_agg(distinct t.tgrelid::regclass::text || ': ' || t.tgname), '[]')
      from pg_trigger t where not t.tgisinternal and t.tgrelid in (select (schema || '.' || tabella)::regclass from geo_cols)),
  'policy_con_postgis', (select coalesce(jsonb_agg(schemaname || '.' || tablename || ': ' || policyname), '[]')
      from pg_policies where coalesce(qual, '') || coalesce(with_check, '') ~* '(\mst_[a-z0-9_]+\s*\(|\mgeometry\M|\mgeography\M|\mgeometrytype\s*\()'),
  'riferimenti_espliciti_public', (select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app') and p.prosrc ~* 'public\.(st_|geometry|geography)'),
  'eliminati_da_drop_cascade', (select coalesce(jsonb_agg(distinct pg_describe_object(classid, objid, objsubid) order by pg_describe_object(classid, objid, objsubid)), '[]') from direct_dependents),
  'tabelle_intere_eliminate', (select coalesce(jsonb_agg(distinct objid::regclass::text), '[]') from direct_dependents where classid = 'pg_class'::regclass and objsubid = 0
      and (select relkind from pg_class where oid = objid) in ('r', 'p')),
  -- secondo livello: oggetti che dipendono dalle colonne geometriche (eliminati insieme alle colonne)
  'dipendenti_delle_colonne', (select coalesce(jsonb_agg(distinct pg_describe_object(d.classid, d.objid, d.objsubid) || ' -> ' || coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c where d.classid = 'pg_constraint'::regclass and c.oid = d.objid), (select pg_get_indexdef(d.objid) where d.classid = 'pg_class'::regclass), '')), '[]')
      from pg_depend d join pg_attribute a on d.refclassid = 'pg_class'::regclass and a.attrelid = d.refobjid and a.attnum = d.refobjsubid
      join pg_namespace n on n.oid = (select relnamespace from pg_class where oid = a.attrelid)
      where n.nspname in ('public', 'app') and format_type(a.atttypid, a.atttypmod) ~* '(geometry|geography)' and a.attrelid <> 'public.spatial_ref_sys'::regclass
        and not (d.classid = 'pg_class'::regclass and d.objid = d.refobjid)),
  'righe', jsonb_build_object('areas', (select count(*) from public.areas), 'parcels', (select count(*) from public.parcels), 'projects_con_area', (select count(*) from public.projects where area_geom is not null))
) as inventario;
