"""Extractive visit summary via Sumy LexRank — no LLM / no Grok.

Used by Stream C CLI and POST /api/careloop/scribe/summarize.
"""

from __future__ import annotations

from typing import Any


def _ensure_nltk_tokenizers() -> None:
    """Sumy LexRank needs NLTK punkt; download once (SSL via certifi on macOS)."""
    import ssl

    import certifi
    import nltk

    try:
        nltk.data.find("tokenizers/punkt")
        nltk.data.find("tokenizers/punkt_tab")
        return
    except LookupError:
        pass

    ctx = ssl.create_default_context(cafile=certifi.where())
    ssl._create_default_https_context = lambda: ctx  # noqa: SLF001
    nltk.download("punkt", quiet=True)
    nltk.download("punkt_tab", quiet=True)


def summarize_text(text: str, sentence_count: int = 5) -> dict[str, Any]:
    """Extractive summary with Sumy LexRank."""
    from sumy.nlp.tokenizers import Tokenizer
    from sumy.parsers.plaintext import PlaintextParser
    from sumy.summarizers.lex_rank import LexRankSummarizer

    cleaned = (text or "").strip()
    if not cleaned:
        raise ValueError("No transcript text to summarize.")

    _ensure_nltk_tokenizers()

    lines = [ln.strip() for ln in cleaned.splitlines() if ln.strip()]
    if len(lines) >= 2:
        prose = ". ".join(ln.rstrip(".") for ln in lines) + "."
    else:
        prose = cleaned
    parser = PlaintextParser.from_string(prose, Tokenizer("english"))
    sentences = list(parser.document.sentences)
    if not sentences:
        raise ValueError("Could not split transcript into sentences.")

    n = max(1, min(int(sentence_count or 5), len(sentences)))
    summarizer = LexRankSummarizer()
    selected = summarizer(parser.document, n)
    bullets = [str(s).strip() for s in selected if str(s).strip()]

    return {
        "method": "sumy-lexrank",
        "sentence_count": len(bullets),
        "summary": " ".join(bullets),
        "bullets": bullets,
        "source_chars": len(cleaned),
        "note": "Extractive draft only — clinician must review (Stream C gate).",
    }
