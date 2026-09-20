# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**CareLoop** is the running web app: a mocked US patient-journey demo (not a real payer/EHR platform). FastAPI + vanilla JS/HTML/CSS, one process. Product story: `/showcase`. Live demo: `/`.

Teammate overview: [`README.md`](README.md). Agent demo notes + **dummy logins**: [`AGENTS.md`](AGENTS.md). Owner split: [`plan.md`](plan.md). Hosted schema: [`docs/database/`](docs/database/README.md) (SQL: [`supabase/`](supabase/README.md)).

**Product UX:** after **LOGIN** (`jane` / `demo`), the patient shell is the app (☰ Today / Past visits / Upcoming visits / Reminders / Prescriptions / Test records / Insurance / Profile). **Start my first visit** is signup → insurance hub. **Insurance Claims Management** is Coming soon on Insurance. There is **no** `/letters` UI. Backend PA/appeal/demand/denial-parse endpoints and `risk_engine.py` still exist.

**Dave’s slice:** login (`jane` / `demo`; see AGENTS.md). Server-side Supabase Auth + `public.profiles` when `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `SESSION_SECRET` are set. Login does not read `visits` / `insurance` (tables documented, not wired). Insurance requires payer + date of birth. Image → JSON and visit STT use `XAI_API_KEY` — no letter watermark on JSON, no invented copays. Coverage is mocked unless `STEDI_API_KEY` is a Stedi *test* key and the member is Jane Doe / AETNA12345. Profile shows whether slots are loaded (no secret values). Visit/cost output is a labeled estimate. Never paste API keys in chat or commit `.env`.

## Commands

```bash
# Setup
cp .env.example .env
# XAI_API_KEY is already on Vercel. Seeded transcript / sample card work without it.
pip3 install -r requirements.txt

# Run (serves API + frontend at http://localhost:8080)
python3 -m uvicorn backend.main:app --reload --port 8080
```

There is no test suite, linter, or build step required to run the demo.

## Architecture

**Backend** (`backend/`) is a single FastAPI app (`main.py`) — endpoints are defined on `app` (CareLoop helpers live in `backend/careloop/`). It mounts `frontend/css`, `frontend/js`, `frontend/images`, and `frontend/mockups`, serves `frontend/index.html` at `/`, and `frontend/showcase.html` at `/showcase`.

Request flow for AI **letter** documents (PA, appeal, demand, denial parse): Pydantic model in `main.py` → user-message string → `backend/llm.py` `generate()` / `generate_json()` → xAI (`XAI_API_KEY`) with system prompts from `backend/prompts.py`. These routes are unused by the patient UI today.

- `backend/config.py` — env slots, model names, `DRAFT_WATERMARK`, `demo_env_status()`.
- `backend/llm.py` — `generate()` (temp 0.3, stamps watermark) for free-text letters; `generate_json()` (temp 0.1, no watermark) for structured extraction. Optional Groq text fallback if xAI is down.
- `backend/prompts.py` — **Zero Hallucination Protocol**: never fabricate medical/legal facts; `[NEEDS VERIFICATION]` on uncertain claims; `main.py` surfaces those as `warnings`.
- `backend/risk_engine.py` — deterministic heuristic scorer (no LLM). Category names must stay in sync with `backend/data/*.json`.
- `backend/data/*.json` — ICD-10, CPT/HCPCS, CARC/RARC, fixtures. Loaded from disk per request (MVP; small files).

**Frontend** (`frontend/`) is a vanilla SPA. Scripts load as `<script>` tags.

- `js/api.js` — `API` object: `request()` plus one named method per endpoint. New endpoints get a method here; do not `fetch` from feature code.
- `js/app.js` — toasts; HITL helpers (`setupHITLModal` / `requestApproval`) no-op without `#hitl-modal` (none on `index.html`). Reuse that pattern if a letter-download UI is added.
- `js/careloop.js` — login, hamburger, visit journey, coverage/history/meds/tests.
- `js/showcase.js` — `/showcase` journey tabs only.

**Database (hosted Supabase, not wired beyond Auth + `profiles`):** [`docs/database/`](docs/database/README.md). Matching SQL: [`supabase/migrations/`](supabase/migrations/). No `login` table. Browser sessions are a signed `HttpOnly` cookie, not a JS-held JWT.

## Safety invariants

Healthcare-adjacent demo. Do not weaken:

1. **Watermarking** — every free-text generated letter (PA, appeal, demand) is wrapped in `DRAFT_WATERMARK` by `llm.py` `generate()`. Don't add a path that returns LLM letter text without it. JSON extract and the history packet are not letters.
2. **Human-in-the-loop** — if a UI can download a generated letter, it must pass `App.requestApproval()` first. There is currently no letter-download page.
3. **No independent clinical/coverage decisions**; do not collapse PA denial vs claim denial; visit/cost output stays a labeled estimate.

Full list: [`README.md`](README.md) (Safety invariants).
