-- Micro Digital Twin — Milestone 1, B-109: foto e documenti.
-- Ogni oggetto nello storage corrisponde a una riga media_assets con contesto
-- obbligatorio. Ciclo di vita: caricamento -> attivo -> eliminazione_in_corso -> (riga eliminata).
-- Le policy sostituiscono quelle generiche della migrazione 0002.

-- Impostazioni per organizzazione (limite configurabile entro il tetto del bucket)
alter table organizations
  add column media_max_bytes bigint not null default 20971520 check (media_max_bytes between 1048576 and 20971520),
  add column media_retention_years smallint not null default 5 check (media_retention_years between 1 and 30);

drop policy media_select on media_assets;
drop policy media_write on media_assets;
drop policy media_objects_select on storage.objects;
drop policy media_objects_insert on storage.objects;
drop policy media_objects_delete on storage.objects;

alter table media_assets
  add column organization_id uuid references organizations (id) on delete cascade,
  add column uploaded_by uuid references users (id),
  add column author_name text,
  add column category text,
  add column description text not null default '',
  add column observed_on date,
  add column size_bytes bigint,
  add column sha256 text,
  add column original_name text,
  add column area_ref text,
  add column zone_ref text,
  add column cell_ref text,
  add column scenario_ref text,
  add column observation_ref text,
  add column workflow_stage workflow_state not null default 'bozza',
  add column location geometry(Point, 4326),
  add column location_consent boolean not null default false,
  add column metadata_removed text[] not null default '{}',
  add column metadata_kept text[] not null default '{}',
  add column status text not null default 'caricamento',
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();

alter table media_assets
  alter column organization_id set not null,
  alter column uploaded_by set not null,
  alter column author_name set not null,
  alter column category set not null,
  alter column observed_on set not null,
  alter column size_bytes set not null,
  alter column sha256 set not null,
  alter column original_name set not null,
  alter column area_ref set not null,
  alter column retention_until set not null,
  add constraint media_category_ck check (category in ('foto_sopralluogo', 'immagine_terreno_coltura', 'documento_tecnico', 'analisi_laboratorio', 'relazione_tecnica', 'autorizzazione_allegato', 'verifica_ex_post')),
  add constraint media_mime_ck check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  add constraint media_size_ck check (size_bytes > 0 and size_bytes <= 20971520),
  add constraint media_sha_ck check (sha256 ~ '^[0-9a-f]{64}$'),
  add constraint media_status_ck check (status in ('caricamento', 'attivo', 'eliminazione_in_corso')),
  add constraint media_location_ck check (location is null or location_consent),
  add constraint media_path_ck check (
    storage_path = organization_id::text || '/' || project_id::text || '/' || id::text || '.' ||
      case mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' else 'pdf' end
  ),
  add constraint media_description_ck check (length(description) <= 2000),
  add constraint media_name_ck check (original_name ~ '^[a-z0-9._-]{1,90}$');
create unique index media_storage_path_idx on media_assets (storage_path);
create index media_project_idx on media_assets (project_id);

-- ------------------------------------------------------------- funzioni
create function app.media_object_exists(p_path text) returns boolean
language sql stable security definer set search_path = public, storage as $$
  select exists (select 1 from storage.objects where bucket_id = 'project-media' and name = p_path)
$$;

create function app.media_row(p_path text) returns media_assets
language sql stable security definer set search_path = public as $$
  select * from media_assets where storage_path = p_path
$$;

