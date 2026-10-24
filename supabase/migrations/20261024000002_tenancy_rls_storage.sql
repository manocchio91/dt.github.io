-- Micro Digital Twin — Milestone 1: tenant, ruoli, RLS, documenti di progetto, link condivisi, storage.
-- Presuppone gli schemi Supabase `auth` (auth.users, auth.uid()) e `storage` (storage.buckets, storage.objects).
-- Ruoli applicativi per organizzazione: viewer < editor < approver < admin (ordine dell'enum membership_role).

create schema if not exists app;
grant usage on schema app to authenticated, anon;

-- ---------------------------------------------------------------- utenti
alter table users
  add constraint users_auth_fk foreign key (id) references auth.users (id) on delete cascade;

create function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- --------------------------------------------------------------- progetti
alter table projects
  add column description text not null default '',
  add column area_geom geometry(Polygon, 4326) check (area_geom is null or ST_IsValid(area_geom)),
  add column area_m2 double precision,
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid references users (id);
create index projects_org_idx on projects (organization_id);
create index projects_area_geom_idx on projects using gist (area_geom);

-- Documento di progetto (ProjectBundle del dominio). Le regole di integrità
-- (baseline immutabili, decisioni e audit append-only, versione) sono imposte dal trigger.
create table project_documents (
  project_id uuid primary key references projects (id) on delete cascade,
  organization_id uuid not null references organizations (id) on delete cascade,
  bundle jsonb not null,
  bundle_hash text not null,
  version int not null default 1 check (version >= 1),
  updated_by uuid references users (id),
  updated_at timestamptz not null default now(),
  check (bundle -> 'project' ->> 'id' = project_id::text)
);
create index project_documents_org_idx on project_documents (organization_id);

-- ------------------------------------------------------ funzioni di supporto
create function app.try_uuid(t text) returns uuid language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

create function app.user_role(p_org uuid) returns membership_role
language sql stable security definer set search_path = public as $$
  select role from memberships where organization_id = p_org and user_id = auth.uid()
$$;

create function app.has_role(p_org uuid, p_min membership_role) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role >= p_min from memberships where organization_id = p_org and user_id = auth.uid()), false)
$$;

