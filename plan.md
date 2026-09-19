# CareLoop hackathon plan

Teammate split for wrapping DenialShield in a **mocked golden-path journey**. The product is the flow, not another letter type. This file is the working plan; keep `README.md` / `CLAUDE.md` as the source of truth for setup commands.

**Scope:** one scripted patient thread (insurance/coverage context → PCP visit → SOAP/Plan → HbA1c + Rx → PA required → mock payer step-therapy denial → policy-to-evidence → appeal → approve → dispense → taken/missed + refill nudge → follow-up summary → **shareable history for the next visit**). Mock eligibility and payer. No real payer/EHR/eRx/claims APIs.

**Owners:** **Dave** (coverage / card / network / cost display), **Sreekar** (visit start → clinical/admin chain: scribe, orders, PA/appeal, meds, claims, follow-up **fact capture**), **Vivek** (patient-facing workflow shell, longitudinal thread, shareable history UX, Dribbble polish later). Original workstreams **A–F are all still in this plan** — remapped below, never dropped.

---

## Shared thesis, safety rails, and current repo vs target

### Thesis

US care is a chain of handoffs (symptoms → visit → encounter → orders → coverage → care → claim → follow-up). Point tools optimize one moment. CareLoop’s gap is **one patient, one data thread**: context from the encounter survives PA, delivery, claims, meds, and the next visit.

Go deepest on **scribe + policy/evidence appeal**. Mock the payer. Keep reminders simple. The **integrated journey** is the demo, not production reimbursement.

Patient-facing workflow comes first (basic), then visual polish. History is first-class: facts captured on the visit/coverage chain must be shareable at the next doctor visit.

### Safety rails (load-bearing)

These already exist in this repo and must not be weakened:

| Rail | Rule |
|------|------|
| **Watermark** | Every free-text generated document (PA, appeal, demand) is wrapped in `DRAFT_WATERMARK` by `backend/llm.py` `generate()`. No new path that returns LLM letter text without it. |
| **HITL download** | Frontend never downloads a generated document without `App.requestApproval()` first (`frontend/js/app.js`). No bypass download button. |
| **Zero hallucination** | Prompts in `backend/prompts.py` only use user-supplied facts; uncertain claims tagged `[NEEDS VERIFICATION]`; `main.py` surfaces those as `warnings`. |
| **No independent clinical or coverage decisions** | Draft, organize, cite, and surface evidence. A clinician or authorized staff member reviews and chooses what to submit. The model must not “approve” care, change diagnosis/dose, or decide coverage. Policy-to-evidence is a **checklist**, not a determination. |
| **Do not collapse PA vs claim denial** | **Prior authorization denial** happens *before* the planned drug/service is covered. **Claim denial** happens *during/after* billing or dispensing (admin error vs coverage/medical necessity). Separate objects, statuses, screens, and demo steps. A PA approval does **not** mean the later claim is paid. |
| **Drafts only** | The product does not file, fax, e-prescribe, or call a real payer. Mock “submit” is local state. |

The brief is not operational billing, legal, or medical guidance.

### Current repo vs target

DenialShield today is a FastAPI + vanilla JS SPA (no frontend build). Two **disconnected** form modules. Stateless. No DB.

#### Already exists (keep; reuse as Authorization seed)

| Capability | Where |
|------------|--------|
| ICD-10 / CPT search | `GET /api/codes/icd10`, `/api/codes/cpt`; `backend/data/*.json`; `frontend/js/provider.js` |
| Heuristic denial risk score | `POST /api/risk-score`; `backend/risk_engine.py` |
| PA letter draft | `POST /api/generate-pa`; `PA_SYSTEM_PROMPT` |
| Denial / EOB parse | `POST /api/parse-denial`; `DENIAL_PARSE_PROMPT` |
| Appeal letter draft | `POST /api/generate-appeal` |
| Claim-file demand letter | `POST /api/generate-demand` |
| National appeal stats | `GET /api/national-stats`; `config.py` |
| HITL modal + download | `frontend/js/app.js` |
| Watermark | `backend/llm.py` + `DRAFT_WATERMARK` |
| Provider / Patient Advocate tabs | `frontend/index.html` — **keep**; they are **not** the CareLoop UX |

#### Greenfield (build)

