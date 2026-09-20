# `public.intakes`

Many rows per `profiles.id`. In-progress visit journey (**Upcoming visits** / booking) **before** a History `visits` row. SQL: [`supabase/migrations/20260919106000_create_intakes.sql`](../../supabase/migrations/20260919106000_create_intakes.sql). Overview: [`README.md`](README.md).

Vivek has already created this table in hosted Supabase. The migration is idempotent and **may already exist in prod**. The running app still keeps open journeys in **`localStorage` `openVisits`** until a later wiring PR — do not wire it from a docs change.

## Purpose

Hold the 8-step visit while it is still in flight: symptoms, suggested specialty, chosen clinician, requested slot, and an optional visit/cost **guess**. When the journey is saved onto History, set `completed_visit_id` to that [`visits`](visits.md) row. Do **not** treat an intake as a completed visit, a coverage decision, or a claim.

`visit_cost_guess` is a labeled estimate (Dave `guessVisitCost`). It is **not** a bill, quote, or prior authorization.

## Cardinality

- FK: `user_id → profiles.id` (`ON DELETE CASCADE`)
- Optional FK: `completed_visit_id → visits.id` (`ON DELETE SET NULL`)
- **`profiles` 1:many `intakes`**

## Columns

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|--------|
| `id` | `uuid` | no | `gen_random_uuid()` | **PK.** |
| `user_id` | `uuid` | no | — | **FK → `profiles.id`**. RLS owner. |
| `completed_visit_id` | `uuid` | yes | — | **FK → `visits.id`**. Set when the journey is saved onto History. `ON DELETE SET NULL`. |
| `status` | `text` | **no** | `'open'` | In-progress until History save. |
| `symptoms` | `text` | yes | — | Booking-time reason / symptoms. Not a diagnosis. |
| `suggested_specialty` | `text` | yes | — | Directory filter (e.g. `endocrinology`). Not a diagnosis. |
| `clinician_name` | `text` | yes | — | Chosen clinician display name. |
| `clinic` | `text` | yes | — | Site / clinic label. Optional. |
| `slot` | `text` | yes | — | Requested appointment label. Not a live scheduler. |
| `visit_cost_guess` | `jsonb` | yes | — | Cost estimate JSON. Guess only. |
| `created_at` | `timestamptz` | no | `now()` | Insert time. |
| `updated_at` | `timestamptz` | no | `now()` | Writer should bump on upsert. |

Index: `(user_id)`.

### `visit_cost_guess` shape (when present)

Matches Dave’s visit-guess payload. `is_guess` stays true. Do not treat totals as a coverage determination or a [`claims`](claims.md) row:

```json
{
  "is_guess": true,
  "disclaimer": "Guess only — not a bill, quote, or coverage decision.",
  "likely_visits": [],
  "patient_owes_low": 75,
  "patient_owes_high": 75
}
```

A nested `claim_acceptance` object, if present, is still a **guess** about a later claim. It is not PA and not a row in `claims`. **PA ≠ claim.**

## RLS

Enabled. **`auth.uid() = user_id`.** Four policies (not a single `ALL`):

| Policy | Command | Role | Rule |
|--------|---------|------|------|
| `intakes_select_own` | `SELECT` | `authenticated` | `USING (auth.uid() = user_id)` |
| `intakes_insert_own` | `INSERT` | `authenticated` | `WITH CHECK (auth.uid() = user_id)` |
| `intakes_update_own` | `UPDATE` | `authenticated` | `USING` + `WITH CHECK` |
| `intakes_delete_own` | `DELETE` | `authenticated` | `USING (auth.uid() = user_id)` |

Login does not read this table. `service_role` bypasses RLS (server jobs later).

## Who writes

| Actor | What |
|-------|------|
| Patient JWT (intended) | Insert/update as the visit journey advances; set `completed_visit_id` when History save exists. |
| Running app today | **`localStorage`** `openVisits` / `journey` (`frontend/js/careloop.js`). No intakes API yet. |
| Dave coverage APIs | In-memory intake + `visit_cost_estimate`. **Not this table.** |
| Login / insurance / letters | Must not write this table. |

## First visit vs returning

| Path | Rows |
|------|------|
| **Start my first visit** | Zero or more `open` rows as the patient books. Empty is valid. |
| **I’m returning** | Open rows are upcoming visits; completed ones may keep `completed_visit_id`. Demo upcoming visits today are **local**, not this table. |

## Do not put on `intakes`

- Completed History SOAP / summary (use [`visits`](visits.md) once saved)
- Visit-day **new symptoms** (`journey.new_symptoms`) — still local, not this column
- Full **transcripts** / audio / STT blobs
- Prescriptions / tests (use [`medicines`](medicines.md) / [`tests`](tests.md))
- Mock EOB / billed amounts (use [`claims`](claims.md))
- PA / appeal / demand letter bodies or watermarks
- Card images, member id, copays (use [`insurance`](insurance.md))
- API keys, `service_role`, secrets
- Clinic packet file bytes
- Passwords / a `login` table

`status = 'open'` is not “coverage approved.” Finishing the cost step does not create a claim. **PA ≠ claim.**
