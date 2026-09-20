-- public.tests
-- ☰ Test records. Many rows per profiles.id. Optional visit_id (ON DELETE SET NULL).
-- May not exist yet on hosted CareLoop — apply this file in the SQL editor.
-- Safe to re-run: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / DROP POLICY IF EXISTS.
--
-- Docs: docs/database/tests.md
-- document_filename is a filename only — never PDF/image bytes or data URLs.
-- CareLoop does not interpret labs. PA ≠ claim.

create table if not exists public.tests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  visit_id uuid references public.visits (id) on delete set null,
  name text not null,
  status text,
  summary text,
  document_filename text,
  ordered_at date,
  result_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tests is
  'Patient test / lab rows for ☰ Test records. Filenames only — no file bytes. Packet export is generated, not stored here.';

comment on column public.tests.id is
  'Test row UUID.';
comment on column public.tests.user_id is
  'Owner. RLS: auth.uid() = user_id.';
comment on column public.tests.visit_id is
  'Optional visit that ordered this test. ON DELETE SET NULL so the list row can outlive the visit.';
comment on column public.tests.name is
  'Display name (e.g. HbA1c). NOT NULL.';
comment on column public.tests.status is
  'UI status (e.g. result on file, To schedule). Optional.';
comment on column public.tests.summary is
  'Plain-language note. Not a lab interpretation or coverage decision.';
comment on column public.tests.document_filename is
  'Attached result filename only (e.g. hba1c.pdf). Never bytes, data URLs, or raw images.';
comment on column public.tests.ordered_at is
  'Date the test was ordered or a lab appointment was recorded. Optional.';
comment on column public.tests.result_at is
  'Date a result was attached. Optional.';
comment on column public.tests.created_at is
  'Row insert time.';
comment on column public.tests.updated_at is
  'Last writer touch. App should set this on upsert.';

alter table public.tests add column if not exists visit_id uuid;
alter table public.tests add column if not exists name text;
alter table public.tests add column if not exists status text;
alter table public.tests add column if not exists summary text;
alter table public.tests add column if not exists document_filename text;
alter table public.tests add column if not exists ordered_at date;
alter table public.tests add column if not exists result_at date;
alter table public.tests add column if not exists created_at timestamptz not null default now();
alter table public.tests add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tests_visit_id_fkey'
      and conrelid = 'public.tests'::regclass
  ) then
    alter table public.tests
      add constraint tests_visit_id_fkey
      foreign key (visit_id) references public.visits (id) on delete set null;
  end if;
end $$;

create index if not exists tests_user_id_idx
  on public.tests (user_id);

alter table public.tests enable row level security;

drop policy if exists "tests_select_own" on public.tests;
create policy "tests_select_own"
  on public.tests
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "tests_insert_own" on public.tests;
create policy "tests_insert_own"
  on public.tests
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "tests_update_own" on public.tests;
create policy "tests_update_own"
  on public.tests
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "tests_delete_own" on public.tests;
create policy "tests_delete_own"
  on public.tests
  for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.tests to authenticated;
grant all on public.tests to service_role;
