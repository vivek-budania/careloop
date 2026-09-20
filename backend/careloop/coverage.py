"""Dave's coverage slice: mock card/plan identity, eligibility, visit-cost estimate, network.

Optional xAI vision on uploaded card/SBC (XAI_API_KEY at launch).
Optional Stedi sandbox 270/271 (STEDI_API_KEY at launch). Aetna + Jane Doe /
AETNA12345 is the canned sandbox member.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import re
from copy import deepcopy
from typing import Any, Optional

from backend.careloop import extract as careloop_extract
from backend.careloop import stedi as careloop_stedi
from backend.risk_engine import calculate_risk_score

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")

ZIP_COORDS = {
    "94110": (37.7484, -122.4156),
    "94117": (37.7629, -122.4436),
    "94103": (37.7706, -122.4110),
    "94107": (37.7621, -122.3971),
    "94108": (37.7910, -122.4089),
    "94109": (37.7926, -122.4218),
    "94115": (37.7858, -122.4358),
    "10001": (40.7506, -73.9971),
    "10016": (40.7450, -73.9780),
}

_states: dict[str, dict[str, Any]] = {}
_active_user = "_default"
_COOKIE_KEYS = ("profile", "eligibility", "intake", "source")
_DEMO_SECRET = "careloop-demo-session"


def _has_word(blob: str, words: tuple[str, ...]) -> bool:
    return any(re.search(rf"\b{re.escape(word)}\b", blob) for word in words)


def _load_json(filename: str) -> Any:
    with open(os.path.join(DATA_DIR, filename), "r") as f:
        return json.load(f)


def _payers() -> list[dict]:
    return _load_json("mock_payers.json")


def _network() -> list[dict]:
    return _load_json("mock_network.json")


def _fee_schedule() -> dict:
    return _load_json("mock_fee_schedule.json")


def _rx_formulary() -> list[dict]:
    return _load_json("mock_rx_formulary.json")


def _prior_visit_fixture() -> dict:
    return _load_json("mock_prior_visit.json")


def guess_specialty(symptoms: str = "", prior_visit_note: str = "") -> dict:
    """Directory filter from visit reason. Not a diagnosis or coverage decision."""
    blob = f"{symptoms} {prior_visit_note}".lower()
    if _has_word(
        blob,
        (
            "diabetes",
            "a1c",
            "hba1c",
            "metformin",
            "glp",
            "insulin",
            "thirst",
            "endocrin",
        ),
    ):
        return {
            "code": "endocrinology",
            "label": "Endocrinology",
            "reason": "Visit reason looks like a diabetes follow-up.",
        }
    if _has_word(
        blob,
        (
            "psoriasis",
            "plaque",
            "clobetasol",
            "skyrizi",
            "biologic",
            "phototherapy",
            "dermatolog",
            "scalp",
        ),
    ):
        return {
            "code": "dermatology",
            "label": "Dermatology",
            "reason": "Visit reason looks like a skin or psoriasis visit.",
        }
    if _has_word(
        blob,
        (
            "migraine",
            "headache",
            "botox",
            "topamax",
            "topiramate",
            "sumatriptan",
            "neurolog",
        ),
    ):
        return {
            "code": "neurology",
            "label": "Neurology",
            "reason": "Visit reason looks like headaches or migraine.",
        }
    if _has_word(
        blob,
        (
            "back",
            "spine",
            "sciatica",
            "radiculopathy",
            "lumbar",
            "meloxicam",
            "mri",
            "orthop",
        ),
    ):
        return {
            "code": "orthopedics",
            "label": "Orthopedics",
            "reason": "Visit reason looks like back or joint pain.",
        }
    return {
        "code": "pcp",
        "label": "Primary care",
        "reason": "I’ll start with primary care.",
    }


def guess_icd10(symptoms: str = "", prior_visit_note: str = "") -> Optional[dict]:
    """Heuristic ICD-10 guess from free text. Not a diagnosis."""
    blob = f"{symptoms} {prior_visit_note}".lower()
    if _has_word(
        blob,
        ("diabetes", "a1c", "hba1c", "metformin", "glp", "insulin", "thirst", "endocrin"),
    ):
        return {
            "code": "E11.9",
            "description": "Type 2 diabetes mellitus without complications",
            "reason": "Visit text looks like a diabetes follow-up.",
        }
    if _has_word(
        blob,
        ("psoriasis", "plaque", "clobetasol", "skyrizi", "biologic", "phototherapy", "dermatolog"),
    ):
        return {
            "code": "L40.0",
            "description": "Psoriasis vulgaris",
            "reason": "Visit text looks like plaque psoriasis.",
        }
    if _has_word(
        blob,
        ("migraine", "botox", "topamax", "topiramate", "sumatriptan", "neurolog"),
    ):
        return {
            "code": "G43.909",
            "description": "Migraine, unspecified, not intractable, without status migrainosus",
            "reason": "Visit text looks like migraine.",
        }
    if _has_word(blob, ("sciatica", "radiculopathy")):
        return {
            "code": "M54.41",
            "description": "Lumbago with sciatica, right side",
            "reason": "Visit text looks like sciatica.",
        }
    if _has_word(blob, ("back", "spine", "lumbar", "meloxicam", "mri", "orthop")):
        return {
            "code": "M54.5",
            "description": "Low back pain",
            "reason": "Visit text looks like low-back pain.",
        }
    if _has_word(blob, ("headache",)):
        return {
            "code": "R51.9",
            "description": "Headache, unspecified",
            "reason": "Visit text mentions headache.",
        }
    if _has_word(blob, ("fatigue", "thirst")):
        return {
            "code": "R53.83",
            "description": "Other fatigue",
            "reason": "Visit text mentions fatigue.",
        }
    return None



def _is_specialist_specialty(specialty_code: str = "") -> bool:
    code = (specialty_code or "").strip().lower()
    return bool(code) and code not in ("pcp", "any", "primary", "primary care")

def infer_service_codes(
    symptoms: str = "",
    prior_visit_note: str = "",
    *,
    require_match: bool = False,
    specialty_code: str = "",
) -> list[tuple[str, str]]:
    """Pick mock CPT lines from visit text. Not a claim or an order."""
    blob = f"{symptoms} {prior_visit_note}".lower()
    diabetes = _has_word(blob, ("diabetes", "a1c", "hba1c", "metformin", "glp"))
    new_patient = _has_word(blob, ("new patient", "first visit")) or "never seen" in blob
    urgent = _has_word(blob, ("chest", "shortness", "emergency", "urgent"))
    imaging = _has_word(blob, ("mri", "radiculopathy", "sciatica", "lumbar"))
    specialist = _has_word(
        blob,
        ("psoriasis", "migraine", "botox", "skyrizi", "neurolog", "dermatolog", "orthop"),
    ) or _is_specialist_specialty(specialty_code)
    codes: list[tuple[str, str]] = []
    if diabetes:
        codes.append(("99214", "office"))
        codes.append(("83036", "lab"))
    elif imaging:
        codes.append(("99214", "office"))
        codes.append(("72148", "imaging"))
    elif specialist or new_patient:
        codes.append(("99214" if specialist else "99203", "office"))
    elif urgent:
        codes.append(("99214", "office"))
    elif not require_match:
        codes.append(("99213", "office"))
    return codes


def _quiet_claim_factors(factors: list) -> list[str]:
    """Patient-facing reasons, without scoring jargon."""
    out: list[str] = []
    seen: set[str] = set()
    for raw in factors or []:
        text = str(raw or "")
        lower = text.lower()
        if "not in our database" in lower:
            mapped = ""
        elif text.startswith("High-denial category"):
            mapped = "This kind of visit is often reviewed more closely."
        elif "unspecified" in lower:
            mapped = "A more specific visit reason can help."
        elif text.startswith("High-risk combination"):
            mapped = "This mix of visit details is often reviewed more closely."
        elif "no prior authorization" in lower:
            mapped = "Some items may need approval first."
        elif "no clinical notes" in lower:
            mapped = "A visit summary on file can help."
        elif "emergency service" in lower:
            mapped = "Emergency visits are often reviewed differently."
        else:
            mapped = text
        if mapped and mapped not in seen:
            seen.add(mapped)
            out.append(mapped)
    return out


def claim_acceptance_estimate(
    *,
    symptoms: str = "",
    prior_visit_note: str = "",
    cpt_code: str = "",
    icd10_code: str = "",
    has_prior_auth: bool = False,
    has_clinical_notes: bool = True,
    is_emergency: bool = False,
) -> dict:
    """Invert DenialShield denial risk into a claim-acceptance percent.

    Higher original score = more denial risk. Acceptance = 100 − that score.
    Estimate only — not a coverage decision, approval, or paid claim.
    """
    guessed = guess_icd10(symptoms, prior_visit_note)
    icd = (icd10_code or "").strip() or ((guessed or {}).get("code") or "")
    cpt = (cpt_code or "").strip()
    if not cpt:
        inferred = infer_service_codes(symptoms, prior_visit_note, require_match=True)
        if not inferred:
            inferred = infer_service_codes(symptoms, prior_visit_note, require_match=False)
        cpt = inferred[0][0] if inferred else ""
    if not icd or not cpt:
        return {
            "available": False,
            "acceptance_percent": None,
            "denial_risk": None,
            "disclaimer": "Not enough visit detail yet to estimate whether a later claim might be accepted.",
        }
    result = calculate_risk_score(
        icd10_code=icd,
        cpt_code=cpt,
        has_prior_auth=has_prior_auth,
        has_clinical_notes=has_clinical_notes,
        is_emergency=is_emergency,
    )
    acceptance = max(0, min(100, 100 - int(result["score"])))
    return {
        "available": True,
        "acceptance_percent": acceptance,
        "denial_risk": result["score"],
        "risk_level": result["risk_level"],
        "color": result["color"],
        "factors": _quiet_claim_factors(result["factors"]),
        "recommendations": result["recommendations"],
        "icd10_code": icd,
        "cpt_code": cpt,
        "icd10": result.get("icd10"),
        "cpt": result.get("cpt"),
        "guessed_icd": guessed,
        "disclaimer": "Estimate only — not a promise of payment.",
    }


def _empty_state() -> dict:
    return {
        "profile": None,
        "eligibility": None,
        "intake": None,
        "visit_cost_estimate": None,
        "clinicians": None,
        "source": "mock",
        "stedi": careloop_stedi.status(),
    }


def _secret() -> bytes:
    raw = (os.getenv("SESSION_SECRET") or _DEMO_SECRET).strip()
    return raw.encode("utf-8")


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def bind_user(username: Optional[str], cookie: Optional[str] = None) -> None:
    """Select this username's snapshot. Cookie wins so Vercel workers agree."""
    global _active_user
    _active_user = (username or "_default").strip().lower() or "_default"
    if cookie:
        imported = decode_state_cookie(cookie)
        if imported:
            _states[_active_user] = imported
            return
    if _active_user not in _states:
        _states[_active_user] = _empty_state()