| Gap | Notes | Owner |
|-----|--------|--------|
| Longitudinal store | Patient, Encounter, Orders, Authorization, Claim, Medication, Follow-up, **Coverage**, **History** — SQLite or in-memory, one thread (app shell) | Vivek (B) |
| Scribe / SOAP / structured Plan | Seeded mock encounter is enough; optional transcript → SOAP | Sreekar (C) |
| Orders extracted from Plan | Lab, Rx, PA-required flag | Sreekar (C) |
| Mock eligibility + mock payer | Eligibility/benefits/network/cost → Dave. Deterministic **once** step-therapy PA denial + citable policy text → Sreekar (D split; see owner sections) | Dave + Sreekar |
| Policy-to-evidence match | Encounter as evidence source; checklist vs policy criteria | Sreekar (D) |
| Med schedule / taken / missed / refill | Simple; not a full pharmacy system | Sreekar (E) |
| Unified timeline UX | **New CareLoop journey UI**; old tabs remain | Vivek (F) |
| Distinct claim flow | Light mock claim + EOB; not the same as PA denial | Sreekar (assigned from original D/greenfield claim path) |
| **Insurance identity → coverage** | **Added.** Payer dropdown (required) + optional typed fields, card OCR, SBC/EOB | Dave |
| **In-network clinicians** | **Added/assigned** from original mock eligibility “in-network” stub; filter by ZIP | Dave |
| **Copay / deductible / OOP + visit/cost guess** | **Added/assigned** from original “estimated copay”; labeled next-visit cost range | Dave |
| **Reason for visit / prior-visit uploads** | **Added.** Symptoms text + optional PDF/image; intake only (not SOAP) | Dave |
| **History maintenance + share at next visit** | **Added, first-class.** Capture facts (Dave/Sreekar) + patient share/export thread (Vivek) | All three (split below) |

Local code sets are tiny (~91 ICD / ~76 CPT). No test suite, linter, or build step.

#### Golden path (demo script)

Payer dropdown and/or card / coverage panel (Dave) → mock eligibility confirm → symptoms + optional prior-visit docs → labeled visit/cost guess → find in-network clinician (ZIP) → PCP visit → clinician-reviewed SOAP + Plan → HbA1c (no PA) + Rx (PA required) → submit mock PA → **step-therapy denial** with citable policy → match policy to encounter evidence → appeal (HITL + watermark) → mock approve → dispense → mark dose taken/missed + refill nudge → unified timeline / follow-up summary → **history packet the patient can share at the next visit**. Keep a **separate** claim (and optional claim denial/correction) so judges see two insurance moments.

#### Original workstream map (A–F preserved)

Coordinate on **object shapes** first (original stream B). Frontend talks only through named methods in `frontend/js/api.js` (do not `fetch` from feature files). New CareLoop routes can live in `backend/main.py` or a clearly imported `backend/careloop/` package mounted from `main.py` — do not fork a second app.

| Original | Title | Owner now |
|----------|--------|-----------|
| **A** | Authorization core (PA generate, parse, appeal, demand, risk, codes, watermark, HITL) | **Sreekar** |
| **B** | Longitudinal thread model (store, seed/reset, thread GET/POST) | **Vivek** (workflow backbone / app shell) |
| **C** | Scribe / SOAP / structured Plan | **Sreekar** |
| **D** | Mock payer + step-therapy denial + policy-to-evidence | **Sreekar**; **eligibility/benefits/network/copay** from D **assigned to Dave** |
| **E** | Med adherence + refill | **Sreekar** |
| **F** | Unified timeline UX (CareLoop journey) | **Vivek** |
| **(new)** | Payer dropdown + optional card/SBC, mock eligibility, symptoms/prior-visit intake, visit/cost guess, which doctors | **Dave** |
| **(new, first-class)** | History maintenance so the patient can share history on the next doctor visit | Capture: **Dave** (coverage) + **Sreekar** (encounter/order/med/auth/claim/follow-up). Share/export/history thread UX: **Vivek** |

Suggested fixture patient (unchanged): adult with T2DM, on metformin, elevated HbA1c, PCP visit, GLP-1 or similar **PA-required** Rx, HbA1c lab **no PA**.

---

## Dave — coverage, card scan, network, cost display

Pre-visit insurance context: **what this mocked plan covers, who is in network, what the patient might pay, and a labeled guess at the next visit’s shape and cost.** Mock is the demo default. Real payer 270/271 stays optional / out of the judged golden path (see **Coverage confirmation APIs** below).

### Intake pipeline (Dave demo)

Manual entry is first-class. Photo/PDF is optional enrichment, not the only path.

```
1. Insurance identity
   Required: insurance-company dropdown (bare minimum).
   Optional: type member ID / group / plan / DOB / ZIP into inputs,
             upload card photo, optional SBC / EOB / benefits PDF.
        ↓
2. Card/docs → InsuranceProfile draft  (skip if user typed everything)
        ↓
3. Optional HITL  — user may confirm/edit member ID / group / payer,
                    or skip and continue with whatever is on the form
        ↓
4a. Coverage confirmation  — active | inactive (+ copay estimate when known)
4b. Reason for visit         — symptoms text + optional prior-visit PDF/image
        ↓
5. Coverage overview + visit/cost guess
   parsed SBC ∪ mock-plan fixture → “what the next visit may look like”
   and a labeled cost estimate (copay / coinsurance / deductible remaining)
        ↓
6. In-network clinicians  — fixture network ∩ distance(ZIP)
```

Do **not** reimplement PA letters or let the model approve coverage. Cost figures are **estimates**, never a determination.

### Login, wizard, and tabs

