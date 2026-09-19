"""CareLoop login. Prefer Supabase Auth + public.profiles; mock JSON is fallback.

Not production HIPAA. Tokens are stateless so Vercel workers can authorize
coverage routes: either a Supabase access JWT, or the legacy HMAC app token.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from typing import Optional

from fastapi import Header, HTTPException, Request

from backend.careloop import supabase_auth

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


_MOCK_SIGNUPS: dict[str, dict] = {}
_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,32}$")
_PBKDF2_ROUNDS = 120_000


def _looks_like_email(value: str) -> bool:
    return "@" in (value or "") and "." in (value or "").split("@")[-1]


def _mock_email(user: dict) -> str:
    email = (user.get("email") or "").strip().lower()
    if email:
        return email
    return f"{user['username'].lower()}@careloop.local"


def _find_user(identifier: str) -> Optional[dict]:
    needle = (identifier or "").strip().lower()
    if not needle:
        return None
    for user in _users():
        if user["username"].lower() == needle or _mock_email(user) == needle:
            return user
    signup = _MOCK_SIGNUPS.get(needle)
    if signup:
        return signup
    if _looks_like_email(needle):
        for user in list(_users()) + list(_MOCK_SIGNUPS.values()):
            if _mock_email(user) == needle:
                return user
    return None


def public_user(user: dict) -> dict:
    return {
        "username": user["username"],
        "name": user["name"],
        "role": user["role"],
        "tabs": ROLE_TABS.get(user["role"], ["careloop"]),
    }


def public_user_from_profile(row: dict) -> dict:
    first = (row.get("first_name") or "").strip()
    last = (row.get("last_name") or "").strip()
    name = f"{first} {last}".strip() or (row.get("username") or "Patient")
    return {
        "username": row.get("username") or "",
        "name": name,
        "role": "patient",
        "tabs": ROLE_TABS["patient"],
    }


def _secret() -> bytes:
    raw = (os.getenv("SESSION_SECRET") or _DEMO_SECRET).strip()
    return raw.encode("utf-8")


def session_status() -> dict:
    sb = supabase_auth.status()
    custom = bool((os.getenv("SESSION_SECRET") or "").strip())
    if sb["configured"]:
        return {
            "configured": True,
            "signed": True,
            "provider": "supabase",
            "custom_secret": custom,
            "used_for": "Supabase Auth JWT after profiles username lookup",
            "message": sb["message"],
            "supabase": sb,
        }
    return {
        "configured": True,
        "signed": True,
        "provider": "mock",
        "custom_secret": custom,
        "used_for": "Mock login tokens (username + expiry only) until Supabase env is set",
        "message": (
            "Supabase login keys are not loaded. Mock jane/demo still signs an HMAC token. "
            + sb["message"]
        ),
        "supabase": sb,
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


def list_accounts() -> list[dict]:
    if supabase_auth.configured():
        try:
            rows = supabase_auth.list_profiles()
        except ValueError:
            rows = []
        out = []
        for row in rows:
            pub = public_user_from_profile(row)
            out.append({"username": pub["username"], "name": pub["name"], "role": pub["role"]})
        return out
    return [{"username": u["username"], "name": u["name"], "role": u["role"]} for u in _users()]


def login(username: str, password: str) -> dict:
    identifier = (username or "").strip()
    password = password or ""
    if not identifier or not password:
        raise ValueError("Unknown username or password.")
    if supabase_auth.configured():
        return _login_supabase(identifier, password)
    return _login_mock(identifier, password)


def _hash_password(password: str, salt: bytes) -> str:
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ROUNDS)
    return digest.hex()


def _password_matches(user: dict, password: str) -> bool:
    if user.get("pw_hash") and user.get("pw_salt"):
        salt = bytes.fromhex(user["pw_salt"])
        expected = user["pw_hash"]
        actual = _hash_password(password, salt)
        return hmac.compare_digest(expected, actual)
    stored = user.get("password")
    return bool(stored) and stored == password


def _login_mock(identifier: str, password: str) -> dict:
    match = _find_user(identifier)
    if not match or not _password_matches(match, password):
        raise ValueError("Unknown username or password.")
    pub = public_user(match)
    return {"token": issue_token(match["username"]), "user": pub}


def _profile_for_identifier(identifier: str) -> Optional[dict]:
    try:
        profile = supabase_auth.profile_by_username(identifier)
        if profile:
            return profile
        if _looks_like_email(identifier):
            return supabase_auth.profile_by_email(identifier)
    except ValueError as exc:
        raise ValueError(str(exc)) from None
    return None


def _login_supabase(identifier: str, password: str) -> dict:
    profile = _profile_for_identifier(identifier)
    if not profile or not (profile.get("email") or "").strip():
        raise ValueError("Unknown username or password.")
    try:
        session = supabase_auth.password_sign_in(profile["email"].strip(), password)
    except ValueError:
        raise ValueError("Unknown username or password.") from None
    token = (session or {}).get("access_token") if isinstance(session, dict) else None
    if not token:
        raise ValueError("Unknown username or password.")
    return {"token": token, "user": public_user_from_profile(profile)}


def _validate_signup(first_name: str, last_name: str, username: str, email: str, password: str) -> tuple[str, str, str, str, str]:
    first = (first_name or "").strip()
    last = (last_name or "").strip()
    user = (username or "").strip()
    mail = (email or "").strip().lower()
    secret = password or ""
    if not first or not last:
        raise ValueError("First name and last name are required.")
    if not _USERNAME_RE.match(user):
        raise ValueError("Username must be 3–32 letters, numbers, or underscores.")
    if not _looks_like_email(mail):
        raise ValueError("A valid email is required.")
    if len(secret) < 4:
        raise ValueError("Password is required.")
    return first, last, user, mail, secret


def signup(
    first_name: str,
    last_name: str,
    username: str,
    email: str,
    password: str,
) -> dict:
    first, last, user, mail, secret = _validate_signup(first_name, last_name, username, email, password)
    if supabase_auth.configured():
        return _signup_supabase(first, last, user, mail, secret)
    return _signup_mock(first, last, user, mail, secret)


def _signup_mock(first: str, last: str, username: str, email: str, password: str) -> dict:
    if _find_user(username) or _find_user(email):
        raise ValueError("That username or email is already in use.")
    salt = secrets.token_bytes(16)
    row = {
        "username": username,
        "email": email,
        "first_name": first,
        "last_name": last,
        "name": f"{first} {last}".strip(),
        "role": "patient",
        "pw_salt": salt.hex(),
        "pw_hash": _hash_password(password, salt),
    }
    _MOCK_SIGNUPS[username.lower()] = row
    pub = public_user(row)
    return {"token": issue_token(username), "user": pub, "needs_confirmation": False}


def _signup_supabase(first: str, last: str, username: str, email: str, password: str) -> dict:
    existing_user = supabase_auth.profile_by_username(username)
    existing_mail = supabase_auth.profile_by_email(email)
    if existing_user or existing_mail:
        raise ValueError("That username or email is already in use.")
    try:
        session = supabase_auth.sign_up(
            email,
            password,
            {"username": username, "first_name": first, "last_name": last},
        )
    except ValueError as exc:
        raise ValueError(str(exc)) from None
    auth_user = session.get("user") if isinstance(session.get("user"), dict) else session
    user_id = (auth_user or {}).get("id") or ""
    profile = {
        "username": username,
        "email": email,
        "first_name": first,
        "last_name": last,
    }
    if user_id:
        profile["id"] = user_id
        try:
            saved = supabase_auth.insert_profile(profile)
            if saved:
                profile = saved
        except ValueError as exc:
            raise ValueError(str(exc)) from None
    token = session.get("access_token") if isinstance(session, dict) else None
    return {
        "token": token or "",
        "user": public_user_from_profile(profile),
        "needs_confirmation": not bool(token),
    }


def forgot_password(identifier: str) -> dict:
    needle = (identifier or "").strip()
    if not needle:
        raise ValueError("Enter a username or email.")
    configured = supabase_auth.configured()
    if not configured:
        return {
            "sent": False,
            "auth_configured": False,
            "message": (
                "If an account exists for that username or email, check your inbox. "
                "No reset email was sent — login Auth is not configured on this host."
            ),
        }
    email = needle if _looks_like_email(needle) else ""
    try:
        profile = _profile_for_identifier(needle)
    except ValueError as exc:
        raise ValueError(str(exc)) from None
    if profile:
        email = (profile.get("email") or email).strip()
    if not email:
        return {
            "sent": False,
            "auth_configured": True,
            "message": "If an account exists for that username or email, check your inbox.",
        }
    try:
        supabase_auth.request_password_reset(email)
    except ValueError as exc:
        raise ValueError(str(exc)) from None
    return {
        "sent": True,
        "auth_configured": True,
        "message": "If an account exists for that username or email, check your inbox.",
    }


def logout(token: Optional[str]) -> dict:
    if token and not token.startswith("v1."):
        supabase_auth.sign_out(token)
    return {"ok": True}


def user_for_token(token: Optional[str]) -> Optional[dict]:
    if not token:
        return None
    username = parse_token(token)
    if username:
        match = _find_user(username)
        if match:
            return public_user(match)
        if supabase_auth.configured():
            try:
                profile = supabase_auth.profile_by_username(username)
            except ValueError:
                profile = None
            if profile:
                return public_user_from_profile(profile)
        return None
    if not supabase_auth.configured():
        return None
    auth_user = supabase_auth.auth_user(token)
    if not auth_user:
        return None
    user_id = auth_user.get("id") or ""
    try:
        profile = supabase_auth.profile_by_id(user_id)
    except ValueError:
        return None
    if not profile:
        email = ((auth_user.get("email") or "").strip())
        meta = auth_user.get("user_metadata") or {}
        username = (meta.get("username") or email.split("@")[0] or "patient").strip()
        return public_user_from_profile(
            {
                "username": username,
                "first_name": meta.get("first_name") or "",
                "last_name": meta.get("last_name") or "",
                "email": email,
            }
        )
    return public_user_from_profile(profile)


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
