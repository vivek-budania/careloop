"""FastAPI application — Denial Decoding & Appeal Engine.

Serves the frontend and provides API endpoints for:
- Prior Authorization generation
- Denial letter parsing
- Appeal letter generation
- Demand letter generation
- Risk score calculation
- Code lookups (ICD-10, CPT)
"""

import json
import os
from typing import Optional

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

from backend.llm import generate, generate_json
from backend.prompts import (
    PA_SYSTEM_PROMPT,
    APPEAL_SYSTEM_PROMPT,
    DEMAND_SYSTEM_PROMPT,
    DENIAL_PARSE_PROMPT,
    SCRIBE_SYSTEM_PROMPT,
)
from backend.risk_engine import calculate_risk_score
from backend.config import NATIONAL_APPEAL_STATS, demo_env_status
from backend.careloop import coverage as careloop_coverage
from backend.careloop import auth as careloop_auth
from backend.careloop import scribe as careloop_scribe
from backend.careloop import stt as careloop_stt

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Denial Decoding & Appeal Engine",
    description="AI-powered tool to fight insurance denials",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

def _load_json(filename: str) -> list[dict]:
    with open(os.path.join(DATA_DIR, filename), "r") as f:
        return json.load(f)

# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------

class PARequest(BaseModel):
    patient_age: Optional[int] = None
    patient_sex: Optional[str] = None
    icd10_code: str
    icd10_description: str
    cpt_code: str
    cpt_description: str
    clinical_context: str
    urgency: str = "standard"  # standard | urgent | emergent

class DenialParseRequest(BaseModel):
    denial_text: str

class AppealRequest(BaseModel):
    denial_text: str
    parsed_denial: Optional[dict] = None
    additional_context: str = ""
    patient_name: str = ""
    claim_number: str = ""

class DemandRequest(BaseModel):
    patient_name: str = ""
    claim_number: str = ""
    insurance_company: str = ""
    date_of_denial: str = ""
    denied_service: str = ""

class RiskScoreRequest(BaseModel):
    icd10_code: str
    cpt_code: str
    has_prior_auth: bool = False
    has_clinical_notes: bool = True
    is_emergency: bool = False

class GeneratedDocument(BaseModel):
    content: str
    warnings: list[str] = []


class CoverageProfileRequest(BaseModel):
    payer_name: str
    member_name: str = ""
    member_id: str = ""
    group_number: str = ""
    date_of_birth: str = ""
    zip: str = ""
    plan_type: str = ""
    supporting_docs: list[str] = []


class CoverageScanRequest(BaseModel):
    payer_name: str = ""
    image_note: str = "fixture:front-of-card"
    sbc_note: str = ""
    card_image_b64: str = ""
    card_mime: str = ""
    card_filename: str = ""
    sbc_image_b64: str = ""
    sbc_mime: str = ""
    sbc_filename: str = ""


class CoverageConfirmRequest(BaseModel):
    payer_name: str = ""
    member_id: str = ""
    member_name: str = ""
    date_of_birth: str = ""


class CoverageIntakeRequest(BaseModel):
    symptoms: str = ""
    prior_visit_note: str = ""
    prior_visit_filename: str = ""
    use_fixture_prior_visit: bool = False


class CoverageVisitGuessRequest(BaseModel):
    symptoms: str = ""
    prior_visit_note: str = ""


class ScribeDraftRequest(BaseModel):
    transcript: str = ""
    use_seeded: bool = True  # golden-path fixture SOAP; set false to call LLM
    demo_id: Optional[int] = None


class ScribeApproveRequest(BaseModel):
    encounter: dict


class ScribeSummarizeRequest(BaseModel):
    transcript: str = ""
    sentence_count: int = 5


class HistoryPdfRequest(BaseModel):
    markdown: str
    title: str = "CareLoop history packet"


class LoginRequest(BaseModel):
    username: str
    password: str


def require_coverage_user(
    request: Request,
    user: dict = Depends(careloop_auth.require_user),
):
    careloop_coverage.bind_user(user["username"], request.cookies.get("careloop_coverage"))
    return user


