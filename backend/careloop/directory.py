"""Public clinician listings near a US ZIP.

Uses the CMS NPI Registry (no API key) plus Zippopotam.us for coordinates.
This is not a payer directory, coverage decision, or maps product.
"""

from __future__ import annotations

import json
import math
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

NPPES_URL = "https://npiregistry.cms.hhs.gov/api/"
ZIPPO_URL = "https://api.zippopotam.us/us/{zip}"
NEARBY_RADIUS_MILES = 40
_USER_AGENT = "CareLoop/1.0 (patient-demo)"

_GEO_CACHE: dict[str, Optional[dict[str, Any]]] = {}
_NPPES_CACHE: dict[tuple[str, str], list[dict[str, Any]]] = {}

_SPECIALTY_LABELS = {
    "pcp": "Primary care",
    "endocrinology": "Endocrinology",
    "dermatology": "Dermatology",
    "neurology": "Neurology",
    "orthopedics": "Orthopedics",
}

# taxonomy_description is a contains-match on NPPES.
_TAXONOMY_QUERIES = {
    "pcp": ("Family Medicine", "Internal Medicine"),
    "endocrinology": ("Endocrinology",),
    "dermatology": ("Dermatology",),
    "neurology": ("Neurology",),
    "orthopedics": ("Orthopaedic",),
}

_PCP_TAXONOMY_CODES = {
    "207Q00000X",  # Family Medicine
    "207R00000X",  # Internal Medicine (not a subspecialty)
    "208D00000X",  # General Practice
    "208000000X",  # Pediatrics
    "207QA0505X",  # Family Medicine, Adult Medicine
}

_PHYSICIAN_CRED = {"MD", "DO", "MBBS"}


def _http_json(url: str, timeout: float = 8.0) -> Optional[Any]:
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else None
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, ValueError):
        return None


