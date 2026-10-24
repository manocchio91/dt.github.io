-- Micro Digital Twin — Milestone 1, B-102: preferenze di onboarding per utente.
-- Il profilo operativo è un'informazione di contesto: NON concede permessi.
-- I permessi restano esclusivamente in memberships (assegnati dagli admin).

create table user_preferences (
  user_id uuid primary key references users (id) on delete cascade,
  profile text not null check (profile in ('tecnico_comunale', 'gestore_verde', 'agricoltore', 'agronomo', 'revisore')),
  sector project_sector not null,
  mode text not null check (mode in ('guidata', 'tecnica')),
  preferences jsonb not null,
  updated_at timestamptz not null default now(),
  -- difesa in profondità: nessun campo che somigli a un permesso nel documento
  check (not (preferences ?| array['role', 'roles', 'permissions', 'canEdit', 'canAdmin', 'canApprove', 'organization_id'])),
  check (preferences ->> 'profile' = profile and preferences ->> 'sector' = sector::text and preferences ->> 'mode' = mode)
);

create function app.touch_user_preferences() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger user_preferences_touch before update on user_preferences
  for each row execute function app.touch_user_preferences();

alter table user_preferences enable row level security;

-- ogni utente vede e modifica soltanto le proprie preferenze
create policy prefs_select_own on user_preferences for select to authenticated using (user_id = auth.uid());
create policy prefs_insert_own on user_preferences for insert to authenticated with check (user_id = auth.uid());
create policy prefs_update_own on user_preferences for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy prefs_delete_own on user_preferences for delete to authenticated using (user_id = auth.uid());
