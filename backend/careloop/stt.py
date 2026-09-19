"""Optional Grok (xAI) speech-to-text for visit scribe.

Fixture transcript remains the default demo path. This module only runs when
XAI_API_KEY is set and the clinician uploads / records audio.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from backend.config import XAI_API_KEY, XAI_STT_URL


def _is_configured(key: str) -> bool:
    return bool(key) and key not in ("your_api_key_here", "your_xai_api_key_here")


def transcribe_audio(filename: str, content_type: str, data: bytes) -> dict[str, Any]:
    """Upload audio bytes to xAI STT and return {text, language?, raw?}."""
    if not _is_configured(XAI_API_KEY):
        raise ValueError(
            "XAI_API_KEY not set. Create a key at https://console.x.ai and add it to .env "
            "(after rotating any key that was shared in chat)."
        )
    if not data:
        raise ValueError("Audio file is empty.")

    boundary = "----CareLoopScribeBoundary7MA4YWxkTrZu0gW"
    name = filename or "visit.webm"
    ctype = content_type or "application/octet-stream"

    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{name}"\r\n'
        f"Content-Type: {ctype}\r\n\r\n"
    ).encode("utf-8") + data + f"\r\n--{boundary}--\r\n".encode("utf-8")

    req = urllib.request.Request(
        XAI_STT_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {XAI_API_KEY}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise ValueError(f"Grok STT failed ({e.code}): {detail}") from e
    except urllib.error.URLError as e:
        raise ValueError(f"Grok STT unreachable: {e}") from e

    text = (raw.get("text") or "").strip()
    if not text:
        raise ValueError("Grok STT returned an empty transcript.")

    return {
        "text": text,
        "language": raw.get("language"),
        "source": "grok-stt",
    }
