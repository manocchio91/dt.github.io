import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { postgis } from '@electric-sql/pglite-postgis';

/**
 * Postgres reale (PGlite, WASM) con un'emulazione minima di Supabase:
 * ruoli anon/authenticated, auth.users + auth.uid() da request.jwt.claims,
 * storage.buckets/objects + storage.foldername(), privilegi di default su public.
 * Le migrazioni vengono applicate così come sono.
 */
const SUPABASE_STUB = /* sql */ `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema extensions;
create extension pgcrypto schema extensions;

create schema auth;
create table auth.users (id uuid primary key, email text unique, raw_user_meta_data jsonb not null default '{}');
create function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;

create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid default auth.uid(),
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
alter table storage.objects enable row level security;

grant usage on schema auth, storage, extensions to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant select, insert, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;

-- service_role (chiave di servizio): come in Supabase, privilegi completi e RLS ignorata
grant usage on schema auth, storage, extensions to service_role;
grant all on storage.objects, storage.buckets to service_role;
grant usage on schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
`;

/** upTo: applica le migrazioni fino a quella indicata (prefisso del nome) e salta il seed: per provare gli aggiornamenti. */
/** Riapre lo stesso database in una NUOVA sessione (come una nuova connessione al server). */
export async function reopen(db: PGlite): Promise<PGlite> {
  const data = await db.dumpDataDir();
  return PGlite.create({ loadDataDir: data, extensions: { postgis, pgcrypto } });
}

export async function createDb(opts: { upTo?: string } = {}): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { postgis, pgcrypto } });
  await db.exec(SUPABASE_STUB);
  const dir = join(import.meta.dirname, '..', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql') && (!opts.upTo || x.slice(0, opts.upTo.length) <= opts.upTo)).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  if (opts.upTo) return db;
  // il seed di riferimento deve applicarsi senza errori
  const seedDir = join(import.meta.dirname, '..', 'seed');
  for (const f of readdirSync(seedDir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(seedDir, f), 'utf8'));
  }
  return db;
}

export type Actor = { id: string } | 'anon' | 'superuser' | 'service';

export async function actAs(db: PGlite, who: Actor): Promise<void> {
  await db.exec('reset role');
  if (who === 'superuser') {
    await db.query(`select set_config('request.jwt.claims', '', false)`);
    return;
  }
  const claims = who === 'anon' ? { role: 'anon' } : who === 'service' ? { role: 'service_role' } : { sub: who.id, role: 'authenticated' };
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  await db.exec(`set role ${who === 'anon' ? 'anon' : who === 'service' ? 'service_role' : 'authenticated'}`);
}

export async function createAuthUser(db: PGlite, id: string, email: string): Promise<{ id: string }> {
  await actAs(db, 'superuser');
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  return { id };
}
