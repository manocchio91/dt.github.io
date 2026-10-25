-- Micro Digital Twin — correzione di tre difetti emersi dai test su Supabase reale (25/10/2026).
--
-- 1. Conflitto di versione: SQLSTATE 40001 è un "serialization_failure" che PostgREST ritenta fino al
--    timeout (HTTP 504). Ora il conflitto usa PT409: PostgREST risponde subito HTTP 409, con
--    messaggio leggibile, dettagli tecnici in JSON (versioni, data) e hint stabile MDT_CONFLITTO_VERSIONE.
-- 2. Ultimo amministratore: il controllo era un trigger BEFORE che bloccava anche l'eliminazione
--    dell'intera organizzazione. Diventa un constraint trigger DEFERRABLE INITIALLY DEFERRED: a fine
--    transazione verifica che ogni organizzazione ANCORA ESISTENTE abbia almeno un amministratore.
--    L'eliminazione avviene solo con public.delete_organization (amministratore o servizio, nome
--    come conferma esplicita, nessun file presente, audit minimo).
-- 3. Cancellazione dell'utente: i riferimenti personali a public.users (che rispecchia auth.users con
--    ON DELETE CASCADE) bloccavano la cancellazione. Diventano ON DELETE SET NULL: le risorse
--    dell'organizzazione restano, il riferimento personale sparisce. Le guardie di immutabilità
--    lasciano passare SOLO l'azzeramento di riferimenti a utenti che non esistono più.
-- Nessun trigger, RLS o vincolo viene disattivato; le migrazioni 0001–0009 non sono modificate.

-- 1 ---------------------------------------------------------------- conflitto di versione (PT409)
create or replace function public.save_project(p_organization_id uuid, p_bundle jsonb, p_bundle_hash text, p_expected_version int)
returns int language plpgsql set search_path = public, extensions as $$
declare
  v_id uuid := app.try_uuid(p_bundle -> 'project' ->> 'id');
  v_geom geometry;
  v_mode project_mode := case p_bundle -> 'project' ->> 'mode' when 'pilota' then 'pilot_calibrated'::project_mode else 'demo'::project_mode end;
  v_version int;
  v_found int;
  v_found_at timestamptz;
begin
  if v_id is null then raise exception 'Identificativo di progetto non valido.'; end if;
  if not app.has_role(p_organization_id, 'editor') then
    raise exception 'Permesso negato: serve il ruolo editor nell''organizzazione.' using errcode = '42501';
  end if;
  if p_bundle -> 'area' is not null and jsonb_typeof(p_bundle -> 'area') = 'object' then
    v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_bundle -> 'area' -> 'geometry'), 4326);
    if GeometryType(v_geom) <> 'POLYGON' or not ST_IsValid(v_geom) then
      raise exception 'Geometria dell''area non valida: %', ST_IsValidReason(v_geom);
    end if;
  end if;

  if coalesce(p_expected_version, 0) = 0 then
    insert into projects (id, organization_id, name, sector, mode, is_demo_seed, owner_id, description, area_geom, area_m2, updated_by)
    values (
      v_id, p_organization_id, p_bundle -> 'project' ->> 'name', (p_bundle -> 'project' ->> 'sector')::project_sector, v_mode,
      coalesce((p_bundle -> 'project' ->> 'isDemoSeed')::boolean, false), auth.uid(), coalesce(p_bundle -> 'project' ->> 'description', ''),
      v_geom, case when v_geom is null then null else ST_Area(v_geom::geography) end, auth.uid()
    );
    insert into project_documents (project_id, organization_id, bundle, bundle_hash, version)
    values (v_id, p_organization_id, p_bundle, p_bundle_hash, 1);
    return 1;
  end if;

  update project_documents
     set bundle = p_bundle, bundle_hash = p_bundle_hash, version = p_expected_version + 1
   where project_id = v_id and organization_id = p_organization_id and version = p_expected_version
   returning version into v_version;
  if v_version is null then
    -- versione attuale visibile solo a chi può leggere il progetto (RLS): nessuna informazione su altre organizzazioni
    select version, updated_at into v_found, v_found_at from project_documents where project_id = v_id and organization_id = p_organization_id;
    raise exception using
      errcode = 'PT409',
      message = 'Il progetto è stato aggiornato da un''altra persona.',
      detail = jsonb_build_object('codice', 'MDT_CONFLITTO_VERSIONE', 'versione_attesa', p_expected_version, 'versione_trovata', v_found, 'aggiornato_il', v_found_at)::text,
      hint = 'MDT_CONFLITTO_VERSIONE';
  end if;
  update projects
     set name = p_bundle -> 'project' ->> 'name', mode = v_mode, description = coalesce(p_bundle -> 'project' ->> 'description', ''),
         area_geom = v_geom, area_m2 = case when v_geom is null then null else ST_Area(v_geom::geography) end,
         updated_at = now(), updated_by = auth.uid()
   where id = v_id;
  return v_version;
