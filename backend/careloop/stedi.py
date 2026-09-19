"""Optional Stedi sandbox 270/271 for CareLoop step 3.

Put the Stedi *test* key in local `.env` as STEDI_API_KEY (gitignored).
Never commit it, never paste it in chat, never use a production key.

Sandbox only accepts Stedi's canned members. CareLoop's Aetna fixture is
Jane Doe / AETNA12345 / 2004-04-04 / payerId 60054 — the member Dave
confirmed in the Stedi portal.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Optional

from backend.config import STEDI_API_KEY

STEDI_ELIGIBILITY_URL = "https://healthcare.us.stedi.com/2026-06-01/eligibility-check"
DEMO_PROVIDER_NPI = "1999999984"
DEMO_PROVIDER_NAME = "CareLoop Demo Clinic"

# Office-visit-ish STCs used when picking a copay from a 271.
_OFFICE_STCS = {"98", "96", "92", "1", "48", "50", "23"}
_PLAN_STCS = {"30", ""}


def configured() -> bool:
    key = (STEDI_API_KEY or "").strip()
    return bool(key) and key not in ("your_api_key_here", "your_stedi_key_here")


def is_test_key() -> bool:
    raw = _raw_key()
    return raw.startswith("test_")


def status() -> dict:
    if not configured():
        return {
            "configured": False,
            "test_mode": False,
            "message": (
                "STEDI_API_KEY is not set. Put your Stedi *test* key in local "
                ".env (gitignored). Do not paste it in chat or commit it."
            ),
        }
    if not is_test_key():
        return {
            "configured": True,
            "test_mode": False,
            "message": (
                "STEDI_API_KEY is set but is not a test_ key. CareLoop will not "
                "call production eligibility. Use the sandbox test key locally."
            ),
        }
    return {
        "configured": True,
        "test_mode": True,
        "message": (
            "Stedi test key loaded from .env. Aetna + Jane Doe / AETNA12345 "
            "is the canned sandbox member."
        ),
    }


def _raw_key() -> str:
    key = (STEDI_API_KEY or "").strip()
    if key.lower().startswith("key "):
        return key[4:].strip()
    return key


def _auth_header() -> str:
    raw = _raw_key()
    return f"Key {raw}"


def _money(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return round(float(str(value).replace(",", "").replace("$", "")), 2)
    except (TypeError, ValueError):
        return None


def _split_name(member_name: str) -> tuple[str, str]:
    parts = [p for p in (member_name or "").strip().split() if p]
    if not parts:
        return "Jane", "Doe"
    if len(parts) == 1:
        return parts[0], "Doe"
    return parts[0], parts[-1]


def _network_indicator(row: dict) -> str:
    net = row.get("network") or {}
    if isinstance(net, dict):
        return str(net.get("indicator") or "").upper()
    return str(net or "").upper()


def _is_inn(row: dict) -> bool:
    ind = _network_indicator(row)
    return ind in ("IN_NETWORK", "IN_AND_OUT_OF_NETWORK", "Y", "W", "")


def _is_oon(row: dict) -> bool:
    return _network_indicator(row) in ("OUT_OF_NETWORK", "N")


def _stc(row: dict) -> str:
    service = row.get("service") or {}
    if isinstance(service, dict):
        return str(service.get("value") or service.get("code") or "")
    return ""


def _service_text(row: dict) -> str:
    service = row.get("service") or {}
    bits = []
    if isinstance(service, dict):
        bits.append(str(service.get("definition") or ""))
    msgs = row.get("messages") or []
    if isinstance(msgs, list):
        bits.extend(str(m) for m in msgs)
    return " ".join(bits).lower()


def _time_period(row: dict) -> str:
    return str(row.get("timePeriod") or row.get("timeQualifier") or "").upper()


def _is_remaining(row: dict) -> bool:
    period = _time_period(row)
    if "REMAIN" in period:
        return True
    if str(row.get("timePeriodCode") or row.get("timeQualifierCode") or "") == "29":
        return True
    return False


def _is_annual(row: dict) -> bool:
    period = _time_period(row)
    return period in ("CALENDAR_YEAR", "YEAR", "SERVICE_YEAR", "") or str(
        row.get("timePeriodCode") or row.get("timeQualifierCode") or ""
    ) in ("23", "22", "")


def _coverage_level(row: dict) -> str:
    return str(row.get("coverageLevel") or "").upper()


def _prefer_individual(rows: list[dict]) -> list[dict]:
    individual = [r for r in rows if "INDIVIDUAL" in _coverage_level(r) or _coverage_level(r) in ("", "IND")]
    return individual or rows


def _plan_stc_rows(rows: list[dict]) -> list[dict]:
    plan = [r for r in rows if _stc(r) in _PLAN_STCS]
    return plan or rows


def _pick_amount(rows: list[dict], *, inn: bool = True, remaining: bool = False) -> Optional[float]:
    pool = [r for r in rows if (_is_inn(r) if inn else _is_oon(r))]
    pool = _prefer_individual(pool)
    pool = _plan_stc_rows(pool)
    if remaining:
        rem = [r for r in pool if _is_remaining(r)]
        if rem:
            pool = rem
        else:
            # Some 271s only send the annual amount; unused deductible == remaining.
            annual = [r for r in pool if _is_annual(r) and not _is_remaining(r)]
            pool = annual or pool
    else:
        annual = [r for r in pool if _is_annual(r) and not _is_remaining(r)]
        pool = annual or [r for r in pool if not _is_remaining(r)] or pool
    for row in pool:
        amount = _money(row.get("amount") or row.get("remaining") or row.get("amountRemaining"))
        if amount is not None:
            return amount
    return None


def _pick_copay(rows: list[dict], *, specialist: bool = False) -> Optional[float]:
    inn = [r for r in rows if _is_inn(r)]
    inn = _prefer_individual(inn)
    scored: list[tuple[int, dict]] = []
    for row in inn:
        text = _service_text(row)
        stc = _stc(row)
        score = 0
        if specialist:
            if "specialist" in text:
                score += 5
        else:
            if "pcp" in text or "primary" in text:
                score += 6
            if "office" in text or "physician" in text:
                score += 4
            if stc in _OFFICE_STCS:
                score += 3
        if stc in _OFFICE_STCS:
            score += 1
        amount = _money(row.get("amount"))
        if amount is None:
            continue
        # Copays are visit-sized, not hospital thousands.
        if amount > 400:
            continue
        scored.append((score, row))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    if not scored:
        return None
    if specialist:
        best = next((row for score, row in scored if score >= 5), None)
        return _money((best or {}).get("amount")) if best else None
    return _money(scored[0][1].get("amount"))


def _pick_coins(rows: list[dict]) -> Optional[float]:
    inn = _prefer_individual([r for r in rows if _is_inn(r)])
    inn = _plan_stc_rows(inn)
    for row in inn:
        pct = _money(row.get("percent") or row.get("percentage"))
        if pct is None:
            continue
        # Stedi sometimes sends 0.2 meaning 20%.
        if 0 < pct < 1:
            pct = round(pct * 100, 2)
        return pct
    return None


def _plans(payload: dict) -> list[dict]:
    plans = payload.get("plans")
    if isinstance(plans, list) and plans:
        return [p for p in plans if isinstance(p, dict)]
    benefits = payload.get("benefits")
    if isinstance(benefits, dict):
        return [{"benefits": benefits}]
    return []


def flatten_eligibility(payload: dict, payer: dict, profile: dict) -> dict:
    """Map a Stedi 2026-06-01 JSON 271 into CareLoop's coverage card. Ignores x12."""
    plans = _plans(payload)
    benefits: dict = {}
    status_rows: list[dict] = []
    copays: list[dict] = []
    deductibles: list[dict] = []
    oops: list[dict] = []
    coins: list[dict] = []
    plan_name = payer.get("network_name") or payer.get("name") or ""
    plan_type = payer.get("plan_type") or ""
    active = bool(payer.get("active", True))

    for plan in plans:
        block = plan.get("benefits") or {}
        if not isinstance(block, dict):
            continue
        if not benefits:
            benefits = block
        status_rows.extend(block.get("statuses") or [])
        copays.extend(block.get("coPayment") or block.get("copayment") or [])
        deductibles.extend(block.get("deductible") or [])
        oops.extend(block.get("outOfPocket") or block.get("outOfPocketMaximum") or [])
        coins.extend(block.get("coInsurance") or block.get("coinsurance") or [])

    for row in status_rows:
        st = str(row.get("status") or "").upper()
        if st in ("ACTIVE_COVERAGE", "ACTIVE"):
            active = True
        elif st in ("INACTIVE", "INACTIVE_COVERAGE"):
            active = False
        desc = row.get("planCoverageDescription") or row.get("planName")
        if desc:
            plan_name = str(desc)
        ins = str(row.get("insuranceType") or "")
        if "PPO" in ins.upper() or "PREFERRED_PROVIDER" in ins.upper():
            plan_type = "PPO"
        elif "HMO" in ins.upper() or "HEALTH_MAINTENANCE" in ins.upper():
            plan_type = "HMO"
        elif "EPO" in ins.upper():
            plan_type = "EPO"

    inn_ded = _pick_amount(deductibles, inn=True, remaining=False)
    inn_ded_rem = _pick_amount(deductibles, inn=True, remaining=True)
    if inn_ded_rem is None:
        inn_ded_rem = inn_ded
    oon_ded = _pick_amount(deductibles, inn=False, remaining=False)
    oop_max = _pick_amount(oops, inn=True, remaining=False)
    oop_rem = _pick_amount(oops, inn=True, remaining=True)
    if oop_rem is None:
        oop_rem = oop_max

    office = _pick_copay(copays, specialist=False)
    specialist = _pick_copay(copays, specialist=True)
    coins_pct = _pick_coins(coins)

    check_id = payload.get("id") or payload.get("eligibilitySearchId")

    return {
        "status": "active" if active else "inactive",
        "in_network": bool(active),
        "as_of": "2026-09-19",
        "source": "stedi",
        "plan_type": plan_type,
        "network_name": plan_name,
        "estimated_copay_pcp": office if office is not None else payer.get("pcp_copay"),
        "estimated_copay_specialist": specialist if specialist is not None else payer.get("specialist_copay"),
        "estimated_copay_er": payer.get("er_copay"),
        "deductible": inn_ded if inn_ded is not None else payer.get("deductible"),
        "deductible_remaining": inn_ded_rem if inn_ded_rem is not None else payer.get("deductible_remaining"),
        "oon_deductible": oon_ded if oon_ded is not None else payer.get("oon_deductible"),
        "oop_max": oop_max if oop_max is not None else payer.get("oop_max"),
        "oop_remaining": oop_rem if oop_rem is not None else payer.get("oop_remaining"),
        "coinsurance_pct": coins_pct if coins_pct is not None else payer.get("coinsurance_pct"),
        "pa_required_rx": payer.get("pa_required_rx"),
        "member_name": profile.get("member_name"),
        "member_id": profile.get("member_id"),
        "disclaimer": (
            "Sandbox 270/271 from Stedi (test key). Flattened benefits only — "
            "raw X12 is discarded. Not a coverage determination."
        ),
        "stedi_check_id": check_id,
    }


