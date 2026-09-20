# CareLoop

**One thread through care.** A mocked US patient-journey demo, built at Johns Hopkins for HopHacks 2026.

CareLoop connects coverage, appointments, clinical notes, costs, medications, authorizations, and follow-ups into one understandable patient journey. It is **not** a payer, PBM, EHR, or claims platform. Mock “submit” is local demo state. The app never files, faxes, e-prescribes, or calls a live insurer.

| Surface | URL |
|---------|-----|
| Product story (showcase) | [`/showcase`](frontend/showcase.html) · http://localhost:8080/showcase |
| Live demo (patient app) | [`/`](frontend/index.html) · http://localhost:8080 |
| Visual mockups (static) | http://localhost:8080/mockups/ |

Demo login: **`jane` / `demo`**. Agent notes: [`AGENTS.md`](AGENTS.md). Hosted schema: [`docs/database/`](docs/database/README.md). Owner split (historical + remaining work): [`plan.md`](plan.md).

---

## Product

Healthcare is a chain of handoffs. Records, coverage, appointments, prescriptions, and next steps live in different places—leaving the patient to carry context between them. Point tools optimize one moment. CareLoop’s gap is **one patient, one continuous thread**.

At every step the demo answers three questions: **what happened, what is waiting, and who acts next?**

Follow Jane (fictional; no PHI):

1. **Understand coverage** — turn a card into a plain-language snapshot (active plan, copay, deductible remaining). Estimates only.
2. **Find appropriate care** — match the visit reason to in-network options (ZIP + suggested specialty).
3. **Understand the visit** — turn conversation into a patient-readable clinical draft. Nothing is final without clinician review.
4. **See what comes next** — labeled cost estimates, medicines, tests, and who owns each action (you / clinic / insurer).
5. **Carry context forward** — a shareable history packet for the next visit (record export, not a letter).

AI translates and organizes. People stay in control: See (card → JSON) · Listen (visit → draft) · Connect (encounter → costs and follow-ups) · Protect (clinician review; no invented eligibility).

The **integrated journey** is the product. Visual prototype screens live under [`frontend/mockups/`](frontend/mockups/); the running app is the patient shell in [`frontend/js/careloop.js`](frontend/js/careloop.js).

---

## Who it is for

- **Judges / demo** — open `/showcase`, then `/` as Jane.
- **Teammates / agents** — FastAPI + vanilla JS, one process; see Architecture and Run below.
- **Not for** — live insurance filing, e-prescribing, EHR write-back, or production HIPAA.

---

## What you get after login

**☰** Today · Past visits (My visits | For the clinic) · Upcoming visits · Reminders · Prescriptions · Test records · Insurance · Profile · Log out.

The **visit journey is not in the hamburger.** Booking is steps 1–3 (symptoms → clinicians → save request). Opening an upcoming visit starts visit-day: optional new symptoms → check-in → record / upload / seeded demos → summary → skippable estimated costs → plan → follow-ups.

| Login path | What happens |
|------------|----------------|
| **LOGIN** (`jane` / `demo`) | Returning demo: **Today**, with Jane Doe / Aetna coverage confirmed via Dave’s APIs if none is on file. |
| **Start my first visit** | Self-serve signup (when Supabase env is set) → insurance hub. Skip insurance is allowed; estimated costs are then skipped. |

There are no Provider / Patient Advocate tabs. **Insurance Claims Management** is a Coming soon row on Insurance.

---

## Architecture

Single FastAPI app serves API + static frontend. **No** bundler, **no** test suite required to run, **no** linter, **no** build step.

| Layer | Technology |
|--------|-------------|
| Backend | Python + FastAPI (`backend/main.py`) |
| Frontend | Vanilla HTML/CSS/JS (`frontend/`) — ivory/sage patient UI |
| Hosting | Vercel (`backend.main:app` in [`pyproject.toml`](pyproject.toml)) |
| Auth + hosted tables | Supabase Auth + Postgres (`profiles`, `visits`, `insurance`) |
| LLM / vision / STT | xAI (`XAI_API_KEY`); optional Groq text fallback |
| Eligibility sandbox | Stedi 270/271 when `STEDI_API_KEY` is a **test** key |

