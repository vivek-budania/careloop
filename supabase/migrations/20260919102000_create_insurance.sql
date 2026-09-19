-- public.insurance
-- Hosted CareLoop: Vivek has already run this (or equivalent) in the SQL editor.
-- It may already exist in production. Safe to re-run: IF NOT EXISTS + policy drop/create.
--
-- One *current* row per user (unique index on user_id WHERE is_current).
-- Returning login hydrates coverage from is_current; no row = skip estimated costs.
-- Docs: docs/database/insurance.md

create table if not exists public.insurance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  is_current boolean not null default false,
  payer_id text,
  payer_name text not null,
  plan_type text,
  network_name text,
  member_name text,
  member_id text,
  group_number text,
  date_of_birth date,
  zip text,
  eligibility_status text,
  estimated_copay_pcp numeric,
  estimated_copay_specialist numeric,
  coinsurance_pct numeric,
  deductible numeric,
  deductible_remaining numeric,
  oop_remaining numeric,
  raw_eligibility jsonb,
  source text,
  unreadable text[],
  warnings jsonb,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint insurance_source_check
    check (source is null or source in ('mock', 'stedi'))
);

comment on table public.insurance is
  'Current (and optional historical) coverage snapshot. Estimates are not a coverage decision. PA ≠ claim.';

comment on column public.insurance.id is
  'Coverage row UUID.';
comment on column public.insurance.user_id is
  'Owner. RLS: auth.uid() = user_id.';
comment on column public.insurance.is_current is
  'At most one true row per user (partial unique index). Returning login reads this row.';
comment on column public.insurance.payer_id is
  'Fixture / dropdown id (e.g. aetna). Optional.';
comment on column public.insurance.payer_name is
  'Required insurer display name from the dropdown. NOT NULL.';
comment on column public.insurance.plan_type is
  'e.g. PPO. Optional until confirm fills it.';
comment on column public.insurance.network_name is
  'Network label (e.g. PPO Gold Plan). Optional.';
comment on column public.insurance.member_name is
  'Subscriber name as typed or scanned. Optional.';
comment on column public.insurance.member_id is
  'Member / subscriber id. Optional.';
comment on column public.insurance.group_number is
  'Group number. Optional.';
comment on column public.insurance.date_of_birth is
  'Nullable in DB so skip-insurance has no row. App requires DOB on save.';
comment on column public.insurance.zip is
  'Member ZIP (text, not integer). Optional.';
comment on column public.insurance.eligibility_status is
  'active | inactive after Confirm/Refresh. Null until then.';
comment on column public.insurance.estimated_copay_pcp is
  'Labeled PCP copay estimate. Not a bill or determination.';
comment on column public.insurance.estimated_copay_specialist is
  'Labeled specialist copay estimate. Not a bill or determination.';
comment on column public.insurance.coinsurance_pct is
  'Percent (e.g. 20). Estimate only.';
comment on column public.insurance.deductible is
  'In-network deductible amount from mock/271. Estimate only.';
comment on column public.insurance.deductible_remaining is
  'Remaining deductible. Estimate only.';
comment on column public.insurance.oop_remaining is
  'Remaining out-of-pocket. Estimate only.';
comment on column public.insurance.raw_eligibility is
  'Flattened mock or sandbox 271 JSON. No API keys.';
comment on column public.insurance.source is
  'mock | stedi. Null until Confirm/Refresh.';
comment on column public.insurance.unreadable is
  'OCR fields tagged unreadable / [NEEDS VERIFICATION].';
comment on column public.insurance.warnings is
  'JSON warnings from extract or eligibility. Not a determination.';
comment on column public.insurance.confirmed_at is
  'Set on Confirm or Refresh coverage snapshot. Null until then.';
comment on column public.insurance.updated_at is
  'Last writer touch. App should set this on upsert.';

alter table public.insurance add column if not exists is_current boolean not null default false;
alter table public.insurance add column if not exists payer_id text;
alter table public.insurance add column if not exists payer_name text;
alter table public.insurance add column if not exists plan_type text;
alter table public.insurance add column if not exists network_name text;
alter table public.insurance add column if not exists member_name text;
alter table public.insurance add column if not exists member_id text;
alter table public.insurance add column if not exists group_number text;
alter table public.insurance add column if not exists date_of_birth date;
alter table public.insurance add column if not exists zip text;
alter table public.insurance add column if not exists eligibility_status text;
alter table public.insurance add column if not exists estimated_copay_pcp numeric;
alter table public.insurance add column if not exists estimated_copay_specialist numeric;
alter table public.insurance add column if not exists coinsurance_pct numeric;
alter table public.insurance add column if not exists deductible numeric;
alter table public.insurance add column if not exists deductible_remaining numeric;
alter table public.insurance add column if not exists oop_remaining numeric;
alter table public.insurance add column if not exists raw_eligibility jsonb;
alter table public.insurance add column if not exists source text;
alter table public.insurance add column if not exists unreadable text[];
alter table public.insurance add column if not exists warnings jsonb;
alter table public.insurance add column if not exists confirmed_at timestamptz;
alter table public.insurance add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'insurance_source_check'
      and conrelid = 'public.insurance'::regclass
  ) then
    alter table public.insurance
      add constraint insurance_source_check
      check (source is null or source in ('mock', 'stedi'));
  end if;
end $$;

-- One current coverage row per user. Historical rows keep is_current = false.
create unique index if not exists insurance_one_current_per_user
  on public.insurance (user_id)
  where is_current;

create index if not exists insurance_user_id_idx
  on public.insurance (user_id);

alter table public.insurance enable row level security;

drop policy if exists "insurance_own_rows" on public.insurance;
create policy "insurance_own_rows"
  on public.insurance
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.insurance to authenticated;
grant all on public.insurance to service_role;