def _set_session_cookies(
    response: JSONResponse,
    request: Request,
    token: Optional[str] = None,
) -> JSONResponse:
    secure = careloop_auth.cookie_secure(request)
    if token is not None:
        response.set_cookie(
            "careloop_token",
            token,
            httponly=False,
            samesite="lax",
            secure=secure,
            max_age=60 * 60 * 12,
            path="/",
        )
    response.set_cookie(
        "careloop_coverage",
        careloop_coverage.encode_state_cookie(),
        httponly=True,
        samesite="lax",
        secure=secure,
        max_age=60 * 60 * 12,
        path="/",
    )
    return response


def coverage_json(payload: dict, request: Request) -> JSONResponse:
    return _set_session_cookies(JSONResponse(payload), request)

# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/codes/icd10")
def search_icd10(q: str = ""):
    """Search ICD-10 codes by code or description."""
    codes = _load_json("icd10_codes.json")
    if not q:
        return codes
    q_lower = q.lower()
    return [
        c for c in codes
        if q_lower in c["code"].lower() or q_lower in c["description"].lower()
    ]


@app.get("/api/codes/cpt")
def search_cpt(q: str = ""):
    """Search CPT/HCPCS codes by code or description."""
    codes = _load_json("cpt_codes.json")
    if not q:
        return codes
    q_lower = q.lower()
    return [
        c for c in codes
        if q_lower in c["code"].lower() or q_lower in c["description"].lower()
    ]


@app.get("/api/codes/denial-reasons")
def get_denial_reasons():
    """Get all denial reason codes with descriptions and appeal tips."""
    return _load_json("denial_reasons.json")


@app.get("/api/national-stats")
def get_national_stats():
    """National claim denial/appeal statistics, for patient-facing context."""
    return NATIONAL_APPEAL_STATS


@app.post("/api/risk-score")
def get_risk_score(req: RiskScoreRequest):
    """Calculate denial risk score for an ICD-10 + CPT combination."""
    result = calculate_risk_score(
        icd10_code=req.icd10_code,
        cpt_code=req.cpt_code,
        has_prior_auth=req.has_prior_auth,
        has_clinical_notes=req.has_clinical_notes,
        is_emergency=req.is_emergency,
    )
    return result


@app.post("/api/generate-pa", response_model=GeneratedDocument)
def generate_pa(req: PARequest):
    """Generate a prior authorization request letter."""
    user_message = f"""Generate a Prior Authorization request letter with the following clinical context:

Patient Information:
- Age: {req.patient_age or 'Not specified'}
- Sex: {req.patient_sex or 'Not specified'}

Diagnosis:
- ICD-10 Code: {req.icd10_code} — {req.icd10_description}

Requested Procedure/Service:
- CPT/HCPCS Code: {req.cpt_code} — {req.cpt_description}

Clinical Context & Justification:
{req.clinical_context}

Urgency Level: {req.urgency.upper()}

Please draft a complete, professional PA request letter addressing medical necessity."""

    try:
        content = generate(PA_SYSTEM_PROMPT, user_message)
        warnings = []
        if "[NEEDS VERIFICATION]" in content:
            warnings.append(
                "This document contains items marked [NEEDS VERIFICATION]. "
                "Please verify these claims before submitting."
            )
        return GeneratedDocument(content=content, warnings=warnings)
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM generation failed: {str(e)}")


@app.post("/api/parse-denial")
def parse_denial(req: DenialParseRequest):
    """Parse a denial/EOB letter into structured data."""
    if not req.denial_text.strip():
        raise HTTPException(status_code=400, detail="Denial text cannot be empty.")

    try:
        raw_json = generate_json(DENIAL_PARSE_PROMPT, req.denial_text)
        parsed = json.loads(raw_json)
        return parsed
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=500,
            detail="Failed to parse LLM response as JSON. Please try again."
        )
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Parsing failed: {str(e)}")


