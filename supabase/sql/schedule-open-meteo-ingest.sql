-- GESTIONE (non è una migrazione) del job Open-Meteo creato dalla migrazione
-- 20261025000011_open_meteo_schedule.sql (0 */3 * * *, UTC). Non ricreare il job a mano.
--
-- Prerequisiti, una volta per progetto (nessun valore in questo file):
--   1. npx supabase functions deploy open-meteo-ingest --no-verify-jwt
--   2. npx supabase secrets set --env-file <file locale escluso da Git con OPEN_METEO_CRON_SECRET e ALLOWED_ORIGIN>
--   3. nel Vault, con gli stessi valori:
--        select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1/open-meteo-ingest', 'open_meteo_ingest_url');
--        select vault.create_secret('<stesso valore di OPEN_METEO_CRON_SECRET>', 'open_meteo_cron_secret');
--   4. npx supabase db push (applica la 0011: estensioni e job)
-- Senza i due valori nel Vault il job gira ma non chiama nulla.

-- stato (solo ruolo di servizio, nessun segreto)
select public.weather_schedule_status();

-- sospendere / riattivare
-- update cron.job set active = false where jobname = 'mdt-open-meteo-ingest';
-- update cron.job set active = true  where jobname = 'mdt-open-meteo-ingest';

-- rimuovere
-- select cron.unschedule('mdt-open-meteo-ingest');

-- eseguire ora con lo stesso meccanismo del job (stessa richiesta autenticata dal Vault)
-- do $$ begin execute (select command from cron.job where jobname = 'mdt-open-meteo-ingest'); end $$;

-- monitorare
-- select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'mdt-open-meteo-ingest') order by start_time desc limit 20;
-- select id, status_code, timed_out, left(content, 300), created from net._http_response order by id desc limit 20;
-- select location_id, trigger, status, error_code, points_count, requested_at from weather_fetch_runs order by requested_at desc limit 50;
