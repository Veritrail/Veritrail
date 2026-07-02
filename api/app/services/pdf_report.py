"""Generate an auditor-ready PDF compliance evidence report using fpdf2.

The report is intentionally print-first: compact sections, predictable page
breaks, and neutral audit language rather than dashboard chrome.
"""
from __future__ import annotations

from datetime import datetime, timezone
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
    "h2": 14,
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

# The PDF is a summary/index, not the evidence population. Per control we show an
# aggregate (severity + resource types + age) plus a small labeled sample; the
# complete enumerated population always lives in that control's findings.json/CSV.
_PDF_FINDING_SAMPLE = 5


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


def _overview_sort_key(control: dict[str, Any]) -> tuple:
    rank = {"fail": 0, "at_risk": 1, "pass": 2, "no_data": 3}.get(control.get("status"), 4)
    return (rank,) + _review_priority(control)


def _resource_kind(arn: str) -> str:
    arn = arn or ""
    if ":role/" in arn:
        return "IAM roles"
    if ":user/" in arn:
        return "IAM users"
    if ":policy/" in arn:
        return "IAM policies"
    if "access-key" in arn or "access_key" in arn or arn.startswith("AKIA"):
        return "access keys"
    if arn.startswith("arn:aws:s3") or arn.startswith("s3://"):
        return "S3 buckets"
    if "kms" in arn:
        return "KMS keys"
    if arn.startswith("github://"):
        return "GitHub repos"
    if arn.startswith("gitlab://"):
        return "GitLab repos"
    if ":instance/" in arn or arn.startswith("i-"):
        return "EC2 instances"
    if "security-group" in arn or arn.startswith("sg-"):
        return "security groups"
    return "other resources"


def _population_summary(findings: list[dict[str, Any]]) -> tuple[str, str]:
    """Return (resource-type breakdown, evidence age span) summarizing every
    finding in the control without enumerating them."""
    kinds: dict[str, int] = {}
    firsts: list[str] = []
    lasts: list[str] = []
    for f in findings:
        kinds[_resource_kind(f.get("resource_arn") or "")] = kinds.get(_resource_kind(f.get("resource_arn") or ""), 0) + 1
        if f.get("first_seen"):
            firsts.append(str(f["first_seen"])[:10])
        if f.get("last_seen"):
            lasts.append(str(f["last_seen"])[:10])
    top = sorted(kinds.items(), key=lambda kv: -kv[1])[:4]
    kind_str = ", ".join(f"{count} {kind}" for kind, count in top) or "-"
    if firsts:
        oldest = min(firsts)
        newest = max(lasts) if lasts else oldest
        age_str = f"oldest open since {oldest}, most recent {newest}" if oldest != newest else f"first observed {oldest}"
    else:
        age_str = "-"
    return kind_str, age_str


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
    review = [r for r in control_results if r.get("status") in ("fail", "at_risk")]
    review.sort(key=lambda c: (0 if c.get("status") == "fail" else 1,) + _review_priority(c))
    return review[:limit]


def _finding_age_days(finding: dict[str, Any], *, ref: datetime | None = None) -> int | None:
    raw = finding.get("first_seen") or finding.get("last_seen")
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        anchor = ref or datetime.now(timezone.utc)
        return max(0, (anchor - dt).days)
    except (TypeError, ValueError):
        return None


