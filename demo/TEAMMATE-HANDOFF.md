# Sreekar demo — CareLoop Stream C (historical)

Notes for the **PR #6** scribe demo video. **Current login and product:** [`README.md`](../README.md) / [`AGENTS.md`](../AGENTS.md). Seeded live user is **`jane` / `demo`**. Other mock usernames (`priya`, `maya`, …) only work on HMAC fallback, not the hosted Supabase project.

## What this video showed

1. Login as clinician (`priya` / `demo` on the then-mock auth)
2. Jump to visit transcript (after coverage steps)
3. **Grok speech-to-text** on visit audio
4. Draft SOAP + Plan (seeded golden path)
5. Clinician review → Orders (GLP-1 marked PA required)

## Files

- PR: https://github.com/vivek-budania/careloop/pull/6
- Video: `demo/sreekar-scribe-demo.webm`
- Sample audio: `demo/sample-visit.wav`
- STT sample output: `demo/stt-result.json`

Scribe in the **current** patient shell lives on visit-day (record / Demo 1–3 → summary), not a second wizard. `frontend/js/scribe.js` is not loaded.

```bash
python3 -m uvicorn backend.main:app --reload --port 8080
# http://localhost:8080  →  jane / demo
# mockups: http://localhost:8080/mockups/
```