CareLoop **is the app**. Intake is **one step at a time**. Mock login: `POST /api/careloop/login`. Password for every demo account is `demo`. Full dummy table: [`AGENTS.md`](AGENTS.md).

After login every role sees:

- **CareLoop** — coverage wizard (the product)
- **Insurance Claims Management** — Coming soon (Provider + Patient Advocate letter tools are not shown)

Do not restore Provider / Patient Advocate as top-level product tabs. Letter APIs may remain for later claims work.

This is **not** production auth (no HIPAA, plaintext demo passwords, in-memory sessions).

### Scope

- **Insurance identity (required + optional):** dropdown of mocked payers is the only required field. Optional input boxes for member ID, group, plan type, subscriber name, DOB, ZIP. Optional card image and supporting insurance PDFs (SBC, EOB, benefits summary) for accuracy.
- Insurance **card scan / OCR** (**added**): photo or upload → member ID, payer name, plan type, group number, Rx BIN/PCN when printed. A fixture “scan this card” path must work with **no** OCR key. Live extractors are optional (see **Card/docs → JSON**).
- **Coverage confirmation (step 4a):** mocked eligibility — active/inactive, in-network flag, estimated copay. Optional later adapter to a 270/271 sandbox (Stedi) that only runs on known mock members — never claim a live check against a random uploaded card.
- **Reason for visit (step 4b, added):** patient symptoms (text) plus optional **previous doctor visit summaries** (PDF or image). Dave persists this as intake/history context for the cost guess. SOAP/Plan/orders stay **Sreekar**; do not stand up a second scribe.
- **Coverage overview + visit/cost guess (step 5):** plan snapshot from SBC ∪ fixture; then a **guess** at likely next-visit type (PCP follow-up vs new vs specialty) and patient-owed range. Label as estimate; remaining deductible is mocked unless a 271 supplied it.
- **Which doctors to go to (step 6):** mocked in-network clinician list filtered by specialty + ZIP/distance. Golden-path PCP can be chosen or preselected.
- **Copay, deductible, OOP** display (**optional** richness; original D already had “estimated copay” — keep at least that).
- **Pre-visit coverage panel** in the journey (Vivek renders; Dave owns data + APIs).
- **History fact capture (coverage):** persist Coverage snapshots + intake symptoms/prior-visit notes so the next visit can show “this is the plan we had / these were the estimates.”

### Card/docs → JSON (not married to Gemini vision)

Use whatever extractor is available; always the same `InsuranceProfile` JSON. Confidence / `[NEEDS VERIFICATION]` on unreadable fields. Never invent a copay that is not on the card or SBC.

| Option | Role | When to use |
|--------|------|-------------|
| **Manual inputs + payer dropdown** | Source of truth the user typed | Always available. Required path if there is no image. |
| **Fixture scan** (`image_note: fixture:front-of-card`) | Deterministic demo | Golden path; no API keys. |
| **Azure Document Intelligence `prebuilt-healthInsuranceCard.us`** | Best dedicated **US card** model (insurer, member, group, Rx BIN/PCN, printed copays, per-field confidence) | Optional upgrade if someone adds an Azure key. Cards only — not SBCs or visit notes. |
| **Gemini `generate_json()` (vision)** | Already in this repo; handles **card + SBC/EOB + prior-visit PDF/image** with one client | Default live extractor for the hackathon if a Gemini key exists. Same zero-hallucination rule as other JSON paths (no letter watermark). |
| **AWS Textract / generic OCR** | Raw text or key-values; you still map to `InsuranceProfile` | Skip unless we are already on AWS. No US-card schema. |

**Recommendation for this repo:** fixture + manual entry first; Gemini vision when a key is present (one stack for card, SBC, and prior-visit uploads); Azure card model only if we want higher card-field confidence and accept a second vendor.

### Coverage confirmation APIs (step 4a) — can we search, and what do we use?

**Yes, the industry API exists. No, it will not verify an arbitrary uploaded card in this hackathon.**

What production systems actually call is **X12 270/271 eligibility** (JSON wrappers exist). You send payer ID + member ID (or demographics) + a **provider NPI**. The payer returns active/inactive and, unevenly, copay / deductible / OOP remaining.

| Vendor | What you’d use | Hackathon reality |
|--------|----------------|-------------------|
| **Stedi** Eligibility JSON (`POST …/eligibility`) | Best DX; free **test API key**; mock 271s for Aetna / UHC / Cigna / CMS | Sandbox **only** accepts **exact documented mock members**. Arbitrary card data fails. Production key = real payer traffic + enrollment. |
| **Availity Coverages** (`POST /v1/coverages`) | Large US clearinghouse 270/271 | Demo plan is **canned scenarios**, auto-approved. Live data needs contracting. |
| **Change / Optum, Eligible, etc.** | Same 270/271 idea | Sales / enrollment; not a weekend integration. |
| **CMS Patient Access / SMART on FHIR** | Patient OAuths into *their* payer | Correct long-term consumer path; per-payer apps; bad demo. |
| **CareLoop mock** (`MockEligibility.check`) | Map dropdown payer (+ optional member ID) → fixture: active, network, copay/deductible/OOP | **This is the judged path.** Label the UI as mock. |

