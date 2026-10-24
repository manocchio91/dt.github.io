-- MODELLO (non è una migrazione): pianificazione notturna della pulizia a fine conservazione.
-- Da eseguire nell'SQL editor del progetto Supabase DOPO aver:
--   1. pubblicato la funzione:  npx supabase functions deploy media-retention
--   2. impostato il segreto:    npx supabase secrets set RETENTION_CRON_SECRET=<valore casuale lungo>
--   3. salvato lo stesso valore nel Vault:  select vault.create_secret('<valore>', 'retention_cron_secret');
-- Richiede le estensioni pg_cron e pg_net (Database → Extensions). Nessun segreto in questo file.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'mdt-media-retention',
  '15 2 * * *',  -- ogni notte alle 02:15 UTC
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/media-retention',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'retention_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
