# CareLoop hackathon plan

Teammate split for wrapping DenialShield in a **mocked golden-path journey**. The product is the flow, not another letter type. This file is the working plan; keep `README.md` / `CLAUDE.md` as the source of truth for setup commands.

**Scope:** one scripted patient thread (PCP visit → SOAP/Plan → HbA1c + Rx → PA required → mock payer step-therapy denial → policy-to-evidence → appeal → approve → dispense → taken/missed + refill nudge → follow-up summary). Mock eligibility and payer. No real payer/EHR/eRx/claims APIs.

---

## 1. Product thesis and safety rails

### Thesis

US care is a chain of handoffs (symptoms → visit → encounter → orders → coverage → care → claim → follow-up). Point tools optimize one moment. CareLoop’s gap is **one patient, one data thread**: context from the encounter survives PA, delivery, claims, meds, and the next visit.

Go deepest on **scribe + policy/evidence appeal**. Mock the payer. Keep reminders simple. The **integrated journey** is the demo, not production reimbursement.

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

---

## 2. Current repo vs target

DenialShield today is a FastAPI + vanilla JS SPA (no frontend build). Two **disconnected** form modules. Stateless. No DB.

### Already exists (keep; reuse as Authorization seed)

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

### Greenfield (build)

| Gap | Notes |
|-----|--------|
| Longitudinal store | Patient, Encounter, Orders, Authorization, Claim, Medication, Follow-up — SQLite or in-memory, one thread |
| Scribe / SOAP / structured Plan | Seeded mock encounter is enough; optional transcript → SOAP |
| Orders extracted from Plan | Lab, Rx, PA-required flag |
| Mock eligibility + mock payer | Deterministic **once** step-therapy PA denial + citable policy text |
| Policy-to-evidence match | Encounter as evidence source; checklist vs policy criteria |
| Med schedule / taken / missed / refill | Simple; not a full pharmacy system |
| Unified timeline UX | **New CareLoop journey UI**; old tabs remain |
| Distinct claim flow | Light mock claim + EOB; not the same as PA denial |

Local code sets are tiny (~91 ICD / ~76 CPT). No test suite, linter, or build step.

### Golden path (demo script)

PCP visit → clinician-reviewed SOAP + Plan → HbA1c (no PA) + Rx (PA required) → submit mock PA → **step-therapy denial** with citable policy → match policy to encounter evidence → appeal (HITL + watermark) → mock approve → dispense → mark dose taken/missed + refill nudge → unified timeline / follow-up summary. Keep a **separate** claim (and optional claim denial/correction) so judges see two insurance moments.

---

## 3. Workstreams (pick up in parallel)

Coordinate on **object shapes** first (stream B). Frontend talks only through named methods in `frontend/js/api.js` (do not `fetch` from feature files). New CareLoop routes can live in `backend/main.py` or a clearly imported `backend/careloop/` package mounted from `main.py` — do not fork a second app.

### A — Authorization core

**Owner files:** `backend/main.py` (existing generate/parse/risk/code routes), `backend/llm.py`, `backend/prompts.py`, `backend/risk_engine.py`, `backend/config.py`, `backend/data/*.json`, `frontend/js/provider.js`, `frontend/js/patient.js`, HITL in `frontend/js/app.js`.

**Job:** Keep PA generate, denial parse, appeal, demand letter, risk score, code search. Preserve watermark + HITL. Do **not** add more letter types. CareLoop journey should **call these APIs** (or thin wrappers) rather than reimplement LLM letters.

**Done when:**

- Existing Provider/Patient tabs still work end-to-end.
- All free-text drafts still watermarked; downloads still HITL-gated.
- Journey can pass encounter-derived context into existing generate/parse/appeal endpoints.
- PA denial and claim-file/claim-denial paths stay conceptually separate (demand letter is claim-file access, not a PA appeal).

### B — Longitudinal thread model