**Dave implements:** `MockEligibility.check(profile)` always, as fallback. If `STEDI_API_KEY` is a **test** key in local `.env` **and** the profile matches a Stedi canned subscriber (Aetna Jane Doe / `AETNA12345` / `2004-04-04` / payerId `60054`), call Stedi’s `POST …/2026-06-01/eligibility-check` (`Authorization: Key …`) and flatten 271 benefits onto the coverage card. Ignore raw `x12`. If it does not match or the key is missing, fall back to the fixture and say so. Do **not** send real card PHI to a production eligibility endpoint. Do **not** commit the key or paste it in chat — only local `.env`.

### Visit / cost guess (step 5)

Not a coverage decision and not Sreekar’s SOAP.

1. Combine symptoms + optional prior-visit extract (problems, last visit date, meds mentioned).
2. Map to 1–3 **likely visit types** from a fixture (e.g. established PCP 99213–99214, new patient, endocrinology follow-up) — tagged `[NEEDS VERIFICATION]` if inferred.
3. Apply mock plan: copay vs coinsurance, deductible remaining, allowed-amount fixture → **patient-owed range**.
4. Copy must say this is a **guess**, not a bill and not a guarantee the visit is covered.

### Inherited original workstreams

- From **D — Mock payer**: mock **eligibility** (active, in-network, estimated copay) — **assigned to Dave**; Sreekar keeps the PA denial/policy half of D.
- From **greenfield**: mock eligibility row — **assigned to Dave**.
- **Added:** card OCR/scan, manual payer/card inputs, optional HITL, clinician finder UI/API, copay/deductible/OOP panel, reason-for-visit + prior-visit uploads, visit/cost guess, Coverage object, coverage facts on History.

### Files (proposed)

- `backend/careloop/eligibility.py` or `backend/careloop/coverage.py` (scan/extract, mock eligibility, visit/cost guess)
- `backend/data/mock_insurance_card.json` / `backend/data/mock_network.json` / `backend/data/mock_fee_schedule.json` (fixtures)
- Payer dropdown source: small list in `backend/data/mock_payers.json` (Aetna, UHC, Cigna, BCBS, Mock Payer, Medicare — names only)
- Coverage fields on the store (Vivek owns store shape; Dave proposes Coverage contract, including `symptoms`, `prior_visit_notes`, `visit_cost_estimate`)
- Journey **coverage / card / network / intake** panels consumed via `frontend/js/api.js` named methods (Vivek wires CareLoop chrome)

Do **not** reimplement PA letters or decide coverage. Surface mocked benefits and labeled estimates only.

### Done when

- Demo can start from **payer dropdown alone**, from **typed card fields**, or from a **card scan / fixture card**, and show member/plan fields without a live payer.
- Optional supporting SBC/EOB improves the coverage overview when present; fixture fills gaps.
- Optional confirm/edit of extracted fields; user can skip HITL.
- Mock eligibility: **active**, **in-network** flag, **estimated copay** (original D DoD fragment).
- Optional: deductible remaining / OOP max display from the same mock plan.
- Reason-for-visit text + optional prior-visit PDF/image persist on the thread (not a second SOAP).
- Visit/cost guess returns likely visit types + patient-owed range, labeled as an estimate.
- Mock **in-network clinicians** list filtered by ZIP/distance; golden-path PCP can be chosen from (or is preselected).
- Coverage object is written to the thread (not local-only UI state) so timeline/history can read it.
- Coverage snapshot is included in History facts for the next visit.
- No production eligibility/benefits API on the golden path. Stedi/Availity only as an explicit optional sandbox adapter.

### Copy-pasteable commands (Dave)

Same env/run as everyone (one uvicorn process):

```bash
cp .env.example .env
echo "GEMINI_API_KEY=your_key_here" > .env   # free: https://aistudio.google.com/apikey
pip3 install -r requirements.txt
python3 -m uvicorn backend.main:app --reload --port 8080
```

Open **http://localhost:8080**. Gemini key is **not** required for mocked coverage/card/network (fixture + manual entry). It **is** required for live card/SBC/prior-visit extraction.

Isolate by curling coverage endpoints (once added); skip scribe/PA UI.

```bash
# Suggested (implement against the shared contract; names can match this sketch)
curl -s -X POST http://localhost:8080/api/careloop/coverage/scan \
  -H "Content-Type: application/json" \
  -d '{"image_note":"fixture:front-of-card"}'

# Manual identity (dropdown is the minimum)
curl -s -X POST http://localhost:8080/api/careloop/coverage \
  -H "Content-Type: application/json" \
  -d '{"payer_name":"Mock Payer","member_id":"M-1001","zip":"94110"}'

curl -s -X POST http://localhost:8080/api/careloop/coverage/confirm \
  -H "Content-Type: application/json" \
  -d '{"payer_name":"Mock Payer","member_id":"M-1001"}'

curl -s -X POST http://localhost:8080/api/careloop/coverage/visit-guess \
  -H "Content-Type: application/json" \
  -d '{"symptoms":"follow-up type 2 diabetes, A1c check","payer_name":"Mock Payer"}'

curl -s http://localhost:8080/api/careloop/coverage
curl -s "http://localhost:8080/api/careloop/network?specialty=pcp&zip=94110"
```

