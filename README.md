# CareLoop

Hackathon product: **one mocked US patient journey** so context survives coverage → visit → orders → prior auth → delivery → claim → meds → follow-up → **shareable history for the next visit**.

It is **not** a real payer, PBM, EHR, or claims platform. Mock “submit” is local demo state. Drafts are for a human to review; the app never files, faxes, e-prescribes, or calls a live insurer.

The running app is **CareLoop** (patient shell behind login: Today / History / Medicines / Tests / Insurance / Profile, plus an 8-step visit). Old DenialShield PA/appeal forms are a secondary page at `/letters` (watermark + HITL), not hamburger items. **Insurance Claims Management** is Coming soon on the Insurance screen. Demo login: **`jane` / `demo`**. Details: [`AGENTS.md`](AGENTS.md).

**Who builds what:** **Dave** (payer dropdown + optional card/SBC → mock coverage, visit/cost guess, in-network clinicians), **Sreekar** (visit → scribe → orders → PA/appeal/meds/claims/follow-up), **Vivek** (patient-facing workflow first, longitudinal thread, history share/export, **Dribbble polish later**). Full split, DoD, curls, and object contract: **[`plan.md`](plan.md)**. Hosted Supabase tables (`profiles`, `visits`, `insurance`, `medicines`, `tests`, `intakes`, `claims`): **[`docs/database/`](docs/database/README.md)** (SQL in [`supabase/`](supabase/README.md)). Login still uses Auth + `profiles` only; coverage/visits/meds/tests/intakes/claims are not wired to those tables yet.

---

## What CareLoop is (and is not)

**Thesis:** US care is a chain of handoffs. Point tools optimize one moment. The demo gap is **one patient, one data thread** — encounter evidence still available at PA, appeal, dispense, follow-up, and the **next doctor visit**.

**In scope for the hackathon:** a scripted golden path (coverage/card → PCP visit → SOAP/Plan → HbA1c + Rx → PA required → mock payer **step-therapy denial** → policy-to-evidence checklist → appeal → approve → dispense → taken/missed + refill nudge → follow-up → **history the patient can share next visit**). Mock eligibility and payer. Go deepest on **scribe + policy/evidence appeal**. Keep reminders simple. **Patient-facing workflow first** (what happened / waiting / who acts); visual polish from Dribbble **after** that flow works. The **integrated journey** is the product.

**Out of scope:** live payer/PBM PA APIs, real eligibility, eRx, claims adjudication networks, EHR/FHIR write-back, production HIPAA, verified multi-plan legal knowledge bases, ambient scribe without heavy clinician review. The brief is not operational billing, legal, or medical guidance. Full list: [`plan.md`](plan.md) (Out of scope).

---

## Already shipped vs planned

Workstreams, owner sections, object sketches, curls, and suggested order live in **[`plan.md`](plan.md)**. Do not treat this README as a second plan.

### Already here (DenialShield — keep; reuse as Authorization seed)

Two **disconnected**, stateless form tabs. No accounts, no database, no timeline.

| Capability | Where |
|------------|--------|
| ICD-10 / CPT search (~91 / ~76 codes) | `GET /api/codes/icd10`, `/api/codes/cpt`; `backend/data/*.json`; `frontend/js/provider.js` |
| Heuristic denial-risk score (0–100) | `POST /api/risk-score`; `backend/risk_engine.py` |
| PA letter draft | `POST /api/generate-pa` |
| Denial / EOB parse | `POST /api/parse-denial` |
| Appeal letter draft | `POST /api/generate-appeal` |
| Claim-file request letter (ERISA file access, not a legal threat) | `POST /api/generate-demand` |
| Cited national denial/appeal stats | `GET /api/national-stats`; `backend/config.py` |
| HITL approve-before-download | `frontend/js/app.js` |
| Draft watermark | `backend/llm.py` + `DRAFT_WATERMARK` |

Provider / Patient Advocate letter UIs are **not in the nav**. Use **Insurance Claims Management** (Coming soon). Login: **`jane` / `demo`**.

### Greenfield (three owners; original A–F still apply)

See [`plan.md`](plan.md) for inherited A–F mapping.

| Owner | Builds |
|--------|--------|
| **Dave** | Payer **dropdown** (required) + optional typed card fields / card scan / SBC-EOB → mock coverage confirmation; symptoms + optional prior-visit PDF; visit/cost **guess**; in-network clinicians by ZIP; Coverage facts for history. **Login** (Supabase Auth + `profiles` when env is set) + **one-step wizard**. |
| **Sreekar** | First visit → transcribe/SOAP/Plan → orders, mock payer + PA + step-therapy denial + policy-to-evidence + appeal (DenialShield HITL/watermark), meds/adherence/refill, claims/EOB light, follow-up; clinical/admin **history fact capture** |
| **Vivek** | Patient-facing CareLoop workflow (basic) + SQLite/in-memory **thread** as app shell + unified timeline + **history share/export**; **Dribbble-informed polish later** |

