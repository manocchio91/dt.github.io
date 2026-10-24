-- Micro Digital Twin — F31 previsioni probabilistiche (Timestral Beta e baseline).
--
-- Una previsione è una STIMA DA MODELLO, mai una misura. Regole imposte dal database:
-- * catalogo dei modelli con revisione bloccata dei pesi, scritto solo dal servizio;
-- * una esecuzione registrata è immutabile (lineage, input, output); cambia solo lo stato
--   da 'in_corso' a 'completata' / 'errore';
-- * un'esecuzione di un modello Timestral si registra SOLO dal servizio (un client non può
--   presentare come "Timestral" valori calcolati altrove); le baseline si registrano dal client;
-- * soglie degli esperti versionate (mai sovrascritte); avvisi con verifica ex-post;
-- * isolamento per organizzazione (RLS) e audit di esecuzioni, soglie, avvisi e backtest.

create type forecast_model_kind as enum ('timestral', 'baseline', 'demo');
create type forecast_run_status as enum ('in_corso', 'completata', 'errore');
create type forecast_alert_status as enum ('aperto', 'verificato_in_campo', 'falso_allarme', 'chiuso');

-- --------------------------------------------------------- catalogo dei modelli
create table forecast_model_versions (
  id text primary key,                      -- es. 'mistralai/Timestral-5M@bdd20cf…'
  model text not null,
  revision text not null,
  kind forecast_model_kind not null,
  status text not null default 'beta' check (status in ('beta', 'validato', 'ritirato', 'demo')),
  code_commit text,
  license_code text not null,
  license_weights text,
  applicability text not null default '',
  limitations text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (model, revision)
);

insert into forecast_model_versions (id, model, revision, kind, code_commit, license_code, license_weights, applicability, limitations) values
  ('mistralai/Timestral-5M@bdd20cfc15a3fea0e4cb5ccef37f8d3ca7aa335f', 'mistralai/Timestral-5M', 'bdd20cfc15a3fea0e4cb5ccef37f8d3ca7aa335f', 'timestral',
   'a534bdbd244d64f3d9d743f46c7bf6fc330ed4ff', 'Apache-2.0', 'Modified MIT', 'Previsione probabilistica zero-shot di serie orarie; Beta da validare con backtest locale.',
   array['Non misura, non diagnostica, non prescrive.', 'Non stima effetti di interventi.']),
  ('mistralai/Timestral-28M@49b26409ac87b5935539a5d8ffe7f397b720db47', 'mistralai/Timestral-28M', '49b26409ac87b5935539a5d8ffe7f397b720db47', 'timestral',
   'a534bdbd244d64f3d9d743f46c7bf6fc330ed4ff', 'Apache-2.0', 'Modified MIT', 'Confronto con il 5M; Beta da validare.',
   array['Non misura, non diagnostica, non prescrive.', 'Non stima effetti di interventi.']),
  ('baseline-persistenza@n/a', 'baseline-persistenza', 'n/a', 'baseline', null, 'codice del progetto', null, 'Riferimento minimo.', array['Ignora il ciclo giornaliero.']),
  ('baseline-persistenza-stagionale@n/a', 'baseline-persistenza-stagionale', 'n/a', 'baseline', null, 'codice del progetto', null, 'Serie con ciclo giornaliero.', array['Non anticipa cambi di tempo.']);

-- ------------------------------------------------------------------ esecuzioni
create table forecast_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  model_version_id text not null references forecast_model_versions (id),
  context text not null check (context in ('urbano', 'agricolo')),
  status forecast_run_status not null default 'in_corso',
  frequency text not null default '1h' check (frequency = '1h'),
  horizon int not null check (horizon between 1 and 168),
  issued_at timestamptz not null,           -- istante "ora": ultimo dato dello storico
  input_hash text not null,
  data_class text not null check (data_class in ('STIMATO_DA_MODELLO', 'SIMULATO')),
  lineage jsonb not null,                   -- fonte, coordinate, periodo, mancanti, covariate, QA
  warnings text[] not null default '{}',
  inference_ms int,
  error text,
  started_by uuid references users (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (lineage ? 'source' and lineage ? 'period' and lineage ? 'variable')
);
create index forecast_runs_project_idx on forecast_runs (project_id, created_at desc);

