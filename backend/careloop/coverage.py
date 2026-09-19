"""Dave's coverage slice: mock card/plan identity, eligibility, visit-cost guess, network.

Optional Gemini vision on uploaded card/SBC (GEMINI_API_KEY at launch).
Optional Stedi sandbox 270/271 (STEDI_API_KEY at launch). Aetna + Jane Doe /
AETNA12345 is the canned sandbox member.
"""

from __future__ import annotations

import json
import math
import os
import re
from copy import deepcopy
from typing import Any, Optional

from backend.careloop import extract as careloop_extract
from backend.careloop import stedi as careloop_stedi

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")

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
            "reason": (
                "Visit reason looks like a diabetes follow-up. "
                "Suggestion only — not a diagnosis."
            ),
        }
    return {
        "code": "pcp",
        "label": "Primary care",
        "reason": "No specialty keywords matched. Defaulting to primary care.",
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
    card_image_b64: str = "",
    card_mime: str = "",
    card_filename: str = "",
    sbc_image_b64: str = "",
    sbc_mime: str = "",
    sbc_filename: str = "",
) -> dict:
    """Fixture scan, or Gemini vision when an image/PDF is attached."""
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
    profile["scan_source"] = "gemini-vision"
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
    suggestion = guess_specialty(symptoms, prior_text)
    estimate["suggested_specialty"] = suggestion["code"]
    estimate["suggested_specialty_label"] = suggestion["label"]
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
    payload = {
        "zip": zip_code,
        "specialty": spec,
        "specialty_label": next(
            (row["specialty_label"] for row in results if row["specialty"] == spec),
            "Primary care" if spec == "pcp" else spec,
        ),
        "suggested_from_visit": bool(intake.get("suggested_specialty")),
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