end $$;

-- la guardia del documento usava anch'essa 40001 per una versione non consecutiva
create or replace function app.guard_project_document() returns trigger
language plpgsql set search_path = public as $$
declare
  old_b jsonb;
  new_b jsonb;
  old_d jsonb;
  new_d jsonb;
  i int;
begin
  if tg_op = 'UPDATE' then
    if new.project_id <> old.project_id or new.organization_id <> old.organization_id then
      raise exception 'Progetto e organizzazione di un documento non sono modificabili.';
    end if;
    if new.version <> old.version + 1 then
      raise exception using
        errcode = 'PT409',
        message = 'Il progetto è stato aggiornato da un''altra persona.',
        detail = jsonb_build_object('codice', 'MDT_CONFLITTO_VERSIONE', 'versione_attesa', old.version + 1, 'versione_trovata', new.version)::text,
        hint = 'MDT_CONFLITTO_VERSIONE';
    end if;
    -- baseline immutabili: ogni baseline precedente deve esistere identica
    for old_b in select * from jsonb_array_elements(coalesce(old.bundle -> 'baselines', '[]')) loop
      select e into new_b from jsonb_array_elements(coalesce(new.bundle -> 'baselines', '[]')) e
        where e ->> 'id' = old_b ->> 'id';
      if new_b is null or new_b <> old_b then
        raise exception 'La baseline % è immutabile: crea una nuova versione.', old_b ->> 'id';
      end if;
    end loop;
    -- decisioni: contenuto invariato, storico solo in aggiunta
    for old_d in select * from jsonb_array_elements(coalesce(old.bundle -> 'decisions', '[]')) loop
      select e into new_d from jsonb_array_elements(coalesce(new.bundle -> 'decisions', '[]')) e
        where e ->> 'id' = old_d ->> 'id';
      if new_d is null
        or new_d -> 'rationale' is distinct from old_d -> 'rationale'
        or new_d -> 'alternatives' is distinct from old_d -> 'alternatives'
        or new_d -> 'outcome' is distinct from old_d -> 'outcome'
        or new_d -> 'author' is distinct from old_d -> 'author'
        or new_d -> 'createdAt' is distinct from old_d -> 'createdAt'
        or jsonb_array_length(coalesce(new_d -> 'history', '[]')) < jsonb_array_length(coalesce(old_d -> 'history', '[]')) then
        raise exception 'La decisione % non può essere modificata o rimossa.', old_d ->> 'id';
      end if;
      for i in 0 .. jsonb_array_length(coalesce(old_d -> 'history', '[]')) - 1 loop
        if new_d -> 'history' -> i <> old_d -> 'history' -> i then
          raise exception 'Lo storico della decisione % è append-only.', old_d ->> 'id';
        end if;
      end loop;
    end loop;
    -- registro di audit del progetto: solo in aggiunta
    for i in 0 .. jsonb_array_length(coalesce(old.bundle -> 'audit', '[]')) - 1 loop
      if new.bundle -> 'audit' -> i is distinct from old.bundle -> 'audit' -> i then
        raise exception 'Il registro di audit del progetto è append-only.';
      end if;
    end loop;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- 2 ---------------------------------------------------------------- ultimo amministratore (verifica differita)
drop trigger memberships_last_admin on public.memberships;

create or replace function app.guard_last_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- eseguita a fine transazione: le organizzazioni eliminate nella stessa transazione non sono più presenti
  if old.role = 'admin'
     and exists (select 1 from organizations o where o.id = old.organization_id)
     and not exists (select 1 from memberships m where m.organization_id = old.organization_id and m.role = 'admin') then
    raise exception 'Ogni organizzazione deve avere almeno un amministratore.' using errcode = 'P0001';
  end if;
  return null;
end $$;

