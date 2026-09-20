# CareLoop database

Hosted **Supabase** (Auth + Postgres). SQL that matches the live tables: [`supabase/migrations/`](../../supabase/migrations/). How that folder works: [`supabase/README.md`](../../supabase/README.md).

This is a mocked US patient-journey demo. It is **not** a payer, EHR, PBM, or claims platform. Estimates are labeled guesses. **PA ≠ claim.**

## Current vs documented

| Layer | What is true today |
|-------|-------------------|
| Hosted tables | `auth.users`, `public.profiles`, `public.visits`, `public.insurance` |
| Running app | Login reads **Auth + `profiles`**. Coverage still uses Dave’s in-memory snapshot + signed cookie + `localStorage`. Visits / meds / tests / packet stay in the browser until a later wiring PR. |
| This docs PR | Schema + SQL only. **Do not** wire coverage APIs or change login. |

## ER (what exists)

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : "id 1:1"
  PROFILES ||--o{ VISITS : "user_id 1:many"
  PROFILES ||--o{ INSURANCE : "user_id many rows, one current"

  AUTH_USERS {
    uuid id PK
    string email
  }
  PROFILES {
    uuid id PK_FK
    text username UK
    text email UK
    text first_name
    text last_name
    timestamptz created_at
  }
  VISITS {
    uuid id PK
    uuid user_id FK
    date visit_date
    text reason
    text clinician_name
    text clinic
    text summary
    jsonb soap
    boolean reviewed
    text coverage_label
    timestamptz created_at
  }
  INSURANCE {
    uuid id PK
    uuid user_id FK
    boolean is_current
    text payer_name
    date date_of_birth
    text eligibility_status
    text source
    timestamptz confirmed_at
  }
```

- **`auth.users` 1:1 `profiles`.** `profiles.id` = `auth.users.id`. There is **no** `login` table. Password is Auth-only (never a column on `profiles`).
- **`insurance`:** many rows allowed; **at most one** `is_current` per user (partial unique index). Returning login hydrates coverage from that row.
- **`visits`:** many per user. **History → My visits.** The clinic packet (`.md` / PDF) is **generated**, not a table.

## What is not in the database yet

Do not invent these tables in migrations:

| Missing | Where it lives today | Notes |
|---------|----------------------|--------|
| Prescriptions / doses / refill | `localStorage` in the patient shell (☰ **Prescriptions**) | Stream E later; no table yet |
| Test records / lab results | Shell + mock test doc | Not a coverage object |
| New symptoms at check-in | `localStorage` `journey.new_symptoms` | Not a `visits` column yet |
| Open / upcoming visits | `localStorage` `openVisits` | Persist to `visits` only after the journey is completed |
| Claims / EOB | Insurance screen: Coming soon | Separate from PA |
| PA / appeal / demand letters | `/letters` + HITL; watermarked drafts | Not stored as rows |
| Transcripts | Scribe fixture / STT API | Do not dump onto `insurance` |
| History packet | Generated export | Not a table |
| Visit symptoms / cost guess | Dave intake APIs (in-memory) | Not insurance columns |

## Auth (no `login` table)

1. User types username + password (`jane` / `demo`).
2. Server looks up `public.profiles` by **username** (service_role, bypasses RLS).
3. Auth password grant with that row’s **email**.
4. Response token is the Supabase access JWT (or HMAC `v1.` when Supabase env is unset).

Seeded live user: username `jane`, email `jane@careloop.local`, password `demo`. See [`AGENTS.md`](../../AGENTS.md).

## First visit vs returning (intended when coverage is stored)

| Path | `insurance` | `visits` | App (today, still local) |
|------|-------------|----------|---------------------------|
| **Start my first visit** | No current row after skip; save creates/updates `is_current` | Empty until a journey is saved | Opens insurance hub; skip → no estimated-costs step |
| **I’m returning** | Read `is_current` | List for History → My visits | Today + seeded Aetna Jane Doe via Dave APIs (not this table yet) |

No `is_current` row ⇒ skip estimated costs. Cost output is a **guess**, not a coverage decision.

## Who writes (intended)

| Table | Writers | Readers |
|-------|---------|---------|
| `profiles` | Dashboard seed (and optional later self-serve). Login does **not** insert. | Login (service_role); patient JWT may select/update **own** row |
| `visits` | Patient JWT after a visit is saved to History | Owner only (`auth.uid() = user_id`) |
| `insurance` | Patient JWT on Insurance save / Confirm / Refresh | Owner only; returning login reads `is_current` |

RLS is on for all three. `service_role` bypasses RLS (server login lookup only for `profiles`).

## Safety (do not weaken)

- No independent clinical or coverage decisions.
- Do not collapse **PA denial** (before care is authorized) vs **claim denial** (after billing).
- Do not store API keys, `service_role`, card images, or live secrets in these tables or in git.
- Letter downloads still need watermark + HITL. History packet is a record export, not a letter.

## Table pages

| Table | Doc | SQL |
|-------|-----|-----|
| `profiles` | [`profiles.md`](profiles.md) | [`20260919100000_create_profiles.sql`](../../supabase/migrations/20260919100000_create_profiles.sql) |
| `visits` | [`visits.md`](visits.md) | [`20260919101000_create_visits.sql`](../../supabase/migrations/20260919101000_create_visits.sql) |
| `insurance` | [`insurance.md`](insurance.md) | [`20260919102000_create_insurance.sql`](../../supabase/migrations/20260919102000_create_insurance.sql) |