```
.
├── AGENTS.md               # Running-app notes for agents (login, safety, files)
├── plan.md                 # Owner split + remaining golden-path work (not “what is live”)
├── workflow.md             # Patient screen map (pairs with frontend/mockups/)
├── CLAUDE.md               # Dev invariants
├── docs/database/          # Hosted tables: profiles, visits, insurance
├── supabase/               # Idempotent SQL (CLI not required)
├── backend/
│   ├── main.py             # Routes; mounts static; `/` and `/showcase`
│   ├── careloop/           # Auth, coverage, Stedi, scribe, STT, extract, PDF
│   ├── llm.py              # xAI + optional Groq; watermark on generate()
│   ├── prompts.py          # PA / appeal / demand / denial-parse (zero hallucination)
│   ├── risk_engine.py      # Deterministic heuristic scorer (no LLM)
│   └── data/               # ICD-10, CPT, fixtures, mock users
├── frontend/
│   ├── index.html          # Patient app
│   ├── showcase.html       # Product story
│   └── js/careloop.js      # Patient IA
├── requirements.txt
├── pyproject.toml
└── .env.example
```

Frontend talks only through named methods in `frontend/js/api.js`. New CareLoop routes stay on this app (`main.py` or `backend/careloop/`). Do not fork a second server.

---

## Mocked vs real

Honest labels from the showcase: **functional depth, honestly labeled.**

| Piece | On `main` today |
|--------|-----------------|
| Patient journey | **Live in the demo.** Coverage intake, clinician search, booking, visit flow, SOAP draft, costs, care plan, history packet. |
| Coverage numbers | **Mock default** matching Jane Doe / Aetna `AETNA12345` / DOB `2004-04-04` (ACTIVE PPO Gold, office copay **$30**, INN deductible **$500** remaining **$500**). Optional Stedi **test** 270/271 for that canned member only. Production Stedi keys are refused. |
| Network / slots | **Mock directory.** Booking is a **request**. Nearby search uses ZIP (≤ 40 miles, then farther). |
| Transcript / SOAP | Seeded demos (psoriasis / lumbar MRI / chronic-migraine Botox) or optional live STT (`XAI_API_KEY`). Clinician-review gate before orders. |
| Cost output | Labeled **estimate** from `POST /api/careloop/coverage/visit-guess`. Golden-path diabetes follow-up is about **$75** patient-owed (office copay $30 + HbA1c $45 against remaining deductible) when Aetna is on file. |
| Image → JSON | Optional xAI vision on Insurance (cards, doctor pages, lab pages). Unreadable fields tagged `[NEEDS VERIFICATION]`. Never invent a copay that is not printed. **No** letter watermark on JSON. |
| Signup / login | **Live** against hosted Supabase when env is set; otherwise HMAC mock login (`jane` / `demo` still works). |
| PA / appeal / demand letters | **APIs only** (`POST /api/generate-pa`, parse, appeal, demand) + risk score + code search. Watermarked by `generate()`. **No letter UI** in the patient app (`/letters` was removed). Showcase still describes this as a live capability of the stack. |
| Claims / EOB | **Coming soon** on Insurance. Separate from prior auth. |
| `visits` / `insurance` tables | **Exist in hosted Supabase.** The running app does **not** read or write them yet. |
| Thread / meds / tests / packet | **Browser `localStorage`** (+ signed coverage cookie). There is **no** `GET /api/careloop/thread`. |
| Live payer, EHR, eRx, production HIPAA | **Out of scope.** |

---

## Data: tables vs still local

| Store | Used by the running app? |
|--------|---------------------------|
| Supabase Auth + `public.profiles` | **Yes** for signup/login when `SUPABASE_*` + `SESSION_SECRET` are set. No `login` table. Passwords stay in Auth. |
| `public.visits` | Documented; **not wired.** Past visits live in `localStorage`. |
| `public.insurance` | Documented; **not wired.** Coverage snapshot = in-memory + signed `careloop_coverage` cookie + `localStorage`. |
| Prescriptions, test records, reminders, open visits, new symptoms | **Local only.** Not tables. |
| History packet | Generated markdown → `POST /api/careloop/history/pdf`. Record export, not a PA/appeal letter. |

Columns and RLS: [`docs/database/`](docs/database/README.md). SQL: [`supabase/`](supabase/README.md).

---

## Auth and cookies

When `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and a **32+ character `SESSION_SECRET`** are set **on the server** (never in frontend JS):

1. Username login looks up `public.profiles`, then Auth signs in with that row’s email + password.
2. Signup uses the Admin API with `email_confirm: true` (no verification email), inserts `profiles` (including DOB), and starts a session.
3. The browser gets a signed **`careloop_session`** cookie: `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS, 30 days. **The browser does not store the Supabase access token in JavaScript.**
4. `require_user` also accepts a bearer token for non-browser API clients.

Without those env slots, login falls back to [`backend/data/mock_users.json`](backend/data/mock_users.json) and the same cookie workflow. Live signup returns HTTP 503. The hardcoded signing fallback is for the local mock only.

