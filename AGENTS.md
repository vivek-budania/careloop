# CareLoop — agent notes

Read this before changing the running app. Setup commands also live in [`README.md`](README.md) and [`CLAUDE.md`](CLAUDE.md). Hackathon owner split: [`plan.md`](plan.md).

## Owner progress (for other agents)

**Dave (coverage / card / network / cost).** Combined with Vivek’s patient shell on this branch.

| Work | Where |
|------|--------|
| Vivek patient shell (☰ Today / History / Medicines / Tests / Insurance / Profile, 8-step visit, `/letters`) | **this branch** (from PR #8) |
| Jane Doe / Aetna `AETNA12345` / DOB `2004-04-04` / Stedi sandbox | **this branch** |
| Gemini vision card/SBC on Insurance only | **this branch** |
| Specialty suggestion from visit reason → `searchNetwork` | **this branch** |
| Coverage snapshot | **in-memory** until Vivek’s thread store |

Do not rebuild the wizard. Do not restore Provider/Advocate tabs. Fixture sample card stays the no-key path. Do not invent copays. Tag unreadable OCR fields `[NEEDS VERIFICATION]`. No letter watermark on JSON extract.

**Vivek:** design lead. IA, copy, ivory/sage chrome, hamburger, first-time vs returning login, skippable costs after SOAP. Do not fight those.

**Sreekar:** PA/parse/appeal/demand APIs still exist at `/letters`. Claims is Coming soon on Insurance. Do not collapse PA denial vs claim denial. Scribe rebase onto the SOAP step, not the old wizard.

---

## What the product is

**CareLoop is the entire web app.** It is a mocked US patient-journey demo (coverage intake first). It is **not** a real payer, PBM, EHR, or claims platform.

After login the user sees the **patient shell** (not Provider/Advocate tabs):

1. **☰** Today · History (My visits | For the clinic) · Medicines · Tests · Insurance · Profile · Log out
2. **Visit journey** is not in the hamburger (symptoms → clinicians → book → visit → transcript → SOAP → skippable estimated costs → plan). First-time login opens the insurance hub; returning login opens Today with **Aetna / Jane Doe** coverage seeded.
3. **Insurance Claims Management** is Coming soon on the Insurance screen. Letter drafts (HITL) are at `/letters`.

Letter APIs (`/api/generate-pa`, parse, appeal, demand) still exist. Do not wire a download path that skips HITL/watermark. History packet `.md` is a record export, not a letter.

## Dummy credentials (mock login)

Not production auth. No HIPAA. Passwords are plaintext in `backend/data/mock_users.json`. Sessions are in-memory (lost on server restart).

**Password for every account: `demo`**

Golden path: **`jane` / `demo`** → **I’m returning** (seeds Aetna Jane Doe) or **Start my first visit** (insurance hub, sample card = same fixture).

| Username | Name | Role | After login |
|----------|------|------|-------------|
| `jane` | Jane Doe | patient | patient shell |
| `maya` | Jane Doe | patient | same (alias) |
| `priya` | Dr. Priya Shah | clinician | same |
| `advocate` | Alex Rivera | advocate | same |
| `demo` | Jane Doe | demo | same |

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

Open http://localhost:8080 → log in as `jane` / `demo` → **I’m returning** or **Start my first visit**.

**Insurance:** payer required; **date of birth required**; sample card is Jane Doe / Aetna / `AETNA12345` / `2004-04-04`. Optional **Read uploaded images** (Gemini vision) lives on this Insurance flow only — not in the hamburger. Without `GEMINI_API_KEY`, use the sample card. JSON extract is not watermarked. Never invent a copay that is not printed.

**Where the Stedi key goes:** `STEDI_API_KEY` on the **process/container at launch**, or Vercel Project Settings → Environment Variables (then Redeploy). Cursor/cloud-agent env does not reach Vercel. Do not bake the key into the image, commit it, or paste it in chat. A `test_` key runs Stedi's canned 270/271; a production key is refused. Without a key, confirm still works using mock numbers that match Jane Doe's Aetna 271 (ACTIVE PPO Gold, office copay $30, INN deductible $500 remaining $500).

**Vercel:** entrypoint is `backend.main:app` in [`pyproject.toml`](pyproject.toml). Do not replace `/` with a JSON stub.

## CareLoop patient UI + Dave coverage

Patient chrome is `frontend/js/careloop.js` (Vivek’s demo IA). Coverage/cost/network still use Dave’s APIs:

- Payer dropdown + sample card + confirm: `listPayers` / `scanCoverage` / `saveCoverage` / `confirmCoverage`
- DOB is required on save. Stedi uses it on the canned Jane Doe member.
- Optional Gemini read: `scanCoverage` with `card_image_b64` / `sbc_image_b64` (Insurance form only)
- Symptoms intake: `saveCoverageIntake` (returns `suggested_specialty`)
- Clinician list: `searchNetwork(suggested_specialty, zip)` — no specialty dropdown
- Estimated costs (after SOAP, skipped if no plan): `guessVisitCost`

Fixture golden path: **Aetna**, Jane Doe, member `AETNA12345`, DOB `2004-04-04`, ZIP `94110`, diabetes follow-up → specialty **endocrinology** (Elena Ruiz, in-network on Aetna) → about **$75** patient-owed (office copay $30 + HbA1c $45 against remaining deductible). **Inactive Demo Plan** returns inactive coverage. `maya` still logs in (alias of Jane Doe).

Coverage state is **in-memory** until Vivek’s thread store exists. Visit/meds/history UI state is local until that store lands.

## Safety (do not weaken)

- No independent clinical or coverage decisions. Cost output is a guess. Specialty is a directory filter, not a diagnosis.
- Do not collapse **PA denial** (before care is authorized) vs **claim denial** (after billing).
- Drafts only — no file/fax/eRx/live insurer.
- If generating letters: `DRAFT_WATERMARK` + HITL approve-before-download.

## Files that matter for this slice

- `backend/careloop/auth.py` — mock login
- `backend/careloop/coverage.py` — mock scan/eligibility/visit guess/network/specialty suggestion
- `backend/careloop/extract.py` — Gemini vision card/SBC → InsuranceProfile (no watermark)
- `backend/careloop/stedi.py` — optional sandbox 270/271 (`STEDI_API_KEY` at launch)
- `.env.example` — documents `STEDI_API_KEY` and `GEMINI_API_KEY` (inject at launch; do not commit secrets)
- `backend/data/mock_users.json` — dummy accounts (Jane Doe / `jane`)
- `backend/data/mock_payers.json`, `mock_network.json`, `mock_fee_schedule.json`, `mock_prior_visit.json`
- `frontend/js/careloop.js`, `frontend/js/app.js`, `frontend/js/api.js`
- `frontend/index.html` — patient shell
- `frontend/letters.html` — PA/appeal HITL (not in ☰)
- `pyproject.toml` — Vercel FastAPI entrypoint

`frontend/js/provider.js` and `frontend/js/patient.js` power `/letters`; they are not the CareLoop hamburger.
