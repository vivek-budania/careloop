-- public.medicines
-- ☰ Prescriptions. Many rows per profiles.id. Optional visit_id (ON DELETE SET NULL).
-- May not exist yet on hosted CareLoop — apply this file in the SQL editor.
-- Safe to re-run: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / DROP POLICY IF EXISTS.
--
-- Docs: docs/database/medicines.md
-- Not eRx. refill_requested is a local draft flag, not a pharmacy send.
-- Do not store API keys or letter bodies here.

create table if not exists public.medicines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  visit_id uuid references public.visits (id) on delete set null,
  name text not null,
  dose text,
  times_per_day integer,
  schedule jsonb,
  sig text,
  refill_days_left integer,
  refill_requested boolean not null default false,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.medicines is
  'Patient prescription list for ☰ Prescriptions. Not e-prescribing. Packet export is generated, not stored here.';

comment on column public.medicines.id is
  'Medicine row UUID.';
comment on column public.medicines.user_id is
  'Owner. RLS: auth.uid() = user_id.';
comment on column public.medicines.visit_id is
  'Optional visit that added this Rx. ON DELETE SET NULL so the list row can outlive the visit.';
comment on column public.medicines.name is
  'Display name (e.g. Metformin). NOT NULL.';
comment on column public.medicines.dose is
  'Dose string (e.g. 1000 mg). Optional. CareLoop does not change the dose.';
comment on column public.medicines.times_per_day is
  'How often per day (integer). Optional.';
comment on column public.medicines.schedule is
  'JSON dose log, e.g. {"morning":"taken","evening":"upcoming"}. Values such as taken | upcoming | missed.';
comment on column public.medicines.sig is
  'Free-text directions (SIG). Optional. Not a signed order.';
comment on column public.medicines.refill_days_left is
  'Demo days of supply remaining. Optional estimate, not a PBM quantity.';
comment on column public.medicines.refill_requested is
  'True when the patient drafted a refill note for the clinic. Default false. Not sent / not eRx.';
comment on column public.medicines.status is
  'UI status (e.g. active, To take, To buy). Optional.';
comment on column public.medicines.created_at is
  'Row insert time.';
comment on column public.medicines.updated_at is
  'Last writer touch. App should set this on upsert.';

alter table public.medicines add column if not exists visit_id uuid;
alter table public.medicines add column if not exists name text;
alter table public.medicines add column if not exists dose text;
alter table public.medicines add column if not exists times_per_day integer;
alter table public.medicines add column if not exists schedule jsonb;
alter table public.medicines add column if not exists sig text;
alter table public.medicines add column if not exists refill_days_left integer;
alter table public.medicines add column if not exists refill_requested boolean not null default false;
alter table public.medicines add column if not exists status text;
alter table public.medicines add column if not exists created_at timestamptz not null default now();
alter table public.medicines add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'medicines_visit_id_fkey'
      and conrelid = 'public.medicines'::regclass
  ) then
    alter table public.medicines
      add constraint medicines_visit_id_fkey
      foreign key (visit_id) references public.visits (id) on delete set null;
  end if;
end $$;

create index if not exists medicines_user_id_idx
  on public.medicines (user_id);

alter table public.medicines enable row level security;

drop policy if exists "medicines_select_own" on public.medicines;
create policy "medicines_select_own"
  on public.medicines
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "medicines_insert_own" on public.medicines;
create policy "medicines_insert_own"
  on public.medicines
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "medicines_update_own" on public.medicines;
create policy "medicines_update_own"
  on public.medicines
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "medicines_delete_own" on public.medicines;
create policy "medicines_delete_own"
  on public.medicines
  for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.medicines to authenticated;
grant all on public.medicines to service_role;