create table forecast_series (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references forecast_runs (id) on delete cascade,
  variable text not null,
  unit text not null,
  timestamps timestamptz[] not null,
  median double precision[] not null,
  check (cardinality(timestamps) = cardinality(median)),
  unique (run_id, variable)
);

create table forecast_quantiles (
  series_id uuid not null references forecast_series (id) on delete cascade,
  level numeric(3, 2) not null check (level in (0.01, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50,
                                                0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 0.99)),
  "values" double precision[] not null,
  primary key (series_id, level)
);

-- ------------------------------------------------------------------- backtest
create table forecast_backtests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  case_id text not null,
  context text not null check (context in ('urbano', 'agricolo')),
  model_version_id text not null references forecast_model_versions (id),
  variable text not null,
  horizon int not null,
  protocol text not null,
  period jsonb not null,
  metrics jsonb not null,                   -- mae, mase, pinball, wql, coperture, avvisi
  executed_by uuid references users (id),
  executed_at timestamptz not null default now()
);

-- ------------------------------------------------------- soglie degli esperti
create table forecast_thresholds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  project_id uuid not null references projects (id) on delete cascade,
  context text not null check (context in ('urbano', 'agricolo')),
  zone text,                                -- zona o parcella (agricolo)
  variable text not null,
  unit text not null,
  threshold double precision not null,
  direction text not null check (direction in ('sopra', 'sotto')),
  min_probability double precision not null check (min_probability > 0 and min_probability < 1),
  expert_role text not null,                -- es. 'agronomo', 'tecnico comunale'
  rationale text not null check (length(rationale) >= 10),
  set_by uuid not null references users (id),
  created_at timestamptz not null default now(),
  superseded_by uuid references forecast_thresholds (id)
);

