"""Stream C — visit scribe: transcript → SOAP + structured Plan → Orders.

Seeded golden-path encounter is the default (demo without a live mic / LLM).
Optional LLM draft uses only the supplied transcript (zero-hallucination).
Clinician review is required before Plan items become Orders.
"""

from __future__ import annotations

import json
import os
import uuid
from copy import deepcopy
from typing import Any

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
FIXTURE_PATH = os.path.join(DATA_DIR, "mock_visit_transcript.json")


def load_fixture() -> dict[str, Any]:
    with open(FIXTURE_PATH, "r") as f:
        return json.load(f)


def _seeded_soap_and_plan(fixture: dict[str, Any], transcript: str) -> dict[str, Any]:
    """Deterministic SOAP/Plan for the Maya Chen golden-path demo."""
    return {
        "soap": {
            "subjective": (
                "54F with T2DM on metformin 1000 mg BID for ~12 months. Reports home "
                "glucoses often 180–200+ postprandial. Mild early GI side effects resolved. "
                "Walks most days; diet imperfect. No chest pain or dizziness. Penicillin allergy (rash)."
            ),
            "objective": (
                "Weight stable. BP 128/78. Heart and lungs clear. Recent HbA1c 9.1% "
                "(~3 weeks ago). Repeat HbA1c ordered today."
            ),
            "assessment": (
                "Type 2 diabetes mellitus without complications (E11.9), not at glycemic "
                "goal on metformin monotherapy."
            ),
            "plan_summary": (
                "Continue metformin; add weekly GLP-1 (semaglutide) — PA likely required; "
                "order HbA1c; follow up in 3 months."
            ),
        },
        "plan": [
            {
                "id": "plan-lab-hba1c",
                "type": "lab",
                "description": "HbA1c",
                "code": "83036",
                "pa_required": False,
                "notes": "Confirm elevated A1c; no PA expected for this lab.",
            },
            {
                "id": "plan-rx-metformin",
                "type": "rx",
                "description": "Continue metformin 1000 mg BID",
                "code": None,
                "pa_required": False,
                "notes": "Ongoing first-line therapy ~12 months.",
            },
            {
                "id": "plan-rx-glp1",
                "type": "rx",
                "description": "Start semaglutide (GLP-1) once weekly",
                "code": "J3490",
                "pa_required": True,
                "notes": "Add-on for A1c not at goal; expect step-therapy PA.",
            },
            {
                "id": "plan-fu",
                "type": "follow_up",
                "description": "Return to clinic in 3 months; sooner if worsens",
                "code": None,
                "pa_required": False,
                "notes": "Discuss PA outcome and adherence.",
            },
        ],
        "source": "seeded",
        "warnings": [],
        "patient_name": fixture.get("patient_name", "Maya Chen"),
        "patient_age": fixture.get("patient_age"),
        "patient_sex": fixture.get("patient_sex"),
        "visit_date": fixture.get("visit_date"),
        "clinician": fixture.get("clinician"),
        "transcript": transcript,
    }


def _normalize_llm_payload(raw: dict[str, Any], transcript: str, fixture: dict[str, Any]) -> dict[str, Any]:
    soap = raw.get("soap") or {}
    plan_items = raw.get("plan") or []
    normalized_plan = []
    for i, item in enumerate(plan_items):
        if not isinstance(item, dict):
            continue
        normalized_plan.append({
            "id": item.get("id") or f"plan-{i+1}",
            "type": item.get("type") or "other",
            "description": item.get("description") or "",
            "code": item.get("code"),
            "pa_required": bool(item.get("pa_required", False)),
            "notes": item.get("notes") or "",
        })

    warnings = list(raw.get("warnings") or [])
    for field in ("subjective", "objective", "assessment", "plan_summary"):
        text = soap.get(field) or ""
        if "[NEEDS VERIFICATION]" in text and "SOAP contains [NEEDS VERIFICATION]" not in warnings:
            warnings.append("SOAP contains [NEEDS VERIFICATION] tags — clinician must verify before approving.")

    return {
        "soap": {
            "subjective": soap.get("subjective") or "",
            "objective": soap.get("objective") or "",
            "assessment": soap.get("assessment") or "",
            "plan_summary": soap.get("plan_summary") or "",
        },
        "plan": normalized_plan,
        "source": "llm",
        "warnings": warnings,
        "patient_name": raw.get("patient_name") or fixture.get("patient_name"),
        "patient_age": raw.get("patient_age") or fixture.get("patient_age"),
        "patient_sex": raw.get("patient_sex") or fixture.get("patient_sex"),
        "visit_date": raw.get("visit_date") or fixture.get("visit_date"),
        "clinician": raw.get("clinician") or fixture.get("clinician"),
        "transcript": transcript,
    }


def build_encounter_draft(
    *,
    transcript: str,
    use_seeded: bool = True,
    llm_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a draft Encounter (clinician_reviewed=False). Does not create Orders."""
    fixture = load_fixture()
    text = (transcript or "").strip() or fixture["transcript"]

    if use_seeded or llm_payload is None:
        content = _seeded_soap_and_plan(fixture, text)
    else:
        content = _normalize_llm_payload(llm_payload, text, fixture)

    return {
        "id": f"enc-{uuid.uuid4().hex[:8]}",
        "patient_name": content["patient_name"],
        "patient_age": content.get("patient_age"),
        "patient_sex": content.get("patient_sex"),
        "visit_date": content.get("visit_date"),
        "clinician": content.get("clinician"),
        "transcript": content["transcript"],
        "soap": content["soap"],
        "plan": content["plan"],
        "clinician_reviewed": False,
        "status": "draft",
        "source": content["source"],
        "warnings": content.get("warnings") or [],
    }


def approve_encounter(encounter: dict[str, Any]) -> dict[str, Any]:
    """Clinician review gate: mark reviewed and materialize Orders from Plan.

    The model never auto-finalizes — this endpoint is the required human step.
    """
    if not encounter or not isinstance(encounter, dict):
        raise ValueError("Encounter payload is required.")
    if not encounter.get("soap") or not encounter.get("plan"):
        raise ValueError("Encounter must include soap and plan before approval.")

    reviewed = deepcopy(encounter)
    reviewed["clinician_reviewed"] = True
    reviewed["status"] = "reviewed"

    orders = []
    for item in reviewed.get("plan") or []:
        orders.append({
            "id": f"ord-{uuid.uuid4().hex[:8]}",
            "plan_item_id": item.get("id"),
            "type": item.get("type"),
            "description": item.get("description"),
            "code": item.get("code"),
            "pa_required": bool(item.get("pa_required", False)),
            "notes": item.get("notes") or "",
            "status": "ordered",
            "encounter_id": reviewed.get("id"),
        })

    return {
        "encounter": reviewed,
        "orders": orders,
        "history_facts": [
            {
                "kind": "encounter",
                "summary": f"PCP visit reviewed — {reviewed.get('patient_name')}",
                "encounter_id": reviewed.get("id"),
                "assessment": (reviewed.get("soap") or {}).get("assessment"),
            },
            {
                "kind": "orders",
                "summary": f"{len(orders)} order(s) from approved plan",
                "encounter_id": reviewed.get("id"),
                "order_ids": [o["id"] for o in orders],
                "pa_required_count": sum(1 for o in orders if o["pa_required"]),
            },
        ],
    }
