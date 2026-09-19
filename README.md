# DenialShield — Insurance Denial Decoding & Appeal Engine

AI-powered tool to help doctors generate prior authorization requests and help patients fight insurance denials.

## Quick Start

### 1. Get a Free Gemini API Key

Go to [Google AI Studio](https://aistudio.google.com/apikey) → Create API Key. No credit card needed.

### 2. Set Up Environment

```bash
# Copy the env template
cp .env.example .env

# Add your API key
echo "GEMINI_API_KEY=your_key_here" > .env
```

### 3. Install & Run

```bash
pip3 install -r requirements.txt
python3 -m uvicorn backend.main:app --reload --port 8080
```

### 4. Open

Navigate to **http://localhost:8080**

Hackathon split (CareLoop golden-path journey, mocked payer, workstreams, safety rails): see **[plan.md](plan.md)**.

---

## Features

### 👤 Patient Advocate Module (For Patients) — primary flow
- **Denial Letter Parser** — Paste your EOB/denial letter → AI extracts structured data (denial reasons, deadlines, claim numbers)
- **National Context Stat** — Shows the patient how often claims like theirs get denied and how often appeals actually win, sourced from a real cited public dataset (see below) — this is what turns "I got denied" into "I should appeal"
- **Appeal Letter Generator** — ERISA-compliant appeal letter drafted to address every denial reason point by point
- **Claim File Request Letter** — Drafts a formal request for the insurer's internal claim file and review notes. This isn't a legal threat — under ERISA (29 CFR 2560.503-1), claimants are entitled on request to the documents the insurer relied on to deny the claim. The tool just automates asking for what you're already owed.

### 🩺 Provider Module (For Doctors)
- **ICD-10 / CPT Code Search** — Autocomplete with 90+ diagnosis codes and 80+ procedure codes
- **Denial Risk Score** — Heuristic scoring based on CMS denial patterns (0-100 with color-coded gauge)
- **PA Packet Drafter** — AI drafts a complete prior authorization request packet, structured to the industry-standard 8-section PA form, for the physician to review, sign, and submit through their existing payer channel. (It drafts the packet — it does not submit into payer portals or EHR systems; that requires ePA credentials, e.g. FHIR Da Vinci / NCPDP SCRIPT, that are out of scope for this build.)

### 📊 Data Grounding
- Denial risk heuristics and code lookups use CMS-pattern-informed weights over an embedded ICD-10/CPT/CARC-RARC dataset (see `backend/data/`)
- The "claims like yours" stat is a real, cited figure: **16.6% of in-network ACA marketplace claims were denied in 2021, and 41% of appealed denials were overturned in the patient's favor** (KFF analysis of CMS Transparency in Coverage data, published Feb 2023)

### 🛡️ Safety
- **Zero Hallucination Protocol** — AI flags uncertain claims with `[NEEDS VERIFICATION]`
- **Human-in-the-Loop** — Every document requires explicit "I've Reviewed — Approve" click before download
- **Watermarked Drafts** — All documents stamped "AI-DRAFTED — NOT YET REVIEWED"
- Every letter this tool produces is a **draft** for the patient (and their doctor, for PA requests) to review before it's ever sent — the AI never files, submits, or sends anything on its own

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python + FastAPI |
| LLM | Google Gemini Flash (free tier) |
| Frontend | Vanilla HTML/CSS/JS |
| Data | Embedded JSON (ICD-10, CPT, CARC/RARC denial codes) |

---

## Project Structure

```
/HH
├── backend/
│   ├── main.py          # FastAPI app + routes
│   ├── config.py        # Environment config
│   ├── llm.py           # Gemini client wrapper
│   ├── prompts.py       # System prompts (PA, Appeal, Demand, Parser)
│   ├── risk_engine.py   # Denial risk scoring logic
│   └── data/
│       ├── icd10_codes.json      # 90+ diagnosis codes
│       ├── cpt_codes.json        # 80+ procedure codes
│       └── denial_reasons.json   # 30 CARC/RARC denial codes
├── frontend/
│   ├── index.html       # Single-page app
│   ├── css/style.css    # Dark mode design system
│   └── js/
│       ├── api.js       # Fetch wrapper
│       ├── app.js       # Navigation + HITL modal
│       ├── provider.js  # Provider module
│       └── patient.js   # Patient advocate module
├── requirements.txt
└── .env.example
```
