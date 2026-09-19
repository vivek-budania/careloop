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

| Username | Name | Role | After login |
|----------|------|------|-------------|
| `maya` | Maya Chen | patient | CareLoop + Claims (coming soon) |
| `priya` | Dr. Priya Shah | clinician | same two tabs |
| `advocate` | Alex Rivera | advocate | same two tabs |
| `demo` | Hackathon Demo | demo | same two tabs |

```bash
curl -s -X POST http://localhost:8080/api/careloop/login \
  -H "Content-Type: application/json" \
  -d '{"username":"maya","password":"demo"}'
```

Use the returned `token` as `Authorization: Bearer <token>` on `/api/careloop/*` except `/api/careloop/login` and `/api/careloop/auth/accounts`. Unauthenticated coverage calls return **401**.

## Run

```bash
cp .env.example .env
# GEMINI_API_KEY is not required for mock coverage/login
pip3 install -r requirements.txt
python3 -m uvicorn backend.main:app --reload --port 8080
```

Open http://localhost:8080 → log in → CareLoop wizard. Optional later: `STEDI_API_KEY` (sandbox 270/271; fixture members will not match). Gemini/Azure are for OCR later; this slice does not OCR.

## CareLoop wizard

One step on screen at a time (`frontend/js/careloop.js`).

**Dave (1–6)**
1. Insurance identity — **payer dropdown required**; optional typed fields / sample card / filename-only uploads
2. Optional review — skip allowed
3. Confirm coverage — mock active/inactive + copay/deductible (`MockEligibility.check`)
4. Reason for visit — symptoms + optional prior-visit PDF/image (filename) or sample note
5. Visit/cost **guess** — labeled estimate, not a bill or coverage decision
6. In-network clinicians — fixture list ∩ ZIP distance

**Sreekar Stream C (7–8)**
7. Visit transcript — **Record** (Grok STT), upload audio, load mock Maya Chen visit, or paste
8. SOAP / Plan review — clinician **I've Reviewed** → Orders (`pa_required` on GLP-1)

Fixture golden path: Mock Payer, Maya Chen, ZIP `94110`, diabetes follow-up → about **$75** patient-owed (99214 copay $30 + HbA1c $45). **Inactive Demo Plan** returns inactive coverage.

Optional: `XAI_API_KEY` in `.env` for Grok speech-to-text (`POST /api/careloop/scribe/transcribe`). Coverage state is **in-memory** until Vivek’s thread store exists.

Vivek’s visual phone mockups (not the live API app): http://localhost:8080/mockups/

## Safety (do not weaken)

- No independent clinical or coverage decisions. Cost output is a guess.
- Do not collapse **PA denial** (before care is authorized) vs **claim denial** (after billing).
- Drafts only — no file/fax/eRx/live insurer.
- If generating letters: `DRAFT_WATERMARK` + HITL approve-before-download.

## Files that matter for this slice

- `backend/careloop/auth.py` — mock login
- `backend/careloop/coverage.py` — mock scan/eligibility/visit guess/network
- `backend/data/mock_users.json` — dummy accounts
- `backend/data/mock_payers.json`, `mock_network.json`, `mock_fee_schedule.json`, `mock_prior_visit.json`
- `frontend/js/careloop.js`, `frontend/js/app.js`, `frontend/js/api.js`
- `frontend/index.html` — login, CareLoop wizard, claims coming-soon tab

`frontend/js/provider.js` and `frontend/js/patient.js` are leftover DenialShield modules; they are not product tabs.
