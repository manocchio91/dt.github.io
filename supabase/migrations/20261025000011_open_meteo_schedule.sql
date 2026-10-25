-- Micro Digital Twin — pianificazione dell'acquisizione Open-Meteo ogni 3 ore (F04).
--
-- * abilita pg_cron e pg_net (se disponibili: in un ambiente senza estensioni, come PGlite nei
--   test, la pianificazione viene saltata con un avviso);
-- * crea il job "mdt-open-meteo-ingest" (0 */3 * * *, UTC) in modo idempotente: un job con lo
--   stesso nome viene sostituito, mai duplicato;
-- * URL della Edge Function e segreto del job sono letti dal Vault PER NOME a ogni esecuzione
--   (open_meteo_ingest_url, open_meteo_cron_secret): nessun valore in questo file. Se uno dei due
--   manca, il job non chiama nulla;
-- * la funzione acquisisce solo le weather_locations attive (weather_active_locations).
--
-- Stato:      select * from public.weather_schedule_status();          (solo ruolo di servizio)
-- Sospendere: update cron.job set active = false where jobname = 'mdt-open-meteo-ingest';
-- Rimuovere:  select cron.unschedule('mdt-open-meteo-ingest');

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron o pg_net non disponibili: pianificazione Open-Meteo non creata.';
    return;
  end if;
  create extension if not exists pg_cron;
  create extension if not exists pg_net with schema extensions;

  if exists (select 1 from cron.job where jobname = 'mdt-open-meteo-ingest') then
    perform cron.unschedule('mdt-open-meteo-ingest');
  end if;
  perform cron.schedule(
    'mdt-open-meteo-ingest',
    '0 */3 * * *',
    $job$
    select net.http_post(
      url := s.url,
      headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', s.secret),
      body := '{"all_active": true}'::jsonb,
      timeout_milliseconds := 120000
    )
    from (
      select (select decrypted_secret from vault.decrypted_secrets where name = 'open_meteo_ingest_url') as url,
             (select decrypted_secret from vault.decrypted_secrets where name = 'open_meteo_cron_secret') as secret
    ) s
    where s.url is not null and s.secret is not null;
    $job$
  );
end $$;

-- Stato verificabile della pianificazione, senza esporre segreti né l'URL.
create or replace function public.weather_schedule_status() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
begin
  if not app.is_service_role() then raise exception 'Riservato al servizio di acquisizione.' using errcode = '42501'; end if;
  if to_regclass('cron.job') is null then
    return jsonb_build_object('pianificazione', 'non disponibile');
  end if;
  execute $q$
    select jsonb_build_object(
      'jobs', (select count(*) from cron.job where jobname = 'mdt-open-meteo-ingest'),
      'attivo', (select bool_and(active) from cron.job where jobname = 'mdt-open-meteo-ingest'),
      'pianificazione', (select min(schedule) from cron.job where jobname = 'mdt-open-meteo-ingest'),
      'vault_url', exists (select 1 from vault.secrets where name = 'open_meteo_ingest_url'),
      'vault_segreto', exists (select 1 from vault.secrets where name = 'open_meteo_cron_secret'),
      'ultime_esecuzioni', (select coalesce(jsonb_agg(jsonb_build_object('inizio', start_time, 'esito', status, 'messaggio', left(return_message, 120)) order by start_time desc), '[]')
                            from (select d.start_time, d.status, d.return_message from cron.job_run_details d
                                  join cron.job j on j.jobid = d.jobid where j.jobname = 'mdt-open-meteo-ingest'
                                  order by d.start_time desc limit 5) x)
    )
  $q$ into r;
  return r;
end $$;
revoke all on function public.weather_schedule_status() from public, anon, authenticated;
grant execute on function public.weather_schedule_status() to service_role;