**Owner files (proposed):** `backend/careloop/store.py` (or `backend/store.py`), seed fixture e.g. `backend/careloop/seed.py` / `backend/data/careloop_seed.json`, thread GET/POST routes in `main.py` or `backend/careloop/routes.py`.

**Job:** One SQLite **or** in-memory patient thread so the UI can answer: **what happened, what is waiting, who needs to act.** Objects:

| Object | Contains (min) |
|--------|----------------|
| Patient | Identity, mock plan, conditions, allergies, current meds |
| Encounter | Transcript/SOAP, assessment, Plan, clinician-reviewed flag |
| Orders | Labs, Rx, imaging/referral stubs; PA-required flag |
| Authorization | Requirement, submission, status, denial reason, evidence, appeal |
| Claim | Codes, amounts, adjudication/EOB, patient responsibility, **separate** denial |
| Medication | Rx, schedule, taken/missed, remaining supply, refill |
| Follow-up | Symptoms, labs, adherence, insurance status, next encounter |

**Done when:**

- Reset/seed endpoint recreates the golden-path patient.
- Other streams persist through this store (not local-only UI state for the demo thread).
- Timeline can list events from the thread without inventing a second source of truth.

**Suggested contract (sketch, not frozen):** `GET /api/careloop/thread`, `POST /api/careloop/reset`, plus per-object actions owned by later streams.

### C — Scribe / SOAP / structured Plan

**Owner files (proposed):** `backend/careloop/scribe.py`, seed SOAP in seed fixture, `frontend/js/careloop.js` (encounter step only) + markup in `frontend/index.html`.

**Job:** Seeded mock PCP encounter is **explicitly OK**. Optional: paste/play mock transcript → SOAP + Plan. Clinician review gate before Plan becomes orders. Extract: HbA1c, continue metformin, PA-required add-on Rx, follow-up.

**Done when:**

- Demo can show SOAP + structured Plan without a live mic.
- Plan items become Orders in the thread after clinician “I’ve reviewed”.
- Model does not auto-finalize diagnosis or therapy; review is required.

### D — Mock payer + step-therapy denial + policy-to-evidence

**Owner files (proposed):** `backend/careloop/payer.py`, `backend/data/mock_payer_policy.json` (citable policy text), match helper used by journey UI.

**Job:** Mock eligibility (active, in-network, estimated copay). Mock payer **always denies the first PA once** on **step therapy**, with **citable policy text**. Match each criterion to encounter evidence (e.g. “failure of preferred first-line therapy” vs metformin trial dates + HbA1c). Then reuse stream A to draft appeal. Second submit/appeal path **approves** so the demo continues. Do not use the LLM to decide coverage.

**Done when:**

- First PA submit → deterministic step-therapy denial every time.
- UI shows policy quotes + evidence checklist (met / missing / `[NEEDS VERIFICATION]`).
- Appeal uses watermarked `generate-appeal` (or equivalent `generate()`) + HITL.
- Claim submit is a **different** action with different status (even if mocked lightly).

### E — Med adherence + refill

**Owner files (proposed):** medication fields in the store; `frontend/js/careloop.js` med panel.

**Job:** After mock PA approval + dispense, schedule doses. Mark taken/missed. Remaining supply + refill nudge. Intentionally simple.

**Done when:**

- Dispense creates a schedule from the Rx order.
- Taken/missed updates streak / % and timeline events.
- Refill nudge when days-supply is low.
- No real pharmacy or eRx.

### F — Unified timeline UX (CareLoop journey)

**Owner files:** `frontend/index.html` (new nav + journey view), `frontend/css/style.css`, `frontend/js/app.js` (third module tab), `frontend/js/careloop.js`, `frontend/js/api.js` (named CareLoop methods).

**Job:** New **CareLoop** journey UI. **Do not treat Provider/Patient tabs as CareLoop.** Timeline joins encounter, orders, PA, **claim**, meds, follow-up. Every screen: what happened / what’s waiting / who acts / what evidence.

