"""Optional Grok (xAI) speech-to-text for visit scribe.

Supports speaker diarization (doctor vs patient) via xAI `diarize=true`.
Fixture transcript remains the default demo path when no audio is used.
"""

from __future__ import annotations

import json
import re
import ssl
import urllib.error
import urllib.request
from typing import Any

import certifi

from backend.config import XAI_API_KEY, XAI_STT_URL

# Bias ASR toward golden-path clinical terms (xAI keyterm param, max 100).
_MEDICAL_KEYTERMS = (
    "metformin",
    "HbA1c",
    "semaglutide",
    "GLP-1",
    "type 2 diabetes",
    "prior authorization",
    "doctor",
    "patient",
)

_DOCTOR_CUES = re.compile(
    r"\b("
    r"assessment|diagnosis|prescribe|prescription|exam(?:ination)?|blood pressure|"
    r"HbA1c|A1[cC]|lab(?:s)?|follow[- ]?up|prior auth|plan|order(?:ed)?|"
    r"metformin|semaglutide|GLP-?1|listen(?:ing)? to your|how have things|"
    r"any (?:side effects|questions|allergies)|we'll (?:order|submit|repeat)"
    r")\b",
    re.I,
)
_PATIENT_CUES = re.compile(
    r"\b("
    r"I(?:'ve| have) been|my (?:sugars?|glucose|pain|symptoms)|I feel|"
    r"it hurts|I(?:'m| am) (?:often|still)|thank you|will insurance|"
    r"side effects from|at home I"
    r")\b",
    re.I,
)


def _is_configured(key: str) -> bool:
    return bool(key) and key not in ("your_api_key_here", "your_xai_api_key_here")


