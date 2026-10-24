-- Micro Digital Twin — correzioni dal Security Advisor di Supabase (progetto di staging, 24/10/2026).
--
-- search_path fisso per le funzioni dell'app che ne erano prive (avviso function_search_path_mutable).
--
-- NON correggibili con una migrazione (oggetti di PostGIS di proprietà di supabase_admin):
--   * public.spatial_ref_sys senza RLS e scrivibile da anon/authenticated (rls_disabled_in_public);
--   * public.st_estimatedextent SECURITY DEFINER eseguibile da anon/authenticated.
-- Un primo tentativo (ALTER TABLE ... ENABLE ROW LEVEL SECURITY) è fallito con
-- "must be owner of table spatial_ref_sys" ed è stato annullato per intero. Soluzioni possibili
-- in docs/16 §11: spostare PostGIS nello schema extensions su un database vuoto, oppure chiedere
-- al supporto Supabase la revoca dei privilegi.

alter function public.forbid_baseline_update() set search_path = public;
alter function app.try_uuid(text) set search_path = public;
alter function app.touch_user_preferences() set search_path = public;
alter function app.is_service_role() set search_path = public;
