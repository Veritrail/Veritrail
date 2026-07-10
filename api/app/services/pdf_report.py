"""Generate an auditor-ready PDF compliance evidence report using fpdf2.

Narrative-first layout: evidence is grouped into capability domains
(Identity & Access, SDLC, Backup & DR, ...) each carrying an
evidence-anchored assertion paragraph, a coverage line, documented
exceptions vs open gaps, and framework control cross-reference tags.
Per-resource detail lives in an appendix at the back of the document.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from fpdf import FPDF

from app.models.aws_account import AwsAccount
from app.services.pdf_narrative import DomainSection, build_domain_sections, exception_narrative

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
    "h1": 17,
    "h2": 13,
    "h3": 11,
    "body": 10,
    "small": 9,
    "tiny": 7.8,
    "table": 9,
    "mono": 8.2,
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
    "at_risk": {"label": "At Risk", "fill": (255, 247, 237), "text": (194, 65, 12), "border": (254, 215, 170)},
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

# The PDF is a summary/index, not the evidence population. Per domain we show a
# bounded gap/exception sample; the complete enumerated population always lives
# in each control's findings.json/exceptions.json inside the pack.
_GAPS_INLINE_LIMIT = 6
_EXCEPTIONS_INLINE_LIMIT = 5


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


def _fit_text(
    pdf: FPDF,
    text: str,
    max_w: float,
    *,
    family: str = "Helvetica",
    style: str = "",
    size: float = _FONT["small"],
) -> str:
    """Middle-truncate text until it fits within max_w (mm) at the given font.

    Sets the font as a side effect so the caller can render with the same metrics.
    Width-measured rather than char-counted, so no overflow off the page edge.
    """
    text = _s(text)
    pdf.set_font(family, style, size)
    if pdf.get_string_width(text) <= max_w:
        return text
    ell = "..."
    lo, hi, best = 1, len(text), ell
    while lo <= hi:
        mid = (lo + hi) // 2
        keep = max(2, mid // 2)
        cand = text[:keep] + ell + text[-keep:]
        if pdf.get_string_width(cand) <= max_w:
            best = cand
            lo = mid + 1
        else:
            hi = mid - 1
    return best


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


def _review_priority(control: dict[str, Any]) -> tuple[int, int, int, int, str]:
    findings = control.get("findings") or []
    counts = _severity_counts(findings)
    finding_count = int(control.get("finding_count") or sum(counts.values()) or 0)
    worst = min((_SEV_ORDER.get(k, 99) for k in counts), default=99)
    return (-finding_count, -counts.get("critical", 0), -counts.get("high", 0), worst, control.get("control_id", ""))


def _key_controls_for_review(control_results: list[dict[str, Any]], *, limit: int = 5) -> list[dict[str, Any]]:
    review = [r for r in control_results if r.get("status") in ("fail", "at_risk")]
    review.sort(key=lambda c: (0 if c.get("status") == "fail" else 1,) + _review_priority(c))
    return review[:limit]


def _overview_sort_key(control: dict[str, Any]) -> tuple:
    rank = {"fail": 0, "at_risk": 1, "pass": 2, "no_data": 3}.get(control.get("status"), 4)
    return (rank,) + _review_priority(control)


def _mark_path() -> Path | None:
    here = Path(__file__).resolve()
    candidates = [here.parent.parent / "assets" / "veritrail-mark.png"]
    if len(here.parents) > 3:
        candidates.append(here.parents[3] / "web" / "public" / "favicon.png")
    for path in candidates:
        if path.is_file():
            return path
    return None


class VeritrailEvidencePDF(FPDF):
    """Adds a running header (org · audit window · generated · integrity) and a
    page-numbered footer to every content page. The cover page stays clean."""

    def __init__(
        self,
        *,
        report_id: str,
        framework_short: str,
        period_days: int,
        org_name: str,
        audit_window: str,
        generated_label: str,
        integrity_label: str | None = None,
    ) -> None:
        super().__init__(orientation="P", unit="mm", format="A4")
        self.report_id = report_id
        self.framework_short = framework_short
        self.period_days = period_days
        self.org_name = org_name
        self.audit_window = audit_window
        self.generated_label = generated_label
        self.integrity_label = integrity_label
        self.show_running_header = False

    def header(self) -> None:
        if not self.show_running_header:
            return
        y0 = 8
        self.set_y(y0)
        self.set_font("Helvetica", "B", _FONT["tiny"])
        self.set_text_color(*MUTED)
        self.cell(0, 3.6, _s(self.org_name), align="L")
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", _FONT["tiny"])
        self.cell(
            0,
            3.6,
            _s(f"Audit window {self.audit_window}  |  Generated {self.generated_label}"),
            align="R",
            new_x="LMARGIN",
            new_y="NEXT",
        )
        self.set_font("Helvetica", "", _FONT["tiny"])
        self.set_text_color(148, 163, 184)
        self.cell(0, 3.4, _s(f"{self.framework_short} compliance evidence"), align="L")
        self.set_x(self.l_margin)
        integrity = f"Report {self.report_id}"
        if self.integrity_label:
            integrity += f"  |  Integrity {self.integrity_label}"
        self.cell(0, 3.4, _s(integrity), align="R", new_x="LMARGIN", new_y="NEXT")
        self.ln(1)
        self.set_draw_color(*SUBTLE)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.set_y(self.get_y() + 4)

    def footer(self) -> None:
        self.set_y(-13)
        self.set_draw_color(*SUBTLE)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(2.5)
        y = self.get_y()
        self.set_font("Helvetica", "", _FONT["tiny"])
        self.set_text_color(*MUTED)
        self.cell(
            0,
            3.8,
            _s(f"Generated by Veritrail  |  {self.framework_short}  |  Last {self.period_days} days  |  Report ID {self.report_id}"),
            align="C",
        )
        self.set_xy(self.l_margin, y)
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


def _outline(pdf: FPDF, name: str, level: int = 0) -> None:
    """Register a navigable outline/bookmark entry (PDF viewer sidebar)."""
    try:
        pdf.start_section(_s(name), level=level)
    except Exception:
        pass


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


def _draw_cover(
    pdf: VeritrailEvidencePDF,
    *,
    title: str,
    framework_label: str,
    pack_badge: str,
    org_name: str,
    account_label: str,
    account_id: str,
    period_start,
    period_end,
    period_days: int,
    generated_at: datetime,
    report_id: str,
) -> None:
    """Dedicated cover page: brand, title, and the facts an auditor files the
    document under. Everything else starts on page 2."""
    pdf.add_page()

    mark = _mark_path()
    y = 34
    if mark:
        pdf.image(str(mark), x=(pdf.w - 14) / 2, y=y, w=14)
        y += 20
    pdf.set_y(y)
    pdf.set_font("Helvetica", "B", 20)
    pdf.set_text_color(*INK)
    pdf.cell(0, 8, "Veritrail", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", _FONT["small"])
    pdf.set_text_color(*MUTED)
    pdf.cell(0, 5, _s("Continuous compliance evidence"), align="C", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(22)
    pdf.set_font("Helvetica", "B", 26)
    pdf.set_text_color(*INK)
    pdf.cell(0, 11, _s(title), align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)
    pdf.set_font("Helvetica", "", 12)
    pdf.set_text_color(51, 65, 85)
    pdf.cell(0, 6, _s(framework_label), align="C", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(6)
    rule_w = 34
    pdf.set_draw_color(13, 148, 136)
    pdf.set_line_width(0.9)
    pdf.line((pdf.w - rule_w) / 2, pdf.get_y(), (pdf.w + rule_w) / 2, pdf.get_y())
    pdf.set_line_width(0.2)

    pdf.ln(7)
    badge_w = 62
    bx = (pdf.w - badge_w) / 2
    by = pdf.get_y()
    pdf.set_fill_color(239, 246, 255)
    pdf.set_draw_color(191, 219, 254)
    pdf.rect(bx, by, badge_w, 9, style="FD", round_corners=True, corner_radius=2)
    pdf.set_xy(bx, by + 2.8)
    pdf.set_font("Helvetica", "B", _FONT["small"])
    pdf.set_text_color(29, 78, 216)
    pdf.cell(badge_w, 3.5, _s(pack_badge), align="C")

    pdf.set_y(by + 26)
    facts = [
        ("Organization", org_name),
        ("Account", f"{account_label} ({account_id})"),
        ("Audit period", f"{period_start} to {period_end}  ({period_days} days)"),
        ("Generated", generated_at.strftime("%Y-%m-%d %H:%M UTC")),
        ("Report ID", report_id),
    ]
    label_w, value_w = 40, 92
    x0 = (pdf.w - label_w - value_w) / 2
    for label, value in facts:
        yy = pdf.get_y()
        pdf.set_xy(x0, yy)
        pdf.set_font("Helvetica", "B", _FONT["body"])
        pdf.set_text_color(100, 116, 139)
        pdf.cell(label_w, 7, _s(label))
        pdf.set_xy(x0 + label_w, yy)
        pdf.set_font("Helvetica", "", _FONT["body"])
        pdf.set_text_color(*INK)
        pdf.cell(value_w, 7, _s(value), new_x="LMARGIN", new_y="NEXT")

    pdf.set_y(-40)
    pdf.set_font("Helvetica", "", _FONT["small"])
    pdf.set_text_color(148, 163, 184)
    pdf.multi_cell(
        pdf.epw,
        4.6,
        _s(
            "This report summarizes automated evidence collected by Veritrail. It supports audit "
            "review and is not a compliance attestation. The complete machine-readable evidence "
            "population accompanies this document in the evidence pack archive."
        ),
        align="C",
    )


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


def _draw_coverage_banner(pdf: FPDF, coverage: dict[str, Any], period_days: int) -> None:
    """Prominent warning when evidence does not cover the full audit period."""
    days = int(coverage.get("days_with_data", 0) or 0)
    req = int(coverage.get("days_requested", period_days) or period_days)
    if req <= 0 or days >= req:
        return
    missing = req - days
    _ensure(pdf, 22)
    pdf.ln(4)
    x0, y0 = pdf.l_margin, pdf.get_y()
    h = 16
    pdf.set_fill_color(255, 251, 235)
    pdf.set_draw_color(253, 230, 138)
    pdf.rect(x0, y0, pdf.epw, h, style="FD")
    pdf.set_fill_color(*AMBER)
    pdf.rect(x0, y0, 1.4, h, style="F")
    pdf.set_xy(x0 + 6, y0 + 3.4)
    pdf.set_font("Helvetica", "B", _FONT["body"])
    pdf.set_text_color(146, 64, 14)
    pdf.cell(0, 4.5, _s(f"Evidence coverage gap - {days} of {req} days have scan or snapshot data"))
    pdf.set_xy(x0 + 6, y0 + 9)
    pdf.set_font("Helvetica", "", _FONT["small"])
    pdf.set_text_color(120, 53, 15)
    pdf.cell(0, 4, _s(f"{missing} days in the audit period have no evidence. Extend continuous monitoring to cover the full Type II period."))
    pdf.set_y(y0 + h + 3)


# ── Capability domain narrative sections ──────────────────────────────────────


def _domain_band(pdf: FPDF, idx: int, section: DomainSection) -> None:
    band_h = 11
    y_band = pdf.get_y()
    pdf.set_fill_color(*SOFT_BG)
    pdf.set_draw_color(*SUBTLE)
    pdf.rect(pdf.l_margin, y_band, pdf.epw, band_h, style="FD", round_corners=True, corner_radius=1.6)
    pdf.set_xy(pdf.l_margin + 3.2, y_band + (band_h - 6.6) / 2)
    pdf.set_font("Helvetica", "B", _FONT["h2"])
    pdf.set_text_color(*INK)
    title = f"{idx}. {section.label}"
    pdf.cell(
        pdf.epw - 44,
        6.6,
        _fit_text(pdf, title, pdf.epw - 44, family="Helvetica", size=_FONT["h2"], style="B"),
        align="L",
    )
    all_passing = section.checks_total > 0 and section.checks_passing == section.checks_total
    pill_style = _STATUS["pass"] if all_passing else _STATUS["fail"]
    pill_label = f"{section.checks_passing}/{section.checks_total} checks"
    pdf.set_xy(pdf.w - pdf.r_margin - 34.5, y_band + (band_h - 6.2) / 2)
    _pill(pdf, pill_label, pill_style, w=32, h=6.2)
    pdf.set_y(y_band + band_h + 2.5)


def _draw_gap_row(pdf: FPDF, finding: dict[str, Any], idx: int, *, reserve_after: float = 0) -> None:
    """Two-line gap row: severity pill + issue title, resource ARN below.

    ``reserve_after`` keeps trailing content (e.g. the appendix reference line)
    on the same page as the final row instead of orphaning it.
    """
    row_h = 11
    _ensure(pdf, row_h + reserve_after)
    x0, y = pdf.l_margin, pdf.get_y()
    if idx > 1:
        pdf.set_draw_color(236, 240, 245)
        pdf.line(x0, y, x0 + pdf.epw, y)

    sev = (finding.get("severity") or "medium").lower()
    sev_style = _SEVERITY.get(sev, _SEVERITY["medium"])
    pdf.set_xy(x0, y + 2.4)
    _pill(pdf, sev_style["label"], sev_style, w=18, h=5.4)

    text_x = x0 + 22
    dates = f"First seen {_fmt_date(finding.get('first_seen'))}"
    pdf.set_font("Helvetica", "", _FONT["tiny"])
    dates_w = pdf.get_string_width(_s(dates)) + 1
    pdf.set_xy(pdf.w - pdf.r_margin - dates_w, y + 2.6)
    pdf.set_text_color(*MUTED)
    pdf.cell(dates_w, 3.6, _s(dates), align="R")

    title_w = (pdf.w - pdf.r_margin - dates_w - 4) - text_x
    title = _fit_text(pdf, " ".join((finding.get("title") or "").split()), title_w, style="B", size=_FONT["small"])
    pdf.set_xy(text_x, y + 2)
    pdf.set_font("Helvetica", "B", _FONT["small"])
    pdf.set_text_color(*INK)
    pdf.cell(title_w, 4.2, title)

    arn = (finding.get("resource_arn") or "-").replace("arn:aws:s3:::", "s3://", 1)
    arn_w = pdf.w - pdf.r_margin - text_x
    arn_fit = _fit_text(pdf, arn, arn_w, family="Courier", size=_FONT["mono"])
    pdf.set_xy(text_x, y + 6.6)
    pdf.set_font("Courier", "", _FONT["mono"])
    pdf.set_text_color(90, 105, 125)
    pdf.cell(arn_w, 3.6, arn_fit)
    pdf.set_y(y + row_h)


def _draw_domain_section(pdf: FPDF, section: DomainSection, idx: int) -> None:
    pdf.ln(6)
    _ensure(pdf, 58)
    _outline(pdf, f"{idx}. {section.label}", level=1)
    _domain_band(pdf, idx, section)

    # Control cross-reference tags — secondary metadata, not the structure.
    if section.control_tags:
        pdf.set_font("Helvetica", "", _FONT["tiny"])
        pdf.set_text_color(*MUTED)
        pdf.multi_cell(pdf.epw, 3.8, _s("Mapped controls: " + "  ·  ".join(section.control_tags)), align="L")
        pdf.ln(0.5)

    if section.scope_note:
        pdf.set_font("Helvetica", "I", _FONT["small"])
        pdf.set_text_color(*MUTED)
        pdf.multi_cell(pdf.epw, 4.4, _s(section.scope_note), align="L")
        pdf.ln(0.5)

    # Assertion paragraph — affirmative but evidence-anchored and scoped.
    pdf.set_font("Helvetica", "", _FONT["body"])
    pdf.set_text_color(51, 65, 85)
    pdf.multi_cell(pdf.epw, 5.2, _s(section.assertion), align="L")
    pdf.ln(1.5)

    # Coverage line — wraps rather than truncates when long.
    coverage_text = _s(f"Coverage: {section.coverage_line}")
    pdf.set_font("Helvetica", "", _FONT["small"])
    n_lines = len(pdf.multi_cell(pdf.epw - 6, 4, coverage_text, align="L", dry_run=True, output="LINES"))
    box_h = 3.2 + n_lines * 4
    _ensure(pdf, box_h + 2)
    x0, y0 = pdf.l_margin, pdf.get_y()
    pdf.set_fill_color(*SOFT_BG)
    pdf.set_draw_color(*SUBTLE)
    pdf.rect(x0, y0, pdf.epw, box_h, style="FD")
    pdf.set_xy(x0 + 3, y0 + 1.6)
    pdf.set_text_color(71, 85, 105)
    pdf.multi_cell(pdf.epw - 6, 4, coverage_text, align="L")
    pdf.set_y(y0 + box_h + 2)

    # Documented exceptions — risk-accepted deviations with recorded reasons.
    if section.exceptions:
        shown = section.exceptions[:_EXCEPTIONS_INLINE_LIMIT]
        pdf.ln(1.5)
        _ensure(pdf, 14 + 5 * len(shown))
        x0, y0 = pdf.l_margin, pdf.get_y()
        pad = 3
        pdf.set_xy(x0 + pad, y0 + pad)
        pdf.set_font("Helvetica", "B", _FONT["h3"])
        pdf.set_text_color(146, 64, 14)
        pdf.cell(0, 5, _s(f"Documented exceptions ({len(section.exceptions)})"), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", _FONT["small"])
        pdf.set_text_color(120, 63, 4)
        for exc in shown:
            pdf.set_x(x0 + pad)
            pdf.multi_cell(pdf.epw - 2 * pad, 4.8, _s(f"-  {exception_narrative(exc)}"), align="L", new_x="LMARGIN", new_y="NEXT")
        if len(section.exceptions) > len(shown):
            pdf.set_x(x0 + pad)
            pdf.cell(0, 4.6, _s(f"{len(section.exceptions) - len(shown)} more in the resource appendix and per-control exceptions.json"), new_x="LMARGIN", new_y="NEXT")
        y1 = pdf.get_y() + pad
        pdf.set_draw_color(253, 230, 138)
        pdf.rect(x0, y0, pdf.epw, y1 - y0, style="D", round_corners=True, corner_radius=1.6)
        pdf.set_y(y1)

    # Open gaps — open findings are gaps, never exceptions.
    if section.gaps:
        pdf.ln(2)
        # Keep the heading, the first gap row, and the appendix reference together.
        _ensure(pdf, 26)
        pdf.set_x(pdf.l_margin)
        pdf.set_font("Helvetica", "B", _FONT["h3"])
        pdf.set_text_color(*INK)
        pdf.cell(0, 5.5, _s(f"Open gaps ({len(section.gaps)})"), new_x="LMARGIN", new_y="NEXT")
        shown_gaps = section.gaps[:_GAPS_INLINE_LIMIT]
        for i, finding in enumerate(shown_gaps, 1):
            _draw_gap_row(pdf, finding, i, reserve_after=7 if i == len(shown_gaps) else 0)
        if len(section.gaps) > _GAPS_INLINE_LIMIT:
            pdf.set_font("Helvetica", "", _FONT["small"])
            pdf.set_text_color(*MUTED)
            pdf.cell(0, 4.6, _s(f"{len(section.gaps) - _GAPS_INLINE_LIMIT} more listed in the resource appendix."), new_x="LMARGIN", new_y="NEXT")

    pdf.ln(1.5)
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "", _FONT["tiny"])
    pdf.set_text_color(120, 130, 145)
    if section.appendix_rows:
        ref = f"Resource-level detail: Appendix A, section A.{idx}. Complete population: controls/<id>/findings.json in this pack."
    else:
        ref = "No open findings or documented exceptions in this domain. Complete population: controls/<id>/findings.json in this pack."
    pdf.cell(0, 4, _s(ref), new_x="LMARGIN", new_y="NEXT")


# ── Control cross-reference table ─────────────────────────────────────────────


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
    for control in controls:
        row_h = 10
        if pdf.get_y() + row_h > _bottom(pdf):
            pdf.add_page()
            _section(pdf, "Control Cross-Reference", "Continued.", gap=0)
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


# ── Resource appendix ─────────────────────────────────────────────────────────


def _draw_appendix_table(pdf: FPDF, rows: list[dict[str, Any]]) -> None:
    col_w = [70, 56, 32, 24]
    headers = ["Resource", "Issue", "Disposition", "First seen"]

    def header() -> None:
        y = pdf.get_y()
        x = pdf.l_margin
        pdf.set_fill_color(*SOFT_BG)
        pdf.set_draw_color(*SUBTLE)
        pdf.set_font("Helvetica", "B", _FONT["tiny"])
        pdf.set_text_color(*MUTED)
        for width, label in zip(col_w, headers):
            pdf.rect(x, y, width, 7, style="FD")
            pdf.set_xy(x + 1.5, y + 1.8)
            pdf.cell(width - 3, 3.5, _s(label.upper()))
            x += width
        pdf.set_y(y + 7)

    header()
    for row in rows:
        reason = row.get("exception_reason")
        row_h = 9 if not reason else 13.5
        if pdf.get_y() + row_h > _bottom(pdf):
            pdf.add_page()
            header()
        y = pdf.get_y()
        x = pdf.l_margin
        pdf.set_draw_color(*SUBTLE)
        pdf.rect(x, y, sum(col_w), row_h, style="D")

        arn = (row.get("resource_arn") or "-").replace("arn:aws:s3:::", "s3://", 1)
        pdf.set_xy(x + 1.5, y + 2)
        arn_fit = _fit_text(pdf, arn, col_w[0] - 3, family="Courier", size=_FONT["mono"])
        pdf.set_font("Courier", "", _FONT["mono"])
        pdf.set_text_color(51, 65, 85)
        pdf.cell(col_w[0] - 3, 4, arn_fit)
        x += col_w[0]

        pdf.set_xy(x + 1.5, y + 2)
        title_fit = _fit_text(pdf, " ".join((row.get("title") or "-").split()), col_w[1] - 3, size=_FONT["tiny"])
        pdf.set_font("Helvetica", "", _FONT["tiny"])
        pdf.set_text_color(*INK)
        pdf.cell(col_w[1] - 3, 4, title_fit)
        x += col_w[1]

        is_exception = row.get("disposition") == "Documented exception"
        pdf.set_xy(x + 1.5, y + 2)
        pdf.set_font("Helvetica", "B", _FONT["tiny"])
        pdf.set_text_color(*(AMBER if is_exception else RED))
        pdf.cell(col_w[2] - 3, 4, _s("Exception" if is_exception else "Open gap"))
        x += col_w[2]

        pdf.set_xy(x + 1.5, y + 2)
        pdf.set_font("Helvetica", "", _FONT["tiny"])
        pdf.set_text_color(*MUTED)
        pdf.cell(col_w[3] - 3, 4, _s(row.get("first_seen") or "-"))

        if reason:
            pdf.set_xy(pdf.l_margin + 1.5, y + 7.5)
            pdf.set_font("Helvetica", "I", _FONT["tiny"])
            pdf.set_text_color(120, 63, 4)
            pdf.cell(sum(col_w) - 3, 4, _fit_text(pdf, f"Reason: {reason}", sum(col_w) - 4, style="I", size=_FONT["tiny"]))
        pdf.set_y(y + row_h)


def _draw_resource_appendix(pdf: FPDF, sections: list[DomainSection]) -> None:
    with_rows = [s for s in sections if s.appendix_rows]
    pdf.add_page()
    _outline(pdf, "Appendix A - Resource Detail")
    _section(
        pdf,
        "Appendix A - Resource Detail",
        "Per-resource findings referenced from each capability domain section. "
        "Open findings are gaps; documented exceptions carry their recorded reason. "
        "The complete machine-readable population is in each control's findings.json and exceptions.json.",
        gap=0,
    )
    if not with_rows:
        pdf.set_font("Helvetica", "", _FONT["body"])
        pdf.set_text_color(*MUTED)
        pdf.cell(0, 6, _s("No open findings or documented exceptions in this audit period."), new_x="LMARGIN", new_y="NEXT")
        return
    for section in sections:
        if not section.appendix_rows:
            continue
        idx = sections.index(section) + 1
        _ensure(pdf, 26)
        pdf.ln(4)
        _outline(pdf, f"A.{idx} {section.label}", level=1)
        pdf.set_font("Helvetica", "B", _FONT["h3"])
        pdf.set_text_color(*INK)
        pdf.cell(0, 6, _s(f"A.{idx}  {section.label}"), new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)
        _draw_appendix_table(pdf, section.appendix_rows)


# ── Evidence sources & integrity ──────────────────────────────────────────────


def _draw_evidence_sources(pdf: FPDF, sources: list[str], framework: str, scope_limitations: list[str]) -> None:
    pdf.add_page()
    _outline(pdf, "Evidence Sources & Integrity")
    _section(pdf, "Evidence Sources & Integrity", "Source systems, artifacts, and report boundaries.", gap=0)
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
    pdf.cell(0, 6, "Integrity", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", _FONT["body"])
    pdf.set_text_color(51, 65, 85)
    pdf.multi_cell(
        pdf.epw,
        5.2,
        _s(
            "Every artifact's SHA-256 checksum is recorded in checksum_manifest.json. "
            "Verify file hashes against that manifest before relying on the pack. "
            "When pack signing is enabled, pack_signature.json holds an Ed25519 signature over the "
            "checksum manifest — verify with GET /v1/meta/evidence-pack-signing-key. "
            "Build lineage (pack version, check registry hash, git SHA) is in source_manifest.json "
            "under pack_provenance."
        ),
        align="L",
    )
    pdf.ln(5)

    pdf.set_font("Helvetica", "B", _FONT["h3"])
    pdf.set_text_color(*INK)
    pdf.cell(0, 6, "How to use this report", new_x="LMARGIN", new_y="NEXT")
    steps = [
        "Read each capability domain assertion and its coverage line.",
        "Review documented exceptions (risk-accepted, with recorded reasons) and open gaps.",
        "Use the control cross-reference table to map domains to framework controls.",
        "Validate raw JSON and CSV evidence in the referenced control folders of the ZIP.",
    ]
    pdf.set_font("Helvetica", "", _FONT["body"])
    pdf.set_text_color(51, 65, 85)
    for idx, step in enumerate(steps, 1):
        pdf.cell(0, 5.4, _s(f"{idx}. {step}"), new_x="LMARGIN", new_y="NEXT")

    pdf.ln(5)
    pdf.set_font("Helvetica", "B", _FONT["h3"])
    pdf.set_text_color(*INK)
    pdf.cell(0, 6, "Assumptions and scope boundaries", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", _FONT["body"])
    pdf.set_text_color(51, 65, 85)
    if not scope_limitations:
        scope_limitations = [
            "Veritrail performs detection only and never modifies any resource.",
            "This report supports audit review but does not replace auditor judgment or company policy evidence.",
        ]
    for line in scope_limitations:
        pdf.multi_cell(pdf.epw, 5.2, _s(f"- {line}"), align="L")
        pdf.ln(1)


# ── Report assembly ───────────────────────────────────────────────────────────


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
    pack_provenance: dict[str, Any] | None = None,
    org_name: str | None = None,
) -> bytes:
    rid = report_id or "SAMPLE"
    framework_short = _FRAMEWORK_SHORT.get(framework, framework.upper())
    framework_label = _FRAMEWORK_LABELS.get(framework, framework.upper())
    pack_badge = _FRAMEWORK_PACK_BADGE.get(framework, "Compliance Evidence Pack")
    sources = evidence_sources or ["AWS IAM", "AWS CloudTrail", "AWS Config"]
    period_end = generated_at.date()
    period_start = since.date() if since else period_end
    account_label = getattr(acc, "label", "Account")
    account_id = getattr(acc, "account_id", None) or "unknown"
    org_display = org_name or account_label

    registry = (pack_provenance or {}).get("check_registry") or {}
    integrity_label = None
    if isinstance(registry, dict) and registry.get("check_ids_hash"):
        integrity_label = str(registry["check_ids_hash"])[:16]

    pdf = VeritrailEvidencePDF(
        report_id=rid,
        framework_short=framework_short,
        period_days=period_days,
        org_name=org_display,
        audit_window=f"{period_start} to {period_end}",
        generated_label=generated_at.strftime("%Y-%m-%d %H:%M UTC"),
        integrity_label=integrity_label,
    )
    pdf.alias_nb_pages()
    pdf.set_margins(14, 12, 14)
    pdf.set_auto_page_break(auto=True, margin=20)

    _draw_cover(
        pdf,
        title="Compliance Evidence Report",
        framework_label=framework_label,
        pack_badge=pack_badge,
        org_name=org_display,
        account_label=account_label,
        account_id=account_id,
        period_start=period_start,
        period_end=period_end,
        period_days=period_days,
        generated_at=generated_at,
        report_id=rid,
    )

    # All content pages carry the running header (org, window, generated, integrity).
    pdf.show_running_header = True
    pdf.add_page()

    _outline(pdf, "Report Overview")
    _section(
        pdf,
        "Report Overview",
        "Scope, collection facts, and audit readiness at a glance.",
        gap=0,
    )

    coverage_label = None
    scans = None
    failed_scan = None
    if coverage:
        coverage_label = coverage.get("coverage_label") or f"{coverage.get('days_with_data', 0)} of {coverage.get('days_requested', period_days)} days"
        scans = str(coverage.get("successful_scans_in_period", 0))
        failed_scan = str(coverage.get("last_failed_scan_at") or "")[:10] or None

    meta = [
        ("Organization", org_display),
        ("Account", f"{account_label} ({account_id})"),
        ("Audit period", f"{period_start} to {period_end} ({period_days} days)"),
        ("Generated", generated_at.strftime("%Y-%m-%d %H:%M UTC")),
        ("Report ID", rid),
        ("Sources", ", ".join(sources)),
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
    if pack_provenance:
        pack_ver = pack_provenance.get("pack_version")
        if pack_ver:
            meta.append(("Pack version", str(pack_ver)))
        build = pack_provenance.get("build") or {}
        git_sha = build.get("git_sha") if isinstance(build, dict) else None
        if git_sha:
            meta.append(("Build git SHA", str(git_sha)[:12]))
        if integrity_label:
            meta.append(("Check registry hash", integrity_label))
    _draw_meta_grid(pdf, meta)

    passed = sum(1 for r in control_results if r.get("status") == "pass")
    failed = sum(1 for r in control_results if r.get("status") == "fail")
    at_risk = sum(1 for r in control_results if r.get("status") == "at_risk")
    no_data = sum(1 for r in control_results if r.get("status") == "no_data")
    # Pass rate over controls that were actually evaluated — policy-only /
    # unevaluated controls (no automated checks) don't drag the rate to zero.
    evaluated = passed + failed + at_risk
    score_pct = round((passed / evaluated) * 100) if evaluated else 0
    # Unique open findings — a finding can map to several controls, so the sum of
    # per-control counts double-counts. Dedupe by finding id for the headline number.
    unique_ids = {f.get("id") for r in control_results for f in (r.get("findings") or []) if f.get("id")}
    unique_open = len(unique_ids) if unique_ids else sum(int(r.get("finding_count") or 0) for r in control_results)

    _outline(pdf, "Audit Readiness")
    _section(pdf, "Audit Readiness", "Control status reflects open findings. Evidence status reflects collected source snapshots.", gap=5)
    card_w = (pdf.epw - 9) / 4
    card_h = 28
    y0, x = pdf.get_y(), pdf.l_margin
    _metric_card(pdf, x, y0, card_w, card_h, "Pass rate", f"{score_pct}%", f"{passed} of {evaluated} evaluated controls passing", GREEN if score_pct == 100 else AMBER)
    x += card_w + 3
    _metric_card(pdf, x, y0, card_w, card_h, "Open findings", str(unique_open), "Unique; may map to multiple controls", RED if unique_open else GREEN)
    x += card_w + 3
    needs_detail = "Controls with open findings" if not at_risk else f"Plus {at_risk} at-risk (supporting signals)"
    _metric_card(pdf, x, y0, card_w, card_h, "Needs review", str(failed), needs_detail, AMBER if failed else GREEN)
    x += card_w + 3
    _metric_card(pdf, x, y0, card_w, card_h, "Not evaluated", str(no_data), "No automated checks in scope", (148, 163, 184))
    pdf.set_y(y0 + card_h + 4)

    if coverage:
        _draw_coverage_banner(pdf, coverage, period_days)

    # ── Capability domain narratives ──────────────────────────────────────────
    sections = build_domain_sections(
        control_results,
        framework=framework,
        account_label=account_label,
        account_id=account_id,
        generated_at=generated_at,
    )

    pdf.add_page()
    _outline(pdf, "Capability Domain Assertions")
    _section(
        pdf,
        "Capability Domain Assertions",
        "Automated evidence grouped by capability domain. Each assertion states only what mapped "
        "checks verified in this audit period, scoped to the account and as-of time shown. "
        "Open findings are reported as gaps; only risk-accepted findings with a recorded approval "
        "are treated as documented exceptions. Controls without automated checks in scope "
        "(manual attestation) appear in the Control Cross-Reference with status No Data.",
        gap=0,
    )
    if sections:
        for idx, section in enumerate(sections, 1):
            _draw_domain_section(pdf, section, idx)
    else:
        pdf.set_font("Helvetica", "", _FONT["body"])
        pdf.set_text_color(*MUTED)
        pdf.multi_cell(pdf.epw, 5, _s("No automated check evidence was collected in this audit period."), align="L")

    # ── Control cross-reference ───────────────────────────────────────────────
    pdf.add_page()
    _outline(pdf, "Control Cross-Reference")
    _section(
        pdf,
        "Control Cross-Reference",
        f"All mapped {framework_label} controls, failing controls first. Detailed evidence for each "
        "control is in its controls/<id>/ folder within the pack.",
        gap=0,
    )
    _draw_control_overview(pdf, sorted(control_results, key=_overview_sort_key))
    pdf.ln(2)
    pdf.set_font("Helvetica", "I", _FONT["tiny"])
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(pdf.epw, 4, _s("Findings can map to more than one control, so per-control counts may exceed the total unique open findings."), align="L")

    # ── Resource appendix ─────────────────────────────────────────────────────
    _draw_resource_appendix(pdf, sections)

    try:
        from app.data.control_narratives import scope_limitations_for

        scope_limitations = scope_limitations_for(framework)
    except Exception:
        scope_limitations = []
    _draw_evidence_sources(pdf, sources, framework, scope_limitations)

    output = pdf.output()
    return bytes(output) if not isinstance(output, (bytes, bytearray)) else bytes(output)