Until those exist, use `GET /api/careloop/thread` (Vivek) and read `coverage` once seeded.

### Dependencies on the other two

- **Vivek:** Coverage/History live on the thread store; Dave does not invent a second source of truth. Patient-facing coverage panel, intake form, and “who to see” screens are Vivek’s UX; Dave supplies APIs + fixtures.
- **Sreekar:** PA submit needs eligibility/in-network/copay context on the thread. Sreekar’s mock **payer** (step-therapy) is **not** Dave’s job; do not collapse eligibility with PA denial. Prior-visit uploads are **intake context** for Dave’s cost guess; Sreekar still owns SOAP/Plan when the visit starts — reuse those notes, do not duplicate a scribe.

---

## Sreekar — visit start through clinical/admin chain

Everything after the visit starts: transcribe → SOAP/Plan → medicines, tests, follow-up, and the insurance **authorization / appeal / claim** chain that DenialShield already seeds. Keep DenialShield PA / parse / appeal / HITL / watermark work here.

### Scope

- First visit → transcribing → doctor medicines, tests, follow-up.
- Original **A, C, D (payer/PA half), E**, plus **light claims/EOB** and **follow-up** objects.
- **History fact capture (clinical/admin):** encounter, orders, authorization, claim, medication, follow-up facts written to the thread for Vivek to share (**assigned**; not a footnote).

### Inherited original workstreams

#### A — Authorization core

**Owner files:** `backend/main.py` (existing generate/parse/risk/code routes), `backend/llm.py`, `backend/prompts.py`, `backend/risk_engine.py`, `backend/config.py`, `backend/data/*.json`, `frontend/js/provider.js`, `frontend/js/patient.js`, HITL in `frontend/js/app.js`.

**Job:** Keep PA generate, denial parse, appeal, demand letter, risk score, code search. Preserve watermark + HITL. Do **not** add more letter types. CareLoop journey should **call these APIs** (or thin wrappers) rather than reimplement LLM letters.

**Done when:**

- Existing Provider/Patient tabs still work end-to-end.
- All free-text drafts still watermarked; downloads still HITL-gated.
- Journey can pass encounter-derived context into existing generate/parse/appeal endpoints.
- PA denial and claim-file/claim-denial paths stay conceptually separate (demand letter is claim-file access, not a PA appeal).

#### C — Scribe / SOAP / structured Plan

**Owner files (proposed):** `backend/careloop/scribe.py`, seed SOAP in seed fixture, encounter step markup (Vivek owns CareLoop chrome; Sreekar owns encounter/scribe behavior). Original note also listed `frontend/js/careloop.js` (encounter step only) + markup in `frontend/index.html` — **assigned:** implement encounter/scribe logic; coordinate DOM with Vivek so F is not forked.

**Job:** Seeded mock PCP encounter is **explicitly OK**. Optional: paste/play mock transcript → SOAP + Plan. Clinician review gate before Plan becomes orders. Extract: HbA1c, continue metformin, PA-required add-on Rx, follow-up.

**Done when:**

- Demo can show SOAP + structured Plan without a live mic.
- Plan items become Orders in the thread after clinician “I’ve reviewed”.
- Model does not auto-finalize diagnosis or therapy; review is required.

#### D — Mock payer + step-therapy denial + policy-to-evidence

**Owner files (proposed):** `backend/careloop/payer.py`, `backend/data/mock_payer_policy.json` (citable policy text), match helper used by journey UI.

**Job:** Mock payer **always denies the first PA once** on **step therapy**, with **citable policy text**. Match each criterion to encounter evidence (e.g. “failure of preferred first-line therapy” vs metformin trial dates + HbA1c). Then reuse stream A to draft appeal. Second submit/appeal path **approves** so the demo continues. Do not use the LLM to decide coverage.

**Eligibility fragment of original D** (active, in-network, estimated copay) is **assigned to Dave**, not dropped.

**Done when:**

- First PA submit → deterministic step-therapy denial every time.
- UI shows policy quotes + evidence checklist (met / missing / `[NEEDS VERIFICATION]`).
- Appeal uses watermarked `generate-appeal` (or equivalent `generate()`) + HITL.
- Claim submit is a **different** action with different status (even if mocked lightly).

#### E — Med adherence + refill

**Owner files (proposed):** medication fields in the store; med panel in the CareLoop UI (coordinate with Vivek).

**Job:** After mock PA approval + dispense, schedule doses. Mark taken/missed. Remaining supply + refill nudge. Intentionally simple.