create constraint trigger memberships_last_admin
  after update or delete on public.memberships
  deferrable initially deferred
  for each row execute function app.guard_last_admin();

-- audit: un'organizzazione o un utente eliminati non bloccano il registro, che resta con dati minimi
alter table public.audit_logs drop constraint audit_logs_organization_id_fkey;
alter table public.audit_logs add constraint audit_logs_organization_id_fkey
  foreign key (organization_id) references public.organizations (id) on delete set null;

create function app.audit_logs_refs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- righe scritte durante un'eliminazione a cascata: l'organizzazione o l'utente non esistono più
  if new.organization_id is not null and not exists (select 1 from organizations where id = new.organization_id) then
    new.details := coalesce(new.details, '{}'::jsonb) || jsonb_build_object('organizzazione_eliminata', new.organization_id);
    new.organization_id := null;
  end if;
  if new.actor_id is not null and not exists (select 1 from users where id = new.actor_id) then
    new.actor_id := null;
  end if;
  return new;
end $$;
create trigger audit_logs_refs before insert on public.audit_logs for each row execute function app.audit_logs_refs();

-- eliminazione esplicita dell'organizzazione (impostazioni amministrative, non nel percorso ordinario)
create function public.delete_organization(p_org uuid, p_confirm_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o organizations;
  n_media bigint;
  n_obj bigint;
  summary jsonb;
  n_deleted int;
begin
  select * into o from organizations where id = p_org;
  if o.id is null or not (app.is_service_role() or app.has_role(p_org, 'admin')) then
    raise exception 'Organizzazione non trovata o permesso negato.' using errcode = '42501';
  end if;
  if p_confirm_name is distinct from o.name then
    raise exception 'Conferma non valida: scrivi esattamente il nome dell''organizzazione.' using errcode = '22023';
  end if;
  -- i file nello storage si eliminano dal gateway (oggetti e schede): con file presenti l'eliminazione si ferma
  select count(*) into n_media from media_assets where organization_id = p_org;
  select count(*) into n_obj from storage.objects where bucket_id = 'project-media' and (storage.foldername(name))[1] = p_org::text;
  if n_media > 0 or n_obj > 0 then
    raise exception 'Elimina prima i file dell''organizzazione (% schede, % oggetti nello storage).', n_media, n_obj using errcode = '55000';
  end if;
  summary := jsonb_build_object(
    'progetti', (select count(*) from projects where organization_id = p_org),
    'membri', (select count(*) from memberships where organization_id = p_org),
    'localita_meteo', (select count(*) from weather_locations where organization_id = p_org),
    'esecuzioni_previsione', (select count(*) from forecast_runs where organization_id = p_org));
  delete from organizations where id = p_org;
  get diagnostics n_deleted = row_count;
  if n_deleted <> 1 then raise exception 'Eliminazione non avvenuta.'; end if;
  -- audit minimo, conservato senza legame all'organizzazione eliminata
  insert into audit_logs (organization_id, actor_id, action, entity, entity_id, details)
  values (null, auth.uid(), 'delete', 'organizations', p_org, summary || jsonb_build_object('servizio', app.is_service_role()));
  return summary;
end $$;
revoke all on function public.delete_organization(uuid, text) from public, anon;
grant execute on function public.delete_organization(uuid, text) to authenticated, service_role;

-- 3 ---------------------------------------------------------------- cancellazione dell'utente
-- Azzeramento consentito solo per riferimenti a utenti che non esistono più (eseguito dal database durante la cascata).
create function app.only_deleted_user_refs_nulled(o jsonb, n jsonb, cols text[]) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  c text;
  changed boolean := false;
begin
  if (o - cols) is distinct from (n - cols) then return false; end if;
  foreach c in array cols loop
    if (o ->> c) is distinct from (n ->> c) then
      if (n ->> c) is not null or exists (select 1 from users where id = (o ->> c)::uuid) then return false; end if;
      changed := true;
    end if;
  end loop;
  return changed;
end $$;
grant execute on function app.only_deleted_user_refs_nulled(jsonb, jsonb, text[]) to authenticated, anon, service_role;

-- riferimenti personali: ON DELETE SET NULL (i campi obbligatori diventano facoltativi)
alter table public.forecast_thresholds alter column set_by drop not null;
alter table public.media_assets alter column uploaded_by drop not null;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('approval_events', 'actor_id', 'approval_events_actor_id_fkey'),
    ('areas', 'owner_id', 'areas_owner_id_fkey'),
    ('audit_logs', 'actor_id', 'audit_logs_actor_id_fkey'),
    ('decisions', 'author_id', 'decisions_author_id_fkey'),
    ('forecast_alerts', 'reviewed_by', 'forecast_alerts_reviewed_by_fkey'),
    ('forecast_backtests', 'executed_by', 'forecast_backtests_executed_by_fkey'),
    ('forecast_runs', 'started_by', 'forecast_runs_started_by_fkey'),
    ('forecast_thresholds', 'set_by', 'forecast_thresholds_set_by_fkey'),
    ('media_assets', 'uploaded_by', 'media_assets_uploaded_by_fkey'),
    ('project_documents', 'updated_by', 'project_documents_updated_by_fkey'),
    ('projects', 'owner_id', 'projects_owner_id_fkey'),
    ('projects', 'updated_by', 'projects_updated_by_fkey'),
    ('shared_links', 'created_by', 'shared_links_created_by_fkey'),
    ('shared_links', 'revoked_by', 'shared_links_revoked_by_fkey')
  ) as t(tbl, col, con) loop
    execute format('alter table public.%I drop constraint %I', r.tbl, r.con);
    execute format('alter table public.%I add constraint %I foreign key (%I) references public.users (id) on delete set null', r.tbl, r.con, r.col);
  end loop;
