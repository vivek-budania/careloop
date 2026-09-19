#!/usr/bin/env python3
"""Stream C CLI — Sreekar scribe helpers (plan.md workstream C).

Two commands only:
  1) summary      — extractive visit summary via Sumy (LexRank). No Grok / no LLM.
  2) transcribe   — audio → text via existing Grok STT (backend.careloop.stt).

Does not call FastAPI routes or change the web app. Reuses careloop modules.

Examples:
  python3 scripts/scribe_cli.py summary
  python3 scripts/scribe_cli.py summary --transcript path/to/notes.txt --sentences 6
  python3 scripts/scribe_cli.py transcribe demo/sample-visit.wav
  python3 scripts/scribe_cli.py summary --from-audio demo/sample-visit.wav
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import sys
from pathlib import Path

# Repo root on sys.path so `backend.*` imports work when run as a script.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")


def _guess_content_type(path: Path) -> str:
    ctype, _ = mimetypes.guess_type(str(path))
    return ctype or "application/octet-stream"


def cmd_transcribe(audio: Path) -> dict:
    """Grok STT (existing Stream C module)."""
    from backend.careloop import stt as careloop_stt

    if not audio.is_file():
        raise FileNotFoundError(f"Audio not found: {audio}")
    data = audio.read_bytes()
    return careloop_stt.transcribe_audio(
        filename=audio.name,
        content_type=_guess_content_type(audio),
        data=data,
    )


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


def summarize_text(text: str, sentence_count: int = 5) -> dict:
    """Extractive summary with Sumy LexRank — no LLM / no Grok."""
    from sumy.nlp.tokenizers import Tokenizer
    from sumy.parsers.plaintext import PlaintextParser
    from sumy.summarizers.lex_rank import LexRankSummarizer

    cleaned = (text or "").strip()
    if not cleaned:
        raise ValueError("No transcript text to summarize.")

    _ensure_nltk_tokenizers()

    # Speaker-labeled transcripts: one line → one sentence for LexRank.
    lines = [ln.strip() for ln in cleaned.splitlines() if ln.strip()]
    if len(lines) >= 2:
        prose = ". ".join(ln.rstrip(".") for ln in lines) + "."
    else:
        prose = cleaned
    parser = PlaintextParser.from_string(prose, Tokenizer("english"))
    sentences = list(parser.document.sentences)
    if not sentences:
        raise ValueError("Could not split transcript into sentences.")

    n = max(1, min(sentence_count, len(sentences)))
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


def _load_transcript_text(args: argparse.Namespace) -> str:
    if args.from_audio:
        result = cmd_transcribe(Path(args.from_audio))
        return (result.get("text") or "").strip()
    if args.transcript:
        path = Path(args.transcript)
        if not path.is_file():
            raise FileNotFoundError(f"Transcript not found: {path}")
        return path.read_text(encoding="utf-8").strip()
    # Default: golden-path fixture (plan.md — seeded encounter is OK)
    from backend.careloop.scribe import load_fixture

    return (load_fixture().get("transcript") or "").strip()


def cmd_summary(args: argparse.Namespace) -> dict:
    text = _load_transcript_text(args)
    out = summarize_text(text, sentence_count=args.sentences)
    out["transcript_preview"] = text[:240] + ("…" if len(text) > 240 else "")
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="CareLoop Stream C CLI — summary (Sumy) + transcribe (Grok STT).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_sum = sub.add_parser(
        "summary",
        help="Extractive visit summary with Sumy LexRank (no Grok).",
    )
    p_sum.add_argument(
        "--transcript",
        "-t",
        help="Path to a transcript .txt file (default: mock visit fixture).",
    )
    p_sum.add_argument(
        "--from-audio",
        help="Transcribe this audio with Grok first, then summarize with Sumy.",
    )
    p_sum.add_argument(
        "--sentences",
        "-n",
        type=int,
        default=5,
        help="Number of extractive sentences (default: 5).",
    )
    p_sum.add_argument(
        "--json",
        action="store_true",
        help="Print full JSON instead of plain summary text.",
    )

    p_tr = sub.add_parser(
        "transcribe",
        help="Audio → text with Grok STT (backend.careloop.stt).",
    )
    p_tr.add_argument("audio", help="Path to audio file (.wav/.mp3/.webm/…).")
    p_tr.add_argument(
        "--json",
        action="store_true",
        help="Print full JSON (includes diarization fields when present).",
    )

    args = parser.parse_args(argv)

    try:
        if args.command == "transcribe":
            result = cmd_transcribe(Path(args.audio))
            if args.json:
                print(json.dumps(result, indent=2))
            else:
                print(result.get("text") or "")
            return 0

        if args.command == "summary":
            result = cmd_summary(args)
            if args.json:
                print(json.dumps(result, indent=2))
            else:
                print(result["summary"])
                if result.get("bullets"):
                    print("\n— bullets —")
                    for b in result["bullets"]:
                        print(f"• {b}")
            return 0
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
