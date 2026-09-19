# CareLoop

Hackathon product: **one mocked US patient journey** so context survives coverage → visit → orders → prior auth → delivery → claim → meds → follow-up → **shareable history for the next visit**.

It is **not** a real payer, PBM, EHR, or claims platform. Mock “submit” is local demo state. Drafts are for a human to review; the app never files, faxes, e-prescribes, or calls a live insurer.

The code in this repo today is **DenialShield**: FastAPI + vanilla JS tools for drafting PA packets and appeal letters. CareLoop wraps that authorization seed in a golden-path thread.

**Who builds what:** **Dave** (payer dropdown + optional card/SBC → mock coverage, visit/cost guess, in-network clinicians), **Sreekar** (visit → scribe → orders → PA/appeal/meds/claims/follow-up), **Vivek** (patient-facing workflow first, longitudinal thread, history share/export, **Dribbble polish later**). Full split, DoD, curls, and object contract: **[`plan.md`](plan.md)**.

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

Provider / Patient Advocate tabs **stay**. They are **not** the CareLoop UX.

### Greenfield (three owners; original A–F still apply)

See [`plan.md`](plan.md) for inherited A–F mapping.

| Owner | Builds |
|--------|--------|
| **Dave** | Payer **dropdown** (required) + optional typed card fields / card scan / SBC-EOB → mock coverage confirmation; symptoms + optional prior-visit PDF; visit/cost **guess**; in-network clinicians by ZIP; Coverage facts for history |
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
| Frontend | Vanilla HTML/CSS/JS (`frontend/`) |
| Data today | Embedded JSON (ICD-10, CPT, CARC/RARC) |

**Request flow (letters):** Pydantic model in `main.py` → user-message string → `backend/llm.py` `generate()` / `generate_json()` → system prompt from `backend/prompts.py`. New CareLoop routes stay on this app (`main.py` or an imported `backend/careloop/` package). Do not fork a second server. Frontend talks only through named methods in `frontend/js/api.js`.

```
.
├── plan.md                 # Owner split (Dave / Sreekar / Vivek) + A–F; source of truth for *what to build*
├── CLAUDE.md               # Agent/dev invariants (watermark, HITL, file roles)
├── backend/
│   ├── main.py             # All routes; mounts static; serves index.html
│   ├── config.py           # Keys, model names, DRAFT_WATERMARK, national stats
│   ├── llm.py              # Gemini + optional Groq; watermark on generate()
│   ├── prompts.py          # PA, appeal, demand, denial-parse (zero-hallucination)
│   ├── risk_engine.py      # Deterministic heuristic scorer (no LLM)
│   └── data/               # icd10_codes.json, cpt_codes.json, denial_reasons.json
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── api.js          # Named fetch methods per endpoint
│       ├── app.js          # Tabs, toast, HITL modal, download
│       ├── provider.js     # Provider module
│       └── patient.js      # Patient advocate module
├── requirements.txt
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
echo "GEMINI_API_KEY=your_key_here" > .env   # free: https://aistudio.google.com/apikey
```

Optional Groq fallback (used by `backend/llm.py` if Gemini fails): add `GROQ_API_KEY` to `.env`. Not required if Gemini works.

### 3. Install and run (API + frontend, one process)

```bash
pip3 install -r requirements.txt
python3 -m uvicorn backend.main:app --reload --port 8080
```

Open **http://localhost:8080**

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
| **Dave** | Eligibility/network/copay from **D**; **added** card scan + manual payer inputs, optional HITL, clinician finder, cost-share UI, reason-for-visit, visit/cost guess, Coverage | Curl coverage/network once added; fixtures + dropdown OK; no live 270/271 on the golden path |
| **Sreekar** | **A** Authorization, **C** scribe, **D** mock payer (PA half), **E** meds; claims + follow-up assigned here | Provider/Patient tabs + letter curls; then payer/meds curls |
| **Vivek** | **B** store, **F** timeline; **added** history share/export; Dribbble later | Curl `thread`/`reset`; static fixture until B lands |

**Suggested order:** B first (or a frozen JSON schema) → A **and** Dave coverage in parallel → C then D for the insurance half → E after approve/dispense (or a seeded dispensed state) → F can prototype against a static thread, then bind to B → history share as a demo beat → Dribbble polish last.

**PR conventions:** one workstream per PR when possible; branch from latest `main`; describe stream letter (A–F) and/or owner, how to demo, and that PA vs claim were **not** collapsed. Details in [`plan.md`](plan.md).
