# CareLoop — agent notes

Read this before changing the running app. Setup commands also live in [`README.md`](README.md) and [`CLAUDE.md`](CLAUDE.md). Hackathon owner split: [`plan.md`](plan.md).

## Owner progress (for other agents)

**Dave (coverage / card / network / cost).** Combined with Vivek’s patient shell on this branch.

| Work | Where |
|------|--------|
| Vivek patient shell (☰ Today / Past visits / Upcoming visits / Prescriptions / Test records / Insurance / Profile, 8-step visit, `/letters`) | **this branch** (from PR #8) |
| Jane Doe / Aetna `AETNA12345` / DOB `2004-04-04` / Stedi sandbox | **this branch** |
| Live Stedi 270/271 when `STEDI_API_KEY` is a `test_` key | **this branch** (`confirm` always sends Jane identity) |
| Demo key slots on Profile (Stedi / Gemini / Groq / Vercel) | **this branch** (`GET /api/careloop/demo-env`, no secret values) |
| Image → JSON (`XAI_API_KEY`) | **this branch**; cards, doctor pages, lab pages; Gemini fallback |
| Specialty suggestion from visit reason → `searchNetwork` | **this branch** |
| Sreekar Stream C scribe APIs (fixture / draft / approve / optional Grok STT) | **main (PR #6)**; SOAP step in this shell |
| Coverage snapshot | **in-memory** until Vivek’s thread store |
| Hosted DB docs (`profiles`, `visits`, `insurance`) | [`docs/database/`](docs/database/README.md) · SQL [`supabase/migrations/`](supabase/migrations/) |

Do not rebuild the wizard. Do not restore Provider/Advocate tabs. Fixture sample card stays the no-key path. Do not invent copays. Tag unreadable OCR fields `[NEEDS VERIFICATION]`. No letter watermark on JSON extract.

**Vivek:** design lead. IA, copy, ivory/sage chrome, hamburger, first-time vs returning login, skippable costs after SOAP. Do not fight those.

**Sreekar:** PA/parse/appeal/demand APIs still exist at `/letters`. Claims is Coming soon on Insurance. Do not collapse PA denial vs claim denial. Scribe lives on visit steps 5–6 (transcript → SOAP), not a second wizard.

---

## What the product is

**CareLoop is the entire web app.** It is a mocked US patient-journey demo (coverage intake first). It is **not** a real payer, PBM, EHR, or claims platform.

After login the user sees the **patient shell** (not Provider/Advocate tabs):

1. **☰** Today · Past visits (My visits | For the clinic) · Upcoming visits · Prescriptions · Test records · Insurance · Profile · Log out
2. **Visit journey** is not in the hamburger (symptoms → clinicians → book → visit → transcript → SOAP → skippable estimated costs → plan). First-time login opens the insurance hub; returning login opens Today with **Aetna / Jane Doe** coverage seeded.
3. **Insurance Claims Management** is Coming soon on the Insurance screen. Letter drafts (HITL) are at `/letters`.

Letter APIs (`/api/generate-pa`, parse, appeal, demand) still exist. Do not wire a download path that skips HITL/watermark. History packet `.md` is a record export, not a letter.

## Dummy credentials (login)

Not production auth. No HIPAA. **Login-only** against the existing Supabase project: username looks up `public.profiles`, then Auth signs in with that row’s email + password. There is no `login` table. Hosted `visits` and `insurance` exist ([`docs/database/`](docs/database/README.md)) but login and coverage APIs do **not** read them yet — do not wire that in a docs-only change. Prescriptions, test records, claims, and PA letters are still not tables. Visit-day **new symptoms** stay on the local journey (`new_symptoms` + timestamped `new_symptoms_log`); they are not a `visits` column yet.

When `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are set on the **server** (never in frontend JS), `/api/careloop/login` returns `{ token, user }` where `token` is the **Supabase access JWT**. Dave’s coverage routes still take `Authorization: Bearer <token>` (or the `careloop_token` cookie). `require_user` accepts that JWT **or** the older HMAC `v1.` mock token so coverage cookies from a no-key deploy still work.

Without those env slots, login falls back to `backend/data/mock_users.json` and an HMAC token. Coverage snapshot still travels in a signed `careloop_coverage` cookie plus browser `localStorage`. Optional `SESSION_SECRET` rotates the HMAC / coverage-cookie signature.

**Seeded live user:** username **`jane`**, email `jane@careloop.local`, password **`demo`**. Do not invent other passwords.

Golden path: **`jane` / `demo`** → **I’m returning** (seeds Aetna Jane Doe) or **Start my first visit** (insurance hub, sample card = same fixture).

| Username | Name | Role | After login |
|----------|------|------|-------------|
| `jane` | Jane Doe | patient | patient shell |

Other mock usernames (`maya`, `priya`, `advocate`, `demo`) only work on the HMAC fallback, not on the seeded Supabase project.

```bash
curl -s -X POST http://localhost:8080/api/careloop/login \
  -H "Content-Type: application/json" \
  -d '{"username":"jane","password":"demo"}'
```

Use the returned `token` as `Authorization: Bearer <token>` on `/api/careloop/*` except `/api/careloop/login` and `/api/careloop/auth/accounts`. Unauthenticated coverage calls return **401**.

## Run

```bash
cp .env.example .env
# GEMINI_API_KEY is not required for coverage/login
# Demo key slots (inject at launch; extra keys later the same way):
#   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=…  # login only; never frontend
#   STEDI_API_KEY=test_… python3 -m uvicorn backend.main:app --port 8080
#   XAI_API_KEY=…        # image → JSON + visit STT (already on Vercel)
#   GEMINI_API_KEY=…     # /letters; fallback image JSON
#   GROQ_API_KEY=…       # optional letter fallback
# Laptop fallback: gitignored .env. Never paste keys in chat/GitHub.
# Vercel: Project Settings → Environment Variables → same names, then Redeploy.
pip3 install -r requirements.txt
python3 -m uvicorn backend.main:app --reload --port 8080
```

Open http://localhost:8080 → log in as `jane` / `demo` → **I’m returning** or **Start my first visit**.

**Insurance:** payer required; **date of birth required**; sample card is Jane Doe / Aetna / `AETNA12345` / `2004-04-04`. Optional **Read uploaded images** (`XAI_API_KEY`, Gemini fallback) lives on this Insurance flow — not in the hamburger. Without a vision key, use the sample card. JSON extract is not watermarked. Never invent a copay that is not printed. **Refresh coverage snapshot** re-runs confirm (live 270/271 when a Stedi test key is loaded).

**Where the keys go:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (login), `STEDI_API_KEY`, `XAI_API_KEY` (image JSON + visit STT; already on Vercel), `GEMINI_API_KEY` (/letters; fallback image JSON), and optional `GROQ_API_KEY` on the **process/container at launch**, or Vercel Project Settings → Environment Variables (then Redeploy). Cursor/cloud-agent env does not reach Vercel. Do not bake keys into the image, commit them, or paste them in chat. Never put `service_role` in frontend JS. Profile in the patient shell shows whether each slot is loaded — never the secret value. A `test_` Stedi key runs canned 270/271; a production key is refused. Without a Stedi key, confirm still works using mock numbers that match Jane Doe's Aetna 271 (ACTIVE PPO Gold, office copay $30, INN deductible $500 remaining $500). `GET /api/careloop/demo-env` is the same status JSON (auth required).

**Vercel:** entrypoint is `backend.main:app` in [`pyproject.toml`](pyproject.toml). Do not replace `/` with a JSON stub. Fold extra keys into the same Vercel env list as they arrive. Live login needs the three `SUPABASE_*` names.

## CareLoop patient UI + Dave coverage

Patient chrome is `frontend/js/careloop.js` (Vivek’s demo IA). Coverage/cost/network still use Dave’s APIs:

- Payer dropdown + sample card + confirm: `listPayers` / `scanCoverage` / `saveCoverage` / `confirmCoverage`
- Confirm always sends member name, member ID, and DOB. Blanks on a Stedi payer are filled from that payer’s canned fixture so Jane Doe / `AETNA12345` / `2004-04-04` can match.
- DOB is required on save. Stedi uses it on the canned Jane Doe member.
- Optional image JSON: `scanCoverage` with `card_image_b64` / `sbc_image_b64` (Insurance form) and `POST /api/careloop/extract-image` for a printed-parts summary (`XAI_API_KEY`)
- Demo key slots: `demoEnv` → Profile (and Insurance eligibility notice)
- Symptoms intake: `saveCoverageIntake` (returns `suggested_specialty`)
- Clinician list: `searchNetwork(suggested_specialty, zip)` — no specialty dropdown
- Estimated costs (after SOAP, skipped if no plan): `guessVisitCost`

**Sreekar Stream C (visit-day from Upcoming visits):** booking steps 1–3 end at **Save request**, which confirms the appointment. Step 2 searches the mock directory by **ZIP + specialty from the visit reason** (nearby ≤ 40 miles, then farther alternatives). Open/upcoming visits can be deleted. Opening an upcoming visit starts visit-day: **New symptoms** (optional, before check-in; **local only** — not written to `visits`) then check-in → record / upload / **Demo 1, Demo 2, Demo 3** → summary → costs → plan. Demo 1 psoriasis/Skyrizi, Demo 2 lumbar MRI, Demo 3 chronic-migraine Botox (`GET /api/careloop/scribe/demos`). Finishing the plan opens a follow-up summary of medicines to take/buy and tests to complete, with **Update Prescriptions and Test records**. Audio goes to `POST /api/careloop/scribe/transcribe` (2-minute cap). A selected demo drafts SOAP with `use_seeded: true` and `demo_id`; live audio uses `use_seeded: false`. Step 6 calls `POST /api/careloop/scribe/summarize` (Sumy). On Vercel, NLTK corpora go to `/tmp/nltk_data`. `frontend/js/scribe.js` is still not loaded. Returning login is Jane Doe; first-visit signup keeps the typed name on `thread.patient` and maps it onto `App.user.name` (auth is still `jane` / `demo`).

Fixture golden path: **Aetna**, Jane Doe, member `AETNA12345`, DOB `2004-04-04`, ZIP `94110`, diabetes follow-up → specialty **endocrinology** (Elena Ruiz, in-network on Aetna) → about **$75** patient-owed (office copay $30 + HbA1c $45 against remaining deductible). **Inactive Demo Plan** returns inactive coverage. Live login is **`jane` / `demo`**.

Coverage snapshot is per username (signed cookie + localStorage) until Vivek’s thread store exists. Intended columns: [`docs/database/insurance.md`](docs/database/insurance.md). Visit/meds/history UI state is local until that store lands.

## Safety (do not weaken)

- No independent clinical or coverage decisions. Cost output is a guess. Specialty is a directory filter, not a diagnosis.
- Do not collapse **PA denial** (before care is authorized) vs **claim denial** (after billing).
- Drafts only — no file/fax/eRx/live insurer.
- If generating letters: `DRAFT_WATERMARK` + HITL approve-before-download.

## Files that matter for this slice

- `backend/careloop/auth.py` — login (Supabase JWT or mock HMAC)
- [`docs/database/`](docs/database/README.md) — hosted schema (`profiles` 1:1 Auth; `insurance` one current row; `visits` many)
- [`supabase/`](supabase/README.md) — idempotent SQL matching those tables (hosted project; CLI not required)
- `backend/careloop/supabase_auth.py` — server-only Auth + `profiles` HTTP
- `backend/careloop/coverage.py` — mock scan/eligibility/visit guess/network/specialty suggestion
- `backend/careloop/extract.py` — xAI vision (`XAI_API_KEY`) then Gemini; `POST /api/careloop/extract-image` returns a printed-parts JSON summary (no watermark)
- `backend/careloop/stedi.py` — optional sandbox 270/271 (`STEDI_API_KEY` at launch)
- `backend/careloop/scribe.py` — seeded SOAP/Plan + clinician approve → orders
- `backend/careloop/stt.py` — optional xAI Grok STT (`XAI_API_KEY`)
- `backend/config.py` — `demo_env_status()` (Supabase / Stedi / Gemini / Groq / xAI / Vercel; no secret values)
- `.env.example` — documents the same key slots (inject at launch; do not commit secrets)
- `backend/data/mock_users.json` — HMAC fallback accounts (Jane Doe / `jane`)
- `backend/data/mock_payers.json`, `mock_network.json`, `mock_fee_schedule.json`, `mock_prior_visit.json`, `mock_visit_transcript.json`
- `frontend/js/careloop.js`, `frontend/js/app.js`, `frontend/js/api.js`
- `frontend/js/scribe.js` — older Stream C voice room (not loaded; Record lives in `careloop.js` step 5)
- `frontend/index.html` — patient shell
- `frontend/letters.html` — PA/appeal HITL (not in ☰)
- `pyproject.toml` — Vercel FastAPI entrypoint

`frontend/js/provider.js` and `frontend/js/patient.js` power `/letters`; they are not the CareLoop hamburger.
