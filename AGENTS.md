# CareLoop — agent notes

Read this before changing the running app. Setup commands also live in [`README.md`](README.md) and [`CLAUDE.md`](CLAUDE.md). Hackathon owner split: [`plan.md`](plan.md).

## What the product is

**CareLoop is the entire web app.** It is a mocked US patient-journey demo (coverage intake first). It is **not** a real payer, PBM, EHR, or claims platform.

After login the user sees the **patient shell** (not Provider/Advocate tabs):

1. **☰** Today · History (My visits | For the clinic) · Medicines · Tests · Insurance · Profile · Log out
2. **Visit journey** is not in the hamburger (symptoms → clinicians → book → visit → transcript → SOAP → skippable estimated costs → plan). First-time login opens the insurance hub; returning login opens Today with mock coverage seeded.
3. **Insurance Claims Management** is Coming soon on the Insurance screen. Letter drafts (HITL) are at `/letters`.

Letter APIs (`/api/generate-pa`, parse, appeal, demand) still exist. Do not wire a download path that skips HITL/watermark. History packet `.md` is a record export, not a letter.

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

Open http://localhost:8080 → log in (`maya` / `demo`) → **I’m returning** or **Start my first visit**. Optional later: `STEDI_API_KEY` (sandbox 270/271; fixture members will not match). Gemini is for letter drafts on `/letters`.

## CareLoop patient UI + Dave coverage

Patient chrome is `frontend/js/careloop.js` (demo IA). Coverage/cost/network still use Dave’s APIs:

- Payer dropdown + sample card + confirm: `listPayers` / `scanCoverage` / `saveCoverage` / `confirmCoverage`
- Symptoms intake: `saveCoverageIntake`
- Estimated costs (after SOAP, skipped if no plan): `guessVisitCost`
- Clinician list: `searchNetwork` (fixture ∩ ZIP)

Fixture golden path: Mock Payer, Maya Chen, ZIP `94110`, diabetes follow-up → about **$75** patient-owed (99214 copay $30 + HbA1c $45). **Inactive Demo Plan** returns inactive coverage.

Coverage state is **in-memory** until Vivek’s thread store exists. Visit/meds/history UI state is local until that store lands.

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
- `frontend/index.html` — patient shell
- `frontend/letters.html` — PA/appeal HITL (not in ☰)

`frontend/js/provider.js` and `frontend/js/patient.js` power `/letters`; they are not the CareLoop hamburger.
