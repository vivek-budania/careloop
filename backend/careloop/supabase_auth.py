"""Server-side Supabase Auth + public.profiles helpers.

Keys stay on the process. Never import this from frontend JS.
Login-only: no insurance / meds / history tables.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Optional

_PLACEHOLDERS = {
    "",
    "your_anon_key_here",
    "your_service_role_key_here",
    "your_key_here",
}


def _env(name: str) -> str:
    return (os.getenv(name) or "").strip()


def supabase_url() -> str:
    return _env("SUPABASE_URL").rstrip("/")


def anon_key() -> str:
    return _env("SUPABASE_ANON_KEY")


def service_role_key() -> str:
    return _env("SUPABASE_SERVICE_ROLE_KEY")


def _usable(value: str) -> bool:
    return bool(value) and value not in _PLACEHOLDERS


def configured() -> bool:
    return _usable(supabase_url()) and _usable(anon_key()) and _usable(service_role_key())


def status() -> dict:
    on = configured()
    url_on = _usable(supabase_url())
    return {
        "configured": on,
        "url_set": url_on,
        "anon_set": _usable(anon_key()),
        "service_role_set": _usable(service_role_key()),
        "used_for": "Login + signup (Auth + public.profiles). No insurance or meds tables.",
        "message": (
            "Supabase login and signup are loaded. Signup creates an Auth user and matching "
            "public.profiles row; login resolves username to the Auth email."
            if on
            else (
                "SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are required "
                "for live login. Mock jane/demo still works until those slots are set. "
                "Add them on this host or in Vercel, then Redeploy. Never put service_role "
                "in frontend JS."
            )
        ),
    }


def _request(
    method: str,
    url: str,
    *,
    key: str,
    body: Optional[dict] = None,
    bearer: Optional[str] = None,
    extra_headers: Optional[dict] = None,
) -> Any:
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {bearer or key}",
        "Accept": "application/json",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if extra_headers:
        headers.update(extra_headers)
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
        err = payload.get("error_description") or payload.get("msg") or payload.get("message")
        if isinstance(payload.get("error"), str) and not err:
            err = payload["error"]
        raise ValueError(err or f"Supabase request failed ({exc.code}).") from None
    except urllib.error.URLError as exc:
        raise ValueError("Could not reach Supabase. Check SUPABASE_URL.") from exc


def _rest(path: str, params: dict, key: str) -> Any:
    query = urllib.parse.urlencode(params)
    return _request("GET", f"{supabase_url()}/rest/v1/{path}?{query}", key=key)


def _rest_insert(path: str, body: dict, key: str) -> Any:
    return _request(
        "POST",
        f"{supabase_url()}/rest/v1/{path}",
        key=key,
        body=body,
        extra_headers={"Prefer": "return=representation"},
    )


def profile_by_username(username: str) -> Optional[dict]:
    needle = (username or "").strip()
    if not needle:
        return None
    escaped = needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    rows = _rest(
        "profiles",
        {
            "select": "id,username,email,first_name,last_name,created_at",
            "username": f"ilike.{escaped}",
            "limit": "1",
        },
        service_role_key(),
    )
    if not isinstance(rows, list) or not rows:
        return None
    return rows[0]


def profile_by_id(user_id: str) -> Optional[dict]:
    if not user_id:
        return None
    rows = _rest(
        "profiles",
        {
            "select": "id,username,email,first_name,last_name,created_at",
            "id": f"eq.{user_id}",
            "limit": "1",
        },
        service_role_key(),
    )
    if not isinstance(rows, list) or not rows:
        return None
    return rows[0]


def profile_by_email(email: str) -> Optional[dict]:
    needle = (email or "").strip().lower()
    if not needle:
        return None
    escaped = needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    rows = _rest(
        "profiles",
        {
            "select": "id,username,email,first_name,last_name,created_at",
            "email": f"ilike.{escaped}",
            "limit": "1",
        },
        service_role_key(),
    )
    if not isinstance(rows, list) or not rows:
        return None
    return rows[0]


def list_profiles() -> list[dict]:
    rows = _rest(
        "profiles",
        {
            "select": "username,email,first_name,last_name",
            "order": "username.asc",
        },
        service_role_key(),
    )
    return rows if isinstance(rows, list) else []


def password_sign_in(email: str, password: str) -> dict:
    return _request(
        "POST",
        f"{supabase_url()}/auth/v1/token?grant_type=password",
        key=anon_key(),
        body={"email": email, "password": password},
    )


def create_confirmed_auth_user(
    *,
    email: str,
    password: str,
    username: str,
    first_name: str,
    last_name: str,
) -> dict:
    data = _request(
        "POST",
        f"{supabase_url()}/auth/v1/admin/users",
        key=service_role_key(),
        body={
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {
                "username": username,
                "first_name": first_name,
                "last_name": last_name,
            },
        },
    )
    if not isinstance(data, dict):
        return {}

    normalized = dict(data)
    user_dict = None
    if isinstance(data.get("user"), dict):
        user_dict = data["user"]
    elif isinstance(data.get("data"), dict) and isinstance(data["data"].get("user"), dict):
        user_dict = data["data"]["user"]
    elif isinstance(data.get("session"), dict) and isinstance(data["session"].get("user"), dict):
        user_dict = data["session"]["user"]
    elif data.get("id"):
        user_dict = data

    if isinstance(user_dict, dict):
        normalized["user"] = user_dict
        uid = str(user_dict.get("id") or "").strip()
        if uid:
            normalized["id"] = uid

    return normalized


def delete_auth_user(user_id: str) -> None:
    if not user_id:
        return
    _request(
        "DELETE",
        f"{supabase_url()}/auth/v1/admin/users/{urllib.parse.quote(user_id)}",
        key=service_role_key(),
    )


def create_profile(
    *,
    user_id: str,
    username: str,
    email: str,
    first_name: str,
    last_name: str,
    date_of_birth: str,
) -> dict:
    body = {
        "id": user_id,
        "username": username,
        "email": email,
        "first_name": first_name or None,
        "last_name": last_name or None,
        "date_of_birth": date_of_birth,
    }
    try:
        rows = _rest_insert("profiles", body, service_role_key())
    except ValueError as exc:
        err_msg = str(exc).lower()
        if "date_of_birth" in err_msg or "column" in err_msg:
            body_without_dob = {k: v for k, v in body.items() if k != "date_of_birth"}
            rows = _rest_insert("profiles", body_without_dob, service_role_key())
        else:
            raise
    if not isinstance(rows, list) or not rows:
        raise ValueError("Supabase did not return the created profile.")
    return rows[0]


def auth_user(access_token: str) -> Optional[dict]:
    if not access_token:
        return None
    try:
        data = _request(
            "GET",
            f"{supabase_url()}/auth/v1/user",
            key=anon_key(),
            bearer=access_token,
        )
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def sign_out(access_token: Optional[str]) -> None:
    if not access_token or not configured():
        return
    try:
        _request(
            "POST",
            f"{supabase_url()}/auth/v1/logout",
            key=anon_key(),
            bearer=access_token,
            extra_headers={"Content-Type": "application/json"},
        )
    except ValueError:
        return