def encode_state_cookie() -> str:
    snap = snapshot()
    body = {key: snap.get(key) for key in _COOKIE_KEYS}
    raw = json.dumps(body, separators=(",", ":")).encode("utf-8")
    sig = hmac.new(_secret(), raw, hashlib.sha256).digest()
    return f"v1.{_b64(raw)}.{_b64(sig)}"


def decode_state_cookie(token: Optional[str]) -> Optional[dict]:
    if not token or not token.startswith("v1."):
        return None
    try:
        _ver, raw_b64, sig_b64 = token.split(".", 2)
        raw = _unb64(raw_b64)
        expected = hmac.new(_secret(), raw, hashlib.sha256).digest()
        if not hmac.compare_digest(_unb64(sig_b64), expected):
            return None
        data = json.loads(raw.decode("utf-8"))
        state = _empty_state()
        for key in _COOKIE_KEYS:
            if key in data:
                state[key] = data[key]
        return state
    except Exception:
        return None


def reset() -> dict:
    _states[_active_user] = _empty_state()
    return snapshot()


def snapshot() -> dict:
    if _active_user not in _states:
        _states[_active_user] = _empty_state()
    return deepcopy(_states[_active_user])


def list_payers() -> list[dict]:
    return [
        {
            "id": p["id"],
            "name": p["name"],
            "plan_type": p["plan_type"],
            "network_name": p["network_name"],
            "active": p["active"],
            "stedi_demo": bool(p.get("stedi_demo")),
        }
        for p in _payers()
    ]


