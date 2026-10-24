-- Micro Digital Twin — B-124 (validazione server-side) e B-125 (conservazione).
--
-- Da questa migrazione:
-- * un file caricato resta in QUARANTENA (status 'caricamento') finché il gateway
--   server-side (Edge Function media-gateway, chiave di servizio) non ne verifica
--   byte, tipo reale, dimensione, impronta e metadati; solo il servizio lo rende 'attivo';
-- * i client NON possono più leggere né firmare oggetti dello storage: gli URL firmati
--   li crea solo il gateway, dopo aver registrato la consultazione con il token
--   dell'utente (un client modificato non può saltare il registro);
-- * l'eliminazione degli amministratori e la pulizia a fine conservazione passano dal servizio.
-- Nessuna scansione antivirus è presente (B-123).

alter table media_assets
  add column validated_at timestamptz,
  add column validation jsonb not null default '{}';

-- Il ruolo di servizio si riconosce dal claim del JWT (Supabase lo imposta per la service key).
create function app.is_service_role() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
$$;
grant execute on function app.is_service_role() to authenticated, anon;

-- ------------------------------------------------------------ guardia aggiornata
create or replace function app.guard_media() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  org organizations;
  svc boolean := app.is_service_role();
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
    if new.validated_at is not null or new.validation <> '{}'::jsonb then
      raise exception 'La validazione è assegnata solo dal servizio.';
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
    if (new.validated_at is distinct from old.validated_at or new.validation is distinct from old.validation) and not svc then
      raise exception 'La validazione è assegnata solo dal servizio.';
    end if;
    if new.retention_until is distinct from old.retention_until then
      if not (svc or app.has_role(old.organization_id, 'admin')) then
        raise exception 'Solo un amministratore modifica la data di fine conservazione.';
      end if;
      if new.retention_until < current_date then
        raise exception 'La fine conservazione non può essere nel passato.';
      end if;
    end if;
    if new.status <> old.status then
      if old.status = 'caricamento' and new.status = 'attivo' then
        if not svc then raise exception 'Il file esce dalla quarantena solo dopo la validazione del server.'; end if;
        if not app.media_object_exists(old.storage_path) then raise exception 'Oggetto non presente nello storage.'; end if;
      elsif old.status = 'attivo' and new.status = 'eliminazione_in_corso' then
        if not (svc or app.has_role(old.organization_id, 'admin')) then raise exception 'Solo un amministratore può eliminare i file.'; end if;
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

-- ------------------------------------------------------------ audit aggiornato
create or replace function app.audit_media() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  act text;
  m media_assets;
  svc boolean := app.is_service_role();
begin
  if tg_op = 'DELETE' then
    m := old;
    act := case when old.status = 'caricamento' then 'caricamento_scartato' else 'eliminazione_completata' end;
  elsif new.status = 'attivo' and old.status = 'caricamento' then
    m := new;
    act := 'validazione_superata';
  elsif new.status = 'eliminazione_in_corso' and old.status = 'attivo' then
    m := new;
    act := case when svc and new.retention_until is not null and new.retention_until < current_date then 'eliminazione_per_scadenza' else 'eliminazione_avviata' end;
  elsif new.retention_until is distinct from old.retention_until then
    m := new;
    act := 'modifica_conservazione';
  else
    m := new;
    act := 'modifica_contesto';
  end if;
  insert into audit_logs (organization_id, actor_id, action, entity, entity_id, details)
  values (m.organization_id, auth.uid(), act, 'media_assets', m.id,
          jsonb_build_object('progetto', m.project_id, 'categoria', m.category, 'tipo', m.mime));
  return null;
end $$;

-- ------------------------------------------------------------ storage: nessuna lettura diretta dei client
create or replace function app.media_read_allowed(p_path text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  m media_assets := app.media_row(p_path);
begin
  -- solo l'autore vede il proprio oggetto in quarantena (per poterlo annullare);
  -- la consultazione dei file attivi passa esclusivamente dal gateway (URL firmati dal servizio)
  return m.id is not null and m.status = 'caricamento' and m.uploaded_by = auth.uid();
end $$;

create or replace function app.media_delete_allowed(p_path text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  m media_assets := app.media_row(p_path);
begin
  return m.id is not null and m.status = 'caricamento' and m.uploaded_by = auth.uid();
end $$;

drop policy media_delete on media_assets;
create policy media_delete on media_assets for delete to authenticated
  using (not app.media_object_exists(storage_path) and status = 'caricamento' and uploaded_by = auth.uid());

-- ------------------------------------------------------------ RPC per il gateway (chiamate con il token dell'utente)
-- Autorizza l'eliminazione: l'utente deve essere amministratore dell'organizzazione del file.
create function public.media_authorize_delete(p_media uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  m media_assets;
begin
  select * into m from media_assets where id = p_media;
  if m.id is null or not app.has_role(m.organization_id, 'admin') then
    raise exception 'Solo un amministratore può eliminare i file.' using errcode = '42501';
  end if;
  if m.status = 'attivo' then
    update media_assets set status = 'eliminazione_in_corso' where id = p_media;
  elsif m.status <> 'eliminazione_in_corso' then
    raise exception 'File non eliminabile in questo stato.';
  end if;
  return m.storage_path;
end $$;

-- Autorizza la conferma: solo l'autore del file in quarantena.
create function public.media_authorize_complete(p_media uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m media_assets;
begin
  select * into m from media_assets where id = p_media;
  if m.id is null or m.uploaded_by <> auth.uid() or not app.has_role(m.organization_id, 'editor') then
    raise exception 'File non trovato o non autorizzato.' using errcode = '42501';
  end if;
  return jsonb_build_object('status', m.status, 'storage_path', m.storage_path, 'mime', m.mime, 'size_bytes', m.size_bytes,
                            'sha256', m.sha256, 'original_name', m.original_name);
end $$;

-- Anteprima per gli amministratori: file in scadenza entro p_days giorni
create function public.media_expiring(p_org uuid, p_days int default 30) returns table (id uuid, project_id uuid, category text, retention_until date)
language sql stable security definer set search_path = public as $$
  select m.id, m.project_id, m.category, m.retention_until from media_assets m
   where m.organization_id = p_org and m.status = 'attivo'
     and m.retention_until <= current_date + greatest(0, least(p_days, 365))
     and app.has_role(p_org, 'admin')
   order by m.retention_until
$$;

revoke execute on function public.media_authorize_delete(uuid), public.media_authorize_complete(uuid), public.media_expiring(uuid, int) from public, anon;
grant execute on function public.media_authorize_delete(uuid), public.media_authorize_complete(uuid), public.media_expiring(uuid, int) to authenticated;
