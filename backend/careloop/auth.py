"""CareLoop login/signup. Prefer Supabase Auth + public.profiles; mock login is fallback.

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
import time
from datetime import date
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


class SignupUnavailableError(ValueError):
    pass


class SignupConflictError(ValueError):
    pass


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


def public_user_from_profile(row: dict) -> dict:
    first = (row.get("first_name") or "").strip()
    last = (row.get("last_name") or "").strip()
    name = f"{first} {last}".strip() or (row.get("username") or "Patient")
    return {
        "id": row.get("id") or "",
        "username": row.get("username") or "",
        "name": name,
        "role": "patient",
        "tabs": ROLE_TABS["patient"],
        "date_of_birth": row.get("date_of_birth") or "",
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
            "used_for": "Supabase Auth signup/login + profiles username lookup",
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


def login(
    username: str,
    password: str,
    *,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> dict:
    username = (username or "").strip()
    password = password or ""
    if supabase_auth.configured():
        return _login_supabase(username, password, ip=ip, user_agent=user_agent)
    return _login_mock(username.lower(), password)


def signup(
    *,
    username: str,
    full_name: str,
    email: str,
    password: str,
    date_of_birth: str,
) -> dict:
    if not supabase_auth.configured():
        raise SignupUnavailableError(
            "Live signup requires the server-side Supabase environment variables."
        )

    username = (username or "").strip().lower()
    full_name = " ".join((full_name or "").strip().split())
    email = (email or "").strip().lower()
    password = password or ""
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{2,29}", username):
        raise ValueError("Username must be 3–30 characters using letters, numbers, dots, dashes, or underscores.")
    if len(full_name) < 2 or any(ch.isdigit() for ch in full_name) or not any(ch.isalpha() for ch in full_name):
        raise ValueError("Enter your name without numbers.")
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]{2,}", email):
        raise ValueError("Enter a valid email address.")
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters.")
    try:
        born = date.fromisoformat(date_of_birth)
    except (TypeError, ValueError):
        raise ValueError("Enter a valid date of birth.") from None
    today = date.today()
    if born >= today:
        raise ValueError("Date of birth must be in the past.")
    try:
        oldest = today.replace(year=today.year - 120)
    except ValueError:
        oldest = today.replace(year=today.year - 120, day=28)
    if born < oldest:
        raise ValueError("Check the year in your date of birth.")

    try:
        if supabase_auth.profile_by_username(username):
            raise SignupConflictError("That username is already in use.")
        if supabase_auth.profile_by_email(email):
            raise SignupConflictError("An account already exists for that email address.")
    except SignupConflictError:
        raise
    except ValueError as exc:
        raise ValueError(str(exc)) from None

    parts = full_name.split(" ", 1)
    first_name = parts[0]
    last_name = parts[1] if len(parts) > 1 else ""
    try:
        signup_result = supabase_auth.sign_up_user(
            email=email,
            password=password,
            username=username,
            first_name=first_name,
            last_name=last_name,
        )
    except ValueError as exc:
        raw_msg = str(exc).strip()
        message = raw_msg.lower()
        if "already" in message or "registered" in message or "duplicate" in message:
            raise SignupConflictError("An account already exists for that email address.") from None
        if raw_msg and not raw_msg.startswith("Supabase request failed"):
            raise ValueError(raw_msg) from None
        raise ValueError("Could not create the account in Supabase Auth.") from None

    # Robust user_id extraction: GoTrue may return the user object directly at root,
    # nested under 'user', or within 'data' / 'session'.
    user_id = ""
    if isinstance(signup_result, dict):
        if signup_result.get("id"):
            user_id = str(signup_result["id"]).strip()
        elif isinstance(signup_result.get("user"), dict) and signup_result["user"].get("id"):
            user_id = str(signup_result["user"]["id"]).strip()
        elif isinstance(signup_result.get("data"), dict):
            d = signup_result["data"]
            if d.get("id"):
                user_id = str(d["id"]).strip()
            elif isinstance(d.get("user"), dict) and d["user"].get("id"):
                user_id = str(d["user"]["id"]).strip()
        elif isinstance(signup_result.get("session"), dict):
            s_user = signup_result["session"].get("user")
            if isinstance(s_user, dict) and s_user.get("id"):
                user_id = str(s_user["id"]).strip()

    # Check for empty identities list (Supabase GoTrue returns HTTP 200 with identities=[] when user already exists)
    user_obj = signup_result.get("user") if isinstance(signup_result.get("user"), dict) else signup_result
    identities = user_obj.get("identities") if isinstance(user_obj, dict) else None
    if identities is not None and isinstance(identities, list) and len(identities) == 0:
        existing_profile = supabase_auth.profile_by_email(email) or (
            supabase_auth.profile_by_id(user_id) if user_id else None
        )
        if existing_profile:
            raise SignupConflictError("An account already exists for that email address.")

        # Incomplete/orphaned Auth user from an interrupted signup: clean up and retry once
        if user_id:
            try:
                supabase_auth.delete_auth_user(user_id)
                signup_result = supabase_auth.sign_up_user(
                    email=email,
                    password=password,
                    username=username,
                    first_name=first_name,
                    last_name=last_name,
                )
                user_id = str(signup_result.get("id") or (signup_result.get("user") or {}).get("id") or "").strip()
            except Exception:
                raise SignupConflictError("An account already exists for that email address.")
        else:
            raise SignupConflictError("An account already exists for that email address.")

    if not user_id:
        raise ValueError("Supabase Auth did not return a user id.")
    try:
        profile = supabase_auth.create_profile(
            user_id=user_id,
            username=username,
            email=email,
            first_name=first_name,
            last_name=last_name,
            date_of_birth=born.isoformat(),
        )
    except ValueError as exc:
        try:
            supabase_auth.delete_auth_user(user_id)
        except ValueError:
            raise ValueError(
                "Could not create the profile row, and the incomplete Auth account could not be removed."
            ) from None
        message = str(exc).lower()
        if "duplicate" in message or "unique" in message:
            raise SignupConflictError("That username or email is already in use.") from None
        raise ValueError(f"Could not create the profile row: {exc}") from None

    token = ""
    if isinstance(signup_result, dict):
        if signup_result.get("access_token"):
            token = str(signup_result["access_token"]).strip()
        elif isinstance(signup_result.get("session"), dict) and signup_result["session"].get("access_token"):
            token = str(signup_result["session"]["access_token"]).strip()
    return {
        "token": token,
        "user": public_user_from_profile(profile),
        "requires_email_confirmation": not bool(token),
    }


def _login_mock(username: str, password: str) -> dict:
    match = next(
        (u for u in _users() if u["username"].lower() == username and u["password"] == password),
        None,
    )
    if not match:
        raise ValueError("Unknown username or password.")
    pub = public_user(match)
    return {"token": issue_token(match["username"]), "user": pub}


def _login_supabase(
    username: str,
    password: str,
    *,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> dict:
    from backend.careloop import store as careloop_store

    try:
        profile = supabase_auth.profile_by_username(username)
    except ValueError as exc:
        raise ValueError(str(exc)) from None
    if not profile or not (profile.get("email") or "").strip():
        raise ValueError("Unknown username or password.")
    user_id = str(profile.get("id") or "").strip()
    try:
        session = supabase_auth.password_sign_in(profile["email"].strip(), password)
    except ValueError:
        if user_id:
            careloop_store.insert_login_event(
                user_id=user_id,
                username=username,
                success=False,
                ip=ip,
                user_agent=user_agent,
            )
        raise ValueError("Unknown username or password.") from None
    token = (session or {}).get("access_token") if isinstance(session, dict) else None
    if not token:
        if user_id:
            careloop_store.insert_login_event(
                user_id=user_id,
                username=username,
                success=False,
                ip=ip,
                user_agent=user_agent,
            )
        raise ValueError("Unknown username or password.")
    careloop_store.insert_login_event(
        user_id=user_id,
        username=username,
        success=True,
        ip=ip,
        user_agent=user_agent,
        token=token,
    )
    return {"token": token, "user": public_user_from_profile(profile)}


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


def token_from_request(request: Request, authorization: Optional[str] = None) -> Optional[str]:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1].strip()
    cookie = request.cookies.get("careloop_token")
    return cookie or None


def _token_from_request(request: Request, authorization: Optional[str]) -> Optional[str]:
    return token_from_request(request, authorization)


def require_user(
    request: Request,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    token = _token_from_request(request, authorization)
    user = user_for_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Login required.")
    request.state.access_token = token
    request.state.user_id = user.get("id") or ""
    return user


def cookie_secure(request: Request) -> bool:
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "").lower()
    return proto == "https"
