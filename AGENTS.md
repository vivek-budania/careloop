# CareLoop — agent notes

Read this before changing the running app. Setup, architecture, env, and safety also live in [`README.md`](README.md) (product narrative matches [`/showcase`](frontend/showcase.html)). Owner split / remaining work: [`plan.md`](plan.md).

## What the product is

**CareLoop is the entire web app.** Mocked US patient journey (not a payer, PBM, EHR, or claims platform).

| URL | What |
|-----|------|
| `/showcase` | Judge-facing product story |
| `/` | Patient app (login → shell) |
| `/mockups/` | Static visual clickthrough (Maya Chen; not the live shell) |

After login the user sees the **patient shell** (not Provider/Advocate tabs):

1. **☰** Today · Past visits (My visits | For the clinic) · Upcoming visits · Reminders · Prescriptions · Test records · Insurance · Profile · Log out
2. **Visit journey is not in the hamburger.** Booking 1–3: symptoms → clinicians → **Save request**. Visit-day: optional new symptoms → check-in → record / upload / **Demo 1–3** → summary → skippable estimated costs → plan → follow-ups.
3. **Insurance Claims Management** is Coming soon on Insurance. There is **no** `/letters` page. Letter **APIs** still exist; do not add a download path that skips watermark + human approval.

Do not rebuild the wizard. Do not restore Provider/Advocate tabs. Fixture sample card stays the no-key path. Do not invent copays. Tag unreadable OCR `[NEEDS VERIFICATION]`. No letter watermark on JSON extract.

**Vivek:** design lead. IA, copy, ivory/sage chrome, hamburger. Do not fight those.

**Sreekar:** PA/parse/appeal/demand APIs remain. Claims is Coming soon. Do not collapse PA denial vs claim denial. Scribe lives on visit-day (transcript → SOAP), not a second wizard.

**Dave:** coverage / card / network / cost APIs.

---

## Dummy credentials (login)

Not production auth. No HIPAA.

| Path | UI |
|------|-----|
| Returning | **LOGIN** with **`jane` / `demo`** → Today. If no coverage on file, the client confirms the Jane Doe / Aetna fixture via Dave’s APIs (cookie + `localStorage` — **not** `public.insurance` yet). |
| First visit | **Start my first visit** → signup (Supabase Admin, `email_confirm: true`, no verification email) → insurance hub. Typed name stays on the local thread. |

**Seeded live user:** username **`jane`**, email `jane@careloop.local`, password **`demo`**. Do not invent other passwords.

Signup/login use Auth + `public.profiles` when `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and a 32+ character `SESSION_SECRET` are set **on the server**. Username lookup → Auth password grant → signed **`careloop_session`** cookie (`HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS, 30 days). The browser does **not** receive or store the Supabase access token. `require_user` also accepts bearer tokens for non-browser clients.

Without those env slots, login falls back to `backend/data/mock_users.json`. Live signup returns HTTP 503. Other mock usernames (`maya`, `priya`, `advocate`, `demo`) only work on the HMAC fallback, not on the seeded Supabase project.

Hosted `visits` and `insurance` exist ([`docs/database/`](docs/database/README.md)) but login and coverage APIs do **not** read them. Prescriptions, tests, claims, and PA letters are not tables. Visit-day **new symptoms** stay on the local journey (`new_symptoms` + `new_symptoms_log`).

```bash
curl -s -c cookies.txt -X POST http://localhost:8080/api/careloop/login \
  -H "Content-Type: application/json" \
  -d '{"username":"jane","password":"demo"}'
```

Unauthenticated coverage calls return **401**.

---

## Run

```bash
cp .env.example .env
pip3 install -r requirements.txt
python3 -m uvicorn backend.main:app --reload --port 8080
```

Open http://localhost:8080 → **`jane` / `demo`** → LOGIN, or **Start my first visit**.

**Insurance:** payer required; **date of birth required**; sample card is Jane Doe / Aetna / `AETNA12345` / `2004-04-04`. Optional **Read uploaded images** (`XAI_API_KEY`) lives on this Insurance flow. Without a vision key, use the sample card. **Refresh coverage** re-runs confirm (live 270/271 when a Stedi **test** key is loaded).

**Where the keys go:** `SUPABASE_*`, `SESSION_SECRET`, `STEDI_API_KEY`, `XAI_API_KEY`, optional `GROQ_API_KEY` on the process/container at launch, or Vercel env then Redeploy. Never put `service_role` in frontend JS. Profile shows whether each slot is loaded — never the secret. A `test_` Stedi key runs canned 270/271; a production key is refused. Without Stedi, confirm still uses mock numbers that match Jane’s Aetna 271 (ACTIVE PPO Gold, office copay $30, INN deductible $500 remaining $500). `GET /api/careloop/demo-env` is the same status JSON (auth required).