def _oldest_finding_days(findings: list[dict[str, Any]], *, ref: datetime | None = None) -> int | None:
    ages = [d for f in findings if (d := _finding_age_days(f, ref=ref)) is not None]
    return max(ages) if ages else None


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
    def __init__(self, *, report_id: str, framework_short: str, period_days: int) -> None:
        super().__init__(orientation="P", unit="mm", format="A4")
        self.report_id = report_id
        self.framework_short = framework_short
        self.period_days = period_days

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
    account_label: str,
    account_id: str,
    period_start,
    period_end,
    period_days: int,
    generated_at: datetime,
    report_id: str,
) -> None:
    """Dedicated cover page: brand, title, and the four facts an auditor files
    the document under. Everything else starts on page 2."""
    pdf.add_page()

    # Top brand row
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

    # Title block
    pdf.ln(24)
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

    # Badge
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

    # Fact stack
    pdf.set_y(by + 26)
    facts = [
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

    # Bottom disclaimer
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


def _draw_header(pdf: VeritrailEvidencePDF, title: str, framework_label: str, pack_badge: str) -> None:
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
    pdf.cell(40, 7, "Veritrail")

    badge_w = 46
    bx = pdf.w - pdf.r_margin - badge_w
    pdf.set_xy(bx, y0 + 1)
    pdf.set_fill_color(239, 246, 255)
    pdf.set_draw_color(191, 219, 254)
    pdf.rect(bx, y0 + 1, badge_w, 9.5, style="FD")
    pdf.set_xy(bx, y0 + 4)
    pdf.set_font("Helvetica", "B", _FONT["small"])
    pdf.set_text_color(29, 78, 216)
    pdf.cell(badge_w, 3.5, _s(pack_badge), align="C")

    pdf.set_y(y0 + 23)
    pdf.set_font("Helvetica", "B", _FONT["display"])
    pdf.set_text_color(*INK)
    pdf.cell(0, 9, _s(title), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", _FONT["body"])
    pdf.set_text_color(*MUTED)
    pdf.cell(0, 5, _s(framework_label), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)
    pdf.set_font("Helvetica", "", _FONT["small"])
    pdf.set_text_color(148, 163, 184)
    pdf.cell(0, 4, _s("Not a compliance attestation - supports audit review only."), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
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
        st = control.get("status") or "fail"
        status_style = _STATUS.get(st, _STATUS["fail"])
        pdf.set_xy(x0 + pdf.epw - 30, y + 3.5)
        _pill(pdf, status_style["label"], status_style, w=24, h=5.8)
    pdf.set_y(y0 + h + 5)


def _draw_exception_register(pdf: FPDF, controls: list[dict[str, Any]], *, generated_at: datetime) -> None:
    """Severity-weighted register for fail/at_risk controls and approved exceptions."""
    actionable = [
        c
        for c in controls
        if c.get("status") in ("fail", "at_risk")
        and (c.get("findings") or c.get("exception_narratives"))
    ]
    if not actionable:
        return

    col_w = [20, 52, 24, 18, 18, 18, 18, 22]
    headers = ["Control", "Objective", "Status", "Crit", "High", "Med", "Low", "Oldest"]

    def header() -> None:
        y = pdf.get_y()
        x = pdf.l_margin
        pdf.set_fill_color(*SOFT_BG)
        pdf.set_draw_color(*SUBTLE)
        pdf.set_font("Helvetica", "B", _FONT["tiny"])
        pdf.set_text_color(*MUTED)
        for width, label in zip(col_w, headers):
            pdf.rect(x, y, width, 8, style="FD")
            pdf.set_xy(x + 1.5, y + 2.2)
            align = "C" if label not in {"Control", "Objective", "Status"} else "L"
            pdf.cell(width - 3, 3.5, _s(label.upper()), align=align)
            x += width
        pdf.set_y(y + 8)

    pdf.add_page()
    _outline(pdf, "Exception Register")
    _section(
        pdf,
        "Exception Register",
        "Open findings by severity and age. Approved exceptions are listed below the table.",
        gap=0,
    )
    header()
    for control in sorted(actionable, key=_overview_sort_key):
        findings = control.get("findings") or []
        counts = _severity_counts(findings)
        oldest = _oldest_finding_days(findings, ref=generated_at)
        row_h = 10
        if pdf.get_y() + row_h > _bottom(pdf):
            pdf.add_page()
            _section(pdf, "Exception Register", "Continued.", gap=0)
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
        pdf.cell(col_w[1] - 4, 4, _s(_truncate_middle(_objective_text(control.get("title", "")), 42)))
        x += col_w[1]
        status_style = _STATUS.get(control.get("status"), _STATUS["no_data"])
        pdf.set_xy(x + 2, y + 2)
        _pill(pdf, status_style["label"], status_style, w=col_w[2] - 4, h=5.8)
        x += col_w[2]
        pdf.set_font("Helvetica", "B", _FONT["table"])
        pdf.set_text_color(*INK)
        for idx, sev in enumerate(("critical", "high", "medium", "low"), start=3):
            pdf.set_xy(x + 2, y + 2.2)
            pdf.cell(col_w[idx] - 4, 4, _s(str(counts.get(sev, 0))), align="C")
            x += col_w[idx]
        pdf.set_xy(x + 2, y + 2.2)
        pdf.cell(col_w[7] - 4, 4, _s(f"{oldest}d" if oldest is not None else "-"), align="C")
        pdf.set_y(y + row_h)

    with_exceptions = [c for c in actionable if c.get("exception_narratives")]
    if with_exceptions:
        pdf.ln(4)
        pdf.set_font("Helvetica", "B", _FONT["h3"])
        pdf.set_text_color(*INK)
        pdf.cell(0, 6, _s("Approved exceptions"), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", _FONT["small"])
        pdf.set_text_color(51, 65, 85)
        for control in with_exceptions:
            cid = control.get("control_id", "-")
            for line in (control.get("exception_narratives") or [])[:3]:
                pdf.multi_cell(pdf.epw, 4.8, _s(f"{cid}: {line}"), align="L")
            extra = len(control.get("exception_narratives") or []) - 3
            if extra > 0:
                pdf.set_text_color(*MUTED)
                pdf.cell(0, 4.6, _s(f"{cid}: {extra} more in controls/{cid}/exceptions.json"), new_x="LMARGIN", new_y="NEXT")
                pdf.set_text_color(51, 65, 85)


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


def _draw_findings_header(pdf: FPDF) -> None:
    pdf.set_font("Helvetica", "B", _FONT["tiny"])
    pdf.set_text_color(*MUTED)
    x0, y = pdf.l_margin, pdf.get_y()
    pdf.set_xy(x0, y)
    pdf.cell(20, 4, "SEVERITY")
    pdf.set_xy(x0 + 20, y)
    pdf.cell(0, 4, "FINDING / RESOURCE")
    pdf.set_xy(pdf.w - pdf.r_margin - 44, y)
    pdf.cell(44, 4, "FIRST / LAST SEEN", align="R")
    pdf.ln(5)
    pdf.set_draw_color(*SUBTLE)
    pdf.line(x0, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
    pdf.ln(1)


def _draw_finding_row(pdf: FPDF, finding: dict[str, Any], idx: int) -> None:
    """Two-line finding row: severity + issue title + full resource ARN, with
    first/last-seen dates right-aligned. Width-fitted so nothing clips."""
    row_h = 11
    _ensure(pdf, row_h)
    x0, y = pdf.l_margin, pdf.get_y()
    if idx > 1:
        pdf.set_draw_color(236, 240, 245)
        pdf.line(x0, y, x0 + pdf.epw, y)

    sev = (finding.get("severity") or "medium").lower()
    sev_style = _SEVERITY.get(sev, _SEVERITY["medium"])
    pdf.set_xy(x0, y + 2.4)
    _pill(pdf, sev_style["label"], sev_style, w=18, h=5.4)

    text_x = x0 + 22
    dates = f"First {_fmt_date(finding.get('first_seen'))}    Last {_fmt_date(finding.get('last_seen'))}"
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


def _label_value_row(pdf: FPDF, label: str, value: str, *, label_w: float = 32) -> None:
    yy = pdf.get_y()
    pdf.set_xy(pdf.l_margin, yy)
    pdf.set_font("Helvetica", "B", _FONT["small"])
    pdf.set_text_color(71, 85, 105)
    pdf.cell(label_w, 5, _s(label))
    pdf.set_xy(pdf.l_margin + label_w, yy)
    pdf.set_font("Helvetica", "", _FONT["small"])
    pdf.set_text_color(30, 41, 59)
    pdf.multi_cell(pdf.epw - label_w, 5, _s(value), align="L", new_x="LMARGIN", new_y="NEXT")


def _draw_control_detail(pdf: FPDF, control: dict[str, Any], framework: str) -> None:
    """One section per in-scope control: status, narrative, tested scope,
    exceptions, and (for failing controls) a findings sample."""
    findings = control.get("findings") or []
    counts = _severity_counts(findings)
    cid = control.get("control_id", "-")
    st = control.get("status") or ("fail" if findings else "no_data")
    style = _STATUS.get(st, _STATUS["no_data"])
    count = int(control.get("finding_count") or len(findings) or 0)
    shown = min(len(findings), _PDF_FINDING_SAMPLE)
    audit_block = control.get("audit_block") or {}
    exceptions = [str(x) for x in (control.get("exception_narratives") or []) if str(x).strip()]

    # Keep the control header + meta + a few rows together; start a new page only
    # when there isn't room, so several small controls share a page.
    pdf.ln(5)
    _ensure(pdf, 52 if st in ("fail", "at_risk") else 34)

    # Header band: soft filled bar with the control title left, status pill right.
    control_title = f"{cid}  {_objective_text(control.get('title', ''))}"
    _outline(pdf, control_title, level=1)
    band_h = 11
    y_band = pdf.get_y()
    pdf.set_fill_color(*SOFT_BG)
    pdf.set_draw_color(*SUBTLE)
    pdf.rect(pdf.l_margin, y_band, pdf.epw, band_h, style="FD", round_corners=True, corner_radius=1.6)
    pdf.set_xy(pdf.l_margin + 3.2, y_band + (band_h - 6.6) / 2)
    pdf.set_font("Helvetica", "B", _FONT["h2"])
    pdf.set_text_color(*INK)
    pdf.cell(
        pdf.epw - 40,
        6.6,
        _fit_text(pdf, _s(control_title), pdf.epw - 40, family="Helvetica", size=_FONT["h2"], style="B"),
        align="L",
    )
    pdf.set_xy(pdf.w - pdf.r_margin - 32.5, y_band + (band_h - 6.2) / 2)
    _pill(pdf, style["label"], style, w=30, h=6.2)
    pdf.set_y(y_band + band_h + 2.5)

    ev = _EVIDENCE.get(control.get("evidence_status", "missing"), _EVIDENCE["missing"])["label"]
    pdf.set_font("Helvetica", "", _FONT["small"])
    pdf.set_text_color(*MUTED)
    meta_bits = [f"{count} open findings"]
    if findings:
        meta_bits.append(_severity_summary(counts))
    meta_bits.append(f"Evidence {ev}")
    if exceptions:
        meta_bits.append(f"{len(exceptions)} approved exception(s)")
    pdf.cell(0, 5, _s("    |    ".join(meta_bits)), new_x="LMARGIN", new_y="NEXT")

    # Auditor narrative — the affirmative statement of what this control covers
    # and what evidence Veritrail collects for it.
    try:
        from app.data.control_narratives import narrative_for

        narrative = narrative_for(framework, cid)
    except Exception:
        narrative = None
    if narrative:
        pdf.ln(1.5)
        pdf.set_font("Helvetica", "", _FONT["body"])
        pdf.set_text_color(51, 65, 85)
        pdf.multi_cell(pdf.epw, 5.2, _s(narrative), align="L")
    else:
        desc = (control.get("description") or "").strip()
        if desc:
            pdf.ln(1)
            pdf.set_font("Helvetica", "", _FONT["body"])
            pdf.set_text_color(51, 65, 85)
            pdf.multi_cell(pdf.epw, 5.2, _s(desc), align="L")
    pdf.ln(2.5)

    # Structured result block (from the v2 audit template when available).
    current = (audit_block.get("current_result") or {}).get("summary")
    if current:
        _label_value_row(pdf, "Result", current)
    tested = audit_block.get("what_veritrail_tested") or []
    if tested:
        preview = ", ".join(tested[:4])
        if len(tested) > 4:
            preview += f", and {len(tested) - 4} more"
        _label_value_row(pdf, "Tested", f"{len(tested)} automated check(s): {preview}")
    next_step = audit_block.get("recommended_next_step")
    if next_step and st != "pass":
        _label_value_row(pdf, "Next step", next_step)

    # Population aggregate — characterizes ALL findings without enumerating them.
    if findings:
        kind_str, age_str = _population_summary(findings)
        _label_value_row(pdf, "Resource types", kind_str)
        _label_value_row(pdf, "Evidence age", age_str)

    # Approved exceptions — risk-accepted items the auditor should see inline,
    # not buried in exceptions.json. Amber callout so they read as documented
    # deviations, not findings.
    if exceptions:
        shown_exc = exceptions[:6]
        pdf.ln(2)
        _ensure(pdf, 12 + 5 * len(shown_exc))
        x0, y0 = pdf.l_margin, pdf.get_y()
        pad = 3
        pdf.set_xy(x0 + pad, y0 + pad)
        pdf.set_font("Helvetica", "B", _FONT["h3"])
        pdf.set_text_color(146, 64, 14)
        pdf.cell(0, 5, _s("Approved exceptions"), new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", _FONT["small"])
        pdf.set_text_color(120, 63, 4)
        for narrative_line in shown_exc:
            pdf.set_x(x0 + pad)
            pdf.multi_cell(pdf.epw - 2 * pad, 4.8, _s(f"-  {narrative_line}"), align="L", new_x="LMARGIN", new_y="NEXT")
        if len(exceptions) > 6:
            pdf.set_x(x0 + pad)
            pdf.cell(0, 4.6, _s(f"{len(exceptions) - 6} more in controls/{cid}/exceptions.json"), new_x="LMARGIN", new_y="NEXT")
        y1 = pdf.get_y() + pad
        pdf.set_draw_color(253, 230, 138)
        pdf.rect(x0, y0, pdf.epw, y1 - y0, style="D", round_corners=True, corner_radius=1.6)
        pdf.set_y(y1)

    # Findings sample — only for controls that need attention.
    if st in ("fail", "at_risk") and findings:
        pdf.ln(3)
        pdf.set_x(pdf.l_margin)
        pdf.set_font("Helvetica", "B", _FONT["h3"])
        pdf.set_text_color(*INK)
        pdf.cell(0, 5.5, _s("Sample findings"), new_x="LMARGIN", new_y="NEXT")
        pdf.set_x(pdf.l_margin)
        pdf.set_font("Helvetica", "", _FONT["small"])
        pdf.set_text_color(*MUTED)
        pdf.cell(0, 4.6, _s(f"Showing {shown} of {count}. Complete population in controls/{cid}/findings.json."), new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)

        _ensure(pdf, 16)
        _draw_findings_header(pdf)
        for idx, finding in enumerate(findings[:_PDF_FINDING_SAMPLE], 1):
            _draw_finding_row(pdf, finding, idx)

    pdf.ln(2.5)
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Courier", "", _FONT["mono"])
    pdf.set_text_color(120, 130, 145)
    artifacts = f"Evidence files: controls/{cid}/ findings.json (complete)  |  snapshots.json  |  exceptions.json"
    pdf.cell(0, 4, _fit_text(pdf, artifacts, pdf.epw, family="Courier", size=_FONT["mono"]), new_x="LMARGIN", new_y="NEXT")


def _draw_evidence_sources(pdf: FPDF, sources: list[str], framework: str, scope_limitations: list[str]) -> None:
    pdf.add_page()
    _outline(pdf, "Evidence Sources")
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
    pdf.cell(0, 6, "Integrity", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", _FONT["body"])
    pdf.set_text_color(51, 65, 85)
    pdf.multi_cell(
        pdf.epw,
        5.2,
        _s("Every artifact's SHA-256 checksum is recorded in checksum_manifest.json. Verify the pack against this manifest before relying on it; when pack signing is enabled the manifest is signed."),
        align="L",
    )
    pdf.ln(5)

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

    pdf = VeritrailEvidencePDF(report_id=rid, framework_short=framework_short, period_days=period_days)
    pdf.alias_nb_pages()
    pdf.set_margins(14, 12, 14)
    pdf.set_auto_page_break(auto=True, margin=20)

    _draw_cover(
        pdf,
        title="Compliance Evidence Report",
        framework_label=framework_label,
        pack_badge=pack_badge,
        account_label=getattr(acc, "label", "Account"),
        account_id=getattr(acc, "account_id", None) or "unknown",
        period_start=period_start,
        period_end=period_end,
        period_days=period_days,
        generated_at=generated_at,
        report_id=rid,
    )

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
        ("Collection", "Automated API collection"),
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
    at_risk = sum(1 for r in control_results if r.get("status") == "at_risk")
    no_data = sum(1 for r in control_results if r.get("status") == "no_data")
    total = len(control_results)
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

    key_controls = _key_controls_for_review(control_results)
    if key_controls:
        pdf.ln(3)
        _section(
            pdf,
            "Priority Review",
            "Benchmark failures and at-risk controls ranked by finding severity.",
            gap=3,
        )
        _draw_top_controls(pdf, key_controls)

    review_controls = [r for r in control_results if r.get("status") == "fail"]
    review_controls.sort(key=_review_priority)
    at_risk_controls = [r for r in control_results if r.get("status") == "at_risk"]
    passing_controls = [r for r in control_results if r.get("status") == "pass"]
    other_controls = [r for r in control_results if r.get("status") not in ("fail", "at_risk", "pass")]

    # Control Overview starts on its own page so the table is contiguous (no
    # orphan split). With many controls (CIS/ISO) it flows across pages with a
    # repeated header; with few it fills one clean page.
    pdf.add_page()
    _outline(pdf, "Control Overview")
    _section(pdf, "Control Overview", "Mapped controls, ranked with failing controls first.", gap=0)
    _draw_control_overview(pdf, sorted(control_results, key=_overview_sort_key))
    pdf.ln(2)
    pdf.set_font("Helvetica", "I", _FONT["tiny"])
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(pdf.epw, 4, _s("Findings can map to more than one control, so per-control counts may exceed the total unique open findings."), align="L")

    _draw_exception_register(pdf, control_results, generated_at=generated_at)

    # Every in-scope control gets a section — auditors need the affirmative
    # statement for passing controls, not only the failure list.
    _outline(pdf, "Control Results & Narratives")
    _section(
        pdf,
        "Control Results & Narratives",
        "One section per control: narrative, tested scope, result, approved exceptions, and a findings sample where review is needed.",
        gap=6,
    )
    for control in review_controls:
        _draw_control_detail(pdf, control, framework)
    for control in at_risk_controls:
        _draw_control_detail(pdf, control, framework)
    for control in passing_controls:
        _draw_control_detail(pdf, control, framework)
    for control in other_controls:
        _draw_control_detail(pdf, control, framework)

    try:
        from app.data.control_narratives import scope_limitations_for

        scope_limitations = scope_limitations_for(framework)
    except Exception:
        scope_limitations = []
    _draw_evidence_sources(pdf, sources, framework, scope_limitations)

    output = pdf.output()
    return bytes(output) if not isinstance(output, (bytes, bytearray)) else bytes(output)
