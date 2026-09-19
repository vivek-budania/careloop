# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DenialShield — an AI-powered tool that helps doctors draft prior authorization (PA) requests and helps patients fight insurance denials. FastAPI backend + vanilla JS/HTML/CSS frontend, served as a single app (no separate frontend build/dev server).

## Commands

```bash
# Setup
cp .env.example .env
echo "GEMINI_API_KEY=your_key_here" > .env   # free key: https://aistudio.google.com/apikey
pip3 install -r requirements.txt

# Run (serves both API and frontend at http://localhost:8080)
python3 -m uvicorn backend.main:app --reload --port 8080
```

There is no test suite, linter, or build step configured in this repo.

## Architecture

**Backend** (`backend/`) is a single FastAPI app (`main.py`) — no routers/blueprints, all endpoints defined directly on `app`. It also mounts `frontend/css` and `frontend/js` as static dirs and serves `frontend/index.html` at `/`.

Request flow for all AI-generated documents (PA letters, appeals, demand letters, denial parsing) follows the same shape: Pydantic request model in `main.py` → builds a user-message string from the request fields → `backend/llm.py`'s `generate()`/`generate_json()` → wraps `google-generativeai` (Gemini) with the corresponding system prompt from `backend/prompts.py`.

- `backend/config.py` — loads `GEMINI_API_KEY` from `.env`, defines the model name (`gemini-2.0-flash`) and the `DRAFT_WATERMARK` string stamped onto every generated document.
- `backend/llm.py` — `generate()` (temp 0.3, prepends/appends the watermark) for free-text letters; `generate_json()` (temp 0.1, `response_mime_type="application/json"`, no watermark) for structured extraction (denial letter parsing). Raises `ValueError` if `GEMINI_API_KEY` is missing/placeholder — endpoints catch this and return HTTP 500 with the setup instructions.
- `backend/prompts.py` — one system prompt per document type (`PA_SYSTEM_PROMPT`, `APPEAL_SYSTEM_PROMPT`, `DEMAND_SYSTEM_PROMPT`, `DENIAL_PARSE_PROMPT`). All enforce a **Zero Hallucination Protocol**: never fabricate medical/legal facts, only use user-supplied information, tag uncertain claims with `[NEEDS VERIFICATION]`. When editing generation logic, preserve this pattern — it's the core safety mechanism of the product, and `main.py` surfaces `[NEEDS VERIFICATION]` as a `warnings` entry in the `GeneratedDocument` response.
- `backend/risk_engine.py` — pure deterministic heuristic scorer (no LLM, no ML). `calculate_risk_score()` looks up ICD-10/CPT category risk weights (`HIGH_RISK_CPT_CATEGORIES`, `HIGH_SCRUTINY_ICD_CATEGORIES`, `RISKY_COMBOS`), applies modifiers for prior auth / clinical notes / emergency status, and returns a 0-100 score plus human-readable `factors` and `recommendations`. Category names here must stay in sync with the `category` field values in `backend/data/*.json`.
- `backend/data/*.json` — embedded reference data (ICD-10 codes, CPT/HCPCS codes, CARC/RARC denial reason codes). Loaded fresh from disk on every request (`_load_json`/`_load_*_codes`), not cached — this is a deliberate MVP simplicity tradeoff given the small dataset size.

**Frontend** (`frontend/`) is a single-page vanilla JS app with no framework/bundler — files are loaded directly as `<script>` tags.

- `js/api.js` — `API` object: single fetch wrapper (`request()`) plus one named method per backend endpoint. Any new backend endpoint should get a corresponding method here rather than calling `fetch` directly from feature code.
- `js/app.js` — `App` object: tab navigation between the Provider/Patient modules, toast notifications, and the **HITL (human-in-the-loop) approval modal** (`requestApproval()` returns a `Promise<boolean>`). Every generated document must route through `App.requestApproval()` before `App.downloadDocument()` — this is the enforced "I've Reviewed — Approve" gate; do not add a download path that bypasses it.
- `js/provider.js` / `js/patient.js` — the two modules (`Provider`, `Patient` objects), each self-contained with its own `init()`, called from `app.js`'s `DOMContentLoaded` handler. Provider handles ICD-10/CPT autocomplete (debounced search against `/api/codes/*`) + risk scoring + PA generation. Patient handles denial letter parsing + appeal/demand letter generation.

## Safety invariants

This is a healthcare-adjacent tool generating documents intended for real insurance submissions. Two invariants are load-bearing and should be preserved in any change to generation logic:

1. **Watermarking** — every free-text generated document (PA, appeal, demand) is wrapped in `DRAFT_WATERMARK` by `llm.py`'s `generate()`. Don't add a code path that returns LLM output without it.
2. **Human-in-the-loop** — the frontend never lets a user download a generated document without passing through the HITL approval modal first.