@app.post("/api/generate-appeal", response_model=GeneratedDocument)
def generate_appeal(req: AppealRequest):
    """Generate an appeal letter for a denied claim."""
    parsed_info = ""
    if req.parsed_denial:
        parsed_info = f"""
Parsed Denial Information:
{json.dumps(req.parsed_denial, indent=2)}
"""

    user_message = f"""Generate a formal insurance appeal letter for the following denied claim:

Patient Name: {req.patient_name or '[PATIENT NAME]'}
Claim Number: {req.claim_number or '[CLAIM NUMBER]'}

Original Denial Letter:
{req.denial_text}
{parsed_info}
Additional Context from Patient/Provider:
{req.additional_context or 'No additional context provided.'}

Please draft a complete, professional appeal letter that addresses every denial reason and argues for coverage."""

    try:
        content = generate(APPEAL_SYSTEM_PROMPT, user_message)
        warnings = []
        if "[NEEDS VERIFICATION]" in content:
            warnings.append(
                "This document contains items marked [NEEDS VERIFICATION]. "
                "Please verify these claims with your healthcare provider before submitting."
            )
        return GeneratedDocument(content=content, warnings=warnings)
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM generation failed: {str(e)}")


@app.post("/api/generate-demand", response_model=GeneratedDocument)
def generate_demand(req: DemandRequest):
    """Generate a claim file demand letter."""
    user_message = f"""Generate a formal demand letter requesting the complete insurance claim file for:

Patient Name: {req.patient_name or '[PATIENT NAME]'}
Claim Number: {req.claim_number or '[CLAIM NUMBER]'}
Insurance Company: {req.insurance_company or '[INSURANCE COMPANY]'}
Date of Denial: {req.date_of_denial or '[DATE]'}
Denied Service: {req.denied_service or '[SERVICE DESCRIPTION]'}

Please draft a complete, professional demand letter requesting all internal records, adjudication notes, and review criteria used in the denial decision."""

    try:
        content = generate(DEMAND_SYSTEM_PROMPT, user_message)
        warnings = []
        if "[NEEDS VERIFICATION]" in content:
            warnings.append(
                "This document contains items marked [NEEDS VERIFICATION]. "
                "Please verify all legal citations before sending."
            )
        return GeneratedDocument(content=content, warnings=warnings)
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM generation failed: {str(e)}")


# ---------------------------------------------------------------------------
# CareLoop auth (Supabase Auth + profiles when env is set; mock JSON otherwise)
# ---------------------------------------------------------------------------

@app.get("/api/careloop/auth/accounts")
def careloop_auth_accounts():
    """Usernames/roles for the login screen. Passwords are not returned."""
    return careloop_auth.list_accounts()


@app.post("/api/careloop/login")
def careloop_login(req: LoginRequest, request: Request):
    try:
        result = careloop_auth.login(req.username, req.password)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    careloop_coverage.bind_user(result["user"]["username"])
    return _set_session_cookies(JSONResponse(result), request, result["token"])


@app.post("/api/careloop/logout")
def careloop_logout(request: Request, authorization: Optional[str] = Header(default=None)):
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    if not token:
        token = request.cookies.get("careloop_token")
    careloop_auth.logout(token)
    response = JSONResponse({"ok": True})
    response.delete_cookie("careloop_token", path="/")
    response.delete_cookie("careloop_coverage", path="/")
    return response


@app.get("/api/careloop/me")
def careloop_me(user: dict = Depends(careloop_auth.require_user)):
    return user


# ---------------------------------------------------------------------------
# CareLoop coverage (Dave) — mock identity / eligibility / visit guess / network
# ---------------------------------------------------------------------------

@app.get("/api/careloop/payers")
def careloop_payers(_user: dict = Depends(careloop_auth.require_user)):
    """Dropdown list of mocked insurance companies."""
    return careloop_coverage.list_payers()


@app.get("/api/careloop/coverage")
def careloop_get_coverage(request: Request, _user: dict = Depends(require_coverage_user)):
    """Coverage snapshot for this signed-in demo user (cookie-backed on Vercel)."""
    return coverage_json(careloop_coverage.snapshot(), request)


@app.get("/api/careloop/demo-env")
def careloop_demo_env(_user: dict = Depends(careloop_auth.require_user)):
    """Which demo keys are loaded. Never returns secret values."""
    return demo_env_status()


