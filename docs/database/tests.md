# `public.tests`

Many rows per `profiles.id`. Patient hamburger **Test records**. SQL: [`supabase/migrations/20260919105000_create_tests.sql`](../../supabase/migrations/20260919105000_create_tests.sql). Overview: [`README.md`](README.md).

This table is **new SQL** in this docs PR. The running app still keeps test records in **`localStorage`** until a later wiring PR — do not wire it from a docs change.

## Purpose

One row per lab / imaging item: results already on file, or tests still to complete. Optional `visit_id` links a row to the visit that ordered it. CareLoop does **not** interpret labs, book a real appointment, or store file bytes.

The clinic packet (`.md` / PDF) is assembled at export time from visits + meds + tests + coverage. **The packet is not a table.**

## Cardinality

- FK: `user_id → profiles.id` (`ON DELETE CASCADE`)
- Optional FK: `visit_id → visits.id` (`ON DELETE SET NULL`) — deleting a visit unlinks the test; it stays on the list
- **`profiles` 1:many `tests`**

## Columns

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|--------|
| `id` | `uuid` | no | `gen_random_uuid()` | **PK.** |
| `user_id` | `uuid` | no | — | **FK → `profiles.id`**. RLS owner. |
| `visit_id` | `uuid` | yes | — | **FK → `visits.id`**. Optional. `ON DELETE SET NULL`. |
| `name` | `text` | **no** | — | Display name (e.g. HbA1c). |
| `status` | `text` | yes | — | UI label (`result on file`, `To schedule`, …). |
| `summary` | `text` | yes | — | Plain-language note. **Not** a lab interpretation. |
| `document_filename` | `text` | yes | — | **Filename only** (e.g. `hba1c.pdf`). Never bytes, `dataUrl`, or raw images. |
| `ordered_at` | `date` | yes | — | Order / lab-appointment date. |
| `result_at` | `date` | yes | — | Date a result was attached. |
| `created_at` | `timestamptz` | no | `now()` | Insert time. |
| `updated_at` | `timestamptz` | no | `now()` | Writer should bump on upsert. |

Index: `(user_id)` for the Test records list.

## RLS

Enabled. **`auth.uid() = user_id`.** Four policies (not a single `ALL`):

| Policy | Command | Role | Rule |
|--------|---------|------|------|
| `tests_select_own` | `SELECT` | `authenticated` | `USING (auth.uid() = user_id)` |
| `tests_insert_own` | `INSERT` | `authenticated` | `WITH CHECK (auth.uid() = user_id)` |
| `tests_update_own` | `UPDATE` | `authenticated` | `USING` + `WITH CHECK` |
| `tests_delete_own` | `DELETE` | `authenticated` | `USING (auth.uid() = user_id)` |

Patients only see and write their own rows. `service_role` bypasses RLS (server jobs later; login does not read this table).

## Who writes

| Actor | What |
|-------|------|
| Patient JWT (intended) | Insert/update when Test records is saved, a result filename is attached, or a visit plan is applied. |
| Running app today | **`localStorage` thread** (`frontend/js/careloop.js`: `testRecords`). No tests API yet. Demo may keep a picture/PDF in the browser — **do not** copy those bytes into this table. |
| Scribe / plan APIs | Return lab/imaging items in JSON. They do **not** persist this table today. |
| Login / coverage / insurance | Must not write this table. |
| Letters / claims UI | Must not write this table. **PA ≠ claim.** |

## First visit vs returning

| Path | Rows |
|------|------|
| **Start my first visit** | None until a journey finishes and Test records is updated. Empty list is valid. |
| **I’m returning** | Zero or more. Demo UI currently **seeds** an HbA1c sample locally — that seed is **not** this table until wired. |

## Do not put on `tests`

- PDF / image **bytes**, `dataUrl`, base64, or object storage keys for raw files
- Clinical interpretation, diagnosis, or coverage decisions
- Prescriptions / medicines (use [`medicines`](medicines.md))
- Full **transcripts**, SOAP (use [`visits`](visits.md) `soap` or the scribe API)
- Claims, EOB, CARC/RARC
- PA / appeal / demand letter bodies or watermarks
- Card images, member id, copays (use [`insurance`](insurance.md))
- API keys, `service_role`, secrets
- Clinic packet file bytes
- Passwords

`summary` is not “result approved” and not a paid claim. Imaging that might need prior auth is still **not** a claim row. **PA ≠ claim.**