def _request_body(payer: dict, profile: dict) -> dict:
    first, last = _split_name(profile.get("member_name") or "")
    dob = (profile.get("date_of_birth") or "").strip()
    return {
        "payerId": payer.get("stedi_payer_id") or "60054",
        "provider": {
            "name": {"organization": DEMO_PROVIDER_NAME},
            "npi": DEMO_PROVIDER_NPI,
        },
        "subscriber": {
            "name": {"person": {"firstName": first, "lastName": last}},
            "memberId": profile.get("member_id") or "",
            "dateOfBirth": dob,
        },
        "encounter": {
            "services": [{"system": "STC", "value": "30"}],
        },
    }


def check_eligibility(payer: dict, profile: dict) -> dict:
    """Call Stedi when a test key is present. Never send production traffic."""
    meta = status()
    if not meta["configured"]:
        return {
            "attempted": False,
            "used": False,
            "vendor": "stedi",
            "message": meta["message"],
        }
    if not meta["test_mode"]:
        return {
            "attempted": False,
            "used": False,
            "vendor": "stedi",
            "message": meta["message"],
        }
    if not payer.get("stedi_payer_id"):
        return {
            "attempted": False,
            "used": False,
            "vendor": "stedi",
            "message": (
                f"{payer.get('name')} has no Stedi payer ID. Coverage used the mock plan."
            ),
        }

    body = _request_body(payer, profile)
    encoded = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        STEDI_ELIGIBILITY_URL,
        data=encoded,
        headers={
            "Authorization": _auth_header(),
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            http_status = resp.status
        parsed = json.loads(raw) if raw else {}
        parsed.pop("x12", None)
        eligibility = flatten_eligibility(parsed, payer, profile)
        return {
            "attempted": True,
            "used": True,
            "vendor": "stedi",
            "http_status": http_status,
            "message": (
                "Stedi sandbox 271 flattened into this coverage card "
                f"(check {eligibility.get('stedi_check_id') or 'ok'})."
            ),
            "eligibility": eligibility,
        }
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        return {
            "attempted": True,
            "used": False,
            "vendor": "stedi",
            "http_status": exc.code,
            "message": (
                "Stedi rejected this member. Test keys only accept canned "
                "sandbox subscribers (Aetna Jane Doe / AETNA12345). "
                "Mock eligibility used."
            ),
            "error": detail,
        }
    except Exception as exc:
        return {
            "attempted": True,
            "used": False,
            "vendor": "stedi",
            "message": f"Stedi call failed ({exc}). Mock eligibility used.",
        }
