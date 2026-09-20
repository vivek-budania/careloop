-- public.claims
-- Mock EOB / claim snapshot after billing. Not a PA or appeal letter.
-- Vivek has already created this (or equivalent) in hosted Supabase.
-- Safe to re-run: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / DROP POLICY IF EXISTS.
--
-- Docs: docs/database/claims.md
-- PA ≠ claim. Do not store watermarked letter bodies, transcripts, card images, or API keys.

create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  visit_id uuid references public.visits (id) on delete set null,
  service_name text,
  status text,
  billed_amount numeric,
  patient_owes numeric,
  eob_summary text,
  source text not null default 'mock',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.claims is
  'Mock EOB / claim rows. Not prior authorization, not appeal letter bodies. PA ≠ claim.';

comment on column public.claims.id is
  'Claim row UUID.';
comment on column public.claims.user_id is
  'Owner. RLS: auth.uid() = user_id.';
comment on column public.claims.visit_id is
  'Optional visit this mock claim is about. ON DELETE SET NULL.';
comment on column public.claims.service_name is
  'Display service (e.g. Office visit). Optional.';
comment on column public.claims.status is
  'Mock claim/EOB status (e.g. not submitted). Not a PA decision.';
comment on column public.claims.billed_amount is
  'Mock billed / allowed amount. Estimate only — not a real claim file.';
comment on column public.claims.patient_owes is
  'Mock patient-owed from the EOB. Not a bill CareLoop collects.';
comment on column public.claims.eob_summary is
  'Short mock EOB blurb. Not a PA/appeal/demand letter body.';
comment on column public.claims.source is
  'Default mock. Not a live clearinghouse. No API keys.';
comment on column public.claims.created_at is
  'Row insert time.';
comment on column public.claims.updated_at is
  'Last writer touch. App should set this on upsert.';

alter table public.claims add column if not exists visit_id uuid;
alter table public.claims add column if not exists service_name text;
alter table public.claims add column if not exists status text;
alter table public.claims add column if not exists billed_amount numeric;
alter table public.claims add column if not exists patient_owes numeric;
alter table public.claims add column if not exists eob_summary text;
alter table public.claims add column if not exists source text not null default 'mock';
alter table public.claims add column if not exists created_at timestamptz not null default now();
alter table public.claims add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'claims_visit_id_fkey'
      and conrelid = 'public.claims'::regclass
  ) then
    alter table public.claims
      add constraint claims_visit_id_fkey
      foreign key (visit_id) references public.visits (id) on delete set null;
  end if;
end $$;

create index if not exists claims_user_id_idx
  on public.claims (user_id);

alter table public.claims enable row level security;

drop policy if exists "claims_select_own" on public.claims;
create policy "claims_select_own"
  on public.claims
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "claims_insert_own" on public.claims;
create policy "claims_insert_own"
  on public.claims
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "claims_update_own" on public.claims;
create policy "claims_update_own"
  on public.claims
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "claims_delete_own" on public.claims;
create policy "claims_delete_own"
  on public.claims
  for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.claims to authenticated;
grant all on public.claims to service_role;
