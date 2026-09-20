import json
import os
import unittest
from unittest.mock import patch

from fastapi import Request

from backend import main
from backend.careloop import auth, supabase_auth


def request() -> Request:
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "https",
            "path": "/api/careloop/signup",
            "raw_path": b"/api/careloop/signup",
            "query_string": b"",
            "headers": [],
            "client": ("test", 1234),
            "server": ("testserver", 443),
        }
    )


class SignupWithoutVerificationTests(unittest.TestCase):
    def test_admin_create_auto_confirms_without_using_public_signup(self):
        captured = {}

        def fake_request(method, url, **kwargs):
            captured.update(method=method, url=url, **kwargs)
            return {"id": "auth-user-id", "email": kwargs["body"]["email"]}

        with patch.object(supabase_auth, "_request", side_effect=fake_request):
            with patch.object(
                supabase_auth,
                "supabase_url",
                return_value="https://example.supabase.co",
            ):
                with patch.object(
                    supabase_auth,
                    "service_role_key",
                    return_value="service-role-key",
                ):
                    with patch.object(
                        supabase_auth,
                        "anon_key",
                        side_effect=AssertionError("anon signup must not be used"),
                    ):
                        result = supabase_auth.create_confirmed_auth_user(
                            email="new@example.com",
                            password="password1",
                            username="new-user",
                            first_name="New",
                            last_name="User",
                        )

        self.assertEqual(captured["method"], "POST")
        self.assertEqual(
            captured["url"],
            "https://example.supabase.co/auth/v1/admin/users",
        )
        self.assertEqual(captured["key"], "service-role-key")
        self.assertTrue(captured["body"]["email_confirm"])
        self.assertEqual(
            captured["body"]["user_metadata"]["username"],
            "new-user",
        )
        self.assertEqual(result["id"], "auth-user-id")

    def test_signup_creates_profile_and_is_immediately_session_ready(self):
        profile = {
            "id": "auth-user-id",
            "username": "new-user",
            "email": "new@example.com",
            "first_name": "New",
            "last_name": "User",
            "date_of_birth": "1990-01-15",
        }
        with patch.object(auth.supabase_auth, "configured", return_value=True):
            with patch.dict(os.environ, {"SESSION_SECRET": "s" * 32}):
                with patch.object(auth.supabase_auth, "profile_by_username", return_value=None):
                    with patch.object(auth.supabase_auth, "profile_by_email", return_value=None):
                        with patch.object(
                            auth.supabase_auth,
                            "create_confirmed_auth_user",
                            return_value={"id": "auth-user-id"},
                        ) as create_user:
                            with patch.object(
                                auth.supabase_auth,
                                "create_profile",
                                return_value=profile,
                            ) as create_profile:
                                result = auth.signup(
                                    username="new-user",
                                    full_name="New User",
                                    email="new@example.com",
                                    password="password1",
                                    date_of_birth="1990-01-15",
                                )

        create_user.assert_called_once()
        self.assertEqual(
            create_profile.call_args.kwargs["date_of_birth"],
            "1990-01-15",
        )
        self.assertFalse(result["requires_email_confirmation"])
        self.assertNotIn("token", result)
        self.assertEqual(result["session_user_id"], "auth-user-id")

    def test_profile_failure_removes_the_confirmed_auth_user(self):
        with patch.object(auth.supabase_auth, "configured", return_value=True):
            with patch.dict(os.environ, {"SESSION_SECRET": "s" * 32}):
                with patch.object(auth.supabase_auth, "profile_by_username", return_value=None):
                    with patch.object(auth.supabase_auth, "profile_by_email", return_value=None):
                        with patch.object(
                            auth.supabase_auth,
                            "create_confirmed_auth_user",
                            return_value={"id": "auth-user-id"},
                        ):
                            with patch.object(
                                auth.supabase_auth,
                                "create_profile",
                                side_effect=ValueError("insert failed"),
                            ):
                                with patch.object(
                                    auth.supabase_auth,
                                    "delete_auth_user",
                                ) as delete_user:
                                    with self.assertRaisesRegex(
                                        ValueError,
                                        "Could not create the profile row",
                                    ):
                                        auth.signup(
                                            username="new-user",
                                            full_name="New User",
                                            email="new@example.com",
                                            password="password1",
                                            date_of_birth="1990-01-15",
                                        )

        delete_user.assert_called_once_with("auth-user-id")

    def test_signup_endpoint_sets_session_cookie_immediately(self):
        result = {
            "user": {
                "username": "new-user",
                "name": "New User",
                "role": "patient",
                "tabs": ["careloop", "claims"],
            },
            "requires_email_confirmation": False,
            "session_provider": "supabase",
            "session_user_id": "auth-user-id",
        }
        with patch.object(main.careloop_auth, "signup", return_value=result):
            response = main.careloop_signup(
                main.SignupRequest(
                    username="new-user",
                    full_name="New User",
                    email="new@example.com",
                    password="password1",
                    date_of_birth="1990-01-15",
                ),
                request(),
            )

        payload = json.loads(response.body)
        self.assertFalse(payload["requires_email_confirmation"])
        cookies = [
            value.decode("latin-1")
            for name, value in response.raw_headers
            if name.lower() == b"set-cookie"
        ]
        session_cookie = next(
            value for value in cookies if value.startswith(f"{auth.SESSION_COOKIE}=")
        )
        self.assertIn("HttpOnly", session_cookie)
        self.assertIn(f"Max-Age={auth.SESSION_TTL_SEC}", session_cookie)


if __name__ == "__main__":
    unittest.main()
