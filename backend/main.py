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

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from backend.llm import generate, generate_json
from backend.prompts import (
    PA_SYSTEM_PROMPT,
    APPEAL_SYSTEM_PROMPT,
    DEMAND_SYSTEM_PROMPT,
    DENIAL_PARSE_PROMPT,
)
from backend.risk_engine import calculate_risk_score
from backend.config import NATIONAL_APPEAL_STATS
from backend.careloop import coverage as careloop_coverage
from backend.careloop import auth as careloop_auth

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
    date_of_birth: str = ""


class CoverageIntakeRequest(BaseModel):
    symptoms: str = ""
    prior_visit_note: str = ""
    prior_visit_filename: str = ""
    use_fixture_prior_visit: bool = False


class CoverageVisitGuessRequest(BaseModel):
    symptoms: str = ""
    prior_visit_note: str = ""


class LoginRequest(BaseModel):
    username: str
    password: str

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
# CareLoop auth (mock login — not production)
# ---------------------------------------------------------------------------

@app.get("/api/careloop/auth/accounts")
def careloop_auth_accounts():
    """Demo usernames/roles for the login screen. Passwords are not returned."""
    with open(os.path.join(DATA_DIR, "mock_users.json"), "r") as f:
        users = json.load(f)
    return [{"username": u["username"], "name": u["name"], "role": u["role"]} for u in users]


@app.post("/api/careloop/login")
def careloop_login(req: LoginRequest):
    try:
        result = careloop_auth.login(req.username, req.password)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    response = JSONResponse(result)
    response.set_cookie(
        "careloop_token",
        result["token"],
        httponly=False,
        samesite="lax",
        max_age=60 * 60 * 12,
    )
    return response


@app.post("/api/careloop/logout")
def careloop_logout(request: Request, authorization: Optional[str] = Header(default=None)):
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    if not token:
        token = request.cookies.get("careloop_token")
    careloop_auth.logout(token)
    response = JSONResponse({"ok": True})
    response.delete_cookie("careloop_token")
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
def careloop_get_coverage(_user: dict = Depends(careloop_auth.require_user)):
    """Current in-memory coverage snapshot for this demo process."""
    return careloop_coverage.snapshot()


@app.post("/api/careloop/coverage/reset")
def careloop_reset_coverage(_user: dict = Depends(careloop_auth.require_user)):
    return careloop_coverage.reset()


@app.post("/api/careloop/coverage")
def careloop_save_coverage(
    req: CoverageProfileRequest,
    _user: dict = Depends(careloop_auth.require_user),
):
    try:
        return careloop_coverage.save_profile(
            payer_name=req.payer_name,
            member_name=req.member_name,
            member_id=req.member_id,
            group_number=req.group_number,
            date_of_birth=req.date_of_birth,
            zip_code=req.zip,
            plan_type=req.plan_type,
            supporting_docs=req.supporting_docs,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/careloop/coverage/scan")
def careloop_scan_coverage(
    req: CoverageScanRequest,
    _user: dict = Depends(careloop_auth.require_user),
):
    try:
        return careloop_coverage.scan_card(
            payer_name=req.payer_name,
            image_note=req.image_note,
            sbc_note=req.sbc_note,
            card_image_b64=req.card_image_b64,
            card_mime=req.card_mime,
            card_filename=req.card_filename,
            sbc_image_b64=req.sbc_image_b64,
            sbc_mime=req.sbc_mime,
            sbc_filename=req.sbc_filename,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/careloop/coverage/confirm")
def careloop_confirm_coverage(
    req: CoverageConfirmRequest,
    _user: dict = Depends(careloop_auth.require_user),
):
    try:
        return careloop_coverage.confirm_coverage(
            payer_name=req.payer_name,
            member_id=req.member_id,
            date_of_birth=req.date_of_birth,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/careloop/coverage/intake")
def careloop_coverage_intake(
    req: CoverageIntakeRequest,
    _user: dict = Depends(careloop_auth.require_user),
):
    return careloop_coverage.save_intake(
        symptoms=req.symptoms,
        prior_visit_note=req.prior_visit_note,
        prior_visit_filename=req.prior_visit_filename,
        use_fixture_prior_visit=req.use_fixture_prior_visit,
    )


@app.post("/api/careloop/coverage/visit-guess")
def careloop_visit_guess(
    req: CoverageVisitGuessRequest,
    _user: dict = Depends(careloop_auth.require_user),
):
    try:
        return careloop_coverage.visit_guess(
            symptoms=req.symptoms,
            prior_visit_note=req.prior_visit_note,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/careloop/network")
def careloop_network(
    specialty: str = "pcp",
    zip: str = "",
    _user: dict = Depends(careloop_auth.require_user),
):
    return careloop_coverage.search_network(specialty=specialty, zip_code=zip)


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