Profile shows whether each key slot is loaded — **never the secret value.** `GET /api/careloop/demo-env` is the same status JSON (auth required).

---

## Environment variables

Inject at process/container launch or in **Vercel → Project Settings → Environment Variables** (Production + Preview), then Redeploy. Cursor/cloud-agent env does not reach Vercel. Do not bake keys into the image, commit `.env`, or paste secrets in chat. Never put `service_role` in frontend JS.

| Name | Required for | Notes |
|------|----------------|-------|
| `SUPABASE_URL` | Live signup/login | Hosted project URL |
| `SUPABASE_ANON_KEY` | Live signup/login | Server-side |
| `SUPABASE_SERVICE_ROLE_KEY` | Live signup/login | Server-only; username lookup + profile insert |
| `SESSION_SECRET` | Live auth | Random, **32+ chars**; signs session + coverage cookies |
| `XAI_API_KEY` | Letters, image JSON, visit STT | Already used on Vercel. Seeded transcript / sample card work without it. |
| `STEDI_API_KEY` | Optional live 270/271 | Must be a **`test_`** key. Production keys refused. |
| `GROQ_API_KEY` | Optional | Letter text fallback if xAI is down |

Documented in [`.env.example`](.env.example). Copy it locally; do not use `echo > .env` (that wipes other keys).

---

## Setup and run

```bash
cp .env.example .env
# fill server-side slots as needed; never commit real values
pip3 install -r requirements.txt
python3 -m uvicorn backend.main:app --reload --port 8080
```

Open **http://localhost:8080** (app) or **http://localhost:8080/showcase** (story).

```bash
curl -s -c cookies.txt -X POST http://localhost:8080/api/careloop/login \
  -H "Content-Type: application/json" \
  -d '{"username":"jane","password":"demo"}'
```

Send the saved cookies on later requests (`curl -b cookies.txt ...`). Unauthenticated coverage calls return **401**.

Coverage, network, and login do **not** need `XAI_API_KEY`. Letter generate endpoints return HTTP 500 if that key is missing or still a placeholder.

Useful (no LLM):

```bash
curl -s "http://localhost:8080/api/codes/icd10?q=diabetes"
curl -s -X POST http://localhost:8080/api/risk-score \
  -H "Content-Type: application/json" \
  -d '{"icd10_code":"E11.9","cpt_code":"83036","has_prior_auth":false,"has_clinical_notes":true,"is_emergency":false}'
curl -s http://localhost:8080/api/national-stats
```

---

## Safety invariants

Do not weaken these.

1. **No independent clinical or coverage decisions.** Draft, organize, cite. Cost output is a guess. Specialty is a directory filter, not a diagnosis.
2. **Do not invent eligibility or copays.** Unreadable OCR is `[NEEDS VERIFICATION]`. Estimates are labeled.
3. **Clinician review before finalization** of SOAP/orders in the visit flow.
4. **PA ≠ claim.** Prior-auth denial is *before* a drug/service is authorized. Claim denial is *during/after* billing. Separate objects and screens. A PA approval does **not** mean a later claim is paid. Claims UI is Coming soon.
5. **Drafts only.** No file/fax/eRx/live insurer.
6. **Synthetic demo data.** Fictional Jane Doe; never use real PHI.
7. **Letter APIs** still wrap free-text in `DRAFT_WATERMARK` (`backend/llm.py` `generate()`). JSON extract is **not** watermarked. History packet is **not** a letter. There is currently **no** letter-download UI; if one is added, it must go through human approval (`App.requestApproval()` in `frontend/js/app.js`) before download.

Zero-hallucination prompts (`backend/prompts.py`) only use supplied facts; `main.py` surfaces `[NEEDS VERIFICATION]` as `warnings`.

---

## Team and further docs

Built at Johns Hopkins University for HopHacks 2026: Vivek Budania, Dave Nganga, Sreekantha Sreekar, Sree Lohith. LinkedIn on [`/showcase`](frontend/showcase.html).

| Doc | Role |
|-----|------|
| [`AGENTS.md`](AGENTS.md) | Dummy login, what is wired, files that matter |
| [`CLAUDE.md`](CLAUDE.md) | Architecture notes for coding agents |
| [`plan.md`](plan.md) | Original owner split (Dave / Sreekar / Vivek) and remaining golden-path items |
| [`workflow.md`](workflow.md) | Screen-by-screen IA (mockups; live names differ slightly) |
| [`docs/database/`](docs/database/README.md) | Hosted `profiles` / `visits` / `insurance` |
| [`supabase/README.md`](supabase/README.md) | How to treat checked-in SQL |