def _find_payer(name_or_id: Optional[str]) -> Optional[dict]:
    if not name_or_id:
        return None
    needle = name_or_id.strip().lower()
    for p in _payers():
        if p["id"].lower() == needle or p["name"].lower() == needle:
            return p
    return None


def _profile_from_payer(payer: dict, overrides: Optional[dict] = None) -> dict:
    card = dict(payer.get("fixture_card") or {})
    profile = {
        "payer_id": payer["id"],
        "payer_name": payer["name"],
        "plan_type": payer["plan_type"],
        "network_name": payer["network_name"],
        "member_name": card.get("member_name", ""),
        "member_id": card.get("member_id", ""),
        "group_number": card.get("group_number", ""),
        "date_of_birth": card.get("date_of_birth", ""),
        "zip": card.get("zip", ""),
        "rx_bin": card.get("rx_bin", ""),
        "rx_pcn": card.get("rx_pcn", ""),
        "rx_group": card.get("rx_group", ""),
        "scan_source": None,
        "supporting_docs": [],
    }
    if overrides:
        for key, value in overrides.items():
            if value is None or value == "":
                continue
            if key in profile or key in ("image_note", "sbc_note"):
                if key in profile:
                    profile[key] = value
    return profile


def _ensure_state() -> dict:
    if _active_user not in _states:
        _states[_active_user] = _empty_state()
    return _states[_active_user]