**Vercel:** entrypoint `backend.main:app` in [`pyproject.toml`](pyproject.toml). Do not replace `/` with a JSON stub. Live login needs the three `SUPABASE_*` names plus `SESSION_SECRET`.

---

## Patient UI + coverage APIs

Patient chrome: `frontend/js/careloop.js`. Coverage/cost/network still use Dave’s APIs:

- Payer dropdown + sample card + confirm: `listPayers` / `scanCoverage` / `saveCoverage` / `confirmCoverage`
- Confirm always sends member name, member ID, and DOB. Blanks on a Stedi payer are filled from that payer’s canned fixture.
- Optional image JSON: `scanCoverage` with `card_image_b64` / `sbc_image_b64`; `POST /api/careloop/extract-image` for a printed-parts summary
- Symptoms intake: `saveCoverageIntake` (returns `suggested_specialty`)
- Clinician list: `searchNetwork(suggested_specialty, zip)` — no specialty dropdown
- Estimated costs (after SOAP, skipped if no plan): `guessVisitCost`

**Visit-day:** Step 2 searches the mock directory by ZIP + specialty from the visit reason. Open/upcoming visits can be deleted. Demos: `GET /api/careloop/scribe/demos` (1 psoriasis/Skyrizi, 2 lumbar MRI, 3 chronic-migraine Botox). Audio: `POST /api/careloop/scribe/transcribe` (2-minute cap). Seeded SOAP uses `use_seeded: true` + `demo_id`. Step 6: `POST /api/careloop/scribe/summarize` (Sumy). On Vercel, NLTK corpora go to `/tmp/nltk_data`. `frontend/js/scribe.js` is **not** loaded.

Fixture golden path: **Aetna**, Jane Doe, `AETNA12345`, DOB `2004-04-04`, ZIP `94110`, diabetes follow-up → **endocrinology** (Elena Ruiz, in-network) → about **$75** patient-owed. **Inactive Demo Plan** returns inactive coverage.

Coverage snapshot is per username (signed cookie + `localStorage`) until `insurance` is wired. Visit/meds/history UI state is local. There is **no** `GET /api/careloop/thread`.

---

## Safety (do not weaken)

- No independent clinical or coverage decisions. Cost output is a guess. Specialty is a directory filter, not a diagnosis.
- Do not collapse **PA denial** (before care is authorized) vs **claim denial** (after billing).
- Drafts only — no file/fax/eRx/live insurer.
- If generating letters: `DRAFT_WATERMARK` on `generate()` + human approval before any download. JSON extract is not watermarked. History packet `.md`/PDF is a record export, not a letter.

---

## Files that matter

- `backend/careloop/auth.py` — signup/login (cookie session; mock fallback is login-only)
- [`docs/database/`](docs/database/README.md) — hosted schema (`profiles` 1:1 Auth; `insurance` one current row; `visits` many)
- [`supabase/`](supabase/README.md) — idempotent SQL
- `backend/careloop/supabase_auth.py` — server-only Auth + `profiles` HTTP
- `backend/careloop/coverage.py` — mock scan/eligibility/visit guess/network/specialty
- `backend/careloop/extract.py` — xAI vision; `POST /api/careloop/extract-image`
- `backend/careloop/stedi.py` — optional sandbox 270/271
- `backend/careloop/scribe.py` — seeded SOAP/Plan + clinician approve → orders
- `backend/careloop/stt.py` — optional xAI Grok STT
- `backend/careloop/pdf_export.py` — history packet PDF (not a letter)
- `backend/config.py` — `demo_env_status()` (no secret values)
- `backend/data/mock_users.json` — HMAC fallback (`jane`)
- `backend/data/mock_payers.json`, `mock_network.json`, `mock_fee_schedule.json`, `mock_prior_visit.json`, `mock_visit_transcript.json`
- `frontend/js/careloop.js`, `frontend/js/app.js`, `frontend/js/api.js`
- `frontend/js/scribe.js` — older Stream C voice room (**not loaded**)
- `frontend/index.html` — patient shell
- `frontend/showcase.html` — product story
- `pyproject.toml` — Vercel entrypoint

Letter generate/parse/risk routes still live in `backend/main.py`. `frontend/js/provider.js` / `patient.js` / `letters.html` are **gone**.
