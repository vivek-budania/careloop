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

    def write(h, text_line, bold=False, size=11):
        pdf.set_font("Helvetica", "B" if bold else "", size)
        pdf.multi_cell(0, h, _latin1(text_line), new_x="LMARGIN", new_y="NEXT")

    write(10, title, bold=True, size=16)
    pdf.ln(6)
    pdf.set_text_color(40, 50, 45)
    pdf.set_font("Helvetica", "", 11)

    for raw in text.split("\n"):
        line = raw.rstrip()
        if not line:
            pdf.ln(4)
            continue
        if line.startswith("# "):
            write(8, line[2:].strip(), bold=True, size=14)
            pdf.ln(2)
        elif line.startswith("## "):
            write(7, line[3:].strip(), bold=True, size=12)
            pdf.ln(1)
        elif line.startswith("### "):
            write(6, line[4:].strip(), bold=True, size=11)
        elif line.startswith("- ") or line.startswith("* "):
            write(6, "  • " + line[2:].strip())
        else:
            write(6, line)

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
