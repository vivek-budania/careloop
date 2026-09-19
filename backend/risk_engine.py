"""Denial risk scoring engine.

Calculates a 0-100 risk score for a given ICD-10 + CPT combination
based on heuristic rules derived from CMS denial patterns.
No ML needed for MVP — this uses a deterministic lookup + rule engine.
"""

import json
import os
from typing import Optional

_DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

# Load denial reasons for risk weights
def _load_denial_reasons() -> list[dict]:
    with open(os.path.join(_DATA_DIR, "denial_reasons.json"), "r") as f:
        return json.load(f)

def _load_cpt_codes() -> list[dict]:
    with open(os.path.join(_DATA_DIR, "cpt_codes.json"), "r") as f:
        return json.load(f)

def _load_icd10_codes() -> list[dict]:
    with open(os.path.join(_DATA_DIR, "icd10_codes.json"), "r") as f:
        return json.load(f)


# --- Risk factor definitions ---
# These are heuristic rules based on CMS patterns.

# CPT categories with historically high denial rates
HIGH_RISK_CPT_CATEGORIES = {
    "Diagnostic Imaging": 0.35,
    "Surgery - Spine": 0.55,
    "Surgery - Orthopedic": 0.40,
    "Surgery - Cardiac": 0.30,
    "Infusion & Injection": 0.45,
    "Mental Health Services": 0.35,
    "DME": 0.50,
    "Radiation Therapy": 0.25,
    "Physical Therapy": 0.20,
}

# ICD-10 categories with higher scrutiny
HIGH_SCRUTINY_ICD_CATEGORIES = {
    "Symptoms": 0.40,       # Unspecified symptom codes get extra scrutiny
    "Mental Health": 0.30,   # Mental health parity issues
    "Musculoskeletal": 0.25, # High volume = high denial
    "Nervous System": 0.20,  # Pain management scrutiny
}

# Specific high-risk combinations (ICD category + CPT category)
RISKY_COMBOS = {
    ("Symptoms", "Diagnostic Imaging"): 0.60,         # Vague symptoms + expensive imaging
    ("Symptoms", "Surgery - Spine"): 0.80,             # Vague symptoms + major surgery
    ("Musculoskeletal", "Surgery - Spine"): 0.50,      # Common but heavily reviewed
    ("Mental Health", "Mental Health Services"): 0.25,  # Parity laws help but still denied
    ("Musculoskeletal", "Diagnostic Imaging"): 0.35,   # Need conservative tx history
    ("Musculoskeletal", "DME"): 0.45,                  # Wheelchair/mobility devices
}

# Codes that are specifically unspecified and draw flags
UNSPECIFIED_CODE_PATTERNS = ["unspecified", "not elsewhere classified", "other"]


