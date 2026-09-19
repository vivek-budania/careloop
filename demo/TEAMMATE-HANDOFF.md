# Sreekar demo — CareLoop Stream C (latest)

## Login (mock auth)
Password for **every** account is: **`demo`**

| Username | Who |
|----------|-----|
| `priya` | Dr. Priya Shah (clinician) — best for scribe demo |
| `demo` | Hackathon Demo |
| `maya` | Maya Chen (patient) |
| `advocate` | Alex Rivera |

## What this video shows
1. Login as clinician
2. Jump to CareLoop **step 7** (Visit transcript) — after Dave’s coverage steps 1–6
3. **Grok speech-to-text** on visit audio (`grok-voice-transcribe-2.0`)
4. Draft SOAP + Plan (seeded golden path)
5. Clinician **I've Reviewed** → Orders (GLP-1 marked PA required)

## Files / PR
- PR: https://github.com/vivek-budania/careloop/pull/6
- Video: `demo/sreekar-scribe-demo.webm`
- Sample audio: `demo/sample-visit.wav`
- STT sample output: `demo/stt-result.json`

## Run locally
```bash
python3 -m uvicorn backend.main:app --reload --port 8080
# open http://localhost:8080
# login: priya / demo
```

Vivek’s phone mockups (design only): http://localhost:8080/mockups/
