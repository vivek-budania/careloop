# `public.claims`

Many rows per `profiles.id`. Mock **EOB / claim** snapshot **after billing**. SQL: [`supabase/migrations/20260919107000_create_claims.sql`](../../supabase/migrations/20260919107000_create_claims.sql). Overview: [`README.md`](README.md).

Vivek has already created this table in hosted Supabase. The migration is idempotent and **may already exist in prod**. The Insurance screen still shows **Insurance Claims Management — Coming soon**. The running app does **not** persist claims yet — do not wire it from a docs change.

## Purpose

Store a **mock** explanation-of-benefits style row so a later claims UI can show billed vs patient-owed without inventing a real claim file. This is **not** prior authorization (that happens **before** care is authorized) and **not** a PA/appeal/demand letter (`/letters` + HITL + watermark).

**PA ≠ claim.** Do not collapse the two insurance moments.

## Cardinality

- FK: `user_id → profiles.id` (`ON DELETE CASCADE`)
- Optional FK: `visit_id → visits.id` (`ON DELETE SET NULL`)
- **`profiles` 1:many `claims`**

## Columns

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|--------|
| `id` | `uuid` | no | `gen_random_uuid()` | **PK.** |
| `user_id` | `uuid` | no | — | **FK → `profiles.id`**. RLS owner. |
| `visit_id` | `uuid` | yes | — | **FK → `visits.id`**. Optional. `ON DELETE SET NULL`. |
| `service_name` | `text` | yes | — | Display service (e.g. Office visit). |
| `status` | `text` | yes | — | Mock claim/EOB status (e.g. `not submitted`). Not a PA decision. |
| `billed_amount` | `numeric` | yes | — | Mock billed / allowed amount. Not a live claim. |
| `patient_owes` | `numeric` | yes | — | Mock patient-owed from the EOB. Not a bill CareLoop collects. |
| `eob_summary` | `text` | yes | — | Short mock EOB blurb. **Not** a letter body. |
| `source` | `text` | no | `'mock'` | Mock only. Not a clearinghouse. **No API keys.** |
| `created_at` | `timestamptz` | no | `now()` | Insert time. |
| `updated_at` | `timestamptz` | no | `now()` | Writer should bump on upsert. |

Index: `(user_id)`.

Amounts here are demo figures. Visit/cost **guesses** before billing live on [`intakes`](intakes.md) `visit_cost_guess`, not on this table.

## RLS

Enabled. **`auth.uid() = user_id`.** Four policies (not a single `ALL`):

| Policy | Command | Role | Rule |
|--------|---------|------|------|
| `claims_select_own` | `SELECT` | `authenticated` | `USING (auth.uid() = user_id)` |
| `claims_insert_own` | `INSERT` | `authenticated` | `WITH CHECK (auth.uid() = user_id)` |
| `claims_update_own` | `UPDATE` | `authenticated` | `USING` + `WITH CHECK` |
| `claims_delete_own` | `DELETE` | `authenticated` | `USING (auth.uid() = user_id)` |

Login does not read this table. `service_role` bypasses RLS (server jobs later).

## Who writes

| Actor | What |
|-------|------|
| Patient JWT (intended) | Insert/update when a mock EOB is recorded for a completed visit. |
| Running app today | Coming soon on Insurance. No claims API yet. |
| Dave cost guess | Writes in-memory `visit_cost_estimate` / `claim_acceptance`. That is **not** this table. |
| `/letters` PA/parse/appeal/demand | Watermarked drafts only. **Must not** write this table. |
| Login / coverage confirm | Must not insert claim rows. |

## Do not put on `claims`

- PA / appeal / demand **letter bodies**, watermarks, or HITL state
- Full **transcripts** / audio / SOAP (use [`visits`](visits.md) `soap` or the scribe API)
- In-progress journeys (use [`intakes`](intakes.md))
- Prescriptions / tests (use [`medicines`](medicines.md) / [`tests`](tests.md))
- Card / SBC **images** or raw `b64`
- API keys, `service_role`, Stedi/Gemini/Groq secrets
- A live 837/835 / CARC-RARC codebook table
- Clinic packet file bytes
- Passwords / a `login` table

`eob_summary` is a mock blurb, not an appeal. An approved PA (if the demo ever flags one) still does not mean this claim was paid. **PA ≠ claim.**
