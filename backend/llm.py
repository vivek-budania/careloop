"""LLM client wrapper — Gemini primary, Groq fallback, xAI vision for images.

Thin wrapper around the google-generativeai and groq SDKs. Handles
configuration, safety watermarking, and automatically falls back to
Groq if Gemini fails (quota exceeded, outage, retired model, etc.).
Image-to-JSON uses XAI_API_KEY first (Vercel slot), then Gemini.
"""

import base64
import json
import os
import ssl
import urllib.error
import urllib.request

import certifi
import google.generativeai as genai
from groq import Groq

from backend.config import (
    GEMINI_API_KEY,
    GEMINI_MODEL,
    GROQ_API_KEY,
    GROQ_MODEL,
    DRAFT_WATERMARK,
    XAI_API_KEY,
    XAI_CHAT_URL,
    XAI_VISION_MODEL,
)


def _is_configured(key: str) -> bool:
    return bool(key) and key not in (
        "your_api_key_here",
        "your_key_here",
        "your_xai_api_key_here",
    )


def _gemini_key() -> str:
    return (os.getenv("GEMINI_API_KEY") or GEMINI_API_KEY or "").strip()


def _xai_key() -> str:
    return (os.getenv("XAI_API_KEY") or XAI_API_KEY or "").strip()


def _gemini_generate(
    system_prompt: str,
    user_message: str,
    *,
    json_mode: bool,
    temperature: float,
    media: list | None = None,
) -> str:
    key = _gemini_key()
    if not _is_configured(key):
        raise ValueError(
            "GEMINI_API_KEY not set. Get a free key at https://aistudio.google.com/apikey "
            "and inject it at container launch (or a local .env)."
        )

    genai.configure(api_key=key)
    model = genai.GenerativeModel(
        model_name=GEMINI_MODEL,
        system_instruction=system_prompt,
        generation_config=genai.GenerationConfig(
            temperature=temperature,
            max_output_tokens=4096,
            **({"response_mime_type": "application/json"} if json_mode else {}),
        ),
    )
    contents: list = [user_message]
    for item in media or []:
        contents.append({
            "mime_type": item["mime_type"],
            "data": item["data"],
        })
    response = model.generate_content(contents if len(contents) > 1 else user_message)
    return response.text.strip()


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
            "XAI_API_KEY not set. Add it on this host or in Vercel, then Redeploy."
        )
    content: list = []
    for item in media or []:
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
    body = {
        "model": XAI_VISION_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": content if media else user_message},
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
        raise ValueError(f"xAI vision failed ({exc.code}): {detail}") from exc
    choices = payload.get("choices") or []
    if not choices:
        raise ValueError("xAI vision returned no choices.")
    text = ((choices[0].get("message") or {}).get("content") or "").strip()
    if not text:
        raise ValueError("xAI vision returned empty text.")
    return text


def _generate_with_fallback(
    system_prompt: str,
    user_message: str,
    *,
    json_mode: bool,
    temperature: float,
    media: list | None = None,
) -> str:
    """Images: xAI first (XAI_API_KEY), then Gemini. Text: Gemini, then Groq."""
    if media:
        errors = []
        if _is_configured(_xai_key()):
            try:
                return _xai_generate(
                    system_prompt,
                    user_message,
                    json_mode=json_mode,
                    temperature=temperature,
                    media=media,
                )
            except Exception as exc:
                errors.append(f"xAI: {exc}")
        if _is_configured(_gemini_key()):
            try:
                return _gemini_generate(
                    system_prompt,
                    user_message,
                    json_mode=json_mode,
                    temperature=temperature,
                    media=media,
                )
            except Exception as exc:
                errors.append(f"Gemini: {exc}")
        if errors:
            raise ValueError(" ".join(errors))
        raise ValueError(
            "XAI_API_KEY is not set. Add it on this host or in Vercel to read uploaded images. "
            "The Jane Doe sample card still works without a key."
        )

    try:
        return _gemini_generate(
            system_prompt,
            user_message,
            json_mode=json_mode,
            temperature=temperature,
            media=None,
        )
    except Exception as gemini_error:
        if not _is_configured(GROQ_API_KEY):
            raise
        try:
            return _groq_generate(system_prompt, user_message, json_mode=json_mode, temperature=temperature)
        except Exception as groq_error:
            raise ValueError(
                f"Both LLM providers failed. Gemini: {gemini_error}. Groq: {groq_error}"
            ) from groq_error


def generate(system_prompt: str, user_message: str, add_watermark: bool = True) -> str:
    """Generate a response from an LLM (Gemini, falling back to Groq).

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
    """Generate a JSON response. Images use XAI_API_KEY first, then Gemini.

    Used for structured parsing (denial letters, insurance-card extraction).
    Do not watermark JSON. `media` is a list of {mime_type, data: bytes} for vision.
    """
    return _generate_with_fallback(
        system_prompt,
        user_message,
        json_mode=True,
        temperature=0.1,
        media=media,
    )