def _zip5(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    return digits[:5]


def _proper_word(word: str) -> str:
    if not word:
        return ""
    if "-" in word:
        return "-".join(_proper_word(part) for part in word.split("-"))
    if word.isupper() and word in {"NW", "NE", "SW", "SE", "US"}:
        return word
    token = word[:1].upper() + word[1:].lower()
    return re.sub(r"(')([a-z])", lambda m: m.group(1) + m.group(2).upper(), token)


def _proper(text: str) -> str:
    text = re.sub(r"\s+", " ", (text or "").strip())
    if not text:
        return ""
    return " ".join(_proper_word(part) for part in text.split(" ") if part)


def _haversine_miles(a: tuple[float, float], b: tuple[float, float]) -> float:
    radius = 3958.8
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return round(2 * radius * math.asin(min(1, math.sqrt(h))), 1)


def geocode_zip(zip_code: str, known: Optional[dict[str, tuple[float, float]]] = None) -> Optional[dict[str, Any]]:
    """Lat/lng + city/state for a 5-digit ZIP. None if the ZIP cannot be placed."""
    zip5 = _zip5(zip_code)
    if len(zip5) != 5:
        return None
    if zip5 in _GEO_CACHE:
        cached = _GEO_CACHE[zip5]
        return dict(cached) if cached else None
    payload = _http_json(ZIPPO_URL.format(zip=zip5), timeout=6.0)
    places = (payload or {}).get("places") if isinstance(payload, dict) else None
    if places:
        row = places[0] if isinstance(places[0], dict) else {}
        try:
            lat = float(row.get("latitude"))
            lng = float(row.get("longitude"))
        except (TypeError, ValueError):
            lat = lng = None
        if lat is not None:
            place = {
                "zip": zip5,
                "lat": lat,
                "lng": lng,
                "city": str(row.get("place name") or "").strip(),
                "state": str(row.get("state abbreviation") or "").strip().upper()[:2],
            }
            _GEO_CACHE[zip5] = place
            return dict(place)
    if known and zip5 in known:
        lat, lng = known[zip5]
        place = {"zip": zip5, "lat": lat, "lng": lng, "city": "", "state": ""}
        _GEO_CACHE[zip5] = place
        return dict(place)
    _GEO_CACHE[zip5] = None
    return None


def _primary_taxonomy(row: dict) -> dict:
    taxes = row.get("taxonomies") or []
    for item in taxes:
        if isinstance(item, dict) and item.get("primary"):
            return item
    return taxes[0] if taxes and isinstance(taxes[0], dict) else {}


def _is_physician(row: dict) -> bool:
    basic = row.get("basic") or {}
    cred = re.sub(r"[.\s]", "", str(basic.get("credential") or "")).upper()
    if cred in _PHYSICIAN_CRED:
        return True
    code = str(_primary_taxonomy(row).get("code") or "").upper()
    return code.startswith("207") or code.startswith("208")


def _map_specialty(row: dict) -> Optional[tuple[str, str]]:
    tax = _primary_taxonomy(row)
    code = str(tax.get("code") or "").upper()
    desc = str(tax.get("desc") or "").strip()
    lower = desc.lower()
    if "endocrin" in lower or code.startswith("207RE"):
        return "endocrinology", "Endocrinology"
    if "dermatolog" in lower or code.startswith("207N"):
        return "dermatology", "Dermatology"
    if ("neurolog" in lower and "surgery" not in lower) or code == "2084N0400X":
        return "neurology", "Neurology"
    if "orthop" in lower or code.startswith("207X"):
        return "orthopedics", "Orthopedics"
    if code in _PCP_TAXONOMY_CODES or lower in {
        "family medicine",
        "internal medicine",
        "general practice",
        "pediatrics",
    }:
        return "pcp", desc or "Primary care"
    return None


def _location(row: dict) -> dict:
    addresses = [a for a in (row.get("addresses") or []) if isinstance(a, dict)]
    for item in addresses:
        if str(item.get("address_purpose") or "").upper() == "LOCATION":
            return item
    return addresses[0] if addresses else {}


def _display_name(row: dict) -> str:
    basic = row.get("basic") or {}
    first = _proper(str(basic.get("first_name") or ""))
    last = _proper(str(basic.get("last_name") or ""))
    if not first or not last:
        return ""
    middle = _proper(str(basic.get("middle_name") or ""))
    initial = f"{middle[0]}." if middle else ""
    full = " ".join(part for part in (first, initial, last) if part)
    return f"Dr. {full}"


def _nppes_query(params: dict[str, str]) -> list[dict]:
    query = {"version": "2.1", "enumeration_type": "NPI-1", "limit": "25", **params}
    url = NPPES_URL + "?" + urllib.parse.urlencode(query)
    payload = _http_json(url, timeout=8.0)
    if not isinstance(payload, dict):
        return []
    rows = payload.get("results") or []
    return [row for row in rows if isinstance(row, dict)]


def _wanted_specialty(mapped: Optional[tuple[str, str]], wanted: str) -> bool:
    if not mapped:
        return wanted == "any"
    if wanted in ("", "any"):
        return True
    return mapped[0] == wanted


def search_nearby_clinicians(
    *,
    zip_code: str,
    specialty: str,
    origin: tuple[float, float],
    city: str = "",
    state: str = "",
    known_zips: Optional[dict[str, tuple[float, float]]] = None,
) -> list[dict[str, Any]]:
    """Real individual clinicians near this ZIP. Empty list on any failure."""
    zip5 = _zip5(zip_code)
    spec = (specialty or "pcp").strip().lower() or "pcp"
    if len(zip5) != 5:
        return []
    cache_key = (zip5, spec)
    if cache_key in _NPPES_CACHE:
        return [dict(row) for row in _NPPES_CACHE[cache_key]]

    terms = _TAXONOMY_QUERIES.get(spec, ())
    seen_npi: set[str] = set()
    raw_rows: list[dict] = []

    def _ingest(params: dict[str, str]) -> None:
        for row in _nppes_query(params):
            npi = str(row.get("number") or "").strip()
            if not npi or npi in seen_npi:
                continue
            seen_npi.add(npi)
            raw_rows.append(row)

    try:
        if spec == "any":
            _ingest({"postal_code": zip5})
            if city and state and len(raw_rows) < 8:
                _ingest({"city": city, "state": state})
        else:
            for term in terms or (_SPECIALTY_LABELS.get(spec, spec),):
                _ingest({"postal_code": zip5, "taxonomy_description": term})
            if city and state and len(raw_rows) < 8:
                for term in terms or (_SPECIALTY_LABELS.get(spec, spec),):
                    _ingest({"city": city, "state": state, "taxonomy_description": term})
        if len(raw_rows) < 3:
            _ingest({"postal_code": f"{zip5[:3]}*", **({"taxonomy_description": terms[0]} if terms else {})})
    except Exception:
        return []

    out: list[dict[str, Any]] = []
    for row in raw_rows:
        basic = row.get("basic") or {}
        if str(basic.get("status") or "A").upper() not in {"A", ""}:
            continue
        if not _is_physician(row):
            continue
        mapped = _map_specialty(row)
        if spec != "any" and not _wanted_specialty(mapped, spec):
            continue
        if spec == "any" and not mapped and not _is_physician(row):
            continue
        name = _display_name(row)
        if not name:
            continue
        loc = _location(row)
        practice_zip = _zip5(str(loc.get("postal_code") or ""))
        geo = geocode_zip(practice_zip, known_zips) if practice_zip else None
        if not geo:
            continue
        miles = _haversine_miles(origin, (geo["lat"], geo["lng"]))
        if miles > NEARBY_RADIUS_MILES + 15:
            continue
        if mapped:
            code, label = mapped
        else:
            code = "other"
            label = _proper(str(_primary_taxonomy(row).get("desc") or "Physician"))
        street = _proper(str(loc.get("address_1") or ""))
        suite = _proper(str(loc.get("address_2") or ""))
        city_name = _proper(str(loc.get("city") or geo.get("city") or ""))
        state_name = str(loc.get("state") or geo.get("state") or "").strip().upper()[:2]
        phone = str(loc.get("telephone_number") or "").strip() or "—"
        line = ", ".join(part for part in (street, suite) if part)
        address = ", ".join(part for part in (line, city_name, f"{state_name} {practice_zip}".strip()) if part)
        out.append({
            "npi": str(row.get("number")),
            "name": name[:80],
            "specialty": code,
            "specialty_label": (label or _SPECIALTY_LABELS.get(code, "Physician"))[:80],
            "address": address,
            "zip": practice_zip,
            "phone": phone[:20],
            "accepting_new_patients": True,
            "miles": miles,
            "in_network": False,
            "networks": [],
        })

    out.sort(key=lambda row: (row["miles"], row["name"]))
    trimmed = out[:12]
    if trimmed:
        _NPPES_CACHE[cache_key] = [dict(row) for row in trimmed]
    return trimmed


def specialty_label(code: str, rows: Optional[list[dict]] = None) -> str:
    spec = (code or "pcp").strip().lower() or "pcp"
    if spec in _SPECIALTY_LABELS:
        return _SPECIALTY_LABELS[spec]
    if rows:
        for row in rows:
            if row.get("specialty") == spec and row.get("specialty_label"):
                return str(row["specialty_label"])
    return spec.replace("_", " ").title()
