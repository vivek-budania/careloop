# `public.insurance`

Current coverage snapshot for a patient. SQL: [`supabase/migrations/20260919102000_create_insurance.sql`](../../supabase/migrations/20260919102000_create_insurance.sql). Overview: [`README.md`](README.md).

Vivek has already created this table in hosted Supabase. The migration is idempotent and **may already exist in prod**. Dave’s coverage APIs still write **in-memory + signed cookie + `localStorage`**. **Do not wire those APIs in a docs PR.**

## Purpose

Store the **one current plan** used for returning login, the Insurance screen, and whether estimated costs can run. Historical rows may exist with `is_current = false`. Skip insurance ⇒ **no current row** ⇒ skip the estimated-costs step.

Figures are **labeled estimates** (mock fixture or Stedi **test** 271). They are not a coverage decision, bill, or prior authorization.

## Cardinality

- FK: `user_id → profiles.id`
- **At most one** current row per user: unique index on `user_id` **where `is_current`**.
- New current row: set the previous current row’s `is_current` to `false`, then insert/update the new one to `true`.

## Columns

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|--------|
| `id` | `uuid` | no | `gen_random_uuid()` | **PK.** |
| `user_id` | `uuid` | no | — | **FK → `profiles.id`**. RLS owner. |
| `is_current` | `boolean` | no | `false` | Returning login reads `true`. Partial unique index. |
| `payer_id` | `text` | yes | — | Dropdown / fixture id (`aetna`, `mock-payer`, …). |
| `payer_name` | `text` | **no** | — | Required insurer name. Skip = no row, not a blank payer. |
| `plan_type` | `text` | yes | — | e.g. `PPO`. |
| `network_name` | `text` | yes | — | e.g. `PPO Gold Plan`. |
| `member_name` | `text` | yes | — | Optional typed/scanned subscriber name. |
| `member_id` | `text` | yes | — | Optional. Golden path `AETNA12345`. |
| `group_number` | `text` | yes | — | Optional. |
| `date_of_birth` | `date` | yes | — | **Nullable in DB** so skip has no row. **App-required on save** (Stedi Jane Doe `2004-04-04`). |
| `zip` | `text` | yes | — | Text (not int). Network search uses this. |
| `eligibility_status` | `text` | yes | — | `active` / `inactive` after Confirm. Null until Confirm/Refresh. |
| `estimated_copay_pcp` | `numeric` | yes | — | Estimate only. Do not invent a copay that was not printed or returned. |
| `estimated_copay_specialist` | `numeric` | yes | — | Estimate only. |
| `coinsurance_pct` | `numeric` | yes | — | Percent (e.g. `20`). Estimate only. |
| `deductible` | `numeric` | yes | — | INN deductible. Estimate only. |
| `deductible_remaining` | `numeric` | yes | — | Estimate only. |
| `oop_remaining` | `numeric` | yes | — | Estimate only. |
| `raw_eligibility` | `jsonb` | yes | — | Flattened mock or sandbox 271. No `x12` dump required. **No API keys.** |
| `source` | `text` | yes | — | `mock` or `stedi` (`CHECK`). Null until Confirm/Refresh. |
| `unreadable` | `text[]` | yes | — | OCR fields that were unreadable; UI tags `[NEEDS VERIFICATION]`. |
| `warnings` | `jsonb` | yes | — | Extract / eligibility warnings. Not a determination. |
| `confirmed_at` | `timestamptz` | yes | — | **Null until Confirm or Refresh coverage snapshot.** Save-without-confirm stays null. |
| `updated_at` | `timestamptz` | no | `now()` | Writer should bump on upsert. |

Check: `source IS NULL OR source IN ('mock', 'stedi')`. Production Stedi keys are refused in app code; do not store key material here.

## RLS

Enabled. **`auth.uid() = user_id`.**

| Policy | Command | Role | Rule |
|--------|---------|------|------|
| `insurance_own_rows` | `ALL` | `authenticated` | `USING` + `WITH CHECK` (`auth.uid() = user_id`) |

Login does not read this table today (JWT/HMAC only). Intended returning path: server or client loads `is_current` **after** Auth.

## Who writes

| Actor | What |
|-------|------|
| Patient JWT on **save** (intended) | Upsert current row: payer + optional card fields + DOB. `confirmed_at` stays null. `eligibility_status` / money fields may stay null. |
| Patient JWT on **Confirm** or **Refresh** | Same row: fill eligibility columns, `source`, `raw_eligibility`, set `confirmed_at = now()`, `is_current = true`. |
| Dave APIs today | `coverage.py` in-process state + cookie. **Not this table.** |
| xAI vision (`XAI_API_KEY`) | Returns JSON for printed card/SBC fields. Gemini fallback. Do not persist card **images**. JSON extract is not watermarked. |
| `profiles` / login | Must not add insurance columns to `profiles`. |
| Letters / claims UI | Must not write this table. |

## First visit vs returning

| Path | Behavior |
|------|----------|
| **Start my first visit** | Opens insurance hub. Sample card = Jane Doe / Aetna / `AETNA12345` / `2004-04-04`. Skip ⇒ **no** `is_current` row ⇒ **skip estimated costs**. |
| **I’m returning** | Hydrate the Insurance snapshot from `is_current`. If none, treat as skip (no cost step). App today **seeds** Aetna Jane Doe via Dave APIs instead of this table. |
| Inactive Demo Plan / member `X-…` | `eligibility_status = inactive`. Still a coverage snapshot, not a claim. |

No row is different from an inactive row: skip vs “we checked and it is inactive.”

## Confirm vs save

| Event | `confirmed_at` | `source` | Money / status columns |
|-------|----------------|----------|------------------------|
| Save / scan only | `null` | `null` | Usually empty |
| Confirm coverage | set | `mock` or `stedi` | Filled from fixture or test 271 |
| Refresh coverage snapshot | updated | same | Re-run confirm |

## Do not put on `insurance`

- Visit **symptoms**, specialty suggestion, prior-visit PDFs
- SOAP, transcripts, clinician, clinic
- Rx, medicines, tests, lab results (use [`medicines`](medicines.md) / [`tests`](tests.md); filenames only on tests)
- **API keys**, `service_role`, Stedi/Gemini/Groq secrets
- Card / SBC **images** or raw `b64`
- Claims, EOB, PA letters, appeals, demand letters
- Visit/cost **guess** line items (computed; not a determination)
- Passwords

Never invent a copay that is not printed on the card/SBC or returned by mock/271.

## PA ≠ claim

Prior authorization (before a drug/service is covered) is **not** this table and **not** a claim (after billing). Insurance Claims Management is Coming soon. Do not store PA status here. `coverage_label` on [`visits`](visits.md) is only a display snapshot.
