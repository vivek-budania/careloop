-- public.intakes
-- In-progress visit journey (openVisits / booking) before a History visits row.
-- Vivek has already created this (or equivalent) in hosted Supabase.
-- Safe to re-run: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / DROP POLICY IF EXISTS.
--
-- Docs: docs/database/intakes.md
-- visit_cost_guess is a labeled estimate, not a coverage decision.
-- Do not store transcripts, PA letters, card images, or API keys here.

create table if not exists public.intakes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  completed_visit_id uuid references public.visits (id) on delete set null,
  status text not null default 'open',
  symptoms text,
  suggested_specialty text,
  clinician_name text,
  clinic text,
  slot text,
  visit_cost_guess jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.intakes is
  'In-progress visit journey before a History visits row. Cost guess is not a coverage decision. PA ≠ claim.';

comment on column public.intakes.id is
  'Intake row UUID.';
comment on column public.intakes.user_id is
  'Owner. RLS: auth.uid() = user_id.';
comment on column public.intakes.completed_visit_id is
  'Optional History visit created when this journey finishes. ON DELETE SET NULL.';
comment on column public.intakes.status is
  'open until the journey is saved onto History. Default open. NOT NULL.';
comment on column public.intakes.symptoms is
  'Booking-time visit reason / symptoms. Not a diagnosis. Visit-day new symptoms are not this column.';
comment on column public.intakes.suggested_specialty is
  'Directory filter from the visit reason (e.g. endocrinology). Not a diagnosis.';
comment on column public.intakes.clinician_name is
  'Chosen clinician display name. Optional until booked.';
comment on column public.intakes.clinic is
  'Clinic / site label. Optional.';
comment on column public.intakes.slot is
  'Requested appointment slot label. Optional. Not a live scheduler.';
comment on column public.intakes.visit_cost_guess is
  'JSON visit/cost estimate from Dave APIs. Guess only — not a bill or coverage decision.';
comment on column public.intakes.created_at is
  'Row insert time.';
comment on column public.intakes.updated_at is
  'Last writer touch. App should set this on upsert.';

alter table public.intakes add column if not exists completed_visit_id uuid;
alter table public.intakes add column if not exists status text not null default 'open';
alter table public.intakes add column if not exists symptoms text;
alter table public.intakes add column if not exists suggested_specialty text;
alter table public.intakes add column if not exists clinician_name text;
alter table public.intakes add column if not exists clinic text;
alter table public.intakes add column if not exists slot text;
alter table public.intakes add column if not exists visit_cost_guess jsonb;
alter table public.intakes add column if not exists created_at timestamptz not null default now();
alter table public.intakes add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'intakes_completed_visit_id_fkey'
      and conrelid = 'public.intakes'::regclass
  ) then
    alter table public.intakes
      add constraint intakes_completed_visit_id_fkey
      foreign key (completed_visit_id) references public.visits (id) on delete set null;
  end if;
end $$;

create index if not exists intakes_user_id_idx
  on public.intakes (user_id);

alter table public.intakes enable row level security;

drop policy if exists "intakes_select_own" on public.intakes;
create policy "intakes_select_own"
  on public.intakes
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "intakes_insert_own" on public.intakes;
create policy "intakes_insert_own"
  on public.intakes
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "intakes_update_own" on public.intakes;
create policy "intakes_update_own"
  on public.intakes
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "intakes_delete_own" on public.intakes;
create policy "intakes_delete_own"
  on public.intakes
  for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.intakes to authenticated;
grant all on public.intakes to service_role;