**Done when:**

- Third tab (or equivalent) walks the golden path without using Provider/Patient as the demo.
- Provider + Patient tabs still reachable.
- No download of generated letters without HITL.
- Browser-verifiable end-to-end golden path (not a single screenshot).

---

## 4. Copy-pasteable commands

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

### How to run only a workstream

One process: `uvicorn backend.main:app`. Isolate by **not calling other modules**, not by a second server.

| Stream | How to work in isolation |
|--------|---------------------------|
| **A Authorization** | Run server; use Provider/Patient tabs + curls above. Avoid new CareLoop files except API wrappers. |
| **B Store** | Add store + `reset`/`thread` endpoints; curl JSON only; skip UI. |
| **C Scribe** | Depend on B seed; curl SOAP/plan; postpone timeline polish. |
| **D Mock payer** | Curl submit-PA → expect same step-therapy body every time; then match endpoint. |
| **E Meds** | After a fixture with `dispensed` status; curl taken/missed. |
| **F Timeline** | Mock `GET /api/careloop/thread` with a static fixture until B lands; then switch to live thread. |

Suggested fixture patient: adult with T2DM, on metformin, elevated HbA1c, PCP visit, GLP-1 or similar **PA-required** Rx, HbA1c lab **no PA**.

### Git / PR conventions

- Branch from latest `main`: `git fetch origin main && git checkout -b <your-stream>/<short-name>`
- One workstream per PR when possible; stream B first if you need persistence.
- Do not edit Cursor plan files under `/opt/cursor/artifacts/plans/`.
- Preserve CLAUDE.md safety invariants; do not add download paths that skip HITL.
- PR description: stream letter (A–F), files, how to demo, what you did **not** collapse (PA vs claim).
- Rebase/merge `main` before review if other streams landed the store contract.

```bash
git fetch origin main
git checkout -b stream-b/longitudinal-store
# ... commit ...
git push -u origin stream-b/longitudinal-store
```

---

## 5. Suggested order / dependencies

```
B store  ────────────────────────────────────────────►  F timeline UX
   │                                                      ▲
   ├── C scribe / SOAP / Plan ──► orders on thread ───────┤
   │                                                      │
   ├── D mock payer + policy-evidence ──► auth events ────┤
   │         ▲                                            │
   │         └── A authorization APIs (letters, parse,    │
   │             risk, HITL)  — can start in parallel     │
   │                                                      │
   └── E meds (needs D approve + dispense, or seed) ──────┘
```

1. **B first** (or a frozen JSON schema) so C/D/E/F do not invent incompatible objects.
2. **A in parallel** from day one (protect existing endpoints; add CareLoop-shaped wrappers).
3. **C then D** for the insurance half of the golden path (orders must exist before PA submit).
4. **E after** mock approve + dispense (or a seeded “already dispensed” state).
5. **F can prototype** against a static thread, then bind to B.

Integration demo order: seed/reset → encounter review → orders → PA submit → deny → match → appeal (HITL) → approve → dispense → taken → refill nudge → follow-up; **separately** submit/show a claim (and optional claim denial) so PA and claim stay distinct.

---

## 6. Out of scope

- Live payer / PBM PA APIs, real eligibility/benefits, e-prescribe, claims adjudication networks, EHR/FHIR write-back
- Production HIPAA program (auth, audit logs, BAA, encryption-at-rest as a platform), multi-tenant accounts
- Multi-plan / multi-state policy knowledge base as verified legal source
- High-quality ambient clinical scribe without a heavy clinician review burden
- Expanding DenialShield sideways into more letter types instead of the journey
- Treating Provider/Patient tabs as the CareLoop product UX
- Letting the model make coverage or clinical decisions
- Collapsing PA denial and claim denial into one flow

---

## Pointers

- Runbook: `README.md`, `CLAUDE.md`
- Existing app: `backend/main.py`, `frontend/index.html`
- This plan only; implementation is follow-on PRs per workstream.