**Golden-path demo (target):** payer dropdown / card/coverage → confirm mock eligibility → symptoms + optional prior-visit docs → visit/cost guess → in-network PCP → clinician-reviewed SOAP + Plan → HbA1c (no PA) + Rx (PA required) → mock PA submit → step-therapy denial with citable policy → match policy to encounter evidence → watermarked appeal + HITL → mock approve → dispense → taken/missed + refill nudge → timeline / follow-up → share history next visit. Keep a **separate** claim (optional claim denial) so judges see two insurance moments.

---

## Architecture

Single FastAPI app serves API + static SPA. **No** frontend bundler, **no** test suite, **no** linter, **no** build step.

| Layer | Technology |
|--------|-------------|
| Backend | Python + FastAPI (`backend/main.py`) |
| LLM | Gemini primary (`google-generativeai`); optional Groq fallback |
| Frontend | Vanilla HTML/CSS/JS (`frontend/`) — ivory/sage/terracotta patient UI |
| Data today | Embedded JSON (ICD-10, CPT, CARC/RARC) |

**Request flow (letters):** Pydantic model in `main.py` → user-message string → `backend/llm.py` `generate()` / `generate_json()` → system prompt from `backend/prompts.py`. New CareLoop routes stay on this app (`main.py` or an imported `backend/careloop/` package). Do not fork a second server. Frontend talks only through named methods in `frontend/js/api.js`.

```
.
├── AGENTS.md               # Demo login + what the running app is (for agents)
├── plan.md                 # Owner split (Dave / Sreekar / Vivek) + A–F; source of truth for *what to build*
├── workflow.md             # Patient-facing screen flow (teammate map; pairs with frontend/mockups/)
├── CLAUDE.md               # Agent/dev invariants (watermark, HITL, file roles)
├── docs/database/          # Hosted Supabase table docs (profiles, visits, insurance, medicines, tests, intakes, claims)
├── supabase/               # Idempotent SQL matching hosted tables (CLI not required)
├── backend/
│   ├── main.py             # All routes; mounts static; serves index.html
│   ├── config.py           # Keys, model names, DRAFT_WATERMARK, national stats
│   ├── llm.py              # Gemini + optional Groq; watermark on generate()
│   ├── prompts.py          # PA, appeal, demand, denial-parse (zero-hallucination)
│   ├── risk_engine.py      # Deterministic heuristic scorer (no LLM)
│   └── data/               # icd10_codes.json, cpt_codes.json, denial_reasons.json
├── frontend/
│   ├── index.html          # Patient shell (login first-time vs returning)
│   ├── letters.html        # Secondary PA / appeal drafts (HITL)
│   ├── css/style.css       # Patient UI (Instrument Serif + DM Sans)
│   ├── css/letters.css     # Letter-draft surface
│   └── js/
│       ├── api.js          # Named fetch methods per endpoint
│       ├── app.js          # HITL, toasts, /letters chrome
│       ├── careloop.js     # Patient IA; calls Dave coverage APIs
│       ├── provider.js     # Parked DenialShield PA forms (`/letters`)
│       └── patient.js      # Parked DenialShield appeal forms (`/letters`)
├── requirements.txt
├── pyproject.toml          # Vercel FastAPI entrypoint: backend.main:app
├── vercel.json
└── .env.example
```

Shared objects (thread contract): Patient, Encounter, Orders, Authorization, Claim, Medication, Follow-up, **Coverage**, **History** — details in [`plan.md`](plan.md).

---

## Safety invariants

Load-bearing. Do not weaken them when adding the journey.

1. **Watermark** — Every free-text generated document (PA, appeal, demand) is wrapped in `DRAFT_WATERMARK` by `llm.py` `generate()`. No new path that returns LLM letter text without it.
2. **Human-in-the-loop** — The frontend never downloads a generated document without `App.requestApproval()` first. No bypass download button.
3. **Zero hallucination** — Prompts use only supplied facts; uncertain claims tagged `[NEEDS VERIFICATION]`; API surfaces those as `warnings`.
4. **No independent clinical or coverage decisions** — Draft, organize, cite, and surface evidence. A clinician or authorized staff member decides what to submit. Policy-to-evidence is a **checklist**, not a determination. The model must not “approve” care, change diagnosis/dose, or decide coverage.
5. **Do not collapse PA vs claim denial** — **PA denial** is *before* the planned drug/service is covered. **Claim denial** is *during/after* billing or dispensing. Separate objects, statuses, screens, and demo steps. A PA approval does **not** mean the later claim is paid.
6. **Drafts only** — The product does not file, fax, e-prescribe, or call a real payer.

---

## Setup and run

Commands match [`plan.md`](plan.md) and [`CLAUDE.md`](CLAUDE.md).

### 1. Gemini API key