def save_profile(
    *,
    payer_name: str,
    member_name: str = "",
    member_id: str = "",
    group_number: str = "",
    date_of_birth: str = "",
    zip_code: str = "",
    plan_type: str = "",
    supporting_docs: Optional[list] = None,
) -> dict:
    payer = _find_payer(payer_name)
    if not payer:
        raise ValueError("Insurance company is required. Pick a payer from the dropdown.")

    overrides = {
        "member_name": member_name,
        "member_id": member_id,
        "group_number": group_number,
        "date_of_birth": date_of_birth,
        "zip": zip_code,
        "plan_type": plan_type,
    }
    profile = _profile_from_payer(payer, overrides)
    # Typed blanks should stay blank rather than silently filling fixture IDs
    # when the user is entering by hand — except payer/plan/network.
    if member_id:
        profile["member_id"] = member_id
    elif not member_id and not member_name:
        # Hand-entry of payer only: keep fixture identity so the demo can continue.
        pass
    else:
        if member_name:
            profile["member_name"] = member_name
        if member_id:
            profile["member_id"] = member_id

    if supporting_docs:
        profile["supporting_docs"] = supporting_docs

    state = _ensure_state()
    state["profile"] = profile
    state["eligibility"] = None
    state["visit_cost_estimate"] = None
    state["clinicians"] = None
    return snapshot()


def scan_card(
    *,
    payer_name: str = "",
    image_note: str = "",
    sbc_note: str = "",
    card_image_b64: str = "",
    card_mime: str = "",
    card_filename: str = "",
    sbc_image_b64: str = "",
    sbc_mime: str = "",
    sbc_filename: str = "",
) -> dict:
    """Fixture scan, or xAI vision when an image/PDF is attached."""
    if card_image_b64 or sbc_image_b64:
        return _scan_uploaded(
            payer_name=payer_name,
            card_image_b64=card_image_b64,
            card_mime=card_mime,
            card_filename=card_filename,
            sbc_image_b64=sbc_image_b64,
            sbc_mime=sbc_mime,
            sbc_filename=sbc_filename,
        )

    payer = _find_payer(payer_name) or _find_payer("Aetna") or _find_payer("Mock Payer")
    if not payer:
        raise ValueError("Unknown payer.")
    profile = _profile_from_payer(payer)
    profile["scan_source"] = image_note or "fixture:front-of-card"
    docs = []
    if image_note:
        docs.append({"kind": "card", "note": image_note})
    if sbc_note:
        docs.append({"kind": "sbc", "note": sbc_note})
    profile["supporting_docs"] = docs
    profile["warnings"] = [
        "Card fields came from a fixture, not live OCR. Confirm or edit before relying on them."
    ]
    state = _ensure_state()
    state["profile"] = profile
    state["eligibility"] = None
    state["visit_cost_estimate"] = None
    return snapshot()


def _match_payer_name(extracted_name: str) -> Optional[dict]:
    if not extracted_name:
        return None
    hit = _find_payer(extracted_name)
    if hit:
        return hit
    needle = extracted_name.strip().lower()
    for payer in _payers():
        name = payer["name"].lower()
        if needle in name or name in needle:
            return payer
    return None


def _scan_uploaded(
    *,
    payer_name: str,
    card_image_b64: str,
    card_mime: str,
    card_filename: str,
    sbc_image_b64: str,
    sbc_mime: str,
    sbc_filename: str,
) -> dict:
    card = (
        careloop_extract.decode_upload(card_image_b64, card_mime, card_filename)
        if card_image_b64
        else None
    )
    sbc = (
        careloop_extract.decode_upload(sbc_image_b64, sbc_mime, sbc_filename)
        if sbc_image_b64
        else None
    )
    extracted = careloop_extract.extract_documents(card=card, sbc=sbc)

    selected = _find_payer(payer_name)
    ocr_payer = _match_payer_name(extracted.get("payer_name") or "")
    warnings = list(extracted.get("warnings") or [])
    if selected and ocr_payer and selected["id"] != ocr_payer["id"]:
        warnings.append(
            f"[NEEDS VERIFICATION] Upload looks like {ocr_payer['name']}, "
            f"but the dropdown is {selected['name']}. Dropdown kept."
        )
    payer = selected or ocr_payer
    if not payer:
        raise ValueError(
            "Could not match a payer from the upload. Pick an insurance company "
            "from the dropdown, then read the images again."
        )

    profile = _profile_from_payer(payer)
    for key in (
        "member_name",
        "member_id",
        "group_number",
        "date_of_birth",
        "zip",
        "plan_type",
        "rx_bin",
        "rx_pcn",
        "rx_group",
    ):
        value = extracted.get(key)
        if value:
            profile[key] = value
    profile["scan_source"] = "xai-vision"
    profile["printed_copay_pcp"] = extracted.get("printed_copay_pcp")
    profile["printed_copay_specialist"] = extracted.get("printed_copay_specialist")
    docs = []
    if card:
        docs.append({"kind": "card", "note": f"upload:{card.get('filename')}"})
    if sbc:
        docs.append({"kind": "sbc", "note": f"upload:{sbc.get('filename')}"})
    profile["supporting_docs"] = docs
    profile["warnings"] = warnings
    profile["unreadable"] = extracted.get("unreadable") or []
    if extracted.get("printed_copay_pcp") is not None or extracted.get("printed_copay_specialist") is not None:
        profile["warnings"].append(
            "Printed copays were copied from the upload only. They are not a coverage determination."
        )

    state = _ensure_state()
    state["profile"] = profile
    state["eligibility"] = None
    state["visit_cost_estimate"] = None
    return snapshot()


