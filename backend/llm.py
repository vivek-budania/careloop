"""LLM client wrapper — Gemini primary, Groq fallback.

Thin wrapper around the google-generativeai and groq SDKs. Handles
configuration, safety watermarking, and automatically falls back to
Groq if Gemini fails (quota exceeded, outage, retired model, etc.).
"""

import google.generativeai as genai
from groq import Groq

from backend.config import (
    GEMINI_API_KEY,
    GEMINI_MODEL,
    GROQ_API_KEY,
    GROQ_MODEL,
    DRAFT_WATERMARK,
)


def _is_configured(key: str) -> bool:
    return bool(key) and key != "your_api_key_here"


def _gemini_generate(system_prompt: str, user_message: str, *, json_mode: bool, temperature: float) -> str:
    if not _is_configured(GEMINI_API_KEY):
        raise ValueError(
            "GEMINI_API_KEY not set. Get a free key at https://aistudio.google.com/apikey "
            "and add it to your .env file."
        )

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(
        model_name=GEMINI_MODEL,
        system_instruction=system_prompt,
        generation_config=genai.GenerationConfig(
            temperature=temperature,
            max_output_tokens=4096,
            **({"response_mime_type": "application/json"} if json_mode else {}),
        ),
    )
    response = model.generate_content(user_message)
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


def _generate_with_fallback(system_prompt: str, user_message: str, *, json_mode: bool, temperature: float) -> str:
    """Try Gemini first; fall back to Groq if Gemini fails and a Groq key is configured."""
    try:
        return _gemini_generate(system_prompt, user_message, json_mode=json_mode, temperature=temperature)
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
    text = _generate_with_fallback(system_prompt, user_message, json_mode=False, temperature=0.3)

    if add_watermark:
        text = f"{DRAFT_WATERMARK}\n\n---\n\n{text}\n\n---\n\n{DRAFT_WATERMARK}"

    return text


def generate_json(system_prompt: str, user_message: str) -> str:
    """Generate a JSON response from an LLM (Gemini, falling back to Groq).

    Used for structured parsing tasks like denial letter analysis.

    Args:
        system_prompt: The system instruction for the model.
        user_message: The user's input/context.

    Returns:
        The generated JSON string.
    """
    return _generate_with_fallback(system_prompt, user_message, json_mode=True, temperature=0.1)