def _multipart_body(
    filename: str,
    content_type: str,
    data: bytes,
    fields: list[tuple[str, str]],
) -> tuple[bytes, str]:
    boundary = "----CareLoopScribeBoundary7MA4YWxkTrZu0gW"
    parts: list[bytes] = []
    for name, value in fields:
        parts.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
                f"{value}\r\n"
            ).encode("utf-8")
        )
    name = filename or "visit.webm"
    ctype = content_type or "application/octet-stream"
    parts.append(
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{name}"\r\n'
            f"Content-Type: {ctype}\r\n\r\n"
        ).encode("utf-8")
        + data
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def _group_words_into_turns(words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse word-level speaker tags into consecutive speaking turns."""
    turns: list[dict[str, Any]] = []
    for w in words:
        if not isinstance(w, dict):
            continue
        token = (w.get("text") or "").strip()
        if not token:
            continue
        speaker = w.get("speaker")
        if speaker is None:
            speaker = 0
        try:
            speaker = int(speaker)
        except (TypeError, ValueError):
            speaker = 0

        start = w.get("start")
        end = w.get("end")
        if turns and turns[-1]["speaker_id"] == speaker:
            turns[-1]["tokens"].append(token)
            if end is not None:
                turns[-1]["end"] = end
        else:
            turns.append({
                "speaker_id": speaker,
                "tokens": [token],
                "start": start,
                "end": end,
            })

    for t in turns:
        t["text"] = " ".join(t.pop("tokens")).strip()
        # Light cleanup: drop space before punctuation if model split oddly
        t["text"] = re.sub(r"\s+([,.!?;:])", r"\1", t["text"])
    return [t for t in turns if t.get("text")]


def _score_role(text: str) -> tuple[int, int]:
    doctor = len(_DOCTOR_CUES.findall(text))
    patient = len(_PATIENT_CUES.findall(text))
    return doctor, patient


def _assign_doctor_patient(turns: list[dict[str, Any]]) -> dict[int, str]:
    """Map numeric speaker ids → Doctor / Patient using clinical cues.

    Diarization only returns speaker 0, 1, … — we label the two most talkative
    voices for a PCP visit. Heuristic only; clinician should still review.
    """
    if not turns:
        return {}

    by_id: dict[int, list[str]] = {}
    for t in turns:
        by_id.setdefault(t["speaker_id"], []).append(t["text"])

    speaker_ids = sorted(by_id.keys())
    if len(speaker_ids) == 1:
        # Single voice detected — still label as Visit voice (not fake split)
        return {speaker_ids[0]: "SPEAKER"}

    scores: dict[int, tuple[int, int, int]] = {}
    for sid, parts in by_id.items():
        joined = " ".join(parts)
        d, p = _score_role(joined)
        scores[sid] = (d, p, len(joined))

    # Highest doctor-cue score wins Doctor; highest patient-cue among remaining wins Patient
    doctor_id = max(speaker_ids, key=lambda s: (scores[s][0], -scores[s][1], scores[s][2]))
    remaining = [s for s in speaker_ids if s != doctor_id]
    # Prefer patient cues; if tied, pick the other of the top-two by talk time
    patient_id = max(remaining, key=lambda s: (scores[s][1], scores[s][2]))

    # If cues are empty for both, fall back: first speaker in timeline = Doctor
    if scores[doctor_id][0] == 0 and scores[patient_id][1] == 0:
        first_id = turns[0]["speaker_id"]
        other = next(s for s in speaker_ids if s != first_id)
        return {first_id: "DOCTOR", other: "PATIENT"}

    mapping = {doctor_id: "DOCTOR", patient_id: "PATIENT"}
    for sid in speaker_ids:
        if sid not in mapping:
            mapping[sid] = f"SPEAKER {sid}"
    return mapping


def format_diarized_transcript(turns: list[dict[str, Any]], role_map: dict[int, str]) -> str:
    """Human-readable transcript with DOCTOR: / PATIENT: labels."""
    lines: list[str] = []
    for t in turns:
        role = role_map.get(t["speaker_id"], f"SPEAKER {t['speaker_id']}")
        if role == "DOCTOR":
            label = "DOCTOR"
        elif role == "PATIENT":
            label = "PATIENT"
        elif role == "SPEAKER":
            label = "SPEAKER"
        else:
            label = role
        lines.append(f"{label}: {t['text']}")
    return "\n\n".join(lines)


def build_diarized_payload(raw: dict[str, Any], plain_text: str) -> dict[str, Any]:
    words = raw.get("words") or []
    turns = _group_words_into_turns(words) if words else []
    role_map = _assign_doctor_patient(turns) if turns else {}
    diarized = format_diarized_transcript(turns, role_map) if turns else plain_text

    speakers = []
    for sid in sorted(role_map.keys()):
        speakers.append({
            "speaker_id": sid,
            "role": role_map[sid],
            "label": (
                "Doctor" if role_map[sid] == "DOCTOR"
                else "Patient" if role_map[sid] == "PATIENT"
                else role_map[sid].replace("_", " ").title()
            ),
        })

    labeled_turns = []
    for t in turns:
        role = role_map.get(t["speaker_id"], f"SPEAKER {t['speaker_id']}")
        labeled_turns.append({
            "speaker_id": t["speaker_id"],
            "role": role,
            "label": (
                "Doctor" if role == "DOCTOR"
                else "Patient" if role == "PATIENT"
                else role
            ),
            "text": t["text"],
            "start": t.get("start"),
            "end": t.get("end"),
        })

    speaker_count = len({t["speaker_id"] for t in turns}) if turns else 0

    return {
        "text": diarized if speaker_count >= 1 else plain_text,
        "text_plain": plain_text,
        "diarized": speaker_count >= 2,
        "speaker_count": speaker_count,
        "speakers": speakers,
        "turns": labeled_turns,
        "warnings": (
            []
            if speaker_count >= 2
            else [
                "Only one voice detected — speak with two people (doctor + patient) "
                "near the mic for Doctor/Patient labels."
            ]
            if speaker_count == 1
            else []
        ),
    }


def transcribe_audio(filename: str, content_type: str, data: bytes) -> dict[str, Any]:
    """Upload audio to xAI STT with diarization; return labeled doctor/patient text."""
    if not _is_configured(XAI_API_KEY):
        raise ValueError(
            "XAI_API_KEY not set. Add it to your local .env (console.x.ai). "
            "Mock visit fixture still works without STT."
        )
    if not data:
        raise ValueError("Audio file is empty.")

    fields: list[tuple[str, str]] = [
        ("model", "grok-voice-transcribe-2.0"),
        ("format", "true"),
        ("language", "en"),
        ("diarize", "true"),
    ]
    for term in _MEDICAL_KEYTERMS:
        fields.append(("keyterm", term))

    body, content_type_header = _multipart_body(
        filename=filename or "visit.webm",
        content_type=content_type or "application/octet-stream",
        data=data,
        fields=fields,
    )

    req = urllib.request.Request(
        XAI_STT_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {XAI_API_KEY}",
            "Content-Type": content_type_header,
        },
    )
    ctx = ssl.create_default_context(cafile=certifi.where())

    try:
        with urllib.request.urlopen(req, timeout=120, context=ctx) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise ValueError(f"Grok STT failed ({e.code}): {detail}") from e
    except urllib.error.URLError as e:
        raise ValueError(f"Grok STT unreachable: {e}") from e

    plain = (raw.get("text") or "").strip()
    if not plain:
        raise ValueError("Grok STT returned an empty transcript.")

    diarized = build_diarized_payload(raw, plain)
    return {
        **diarized,
        "language": raw.get("language") or "en",
        "duration": raw.get("duration"),
        "source": "grok-stt",
        "model": "grok-voice-transcribe-2.0",
    }
