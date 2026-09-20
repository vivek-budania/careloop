import json
import os
import unittest
from http.cookies import SimpleCookie
from unittest.mock import patch

from fastapi import Request

from backend import main
from backend.careloop import auth


def request(*, scheme: str = "https", cookie: str = "") -> Request:
    headers = []
    if cookie:
        headers.append((b"cookie", cookie.encode("ascii")))
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": scheme,
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": headers,
            "client": ("test", 1234),
            "server": ("testserver", 443 if scheme == "https" else 80),
        }
    )


class SessionCookieTests(unittest.TestCase):
    def test_login_sets_secure_30_day_httponly_cookie_without_returning_token(self):
        login_result = {
            "token": "provider-access-token",
            "session_provider": "supabase",
            "session_user_id": "hosted-user-id",
            "user": {
                "username": "jane",
                "name": "Jane Doe",
                "role": "patient",
                "tabs": ["careloop", "claims"],
            },
        }
        with patch.object(main.careloop_auth, "login", return_value=login_result):
            response = main.careloop_login(
                main.LoginRequest(username="jane", password="demo"),
                request(),
            )

        payload = json.loads(response.body)
        self.assertEqual(payload, {"user": login_result["user"]})
        cookies = [
            value.decode("latin-1")
            for name, value in response.raw_headers
            if name.lower() == b"set-cookie"
        ]
        session_cookie = next(
            value for value in cookies if value.startswith(f"{auth.SESSION_COOKIE}=")
        )
        self.assertIn(f"Max-Age={auth.SESSION_TTL_SEC}", session_cookie)
        self.assertIn("HttpOnly", session_cookie)
        self.assertIn("SameSite=lax", session_cookie)
        self.assertIn("Secure", session_cookie)
        self.assertNotIn("provider-access-token", session_cookie)
        parsed_cookie = SimpleCookie()
        parsed_cookie.load(session_cookie)
        session = auth.parse_session_token(
            parsed_cookie[auth.SESSION_COOKIE].value
        )
        self.assertEqual(session["provider"], "supabase")
        self.assertEqual(session["user_id"], "hosted-user-id")
        coverage_cookie = next(
            value for value in cookies if value.startswith("careloop_coverage=")
        )
        self.assertIn(
            f"Max-Age={main.COVERAGE_COOKIE_TTL_SEC}",
            coverage_cookie,
        )

    def test_signed_session_expires_after_30_days(self):
        issued_at = 2_000_000_000
        with patch.object(auth.time, "time", return_value=issued_at):
            token = auth.issue_token("jane")
        with patch.object(
            auth.time,
            "time",
            return_value=issued_at + auth.SESSION_TTL_SEC - 1,
        ):
            self.assertEqual(auth.parse_token(token), "jane")
        with patch.object(
            auth.time,
            "time",
            return_value=issued_at + auth.SESSION_TTL_SEC + 1,
        ):
            self.assertIsNone(auth.parse_token(token))

    def test_cookie_authenticates_without_authorization_header(self):
        token = auth.issue_token("jane")
        user = auth.require_user(
            request(cookie=f"{auth.SESSION_COOKIE}={token}"),
            authorization=None,
        )
        self.assertEqual(user["username"], "jane")

    def test_supabase_session_does_not_resolve_same_named_mock_user(self):
        hosted_profile = {
            "id": "hosted-user-id",
            "username": "advocate",
            "first_name": "Hosted",
            "last_name": "Patient",
        }
        with patch.object(auth.supabase_auth, "configured", return_value=True):
            with patch.dict(os.environ, {"SESSION_SECRET": "s" * 32}):
                token = auth.issue_token(
                    "advocate",
                    provider="supabase",
                    user_id="hosted-user-id",
                )
                with patch.object(
                    auth.supabase_auth,
                    "profile_by_id",
                    return_value=hosted_profile,
                ) as profile_by_id:
                    user = auth.user_for_token(token)

        profile_by_id.assert_called_once_with("hosted-user-id")
        self.assertEqual(user["name"], "Hosted Patient")
        self.assertEqual(user["role"], "patient")

    def test_live_supabase_session_requires_strong_secret(self):
        token = auth.issue_token("jane")
        with patch.object(auth.supabase_auth, "configured", return_value=True):
            with patch.dict(os.environ, {"SESSION_SECRET": "short"}):
                with self.assertRaises(auth.SessionUnavailableError):
                    auth.login("jane", "demo")
                self.assertIsNone(auth.user_for_token(token))

    def test_supabase_session_requires_user_id(self):
        with self.assertRaises(ValueError):
            auth.issue_token("jane", provider="supabase")

    def test_logout_clears_session_and_coverage_cookies(self):
        token = auth.issue_token("jane")
        with patch.object(main.careloop_auth, "logout") as logout:
            response = main.careloop_logout(
                request(cookie=f"{auth.SESSION_COOKIE}={token}"),
                authorization=None,
            )

        logout.assert_called_once_with(token)
        cookies = [
            value.decode("latin-1")
            for name, value in response.raw_headers
            if name.lower() == b"set-cookie"
        ]
        for name in (auth.SESSION_COOKIE, "careloop_coverage"):
            deleted = next(value for value in cookies if value.startswith(f"{name}="))
            self.assertIn("Max-Age=0", deleted)


if __name__ == "__main__":
    unittest.main()