def _mock_eligibility(payer: dict, profile: dict) -> dict:
    active = bool(payer.get("active"))
    member_id = (profile.get("member_id") or "").strip()
    if member_id.upper().startswith("X-"):
        active = False

    status = "active" if active else "inactive"
    if payer.get("stedi_demo"):
        disclaimer = (
            "Mock eligibility matching this payer's Stedi canned sandbox member. "
            "Set STEDI_API_KEY on the container at launch to run a live test 270/271. "
            "This is not a coverage determination."
        )
    else:
        disclaimer = (
            "Mock eligibility — not a live 270/271 check. "
            "This is not a coverage determination."
        )
    return {
        "status": status,
        "in_network": active,
        "as_of": "2026-09-19",
        "source": "mock",
        "plan_type": payer["plan_type"],
        "network_name": payer["network_name"],
        "estimated_copay_pcp": payer.get("pcp_copay"),
        "estimated_copay_specialist": payer.get("specialist_copay"),
        "estimated_copay_er": payer.get("er_copay"),
        "deductible": payer.get("deductible"),
        "deductible_remaining": payer.get("deductible_remaining"),
        "oon_deductible": payer.get("oon_deductible"),
        "oop_max": payer.get("oop_max"),
        "oop_remaining": payer.get("oop_remaining"),
        "coinsurance_pct": payer.get("coinsurance_pct"),
        "pa_required_rx": payer.get("pa_required_rx"),
        "disclaimer": disclaimer,
    }


def _fill_stedi_identity(payer: dict, profile: dict) -> dict:
    """Keep typed fields; fill blanks from the canned fixture so Stedi can match."""
    out = dict(profile or {})
    card = dict(payer.get("fixture_card") or {})
    if not payer.get("stedi_payer_id"):
        return out
    for key in ("member_name", "member_id", "date_of_birth"):
        if not str(out.get(key) or "").strip() and card.get(key):
            out[key] = card[key]
    return out


def confirm_coverage(
    payer_name: str = "",
    member_id: str = "",
    date_of_birth: str = "",
    member_name: str = "",
) -> dict:
    state = _ensure_state()
    profile = state.get("profile")
    if payer_name:
        payer = _find_payer(payer_name)
        if not payer:
            raise ValueError("Unknown insurance company.")
        if not profile:
            profile = _profile_from_payer(payer)
        else:
            # Keep typed fields; switch plan metadata if dropdown changed.
            profile = {**profile, **{
                "payer_id": payer["id"],
                "payer_name": payer["name"],
                "plan_type": payer["plan_type"],
                "network_name": payer["network_name"],
            }}
        if member_id:
            profile["member_id"] = member_id
        if date_of_birth:
            profile["date_of_birth"] = date_of_birth
        if member_name:
            profile["member_name"] = member_name
        state["profile"] = profile
    if not profile:
        raise ValueError("Save or scan a card first (payer dropdown is required).")

    payer = _find_payer(profile.get("payer_name")) or _find_payer(profile.get("payer_id"))
    if not payer:
        raise ValueError("Unknown insurance company on the saved profile.")

    if member_id:
        profile["member_id"] = member_id
    if date_of_birth:
        profile["date_of_birth"] = date_of_birth
    if member_name:
        profile["member_name"] = member_name
    profile = _fill_stedi_identity(payer, profile)
    state["profile"] = profile

    live = careloop_stedi.check_eligibility(payer, profile)
    if live.get("used") and live.get("eligibility"):
        eligibility = live["eligibility"]
        state["source"] = "stedi"
    else:
        eligibility = _mock_eligibility(payer, profile)
        state["source"] = "mock"
    eligibility["live_api"] = {k: v for k, v in live.items() if k != "eligibility"}
    state["eligibility"] = eligibility
    state["stedi"] = careloop_stedi.status()
    return snapshot()


