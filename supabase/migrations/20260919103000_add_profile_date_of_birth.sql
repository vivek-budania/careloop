-- Store the DOB collected during self-serve signup on public.profiles.
-- Safe to re-run against the hosted CareLoop project.

alter table public.profiles
  add column if not exists date_of_birth date;

comment on column public.profiles.date_of_birth is
  'Patient-entered date of birth captured during signup for APIs that require identity matching.';
