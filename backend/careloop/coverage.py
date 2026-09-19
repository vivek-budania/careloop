"""Dave's coverage slice: mock card/plan identity, eligibility, visit-cost guess, network.

No Gemini. Live 270/271 is optional (STEDI_API_KEY) and will not match these
fixture members — we still probe so the response shows the option exists.
"""

from __future__ import annotations

import json
import math
import os
import re
import urllib.error
import urllib.request
from copy import deepcopy
from typing import Any, Optional

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")

STEDI_ELIGIBILITY_URL = (
    "https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/eligibility/v3"
)
# Dummy Type-2 NPI that passes the Luhn check digit (not a real clinic).
DEMO_PROVIDER_NPI = "1999999984"

ZIP_COORDS = {
    "94110": (37.7484, -122.4156),
    "94117": (37.7629, -122.4436),
    "94103": (37.7706, -122.4110),
    "94107": (37.7621, -122.3971),
    "10001": (40.7506, -73.9971),
    "10016": (40.7450, -73.9780),
}

_state: dict[str, Any] = {}


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


def _prior_visit_fixture() -> dict:
    return _load_json("mock_prior_visit.json")


def _empty_state() -> dict:
    return {
        "profile": None,
        "eligibility": None,
        "intake": None,
        "visit_cost_estimate": None,
        "clinicians": None,
        "source": "mock",
    }


def reset() -> dict:
    global _state
    _state = _empty_state()
    return snapshot()


def snapshot() -> dict:
    if not _state:
        reset()
    return deepcopy(_state)


def list_payers() -> list[dict]:
    return [
        {
            "id": p["id"],
            "name": p["name"],
            "plan_type": p["plan_type"],
            "network_name": p["network_name"],
            "active": p["active"],
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
    if not _state:
        reset()
    return _state


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
) -> dict:
    """Fixture scan. Does not OCR. image_note/sbc_note are recorded only."""
    payer = _find_payer(payer_name) or _find_payer("Mock Payer")
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


def _mock_eligibility(payer: dict, profile: dict) -> dict:
    active = bool(payer.get("active"))
    member_id = (profile.get("member_id") or "").strip()
    if member_id.upper().startswith("X-"):
        active = False

    status = "active" if active else "inactive"
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
        "oop_max": payer.get("oop_max"),
        "oop_remaining": payer.get("oop_remaining"),
        "coinsurance_pct": payer.get("coinsurance_pct"),
        "pa_required_rx": payer.get("pa_required_rx"),
        "disclaimer": (
            "Mock eligibility — not a live 270/271 check. "
            "This is not a coverage determination."
        ),
    }


def _stedi_configured() -> bool:
    key = os.getenv("STEDI_API_KEY", "").strip()
    return bool(key) and key != "your_api_key_here"