def save_intake(
    *,
    symptoms: str = "",
    prior_visit_note: str = "",
    prior_visit_filename: str = "",
    use_fixture_prior_visit: bool = False,
) -> dict:
    state = _ensure_state()
    prior = None
    if use_fixture_prior_visit or prior_visit_filename or prior_visit_note:
        prior = _prior_visit_fixture() if (use_fixture_prior_visit or prior_visit_filename) else {}
        if prior_visit_note:
            prior = {**(prior or {}), "user_note": prior_visit_note, "source": prior.get("source", "user")}
        if prior_visit_filename:
            prior = {**(prior or {}), "filename": prior_visit_filename, "source": "fixture"}
            if not prior.get("summary"):
                prior.update(_prior_visit_fixture())
                prior["filename"] = prior_visit_filename
                prior["source"] = "fixture"
    suggestion = guess_specialty(
        symptoms,
        (prior or {}).get("summary") or (prior or {}).get("user_note") or "",
    )
    state["intake"] = {
        "symptoms": symptoms.strip(),
        "prior_visit": prior,
        "suggested_specialty": suggestion["code"],
        "suggested_specialty_label": suggestion["label"],
        "suggested_specialty_reason": suggestion["reason"],
    }
    return snapshot()



def _office_copay(eligibility: dict, specialty_code: str = "") -> tuple[float, str]:
    """Pick PCP vs specialist office copay from the saved eligibility snapshot."""
    if _is_specialist_specialty(specialty_code):
        copay = eligibility.get("estimated_copay_specialist")
        if copay is None:
            copay = eligibility.get("estimated_copay_pcp") or 0
            return float(copay), f"in-network specialist copay unavailable — using PCP copay ${copay}"
        return float(copay), f"in-network specialist copay ${copay}"
    copay = eligibility.get("estimated_copay_pcp") or 0
    return float(copay), f"in-network PCP copay ${copay}"


def _line_cost(
    code: str,
    eligibility: dict,
    setting: str,
    *,
    specialty_code: str = "",
) -> dict:
    fee = _fee_schedule().get(code)
    if not fee:
        raise ValueError("Could not estimate a price for that visit service.")
    allowed = fee["allowed"]
    status = (eligibility or {}).get("status")
    if status != "active":
        return {
            **fee,
            "kind": "visit",
            "patient_owes_low": allowed,
            "patient_owes_high": allowed,
            "priced": True,
            "basis": "this plan looks inactive — showing the full amount",
        }

    if setting == "office":
        copay, basis = _office_copay(eligibility, specialty_code)
        return {
            **fee,
            "kind": "visit",
            "patient_owes_low": copay,
            "patient_owes_high": copay,
            "priced": True,
            "basis": basis,
        }

    # Labs / imaging: apply remaining deductible then coinsurance on the rest.
    deductible_left = eligibility.get("deductible_remaining") or 0
    coins = (eligibility.get("coinsurance_pct") or 0) / 100.0
    if deductible_left >= allowed:
        owed = allowed
        basis = f"applies to deductible (remaining ${deductible_left})"
    else:
        after_deduct = allowed - deductible_left
        owed = round(deductible_left + after_deduct * coins, 2)
        basis = (
            f"deductible remaining ${deductible_left} then "
            f"{int((eligibility.get('coinsurance_pct') or 0))}% coinsurance"
        )
    return {
        **fee,
        "kind": "visit",
        "patient_owes_low": owed,
        "patient_owes_high": owed,
        "priced": True,
        "basis": basis,
    }


def _match_formulary_entry(text: str) -> Optional[dict]:
    blob = (text or "").lower()
    if not blob.strip():
        return None
    for entry in _rx_formulary():
        for needle in entry.get("match") or []:
            if _has_word(blob, (str(needle).lower(),)):
                return entry
            # Multi-word / hyphenated tokens (e.g. glp-1) — plain substring is fine.
            if "-" in needle and needle.lower() in blob:
                return entry
    return None


def _normalize_medicine_inputs(medicines: Optional[list[dict]] = None) -> list[dict]:
    out: list[dict] = []
    for i, raw in enumerate(medicines or []):
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or raw.get("description") or "").strip()
        description = str(raw.get("description") or raw.get("name") or "").strip()
        if not name and not description:
            continue
        out.append({
            "id": str(raw.get("id") or f"rx-{i + 1}"),
            "name": name or description,
            "description": description or name,
            "pa_required": bool(raw.get("pa_required", False)),
            "code": raw.get("code"),
        })
    return out


