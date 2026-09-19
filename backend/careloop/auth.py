"""Mock login for the CareLoop demo. Not production auth. No HIPAA."""

from __future__ import annotations

import json
import os
import secrets
from typing import Any, Optional

from fastapi import Header, HTTPException, Request

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")

# token -> public user dict
_sessions: dict[str, dict[str, Any]] = {}

ROLE_TABS = {
    "patient": ["careloop", "claims"],
    "clinician": ["careloop", "claims"],
    "advocate": ["careloop", "claims"],
    "demo": ["careloop", "claims"],
}


def _users() -> list[dict]:
    with open(os.path.join(DATA_DIR, "mock_users.json"), "r") as f:
        return json.load(f)


def public_user(user: dict) -> dict:
    return {
        "username": user["username"],
        "name": user["name"],
        "role": user["role"],
        "tabs": ROLE_TABS.get(user["role"], ["careloop"]),
    }


def login(username: str, password: str) -> dict:
    username = (username or "").strip().lower()
    password = password or ""
    match = next(
        (u for u in _users() if u["username"].lower() == username and u["password"] == password),
        None,
    )
    if not match:
        raise ValueError("Unknown username or password.")
    token = secrets.token_hex(16)
    pub = public_user(match)
    _sessions[token] = pub
    return {"token": token, "user": pub}


def logout(token: Optional[str]) -> dict:
    if token:
        _sessions.pop(token, None)
    return {"ok": True}


def user_for_token(token: Optional[str]) -> Optional[dict]:
    if not token:
        return None
    return _sessions.get(token)


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