create function app.project_org(p_project uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select organization_id from projects where id = p_project
$$;

create function app.can_read_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role(app.project_org(p_project), 'viewer')
$$;

create function app.can_edit_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role(app.project_org(p_project), 'editor')
$$;

grant execute on all functions in schema app to authenticated;

-- -------------------------------------------------- guardia sul documento
create function app.guard_project_document() returns trigger
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
      raise exception 'Conflitto di versione: atteso %, ricevuto %', old.version + 1, new.version using errcode = '40001';
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

create trigger project_documents_guard before insert or update on project_documents
  for each row execute function app.guard_project_document();

-- ---------------------------------------------------------------- audit
create function app.audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec record;
  org uuid;
begin
  if tg_op = 'DELETE' then rec := old; else rec := new; end if;
  org := case tg_table_name
    when 'projects' then (to_jsonb(rec) ->> 'organization_id')::uuid
    when 'project_documents' then (to_jsonb(rec) ->> 'organization_id')::uuid
    when 'memberships' then (to_jsonb(rec) ->> 'organization_id')::uuid
    when 'shared_links' then (to_jsonb(rec) ->> 'organization_id')::uuid
  end;
  insert into audit_logs (organization_id, actor_id, action, entity, entity_id, details)
  values (
    org, auth.uid(), lower(tg_op), tg_table_name,
    coalesce(app.try_uuid(to_jsonb(rec) ->> 'id'), app.try_uuid(to_jsonb(rec) ->> 'project_id'), app.try_uuid(to_jsonb(rec) ->> 'user_id')),
    case tg_table_name
      when 'project_documents' then jsonb_build_object('version', to_jsonb(rec) -> 'version')
      when 'memberships' then jsonb_build_object('user_id', to_jsonb(rec) -> 'user_id', 'role', to_jsonb(rec) -> 'role')
      else '{}'::jsonb
    end
  );
  return null;
end $$;

-- --------------------------------------------------- membri e organizzazioni
create function app.guard_last_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE' or new.role <> 'admin') and old.role = 'admin'
     and not exists (select 1 from memberships m where m.organization_id = old.organization_id and m.role = 'admin' and m.user_id <> old.user_id) then
    raise exception 'Ogni organizzazione deve avere almeno un amministratore.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger memberships_last_admin before update or delete on memberships
  for each row execute function app.guard_last_admin();

create function public.create_organization(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then raise exception 'Autenticazione richiesta.'; end if;
  if length(trim(p_name)) < 2 then raise exception 'Nome organizzazione troppo corto.'; end if;
  insert into organizations (name) values (trim(p_name)) returning id into v_org;
  insert into memberships (organization_id, user_id, role) values (v_org, auth.uid(), 'admin');
  return v_org;
end $$;

create function public.add_member_by_email(p_org uuid, p_email text, p_role membership_role) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  if not app.has_role(p_org, 'admin') then raise exception 'Solo un amministratore può aggiungere membri.'; end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then raise exception 'Nessun utente registrato con questa email.'; end if;
  insert into memberships (organization_id, user_id, role) values (p_org, v_user, p_role)
    on conflict (organization_id, user_id) do update set role = excluded.role;
  return v_user;
end $$;

-- -------------------------------------------------- salvataggio progetto
-- security invoker: RLS si applica. Ritorna la nuova versione.
create function public.save_project(p_organization_id uuid, p_bundle jsonb, p_bundle_hash text, p_expected_version int)
returns int language plpgsql set search_path = public as $$
declare
  v_id uuid := app.try_uuid(p_bundle -> 'project' ->> 'id');
  v_geom geometry;
  v_mode project_mode := case p_bundle -> 'project' ->> 'mode' when 'pilota' then 'pilot_calibrated'::project_mode else 'demo'::project_mode end;
  v_version int;
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
    raise exception 'Conflitto: il progetto è stato modificato da un altro utente o non è accessibile.' using errcode = '40001';
  end if;
  update projects
     set name = p_bundle -> 'project' ->> 'name', mode = v_mode, description = coalesce(p_bundle -> 'project' ->> 'description', ''),
         area_geom = v_geom, area_m2 = case when v_geom is null then null else ST_Area(v_geom::geography) end,
         updated_at = now(), updated_by = auth.uid()
   where id = v_id;
  return v_version;
end $$;

-- ------------------------------------------------------- link condivisi
create table shared_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  organization_id uuid not null references organizations (id) on delete cascade,
  token_hash text not null unique,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references users (id),
  check (expires_at > created_at and expires_at <= created_at + interval '90 days')
);

create function public.create_shared_link(p_project uuid, p_days int) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_token text := encode(gen_random_bytes(24), 'hex');
begin
  if not app.can_edit_project(p_project) then raise exception 'Permesso negato.'; end if;
  if p_days < 1 or p_days > 90 then raise exception 'Scadenza tra 1 e 90 giorni.'; end if;
  insert into shared_links (project_id, organization_id, token_hash, created_by, expires_at)
  values (p_project, app.project_org(p_project), encode(digest(v_token, 'sha256'), 'hex'), auth.uid(), now() + make_interval(days => p_days));
  return v_token; -- mostrato una sola volta: nel database resta solo l'hash
end $$;

create function public.revoke_shared_link(p_link uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update shared_links set revoked_at = now(), revoked_by = auth.uid()
   where id = p_link and revoked_at is null and app.can_edit_project(project_id);
  if not found then raise exception 'Link inesistente, già revocato o permesso negato.'; end if;
end $$;

-- Accesso in sola lettura tramite token (anche senza login)
create function public.get_shared_project(p_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_link shared_links;
  v_bundle jsonb;
begin
  select * into v_link from shared_links
   where token_hash = encode(digest(p_token, 'sha256'), 'hex') and revoked_at is null and expires_at > now();
  if v_link.id is null then return null; end if;
  select bundle into v_bundle from project_documents where project_id = v_link.project_id;
  insert into audit_logs (organization_id, actor_id, action, entity, entity_id, details)
  values (v_link.organization_id, auth.uid(), 'read', 'shared_links', v_link.id, '{}');
  return jsonb_build_object('bundle', v_bundle, 'expiresAt', v_link.expires_at, 'readOnly', true);
end $$;

-- -------------------------------------------------------------- trigger audit
create trigger audit_projects after insert or update or delete on projects for each row execute function app.audit();
create trigger audit_project_documents after insert or update or delete on project_documents for each row execute function app.audit();
create trigger audit_memberships after insert or update or delete on memberships for each row execute function app.audit();
create trigger audit_shared_links after insert or update on shared_links for each row execute function app.audit();

-- ------------------------------------------------------------------- RLS
alter table organizations enable row level security;
alter table users enable row level security;
alter table memberships enable row level security;
alter table project_documents enable row level security;
alter table shared_links enable row level security;
alter table parcels enable row level security;
alter table sources enable row level security;
alter table data_sources enable row level security;
alter table datasets enable row level security;
alter table data_points enable row level security;
alter table sensors enable row level security;
alter table sensor_measurements enable row level security;
alter table model_versions enable row level security;
alter table interventions enable row level security;
alter table scenario_outputs enable row level security;
alter table uncertainty_records enable row level security;
alter table cost_assumptions enable row level security;
alter table approval_events enable row level security;
alter table field_observations enable row level security;
alter table media_assets enable row level security;
alter table verification_campaigns enable row level security;
alter table reports enable row level security;
alter table case_studies enable row level security;
alter table audit_logs enable row level security;
-- (projects, areas, baselines, scenarios, decisions: abilitata nella migrazione 0001)

-- organizzazioni e membri
create policy org_select on organizations for select to authenticated using (app.has_role(id, 'viewer'));
create policy org_update on organizations for update to authenticated using (app.has_role(id, 'admin')) with check (app.has_role(id, 'admin'));

create policy users_select on users for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from memberships a join memberships b on a.organization_id = b.organization_id
     where a.user_id = auth.uid() and b.user_id = users.id)
);
create policy users_update_self on users for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on users from authenticated;
grant update (display_name) on users to authenticated;

create policy memberships_select on memberships for select to authenticated using (app.has_role(organization_id, 'viewer'));
create policy memberships_admin_insert on memberships for insert to authenticated with check (app.has_role(organization_id, 'admin'));
create policy memberships_admin_update on memberships for update to authenticated using (app.has_role(organization_id, 'admin')) with check (app.has_role(organization_id, 'admin'));
create policy memberships_admin_delete on memberships for delete to authenticated using (app.has_role(organization_id, 'admin'));

-- progetti e documenti
create policy projects_select on projects for select to authenticated using (app.has_role(organization_id, 'viewer'));
create policy projects_insert on projects for insert to authenticated with check (app.has_role(organization_id, 'editor'));
create policy projects_update on projects for update to authenticated using (app.has_role(organization_id, 'editor')) with check (app.has_role(organization_id, 'editor'));
create policy projects_delete on projects for delete to authenticated using (app.has_role(organization_id, 'admin'));

create policy documents_select on project_documents for select to authenticated using (app.has_role(organization_id, 'viewer'));
create policy documents_insert on project_documents for insert to authenticated
  with check (app.has_role(organization_id, 'editor') and app.project_org(project_id) = organization_id);
create policy documents_update on project_documents for update to authenticated
  using (app.has_role(organization_id, 'editor')) with check (app.has_role(organization_id, 'editor'));
create policy documents_delete on project_documents for delete to authenticated using (app.has_role(organization_id, 'admin'));

create policy shared_links_select on shared_links for select to authenticated using (app.can_read_project(project_id));
-- creazione e revoca solo tramite le funzioni dedicate

-- tabelle normalizzate (riservate a M2) collegate al progetto
create policy areas_select on areas for select to authenticated using (app.can_read_project(project_id));
create policy areas_write on areas for all to authenticated using (app.can_edit_project(project_id)) with check (app.can_edit_project(project_id));
create policy parcels_select on parcels for select to authenticated using (exists (select 1 from areas a where a.id = area_id and app.can_read_project(a.project_id)));
create policy parcels_write on parcels for all to authenticated
  using (exists (select 1 from areas a where a.id = area_id and app.can_edit_project(a.project_id)))
  with check (exists (select 1 from areas a where a.id = area_id and app.can_edit_project(a.project_id)));
create policy baselines_select on baselines for select to authenticated using (exists (select 1 from areas a where a.id = area_id and app.can_read_project(a.project_id)));
create policy baselines_insert on baselines for insert to authenticated with check (exists (select 1 from areas a where a.id = area_id and app.can_edit_project(a.project_id)));
create policy scenarios_select on scenarios for select to authenticated using (app.can_read_project(project_id));
create policy scenarios_write on scenarios for all to authenticated using (app.can_edit_project(project_id)) with check (app.can_edit_project(project_id));
create policy interventions_select on interventions for select to authenticated using (exists (select 1 from scenarios s where s.id = scenario_id and app.can_read_project(s.project_id)));
create policy interventions_write on interventions for all to authenticated
  using (exists (select 1 from scenarios s where s.id = scenario_id and app.can_edit_project(s.project_id)))
  with check (exists (select 1 from scenarios s where s.id = scenario_id and app.can_edit_project(s.project_id)));
create policy outputs_select on scenario_outputs for select to authenticated using (exists (select 1 from scenarios s where s.id = scenario_id and app.can_read_project(s.project_id)));
create policy outputs_insert on scenario_outputs for insert to authenticated with check (exists (select 1 from scenarios s where s.id = scenario_id and app.can_edit_project(s.project_id)));
create policy uncertainty_select on uncertainty_records for select to authenticated using (
  exists (select 1 from scenario_outputs o join scenarios s on s.id = o.scenario_id where o.id = scenario_output_id and app.can_read_project(s.project_id)));
create policy uncertainty_insert on uncertainty_records for insert to authenticated with check (
  exists (select 1 from scenario_outputs o join scenarios s on s.id = o.scenario_id where o.id = scenario_output_id and app.can_edit_project(s.project_id)));
create policy decisions_select on decisions for select to authenticated using (app.can_read_project(project_id));
create policy decisions_insert on decisions for insert to authenticated with check (app.can_edit_project(project_id));
create policy approval_events_select on approval_events for select to authenticated using (exists (select 1 from decisions d where d.id = decision_id and app.can_read_project(d.project_id)));
create policy approval_events_insert on approval_events for insert to authenticated with check (exists (select 1 from decisions d where d.id = decision_id and app.can_edit_project(d.project_id)));
create policy observations_select on field_observations for select to authenticated using (app.can_read_project(project_id));
create policy observations_write on field_observations for all to authenticated using (app.can_edit_project(project_id)) with check (app.can_edit_project(project_id));
create policy media_select on media_assets for select to authenticated using (app.can_read_project(project_id));
create policy media_write on media_assets for all to authenticated using (app.can_edit_project(project_id)) with check (app.can_edit_project(project_id));
create policy campaigns_select on verification_campaigns for select to authenticated using (exists (select 1 from scenarios s where s.id = scenario_id and app.can_read_project(s.project_id)));
create policy campaigns_write on verification_campaigns for all to authenticated
  using (exists (select 1 from scenarios s where s.id = scenario_id and app.can_edit_project(s.project_id)))
  with check (exists (select 1 from scenarios s where s.id = scenario_id and app.can_edit_project(s.project_id)));
create policy reports_select on reports for select to authenticated using (app.can_read_project(project_id));
create policy reports_insert on reports for insert to authenticated with check (app.can_edit_project(project_id));
create policy sensors_select on sensors for select to authenticated using (app.can_read_project(project_id));
create policy sensors_write on sensors for all to authenticated using (app.can_edit_project(project_id)) with check (app.can_edit_project(project_id));
create policy measurements_select on sensor_measurements for select to authenticated using (exists (select 1 from sensors s where s.id = sensor_id and app.can_read_project(s.project_id)));
create policy measurements_insert on sensor_measurements for insert to authenticated with check (exists (select 1 from sensors s where s.id = sensor_id and app.can_edit_project(s.project_id)));
create policy datasets_select on datasets for select to authenticated using (project_id is null or app.can_read_project(project_id));
create policy datasets_insert on datasets for insert to authenticated with check (project_id is not null and app.can_edit_project(project_id));
create policy data_points_select on data_points for select to authenticated using (
  exists (select 1 from datasets d where d.id = dataset_id and (d.project_id is null or app.can_read_project(d.project_id))));
create policy data_points_insert on data_points for insert to authenticated with check (
  exists (select 1 from datasets d where d.id = dataset_id and d.project_id is not null and app.can_edit_project(d.project_id)));

-- riferimenti condivisi: sola lettura per gli utenti autenticati (scrittura solo service role)
create policy sources_read on sources for select to authenticated using (true);
create policy data_sources_read on data_sources for select to authenticated using (true);
create policy model_versions_read on model_versions for select to authenticated using (true);
create policy cost_assumptions_read on cost_assumptions for select to authenticated using (true);
create policy case_studies_read on case_studies for select to authenticated using (true);

-- audit: lettura per gli amministratori dell'organizzazione; nessuna scrittura diretta
create policy audit_admin_read on audit_logs for select to authenticated using (organization_id is not null and app.has_role(organization_id, 'admin'));

-- funzioni: niente esecuzione anonima tranne la lettura via link condiviso
revoke execute on function public.create_organization(text), public.add_member_by_email(uuid, text, membership_role),
  public.save_project(uuid, jsonb, text, int), public.create_shared_link(uuid, int), public.revoke_shared_link(uuid) from public, anon;
grant execute on function public.create_organization(text), public.add_member_by_email(uuid, text, membership_role),
  public.save_project(uuid, jsonb, text, int), public.create_shared_link(uuid, int), public.revoke_shared_link(uuid) to authenticated;
grant execute on function public.get_shared_project(text) to anon, authenticated;

-- ---------------------------------------------------------------- storage
-- Percorso oggetti: {organization_id}/{project_id}/{uuid}.{ext}. Oggetti immutabili (nessun UPDATE).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-media', 'project-media', false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create function app.media_path_ok(p_name text, p_min membership_role) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    app.project_org(app.try_uuid((storage.foldername(p_name))[2])) = app.try_uuid((storage.foldername(p_name))[1])
    and app.has_role(app.try_uuid((storage.foldername(p_name))[1]), p_min),
    false)
$$;
grant execute on function app.media_path_ok(text, membership_role) to authenticated;

create policy media_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'project-media' and app.media_path_ok(name, 'viewer'));
create policy media_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'project-media' and app.media_path_ok(name, 'editor'));
create policy media_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'project-media' and app.media_path_ok(name, 'editor'));
