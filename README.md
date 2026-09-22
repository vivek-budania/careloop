# CareLoop

Mocked US **patient-journey demo**: one FastAPI process serves a vanilla JS patient shell so coverage, visit, orders, prior auth, delivery, claim, meds, and follow-up stay on **one thread**.

It is **not** a real payer, PBM, EHR, or claims platform. Mock “submit” is local demo state. Drafts are for a human to review. The app never files, faxes, e-prescribes, or calls a live insurer.

**Public story:** [`/showcase`](frontend/showcase.html) (`GET /showcase`). **Logged-in app:** `/` — Today / Past visits / Upcoming visits / Prescriptions / Test records / Insurance / Profile, plus an 8-step visit journey. Dummy logins: [`AGENTS.md`](AGENTS.md). Owner split: [`plan.md`](plan.md). Hosted schema: [`docs/database/`](docs/database/README.md).

---

## What it is

US care is a chain of handoffs. Point tools optimize one moment. CareLoop’s demo gap is **one patient, one data thread** — encounter evidence still available at PA, appeal, dispense, follow-up, and the next visit.

The showcase walkthrough (sample patient / sample plan, not a real identity):

1. **Coverage** — turn a card or typed plan into a snapshot (active/inactive, labeled copay/deductible estimates).
2. **Find care** — map a visit reason to a specialty filter and list mock in-network clinicians by ZIP.
3. **Visit** — record or seed a transcript; draft SOAP for clinician review.
4. **Next steps** — skippable cost **guess**, medicines, tests, who acts.
5. **Carry forward** — shareable history packet (record export, **not** a letter).

**PA ≠ claim.** Prior-authorization denial happens *before* a drug/service is authorized. Claim denial happens *during/after* billing. Separate objects, statuses, and screens. A PA approval does **not** mean the later claim is paid.

Insurance Claims Management is Coming soon. Letter-draft **APIs** still exist (`/api/generate-pa`, parse, appeal, demand); there is **no** `/letters` UI on this app.

---

## Stack

| Layer | Technology |
|--------|-------------|
| Backend | Python + FastAPI (`backend/main.py`) — one process, no routers |
| Frontend | Vanilla HTML/CSS/JS (`frontend/`) — no bundler |
| Auth | Server-side Supabase Auth + `public.profiles` when env is set; HMAC fallback otherwise |
| Session | Signed `HttpOnly` `careloop_session` cookie, 30 days, `SameSite=Lax` (`Secure` on HTTPS). Browser JS never stores the Supabase access token. Optional bearer token for non-browser clients. |
| Coverage state | In-memory + signed `careloop_coverage` cookie + `localStorage`. Hosted `visits` / `insurance` tables exist but are **not wired**. |
| LLM | xAI (`XAI_API_KEY`); optional Groq text fallback |
| Optional eligibility | Stedi sandbox 270/271 when `STEDI_API_KEY` is a `test_` key |

No linter or frontend build. A few files exist under `tests/`; they are not a required CI gate.

---

## Architecture

```
backend/main.py          All HTTP routes; mounts /css /js /images /mockups; / and /showcase
backend/careloop/        Login, coverage, extract, Stedi, scribe, STT
backend/llm.py           generate() watermarks letters; generate_json() does not
backend/prompts.py       PA / appeal / demand / denial-parse (zero hallucination)
backend/risk_engine.py   Deterministic 0–100 denial-risk heuristic (no LLM)
backend/data/            Fixtures + small ICD-10 / CPT / CARC sets
frontend/index.html       Patient shell (login → CareLoop)
frontend/showcase.html    Judge-facing product story
frontend/js/api.js        Named fetch methods — do not call fetch from feature code
frontend/js/careloop.js   Patient IA
docs/database/            Hosted Supabase table docs (profiles, visits, insurance)
supabase/migrations/      Idempotent SQL matching those tables
```

Letter flow: Pydantic model in `main.py` → user-message string → `llm.generate()` / `generate_json()` → system prompt in `prompts.py`. New CareLoop routes stay on this app.

---

## Mocked vs real