@app.post("/api/careloop/coverage/reset")
def careloop_reset_coverage(request: Request, _user: dict = Depends(require_coverage_user)):
    return coverage_json(careloop_coverage.reset(), request)


@app.post("/api/careloop/coverage")
def careloop_save_coverage(
    req: CoverageProfileRequest,
    request: Request,
    _user: dict = Depends(require_coverage_user),
):
    try:
        return coverage_json(
            careloop_coverage.save_profile(
                payer_name=req.payer_name,
                member_name=req.member_name,
                member_id=req.member_id,
                group_number=req.group_number,
                date_of_birth=req.date_of_birth,
                zip_code=req.zip,
                plan_type=req.plan_type,
                supporting_docs=req.supporting_docs,
            ),
            request,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/careloop/coverage/scan")
def careloop_scan_coverage(
    req: CoverageScanRequest,
    request: Request,
    _user: dict = Depends(require_coverage_user),
):
    try:
        return coverage_json(
            careloop_coverage.scan_card(
                payer_name=req.payer_name,
                image_note=req.image_note,
                sbc_note=req.sbc_note,
                card_image_b64=req.card_image_b64,
                card_mime=req.card_mime,
                card_filename=req.card_filename,
                sbc_image_b64=req.sbc_image_b64,
                sbc_mime=req.sbc_mime,
                sbc_filename=req.sbc_filename,
            ),
            request,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/careloop/coverage/confirm")
def careloop_confirm_coverage(
    req: CoverageConfirmRequest,
    request: Request,
    _user: dict = Depends(require_coverage_user),
):
    try:
        return coverage_json(
            careloop_coverage.confirm_coverage(
                payer_name=req.payer_name,
                member_id=req.member_id,
                member_name=req.member_name,
                date_of_birth=req.date_of_birth,
            ),
            request,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/careloop/coverage/intake")
def careloop_coverage_intake(
    req: CoverageIntakeRequest,
    request: Request,
    _user: dict = Depends(require_coverage_user),
):
    return coverage_json(
        careloop_coverage.save_intake(
            symptoms=req.symptoms,
            prior_visit_note=req.prior_visit_note,
            prior_visit_filename=req.prior_visit_filename,
            use_fixture_prior_visit=req.use_fixture_prior_visit,
        ),
        request,
    )


@app.post("/api/careloop/coverage/visit-guess")
def careloop_visit_guess(
    req: CoverageVisitGuessRequest,
    request: Request,
    _user: dict = Depends(require_coverage_user),
):
    try:
        return coverage_json(
            careloop_coverage.visit_guess(
                symptoms=req.symptoms,
                prior_visit_note=req.prior_visit_note,
            ),
            request,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/careloop/network")
def careloop_network(
    request: Request,
    specialty: str = "",
    zip: str = "",
    _user: dict = Depends(require_coverage_user),
):
    return coverage_json(
        careloop_coverage.search_network(specialty=specialty, zip_code=zip),
        request,
    )


# ---------------------------------------------------------------------------
# CareLoop — Stream C scribe (transcript → SOAP/Plan → Orders)
# ---------------------------------------------------------------------------

@app.get("/api/careloop/scribe/fixture")
def scribe_fixture(
    demo: Optional[int] = None,
    _user: dict = Depends(careloop_auth.require_user),
):
    """Return a demo visit transcript. demo=1|2|3 or the Maya Chen golden path."""
    if demo:
        row = careloop_scribe.load_demo(demo)
        if not row:
            raise HTTPException(status_code=404, detail="Unknown demo transcript.")
        return row
    return careloop_scribe.load_fixture()


@app.get("/api/careloop/scribe/demos")
def scribe_demos(_user: dict = Depends(careloop_auth.require_user)):
    """Demo 1–3 transcripts for visit-day recording."""
    return {"demos": careloop_scribe.list_demo_summaries()}


@app.post("/api/careloop/scribe/transcribe")
async def scribe_transcribe(
    file: UploadFile = File(...),
    _user: dict = Depends(careloop_auth.require_user),
):
    """Optional Grok STT with speaker diarization (doctor vs patient)."""
    data = await file.read()
    try:
        return careloop_stt.transcribe_audio(
            filename=file.filename or "visit.webm",
            content_type=file.content_type or "application/octet-stream",
            data=data,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")


@app.post("/api/careloop/scribe/draft")
def scribe_draft(
    req: ScribeDraftRequest,
    _user: dict = Depends(careloop_auth.require_user),
):
    """Draft SOAP + structured Plan from a transcript.

    Default use_seeded=true for demo without LLM. Set use_seeded=false to
    draft from the transcript via Gemini/Groq. Always returns clinician_reviewed=false.
    """
    transcript = (req.transcript or "").strip()
    if not transcript and not req.use_seeded:
        raise HTTPException(status_code=400, detail="Transcript is required when use_seeded is false.")

    if req.use_seeded:
        encounter = careloop_scribe.build_encounter_draft(
            transcript=transcript,
            use_seeded=True,
            demo_id=req.demo_id,
        )
        return {"encounter": encounter}

    try:
        user_message = f"Visit transcript:\n\n{transcript}"
        raw_json = generate_json(SCRIBE_SYSTEM_PROMPT, user_message)
        payload = json.loads(raw_json)
        encounter = careloop_scribe.build_encounter_draft(
            transcript=transcript,
            use_seeded=False,
            llm_payload=payload,
        )
        return {"encounter": encounter}
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=500,
            detail="Failed to parse LLM scribe response as JSON. Try use_seeded=true or retry.",
        )
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Scribe draft failed: {str(e)}")


@app.post("/api/careloop/scribe/approve")
def scribe_approve(
    req: ScribeApproveRequest,
    _user: dict = Depends(careloop_auth.require_user),
):
    """Clinician review gate — mark encounter reviewed and create Orders from Plan."""
    try:
        return careloop_scribe.approve_encounter(req.encounter)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/careloop/scribe/summarize")
def scribe_summarize(
    req: ScribeSummarizeRequest,
    _user: dict = Depends(careloop_auth.require_user),
):
    """Extractive visit summary via Sumy LexRank (no Grok / no LLM)."""
    from backend.careloop import summary as careloop_summary

    transcript = (req.transcript or "").strip()
    if not transcript:
        transcript = (careloop_scribe.load_fixture().get("transcript") or "").strip()
    try:
        return careloop_summary.summarize_text(transcript, sentence_count=req.sentence_count)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Summarize failed: {e}")


@app.post("/api/careloop/history/pdf")
def history_pdf(
    req: HistoryPdfRequest,
    _user: dict = Depends(careloop_auth.require_user),
):
    """PDF export of the patient history packet (record view — not a letter)."""
    from backend.careloop import pdf_export as careloop_pdf

    try:
        data = careloop_pdf.build_history_pdf(
            req.markdown,
            title=req.title or "CareLoop history packet",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF export failed: {e}")
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="careloop-history.pdf"'},
    )


# ---------------------------------------------------------------------------
# Static file serving — frontend
# ---------------------------------------------------------------------------
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")

# Serve static assets (CSS, JS)
if os.path.isdir(FRONTEND_DIR):
    app.mount("/css", StaticFiles(directory=os.path.join(FRONTEND_DIR, "css")), name="css")
    app.mount("/js", StaticFiles(directory=os.path.join(FRONTEND_DIR, "js")), name="js")
    _mockups = os.path.join(FRONTEND_DIR, "mockups")
    if os.path.isdir(_mockups):
        app.mount("/mockups", StaticFiles(directory=_mockups, html=True), name="mockups")

    @app.get("/")
    def serve_frontend():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

    @app.get("/letters")
    def serve_letters():
        """Secondary DenialShield PA / appeal surface. Not the CareLoop patient UX."""
        return FileResponse(os.path.join(FRONTEND_DIR, "letters.html"))

    @app.get("/showcase")
    def serve_showcase():
        """Judge-facing HopHacks product story."""
        return FileResponse(os.path.join(FRONTEND_DIR, "showcase.html"))