-- --------------------------------------------------------- avvisi e verifica
create table forecast_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  run_id uuid not null references forecast_runs (id) on delete cascade,
  threshold_id uuid not null references forecast_thresholds (id),
  zone text,
  first_exceedance timestamptz not null,
  probability double precision not null check (probability between 0 and 1),
  status forecast_alert_status not null default 'aperto',
  observed_value double precision,           -- osservazione successiva (ex-post)
  observed_at timestamptz,
  review_note text,
  reviewed_by uuid references users (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- guardie
create function app.guard_forecast_run() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k forecast_model_kind;
  svc boolean := app.is_service_role();
begin
  select kind into k from forecast_model_versions where id = new.model_version_id;
  if tg_op = 'INSERT' then
    if new.organization_id is distinct from app.project_org(new.project_id) then
      raise exception 'L''esecuzione deve appartenere all''organizzazione del progetto.';
    end if;
    if k = 'timestral' and not svc then
      raise exception 'Le esecuzioni Timestral sono registrate solo dal servizio di previsione.';
    end if;
    if (k = 'demo') <> (new.data_class = 'SIMULATO') then
      raise exception 'Classe del dato incoerente con il modello (demo = SIMULATO).';
    end if;
    if not svc then new.started_by := auth.uid(); end if;
    new.created_at := now();
    return new;
  end if;
  if new.id <> old.id or new.organization_id <> old.organization_id or new.project_id <> old.project_id
     or new.model_version_id <> old.model_version_id or new.horizon <> old.horizon or new.issued_at <> old.issued_at
     or new.input_hash <> old.input_hash or new.lineage <> old.lineage or new.data_class <> old.data_class
     or new.context <> old.context or new.started_by is distinct from old.started_by or new.created_at <> old.created_at then
    raise exception 'Un''esecuzione di previsione registrata è immutabile.';
  end if;
  if old.status <> 'in_corso' then
    raise exception 'Esecuzione già conclusa: non modificabile.';
  end if;
  if k = 'timestral' and not svc then
    raise exception 'Le esecuzioni Timestral sono aggiornate solo dal servizio di previsione.';
  end if;
  if new.status <> 'in_corso' then new.completed_at := now(); end if;
  return new;
end $$;
create trigger guard_forecast_run before insert or update on forecast_runs for each row execute function app.guard_forecast_run();

-- serie e quantili: scritti solo finché l'esecuzione è in corso, dallo stesso tipo di attore
create function app.guard_forecast_output() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r forecast_runs;
  k forecast_model_kind;
  rid uuid;
  j jsonb;
begin
  if tg_op = 'DELETE' then j := to_jsonb(old); else j := to_jsonb(new); end if;
  if tg_table_name = 'forecast_series' then
    rid := (j ->> 'run_id')::uuid;
  else
    select run_id into rid from forecast_series where id = (j ->> 'series_id')::uuid;
  end if;
  select * into r from forecast_runs where id = rid;
  select kind into k from forecast_model_versions where id = r.model_version_id;
  if tg_op = 'DELETE' then
    return old;  -- solo a cascata o da amministratore (policy)
  end if;
  if tg_op = 'UPDATE' then raise exception 'L''output di una previsione è immutabile.'; end if;
  if r.status <> 'in_corso' then raise exception 'Esecuzione conclusa: output non modificabile.'; end if;
  if k = 'timestral' and not app.is_service_role() then
    raise exception 'L''output Timestral è scritto solo dal servizio di previsione.';
  end if;
  return new;
end $$;
create trigger guard_forecast_series before insert or update or delete on forecast_series for each row execute function app.guard_forecast_output();
create trigger guard_forecast_quantiles before insert or update or delete on forecast_quantiles for each row execute function app.guard_forecast_output();

create function app.guard_forecast_threshold() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.organization_id is distinct from app.project_org(new.project_id) then
      raise exception 'La soglia deve appartenere all''organizzazione del progetto.';
    end if;
    new.set_by := auth.uid();
    new.created_at := now();
    if new.superseded_by is not null then raise exception 'Una nuova soglia non può essere già sostituita.'; end if;
    return new;
  end if;
  -- l'unica modifica ammessa è indicare la versione che la sostituisce (storico conservato)
  if (to_jsonb(new) - 'superseded_by') <> (to_jsonb(old) - 'superseded_by') or old.superseded_by is not null then
    raise exception 'Le soglie sono versionate: crea una nuova soglia invece di modificarla.';
  end if;
  return new;
end $$;
create trigger guard_forecast_threshold before insert or update on forecast_thresholds for each row execute function app.guard_forecast_threshold();

create function app.guard_forecast_alert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.organization_id is distinct from (select organization_id from forecast_runs where id = new.run_id)
       or new.organization_id is distinct from (select organization_id from forecast_thresholds where id = new.threshold_id) then
      raise exception 'Avviso, esecuzione e soglia devono appartenere alla stessa organizzazione.';
    end if;
    if new.status <> 'aperto' or new.reviewed_by is not null then raise exception 'Un nuovo avviso parte aperto.'; end if;
    return new;
  end if;
  if (to_jsonb(new) - array['status', 'observed_value', 'observed_at', 'review_note', 'reviewed_by'])
     <> (to_jsonb(old) - array['status', 'observed_value', 'observed_at', 'review_note', 'reviewed_by']) then
    raise exception 'Dell''avviso si registrano solo stato e verifica ex-post.';
  end if;
  if new.status <> 'aperto' then new.reviewed_by := auth.uid(); end if;
  return new;
end $$;
create trigger guard_forecast_alert before insert or update on forecast_alerts for each row execute function app.guard_forecast_alert();

-- ------------------------------------------------------------------- audit
create function app.audit_forecast() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j jsonb;
  keys text[];
begin
  if tg_op = 'DELETE' then j := to_jsonb(old); else j := to_jsonb(new); end if;
  keys := case tg_table_name
    when 'forecast_runs' then array['model_version_id', 'status', 'horizon', 'input_hash']
    when 'forecast_thresholds' then array['variable', 'threshold', 'direction', 'expert_role', 'superseded_by']
    when 'forecast_alerts' then array['status', 'observed_value']
    when 'forecast_backtests' then array['case_id', 'model_version_id']
  end;
  insert into audit_logs (organization_id, actor_id, action, entity, entity_id, details)
  values ((j ->> 'organization_id')::uuid, auth.uid(), lower(tg_op), tg_table_name, (j ->> 'id')::uuid,
          (select coalesce(jsonb_object_agg(k, j -> k), '{}'::jsonb) from unnest(keys) k));
  return null;
end $$;
create trigger audit_forecast_runs after insert or update or delete on forecast_runs for each row execute function app.audit_forecast();
create trigger audit_forecast_thresholds after insert or update on forecast_thresholds for each row execute function app.audit_forecast();
create trigger audit_forecast_alerts after insert or update on forecast_alerts for each row execute function app.audit_forecast();
create trigger audit_forecast_backtests after insert on forecast_backtests for each row execute function app.audit_forecast();

-- ---------------------------------------------------------------------- RLS
alter table forecast_model_versions enable row level security;
alter table forecast_runs enable row level security;
alter table forecast_series enable row level security;
alter table forecast_quantiles enable row level security;
alter table forecast_backtests enable row level security;
alter table forecast_thresholds enable row level security;
alter table forecast_alerts enable row level security;

create function app.can_read_run(p_run uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role((select organization_id from forecast_runs where id = p_run), 'viewer')
$$;
create function app.can_edit_run(p_run uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.has_role((select organization_id from forecast_runs where id = p_run), 'editor')
$$;
grant execute on function app.can_read_run(uuid), app.can_edit_run(uuid), app.guard_forecast_run(), app.guard_forecast_output(),
  app.guard_forecast_threshold(), app.guard_forecast_alert(), app.audit_forecast() to authenticated;

-- catalogo: leggibile da chi è autenticato; scritto solo dal servizio (nessuna policy di scrittura)
create policy fmv_select on forecast_model_versions for select to authenticated using (true);

create policy fruns_select on forecast_runs for select to authenticated using (app.has_role(organization_id, 'viewer'));
create policy fruns_insert on forecast_runs for insert to authenticated with check (app.has_role(organization_id, 'editor'));
create policy fruns_update on forecast_runs for update to authenticated using (app.has_role(organization_id, 'editor')) with check (app.has_role(organization_id, 'editor'));
create policy fruns_delete on forecast_runs for delete to authenticated using (app.has_role(organization_id, 'admin'));

create policy fseries_select on forecast_series for select to authenticated using (app.can_read_run(run_id));
create policy fseries_insert on forecast_series for insert to authenticated with check (app.can_edit_run(run_id));
create policy fquant_select on forecast_quantiles for select to authenticated
  using (exists (select 1 from forecast_series s where s.id = series_id and app.can_read_run(s.run_id)));
create policy fquant_insert on forecast_quantiles for insert to authenticated
  with check (exists (select 1 from forecast_series s where s.id = series_id and app.can_edit_run(s.run_id)));

create policy fbt_select on forecast_backtests for select to authenticated using (app.has_role(organization_id, 'viewer'));
create policy fbt_insert on forecast_backtests for insert to authenticated with check (app.has_role(organization_id, 'editor'));

-- soglie: le propone un editor e le firma con ruolo esperto dichiarato; nessuna cancellazione
create policy fthr_select on forecast_thresholds for select to authenticated using (app.has_role(organization_id, 'viewer'));
create policy fthr_insert on forecast_thresholds for insert to authenticated with check (app.has_role(organization_id, 'editor'));
create policy fthr_update on forecast_thresholds for update to authenticated using (app.has_role(organization_id, 'editor')) with check (app.has_role(organization_id, 'editor'));

create policy falert_select on forecast_alerts for select to authenticated using (app.has_role(organization_id, 'viewer'));
create policy falert_insert on forecast_alerts for insert to authenticated with check (app.has_role(organization_id, 'editor'));
create policy falert_update on forecast_alerts for update to authenticated using (app.has_role(organization_id, 'editor')) with check (app.has_role(organization_id, 'editor'));