create function app.media_upload_allowed(p_path text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  m media_assets := app.media_row(p_path);
begin
  return m.id is not null and m.status = 'caricamento' and m.uploaded_by = auth.uid() and app.has_role(m.organization_id, 'editor');
end $$;

create function app.media_read_allowed(p_path text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  m media_assets := app.media_row(p_path);
begin
  if m.id is null then return false; end if;
  -- lettura per tutti i membri solo se attivo; durante il caricamento solo l'autore,
  -- durante l'eliminazione solo gli amministratori (DELETE richiede visibilità della riga)
  return (m.status = 'attivo' and app.has_role(m.organization_id, 'viewer'))
      or (m.status = 'caricamento' and m.uploaded_by = auth.uid())
      or (m.status = 'eliminazione_in_corso' and app.has_role(m.organization_id, 'admin'));
end $$;

create function app.media_delete_allowed(p_path text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  m media_assets := app.media_row(p_path);
begin
  if m.id is null then return false; end if;
  return (m.status = 'eliminazione_in_corso' and app.has_role(m.organization_id, 'admin'))
      or (m.status = 'caricamento' and m.uploaded_by = auth.uid());
end $$;

grant execute on function app.media_object_exists(text), app.media_upload_allowed(text), app.media_read_allowed(text), app.media_delete_allowed(text) to authenticated;
revoke execute on function app.media_row(text) from public, anon, authenticated;

-- Il contesto deve esistere nel documento di progetto e rispettarne l'ambito.
create function app.check_media_context(m media_assets) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  b jsonb;
  sector text;
begin
  select bundle into b from project_documents where project_id = m.project_id;
  if b is null then raise exception 'Progetto senza documento: impossibile collegare il file.'; end if;
  sector := b -> 'project' ->> 'sector';
  if b -> 'area' ->> 'id' is distinct from m.area_ref then
    raise exception 'Il file deve essere collegato all''area o alla parcella del progetto.';
  end if;
  if m.zone_ref is not null and (sector <> 'agriculture' or not exists (
      select 1 from jsonb_array_elements(coalesce(b -> 'agri' -> 'zones', '[]')) z where z ->> 'id' = m.zone_ref)) then
    raise exception 'Sottozona non valida per questo progetto.';
  end if;
  if m.cell_ref is not null and (sector <> 'urban' or m.cell_ref !~ '^r[0-9]+c[0-9]+$') then
    raise exception 'Cella non valida per questo progetto.';
  end if;
  if m.scenario_ref is not null and not exists (
      select 1 from jsonb_array_elements(coalesce(b -> 'scenarios', '[]')) s where s ->> 'id' = m.scenario_ref) then
    raise exception 'Scenario non trovato nel progetto.';
  end if;
  if m.observation_ref is not null and not exists (
      select 1 from jsonb_array_elements(coalesce(b -> 'agri' -> 'observations', '[]')) o where o ->> 'id' = m.observation_ref) then
    raise exception 'Osservazione non trovata nel progetto.';
  end if;
  if m.category = 'immagine_terreno_coltura' and sector <> 'agriculture' then
    raise exception 'Categoria disponibile solo nei progetti agricoli.';
  end if;
end $$;

create function app.guard_media() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  org organizations;
begin
  if tg_op = 'INSERT' then
    select * into org from organizations where id = new.organization_id;
    if new.organization_id is distinct from app.project_org(new.project_id) then
      raise exception 'Il file deve appartenere all''organizzazione del progetto.';
    end if;
    if new.uploaded_by is distinct from auth.uid() then raise exception 'L''autore deve essere l''utente collegato.'; end if;
    if new.status <> 'caricamento' then raise exception 'Un nuovo file parte dallo stato "caricamento".'; end if;
    if new.size_bytes > org.media_max_bytes then
      raise exception 'File oltre il limite dell''organizzazione (% byte).', org.media_max_bytes;
    end if;
    new.retention_until := coalesce(new.retention_until, (current_date + make_interval(years => org.media_retention_years))::date);
    new.created_at := now();
  else
    if new.id <> old.id or new.project_id <> old.project_id or new.organization_id <> old.organization_id
       or new.storage_path <> old.storage_path or new.mime <> old.mime or new.size_bytes <> old.size_bytes
       or new.sha256 <> old.sha256 or new.uploaded_by <> old.uploaded_by or new.created_at <> old.created_at
       or new.original_name <> old.original_name then
      raise exception 'File, autore e percorso non sono modificabili: carica un nuovo file.';
    end if;
    if new.status <> old.status then
      if old.status = 'caricamento' and new.status = 'attivo' then
        if old.uploaded_by <> auth.uid() or not app.media_object_exists(old.storage_path) then
          raise exception 'Il caricamento può essere confermato solo dall''autore, dopo l''invio del file.';
        end if;
      elsif old.status = 'attivo' and new.status = 'eliminazione_in_corso' then
        if not app.has_role(old.organization_id, 'admin') then raise exception 'Solo un amministratore può eliminare i file.'; end if;
      else
        raise exception 'Passaggio di stato non consentito (% -> %).', old.status, new.status;
      end if;
    elsif old.status = 'eliminazione_in_corso' then
      raise exception 'Il file è in eliminazione.';
    end if;
  end if;
  if new.observed_on > current_date then raise exception 'La data dell''osservazione non può essere nel futuro.'; end if;
  perform app.check_media_context(new);
  new.updated_at := now();
  return new;
end $$;

create trigger media_assets_guard before insert or update on media_assets
  for each row execute function app.guard_media();

-- Audit con informazioni minime (niente nome, descrizione o percorso del file)
create function app.audit_media() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  act text;
  m media_assets;
begin
  if tg_op = 'DELETE' then
    m := old;
    act := 'eliminazione_completata';
  elsif tg_op = 'UPDATE' and new.status = 'attivo' and old.status = 'caricamento' then
    m := new;
    act := 'caricamento';
  elsif tg_op = 'UPDATE' and new.status = 'eliminazione_in_corso' and old.status = 'attivo' then
    m := new;
    act := 'eliminazione_avviata';
  elsif tg_op = 'UPDATE' then
    m := new;
    act := 'modifica_contesto';
  else
    return null;
  end if;
  insert into audit_logs (organization_id, actor_id, action, entity, entity_id, details)
  values (m.organization_id, auth.uid(), act, 'media_assets', m.id,
          jsonb_build_object('progetto', m.project_id, 'categoria', m.category, 'tipo', m.mime));
  return null;
end $$;

create trigger media_assets_audit after update or delete on media_assets
  for each row execute function app.audit_media();

-- Consultazione: registra l'accesso e restituisce il percorso da firmare (URL breve, 60 s).
create function public.log_media_access(p_media uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  m media_assets;
begin
  select * into m from media_assets where id = p_media;
  if m.id is null or m.status <> 'attivo' or not app.has_role(m.organization_id, 'viewer') then
    raise exception 'File non disponibile.' using errcode = '42501';
  end if;
  insert into audit_logs (organization_id, actor_id, action, entity, entity_id, details)
  values (m.organization_id, auth.uid(), 'consultazione', 'media_assets', m.id, jsonb_build_object('progetto', m.project_id));
  return m.storage_path;
end $$;

-- File oltre il periodo di conservazione (per gli amministratori)
create function public.media_due_for_deletion(p_org uuid) returns table (id uuid, project_id uuid, category text, retention_until date)
language sql stable security definer set search_path = public as $$
  select m.id, m.project_id, m.category, m.retention_until from media_assets m
   where m.organization_id = p_org and m.retention_until < current_date and m.status = 'attivo'
     and app.has_role(p_org, 'admin')
$$;

revoke execute on function public.log_media_access(uuid), public.media_due_for_deletion(uuid) from public, anon;
grant execute on function public.log_media_access(uuid), public.media_due_for_deletion(uuid) to authenticated;

-- ------------------------------------------------------------------ RLS
create policy media_read on media_assets for select to authenticated
  using (app.has_role(organization_id, 'viewer') and (status <> 'caricamento' or uploaded_by = auth.uid()));
create policy media_insert on media_assets for insert to authenticated
  with check (app.has_role(organization_id, 'editor') and uploaded_by = auth.uid());
create policy media_update on media_assets for update to authenticated
  using ((uploaded_by = auth.uid() and app.has_role(organization_id, 'editor')) or app.has_role(organization_id, 'admin'))
  with check ((uploaded_by = auth.uid() and app.has_role(organization_id, 'editor')) or app.has_role(organization_id, 'admin'));
create policy media_delete on media_assets for delete to authenticated
  using (
    not app.media_object_exists(storage_path) and (
      (status = 'eliminazione_in_corso' and app.has_role(organization_id, 'admin'))
      or (status = 'caricamento' and uploaded_by = auth.uid())
    )
  );

create policy media_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'project-media' and app.media_upload_allowed(name));
create policy media_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'project-media' and app.media_read_allowed(name));
create policy media_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'project-media' and app.media_delete_allowed(name));
-- nessuna policy UPDATE: un oggetto caricato non si sovrascrive

-- Un progetto con file nello storage non si elimina finché i file non sono
-- stati eliminati (evita oggetti orfani nello storage).
create function app.guard_project_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from media_assets m where m.project_id = old.id and app.media_object_exists(m.storage_path)) then
    raise exception 'Il progetto ha ancora foto o documenti: eliminali prima di eliminare il progetto.';
  end if;
  return old;
end $$;

create trigger projects_media_guard before delete on projects
  for each row execute function app.guard_project_delete();
