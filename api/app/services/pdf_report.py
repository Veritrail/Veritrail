"""Generate an auditor-ready PDF compliance evidence report using fpdf2.

The report is intentionally print-first: compact sections, predictable page
breaks, and neutral audit language rather than dashboard chrome.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from fpdf import FPDF

from app.models.aws_account import AwsAccount

_REPLACEMENTS = {
    "—": "-",
    "–": "-",
    "…": "...",
    "·": ".",
    "•": "-",
    "✓": "OK",
    "→": "->",
    "\u2019": "'",
    "\u2018": "'",
    "\u201c": '"',
    "\u201d": '"',
}

_FONT = {
    "display": 24,
    "h1": 18,
    "h2": 13,
    "h3": 10.5,
    "body": 9.5,
    "small": 8.2,
    "tiny": 7.3,
    "table": 8.4,
    "mono": 8.0,
}

_FRAMEWORK_LABELS = {
    "soc2": "SOC 2 Trust Services Criteria",
    "cis_aws_l1": "CIS Amazon Web Services Foundations Benchmark - Level 1",
    "iso27001": "ISO 27001:2022 Annex A",
}

_FRAMEWORK_SHORT = {
    "soc2": "SOC 2",
    "cis_aws_l1": "CIS AWS L1",
    "iso27001": "ISO 27001",
}

_FRAMEWORK_PACK_BADGE = {
    "soc2": "SOC 2 Evidence Pack",
    "cis_aws_l1": "CIS AWS Evidence Pack",
    "iso27001": "ISO 27001 Evidence Pack",
}

_STATUS = {
    "pass": {"label": "Pass", "fill": (236, 253, 245), "text": (4, 120, 87), "border": (167, 243, 208)},
    "fail": {"label": "Needs Review", "fill": (255, 251, 235), "text": (180, 83, 9), "border": (253, 230, 138)},
    "no_data": {"label": "No Data", "fill": (248, 250, 252), "text": (100, 116, 139), "border": (226, 232, 240)},
}

_EVIDENCE = {
    "complete": {"label": "Complete", "fill": (239, 246, 255), "text": (29, 78, 216), "border": (191, 219, 254)},
    "partial": {"label": "Partial", "fill": (255, 251, 235), "text": (180, 83, 9), "border": (253, 230, 138)},
    "missing": {"label": "Missing", "fill": (248, 250, 252), "text": (100, 116, 139), "border": (226, 232, 240)},
}

_SEVERITY = {
    "critical": {"label": "Critical", "fill": (254, 226, 226), "text": (153, 27, 27), "border": (252, 165, 165)},
    "high": {"label": "High", "fill": (254, 226, 226), "text": (185, 28, 28), "border": (252, 165, 165)},
    "medium": {"label": "Medium", "fill": (255, 247, 237), "text": (194, 65, 12), "border": (254, 215, 170)},
    "low": {"label": "Low", "fill": (248, 250, 252), "text": (71, 85, 105), "border": (226, 232, 240)},
}

_SEV_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
INK = (15, 23, 42)
MUTED = (100, 116, 139)
SUBTLE = (226, 232, 240)
SOFT_BG = (248, 250, 252)
BLUE = (37, 99, 235)
GREEN = (5, 150, 105)
AMBER = (217, 119, 6)
RED = (220, 38, 38)


def _s(value: Any) -> str:
    text = "" if value is None else str(value)
    for ch, rep in _REPLACEMENTS.items():
        text = text.replace(ch, rep)
    return text.encode("latin-1", errors="replace").decode("latin-1")


def _fmt_date(raw: str | None) -> str:
    if not raw:
        return "-"
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00")).strftime("%Y-%m-%d")
    except Exception:
        return str(raw)[:10]


def _truncate_middle(text: str, max_len: int = 74) -> str:
    text = _s(text)
    if len(text) <= max_len:
        return text
    keep = max(6, (max_len - 3) // 2)
    return f"{text[:keep]}...{text[-keep:]}"


def _resource_name(resource_arn: str) -> str:
    arn = resource_arn or ""
    if arn.startswith("arn:aws:iam::"):
        for marker in (":role/", ":user/", ":policy/"):
            if marker in arn:
                return _truncate_middle(arn.split(marker, 1)[1].rsplit("/", 1)[-1], 52)
    if arn.startswith("arn:aws:s3:::"):
        return _truncate_middle(arn.replace("arn:aws:s3:::", "s3://", 1), 60)
    if arn.startswith("github://") or arn.startswith("gitlab://"):
        return _truncate_middle(arn.rsplit("/", 1)[-1], 52)
    if "/" in arn:
        return _truncate_middle(arn.rsplit("/", 1)[-1], 52)
    return _truncate_middle(arn, 52) or "Resource"


def _resource_display(resource_arn: str, max_len: int = 96) -> str:
    arn = resource_arn or "-"
    if arn.startswith("arn:aws:s3:::"):
        arn = arn.replace("arn:aws:s3:::", "s3://", 1)
    return _truncate_middle(arn, max_len)


def _objective_text(title: str) -> str:
    title = _s(title)
    if " - " in title:
        return title.split(" - ", 1)[1].strip()
    return title


def _severity_counts(findings: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for finding in findings:
        sev = (finding.get("severity") or "medium").lower()
        counts[sev] = counts.get(sev, 0) + 1
    return counts


def _severity_summary(counts: dict[str, int]) -> str:
    if not counts:
        return "No severity breakdown"
    return " / ".join(
        f"{counts[key]} {key.capitalize()}"
        for key in sorted(counts, key=lambda item: _SEV_ORDER.get(item, 99))
    )


def _review_priority(control: dict[str, Any]) -> tuple[int, int, int, int, str]:
    findings = control.get("findings") or []
    counts = _severity_counts(findings)
    finding_count = int(control.get("finding_count") or sum(counts.values()) or 0)
    worst = min((_SEV_ORDER.get(k, 99) for k in counts), default=99)
    return (-finding_count, -counts.get("critical", 0), -counts.get("high", 0), worst, control.get("control_id", ""))


def _key_controls_for_review(control_results: list[dict[str, Any]], *, limit: int = 5) -> list[dict[str, Any]]:
    review = [r for r in control_results if r.get("status") == "fail"]
    review.sort(key=_review_priority)
    return review[:limit]


def _mark_path() -> Path | None:
    here = Path(__file__).resolve()
    candidates = [here.parent.parent / "assets" / "vigil-mark.png"]
    if len(here.parents) > 3:
        candidates.append(here.parents[3] / "web" / "public" / "favicon.png")
    for path in candidates:
        if path.is_file():
            return path
    return None


class VigilEvidencePDF(FPDF):
    def __init__(self, *, report_id: str, framework_short: str, period_days: int) -> None:
        super().__init__(orientation="P", unit="mm", format="A4")
        self.report_id = report_id
        self.framework_short = framework_short
        self.period_days = period_days

    def footer(self) -> None:
        self.set_y(-17)
        self.set_draw_color(*SUBTLE)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(2.5)
        self.set_font("Helvetica", "", _FONT["tiny"])
        self.set_text_color(*MUTED)
        self.cell(
            0,
            3.8,
            _s(
                f"Generated by Vigil  |  {self.framework_short}  |  Last {self.period_days} days  |  "
                f"Read-only evidence  |  Report ID {self.report_id}"
            ),
            align="C",
        )
        self.ln(3.6)
        self.set_text_color(148, 163, 184)
        self.cell(0, 3.8, _s("Not a compliance attestation. Supports audit review only."), align="C")
        self.set_y(-7)
        self.cell(0, 3.8, _s(f"Page {self.page_no()}/{{nb}}"), align="R")


def _bottom(pdf: FPDF) -> float:
    return pdf.h - pdf.b_margin


def _ensure(pdf: FPDF, h: float) -> None:
    if pdf.get_y() + h > _bottom(pdf):
        pdf.add_page()


def _section(pdf: FPDF, title: str, subtitle: str | None = None, *, gap: float = 7) -> None:
    _ensure(pdf, 18)
    pdf.ln(gap)
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "B", _FONT["h1"])
    pdf.set_text_color(*INK)
    pdf.cell(0, 7, _s(title), new_x="LMARGIN", new_y="NEXT")
    if subtitle:
        pdf.set_font("Helvetica", "", _FONT["body"])
        pdf.set_text_color(*MUTED)
        pdf.multi_cell(pdf.epw, 4.6, _s(subtitle), align="L")
    pdf.ln(2)


def _pill(pdf: FPDF, label: str, style: dict[str, Any], w: float | None = None, h: float = 6) -> None:
    pdf.set_font("Helvetica", "B", _FONT["tiny"])
    w = w or max(18, pdf.get_string_width(_s(label)) + 7)
    x, y = pdf.get_x(), pdf.get_y()
    pdf.set_draw_color(*style["border"])
    pdf.set_fill_color(*style["fill"])
    pdf.rect(x, y, w, h, style="FD")
    pdf.set_xy(x, y + 1.4)
    pdf.set_text_color(*style["text"])
    pdf.cell(w, 3.4, _s(label), align="C")
    pdf.set_xy(x + w + 2, y)


def _metric_card(pdf: FPDF, x: float, y: float, w: float, h: float, label: str, value: str, detail: str, accent: tuple[int, int, int]) -> None:
    pdf.set_fill_color(255, 255, 255)
    pdf.set_draw_color(*SUBTLE)
    pdf.rect(x, y, w, h, style="FD")
    pdf.set_fill_color(*accent)
    pdf.rect(x, y, 1.2, h, style="F")
    pdf.set_xy(x + 5, y + 4)
    pdf.set_font("Helvetica", "B", _FONT["tiny"])
    pdf.set_text_color(*MUTED)
    pdf.cell(w - 10, 4, _s(label.upper()))
    pdf.set_xy(x + 5, y + 10)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(*INK)
    pdf.cell(w - 10, 7, _s(value))
    pdf.set_xy(x + 5, y + 18)
    pdf.set_font("Helvetica", "", _FONT["small"])
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(w - 10, 4, _s(detail), align="L")


def _draw_header(pdf: VigilEvidencePDF, title: str, framework_label: str, pack_badge: str) -> None:
    y0 = pdf.get_y()
    mark = _mark_path()
    if mark:
        pdf.image(str(mark), x=pdf.l_margin, y=y0 + 1, w=6.5)
        text_x = pdf.l_margin + 9
    else:
        text_x = pdf.l_margin
    pdf.set_xy(text_x, y0 + 1)
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(*INK)
    pdf.cell(40, 7, "Vigil")

    badge_w = 46
    bx = pdf.w - pdf.r_margin - badge_w
    pdf.set_xy(bx, y0)
    pdf.set_fill_color(239, 246, 255)
    pdf.set_draw_color(191, 219, 254)
    pdf.rect(bx, y0, badge_w, 14, style="FD")
    pdf.set_xy(bx + 4, y0 + 3)
    pdf.set_font("Helvetica", "B", _FONT["tiny"])
    pdf.set_text_color(29, 78, 216)
    pdf.cell(badge_w - 8, 3.5, _s(pack_badge))
    pdf.set_xy(bx + 4, y0 + 8)
    pdf.set_font("Helvetica", "", _FONT["tiny"])
    pdf.set_text_color(*BLUE)
    pdf.cell(badge_w - 8, 3.5, "Read-only source evidence")

    pdf.set_y(y0 + 23)
    pdf.set_font("Helvetica", "B", _FONT["display"])
    pdf.set_text_color(*INK)
    pdf.cell(0, 9, _s(title), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", _FONT["body"])
    pdf.set_text_color(*MUTED)
    pdf.cell(0, 5, _s(framework_label), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(5)
    pdf.set_draw_color(*SUBTLE)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
    pdf.ln(6)


def _draw_meta_grid(pdf: FPDF, fields: list[tuple[str, str]]) -> None:
    cols = 2
    gap = 4
    pad = 5
    cell_w = (pdf.epw - gap) / cols
    row_h = 13
    rows = (len(fields) + cols - 1) // cols
    h = rows * row_h + pad * 2
    _ensure(pdf, h + 4)
    x0, y0 = pdf.l_margin, pdf.get_y()
    pdf.set_fill_color(*SOFT_BG)
    pdf.set_draw_color(*SUBTLE)
    pdf.rect(x0, y0, pdf.epw, h, style="FD")
    for idx, (label, value) in enumerate(fields):
        col = idx % cols
        row = idx // cols
        x = x0 + pad + col * cell_w
        y = y0 + pad + row * row_h
        pdf.set_xy(x, y)
        pdf.set_font("Helvetica", "B", _FONT["tiny"])
        pdf.set_text_color(*MUTED)
        pdf.cell(cell_w - pad, 3.8, _s(label.upper()))
        pdf.set_xy(x, y + 5)
        pdf.set_font("Helvetica", "", _FONT["body"])
        pdf.set_text_color(30, 41, 59)
        pdf.multi_cell(cell_w - pad * 2, 4.2, _s(value), align="L")
    pdf.set_y(y0 + h + 5)


def _draw_top_controls(pdf: FPDF, controls: list[dict[str, Any]]) -> None:
    if not controls:
        pdf.set_font("Helvetica", "", _FONT["body"])
        pdf.set_text_color(*MUTED)
        pdf.cell(0, 6, "No controls currently require review.", new_x="LMARGIN", new_y="NEXT")
        return
    row_h = 13
    h = 6 + len(controls) * row_h
    _ensure(pdf, h + 4)
    x0, y0 = pdf.l_margin, pdf.get_y()
    pdf.set_fill_color(255, 255, 255)
    pdf.set_draw_color(*SUBTLE)
    pdf.rect(x0, y0, pdf.epw, h, style="FD")
    for idx, control in enumerate(controls):
        y = y0 + 3 + idx * row_h
        if idx:
            pdf.set_draw_color(*SUBTLE)
            pdf.line(x0 + 4, y, x0 + pdf.epw - 4, y)
        findings = control.get("findings") or []
        count = int(control.get("finding_count") or len(findings) or 0)
        counts = _severity_counts(findings)
        pdf.set_xy(x0 + 5, y + 2)
        pdf.set_font("Helvetica", "B", _FONT["body"])
        pdf.set_text_color(*INK)
        pdf.cell(85, 4.6, _s(f"{control.get('control_id', '-')}  {_objective_text(control.get('title', ''))}"))
        pdf.set_xy(x0 + 5, y + 7)
        pdf.set_font("Helvetica", "", _FONT["small"])
        pdf.set_text_color(*MUTED)
        pdf.cell(110, 4.2, _s(f"{count} findings  |  {_severity_summary(counts)}  |  Evidence {_EVIDENCE.get(control.get('evidence_status', 'missing'), _EVIDENCE['missing'])['label']}"))
        pdf.set_xy(x0 + pdf.epw - 30, y + 3.5)
        _pill(pdf, "Review", _STATUS["fail"], w=24, h=5.8)
    pdf.set_y(y0 + h + 5)


def _draw_control_overview(pdf: FPDF, controls: list[dict[str, Any]]) -> None:
    col_w = [20, 78, 28, 30, 26]
    headers = ["Control", "Objective", "Status", "Evidence", "Findings"]

    def header() -> None:
        y = pdf.get_y()
        x = pdf.l_margin
        pdf.set_fill_color(*SOFT_BG)
        pdf.set_draw_color(*SUBTLE)
        pdf.set_font("Helvetica", "B", _FONT["tiny"])
        pdf.set_text_color(*MUTED)
        for width, label in zip(col_w, headers):
            pdf.rect(x, y, width, 8, style="FD")
            pdf.set_xy(x + 2, y + 2.2)
            align = "C" if label in {"Status", "Evidence", "Findings"} else "L"
            pdf.cell(width - 4, 3.5, _s(label.upper()), align=align)
            x += width
        pdf.set_y(y + 8)

    header()
    for idx, control in enumerate(controls):
        row_h = 10
        if pdf.get_y() + row_h > _bottom(pdf):
            pdf.add_page()
            _section(pdf, "Control Overview", "Continued.", gap=0)
            header()
        y = pdf.get_y()
        x = pdf.l_margin
        pdf.set_draw_color(*SUBTLE)
        pdf.rect(x, y, sum(col_w), row_h, style="D")
        pdf.set_xy(x + 2, y + 2.2)
        pdf.set_font("Helvetica", "B", _FONT["table"])
        pdf.set_text_color(*INK)
        pdf.cell(col_w[0] - 4, 4, _s(control.get("control_id", "-")))
        x += col_w[0]
        pdf.set_xy(x + 2, y + 2.2)
        pdf.set_font("Helvetica", "", _FONT["table"])
        pdf.set_text_color(51, 65, 85)
        pdf.cell(col_w[1] - 4, 4, _s(_truncate_middle(_objective_text(control.get("title", "")), 58)))
        x += col_w[1]
        status_style = _STATUS.get(control.get("status"), _STATUS["no_data"])
        pdf.set_xy(x + 2, y + 2)
        _pill(pdf, status_style["label"], status_style, w=col_w[2] - 4, h=5.8)
        x += col_w[2]
        ev_style = _EVIDENCE.get(control.get("evidence_status", "missing"), _EVIDENCE["missing"])
        pdf.set_xy(x + 2, y + 2)
        _pill(pdf, ev_style["label"], ev_style, w=col_w[3] - 4, h=5.8)
        x += col_w[3]
        pdf.set_xy(x, y + 2.2)
        pdf.set_font("Helvetica", "B", _FONT["table"])
        pdf.set_text_color(*INK)
        pdf.cell(col_w[4], 4, _s(control.get("finding_count", 0)), align="C")
        pdf.set_y(y + row_h)


def _draw_finding_compact(pdf: FPDF, finding: dict[str, Any], idx: int) -> None:
    row_h = 25
    _ensure(pdf, row_h + 2)
    x0, y0 = pdf.l_margin, pdf.get_y()
    pdf.set_fill_color(255, 255, 255)
    pdf.set_draw_color(*SUBTLE)
    pdf.rect(x0, y0, pdf.epw, row_h, style="FD")
    pdf.set_xy(x0 + 4, y0 + 4)
    pdf.set_font("Helvetica", "B", _FONT["small"])
    pdf.set_text_color(*MUTED)
    pdf.cell(8, 4, str(idx))
    sev = (finding.get("severity") or "medium").lower()
    sev_style = _SEVERITY.get(sev, _SEVERITY["medium"])
    pdf.set_xy(x0 + 14, y0 + 3.2)
    _pill(pdf, sev_style["label"], sev_style, w=22, h=5.8)
    content_x = x0 + 41
    pdf.set_xy(content_x, y0 + 3.2)
    pdf.set_font("Helvetica", "B", _FONT["body"])
    pdf.set_text_color(*INK)
    pdf.cell(0, 4.5, _s(_resource_name(finding.get("resource_arn") or "")), new_x="LMARGIN", new_y="NEXT")
    pdf.set_xy(content_x, y0 + 8.2)
    pdf.set_font("Helvetica", "", _FONT["small"])
    pdf.set_text_color(51, 65, 85)
    issue = _truncate_middle(" ".join((finding.get("title") or "").split()), 112)
    pdf.multi_cell(130, 4, _s(issue), align="L")
    pdf.set_x(content_x)
    pdf.set_font("Helvetica", "", _FONT["tiny"])
    pdf.set_text_color(*MUTED)
    observed = f"Resource: {_resource_display(finding.get('resource_arn') or '', 76)}  |  First seen {_fmt_date(finding.get('first_seen'))}  |  Last seen {_fmt_date(finding.get('last_seen'))}"
    pdf.cell(0, 4, _s(observed), new_x="LMARGIN", new_y="NEXT")
    pdf.set_y(y0 + row_h + 2)


def _draw_review_control(pdf: FPDF, control: dict[str, Any]) -> None:
    findings = control.get("findings") or []
    counts = _severity_counts(findings)
    cid = control.get("control_id", "-")
    count = int(control.get("finding_count") or len(findings) or 0)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", _FONT["h1"])
    pdf.set_text_color(*INK)
    title = f"{cid} {_objective_text(control.get('title', ''))}"
    pdf.multi_cell(pdf.epw - 34, 7, _s(title), align="L")
    pdf.set_xy(pdf.w - pdf.r_margin - 30, 13)
    _pill(pdf, "Needs Review", _STATUS["fail"], w=30, h=6.2)
    pdf.ln(5)

    x0, y0 = pdf.l_margin, pdf.get_y()
    meta_h = 28
    pdf.set_fill_color(*SOFT_BG)
    pdf.set_draw_color(*SUBTLE)
    pdf.rect(x0, y0, pdf.epw, meta_h, style="FD")
    cells = [
        ("Open findings", str(count), AMBER),
        ("Severity", _severity_summary(counts), RED if counts.get("critical") or counts.get("high") else AMBER),
        ("Evidence", _EVIDENCE.get(control.get("evidence_status", "missing"), _EVIDENCE["missing"])["label"], BLUE),
    ]
    cell_w = pdf.epw / 3
    for i, (label, value, color) in enumerate(cells):
        x = x0 + i * cell_w
        if i:
            pdf.set_draw_color(*SUBTLE)
            pdf.line(x, y0 + 5, x, y0 + meta_h - 5)
        pdf.set_xy(x + 5, y0 + 5)
        pdf.set_font("Helvetica", "B", _FONT["tiny"])
        pdf.set_text_color(*MUTED)
        pdf.cell(cell_w - 10, 4, _s(label.upper()))
        pdf.set_xy(x + 5, y0 + 12)
        pdf.set_font("Helvetica", "B", 12)
        pdf.set_text_color(*color)
        pdf.multi_cell(cell_w - 10, 5, _s(value), align="L")
    pdf.set_y(y0 + meta_h + 8)

    for heading, body, color in [
        ("Objective", control.get("description") or "", (51, 65, 85)),
        ("Why this needs review", control.get("review_reason") or control.get("status_note") or f"{count} open finding(s) require remediation or documented exception.", (120, 53, 15)),
    ]:
        pdf.set_font("Helvetica", "B", _FONT["h3"])
        pdf.set_text_color(*INK)
        pdf.cell(0, 5, heading, new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", _FONT["body"])
        pdf.set_text_color(*color)
        pdf.multi_cell(pdf.epw, 4.8, _s(body), align="L")
        pdf.ln(2)

    pdf.set_font("Helvetica", "B", _FONT["h3"])
    pdf.set_text_color(*INK)
    pdf.cell(0, 5, "Top findings", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)
    for idx, finding in enumerate(findings[:3], 1):
        _draw_finding_compact(pdf, finding, idx)
    if len(findings) > 3:
        pdf.set_font("Helvetica", "I", _FONT["small"])
        pdf.set_text_color(*MUTED)
        pdf.cell(0, 5, _s(f"+ {len(findings) - 3} more findings in controls/{cid}/findings.json"), new_x="LMARGIN", new_y="NEXT")

    pdf.ln(3)
    _ensure(pdf, 22)
    x0, y0 = pdf.l_margin, pdf.get_y()
    pdf.set_fill_color(*SOFT_BG)
    pdf.set_draw_color(*SUBTLE)
    pdf.rect(x0, y0, pdf.epw, 18, style="FD")
    pdf.set_xy(x0 + 5, y0 + 4)
    pdf.set_font("Helvetica", "B", _FONT["tiny"])
    pdf.set_text_color(*MUTED)
    pdf.cell(0, 4, "EVIDENCE ARTIFACTS", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(x0 + 5)
    pdf.set_font("Courier", "", _FONT["mono"])
    pdf.set_text_color(51, 65, 85)
    pdf.cell(0, 4, _s(f"controls/{cid}/findings.json  |  snapshots.json  |  exceptions.json  |  summary.json"))


def _draw_evidence_sources(pdf: FPDF, sources: list[str], framework: str, scope_limitations: list[str]) -> None:
    pdf.add_page()
    _section(pdf, "Evidence Sources", "Source systems, artifacts, and report boundaries.", gap=0)
    x0, y0 = pdf.l_margin, pdf.get_y()
    left_w = (pdf.epw - 8) / 2
    card_h = 48
    for i, (title, body) in enumerate([
        ("Source systems", ", ".join(sources) or "Not specified"),
        ("Included artifacts", "Raw JSON snapshots, findings.json, timeline.csv, source_manifest.json, control summaries, exception records"),
    ]):
        x = x0 + i * (left_w + 8)
        pdf.set_fill_color(*SOFT_BG)
        pdf.set_draw_color(*SUBTLE)
        pdf.rect(x, y0, left_w, card_h, style="FD")
        pdf.set_xy(x + 5, y0 + 5)
        pdf.set_font("Helvetica", "B", _FONT["h3"])
        pdf.set_text_color(*INK)
        pdf.cell(left_w - 10, 5, _s(title), new_x="LMARGIN", new_y="NEXT")
        pdf.set_x(x + 5)
        pdf.set_font("Helvetica", "", _FONT["body"])
        pdf.set_text_color(51, 65, 85)
        pdf.multi_cell(left_w - 10, 5, _s(body), align="L")
    pdf.set_y(y0 + card_h + 10)

    pdf.set_font("Helvetica", "B", _FONT["h3"])
    pdf.set_text_color(*INK)
    pdf.cell(0, 6, "How to use this report", new_x="LMARGIN", new_y="NEXT")
    steps = [
        "Review controls marked Needs Review.",
        "Open the referenced control folder in the ZIP.",
        "Validate raw JSON and CSV evidence.",
        "Document exceptions or remediation where needed.",
    ]
    pdf.set_font("Helvetica", "", _FONT["body"])
    pdf.set_text_color(51, 65, 85)
    for idx, step in enumerate(steps, 1):
        pdf.cell(0, 5, _s(f"{idx}. {step}"), new_x="LMARGIN", new_y="NEXT")

    pdf.ln(5)
    pdf.set_font("Helvetica", "B", _FONT["h3"])
    pdf.set_text_color(*INK)
    pdf.cell(0, 6, "Assumptions and scope boundaries", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", _FONT["body"])
    pdf.set_text_color(51, 65, 85)
    if not scope_limitations:
        scope_limitations = [
            "Vigil is read-only and performs detection only.",
            "This report supports audit review but does not replace auditor judgment or company policy evidence.",
        ]
    for line in scope_limitations:
        pdf.multi_cell(pdf.epw, 4.8, _s(f"- {line}"), align="L")
        pdf.ln(0.5)


def build_pdf(
    acc: AwsAccount,
    framework: str,
    period_days: int,
    generated_at: datetime,
    control_results: list[dict[str, Any]],
    *,
    since: datetime | None = None,
    evidence_sources: list[str] | None = None,
    report_id: str | None = None,
    benchmark_coverage: dict[str, Any] | None = None,
    coverage: dict[str, Any] | None = None,
    vault_enabled: bool = False,
    signature_enabled: bool = False,
) -> bytes:
    rid = report_id or "SAMPLE"
    framework_short = _FRAMEWORK_SHORT.get(framework, framework.upper())
    framework_label = _FRAMEWORK_LABELS.get(framework, framework.upper())
    pack_badge = _FRAMEWORK_PACK_BADGE.get(framework, "Compliance Evidence Pack")
    sources = evidence_sources or ["AWS IAM", "AWS CloudTrail", "AWS Config"]
    period_end = generated_at.date()
    period_start = since.date() if since else period_end

    pdf = VigilEvidencePDF(report_id=rid, framework_short=framework_short, period_days=period_days)
    pdf.alias_nb_pages()
    pdf.set_margins(14, 12, 14)
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    _draw_header(pdf, "Compliance Evidence Report", framework_label, pack_badge)

    coverage_label = None
    scans = None
    failed_scan = None
    if coverage:
        coverage_label = coverage.get("coverage_label") or f"{coverage.get('days_with_data', 0)} of {coverage.get('days_requested', period_days)} days"
        scans = str(coverage.get("successful_scans_in_period", 0))
        failed_scan = str(coverage.get("last_failed_scan_at") or "")[:10] or None

    meta = [
        ("Account", f"{getattr(acc, 'label', 'Account')} ({getattr(acc, 'account_id', None) or 'unknown'})"),
        ("Audit period", f"{period_start} to {period_end} ({period_days} days)"),
        ("Generated", generated_at.strftime("%Y-%m-%d %H:%M UTC")),
        ("Report ID", rid),
        ("Sources", ", ".join(sources)),
        ("Collection", "Read-only API collection"),
    ]
    if benchmark_coverage:
        mapped = benchmark_coverage.get("mapped_control_count", "?")
        total = benchmark_coverage.get("cis_v5_level1_total", "?")
        meta.append(("CIS coverage", f"{mapped} of {total} CIS v5 Level 1 controls automated"))
    if coverage_label:
        meta.append(("Evidence coverage", coverage_label))
    if scans is not None:
        meta.append(("Successful scans", scans))
    if failed_scan:
        meta.append(("Last failed scan", failed_scan))
    meta.append(("Pack signature", "enabled" if signature_enabled else "disabled"))
    meta.append(("Vault archive", "written" if vault_enabled else "not configured"))
    _draw_meta_grid(pdf, meta)

    passed = sum(1 for r in control_results if r.get("status") == "pass")
    failed = sum(1 for r in control_results if r.get("status") == "fail")
    no_data = sum(1 for r in control_results if r.get("status") == "no_data")
    total = len(control_results)
    score_pct = round((passed / total) * 100) if total else 0
    open_findings = sum(int(r.get("finding_count") or 0) for r in control_results)

    _section(pdf, "Audit Readiness", "Control status reflects open findings. Evidence status reflects collected source snapshots.", gap=5)
    card_w = (pdf.epw - 9) / 4
    card_h = 28
    y0, x = pdf.get_y(), pdf.l_margin
    _metric_card(pdf, x, y0, card_w, card_h, "Pass rate", f"{score_pct}%", f"{passed} of {total} controls passing", GREEN if score_pct == 100 else AMBER)
    x += card_w + 3
    _metric_card(pdf, x, y0, card_w, card_h, "Open findings", str(open_findings), "Mapped to controls", RED if open_findings else GREEN)
    x += card_w + 3
    _metric_card(pdf, x, y0, card_w, card_h, "Needs review", str(failed), "Controls with open findings", AMBER if failed else GREEN)
    x += card_w + 3
    _metric_card(pdf, x, y0, card_w, card_h, "No data", str(no_data), "Not evaluated", (148, 163, 184))
    pdf.set_y(y0 + card_h + 4)

    review_controls = [r for r in control_results if r.get("status") == "fail"]
    review_controls.sort(key=_review_priority)
    _section(pdf, "Top Controls Requiring Review", "Ranked by open finding count and severity.", gap=5)
    _draw_top_controls(pdf, _key_controls_for_review(control_results, limit=5))

    pdf.add_page()
    _section(pdf, "Control Overview", "Full list of mapped controls and their evidence status.", gap=0)
    _draw_control_overview(pdf, control_results)

    for control in review_controls:
        _draw_review_control(pdf, control)

    try:
        from app.data.control_narratives import scope_limitations_for

        scope_limitations = scope_limitations_for(framework)
    except Exception:
        scope_limitations = []
    _draw_evidence_sources(pdf, sources, framework, scope_limitations)

    output = pdf.output()
    return bytes(output) if not isinstance(output, (bytes, bytearray)) else bytes(output)
