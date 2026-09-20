"""Simple PDF export for the patient history packet (demo record view).

Not a letter — no DRAFT_WATERMARK / HITL path. Vivek owns share UX; this is
the Stream C helper that turns the same markdown packet into a downloadable PDF.
"""

from __future__ import annotations


def build_history_pdf(markdown: str, title: str = "CareLoop history packet") -> bytes:
    """Render plain/markdown-ish text to a minimal multi-page PDF."""
    from fpdf import FPDF

    text = (markdown or "").replace("\r\n", "\n").strip()
    if not text:
        raise ValueError("No packet text to export.")

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.multi_cell(0, 10, _latin1(title))
    pdf.ln(6)
    pdf.set_text_color(40, 50, 45)
    pdf.set_font("Helvetica", "", 11)

    for raw in text.split("\n"):
        line = raw.rstrip()
        if not line:
            pdf.ln(4)
            continue
        if line.startswith("# "):
            pdf.set_font("Helvetica", "B", 14)
            pdf.multi_cell(0, 8, _latin1(line[2:].strip()))
            pdf.set_font("Helvetica", "", 11)
            pdf.ln(2)
        elif line.startswith("## "):
            pdf.set_font("Helvetica", "B", 12)
            pdf.multi_cell(0, 7, _latin1(line[3:].strip()))
            pdf.set_font("Helvetica", "", 11)
            pdf.ln(1)
        elif line.startswith("### "):
            pdf.set_font("Helvetica", "B", 11)
            pdf.multi_cell(0, 6, _latin1(line[4:].strip()))
            pdf.set_font("Helvetica", "", 11)
        elif line.startswith("- ") or line.startswith("* "):
            pdf.multi_cell(0, 6, _latin1("  • " + line[2:].strip()))
        else:
            pdf.multi_cell(0, 6, _latin1(line))

    out = pdf.output()
    if isinstance(out, (bytes, bytearray)):
        return bytes(out)
    return str(out).encode("latin-1", errors="replace")


def _latin1(s: str) -> str:
    """FPDF core fonts are Latin-1; replace unsupported glyphs."""
    return (
        (s or "")
        .replace("—", "-")
        .replace("–", "-")
        .replace("“", '"')
        .replace("”", '"')
        .replace("‘", "'")
        .replace("’", "'")
        .replace("…", "...")
        .replace("·", "|")
        .encode("latin-1", errors="replace")
        .decode("latin-1")
    )
