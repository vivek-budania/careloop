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
