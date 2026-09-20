"""Hosted Supabase row access for CareLoop (JWT + RLS).

Uses the same SUPABASE_URL / ANON / SERVICE_ROLE env as supabase_auth.py.
Patient JWT for table rows. service_role only for login username lookup
(already in supabase_auth) and failed-login event inserts (no JWT yet).

Missing tables (e.g. logins SQL still on the schema PR) fail soft so login
and Dave coverage keep working. Never stores passwords, card images, letter
bodies, transcripts, or API keys. PA ≠ claim.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlencode

from backend.careloop import supabase_auth

# Stable ids so demo client keys (visit-xxx, rx-seed-metformin) round-trip
# without a client_id column.
_STORE_NS = uuid.UUID("a8e1c0de-ca12-4e10-9b00-c4e100db0001")
_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


class RestError(ValueError):
    def __init__(self, message: str, status: Optional[int] = None, code: str = ""):
        super().__init__(message)
        self.status = status
        self.code = code or ""


def configured() -> bool:
    return supabase_auth.configured()


def is_jwt(token: Optional[str]) -> bool:
    raw = (token or "").strip()
    return bool(raw) and not raw.startswith("v1.") and raw.count(".") >= 2


def user_id_of(user: Optional[dict]) -> str:
    if not user:
        return ""
    return str(user.get("id") or "").strip()


def can_use_store(user: Optional[dict], token: Optional[str]) -> bool:
    return configured() and bool(user_id_of(user)) and is_jwt(token)


def stable_uuid(user_id: str, kind: str, client_id: Optional[str] = None) -> str:
    raw = str(client_id or "").strip()
    if raw and _UUID_RE.match(raw):
        return raw.lower()
    return str(uuid.uuid5(_STORE_NS, f"{user_id}:{kind}:{raw or uuid.uuid4()}"))


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _num(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _text(value: Any, limit: int = 2000) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:limit]


def _date(value: Any) -> Optional[str]:
    raw = str(value or "").strip()
    if not raw:
        return None
    if len(raw) >= 10 and raw[4] == "-" and raw[7] == "-":
        return raw[:10]
    for fmt in ("%B %d, %Y", "%b %d, %Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _filename_only(value: Any) -> Optional[str]:
    raw = str(value or "").strip()
    if not raw or raw.startswith("data:") or "base64," in raw[:80].lower():
        return None
    if len(raw) > 500:
        return None
    name = os.path.basename(raw.replace("\\", "/")).strip()
    return name[:255] or None


def _bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def table_missing(exc: Exception) -> bool:
    text = str(exc or "").lower()
    status = getattr(exc, "status", None)
    code = str(getattr(exc, "code", "") or "")
    if code in ("PGRST205", "PGRST204", "42P01"):
        return True
    if status in (404, 406) and ("schema cache" in text or "does not exist" in text or "not find" in text):
        return True
    return "could not find the table" in text or "does not exist" in text


def _request(
    method: str,
    path: str,
    *,
    token: Optional[str] = None,
    service: bool = False,
    params: Optional[dict] = None,
    body: Any = None,
    extra_headers: Optional[dict] = None,
) -> Any:
    url = f"{supabase_auth.supabase_url()}/rest/v1/{path}"
    if params:
        url = f"{url}?{urlencode(params, doseq=True)}"
    if service:
        key = supabase_auth.service_role_key()
        bearer = key
    else:
        key = supabase_auth.anon_key()
        bearer = token or key
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {bearer}",
        "Accept": "application/json",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if extra_headers:
        headers.update(extra_headers)
    import urllib.error
    import urllib.request

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            if not raw:
                return None
            return json.loads(raw)
    except urllib.error.HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8"))
        except Exception:
            payload = {}
        if isinstance(payload, list) and payload:
            payload = payload[0] if isinstance(payload[0], dict) else {}
        err = ""
        code = ""
        if isinstance(payload, dict):
            code = str(payload.get("code") or "")
            err = (
                payload.get("message")
                or payload.get("hint")
                or payload.get("details")
                or payload.get("error_description")
                or payload.get("msg")
                or ""
            )
        raise RestError(err or f"Supabase request failed ({exc.code}).", status=exc.code, code=code) from None
    except urllib.error.URLError as exc:
        raise RestError("Could not reach Supabase. Check SUPABASE_URL.") from exc


def _select(table: str, params: dict, token: str, *, service: bool = False) -> list[dict]:
    rows = _request("GET", table, token=token, service=service, params=params)
    return rows if isinstance(rows, list) else []


def _insert(table: str, body: dict, token: str, *, service: bool = False) -> Optional[dict]:
    rows = _request(
        "POST",
        table,
        token=token,
        service=service,
        body=body,
        extra_headers={"Prefer": "return=representation"},
    )
    if isinstance(rows, list) and rows:
        return rows[0] if isinstance(rows[0], dict) else None
    return rows if isinstance(rows, dict) else None


def _patch(table: str, row_id: str, body: dict, token: str) -> Optional[dict]:
    rows = _request(
        "PATCH",
        table,
        token=token,
        params={"id": f"eq.{row_id}"},
        body=body,
        extra_headers={"Prefer": "return=representation"},
    )
    if isinstance(rows, list) and rows:
        return rows[0] if isinstance(rows[0], dict) else None
    return rows if isinstance(rows, dict) else None


def _delete_ids(table: str, user_id: str, ids: list[str], token: str) -> None:
    if not ids:
        return
    _request(
        "DELETE",
        table,
        token=token,
        params={"user_id": f"eq.{user_id}", "id": f"in.({','.join(ids)})"},
    )


def _safe_select(table: str, params: dict, token: str) -> tuple[list[dict], bool]:
    """Return (rows, available). available is False when the table is missing."""
    try:
        return _select(table, params, token), True
    except RestError as exc:
        if table_missing(exc):
            return [], False
        raise


def insert_login_event(
    *,
    user_id: str,
    username: str,
    success: bool,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    token: Optional[str] = None,
) -> None:
    """Append-only sign-in event. No password column. Failed attempts use service_role."""
    if not configured() or not user_id:
        return
    body = {
        "user_id": user_id,
        "username": _text(username, 80),
        "logged_in_at": _now(),
        "ip": _text(ip, 64),
        "user_agent": _text(user_agent, 512),
        "success": bool(success),
    }
    use_service = not (success and is_jwt(token))
    try:
        _insert("logins", body, token or "", service=use_service)
    except RestError:
        return


def current_insurance(user_id: str, token: str) -> tuple[Optional[dict], bool]:
    rows, available = _safe_select(
        "insurance",
        {
            "select": "*",
            "user_id": f"eq.{user_id}",
            "is_current": "eq.true",
            "limit": "1",
        },
        token,
    )
    if not available:
        return None, False
    return (rows[0] if rows else None), True


def _strip_raw_eligibility(eligibility: Optional[dict]) -> Optional[dict]:
    if not isinstance(eligibility, dict):
        return None
    out = {}
    for key, value in eligibility.items():
        if key in ("live_api", "x12", "raw_271", "raw_x12"):
            continue
        if isinstance(value, (str, int, float, bool)) or value is None:
            out[key] = value
        elif isinstance(value, (list, dict)):
            try:
                json.dumps(value)
            except TypeError:
                continue
            out[key] = value
    return out or None


def coverage_to_insurance_row(
    user_id: str,
    snap: dict,
    *,
    confirmed: bool,
) -> Optional[dict]:
    profile = (snap or {}).get("profile") or {}
    eligibility = (snap or {}).get("eligibility") or {}
    payer_name = _text(profile.get("payer_name"), 120)
    if not payer_name:
        return None
    source = str((snap or {}).get("source") or eligibility.get("source") or "").strip().lower()
    if source not in ("mock", "stedi"):
        source = None
    unreadable = profile.get("unreadable")
    if not isinstance(unreadable, list):
        unreadable = eligibility.get("unreadable") if isinstance(eligibility.get("unreadable"), list) else []
    warnings = profile.get("warnings")
    if warnings is None:
        warnings = eligibility.get("warnings")
    row = {
        "user_id": user_id,
        "is_current": True,
        "payer_id": _text(profile.get("payer_id"), 80),
        "payer_name": payer_name,
        "plan_type": _text(profile.get("plan_type") or eligibility.get("plan_type"), 80),
        "network_name": _text(profile.get("network_name") or eligibility.get("network_name"), 120),
        "member_name": _text(profile.get("member_name"), 120),
        "member_id": _text(profile.get("member_id"), 80),
        "group_number": _text(profile.get("group_number"), 80),
        "date_of_birth": _date(profile.get("date_of_birth")),
        "zip": _text(profile.get("zip"), 16),
        "unreadable": [str(item) for item in unreadable][:20] if unreadable else None,
        "warnings": warnings if isinstance(warnings, (dict, list)) else None,
        "updated_at": _now(),
    }
    if confirmed:
        row["eligibility_status"] = _text(eligibility.get("status"), 40)
        row["estimated_copay_pcp"] = _num(eligibility.get("estimated_copay_pcp"))
        row["estimated_copay_specialist"] = _num(eligibility.get("estimated_copay_specialist"))
        row["coinsurance_pct"] = _num(eligibility.get("coinsurance_pct"))
        row["deductible"] = _num(eligibility.get("deductible"))
        row["deductible_remaining"] = _num(eligibility.get("deductible_remaining"))
        row["oop_remaining"] = _num(eligibility.get("oop_remaining"))
        row["raw_eligibility"] = _strip_raw_eligibility(eligibility)
        row["source"] = source or "mock"
        row["confirmed_at"] = _now()
    else:
        row["eligibility_status"] = None
        row["estimated_copay_pcp"] = None
        row["estimated_copay_specialist"] = None
        row["coinsurance_pct"] = None
        row["deductible"] = None
        row["deductible_remaining"] = None
        row["oop_remaining"] = None
        row["raw_eligibility"] = None
        row["source"] = None
        row["confirmed_at"] = None
    return row


def insurance_row_to_coverage(row: dict) -> tuple[dict, Optional[dict]]:
    raw = row.get("raw_eligibility") if isinstance(row.get("raw_eligibility"), dict) else {}
    profile = {
        "payer_id": row.get("payer_id") or "",
        "payer_name": row.get("payer_name") or "",
        "plan_type": row.get("plan_type") or raw.get("plan_type") or "",
        "network_name": row.get("network_name") or raw.get("network_name") or "",
        "member_name": row.get("member_name") or "",
        "member_id": row.get("member_id") or "",
        "group_number": row.get("group_number") or "",
        "date_of_birth": row.get("date_of_birth") or "",
        "zip": row.get("zip") or "",
        "unreadable": row.get("unreadable") or [],
        "warnings": row.get("warnings"),
        "scan_source": None,
        "supporting_docs": [],
    }
    status = row.get("eligibility_status") or raw.get("status")
    if not status and not row.get("confirmed_at"):
        return profile, None
    eligibility = {
        **raw,
        "status": status,
        "plan_type": profile["plan_type"] or raw.get("plan_type"),
        "network_name": profile["network_name"] or raw.get("network_name"),
        "estimated_copay_pcp": _num(row.get("estimated_copay_pcp") if row.get("estimated_copay_pcp") is not None else raw.get("estimated_copay_pcp")),
        "estimated_copay_specialist": _num(
            row.get("estimated_copay_specialist")
            if row.get("estimated_copay_specialist") is not None
            else raw.get("estimated_copay_specialist")
        ),
        "coinsurance_pct": _num(row.get("coinsurance_pct") if row.get("coinsurance_pct") is not None else raw.get("coinsurance_pct")),
        "deductible": _num(row.get("deductible") if row.get("deductible") is not None else raw.get("deductible")),
        "deductible_remaining": _num(
            row.get("deductible_remaining") if row.get("deductible_remaining") is not None else raw.get("deductible_remaining")
        ),
        "oop_remaining": _num(row.get("oop_remaining") if row.get("oop_remaining") is not None else raw.get("oop_remaining")),
        "source": row.get("source") or raw.get("source") or "mock",
        "confirmed_at": row.get("confirmed_at"),
        "disclaimer": raw.get("disclaimer")
        or "Labeled estimate from your saved plan. Not a coverage decision, bill, or prior authorization.",
    }
    return profile, eligibility


def upsert_insurance(user_id: str, token: str, snap: dict, *, confirmed: bool) -> Optional[dict]:
    body = coverage_to_insurance_row(user_id, snap, confirmed=confirmed)
    if not body:
        return None
    try:
        current, available = current_insurance(user_id, token)
        if not available:
            return None
        if current and current.get("id"):
            return _patch("insurance", str(current["id"]), body, token)
        return _insert("insurance", body, token)
    except RestError as exc:
        if table_missing(exc):
            return None
        raise


def visit_from_client(user_id: str, item: dict) -> Optional[dict]:
    name = _text(item.get("reason") or item.get("title") or "Visit", 240)
    if not name:
        return None
    soap = item.get("soap") if isinstance(item.get("soap"), dict) else None
    if soap:
        soap = {
            "subjective": _text(soap.get("subjective"), 4000) or "",
            "objective": _text(soap.get("objective"), 4000) or "",
            "assessment": _text(soap.get("assessment"), 4000) or "",
            "plan_summary": _text(soap.get("plan_summary"), 4000) or "",
        }
    return {
        "id": stable_uuid(user_id, "visit", item.get("id")),
        "user_id": user_id,
        "visit_date": _date(item.get("visit_date") or item.get("date")),
        "reason": name,
        "clinician_name": _text(item.get("clinician_name") or item.get("doctor"), 160),
        "clinic": _text(item.get("clinic"), 160),
        "summary": _text(item.get("summary"), 4000),
        "soap": soap,
        "reviewed": _bool(item.get("reviewed"), False),
        "coverage_label": _text(item.get("coverage_label") or item.get("coverage"), 80),
    }


def visit_to_client(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "date": row.get("visit_date") or "",
        "reason": row.get("reason") or "Visit",
        "doctor": row.get("clinician_name") or "",
        "clinic": row.get("clinic") or "",
        "reviewed": _bool(row.get("reviewed"), False),
        "summary": row.get("summary") or "",
        "coverage": row.get("coverage_label") or "",
        "soap": row.get("soap") if isinstance(row.get("soap"), dict) else None,
        "new_symptoms": "",
        "new_symptoms_log": [],
        "care": {"prescriptions": [], "tests": []},
    }


def intake_from_client(user_id: str, item: dict, visit_ids: set[str]) -> Optional[dict]:
    row_id = stable_uuid(user_id, "intake", item.get("id"))
    completed = item.get("completed_visit_id") or (item.get("completed") and item.get("id"))
    completed_id = None
    if completed:
        completed_id = stable_uuid(user_id, "visit", completed)
        if completed_id not in visit_ids:
            completed_id = None
    guess = item.get("visit_cost_guess")
    if guess is not None and not isinstance(guess, dict):
        guess = None
    status = _text(item.get("status"), 40) or ("completed" if completed_id else "open")
    return {
        "id": row_id,
        "user_id": user_id,
        "completed_visit_id": completed_id,
        "status": status,
        "symptoms": _text(item.get("symptoms") or item.get("reason"), 4000),
        "suggested_specialty": _text(item.get("suggested_specialty") or item.get("network_specialty"), 80),
        "clinician_name": _text(item.get("clinician_name") or item.get("doctor"), 160),
        "clinic": _text(item.get("clinic"), 160),
        "slot": _text(item.get("slot"), 160),
        "visit_cost_guess": guess,
        "updated_at": _now(),
    }


def intake_to_client(row: dict) -> dict:
    booked = bool(row.get("slot") or row.get("clinician_name"))
    status = row.get("status") or "open"
    return {
        "id": row.get("id"),
        "symptoms": row.get("symptoms") or "",
        "suggested_specialty": row.get("suggested_specialty") or "",
        "doctor": row.get("clinician_name") or "",
        "clinic": row.get("clinic") or "",
        "slot": row.get("slot") or "",
        "booked": booked,
        "completed": status != "open" or bool(row.get("completed_visit_id")),
        "completed_visit_id": row.get("completed_visit_id"),
        "status": status,
        "step": 4 if booked else (3 if row.get("clinician_name") else 1),
        "visit_cost_guess": row.get("visit_cost_guess") if isinstance(row.get("visit_cost_guess"), dict) else None,
        "new_symptoms": "",
        "new_symptoms_log": [],
    }


def medicine_from_client(user_id: str, item: dict, *, doses: Optional[dict], refill: bool) -> Optional[dict]:
    name = _text(item.get("name") or item.get("description"), 160)
    if not name:
        return None
    schedule = item.get("schedule")
    if schedule is True and isinstance(doses, dict):
        schedule = doses
    elif not isinstance(schedule, dict):
        schedule = None
    visit_id = item.get("visit_id")
    return {
        "id": stable_uuid(user_id, "medicine", item.get("id") or name),
        "user_id": user_id,
        "visit_id": stable_uuid(user_id, "visit", visit_id) if visit_id else None,
        "name": name,
        "dose": _text(item.get("dose") or item.get("notes"), 240),
        "times_per_day": int(item["times_per_day"]) if str(item.get("times_per_day") or "").isdigit() else (2 if schedule else None),
        "schedule": schedule,
        "sig": _text(item.get("sig") or item.get("notes"), 400),
        "refill_days_left": int(item["refill_days_left"]) if str(item.get("refill_days_left") or "").isdigit() else None,
        "refill_requested": _bool(item.get("refill_requested"), refill if schedule else False),
        "status": _text(item.get("status"), 40),
        "updated_at": _now(),
    }


def medicine_to_client(row: dict) -> dict:
    schedule = row.get("schedule")
    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "notes": row.get("dose") or row.get("sig") or "",
        "dose": row.get("dose") or "",
        "times_per_day": row.get("times_per_day"),
        "status": row.get("status") or "active",
        "source": "hosted",
        "schedule": bool(schedule) or None,
        "schedule_log": schedule if isinstance(schedule, dict) else None,
        "refill_requested": _bool(row.get("refill_requested"), False),
        "visit_id": row.get("visit_id"),
    }


def test_from_client(user_id: str, item: dict) -> Optional[dict]:
    name = _text(item.get("name"), 160)
    if not name:
        return None
    visit_id = item.get("visit_id")
    filename = _filename_only(item.get("document_filename") or item.get("filename"))
    when = _date(item.get("result_at") or item.get("date")) if (item.get("kind") == "result" or item.get("status") == "result on file") else None
    ordered = _date(item.get("ordered_at") or (item.get("date") if item.get("kind") != "result" else None))
    return {
        "id": stable_uuid(user_id, "test", item.get("id") or name),
        "user_id": user_id,
        "visit_id": stable_uuid(user_id, "visit", visit_id) if visit_id else None,
        "name": name,
        "status": _text(item.get("status"), 80),
        "summary": _text(item.get("summary") or item.get("notes"), 2000),
        "document_filename": filename,
        "ordered_at": ordered,
        "result_at": when,
        "updated_at": _now(),
    }


def test_to_client(row: dict) -> dict:
    result = bool(row.get("result_at") or (row.get("status") or "").lower().find("result") >= 0)
    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "date": row.get("result_at") or row.get("ordered_at") or "",
        "kind": "result" if result else "order",
        "status": row.get("status") or ("result on file" if result else "To schedule"),
        "source": "hosted",
        "notes": row.get("summary") or "",
        "filename": row.get("document_filename") or "",
        "visit_id": row.get("visit_id"),
    }


def claim_from_client(user_id: str, item: dict) -> Optional[dict]:
    """Mock EOB only. Not a PA/appeal letter body."""
    service = _text(item.get("service_name") or item.get("name"), 160)
    if not service and item.get("eob_summary") is None and item.get("status") is None:
        return None
    visit_id = item.get("visit_id")
    return {
        "id": stable_uuid(user_id, "claim", item.get("id") or service or "claim"),
        "user_id": user_id,
        "visit_id": stable_uuid(user_id, "visit", visit_id) if visit_id else None,
        "service_name": service,
        "status": _text(item.get("status"), 80),
        "billed_amount": _num(item.get("billed_amount")),
        "patient_owes": _num(item.get("patient_owes")),
        "eob_summary": _text(item.get("eob_summary"), 2000),
        "source": "mock",
        "updated_at": _now(),
    }


def claim_to_client(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "service_name": row.get("service_name") or "",
        "status": row.get("status") or "",
        "billed_amount": _num(row.get("billed_amount")),
        "patient_owes": _num(row.get("patient_owes")),
        "eob_summary": row.get("eob_summary") or "",
        "source": row.get("source") or "mock",
        "visit_id": row.get("visit_id"),
    }


def _replace_open_intakes(user_id: str, token: str, rows: list[dict]) -> tuple[list[dict], bool]:
    """Upsert in-progress journeys. Do not delete completed History-linked rows."""
    existing, available = _safe_select(
        "intakes",
        {"select": "id,status,completed_visit_id", "user_id": f"eq.{user_id}"},
        token,
    )
    if not available:
        return [], False
    open_ids = {
        str(row.get("id"))
        for row in existing
        if row.get("id") and (row.get("status") or "open") == "open" and not row.get("completed_visit_id")
    }
    incoming_ids = {str(row.get("id")) for row in rows if row.get("id")}
    written: list[dict] = []
    existing_ids = {str(row.get("id")) for row in existing if row.get("id")}
    for row in rows:
        row_id = str(row.get("id") or "")
        try:
            if row_id and row_id in existing_ids:
                saved = _patch("intakes", row_id, {k: v for k, v in row.items() if k != "id"}, token)
            else:
                saved = _insert("intakes", row, token)
            if saved:
                written.append(saved)
            else:
                written.append(row)
        except RestError as exc:
            if table_missing(exc):
                return [], False
            raise
    gone = [item for item in open_ids if item not in incoming_ids]
    if gone:
        try:
            _delete_ids("intakes", user_id, gone, token)
        except RestError as exc:
            if not table_missing(exc):
                raise
    return written, True


def _replace_table(
    table: str,
    user_id: str,
    token: str,
    rows: list[dict],
) -> tuple[list[dict], bool]:
    existing, available = _safe_select(
        table,
        {"select": "id", "user_id": f"eq.{user_id}"},
        token,
    )
    if not available:
        return [], False
    existing_ids = {str(row.get("id")) for row in existing if row.get("id")}
    incoming_ids = {str(row.get("id")) for row in rows if row.get("id")}
    written: list[dict] = []
    for row in rows:
        row_id = str(row.get("id") or "")
        try:
            if row_id and row_id in existing_ids:
                saved = _patch(table, row_id, {k: v for k, v in row.items() if k != "id"}, token)
            else:
                saved = _insert(table, row, token)
            if saved:
                written.append(saved)
            else:
                written.append(row)
        except RestError as exc:
            if table_missing(exc):
                return [], False
            raise
    gone = [item for item in existing_ids if item not in incoming_ids]
    if gone:
        try:
            _delete_ids(table, user_id, gone, token)
        except RestError as exc:
            if not table_missing(exc):
                raise
    return written, True


def load_records(user_id: str, token: str) -> dict:
    tables = {
        "visits": True,
        "intakes": True,
        "medicines": True,
        "tests": True,
        "claims": True,
        "insurance": True,
    }
    visits_rows, tables["visits"] = _safe_select(
        "visits",
        {"select": "*", "user_id": f"eq.{user_id}", "order": "visit_date.desc.nullslast,created_at.desc"},
        token,
    )
    intakes_rows, tables["intakes"] = _safe_select(
        "intakes",
        {"select": "*", "user_id": f"eq.{user_id}", "order": "updated_at.desc"},
        token,
    )
    medicines_rows, tables["medicines"] = _safe_select(
        "medicines",
        {"select": "*", "user_id": f"eq.{user_id}", "order": "created_at.desc"},
        token,
    )
    tests_rows, tables["tests"] = _safe_select(
        "tests",
        {"select": "*", "user_id": f"eq.{user_id}", "order": "created_at.desc"},
        token,
    )
    claims_rows, tables["claims"] = _safe_select(
        "claims",
        {"select": "*", "user_id": f"eq.{user_id}", "order": "created_at.desc"},
        token,
    )
    insurance_row, tables["insurance"] = current_insurance(user_id, token)
    medicines = [medicine_to_client(row) for row in medicines_rows]
    doses = {}
    refill = False
    for row, mapped in zip(medicines_rows, medicines):
        if isinstance(row.get("schedule"), dict) and not doses:
            doses = row["schedule"]
        if mapped.get("refill_requested"):
            refill = True
    return {
        "store": "supabase",
        "tables": tables,
        "insurance_current": bool(insurance_row),
        "visits": [visit_to_client(row) for row in visits_rows],
        "intakes": [intake_to_client(row) for row in intakes_rows if (row.get("status") or "open") == "open" and not row.get("completed_visit_id")],
        "medicines": medicines,
        "tests": [test_to_client(row) for row in tests_rows],
        "claims": [claim_to_client(row) for row in claims_rows],
        "doses": doses or {"morning": "upcoming", "evening": "upcoming"},
        "refill": refill,
    }


def save_records(user_id: str, token: str, payload: dict) -> dict:
    visits_in = [visit_from_client(user_id, item) for item in (payload.get("visits") or [])]
    visits_in = [row for row in visits_in if row]
    visit_ids = {str(row["id"]) for row in visits_in}
    saved_visits, visits_ok = _replace_table("visits", user_id, token, visits_in)
    if visits_ok:
        visit_ids |= {str(row.get("id")) for row in saved_visits if row.get("id")}

    intakes_in = [intake_from_client(user_id, item, visit_ids) for item in (payload.get("intakes") or [])]
    intakes_in = [row for row in intakes_in if row]
    saved_intakes, intakes_ok = _replace_open_intakes(user_id, token, intakes_in)

    doses = payload.get("doses") if isinstance(payload.get("doses"), dict) else None
    refill = _bool(payload.get("refill"), False)
    medicines_in = [
        medicine_from_client(user_id, item, doses=doses, refill=refill)
        for item in (payload.get("medicines") or payload.get("prescriptions") or [])
    ]
    medicines_in = [row for row in medicines_in if row]
    for row in medicines_in:
        if row.get("visit_id") and row["visit_id"] not in visit_ids:
            row["visit_id"] = None
    saved_meds, meds_ok = _replace_table("medicines", user_id, token, medicines_in)

    tests_in = [test_from_client(user_id, item) for item in (payload.get("tests") or payload.get("testRecords") or [])]
    tests_in = [row for row in tests_in if row]
    for row in tests_in:
        if row.get("visit_id") and row["visit_id"] not in visit_ids:
            row["visit_id"] = None
    saved_tests, tests_ok = _replace_table("tests", user_id, token, tests_in)

    claims_in = [claim_from_client(user_id, item) for item in (payload.get("claims") or [])]
    claims_in = [row for row in claims_in if row]
    for row in claims_in:
        if row.get("visit_id") and row["visit_id"] not in visit_ids:
            row["visit_id"] = None
    saved_claims, claims_ok = _replace_table("claims", user_id, token, claims_in)

    return {
        "store": "supabase",
        "tables": {
            "visits": visits_ok,
            "intakes": intakes_ok,
            "medicines": meds_ok,
            "tests": tests_ok,
            "claims": claims_ok,
        },
        "visits": [visit_to_client(row) for row in saved_visits],
        "intakes": [intake_to_client(row) for row in saved_intakes if (row.get("status") or "open") == "open" and not row.get("completed_visit_id")],
        "medicines": [medicine_to_client(row) for row in saved_meds],
        "tests": [test_to_client(row) for row in saved_tests],
        "claims": [claim_to_client(row) for row in saved_claims],
    }


def local_records() -> dict:
    return {
        "store": "local",
        "tables": {
            "visits": False,
            "intakes": False,
            "medicines": False,
            "tests": False,
            "claims": False,
            "insurance": False,
        },
        "insurance_current": False,
        "visits": [],
        "intakes": [],
        "medicines": [],
        "tests": [],
        "claims": [],
        "doses": {"morning": "upcoming", "evening": "upcoming"},
        "refill": False,
    }
