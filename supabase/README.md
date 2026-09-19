# `supabase/`

Checked-in SQL for the **hosted** CareLoop Supabase project. This folder is the schema source agents can read and replay. It is **not** a local Supabase stack.

## Hosted project (required)

CareLoop login and these tables live on the existing cloud project (URL in [`.env.example`](../.env.example) as `SUPABASE_URL`). You do **not** need the Supabase CLI, Docker, or `supabase start` to run the app.

Server-side env (never frontend JS, never commit real values):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Login still uses **Auth + `public.profiles` only**. See [`docs/database/`](../docs/database/README.md).

## Layout

| Path | Role |
|------|------|
| [`migrations/`](migrations/) | Timestamped `.sql` files matching tables already created in the hosted project (`profiles`, `visits`, `insurance`). |
| This README | How to treat the folder. Table semantics live under `docs/database/`. |

There is no `config.toml` on purpose: this repo does not require a local CLI-linked project.

## Migrations vs production

Vivek already created `visits` and `insurance` in the hosted SQL editor / Table Editor. `profiles` was created in the dashboard UI (login lookup). These files are **idempotent** (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS` then recreate) so:

- **Fresh env:** applying them creates the same tables, indexes, and RLS.
- **Hosted CareLoop:** `CREATE TABLE IF NOT EXISTS` is a no-op if the table is already there. Comments in each file say so.

Do not treat applying these files as a data wipe. They do not insert Jane Doe, coverage rows, or visits.

## How to apply (optional)

Only if you are standing up a **new** Supabase project or comparing a blank schema:

1. Open the project SQL editor (or `supabase db query` if you already use the CLI).
2. Run the files in timestamp order under `migrations/`.
3. Seed Auth + a `profiles` row separately (demo: username `jane`, email `jane@careloop.local`). There is **no** `login` table.

Do not paste `service_role` keys into this repo, chat, or frontend JS.

## Table docs (source of truth for columns)

- Overview / ER: [`docs/database/README.md`](../docs/database/README.md)
- [`docs/database/profiles.md`](../docs/database/profiles.md)
- [`docs/database/visits.md`](../docs/database/visits.md)
- [`docs/database/insurance.md`](../docs/database/insurance.md)

## Out of scope for this folder

- Wiring coverage APIs or changing login.
- Medicines, tests, claims, PA/appeal letters (not tables yet).
- Card images, API keys, transcripts as first-class columns.
