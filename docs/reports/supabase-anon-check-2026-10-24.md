# Accesso anonimo su Supabase reale — 2026-10-24

Progetto: `****.supabase.co` (riferimento mascherato). Solo chiave anon pubblica; nessun dato creato.

Esito: **44/44 controlli superati**.

| Esito | Codice | Controllo | Evidenza |
|---|---|---|---|
| OK | A-R | lettura anonima di organizations | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di memberships | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di users | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di projects | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di project_documents | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di shared_links | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di audit_logs | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di user_preferences | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di media_assets | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di forecast_runs | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di forecast_series | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di forecast_quantiles | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di forecast_thresholds | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di forecast_alerts | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di forecast_backtests | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di forecast_model_versions | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di weather_locations | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di weather_fetch_runs | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di weather_forecast_points | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di weather_observations | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di baselines | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di scenarios | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di decisions | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di sensors | HTTP 200, nessuna riga |
| OK | A-R | lettura anonima di sensor_measurements | HTTP 200, nessuna riga |
| OK | A-W | scrittura anonima in organizations | HTTP 401 |
| OK | A-W | scrittura anonima in projects | HTTP 401 |
| OK | A-W | scrittura anonima in weather_locations | HTTP 400 |
| OK | A-W | scrittura anonima in weather_observations | HTTP 400 |
| OK | A-W | scrittura anonima in weather_fetch_runs | HTTP 400 |
| OK | A-W | scrittura anonima in forecast_runs | HTTP 400 |
| OK | A-F | funzione create_organization da anonimo | HTTP 401 {"code":"42501","details":null,"hint":null,"message":"permission denied for func |
| OK | A-F | funzione add_member_by_email da anonimo | HTTP 401 {"code":"42501","details":null,"hint":null,"message":"permission denied for func |
| OK | A-F | funzione save_project da anonimo | HTTP 401 {"code":"42501","details":null,"hint":null,"message":"permission denied for func |
| OK | A-F | funzione weather_authorize_manual da anonimo | HTTP 401 {"code":"42501","details":null,"hint":null,"message":"permission denied for func |
| OK | A-F | funzione weather_begin_fetch da anonimo | HTTP 401 {"code":"42501","details":null,"hint":null,"message":"permission denied for func |
| OK | A-F | funzione weather_complete_fetch da anonimo | HTTP 401 {"code":"42501","details":null,"hint":null,"message":"permission denied for func |
| OK | A-F | funzione weather_active_locations da anonimo | HTTP 401 {"code":"42501","details":null,"hint":null,"message":"permission denied for func |
| OK | A-F | funzione log_media_access da anonimo | HTTP 401 {"code":"42501","details":null,"hint":null,"message":"permission denied for func |
| OK | A-F | funzione media_authorize_delete da anonimo | HTTP 401 {"code":"42501","details":null,"hint":null,"message":"permission denied for func |
| OK | A-S | link condiviso inesistente: nessun progetto restituito | HTTP 200 null |
| OK | A-ST | elenco anonimo del bucket project-media | HTTP 200 |
| OK | A-ST | caricamento anonimo nel bucket project-media | HTTP 400 |
| OK | A-ST | bucket non pubblico (URL pubblico non servito) | HTTP 400 |
Nota: le scritture con HTTP 400 sono respinte dai trigger di integrità (organizzazione o località
inesistenti) prima che la policy RLS venga valutata; quelle con 401 dalla RLS o dai privilegi.
In entrambi i casi nessuna riga è stata creata. Le funzioni di servizio rispondono 401 (permesso negato).
