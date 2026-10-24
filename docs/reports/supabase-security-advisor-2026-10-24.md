# Security Advisor Supabase (staging) — 24/10/2026

Progetto di staging (riferimento omesso). Comando: `supabase db advisors --linked --type security --level info`.

| Momento | ERROR | WARN | Totale |
|---|---|---|---|
| Dopo le migrazioni 0001–0007 | 1 | 23 | 24 |
| Dopo la migrazione 0008 | 1 | 19 | 20 |

## Risolto dalla 0008

- `function_search_path_mutable` (4): `public.forbid_baseline_update`, `app.try_uuid`, `app.touch_user_preferences`, `app.is_service_role` ora con `search_path = public`.

## Restano aperti

| Livello | Controllo | Oggetto | Valutazione |
|---|---|---|---|
| ERROR | rls_disabled_in_public | `public.spatial_ref_sys` (PostGIS) | **Da risolvere.** Proprietario `supabase_admin`: `ALTER TABLE … ENABLE ROW LEVEL SECURITY` fallisce (`must be owner`), quindi non correggibile con una migrazione. Con i privilegi predefiniti `anon`/`authenticated` possono modificarla via REST. Opzioni in docs/16 §11. |
| WARN | extension_in_public | `postgis` | Si risolve con lo spostamento di PostGIS in `extensions` (stessa soluzione dell'ERROR). |
| WARN | anon_security_definer_function_executable | `st_estimatedextent` (3 firme) | Funzione PostGIS, proprietario `supabase_admin`: come sopra. |
| WARN | authenticated_security_definer_function_executable | `st_estimatedextent` (3 firme) | Come sopra. |
| WARN | anon_security_definer_function_executable | `get_shared_project` | **Voluto:** lettura di un progetto tramite link condiviso con token (hash SHA-256, scadenza, revoca). |
| WARN | authenticated_security_definer_function_executable | `create_organization`, `add_member_by_email`, `create_shared_link`, `revoke_shared_link`, `get_shared_project`, `log_media_access`, `media_authorize_complete`, `media_authorize_delete`, `media_due_for_deletion`, `media_expiring`, `weather_authorize_manual` | **Voluti:** RPC dell'app che verificano al loro interno utente, ruolo e organizzazione (testate su PGlite; accesso anonimo negato, vedi supabase-anon-check-2026-10-24.md). |

Le funzioni di registrazione dei dati meteo (`weather_begin_fetch`, `weather_complete_fetch`, `weather_fail_fetch`, `weather_active_locations`) non compaiono: non sono eseguibili né da `anon` né da `authenticated`.
