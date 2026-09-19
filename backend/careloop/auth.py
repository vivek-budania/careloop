"""Mock login for the CareLoop demo. Not production auth. No HIPAA.

Sessions are signed tokens (HMAC), not a server-side map. That way login
survives Vercel serverless workers. Tokens carry only username + expiry.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any, Optional

from fastapi import Header, HTTPException, Request

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
TOKEN_TTL_SEC = 60 * 60 * 12
# Demo fallback only. Set SESSION_SECRET on Vercel if you want to rotate.
_DEMO_SECRET = "careloop-demo-session"

ROLE_TABS = {
    "patient": ["careloop", "claims"],
    "clinician": ["careloop", "claims"],
    "advocate": ["careloop", "claims"],
    "demo": ["careloop", "claims"],
}


def _users() -> list[dict]:
    with open(os.path.join(DATA_DIR, "mock_users.json"), "r") as f:
        return json.load(f)


def _find_user(username: str) -> Optional[dict]:
    needle = (username or "").strip().lower()
    for user in _users():
        if user["username"].lower() == needle:
            return user
    return None


def public_user(user: dict) -> dict:
    return {
        "username": user["username"],
        "name": user["name"],
        "role": user["role"],
        "tabs": ROLE_TABS.get(user["role"], ["careloop"]),
    }


def _secret() -> bytes:
    raw = (os.getenv("SESSION_SECRET") or _DEMO_SECRET).strip()
    return raw.encode("utf-8")


def session_status() -> dict:
    custom = bool((os.getenv("SESSION_SECRET") or "").strip())
    return {
        "configured": True,
        "signed": True,
        "custom_secret": custom,
        "used_for": "Mock login tokens (username + expiry only)",
        "message": (
            "SESSION_SECRET is set. Login tokens are signed and work across Vercel workers."
            if custom
            else (
                "Mock login uses a signed token (no server session map). "
                "Optional SESSION_SECRET rotates the signature; the demo fallback works without it."
            )
        ),
    }


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def issue_token(username: str) -> str:
    payload = json.dumps(
        {"u": username, "exp": int(time.time()) + TOKEN_TTL_SEC},
        separators=(",", ":"),
    ).encode("utf-8")
    sig = hmac.new(_secret(), payload, hashlib.sha256).digest()
    return f"v1.{_b64(payload)}.{_b64(sig)}"


def parse_token(token: Optional[str]) -> Optional[str]:
    if not token or not token.startswith("v1."):
        return None
    try:
        _ver, payload_b64, sig_b64 = token.split(".", 2)
        payload = _unb64(payload_b64)
        expected = hmac.new(_secret(), payload, hashlib.sha256).digest()
        if not hmac.compare_digest(_unb64(sig_b64), expected):
            return None
        data = json.loads(payload.decode("utf-8"))
        if int(data.get("exp") or 0) < int(time.time()):
            return None
        username = (data.get("u") or "").strip()
        return username or None
    except Exception:
        return None


def login(username: str, password: str) -> dict:
    username = (username or "").strip().lower()
    password = password or ""
    match = next(
        (u for u in _users() if u["username"].lower() == username and u["password"] == password),
        None,
    )
    if not match:
        raise ValueError("Unknown username or password.")
    pub = public_user(match)
    return {"token": issue_token(match["username"]), "user": pub}


def logout(_token: Optional[str]) -> dict:
    # Tokens are stateless. Client drops localStorage + cookie.
    return {"ok": True}


def user_for_token(token: Optional[str]) -> Optional[dict]:
    username = parse_token(token)
    if not username:
        return None
    match = _find_user(username)
    if not match:
        return None
    return public_user(match)


def _token_from_request(request: Request, authorization: Optional[str]) -> Optional[str]:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1].strip()
    cookie = request.cookies.get("careloop_token")
    return cookie or None


def require_user(
    request: Request,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    token = _token_from_request(request, authorization)
    user = user_for_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Login required.")
    return user


def cookie_secure(request: Request) -> bool:
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "").lower()
    return proto == "https"