**Done when:**

- Dispense creates a schedule from the Rx order.
- Taken/missed updates streak / % and timeline events.
- Refill nudge when days-supply is low.
- No real pharmacy or eRx.

#### Claims / EOB light + follow-up (original greenfield + golden path; assigned here)

- Light mock **Claim** + EOB; optional claim denial/correction; reuse demand letter from A for claim-file access.
- **Follow-up** summary: symptoms, labs, adherence, insurance status, next encounter.
- Persist these as History facts (Sreekar writes; Vivek presents share/export).

**Done when:** judges can see two insurance moments (PA vs claim); follow-up exists on the thread; facts are available for next-visit share.

### Copy-pasteable commands (Sreekar)

### Env setup

```bash
cp .env.example .env
echo "GEMINI_API_KEY=your_key_here" > .env   # free: https://aistudio.google.com/apikey
```

Optional Groq fallback (used by `backend/llm.py` if Gemini fails): add `GROQ_API_KEY` to `.env` if you have one. Not required if Gemini works.

### Install and run (serves API + frontend)

```bash
pip3 install -r requirements.txt
python3 -m uvicorn backend.main:app --reload --port 8080
```

Open **http://localhost:8080**

There is **no** test suite, linter, or frontend build.

### Useful curls (existing Authorization core)

```bash
# Code search
curl -s "http://localhost:8080/api/codes/icd10?q=diabetes"
curl -s "http://localhost:8080/api/codes/cpt?q=83036"

# Risk score
curl -s -X POST http://localhost:8080/api/risk-score \
  -H "Content-Type: application/json" \
  -d '{"icd10_code":"E11.9","cpt_code":"83036","has_prior_auth":false,"has_clinical_notes":true,"is_emergency":false}'

# National stats (no LLM)
curl -s http://localhost:8080/api/national-stats

# PA / parse / appeal / demand need GEMINI_API_KEY (500 if missing/placeholder)
curl -s -X POST http://localhost:8080/api/generate-pa \
  -H "Content-Type: application/json" \
  -d '{"icd10_code":"E11.9","icd10_description":"Type 2 diabetes mellitus without complications","cpt_code":"J3490","cpt_description":"Unclassified drugs","clinical_context":"On metformin 1000mg BID 12 months; HbA1c 9.1%. Requesting GLP-1.","urgency":"standard","patient_age":54,"patient_sex":"Female"}'

curl -s -X POST http://localhost:8080/api/parse-denial \
  -H "Content-Type: application/json" \
  -d '{"denial_text":"PA denied. Step therapy: preferred metformin trial not documented. Member Maya Chen. Ref PA-1001."}'

curl -s -X POST http://localhost:8080/api/generate-appeal \
  -H "Content-Type: application/json" \
  -d '{"denial_text":"...","patient_name":"Maya Chen","claim_number":"","additional_context":"Metformin 12 months; HbA1c 9.1% from encounter."}'

curl -s -X POST http://localhost:8080/api/generate-demand \
  -H "Content-Type: application/json" \
  -d '{"patient_name":"Maya Chen","claim_number":"CLM-9001","insurance_company":"Mock Payer","date_of_denial":"2026-09-20","denied_service":"Office visit E&M"}'
```

### How to run only a workstream (Sreekar’s slices)

One process: `uvicorn backend.main:app`. Isolate by **not calling other modules**, not by a second server.

| Stream | How to work in isolation |
|--------|---------------------------|
| **A Authorization** | Run server; use Provider/Patient tabs + curls above. Avoid new CareLoop files except API wrappers. |
| **C Scribe** | Depend on B seed; curl SOAP/plan; postpone timeline polish. |
| **D Mock payer** | Curl submit-PA → expect same step-therapy body every time; then match endpoint. |
| **E Meds** | After a fixture with `dispensed` status; curl taken/missed. |

### Dependencies on the other two

- **Vivek (B/F):** persist through the store, not local-only UI state. Timeline lists Sreekar’s events. Encounter/med/PA screens live in CareLoop chrome Vivek owns.
- **Dave:** read Coverage / network / copay from the thread before PA; do not mock a second eligibility truth. History coverage facts are Dave’s; Sreekar does not drop them from the packet — they appear alongside clinical facts Vivek exports.

---

## Vivek — patient-facing workflow first, then Dribbble polish

Own the **CareLoop journey UI** and the **longitudinal thread as the app shell**. Workflow first (basic, readable: what happened / waiting / who acts). Visual polish using **Dribbble for design ideas** comes **after** the basic patient-facing flow works. Do **not** treat Provider/Patient tabs as the CareLoop UX.

### Scope

- Patient-facing app workflow (basic) walking the golden path.
- Unified timeline UX; orchestration of steps so Dave’s and Sreekar’s APIs show as one story.
- SQLite **or** in-memory longitudinal thread (original **B**) if that is the workflow backbone — **it is**; Vivek owns store + seed/reset.
- **History share/export/history thread** (patient can hand the next doctor a packet): **first-class**, not a footnote.
- Later: Dribbble-informed visual polish (layout, type, color, empty states) without changing safety rails or object contracts.