end $$;

-- guardie di immutabilità: separate per inserimento e modifica; la modifica salta la guardia SOLO
-- quando l'unico cambiamento è l'azzeramento di riferimenti a utenti eliminati
drop trigger project_documents_guard on public.project_documents;
create trigger project_documents_guard before insert on public.project_documents for each row execute function app.guard_project_document();
create trigger project_documents_guard_upd before update on public.project_documents for each row
  when (not app.only_deleted_user_refs_nulled(to_jsonb(old), to_jsonb(new), array['updated_by'])) execute function app.guard_project_document();

drop trigger media_assets_guard on public.media_assets;
create trigger media_assets_guard before insert on public.media_assets for each row execute function app.guard_media();
create trigger media_assets_guard_upd before update on public.media_assets for each row
  when (not app.only_deleted_user_refs_nulled(to_jsonb(old), to_jsonb(new), array['uploaded_by'])) execute function app.guard_media();

drop trigger guard_forecast_run on public.forecast_runs;
create trigger guard_forecast_run before insert on public.forecast_runs for each row execute function app.guard_forecast_run();
create trigger guard_forecast_run_upd before update on public.forecast_runs for each row
  when (not app.only_deleted_user_refs_nulled(to_jsonb(old), to_jsonb(new), array['started_by'])) execute function app.guard_forecast_run();

drop trigger guard_forecast_threshold on public.forecast_thresholds;
create trigger guard_forecast_threshold before insert on public.forecast_thresholds for each row execute function app.guard_forecast_threshold();
create trigger guard_forecast_threshold_upd before update on public.forecast_thresholds for each row
  when (not app.only_deleted_user_refs_nulled(to_jsonb(old), to_jsonb(new), array['set_by'])) execute function app.guard_forecast_threshold();

drop trigger guard_forecast_alert on public.forecast_alerts;
create trigger guard_forecast_alert before insert on public.forecast_alerts for each row execute function app.guard_forecast_alert();
create trigger guard_forecast_alert_upd before update on public.forecast_alerts for each row
  when (not app.only_deleted_user_refs_nulled(to_jsonb(old), to_jsonb(new), array['reviewed_by'])) execute function app.guard_forecast_alert();

drop trigger guard_weather_runs on public.weather_fetch_runs;
create trigger guard_weather_runs before insert on public.weather_fetch_runs for each row execute function app.guard_weather_provider_data();
create trigger guard_weather_runs_upd before update on public.weather_fetch_runs for each row
  when (not app.only_deleted_user_refs_nulled(to_jsonb(old), to_jsonb(new), array['requested_by'])) execute function app.guard_weather_provider_data();

drop trigger guard_weather_obs on public.weather_observations;
create trigger guard_weather_obs before insert on public.weather_observations for each row execute function app.guard_weather_provider_data();
create trigger guard_weather_obs_upd before update on public.weather_observations for each row
  when (not app.only_deleted_user_refs_nulled(to_jsonb(old), to_jsonb(new), array['created_by'])) execute function app.guard_weather_provider_data();
