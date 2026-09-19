-- public.visits
-- Hosted CareLoop: Vivek has already run this (or equivalent) in the SQL editor.
-- It may already exist in production. Safe to re-run: IF NOT EXISTS + policy drop/create.
--
-- Many visits per profiles.id. History → My visits. The clinic packet is generated,
-- not a table. Docs: docs/database/visits.md

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  visit_date date,
  reason text,
  clinician_name text,
  clinic text,
  summary text,
  soap jsonb,
  reviewed boolean not null default false,
  coverage_label text,
  created_at timestamptz not null default now()
);

comment on table public.visits is
  'Patient visit rows for History → My visits. Packet export is generated from these + other UI state, not stored here.';

comment on column public.visits.id is
  'Visit UUID.';
comment on column public.visits.user_id is
  'Owner. RLS: auth.uid() = user_id.';
comment on column public.visits.visit_date is
  'Calendar date of the visit. Nullable until booked.';
comment on column public.visits.reason is
  'Chief reason / visit title (e.g. Diabetes follow-up).';
comment on column public.visits.clinician_name is
  'Display name of the clinician (e.g. Dr. Priya Shah).';
comment on column public.visits.clinic is
  'Clinic / site label. Optional.';
comment on column public.visits.summary is
  'Plain-language visit summary for History. Not a signed note.';
comment on column public.visits.soap is
  'Optional SOAP JSON (subjective, objective, assessment, plan_summary). Draft until reviewed.';
comment on column public.visits.reviewed is
  'Clinician-review simulated flag. Default false. Not an approval of coverage or PA.';
comment on column public.visits.coverage_label is
  'Denormalized plan label at visit time (e.g. Aetna). Not a live join and not a coverage decision.';
comment on column public.visits.created_at is
  'Row insert time.';

alter table public.visits add column if not exists visit_date date;
alter table public.visits add column if not exists reason text;
alter table public.visits add column if not exists clinician_name text;
alter table public.visits add column if not exists clinic text;
alter table public.visits add column if not exists summary text;
alter table public.visits add column if not exists soap jsonb;
alter table public.visits add column if not exists reviewed boolean not null default false;
alter table public.visits add column if not exists coverage_label text;
alter table public.visits add column if not exists created_at timestamptz not null default now();

create index if not exists visits_user_id_visit_date_idx
  on public.visits (user_id, visit_date desc nulls last);

alter table public.visits enable row level security;

drop policy if exists "visits_own_rows" on public.visits;
create policy "visits_own_rows"
  on public.visits
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.visits to authenticated;
grant all on public.visits to service_role;
