-- MODELLO (non è una migrazione): acquisizione Open-Meteo ogni 3 ore per le località attive.
-- Da eseguire nell'SQL editor del progetto Supabase DOPO aver:
--   1. pubblicato la funzione:   npx supabase functions deploy open-meteo-ingest
--   2. impostato il segreto:     npx supabase secrets set OPEN_METEO_CRON_SECRET=<valore casuale lungo>
--   3. salvato URL e segreto nel Vault (nessun valore in questo file):
--        select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1/open-meteo-ingest', 'open_meteo_ingest_url');
--        select vault.create_secret('<stesso valore del punto 2>', 'open_meteo_cron_secret');
-- Richiede le estensioni pg_cron e pg_net (Database → Extensions).
-- Frequenza: ogni 3 ore al minuto 7 (mai ogni minuto). La funzione acquisisce solo weather_locations attive.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'mdt-open-meteo-ingest',
  '7 */3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'open_meteo_ingest_url'),
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'open_meteo_cron_secret')
    ),
    body := '{"all_active": true}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- Gestione del job (vedi docs/16-open-meteo-supabase.md):
--   disabilitare:   select cron.unschedule('mdt-open-meteo-ingest');
--   sospendere:     update cron.job set active = false where jobname = 'mdt-open-meteo-ingest';
--   rieseguire ora: (stessa net.http_post qui sopra, eseguita a mano nell'SQL editor)
--   monitorare:     select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'mdt-open-meteo-ingest') order by start_time desc limit 20;
--                   select id, status, status_code, created from net._http_response order by created desc limit 20;
--                   select location_id, trigger, status, error_code, points_count, requested_at from weather_fetch_runs order by requested_at desc limit 50;
