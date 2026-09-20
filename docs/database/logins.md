# `public.logins`

Many rows per `profiles.id`. **Sign-in event log**, not a credentials table. SQL: [`supabase/migrations/20260919108000_create_logins.sql`](../../supabase/migrations/20260919108000_create_logins.sql). Overview: [`README.md`](README.md).

This table is **new SQL** in this docs PR. `/api/careloop/login` still looks up [`profiles`](profiles.md) then Auth — it does **not** write `logins` yet. Do not wire it from a docs change.

## Purpose

One row per sign-in **event** (when the attempt happened, which handle, optional IP / user-agent, success). It is **not** how the app authenticates.

- Passwords stay in **Supabase Auth**. There is still **no** table that stores password hashes besides Auth.
- There is **no password column** here. Do not add one.
- Username on this row is a snapshot of the handle typed at sign-in, not a unique login id.

## Cardinality

- FK: `user_id → profiles.id` (`ON DELETE CASCADE`)
- **`profiles` 1:many `logins`** (events)

Unknown-username attempts have no `profiles.id`, so they are **not** stored here.

## Columns

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|--------|
| `id` | `uuid` | no | `gen_random_uuid()` | **PK.** Event id. |
| `user_id` | `uuid` | **no** | — | **FK → `profiles.id`**. RLS owner. |
| `username` | `text` | yes | — | Handle used at sign-in (`jane`). Snapshot only. |
| `logged_in_at` | `timestamptz` | **no** | `now()` | When the attempt happened. |
| `ip` | `text` | yes | — | Client IP if recorded. Not a secret. |
| `user_agent` | `text` | yes | — | Client user-agent if recorded. |
| `success` | `boolean` | **no** | `true` | Auth grant succeeded. |
| `created_at` | `timestamptz` | **no** | `now()` | Row insert time. |

Index: `(user_id, logged_in_at DESC)`.

## RLS (append-only)

Enabled. **`auth.uid() = user_id`.** Select and insert only — **no** update or delete policies for `authenticated`.

| Policy | Command | Role | Rule |
|--------|---------|------|------|
| `logins_select_own` | `SELECT` | `authenticated` | `USING (auth.uid() = user_id)` |
| `logins_insert_own` | `INSERT` | `authenticated` | `WITH CHECK (auth.uid() = user_id)` |

A successful login can insert after the JWT exists. Failed attempts for a **known** profile (if recorded later) need **`service_role`** on the server — there is no JWT yet. `service_role` bypasses RLS.

`authenticated` is granted `SELECT` and `INSERT` only (not `UPDATE` / `DELETE`).

## Who writes

| Actor | What |
|-------|------|
| Patient JWT (intended) | Insert one event after a successful Auth grant. |
| Server `service_role` (intended) | Optional `success = false` for a known `profiles.id`. |
| Running app today | **Does not write this table.** Login reads `profiles` + Auth only. |
| Coverage / visits / letters | Must not write this table. |

## Do not put on `logins`

- Plaintext or hashed **password**, refresh tokens, JWTs, session secrets
- API keys, `service_role`, Stedi/Gemini/Groq secrets
- Insurance, SOAP, transcripts, medicines, tests, claims, PA/appeal letter bodies
- Card images
- Clinic packet file bytes

This is not a `login` **credentials** table. Auth remains username → `profiles` → email + Auth password. **PA ≠ claim** is unchanged (this table is unrelated to either).
