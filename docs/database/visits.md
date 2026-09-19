# `public.visits`

Many rows per `profiles.id`. Patient **History → My visits**. SQL: [`supabase/migrations/20260919101000_create_visits.sql`](../../supabase/migrations/20260919101000_create_visits.sql). Overview: [`README.md`](README.md).

Vivek has already created this table in hosted Supabase. The migration is idempotent and **may already exist in prod**. The running app still keeps visit history in **`localStorage`** until a later wiring PR — do not wire it from a docs change.

## Purpose

One row per saved visit so the hamburger History list can show date, reason, clinician, review state, and a coverage **label**. The **For the clinic** packet is assembled at export time from these rows (plus meds/tests/coverage in the UI). **The packet is not a table.**

## Columns

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|--------|
| `id` | `uuid` | no | `gen_random_uuid()` | **PK.** |
| `user_id` | `uuid` | no | — | **FK → `profiles.id`** (`ON DELETE CASCADE`). Owner. |
| `visit_date` | `date` | yes | — | Calendar date. Null until booked. |
| `reason` | `text` | yes | — | Visit title (e.g. Diabetes follow-up). |
| `clinician_name` | `text` | yes | — | Display name (e.g. Dr. Priya Shah). |
| `clinic` | `text` | yes | — | Site / clinic label. Optional. |
| `summary` | `text` | yes | — | Plain-language “what happened.” Not a signed chart note. |
| `soap` | `jsonb` | yes | — | Optional SOAP object: `subjective`, `objective`, `assessment`, `plan_summary`. Draft until `reviewed`. |
| `reviewed` | `boolean` | no | `false` | Clinician-review **simulated** in the demo. Not a PA or claim decision. |
| `coverage_label` | `text` | yes | — | Denormalized plan name at visit time (e.g. `Aetna`). Not a live FK to `insurance`. Not a coverage determination. |
| `created_at` | `timestamptz` | no | `now()` | Insert time. |

Index: `(user_id, visit_date DESC)` for History lists.

### `soap` shape (when present)

Matches the scribe draft, not a second schema:

```json
{
  "subjective": "",
  "objective": "",
  "assessment": "",
  "plan_summary": ""
}
```

Uncertain clinical text still belongs behind clinician review. Do not treat this JSON as an EHR write-back.

## RLS

Enabled. **`auth.uid() = user_id`.**

| Policy | Command | Role | Rule |
|--------|---------|------|------|
| `visits_own_rows` | `ALL` | `authenticated` | `USING` + `WITH CHECK` (`auth.uid() = user_id`) |

Patients only see and write their own visits. `service_role` bypasses RLS (server jobs later; login does not read this table).

## Who writes

| Actor | What |
|-------|------|
| Patient JWT (intended) | Insert/update when a visit journey is saved onto History. |
| Running app today | **`localStorage` thread** (`frontend/js/careloop.js`). No `visits` API yet. |
| Scribe APIs | Draft SOAP in memory / response JSON. They do **not** persist this table today. |
| Coverage / Insurance screens | Must not insert visit rows. `coverage_label` is a snapshot string copied at save time. |
| Login | Does not read or write `visits`. |

## First visit vs returning

| Path | Rows |
|------|------|
| **Start my first visit** | None until the patient finishes a journey and History save exists. Empty list is valid. |
| **I’m returning** | Zero or more prior rows. Demo UI currently **seeds** one local visit (Diabetes follow-up / Dr. Priya Shah / Aetna) — that seed is **not** automatically this table until wired. |

Completed visits **append**; they are not overwritten. The visit journey is **not** a hamburger item; History is.

## History packet

Generated markdown/PDF from the care record. Rules:

- Record export only — **not** a PA, appeal, or demand letter.
- Must not skip HITL/watermark for generated **letters**.
- Do **not** add a `packets` table for the hackathon.

## Do not put on `visits`

- Full **transcripts** / audio / STT blobs (scribe fixture or `/scribe/transcribe`)
- Medicines, Rx SIG, refill state
- Tests, lab PDFs, results interpretation
- Claims, EOB, CARC/RARC
- PA / appeal letter bodies or watermarks
- Card images, member id, copays (use `insurance`; only a `coverage_label` here)
- API keys
- Clinic packet file bytes

`reviewed` is not “coverage approved” and not “PA submitted.” **PA ≠ claim.**
