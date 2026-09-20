# `public.medicines`

Many rows per `profiles.id`. Patient hamburger **Prescriptions**. SQL: [`supabase/migrations/20260919104000_create_medicines.sql`](../../supabase/migrations/20260919104000_create_medicines.sql). Overview: [`README.md`](README.md).

This table is **new SQL** in this docs PR. The running app still keeps prescriptions, doses, and refill drafts in **`localStorage`** until a later wiring PR — do not wire it from a docs change.

## Purpose

One row per medicine on the patient’s list (what to keep taking, what to pick up). Optional `visit_id` links a row to the visit that added it. Logging taken/missed only updates `schedule`. CareLoop does **not** e-prescribe, change the dose, or send a refill.

The clinic packet (`.md` / PDF) is assembled at export time from visits + meds + tests + coverage. **The packet is not a table.**

## Cardinality

- FK: `user_id → profiles.id` (`ON DELETE CASCADE`)
- Optional FK: `visit_id → visits.id` (`ON DELETE SET NULL`) — deleting a visit unlinks the Rx; it stays on the list
- **`profiles` 1:many `medicines`**

## Columns

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|--------|
| `id` | `uuid` | no | `gen_random_uuid()` | **PK.** |
| `user_id` | `uuid` | no | — | **FK → `profiles.id`**. RLS owner. |
| `visit_id` | `uuid` | yes | — | **FK → `visits.id`**. Optional. `ON DELETE SET NULL`. |
| `name` | `text` | **no** | — | Display name (e.g. Metformin). |
| `dose` | `text` | yes | — | e.g. `1000 mg`. Demo display only. |
| `times_per_day` | `integer` | yes | — | How often per day. Optional. |
| `schedule` | `jsonb` | yes | — | Dose log. See shape below. |
| `sig` | `text` | yes | — | Free-text directions. Not a signed order. |
| `refill_days_left` | `integer` | yes | — | Demo days remaining. Not a PBM quantity. |
| `refill_requested` | `boolean` | no | `false` | True after the patient drafts a clinic refill note. **Not sent.** |
| `status` | `text` | yes | — | UI label (`active`, `To take`, `To buy`, …). |
| `created_at` | `timestamptz` | no | `now()` | Insert time. |
| `updated_at` | `timestamptz` | no | `now()` | Writer should bump on upsert. |

Index: `(user_id)` for the Prescriptions list.

### `schedule` shape (when present)

Matches the patient-shell dose chips (morning / evening). Values are demo strings, not pharmacy events:

```json
{
  "morning": "taken",
  "evening": "upcoming"
}
```

Allowed examples: `taken`, `upcoming`, `missed`. Do not treat this JSON as an eRx or adherence medical record.

## RLS

Enabled. **`auth.uid() = user_id`.** Four policies (not a single `ALL`):

| Policy | Command | Role | Rule |
|--------|---------|------|------|
| `medicines_select_own` | `SELECT` | `authenticated` | `USING (auth.uid() = user_id)` |
| `medicines_insert_own` | `INSERT` | `authenticated` | `WITH CHECK (auth.uid() = user_id)` |
| `medicines_update_own` | `UPDATE` | `authenticated` | `USING` + `WITH CHECK` |
| `medicines_delete_own` | `DELETE` | `authenticated` | `USING (auth.uid() = user_id)` |

Patients only see and write their own rows. `service_role` bypasses RLS (server jobs later; login does not read this table).

## Who writes

| Actor | What |
|-------|------|
| Patient JWT (intended) | Insert/update when Prescriptions is saved, or when a visit plan is applied to the list. |
| Running app today | **`localStorage` thread** (`frontend/js/careloop.js`: `prescriptions`, `doses`, `refill`). No medicines API yet. |
| Scribe / plan APIs | Return Rx items in JSON. They do **not** persist this table today. |
| Login / coverage / insurance | Must not write this table. |
| Letters / claims UI | Must not write this table. **PA ≠ claim.** |

## First visit vs returning

| Path | Rows |
|------|------|
| **Start my first visit** | None until a journey finishes and Prescriptions is updated. Empty list is valid. |
| **I’m returning** | Zero or more. Demo UI currently **seeds** Metformin locally — that seed is **not** this table until wired. |

## Do not put on `medicines`

- eRx / NDC / pharmacy send / live PBM
- Full **transcripts**, SOAP (those stay on [`visits`](visits.md) `soap` or the scribe API)
- Tests / lab files (use [`tests`](tests.md); filenames only there)
- Claims, EOB (use [`claims`](claims.md); mock EOB only — not PA letter bodies)
- PA / appeal / demand letter bodies or watermarks
- Card images, member id, copays (use [`insurance`](insurance.md))
- API keys, `service_role`, secrets
- Clinic packet file bytes
- Passwords

`refill_requested` is not “refill approved” and not a paid claim. Prior authorization for a drug (if any) is **not** this table. **PA ≠ claim.**
