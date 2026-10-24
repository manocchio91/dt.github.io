-- Micro Digital Twin — correzioni dal Security Advisor di Supabase (progetto di staging, 24/10/2026).
--
-- 1. spatial_ref_sys (tabella di riferimento di PostGIS nello schema public): con i privilegi
--    predefiniti di Supabase anon e authenticated potevano modificarla. Diventa di sola lettura
--    con RLS attiva (i sistemi di riferimento EPSG non sono dati personali).
-- 2. search_path fisso per le funzioni che ne erano prive.
-- 3. Funzioni PostGIS SECURITY DEFINER non usate dall'app: non eseguibili da anon e authenticated.
-- Restano per scelta: funzioni RPC SECURITY DEFINER per authenticated (controllano ruolo e
-- organizzazione al loro interno) e get_shared_project per anon (link condivisi); PostGIS nello
-- schema public (spostarlo richiede la ricreazione delle colonne geometry).

-- 1 ---------------------------------------------------------------- spatial_ref_sys
revoke insert, update, delete, truncate on table public.spatial_ref_sys from anon, authenticated;
alter table public.spatial_ref_sys enable row level security;
create policy spatial_ref_sys_read on public.spatial_ref_sys for select to anon, authenticated using (true);

-- 2 ---------------------------------------------------------------- search_path
alter function public.forbid_baseline_update() set search_path = public;
alter function app.try_uuid(text) set search_path = public;
alter function app.touch_user_preferences() set search_path = public;
alter function app.is_service_role() set search_path = public;

-- 3 ---------------------------------------------------------------- PostGIS
revoke execute on function public.st_estimatedextent(text, text) from public, anon, authenticated;
revoke execute on function public.st_estimatedextent(text, text, text) from public, anon, authenticated;
revoke execute on function public.st_estimatedextent(text, text, text, boolean) from public, anon, authenticated;
