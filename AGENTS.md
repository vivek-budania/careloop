# CareLoop — agent notes

Read this before changing the running app. Setup commands also live in [`README.md`](README.md) and [`CLAUDE.md`](CLAUDE.md). Hackathon owner split: [`plan.md`](plan.md).

## What the product is

**CareLoop is the entire web app.** It is a mocked US patient-journey demo (coverage intake first). It is **not** a real payer, PBM, EHR, or claims platform.

After login the user sees two tabs:

1. **CareLoop** — the product. Paginated coverage intake (identity → optional review → mock eligibility → symptoms → visit/cost guess → in-network clinicians).
2. **Insurance Claims Management** — **Coming soon** placeholder. Provider and Patient Advocate letter UIs are **not** in the nav. Do not treat those old DenialShield forms as the demo.

Letter APIs (`/api/generate-pa`, parse, appeal, demand) still exist in the backend for later claims work. Do not wire a download path that skips HITL/watermark if you turn them back on.

## Dummy credentials (mock login)

Not production auth. No HIPAA. Passwords are plaintext in `backend/data/mock_users.json`. Sessions are in-memory (lost on server restart).

**Password for every account: `demo`**

Demo members are remapped to Stedi's canned sandbox subscribers. Golden path: **`jane` / `demo`**, pick **Aetna**, load sample card.

| Username | Name | Role | After login |
|----------|------|------|-------------|
| `jane` | Jane Doe | patient | CareLoop + Claims (coming soon) |
| `maya` | Jane Doe | patient | same two tabs (alias for jane) |
| `priya` | Dr. Priya Shah | clinician | same two tabs |
| `advocate` | Alex Rivera | advocate | same two tabs |
| `demo` | Jane Doe | demo | same two tabs |

```bash
curl -s -X POST http://localhost:8080/api/careloop/login \
  -H "Content-Type: application/json" \
  -d '{"username":"jane","password":"demo"}'
```

Use the returned `token` as `Authorization: Bearer <token>` on `/api/careloop/*` except `/api/careloop/login` and `/api/careloop/auth/accounts`. Unauthenticated coverage calls return **401**.

## Run

```bash
cp .env.example .env
# GEMINI_API_KEY is not required for mock coverage/login
# For a live Stedi sandbox 271, inject the test key at launch (preferred):
#   STEDI_API_KEY=test_… python3 -m uvicorn backend.main:app --port 8080
# Laptop fallback: STEDI_API_KEY in gitignored .env. Never paste it in chat/GitHub.
pip3 install -r requirements.txt
python3 -m uvicorn backend.main:app --reload --port 8080
```

Open http://localhost:8080 → log in as `jane` / `demo` → CareLoop wizard. Pick **Aetna** (preselected) → Load sample card (Jane Doe / AETNA12345 / 2004-04-04) → confirm coverage. Gemini/Azure are for OCR later; this slice does not OCR.

**Where the Stedi key goes:** `STEDI_API_KEY` on the **process/container at launch**. Do not bake it into the image, commit it, or paste it in chat. A laptop `.env` is a fallback; `load_dotenv(override=False)` so the container env always wins. A `test_` key runs Stedi's canned 270/271; a production key is refused. Without a key, step 3 still works using mock numbers that match Jane Doe's Aetna 271 (ACTIVE PPO Gold, office copay $30, INN deductible $500 remaining $500, OON $1000, INN OOP $7000 remaining $7000).

## CareLoop wizard (Dave)

One step on screen at a time (`frontend/js/careloop.js`).

1. Insurance identity — **payer dropdown required**; optional typed fields / sample card / filename-only uploads
2. Optional review — skip allowed
3. Confirm coverage — Stedi sandbox 270/271 when `STEDI_API_KEY` is a test key and the member matches a canned subscriber; otherwise mock active/inactive + copay/deductible
4. Reason for visit — symptoms + optional prior-visit PDF/image (filename) or sample note
5. Visit/cost **guess** — labeled estimate, not a bill or coverage decision
6. In-network clinicians — fixture list ∩ ZIP distance

Fixture golden path: **Aetna**, Jane Doe, member `AETNA12345`, DOB `2004-04-04`, ZIP `94110`, diabetes follow-up → about **$75** patient-owed (office copay $30 + HbA1c $45 against remaining deductible). **Inactive Demo Plan** returns inactive coverage. `maya` still logs in (alias of Jane Doe).

Coverage state is **in-memory** until Vivek’s thread store exists.

## Safety (do not weaken)

- No independent clinical or coverage decisions. Cost output is a guess.
- Do not collapse **PA denial** (before care is authorized) vs **claim denial** (after billing).
- Drafts only — no file/fax/eRx/live insurer.
- If generating letters: `DRAFT_WATERMARK` + HITL approve-before-download.

## Files that matter for this slice

- `backend/careloop/auth.py` — mock login
- `backend/careloop/coverage.py` — mock scan/eligibility/visit guess/network
- `backend/careloop/stedi.py` — optional sandbox 270/271 (test key from local `.env`)
- `backend/data/mock_users.json` — dummy accounts (Jane Doe / `jane`)
- `backend/data/mock_payers.json`, `mock_network.json`, `mock_fee_schedule.json`, `mock_prior_visit.json`
- `frontend/js/careloop.js`, `frontend/js/app.js`, `frontend/js/api.js`
- `frontend/index.html` — login, CareLoop wizard, claims coming-soon tab
- `.env.example` — documents `STEDI_API_KEY` (inject at launch; do not commit the secret)

`frontend/js/provider.js` and `frontend/js/patient.js` are leftover DenialShield modules; they are not product tabs.