### Inherited original workstreams

#### B — Longitudinal thread model

**Owner files (proposed):** `backend/careloop/store.py` (or `backend/store.py`), seed fixture e.g. `backend/careloop/seed.py` / `backend/data/careloop_seed.json`, thread GET/POST routes in `main.py` or `backend/careloop/routes.py`.

**Job:** One SQLite **or** in-memory patient thread so the UI can answer: **what happened, what is waiting, who needs to act.** Objects: see **Shared/integration contract** (now includes Coverage + History).

**Done when:**

- Reset/seed endpoint recreates the golden-path patient.
- Other streams persist through this store (not local-only UI state for the demo thread).
- Timeline can list events from the thread without inventing a second source of truth.

**Suggested contract (sketch, not frozen):** `GET /api/careloop/thread`, `POST /api/careloop/reset`, plus per-object actions owned by later streams.

#### F — Unified timeline UX (CareLoop journey)

**Owner files:** `frontend/index.html` (new nav + journey view), `frontend/css/style.css`, `frontend/js/app.js` (third module tab), `frontend/js/careloop.js`, `frontend/js/api.js` (named CareLoop methods).

**Job:** New **CareLoop** journey UI. **Do not treat Provider/Patient tabs as CareLoop.** Timeline joins encounter, orders, PA, **claim**, meds, follow-up, **coverage**, **history**. Every screen: what happened / what’s waiting / who acts / what evidence.

**Done when:**

- Third tab (or equivalent) walks the golden path without using Provider/Patient as the demo.
- Provider + Patient tabs still reachable.
- No download of generated letters without HITL.
- Browser-verifiable end-to-end golden path (not a single screenshot).

#### History share / export (new, first-class; Vivek’s patient-facing half)

**Job:** A dedicated history thread / export the patient can share at the **next doctor visit** (print/PDF/markdown/JSON fixture is fine). Reads facts Dave and Sreekar already persisted; does not invent clinical or coverage data.

**Done when:**

- After the golden path (or from seed), patient can view a chronological history packet: coverage, encounter, orders, auth, meds, claim, follow-up.
- Share/export does not bypass HITL for generated **letters**; history packet is a patient record view, not a new unsigned appeal download.
- Next-visit demo beat: “here is what happened last time” from the same thread.

#### Dribbble polish (later)

After the basic workflow is demoable: visual pass inspired by Dribbble (healthcare/patient-app references). Polish must not hide watermarks, skip HITL, or collapse PA vs claim.

### Copy-pasteable commands (Vivek)

```bash
cp .env.example .env
echo "GEMINI_API_KEY=your_key_here" > .env   # free: https://aistudio.google.com/apikey
pip3 install -r requirements.txt
python3 -m uvicorn backend.main:app --reload --port 8080
```

Open **http://localhost:8080**. Gemini is only needed when exercising Sreekar’s letter endpoints from the journey.

| Stream | How to work in isolation |
|--------|---------------------------|
| **B Store** | Add store + `reset`/`thread` endpoints; curl JSON only; skip UI. |
| **F Timeline** | Mock `GET /api/careloop/thread` with a static fixture until B lands; then switch to live thread. |
| **History export** | Curl thread/history JSON; postpone Dribbble polish. |

```bash
curl -s -X POST http://localhost:8080/api/careloop/reset
curl -s http://localhost:8080/api/careloop/thread
# History share (sketch)
curl -s http://localhost:8080/api/careloop/history
```

### Dependencies on the other two

- **Dave:** coverage/card/network/cost APIs + Coverage facts (including intake symptoms and visit/cost guess). Vivek does not fake a second eligibility model once Dave lands.
- **Sreekar:** encounter/orders/auth/meds/claim/follow-up events + letter APIs. Journey **calls** existing generate/parse/appeal; no new letter types. HITL stays in `app.js`.

---

## Shared / integration contract

Freeze shapes early so the three owners can work in parallel. Frontend talks only through named methods in `frontend/js/api.js`. One app: `backend/main.py` or imported `backend/careloop/` — do not fork a second server.

**Suggested contract (sketch, not frozen):** `GET /api/careloop/thread`, `POST /api/careloop/reset`, plus per-object actions owned by each person.