| Capability | What actually runs |
|------------|-------------------|
| Login / signup | **Real** Supabase Auth + `profiles` when `SUPABASE_*` + `SESSION_SECRET` are set. Else mock users in `backend/data/mock_users.json`. Signup is 503 without Supabase. |
| Coverage confirm | **Mock** fixture by default. **Optional real sandbox:** Stedi *test* 270/271 if a `test_` key is loaded and the member matches that payer’s canned sandbox subscriber. Production Stedi keys are refused. |
| Network / cost guess | **Mock** clinician directory. Visit allowed-charge ranges come from xAI reading a committed extract of CMS DE-SynPUF 2008–2010 carrier line allowed charges (synthetic public use file, sample 1 segments A and B; not real patients; not a current Medicare fee schedule). Patient-owed copay, deductible, and coinsurance stay deterministic Python. If `XAI_API_KEY` is missing, the call fails, or a code has no DE-SynPUF rows, that line uses `mock_fee_schedule.json` and the disclaimer does not claim DE-SynPUF. Output is a labeled **estimate**, not a bill or approval. |
| Card / page extract | **Optional real** xAI vision. Unreadable fields tagged `[NEEDS VERIFICATION]`. JSON is **not** watermarked. Never invent a copay that was not printed. |
| Scribe / STT | Seeded demo transcripts always; live STT needs `XAI_API_KEY`. SOAP is a draft until review. |
| PA / appeal / demand | **Draft text only** (watermark + HITL if a download UI is added). No file/fax. |
| `visits` / `insurance` tables | Documented; **not read** by login or coverage APIs yet. |

---

## Setup and run

```bash
cp .env.example .env
pip3 install -r requirements.txt
python3 -m uvicorn backend.main:app --reload --port 8080
```

Open **http://localhost:8080** (app) or **http://localhost:8080/showcase** (story). Dummy credentials: [`AGENTS.md`](AGENTS.md).

After login: **I’m returning** seeds a **sample plan** snapshot and opens Today. **Start my first visit** opens the insurance hub (payer + date of birth required; sample card is a fixture; skip ⇒ no estimated-costs step).

Static IA mockups: **http://localhost:8080/mockups/** — [`workflow.md`](workflow.md).

---

## Environment

Names only. Never commit real values, paste keys in chat, or put `service_role` in frontend JS. Inject on the process/container at launch, or Vercel Project Settings → Environment Variables (then Redeploy). A gitignored `.env` is a laptop fallback (`load_dotenv` will not override a container env var). Cursor/cloud-agent env does not reach Vercel.

| Name | Role |
|------|------|
| `SUPABASE_URL` | Hosted project URL. Login/signup. |
| `SUPABASE_ANON_KEY` | Server-side Auth. Never frontend. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only profile lookup / signup insert. Never frontend. |
| `SESSION_SECRET` | 32+ chars. Signs `careloop_session` and the coverage cookie. Required for live Supabase sessions. |
| `STEDI_API_KEY` | Optional. `test_…` sandbox 270/271 only. |
| `XAI_API_KEY` | Letters, image → JSON, visit STT. Already used on Vercel. Seeded transcript / sample card work without it. |
| `GROQ_API_KEY` | Optional letter fallback if xAI is down. |

Live signup/login on Vercel needs the three `SUPABASE_*` names plus `SESSION_SECRET`. Profile in the patient shell shows whether each slot is **loaded** — never the secret. `GET /api/careloop/demo-env` returns the same status JSON (auth required).

---

## Safety invariants

Do not weaken these.

1. **Watermark** — Free-text generated documents (PA, appeal, demand) are wrapped in `DRAFT_WATERMARK` by `llm.py` `generate()`. No path that returns letter text without it.
2. **Human-in-the-loop** — Never download a generated letter without approval first.
3. **Zero hallucination** — Prompts use only supplied facts; uncertain claims tagged `[NEEDS VERIFICATION]`.
4. **No independent clinical or coverage decisions** — Draft, organize, cite. Specialty is a directory filter, not a diagnosis. Cost output is a guess.
5. **PA ≠ claim** — Do not collapse prior-auth denial and claim denial.
6. **Drafts only** — No file, fax, eRx, or live insurer.

---

## Docs

| File | What |
|------|------|
| [`AGENTS.md`](AGENTS.md) | Dummy logins, running-app notes for agents |
| [`plan.md`](plan.md) | Owner split (what to build) |
| [`CLAUDE.md`](CLAUDE.md) | Dev invariants |
| [`workflow.md`](workflow.md) | Patient-facing screen map |
| [`docs/database/`](docs/database/README.md) | Hosted tables |
| [`supabase/`](supabase/README.md) | Matching SQL |

Vercel entrypoint: `backend.main:app` in [`pyproject.toml`](pyproject.toml). Do not replace `/` with a JSON stub.
