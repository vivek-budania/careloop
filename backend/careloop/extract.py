"""Card / SBC image readability. Gemini vision → InsuranceProfile JSON.

No letter watermark. Never invent copays or member IDs. Fixture scan stays
in coverage.scan_card for the no-key golden path.
"""

from __future__ import annotations

import base64
import json
import os
import re
from typing import Any, Optional

from backend.config import GEMINI_API_KEY
from backend.llm import generate_json
from backend.prompts import CARD_EXTRACT_PROMPT

ALLOWED_MIMES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
}
MAX_BYTES = 8 * 1024 * 1024
PROFILE_KEYS = (
    "payer_name",
    "member_name",
    "member_id",
    "group_number",
    "date_of_birth",
    "zip",
    "plan_type",
    "rx_bin",
    "rx_pcn",
    "rx_group",
)


def gemini_configured() -> bool:
    key = (os.getenv("GEMINI_API_KEY") or GEMINI_API_KEY or "").strip()
    return bool(key) and key != "your_api_key_here"


def decode_upload(b64: str, mime: str, filename: str) -> dict:
    raw = (b64 or "").strip()
    if not raw:
        raise ValueError("Empty upload.")
    if raw.startswith("data:") and "," in raw:
        header, raw = raw.split(",", 1)
        guessed = re.search(r"data:([^;]+)", header)
        if guessed and not mime:
            mime = guessed.group(1)
    mime = (mime or "").split(";")[0].strip().lower()
    if mime == "image/jpg":
        mime = "image/jpeg"
    if mime not in ALLOWED_MIMES:
        raise ValueError(f"Unsupported file type {mime or filename or '(unknown)'}. Use a card photo or PDF.")
    try:
        data = base64.b64decode(raw, validate=False)
    except Exception as exc:
        raise ValueError("Could not decode the uploaded file.") from exc
    if not data:
        raise ValueError("Uploaded file was empty.")
    if len(data) > MAX_BYTES:
        raise ValueError("Upload is too large (max 8MB).")
    return {"mime_type": mime, "data": data, "filename": filename or "upload"}


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.lower() in ("null", "none", "n/a", "unknown"):
        return ""
    return text


def _money(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return round(float(str(value).replace(",", "").replace("$", "")), 2)
    except (TypeError, ValueError):
        return None


def _normalize_dob(value: str) -> str:
    text = _clean_text(value)
    if not text:
        return ""
    digits = re.sub(r"\D", "", text)
    if len(digits) == 8:
        if digits.startswith(("19", "20")):
            return f"{digits[0:4]}-{digits[4:6]}-{digits[6:8]}"
        return f"{digits[4:8]}-{digits[0:2]}-{digits[2:4]}"
    if re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        return text
    return text


def parse_extracted(raw: str) -> dict:
    blob = (raw or "").strip()
    if blob.startswith("```"):
        blob = re.sub(r"^```(?:json)?\s*", "", blob)
        blob = re.sub(r"\s*```$", "", blob)
    parsed = json.loads(blob)
    if not isinstance(parsed, dict):
        raise ValueError("Extractor did not return a JSON object.")
    out = {key: _clean_text(parsed.get(key)) for key in PROFILE_KEYS}
    out["date_of_birth"] = _normalize_dob(out.get("date_of_birth") or "")
    out["printed_copay_pcp"] = _money(parsed.get("printed_copay_pcp"))
    out["printed_copay_specialist"] = _money(parsed.get("printed_copay_specialist"))
    unread = parsed.get("unreadable") or []
    warnings = parsed.get("warnings") or []
    out["unreadable"] = [str(item) for item in unread if item]
    out["warnings"] = [str(item) for item in warnings if item]
    for field in out["unreadable"]:
        tag = f"[NEEDS VERIFICATION] {field} was unreadable on the upload."
        if tag not in out["warnings"]:
            out["warnings"].append(tag)
    return out


def extract_documents(
    *,
    card: Optional[dict] = None,
    sbc: Optional[dict] = None,
) -> dict:
    if not gemini_configured():
        raise ValueError(
            "GEMINI_API_KEY is not set. Inject it at container launch to read "
            "uploaded cards, or use Load sample card for the fixture path."
        )
    media = []
    labels = []
    if card:
        media.append({"mime_type": card["mime_type"], "data": card["data"]})
        labels.append(f"insurance card ({card.get('filename') or 'card'})")
    if sbc:
        media.append({"mime_type": sbc["mime_type"], "data": sbc["data"]})
        labels.append(f"SBC/EOB ({sbc.get('filename') or 'sbc'})")
    if not media:
        raise ValueError("Attach a card image or SBC/EOB to read.")

    user_message = (
        "Extract InsuranceProfile fields from the attached document(s): "
        + ", ".join(labels)
        + ". Use only visible text."
    )
    raw = generate_json(CARD_EXTRACT_PROMPT, user_message, media=media)
    try:
        return parse_extracted(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        raise ValueError("Could not parse card fields from the model output.") from exc