[Google AI Studio](https://aistudio.google.com/apikey) → Create API Key (free; no credit card).

### 2. Environment

```bash
cp .env.example .env
# Edit .env (do not use `echo > .env` — that wipes other keys):
#   SUPABASE_URL=https://your-project.supabase.co
#   SUPABASE_ANON_KEY=your_anon_key_here
#   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here   # server-only; never frontend JS
#   XAI_API_KEY=                          # image → JSON + visit STT (already on Vercel)
#   GEMINI_API_KEY=your_key_here          # /letters; fallback image JSON
#   STEDI_API_KEY=test_your_sandbox_key   # sandbox 270/271; prefer injecting at launch
#   GROQ_API_KEY=                         # optional letter fallback; add when you have it
#   SESSION_SECRET=                       # optional; signs mock fallback tokens + coverage cookie
```

**Required on Vercel for live signup/login:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → Environment Variables, Production + Preview, then Redeploy). Signup creates Auth + `public.profiles`; login reads them. Hosted `visits`, `insurance`, `medicines`, `tests`, `intakes`, and `claims` tables are documented ([`docs/database/`](docs/database/README.md)) but the app does not read them yet (coverage cookie + `localStorage`). Never commit real keys or put `service_role` in frontend JS.

Same names on the **process/container at launch** or in **Vercel**. Cursor/cloud-agent env does not reach Vercel. Do not bake keys into the image, git, or chat. A local `.env` is only a laptop fallback (`load_dotenv` will not override a container env var).

The patient shell **Profile** page lists whether each slot is loaded (never the secret). Extra keys can be added the same way. Demo login **`jane` / `demo`** and the Jane Doe / Aetna canned member: [`AGENTS.md`](AGENTS.md). Without the Supabase slots, the server still accepts the same mock `jane` / `demo` HMAC login.

### 3. Install and run (API + frontend, one process)

```bash
pip3 install -r requirements.txt
python3 -m uvicorn backend.main:app --reload --port 8080
```

Open **http://localhost:8080**

Log in as **`jane` / `demo`**. **I’m returning** seeds **Aetna / Jane Doe** via Dave’s APIs and opens **Today**. **Start my first visit** resets coverage and opens the insurance hub (date of birth required; sample card is the Stedi canned member; skip allowed → no estimated-costs step). Visit journey is 8 steps (symptoms suggest a specialty for the clinician list → SOAP → skippable estimated costs from `POST /api/careloop/coverage/visit-guess` → plan). Letter drafts: **http://localhost:8080/letters** (approve-before-download).

Patient-facing **visual mockups** (static clickthrough): **http://localhost:8080/mockups/**. Text walkthrough: **[`workflow.md`](workflow.md)**.

Letter endpoints return HTTP 500 with setup instructions if `GEMINI_API_KEY` is missing or still a placeholder. Mocked coverage/card/network and the thread store do not require Gemini.

### Useful curls (Authorization core)

```bash
curl -s "http://localhost:8080/api/codes/icd10?q=diabetes"
curl -s "http://localhost:8080/api/codes/cpt?q=83036"

curl -s -X POST http://localhost:8080/api/risk-score \
  -H "Content-Type: application/json" \
  -d '{"icd10_code":"E11.9","cpt_code":"83036","has_prior_auth":false,"has_clinical_notes":true,"is_emergency":false}'

curl -s http://localhost:8080/api/national-stats
```

PA / parse / appeal / demand need a real Gemini key. Example bodies are in [`plan.md`](plan.md) (Sreekar — Authorization curls). Isolation curls for store/coverage/history are in the same file under each owner.

---

## How to work from `plan.md`

Pick an **owner**; original letters **A–F** still name the slices. Coordinate on **object shapes** first (stream **B**, Vivek). One process: `uvicorn backend.main:app`. Isolate by not calling other modules, not by a second server.

| Owner | Original streams | Isolation |
|--------|------------------|-----------|
| **Dave** | Eligibility/network/copay from **D**; **added** card scan + wizard + login; CareLoop is the app UX | Curl coverage after login; see [`AGENTS.md`](AGENTS.md) |
| **Sreekar** | **A** Authorization, **C** scribe, **D** mock payer (PA half), **E** meds; claims later via Coming soon tab | Letter curls still exist; do not add Provider/Advocate nav tabs |
| **Vivek** | **B** store, **F** timeline; **added** history share/export; Dribbble later | Curl `thread`/`reset`; static fixture until B lands |

**Suggested order:** B first (or a frozen JSON schema) → A **and** Dave coverage in parallel → C then D for the insurance half → E after approve/dispense (or a seeded dispensed state) → F can prototype against a static thread, then bind to B → history share as a demo beat → Dribbble polish last.

**PR conventions:** one workstream per PR when possible; branch from latest `main`; describe stream letter (A–F) and/or owner, how to demo, and that PA vs claim were **not** collapsed. Details in [`plan.md`](plan.md).