def _probe_stedi(payer: dict, profile: dict) -> dict:
    """Optional 270/271. Fixture members will not match sandbox canned data."""
    if not _stedi_configured():
        return {
            "attempted": False,
            "used": False,
            "vendor": "stedi",
            "message": (
                "STEDI_API_KEY not set. Coverage used the mock plan. "
                "A Stedi test key is optional later; sandbox only accepts "
                "Stedi's canned members, not this fixture card."
            ),
        }

    payload = {
        "tradingPartnerServiceId": payer.get("stedi_payer_id") or "60054",
        "provider": {
            "organizationName": "CareLoop Demo Clinic",
            "npi": DEMO_PROVIDER_NPI,
        },
        "subscriber": {
            "firstName": (profile.get("member_name") or "Maya").split(" ")[0],
            "lastName": (profile.get("member_name") or "Chen").split(" ")[-1],
            "memberId": profile.get("member_id") or "M-1001",
            "dateOfBirth": (profile.get("date_of_birth") or "1972-03-14").replace("-", ""),
        },
        "encounter": {"serviceTypeCodes": ["30"]},
    }
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        STEDI_ELIGIBILITY_URL,
        data=body,
        headers={
            "Authorization": os.getenv("STEDI_API_KEY", "").strip(),
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            raw = resp.read().decode("utf-8")
        parsed = json.loads(raw) if raw else {}
        return {
            "attempted": True,
            "used": False,
            "vendor": "stedi",
            "http_status": 200,
            "message": (
                "Stedi returned a payload, but CareLoop still uses mock eligibility "
                "for this demo unless the member is a documented sandbox subscriber."
            ),
            "raw_keys": list(parsed.keys())[:12],
        }
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        return {
            "attempted": True,
            "used": False,
            "vendor": "stedi",
            "http_status": exc.code,
            "message": (
                "Stedi rejected this fixture member (expected). "
                "Sandbox keys only accept canned test subscribers. Mock eligibility used."
            ),
            "error": detail,
        }
    except Exception as exc:
        return {
            "attempted": True,
            "used": False,
            "vendor": "stedi",
            "message": f"Stedi probe failed ({exc}). Mock eligibility used.",
        }


def confirm_coverage(payer_name: str = "", member_id: str = "") -> dict:
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
        state["profile"] = profile
    if not profile:
        raise ValueError("Save or scan a card first (payer dropdown is required).")

    payer = _find_payer(profile.get("payer_name")) or _find_payer(profile.get("payer_id"))
    if not payer:
        raise ValueError("Unknown insurance company on the saved profile.")

    eligibility = _mock_eligibility(payer, profile)
    eligibility["live_api"] = _probe_stedi(payer, profile)
    state["eligibility"] = eligibility
    state["source"] = "mock"
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
    state["intake"] = {
        "symptoms": symptoms.strip(),
        "prior_visit": prior,
    }
    return snapshot()


def _line_cost(code: str, eligibility: dict, setting: str) -> dict:
    fee = _fee_schedule().get(code)
    if not fee:
        raise ValueError(f"No mock allowed amount for {code}.")
    allowed = fee["allowed"]
    status = (eligibility or {}).get("status")
    if status != "active":
        return {
            **fee,
            "patient_owes_low": allowed,
            "patient_owes_high": allowed,
            "basis": "coverage inactive — estimate is the full mock allowed amount",
        }

    if setting == "office":
        copay = eligibility.get("estimated_copay_pcp") or 0
        return {
            **fee,
            "patient_owes_low": copay,
            "patient_owes_high": copay,
            "basis": f"in-network PCP copay ${copay} (mock)",
        }

    # Labs: apply remaining deductible then coinsurance on the rest.
    deductible_left = eligibility.get("deductible_remaining") or 0
    coins = (eligibility.get("coinsurance_pct") or 0) / 100.0
    if deductible_left >= allowed:
        owed = allowed
        basis = f"applies to deductible (mock remaining ${deductible_left})"
    else:
        after_deduct = allowed - deductible_left
        owed = round(deductible_left + after_deduct * coins, 2)
        basis = (
            f"mock deductible remaining ${deductible_left} then "
            f"{int((eligibility.get('coinsurance_pct') or 0))}% coinsurance"
        )
    return {
        **fee,
        "patient_owes_low": owed,
        "patient_owes_high": owed,
        "basis": basis,
    }


def visit_guess(symptoms: str = "", prior_visit_note: str = "") -> dict:
    state = _ensure_state()
    intake = state.get("intake") or {}
    symptoms = symptoms or intake.get("symptoms") or ""
    prior = intake.get("prior_visit") or {}
    prior_text = prior_visit_note or prior.get("summary") or prior.get("user_note") or ""
    blob = f"{symptoms} {prior_text}".lower()

    eligibility = state.get("eligibility")
    if not eligibility:
        raise ValueError("Confirm coverage first.")

    codes: list[tuple[str, str]] = []
    diabetes = _has_word(blob, ("diabetes", "a1c", "hba1c", "metformin", "glp"))
    new_patient = _has_word(blob, ("new patient", "first visit")) or "never seen" in blob
    urgent = _has_word(blob, ("chest", "shortness", "emergency", "urgent"))

    if diabetes:
        codes.append(("99214", "office"))
        codes.append(("83036", "lab"))
    elif new_patient:
        codes.append(("99203", "office"))
    elif urgent:
        codes.append(("99214", "office"))
    else:
        codes.append(("99213", "office"))

    lines = [_line_cost(code, eligibility, setting) for code, setting in codes]
    if urgent:
        lines[0]["description"] += " [NEEDS VERIFICATION — urgency inferred from free text]"

    total_low = round(sum(line["patient_owes_low"] for line in lines), 2)
    total_high = round(sum(line["patient_owes_high"] for line in lines), 2)

    estimate = {
        "is_guess": True,
        "disclaimer": (
            "Guess only — not a bill, quote, or coverage decision. "
            "Allowed amounts and remaining deductible are mocked."
        ),
        "likely_visits": lines,
        "patient_owes_low": total_low,
        "patient_owes_high": total_high,
        "warnings": [],
    }
    if "[NEEDS VERIFICATION" in json.dumps(lines):
        estimate["warnings"].append(
            "At least one visit type was inferred from symptoms. A clinician should confirm."
        )
    state["visit_cost_estimate"] = estimate
    if symptoms and not intake.get("symptoms"):
        state["intake"] = {**intake, "symptoms": symptoms}
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
    spec = (specialty or "pcp").strip().lower()

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
    payload = {
        "zip": zip_code,
        "specialty": spec,
        "zip_fallback_used": zip_fallback,
        "source": "fixture",
        "disclaimer": (
            "Mock in-network list for this demo plan, filtered by distance. "
            "Not a payer directory."
        ),
        "clinicians": results,
    }
    state["clinicians"] = payload
    return payload
