-- public.logins
-- Sign-in *event* log. Not a credentials table. No password column — ever.
-- Safe to re-run: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / DROP POLICY IF EXISTS.
--
-- Docs: docs/database/logins.md
-- Password hashes stay in Supabase Auth only. Append-only RLS (select + insert).

create table if not exists public.logins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  username text,
  logged_in_at timestamptz not null default now(),
  ip text,
  user_agent text,
  success boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.logins is
  'Sign-in event log. Not credentials. No password column. Password hashes stay in Auth.';

comment on column public.logins.id is
  'Event UUID.';
comment on column public.logins.user_id is
  'Owner profile. RLS: auth.uid() = user_id. ON DELETE CASCADE.';
comment on column public.logins.username is
  'Handle used at sign-in (e.g. jane). Snapshot only — not a unique login id.';
comment on column public.logins.logged_in_at is
  'When the sign-in attempt happened. Default now().';
comment on column public.logins.ip is
  'Client IP if recorded. Optional. Not a secret.';
comment on column public.logins.user_agent is
  'Client user-agent if recorded. Optional.';
comment on column public.logins.success is
  'True on a successful Auth grant. Default true. Failed attempts for a known profile may be inserted with service_role.';
comment on column public.logins.created_at is
  'Row insert time.';

alter table public.logins add column if not exists username text;
alter table public.logins add column if not exists logged_in_at timestamptz not null default now();
alter table public.logins add column if not exists ip text;
alter table public.logins add column if not exists user_agent text;
alter table public.logins add column if not exists success boolean not null default true;
alter table public.logins add column if not exists created_at timestamptz not null default now();

-- Do not add a password / hash / token column. If a thinner table already exists, leave it without one.

create index if not exists logins_user_id_logged_in_at_idx
  on public.logins (user_id, logged_in_at desc);

alter table public.logins enable row level security;

-- Append-only: select + insert. No update/delete policies for authenticated.

drop policy if exists "logins_select_own" on public.logins;
create policy "logins_select_own"
  on public.logins
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "logins_insert_own" on public.logins;
create policy "logins_insert_own"
  on public.logins
  for insert
  to authenticated
  with check (auth.uid() = user_id);

grant select, insert on public.logins to authenticated;
grant all on public.logins to service_role;
