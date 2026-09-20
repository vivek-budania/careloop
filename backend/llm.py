"""LLM client wrapper — xAI primary, optional Groq text fallback.

Watermark free-text letters. Do not watermark JSON.
Images and letters both use XAI_API_KEY (already on Vercel).
"""

import base64
import json
import os
import ssl
import urllib.error
import urllib.request

import certifi
from groq import Groq

from backend.config import (
    GROQ_API_KEY,
    GROQ_MODEL,
    DRAFT_WATERMARK,
    XAI_API_KEY,
    XAI_CHAT_MODEL,
    XAI_CHAT_URL,
    XAI_VISION_MODEL,
)


def _is_configured(key: str) -> bool:
    return bool(key) and key not in (
        "your_api_key_here",
        "your_key_here",
        "your_xai_api_key_here",
    )


def _xai_key() -> str:
    return (os.getenv("XAI_API_KEY") or XAI_API_KEY or "").strip()


def _groq_generate(system_prompt: str, user_message: str, *, json_mode: bool, temperature: float) -> str:
    if not _is_configured(GROQ_API_KEY):
        raise ValueError(
            "GROQ_API_KEY not set. Get a free key at https://console.groq.com/keys "
            "and add it to your .env file."
        )

    client = Groq(api_key=GROQ_API_KEY)
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=temperature,
        max_tokens=4096,
        **({"response_format": {"type": "json_object"}} if json_mode else {}),
    )
    return response.choices[0].message.content.strip()


def _xai_generate(
    system_prompt: str,
    user_message: str,
    *,
    json_mode: bool,
    temperature: float,
    media: list | None = None,
) -> str:
    key = _xai_key()
    if not _is_configured(key):
        raise ValueError(
            "XAI_API_KEY not set. Add it on this host or in Vercel, then Redeploy. "
            "Seeded transcripts and the Jane Doe sample card still work without it."
        )
    if media:
        content: list = []
        for item in media:
            mime = (item.get("mime_type") or "image/jpeg").split(";")[0].strip().lower()
            if mime == "image/jpg":
                mime = "image/jpeg"
            data = item.get("data") or b""
            b64 = base64.b64encode(data).decode("ascii")
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{b64}", "detail": "high"},
            })
        content.append({"type": "text", "text": user_message})
        user_content = content
        model = XAI_VISION_MODEL
    else:
        user_content = user_message
        model = XAI_CHAT_MODEL
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "temperature": temperature,
        "max_tokens": 4096,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    req = urllib.request.Request(
        XAI_CHAT_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    ctx = ssl.create_default_context(cafile=certifi.where())
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        raise ValueError(f"xAI request failed ({exc.code}): {detail}") from exc
    choices = payload.get("choices") or []
    if not choices:
        raise ValueError("xAI returned no choices.")
    text = ((choices[0].get("message") or {}).get("content") or "").strip()
    if not text:
        raise ValueError("xAI returned empty text.")
    return text


def _generate_with_fallback(
    system_prompt: str,
    user_message: str,
    *,
    json_mode: bool,
    temperature: float,
    media: list | None = None,
) -> str:
    """xAI for letters, JSON, and images. Groq is optional text-only fallback."""
    try:
        return _xai_generate(
            system_prompt,
            user_message,
            json_mode=json_mode,
            temperature=temperature,
            media=media,
        )
    except Exception as xai_error:
        if media or not _is_configured(GROQ_API_KEY):
            raise
        try:
            return _groq_generate(
                system_prompt,
                user_message,
                json_mode=json_mode,
                temperature=temperature,
            )
        except Exception as groq_error:
            raise ValueError(
                f"Both LLM providers failed. xAI: {xai_error}. Groq: {groq_error}"
            ) from groq_error


def generate(system_prompt: str, user_message: str, add_watermark: bool = True) -> str:
    """Generate a free-text letter from xAI (optional Groq fallback).

    Args:
        system_prompt: The system instruction for the model.
        user_message: The user's input/context.
        add_watermark: Whether to prepend/append the safety watermark to the output.

    Returns:
        The generated text response.
    """
    text = _generate_with_fallback(
        system_prompt, user_message, json_mode=False, temperature=0.3
    )

    if add_watermark:
        text = f"{DRAFT_WATERMARK}\n\n---\n\n{text}\n\n---\n\n{DRAFT_WATERMARK}"

    return text


def generate_json(system_prompt: str, user_message: str, media: list | None = None) -> str:
    """Generate JSON from xAI. Do not watermark.

    Used for denial parsing, insurance-card extraction, and printed-page summaries.
    `media` is a list of {mime_type, data: bytes} for vision.
    """
    return _generate_with_fallback(
        system_prompt,
        user_message,
        json_mode=True,
        temperature=0.1,
        media=media,
    )