def _rx_line_cost(medicine: dict, eligibility: dict) -> dict:
    """Mock patient-pay for one plan medicine using the saved eligibility + formulary."""
    blob = f"{medicine.get('name') or ''} {medicine.get('description') or ''}"
    entry = _match_formulary_entry(blob)
    display = (entry or {}).get("display_name") or medicine.get("name") or "Medicine"
    plan_pa = bool(medicine.get("pa_required"))
    formulary_pa = bool((entry or {}).get("pa_required"))
    needs_pa = plan_pa or formulary_pa
    status = (eligibility or {}).get("status")
    active = status == "active"

    base = {
        "kind": "medicine",
        "id": medicine.get("id"),
        "name": display,
        "description": display,
        "code": medicine.get("code") or (entry or {}).get("id"),
        "tier": (entry or {}).get("tier"),
        "tier_label": (entry or {}).get("tier_label") or "Unlisted",
        "pa_required": needs_pa,
        "allowed": None,
        "setting": "pharmacy",
        "match": (entry or {}).get("id"),
    }

    if needs_pa:
        return {
            **base,
            "patient_owes_low": None,
            "patient_owes_high": None,
            "priced": False,
            "basis": (
                (entry or {}).get("notes")
                or "May need insurance approval first — not priced yet"
            ),
        }

    if not entry:
        return {
            **base,
            "patient_owes_low": None,
            "patient_owes_high": None,
            "priced": False,
            "basis": "No estimated amount on file for this medicine yet",
        }

    if not active:
        cash = entry.get("cash_price")
        if cash is None:
            return {
                **base,
                "patient_owes_low": None,
                "patient_owes_high": None,
                "priced": False,
                "basis": "this plan looks inactive — no cash-pay amount on file for this medicine",
            }
        return {
            **base,
            "patient_owes_low": float(cash),
            "patient_owes_high": float(cash),
            "priced": True,
            "allowed": float(cash),
            "basis": f"this plan looks inactive — cash-pay amount ${cash}",
        }

    copay = entry.get("patient_copay")
    if copay is None:
        return {
            **base,
            "patient_owes_low": None,
            "patient_owes_high": None,
            "priced": False,
            "basis": entry.get("notes") or "No retail copay on file for this medicine",
        }

    return {
        **base,
        "patient_owes_low": float(copay),
        "patient_owes_high": float(copay),
        "priced": True,
        "allowed": float(copay),
        "basis": (
            f"{entry.get('tier_label') or 'Plan'} retail copay ${copay} "
            f"(from your saved plan)"
        ),
    }


def estimate_medicines(
    medicines: Optional[list[dict]] = None,
    eligibility: Optional[dict] = None,
) -> list[dict]:
    elig = eligibility or {}
    return [_rx_line_cost(med, elig) for med in _normalize_medicine_inputs(medicines)]


