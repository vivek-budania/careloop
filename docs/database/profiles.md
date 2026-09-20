# `public.profiles`

1:1 with `auth.users`. This is the **only** table login reads. Base SQL: [`supabase/migrations/20260919100000_create_profiles.sql`](../../supabase/migrations/20260919100000_create_profiles.sql); signup DOB migration: [`20260919103000_add_profile_date_of_birth.sql`](../../supabase/migrations/20260919103000_add_profile_date_of_birth.sql). Overview: [`README.md`](README.md).

Created in the hosted project’s Table Editor. The migration is idempotent and **may already exist in prod**.

## Purpose

Username → email lookup so `/api/careloop/login` can call Auth’s password grant. Display name is `first_name` + `last_name`.

**There is no credentials table.** Passwords stay in Auth. `public.logins` is an append-only sign-in **event** log (no password column).

## Columns

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|--------|
| `id` | `uuid` | no | — | **PK.** Must equal `auth.users.id`. `ON DELETE CASCADE` from Auth. |
| `username` | `text` | no | — | **Unique.** Demo handle (`jane`). Case-insensitive unique index on `lower(username)`. |
| `email` | `text` | no | — | **Unique.** Auth email (`jane@careloop.local`). |
| `first_name` | `text` | yes | — | Given name (`Jane`). |
| `last_name` | `text` | yes | — | Family name (`Doe`). |
| `date_of_birth` | `date` | yes | — | Validated patient-entered DOB captured during signup for identity-matching APIs. |
| `created_at` | `timestamptz` | no | `now()` | Insert time. |

## RLS

Enabled.

| Policy | Command | Role | Rule |
|--------|---------|------|------|
| `profiles_select_own` | `SELECT` | `authenticated` | `auth.uid() = id` |
| `profiles_update_own` | `UPDATE` | `authenticated` | `auth.uid() = id` |

No insert/delete policies for `authenticated`. Demo users are **seeded** in the dashboard. Login username lookup uses **`SUPABASE_SERVICE_ROLE_KEY` on the server** (bypasses RLS). Coverage and record rows use the **patient JWT**. Never put `service_role` in frontend JS.

## Who writes

| Actor | What |
|-------|------|
| Human in Supabase dashboard | Creates Auth user + matching `profiles` row (already done for Jane). |
| `/api/careloop/signup` | Calls Supabase Auth signup, then inserts the matching row with the server-only service role. |
| `/api/careloop/login` | **Reads** by username; does not insert or update. |
| Patient Profile screen | Today: **localStorage** display name / email / ZIP. Does **not** write this table yet. ZIP is an insurance field, not a profiles column. |
| Coverage APIs | Must **not** write this table. |

## First visit vs returning

Same `profiles` row either way. First-time vs returning is **not** stored here (no `is_returning` flag). The patient shell chooses the path at login (`I’m returning` vs `Start my first visit`).

## Do not put on `profiles`

- Plaintext or hashed **password**
- Insurance fields (`payer_name`, member id, copay, eligibility, ZIP)
- SOAP, transcripts, visit reason, clinician
- Medicines, tests, claims, PA/appeal letter bodies
- API keys, card images, Stedi/xAI secrets

- Role / tabs (app derives `role: patient` from this demo)

## Seed (hosted)

| username | email | name | Auth password |
|----------|-------|------|----------------|
| `jane` | `jane@careloop.local` | Jane Doe | `demo` |

Do not invent other live passwords. HMAC fallback usernames (`maya`, `priya`, …) are `backend/data/mock_users.json` only — not this table.
