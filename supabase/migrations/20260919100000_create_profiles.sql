-- public.profiles
-- Hosted CareLoop: this table was created in the Supabase Table Editor / dashboard
-- for login (username → email → Auth password). It may already exist in production.
-- Safe to re-run: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
--
-- There is no public.login table. Passwords live in Auth, not here.
-- Docs: docs/database/profiles.md

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  email text not null,
  first_name text,
  last_name text,
  created_at timestamptz not null default now(),
  constraint profiles_username_key unique (username),
  constraint profiles_email_key unique (email)
);

comment on table public.profiles is
  '1:1 with auth.users. Login looks up username then signs in with email + Auth password. No insurance fields.';

comment on column public.profiles.id is
  'Same UUID as auth.users.id. Not generated here.';
comment on column public.profiles.username is
  'Demo login handle (jane). Unique. Not the Auth password.';
comment on column public.profiles.email is
  'Auth email (jane@careloop.local). Unique.';
comment on column public.profiles.first_name is
  'Display given name. Nullable.';
comment on column public.profiles.last_name is
  'Display family name. Nullable.';
comment on column public.profiles.created_at is
  'Row insert time.';

-- If the Table Editor created a thinner table, fill documented columns.
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();

create unique index if not exists profiles_username_key on public.profiles (username);
create unique index if not exists profiles_email_key on public.profiles (email);
create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Login username lookup uses the service_role key on the server (bypasses RLS).
-- Authenticated patients may not insert/delete their own profile in this demo.
-- Seed Auth + this row in the dashboard (jane / jane@careloop.local).

grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
