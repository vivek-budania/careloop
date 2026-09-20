"""Application configuration. Loads API keys from environment."""

import os
from dotenv import load_dotenv

# Process / container env wins. Inject STEDI_API_KEY at launch; do not bake it
# into the image. A laptop `.env` is only a fallback (gitignored).
load_dotenv(override=False)

# Stedi *test* key. Prefer the container env at launch. Never commit this value.
# Production Stedi keys are out of scope.
STEDI_API_KEY = os.getenv("STEDI_API_KEY", "")

# Optional text fallback if xAI is down. Not required if XAI_API_KEY works.
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = "openai/gpt-oss-20b"

# xAI Grok: letters, image → JSON, and visit speech-to-text. Already on Vercel.
XAI_API_KEY = os.getenv("XAI_API_KEY", "")
XAI_STT_URL = os.getenv("XAI_STT_URL", "https://api.x.ai/v1/stt")
XAI_CHAT_URL = os.getenv("XAI_CHAT_URL", "https://api.x.ai/v1/chat/completions")
XAI_CHAT_MODEL = os.getenv("XAI_CHAT_MODEL", "grok-2-1212")
XAI_VISION_MODEL = os.getenv("XAI_VISION_MODEL", "grok-2-vision-1212")


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
    from backend.careloop import supabase_auth as careloop_supabase

    groq_on = _key_loaded(GROQ_API_KEY)
    xai_on = _key_loaded(XAI_API_KEY)
    return {
        "session": careloop_auth.session_status(),
        "supabase": careloop_supabase.status(),
        "stedi": careloop_stedi.status(),
        "groq": {
            "configured": groq_on,
            "used_for": "Optional letter fallback if xAI is down",
            "message": (
                "GROQ_API_KEY is loaded as an xAI text fallback."
                if groq_on
                else "GROQ_API_KEY is optional. Add it the same way when you have it."
            ),
        },
        "xai": {
            "configured": xai_on,
            "used_for": "Letter drafts, image → JSON, and visit speech-to-text",
            "message": (
                "XAI_API_KEY is loaded. Letter drafts, uploaded images, and visit scribe use xAI. "
                "Letters still need human review."
                if xai_on
                else (
                    "XAI_API_KEY is not set. Fixture sample card and seeded transcripts still work. "
                    "Letter drafts at /letters need this key. Add it on this host or in Vercel, then Redeploy."
                )
            ),
        },
        "vercel": {
            "entrypoint": "backend.main:app",
            "message": (
                "Vercel reads SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, "
                "STEDI_API_KEY, XAI_API_KEY, and optional GROQ_API_KEY "
                "and SESSION_SECRET from Project Settings → Environment Variables "
                "(Production + Preview), then Redeploy. Cursor/cloud-agent env does not "
                "reach Vercel. Never put service_role in frontend JS. Do not replace / with a JSON stub."
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
