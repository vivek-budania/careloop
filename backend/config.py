"""Application configuration. Loads API keys from environment."""

import os
from dotenv import load_dotenv

# Process / container env wins. Inject STEDI_API_KEY at launch; do not bake it
# into the image. A laptop `.env` is only a fallback (gitignored).
load_dotenv(override=False)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-flash-lite-latest"

# Stedi *test* key. Prefer the container env at launch. Never commit this value.
# Production Stedi keys are out of scope.
STEDI_API_KEY = os.getenv("STEDI_API_KEY", "")

# Backup LLM, used automatically if Gemini fails (quota exceeded, outage, etc.)
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = "openai/gpt-oss-20b"

# Optional xAI Grok speech-to-text for visit scribe (not Groq).
XAI_API_KEY = os.getenv("XAI_API_KEY", "")
XAI_STT_URL = os.getenv("XAI_STT_URL", "https://api.x.ai/v1/stt")


def _key_loaded(value: str) -> bool:
    raw = (value or "").strip()
    return bool(raw) and raw not in (
        "your_api_key_here",
        "your_key_here",
        "your_stedi_key_here",
    )


def demo_env_status() -> dict:
    """Which demo keys are loaded. Never returns secret values."""
    from backend.careloop import stedi as careloop_stedi
    from backend.careloop import auth as careloop_auth

    gemini_on = _key_loaded(GEMINI_API_KEY)
    groq_on = _key_loaded(GROQ_API_KEY)
    xai_on = _key_loaded(XAI_API_KEY)
    return {
        "session": careloop_auth.session_status(),
        "stedi": careloop_stedi.status(),
        "gemini": {
            "configured": gemini_on,
            "used_for": "Insurance card/SBC read + /letters drafts",
            "message": (
                "GEMINI_API_KEY is loaded. Insurance can read an uploaded card/SBC. "
                "Letter drafts at /letters still need human review."
            ) if gemini_on else (
                "GEMINI_API_KEY is not set. Use the Jane Doe sample card. "
                "Letter drafts at /letters need this key. "
                "Add it on the host or in Vercel, then Redeploy."
            ),
        },
        "groq": {
            "configured": groq_on,
            "used_for": "Optional letter fallback",
            "message": (
                "GROQ_API_KEY is loaded as a Gemini fallback."
                if groq_on
                else "GROQ_API_KEY is optional. Add it the same way when you have it."
            ),
        },
        "xai": {
            "configured": xai_on,
            "used_for": "Optional visit speech-to-text",
            "message": (
                "XAI_API_KEY is loaded. Visit scribe can transcribe uploaded or recorded audio."
                if xai_on
                else (
                    "XAI_API_KEY is optional. Use the seeded visit transcript until you add it "
                    "on this host or in Vercel, then Redeploy."
                )
            ),
        },
        "vercel": {
            "entrypoint": "backend.main:app",
            "message": (
                "Vercel reads STEDI_API_KEY, GEMINI_API_KEY, and optional GROQ_API_KEY, "
                "XAI_API_KEY, and SESSION_SECRET from Project Settings → Environment Variables "
                "(Production + Preview), then Redeploy. Cursor/cloud-agent env does not "
                "reach Vercel. Do not replace / with a JSON stub."
            ),
        },
    }

# Safety watermark stamped on every generated document
DRAFT_WATERMARK = (
    "⚠️ AI-DRAFTED DOCUMENT — NOT YET REVIEWED BY A LICENSED PROFESSIONAL. "
    "Do NOT submit without human verification."
)

# National claim denial/appeal statistics — used to give patients context on
# whether appealing is worth it. Real, cited figures (not derived from any
# dataset processed by this app) — do not adjust without updating the source.
NATIONAL_APPEAL_STATS = {
    "denial_rate_pct": 16.6,
    "appeal_rate_pct": 0.2,
    "overturn_rate_pct": 41,
    "plan_year": 2021,
    "source": "KFF analysis of CMS Transparency in Coverage data, 2021 plan year (published Feb 9, 2023)",
    "source_url": "https://www.kff.org/private-insurance/issue-brief/claims-denials-and-appeals-in-aca-marketplace-plans/",
}
