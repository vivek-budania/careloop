"""Extractive visit summary via Sumy LexRank — no LLM / no Grok.

Used by Stream C CLI and POST /api/careloop/scribe/summarize.

On Vercel the function filesystem is read-only except /tmp. NLTK's default
data dir is $HOME/nltk_data, which raises Errno 30 and 500s step 6.
"""

from __future__ import annotations

import os
import re
from typing import Any


def _nltk_data_dir() -> str:
    """Writable NLTK corpus path. Vercel / Lambda can only write to /tmp."""
    if os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
        path = "/tmp/nltk_data"
    else:
        path = os.environ.get("NLTK_DATA") or os.path.join(
            os.path.expanduser("~"), "nltk_data"
        )
    os.makedirs(path, exist_ok=True)
    return path


def _ensure_nltk_tokenizers() -> None:
    """Sumy LexRank needs NLTK punkt; download once into a writable dir."""
    import ssl

    import certifi
    import nltk

    data_dir = _nltk_data_dir()
    os.environ["NLTK_DATA"] = data_dir
    if data_dir not in nltk.data.path:
        nltk.data.path.insert(0, data_dir)

    try:
        nltk.data.find("tokenizers/punkt")
        nltk.data.find("tokenizers/punkt_tab")
        return
    except LookupError:
        pass

    ctx = ssl.create_default_context(cafile=certifi.where())
    ssl._create_default_https_context = lambda: ctx  # noqa: SLF001
    nltk.download("punkt", download_dir=data_dir, quiet=True)
    nltk.download("punkt_tab", download_dir=data_dir, quiet=True)


def _fallback_summary(text: str, sentence_count: int) -> dict[str, Any]:
    """Plain extractive bullets when Sumy/NLTK cannot run (Vercel sandbox)."""
    n = max(1, int(sentence_count or 5))
    turns = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(turns) >= 2:
        bullets = turns[:n]
    else:
        parts = re.split(r"(?<=[.!?])\s+", text.strip())
        bullets = [p.strip() for p in parts if p.strip()][:n]
    if not bullets:
        bullets = [text.strip()[:280]]
    return {
        "method": "fallback-sentences",
        "sentence_count": len(bullets),
        "summary": " ".join(bullets),
        "bullets": bullets,
        "source_chars": len(text),
        "note": (
            "Extractive draft (simple split — Sumy/NLTK unavailable on this host). "
            "Clinician must review (Stream C gate)."
        ),
    }


def summarize_text(text: str, sentence_count: int = 5) -> dict[str, Any]:
    """Extractive summary with Sumy LexRank; fall back if NLTK cannot write."""
    cleaned = (text or "").strip()
    if not cleaned:
        raise ValueError("No transcript text to summarize.")

    try:
        from sumy.nlp.tokenizers import Tokenizer
        from sumy.parsers.plaintext import PlaintextParser
        from sumy.summarizers.lex_rank import LexRankSummarizer

        _ensure_nltk_tokenizers()

        lines = [ln.strip() for ln in cleaned.splitlines() if ln.strip()]
        if len(lines) >= 2:
            prose = ". ".join(ln.rstrip(".") for ln in lines) + "."
        else:
            prose = cleaned
        parser = PlaintextParser.from_string(prose, Tokenizer("english"))
        sentences = list(parser.document.sentences)
        if not sentences:
            return _fallback_summary(cleaned, sentence_count)

        n = max(1, min(int(sentence_count or 5), len(sentences)))
        summarizer = LexRankSummarizer()
        selected = summarizer(parser.document, n)
        bullets = [str(s).strip() for s in selected if str(s).strip()]
        if not bullets:
            return _fallback_summary(cleaned, sentence_count)

        return {
            "method": "sumy-lexrank",
            "sentence_count": len(bullets),
            "summary": " ".join(bullets),
            "bullets": bullets,
            "source_chars": len(cleaned),
            "note": "Extractive draft only — clinician must review (Stream C gate).",
        }
    except ValueError:
        raise
    except Exception:
        return _fallback_summary(cleaned, sentence_count)