| Object | Contains (min) | Writes facts | Patient-facing surface |
|--------|----------------|--------------|------------------------|
| **Patient** | Identity, mock plan, conditions, allergies, current meds | Vivek seed; Dave may attach plan IDs | Vivek |
| **Encounter** | Transcript/SOAP, assessment, Plan, clinician-reviewed flag | Sreekar (C) | Vivek timeline |
| **Orders** | Labs, Rx, imaging/referral stubs; PA-required flag | Sreekar (C) | Vivek |
| **Authorization** | Requirement, submission, status, denial reason, evidence, appeal | Sreekar (A/D) | Vivek |
| **Claim** | Codes, amounts, adjudication/EOB, patient responsibility, **separate** denial | Sreekar | Vivek |
| **Medication** | Rx, schedule, taken/missed, remaining supply, refill | Sreekar (E) | Vivek |
| **Follow-up** | Symptoms, labs, adherence, insurance status, next encounter | Sreekar | Vivek |
| **Coverage** | Payer dropdown, optional card/OCR + SBC fields, eligibility, network, copay/deductible/OOP, symptoms/prior-visit notes, visit/cost guess | **Dave (added)** | Vivek pre-visit panel |
| **History** | Ordered packet of the above facts for **next visit share/export** | Capture: Dave (coverage) + Sreekar (clinical/admin). Assemble/export UX: **Vivek** | Vivek share/export |

History is not a second database: it is a **view + export** over the thread, plus whatever snapshot fields writers persist so the next visit still has last time’s evidence.

---

## Suggested order / dependencies

Original graph (preserved), with owners labeled:

```
B store (Vivek)  ─────────────────────────────────────►  F timeline UX (Vivek)
   │                                                      ▲
   ├── C scribe / SOAP / Plan (Sreekar) ──► orders ───────┤
   │                                                      │
   ├── D mock payer + policy-evidence (Sreekar) ──► auth ─┤
   │         ▲                                            │
   │         └── A authorization APIs (Sreekar)           │
   │             (letters, parse, risk, HITL)             │
   │             — can start in parallel                  │
   │                                                      │
   ├── Dave coverage/card/network (parallel with A;       │
   │         needed before PA submit uses eligibility) ───┤
   │                                                      │
   ├── E meds (Sreekar; needs D approve + dispense,       │
   │         or seed) ────────────────────────────────────┤
   │                                                      │
   └── History packet (Vivek assemble; facts from         ┘
           Dave + Sreekar) + Dribbble polish last
```

1. **B first** (or a frozen JSON schema) so C/D/E/F/Dave/history do not invent incompatible objects. **Vivek.**
2. **A in parallel** from day one (protect existing endpoints; add CareLoop-shaped wrappers). **Sreekar.**
3. **Dave coverage/card/network in parallel** with A (dropdown + fixtures OK); bind to B when store exists. Live 270/271 is optional sandbox only.
4. **C then D** for the insurance half of the golden path (orders must exist before PA submit). **Sreekar.** Eligibility must be on the thread before PA (Dave or seed).
5. **E after** mock approve + dispense (or a seeded “already dispensed” state). **Sreekar.**
6. **F can prototype** against a static thread, then bind to B. **Vivek.**
7. **History share/export** as soon as thread objects exist; treat as a demo beat, not a leftover.
8. **Dribbble visual polish last** (Vivek), after the basic patient workflow is walkable.

Integration demo order: seed/reset → (payer dropdown / card / coverage confirm / symptoms / visit-cost guess / network) → encounter review → orders → PA submit → deny → match → appeal (HITL) → approve → dispense → taken → refill nudge → follow-up → **share history for next visit**; **separately** submit/show a claim (and optional claim denial) so PA and claim stay distinct.

### Git / PR conventions

- Branch from latest `main`: `git fetch origin main && git checkout -b <your-stream>/<short-name>`
- One workstream per PR when possible; stream B first if you need persistence.
- Do not edit Cursor plan files under `/opt/cursor/artifacts/plans/`.
- Preserve CLAUDE.md safety invariants; do not add download paths that skip HITL.
- PR description: stream letter (A–F) **and/or owner name**, files, how to demo, what you did **not** collapse (PA vs claim). Call out History if you touch capture or export.
- Rebase/merge `main` before review if other streams landed the store contract.

```bash
git fetch origin main
git checkout -b stream-b/longitudinal-store
# ... commit ...
git push -u origin stream-b/longitudinal-store
```

---

## Out of scope

- Live payer / PBM PA APIs, real eligibility/benefits, e-prescribe, claims adjudication networks, EHR/FHIR write-back
- Production HIPAA program (auth, audit logs, BAA, encryption-at-rest as a platform), multi-tenant accounts
- Multi-plan / multi-state policy knowledge base as verified legal source
- High-quality ambient clinical scribe without a heavy clinician review burden
- Expanding DenialShield sideways into more letter types instead of the journey
- Treating Provider/Patient tabs as the CareLoop product UX
- Letting the model make coverage or clinical decisions
- Collapsing PA denial and claim denial into one flow

(Card scan and Stedi/Availity **sandboxes** may be used; neither is a live eligibility check of an arbitrary uploaded card. Production 270/271 stays out of the golden path.)

---

## Pointers

- Runbook: `README.md`, `CLAUDE.md`
- Existing app: `backend/main.py`, `frontend/index.html`
- This plan only; implementation is follow-on PRs per owner / original workstream.
- Dribbble is a **reference for later polish**, not a requirement to clone a shot in the first workflow PR.
