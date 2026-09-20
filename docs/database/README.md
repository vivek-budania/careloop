# CareLoop database

Hosted **Supabase** (Auth + Postgres). SQL that matches the live tables: [`supabase/migrations/`](../../supabase/migrations/). How that folder works: [`supabase/README.md`](../../supabase/README.md).

This is a mocked US patient-journey demo. It is **not** a payer, EHR, PBM, or claims platform. Estimates are labeled guesses. **PA ≠ claim.**

## Current vs documented

| Layer | What is true today |
|-------|-------------------|
| Hosted tables | `auth.users`, `public.profiles`, `public.visits`, `public.insurance` already exist. `public.medicines` and `public.tests` are in this PR’s SQL (apply in the hosted SQL editor). |
| Running app | Signup writes **Auth + `profiles`**; login reads them. Coverage still uses Dave’s in-memory snapshot + signed cookie + `localStorage`. Visits / meds / tests / packet stay in the browser until a later wiring PR. |
| This docs PR | Schema + SQL only. **Do not** wire coverage, medicines, or tests APIs, or change login. |

## ER (what exists)

```mermaid
erDiagram
  AUTH_USERS ||--|| PROFILES : "id 1:1"
  PROFILES ||--o{ VISITS : "user_id 1:many"
  PROFILES ||--o{ INSURANCE : "user_id many rows, one current"
  PROFILES ||--o{ MEDICINES : "user_id 1:many"
  PROFILES ||--o{ TESTS : "user_id 1:many"
  VISITS |o--o{ MEDICINES : "visit_id optional"
  VISITS |o--o{ TESTS : "visit_id optional"

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
    date date_of_birth
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
  MEDICINES {
    uuid id PK
    uuid user_id FK
    uuid visit_id FK
    text name
    text dose
    integer times_per_day
    jsonb schedule
    boolean refill_requested
    text status
  }
  TESTS {
    uuid id PK
    uuid user_id FK
    uuid visit_id FK
    text name
    text status
    text summary
    text document_filename
    date ordered_at
    date result_at
  }
```

- **`auth.users` 1:1 `profiles`.** `profiles.id` = `auth.users.id`. There is **no** `login` table. Password is Auth-only (never a column on `profiles`).
- **`insurance`:** many rows allowed; **at most one** `is_current` per user (partial unique index). Returning login hydrates coverage from that row.
- **`visits`:** many per user. **Past visits → My visits.** The clinic packet (`.md` / PDF) is **generated**, not a table.
- **`medicines`:** many per user (**☰ Prescriptions**). Optional `visit_id` (`ON DELETE SET NULL`).
- **`tests`:** many per user (**☰ Test records**). Optional `visit_id` (`ON DELETE SET NULL`). `document_filename` is a filename only — never file bytes.

## What is not a table

Do **not** add these tables in migrations. The packet is still **generated** at export time. **PA ≠ claim.**

| Not a table | Where it lives today | Notes |
|-------------|----------------------|--------|
| **`login`** | Auth + `profiles` | No `login` table. Passwords stay in Auth. |
| **History packet** | Generated `.md` / PDF export | Record export only — not a letter. Do not add `packets`. |
| **Claims / EOB** | Insurance screen: Coming soon | Separate from PA. Do not store CARC/RARC rows. |
| **PA / appeal / demand letters** | `/letters` + HITL; watermarked drafts | Not stored as rows. |
| **Transcripts** | Scribe fixture / STT API | Do not dump onto `insurance` or `visits`. |
| **Raw card / SBC images** | Insurance form upload only | Persist extracted fields on `insurance`, never `b64` / bytes. |
| **API keys** | Process/container env or Vercel | Never columns, never git, never frontend JS. |

Also not persisted as columns yet (stay in the patient-shell `localStorage` thread):

| Missing column / object | Where it lives today | Notes |
|-------------------------|----------------------|--------|
| New symptoms at check-in | `journey.new_symptoms` + `new_symptoms_log` | Not a `visits` column yet |
| Open / upcoming visits | `openVisits` | Persist to `visits` only after the journey is completed |
| Visit symptoms / cost guess | Dave intake APIs (in-memory) | Not insurance columns |

## Auth (no `login` table)

1. User types username + password (`jane` / `demo`).
2. Server looks up `public.profiles` by **username** (service_role, bypasses RLS).
3. Auth password grant with that row’s **email**.
4. Response token is the Supabase access JWT (or HMAC `v1.` when Supabase env is unset).

Self-serve signup calls Supabase Auth’s normal signup endpoint, inserts the matching `profiles` row server-side (including validated `date_of_birth`), and follows the hosted project’s email-confirmation setting.

Seeded live user: username `jane`, email `jane@careloop.local`, password `demo`. See [`AGENTS.md`](../../AGENTS.md).

## First visit vs returning (intended when coverage is stored)

| Path | `insurance` | `visits` | `medicines` / `tests` | App (today, still local) |
|------|-------------|----------|----------------------|---------------------------|
| **Start my first visit** | No current row after skip; save creates/updates `is_current` | Empty until a journey is saved | Empty until Prescriptions / Test records are updated | Opens insurance hub; skip → no estimated-costs step |
| **I’m returning** | Read `is_current` | List for History → My visits | Zero or more list rows | Today + seeded Aetna Jane Doe / Metformin / HbA1c via local seed (not these tables yet) |

No `is_current` row ⇒ skip estimated costs. Cost output is a **guess**, not a coverage decision.

## Who writes (intended)

| Table | Writers | Readers |
|-------|---------|---------|
| `profiles` | Dashboard seed or `/api/careloop/signup` (server service role after Auth signup). Login does **not** insert. | Login (service_role); patient JWT may select/update **own** row |
| `visits` | Patient JWT after a visit is saved to History | Owner only (`auth.uid() = user_id`) |
| `insurance` | Patient JWT on Insurance save / Confirm / Refresh | Owner only; returning login reads `is_current` |
| `medicines` | Patient JWT on Prescriptions save / visit-plan apply | Owner only (four RLS policies) |
| `tests` | Patient JWT on Test records save / filename attach | Owner only (four RLS policies) |

RLS is on for all five `public` tables. `service_role` bypasses RLS (server login/signup lookup only for `profiles`).

## Safety (do not weaken)

- No independent clinical or coverage decisions.
- Do not collapse **PA denial** (before care is authorized) vs **claim denial** (after billing).
- Do not store API keys, `service_role`, card images, or live secrets in these tables or in git.
- Letter downloads still need watermark + HITL. History packet is a record export, not a letter.

## Table pages

| Table | Doc | SQL |
|-------|-----|-----|
| `profiles` | [`profiles.md`](profiles.md) | [`20260919100000_create_profiles.sql`](../../supabase/migrations/20260919100000_create_profiles.sql) · [`20260919103000_add_profile_date_of_birth.sql`](../../supabase/migrations/20260919103000_add_profile_date_of_birth.sql) |
| `visits` | [`visits.md`](visits.md) | [`20260919101000_create_visits.sql`](../../supabase/migrations/20260919101000_create_visits.sql) |
| `insurance` | [`insurance.md`](insurance.md) | [`20260919102000_create_insurance.sql`](../../supabase/migrations/20260919102000_create_insurance.sql) |
| `medicines` | [`medicines.md`](medicines.md) | [`20260919104000_create_medicines.sql`](../../supabase/migrations/20260919104000_create_medicines.sql) |
| `tests` | [`tests.md`](tests.md) | [`20260919105000_create_tests.sql`](../../supabase/migrations/20260919105000_create_tests.sql) |
