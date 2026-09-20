# `supabase/`

Checked-in SQL for the **hosted** CareLoop Supabase project. This folder is the schema source agents can read and replay. It is **not** a local Supabase stack.

## Hosted project (required)

CareLoop signup/login and these tables live on the existing cloud project (URL in [`.env.example`](../.env.example) as `SUPABASE_URL`). You do **not** need the Supabase CLI, Docker, or `supabase start` to run the app.

Server-side env (never frontend JS, never commit real values):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Signup and login use **Auth + `public.profiles` only**. Signup uses the normal Auth signup endpoint, then the server service role creates the matching profile. See [`docs/database/`](../docs/database/README.md).

## Layout

| Path | Role |
|------|------|
| [`migrations/`](migrations/) | Timestamped `.sql` files for hosted tables (`profiles`, `visits`, `insurance`, `medicines`, `tests`, `intakes`, `claims`). |
| This README | How to treat the folder. Table semantics live under `docs/database/`. |

There is no `config.toml` on purpose: this repo does not require a local CLI-linked project.

## Migrations vs production

Vivek already created `visits`, `insurance`, `intakes`, and `claims` in the hosted SQL editor / Table Editor. `profiles` was created in the dashboard UI (login lookup). `medicines` and `tests` are **new** in this folder — apply those files on hosted CareLoop after `visits`. These files are **idempotent** (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS` then recreate) so:

- **Fresh env:** applying them creates the same tables, indexes, and RLS.
- **Hosted CareLoop:** `CREATE TABLE IF NOT EXISTS` is a no-op if the table is already there. Comments in each file say so.

Do not treat applying these files as a data wipe. They do not insert Jane Doe, coverage rows, visits, medicines, tests, intakes, or claims.

## How to apply (optional)

Only if you are standing up a **new** Supabase project or comparing a blank schema:

1. Open the project SQL editor (or `supabase db query` if you already use the CLI).
2. Run the files in timestamp order under `migrations/`.
3. Seed Auth + a `profiles` row separately (demo: username `jane`, email `jane@careloop.local`). There is **no** `login` table.

Do not paste `service_role` keys into this repo, chat, or frontend JS.

`20260919103000_add_profile_date_of_birth.sql` must be applied before deploying the self-serve signup endpoint; otherwise the profile insert intentionally fails and the newly created Auth user is rolled back.

`20260919104000_create_medicines.sql` and `20260919105000_create_tests.sql` depend on `profiles` and `visits`. They do not seed Metformin / HbA1c rows. The app does not read these tables yet.

`20260919106000_create_intakes.sql` and `20260919107000_create_claims.sql` may already exist on hosted CareLoop. They depend on `profiles` and `visits`. The app does not read them yet. Mock EOB on `claims` is not a PA letter.

## Table docs (source of truth for columns)

- Overview / ER: [`docs/database/README.md`](../docs/database/README.md)
- [`docs/database/profiles.md`](../docs/database/profiles.md)
- [`docs/database/visits.md`](../docs/database/visits.md)
- [`docs/database/insurance.md`](../docs/database/insurance.md)
- [`docs/database/medicines.md`](../docs/database/medicines.md)
- [`docs/database/tests.md`](../docs/database/tests.md)
- [`docs/database/intakes.md`](../docs/database/intakes.md)
- [`docs/database/claims.md`](../docs/database/claims.md)

## Out of scope for this folder

- Wiring coverage, intakes, medicines, tests, or claims APIs, or changing login.
- PA/appeal letters, history packet, transcripts (not tables).
- Card images, API keys, or file bytes as first-class columns (`tests.document_filename` is a filename only).