def visit_guess(
    symptoms: str = "",
    prior_visit_note: str = "",
    medicines: Optional[list[dict]] = None,
    specialty: str = "",
    from_transcript: bool = False,
) -> dict:
    state = _ensure_state()
    intake = state.get("intake") or {}
    symptoms = symptoms or intake.get("symptoms") or ""
    prior = intake.get("prior_visit") or {}
    prior_text = prior_visit_note or prior.get("summary") or prior.get("user_note") or ""
    blob = f"{symptoms} {prior_text}".lower()

    eligibility = state.get("eligibility")
    if not eligibility:
        raise ValueError("Confirm coverage first.")

    suggestion = guess_specialty(symptoms, prior_text)
    specialty_code = (specialty or intake.get("suggested_specialty") or suggestion["code"] or "").strip().lower()
    if not specialty_code:
        specialty_code = suggestion["code"]

    codes = infer_service_codes(
        symptoms,
        prior_text,
        require_match=from_transcript,
        specialty_code=specialty_code,
    )
    urgent = _has_word(blob, ("chest", "shortness", "emergency", "urgent"))
    visit_lines = [
        _line_cost(code, eligibility, setting, specialty_code=specialty_code)
        for code, setting in codes
    ]

    medicine_lines = estimate_medicines(medicines, eligibility)

    visit_low = round(sum(line["patient_owes_low"] or 0 for line in visit_lines), 2) if visit_lines else 0
    visit_high = round(sum(line["patient_owes_high"] or 0 for line in visit_lines), 2) if visit_lines else 0
    priced_meds = [line for line in medicine_lines if line.get("priced")]
    med_low = round(sum(line["patient_owes_low"] or 0 for line in priced_meds), 2)
    med_high = round(sum(line["patient_owes_high"] or 0 for line in priced_meds), 2)
    unpriced = [line for line in medicine_lines if not line.get("priced")]

    estimate = {
        "is_guess": True,
        "is_estimate": True,
        "from_transcript": bool(from_transcript),
        "disclaimer": "Estimate based on your saved plan — not a bill.",
        "likely_visits": visit_lines,
        "medicines": medicine_lines,
        "visit_owes_low": visit_low,
        "visit_owes_high": visit_high,
        "medicine_owes_low": med_low,
        "medicine_owes_high": med_high,
        "medicine_unpriced_count": len(unpriced),
        "patient_owes_low": round(visit_low + med_low, 2),
        "patient_owes_high": round(visit_high + med_high, 2),
        "warnings": [],
    }
    if from_transcript and not visit_lines:
        estimate["warnings"].append(
            "No billable service could be pulled from this transcript yet. "
            "Estimated costs stay empty instead of a demo boilerplate."
        )
    if "[NEEDS VERIFICATION" in json.dumps(visit_lines + medicine_lines):
        estimate["warnings"].append(
            "At least one line was inferred or unmatched. A clinician or pharmacist should confirm."
        )
    if unpriced:
        estimate["warnings"].append(
            f"{len(unpriced)} medicine(s) are listed without a dollar estimate yet."
        )
    estimate["suggested_specialty"] = suggestion["code"]
    estimate["suggested_specialty_label"] = suggestion["label"]
    first_cpt = visit_lines[0]["code"] if visit_lines else ""
    estimate["claim_acceptance"] = claim_acceptance_estimate(
        symptoms=symptoms,
        prior_visit_note=prior_text,
        cpt_code=first_cpt,
        has_clinical_notes=True,
        has_prior_auth=False,
        is_emergency=urgent,
    )
    state["visit_cost_estimate"] = estimate
    merged_intake = {**intake, "symptoms": symptoms or intake.get("symptoms") or ""}
    merged_intake["suggested_specialty"] = suggestion["code"]
    merged_intake["suggested_specialty_label"] = suggestion["label"]
    merged_intake["suggested_specialty_reason"] = suggestion["reason"]
    state["intake"] = merged_intake
    return snapshot()


def _haversine_miles(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 3958.8
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return round(2 * r * math.asin(min(1, math.sqrt(h))), 1)


def _coords_for_zip(zip_code: str) -> tuple[tuple[float, float], bool]:
    zip_code = (zip_code or "").strip()
    if zip_code in ZIP_COORDS:
        return ZIP_COORDS[zip_code], False
    return ZIP_COORDS["94110"], True


def search_network(specialty: str = "pcp", zip_code: str = "") -> dict:
    state = _ensure_state()
    profile = state.get("profile") or {}
    zip_code = zip_code or profile.get("zip") or "94110"
    origin, zip_fallback = _coords_for_zip(zip_code)
    payer_name = (profile.get("payer_name") or "").strip()
    intake = state.get("intake") or {}
    spec = (specialty or intake.get("suggested_specialty") or "pcp").strip().lower()

    results = []
    for doc in _network():
        if spec not in ("any", "") and doc.get("specialty") != spec:
            continue
        miles = _haversine_miles(origin, (doc["lat"], doc["lng"]))
        in_network = payer_name in (doc.get("networks") or []) if payer_name else False
        results.append({
            "npi": doc["npi"],
            "name": doc["name"],
            "specialty": doc["specialty"],
            "specialty_label": doc["specialty_label"],
            "address": f"{doc['address']}, {doc['city']}, {doc['state']} {doc['zip']}",
            "zip": doc["zip"],
            "phone": doc["phone"],
            "accepting_new_patients": doc["accepting_new_patients"],
            "miles": miles,
            "in_network": in_network,
            "networks": doc["networks"],
        })
    results.sort(key=lambda row: (not row["in_network"], row["miles"], row["name"]))
    nearby_radius = 40
    nearby = [row for row in results if row["miles"] <= nearby_radius]
    payload = {
        "zip": zip_code,
        "specialty": spec,
        "specialty_label": next(
            (row["specialty_label"] for row in results if row["specialty"] == spec),
            "Primary care" if spec == "pcp" else spec.title(),
        ),
        "suggested_from_visit": bool(intake.get("suggested_specialty")),
        "zip_fallback_used": zip_fallback,
        "nearby_radius_miles": nearby_radius,
        "nearby_count": len(nearby),
        "source": "fixture",
        "disclaimer": (
            "Mock directory filtered by visit-reason specialty and distance from this ZIP. "
            "Not a payer directory or a diagnosis."
        ),
        "clinicians": results,
        "nearby": nearby,
    }
    state["clinicians"] = payload
    return payload