def calculate_risk_score(
    icd10_code: str,
    cpt_code: str,
    has_prior_auth: bool = False,
    has_clinical_notes: bool = True,
    is_emergency: bool = False,
) -> dict:
    """Calculate denial risk score for an ICD-10 + CPT combination.

    Args:
        icd10_code: The ICD-10 diagnosis code.
        cpt_code: The CPT/HCPCS procedure code.
        has_prior_auth: Whether prior authorization has been obtained.
        has_clinical_notes: Whether clinical documentation is attached.
        is_emergency: Whether this is an emergency service.

    Returns:
        Dict with score (0-100), risk_level, factors, and recommendations.
    """
    icd_codes = _load_icd10_codes()
    cpt_codes = _load_cpt_codes()

    # Find the matching codes
    icd_match = next((c for c in icd_codes if c["code"] == icd10_code), None)
    cpt_match = next((c for c in cpt_codes if c["code"] == cpt_code), None)

    factors = []
    score = 0.0

    # --- Base risk from CPT category ---
    if cpt_match:
        cpt_cat = cpt_match["category"]
        base_cpt_risk = HIGH_RISK_CPT_CATEGORIES.get(cpt_cat, 0.10)
        score += base_cpt_risk * 30  # Weight: 30% of max
        if base_cpt_risk >= 0.35:
            factors.append(f"High-denial category: {cpt_cat} (historically ~{int(base_cpt_risk*100)}% denial rate)")
    else:
        score += 5
        factors.append(f"CPT code {cpt_code} not in our database — manual review recommended")

    # --- Risk from ICD-10 category ---
    if icd_match:
        icd_cat = icd_match["category"]
        base_icd_risk = HIGH_SCRUTINY_ICD_CATEGORIES.get(icd_cat, 0.10)
        score += base_icd_risk * 20  # Weight: 20% of max

        # Check if it's an unspecified code
        desc_lower = icd_match["description"].lower()
        if any(pat in desc_lower for pat in UNSPECIFIED_CODE_PATTERNS):
            score += 10
            factors.append(f"Diagnosis code is unspecified — use a more specific code to reduce denial risk")
    else:
        score += 5
        factors.append(f"ICD-10 code {icd10_code} not in our database — manual review recommended")

    # --- Combo risk ---
    if icd_match and cpt_match:
        combo_key = (icd_match["category"], cpt_match["category"])
        combo_risk = RISKY_COMBOS.get(combo_key, 0.0)
        if combo_risk > 0:
            score += combo_risk * 25  # Weight: 25% of max
            factors.append(
                f"High-risk combination: {icd_match['category']} diagnosis + {cpt_match['category']} procedure"
            )

    # --- Modifiers ---
    if not has_prior_auth:
        score += 15
        factors.append("No prior authorization — PA is required for most high-cost procedures")

    if not has_clinical_notes:
        score += 10
        factors.append("No clinical notes attached — documentation is critical for approval")

    if is_emergency:
        score -= 15
        factors.append("Emergency service — lower denial risk (retroactive PA often accepted)")

    # Clamp to 0-100
    score = max(0, min(100, round(score)))

    # Determine risk level
    if score <= 25:
        risk_level = "LOW"
        color = "#22c55e"
    elif score <= 50:
        risk_level = "MODERATE"
        color = "#f59e0b"
    elif score <= 75:
        risk_level = "HIGH"
        color = "#f97316"
    else:
        risk_level = "VERY HIGH"
        color = "#ef4444"

    # Generate recommendations
    recommendations = _generate_recommendations(
        score, factors, icd_match, cpt_match, has_prior_auth, has_clinical_notes
    )

    return {
        "score": score,
        "risk_level": risk_level,
        "color": color,
        "factors": factors,
        "recommendations": recommendations,
        "icd10": icd_match,
        "cpt": cpt_match,
    }


def _generate_recommendations(
    score: int,
    factors: list[str],
    icd_match: Optional[dict],
    cpt_match: Optional[dict],
    has_prior_auth: bool,
    has_clinical_notes: bool,
) -> list[str]:
    """Generate actionable recommendations based on risk factors."""
    recs = []

    if not has_prior_auth:
        recs.append("Obtain prior authorization before proceeding — this is the #1 cause of preventable denials.")

    if not has_clinical_notes:
        recs.append("Attach clinical notes, exam findings, and relevant test results to support medical necessity.")

    if icd_match:
        desc_lower = icd_match["description"].lower()
        if any(pat in desc_lower for pat in UNSPECIFIED_CODE_PATTERNS):
            recs.append(
                f"Consider using a more specific ICD-10 code instead of '{icd_match['code']}' — "
                f"unspecified codes have significantly higher denial rates."
            )

    if score >= 50:
        recs.append("Include a Letter of Medical Necessity from the treating physician.")
        recs.append("Document history of conservative treatments tried and failed.")

    if score >= 70:
        recs.append("Consider requesting a peer-to-peer review proactively to strengthen the case.")
        recs.append("Attach relevant peer-reviewed clinical guidelines supporting this treatment plan.")

    if not recs:
        recs.append("Risk is low. Ensure standard documentation is complete and submit normally.")

    return recs
