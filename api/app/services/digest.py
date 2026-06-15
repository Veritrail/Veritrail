"""Weekly IAM hygiene digest email."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote

import structlog

from app.core.config import get_settings
from app.core.html_email import html_email as h
from app.services.mail import send_mail

log = structlog.get_logger()
settings = get_settings()

_SEV_EMOJI = {"critical": "🔴", "high": "🟠", "medium": "🟡", "low": "⚪"}


def _findings_app_url() -> str:
    base = settings.API_PUBLIC_URL
    if ":8000" in base:
        return base.replace(":8000", ":5173")
    return settings.FRONTEND_URL or base


def _unsubscribe_url(token: str | None) -> str:
    if token:
        return f"{settings.API_PUBLIC_URL.rstrip('/')}/v1/public/digest/unsubscribe?token={quote(token)}"
    return f"{_findings_app_url().rstrip('/')}/settings"


def _posture_score(counts: dict[str, int]) -> int:
    return max(0, min(100, 100 - (counts["critical"] + counts["high"]) * 10 - counts["medium"] * 3))


def _open_trend_series(total_open: int, per_day: list[dict] | None) -> list[int]:
    """Reconstruct an approximate 7-day open-findings series from daily new/resolved,
    anchored to today's open count (open_prev = open_today - new_today + resolved_today)."""
    if not per_day:
        return [total_open, total_open]
    n = len(per_day)
    series = [0] * n
    series[-1] = total_open
    for i in range(n - 1, 0, -1):
        series[i - 1] = max(0, series[i] - int(per_day[i].get("new", 0)) + int(per_day[i].get("resolved", 0)))
    return series


def send_digest(
    to: str,
    org_name: str,
    account_label: str,
    open_findings: list[dict[str, Any]],
    new_this_week: list[dict[str, Any]],
    resolved_this_week: int,
    *,
    unsubscribe_token: str | None = None,
    per_day: list[dict] | None = None,
    coverage: dict | None = None,
    prev: dict | None = None,
) -> bool:
    """Send weekly digest to a single recipient. Returns True on success.

    per_day: 7 dicts {label, new, resolved} oldest->newest (per-day chart).
    coverage: {accounts_done, accounts_total, regions}.
    prev: last week's snapshot {open_count, new_count, resolved_count, posture_score} for deltas.
    """
    counts = _severity_counts(open_findings)
    total_open = len(open_findings)
    posture = _posture_score(counts)

    images: dict[str, bytes] = {}
    try:
        from app.services.digest_charts import donut_png, grouped_bars_png, sparkline_png

        images["digest-donut"] = donut_png(counts, total=total_open)
        images["digest-spark"] = sparkline_png(_open_trend_series(total_open, per_day))
        if per_day:
            images["digest-bars"] = grouped_bars_png(
                [d.get("label", "") for d in per_day],
                [int(d.get("new", 0)) for d in per_day],
                [int(d.get("resolved", 0)) for d in per_day],
            )
    except Exception:  # noqa: BLE001 — charts are best-effort; fall back to a text-table email
        log.warning("digest.charts_failed", exc_info=True)
        images = {}

    subject = _subject(open_findings)
    html = _html(
        org_name, account_label, open_findings, new_this_week, resolved_this_week, unsubscribe_token,
        counts=counts, posture=posture, per_day=per_day, coverage=coverage, prev=prev,
        images=set(images.keys()),
    )
    text = _text(org_name, account_label, open_findings, new_this_week, resolved_this_week, unsubscribe_token)

    sent, err = send_mail(to=to, subject=subject, text=text, html=html, inline_images=images or None)
    if not sent:
        log.error("digest.failed", to=to, error=err)
    return sent


def _subject(open_findings: list[dict]) -> str:
    crit_high = sum(1 for f in open_findings if f["severity"] in ("critical", "high"))
    total = len(open_findings)
    if crit_high:
        return f"Vigil: {crit_high} critical/high finding{'s' if crit_high != 1 else ''} need attention"
    if total:
        return f"Vigil: {total} open finding{'s' if total != 1 else ''} — weekly digest"
    return "Vigil: No open findings — all clear"


# Email-safe severity palette (mockup: critical red, high orange, medium amber, low green).
_SEV_COLORS = {"critical": "#ef4444", "high": "#f97316", "medium": "#f59e0b", "low": "#10b981"}
_SEV_LABELS = {"critical": "Critical", "high": "High", "medium": "Medium", "low": "Low"}

# Map an AWS service (or source-control host) to a "Top risk categories" label.
_SERVICE_LABELS = {
    "iam": "IAM", "s3": "S3", "eks": "EKS", "ec2": "EC2 / Networking",
    "kms": "KMS", "rds": "RDS", "lambda": "Lambda", "cloudtrail": "CloudTrail",
    "ecr": "ECR", "acm": "ACM", "secretsmanager": "Secrets", "dynamodb": "DynamoDB",
    "elasticloadbalancing": "Load Balancing", "sns": "SNS", "sqs": "SQS",
}
# Category bar colors by rank — hottest first.
_RANK_COLORS = ["#ef4444", "#f97316", "#f59e0b", "#eab308", "#10b981", "#3b82f6", "#94a3b8"]


def _arn_category(arn: str) -> str:
    a = (arn or "").lower()
    if a.startswith("arn:aws:"):
        parts = a.split(":")
        svc = parts[2] if len(parts) > 2 else ""
        return _SERVICE_LABELS.get(svc, (svc.upper() if svc else "Other"))
    if "github" in a or "gitlab" in a:
        return "Source Code"
    return "Other"


def _short_arn(arn: str, limit: int = 52) -> str:
    """Middle-ellipsis so the meaningful ``arn:aws:svc`` prefix and the resource
    tail both survive (left-chopping mangles the prefix into ``rn:aws``)."""
    if len(arn) <= limit:
        return arn
    head = int(limit * 0.55)
    tail = limit - head - 1
    return f"{arn[:head]}…{arn[-tail:]}"


def _category_breakdown(open_findings: list[dict], limit: int = 6) -> list[tuple[str, int]]:
    counts: dict[str, int] = {}
    for f in open_findings:
        cat = _arn_category(f.get("resource_arn", ""))
        counts[cat] = counts.get(cat, 0) + 1
    ordered = sorted(counts.items(), key=lambda kv: -kv[1])
    top = ordered[:limit]
    rest = sum(c for _, c in ordered[limit:])
    if rest:
        top.append(("Other", rest))
    return top


def _severity_bar_html(counts: dict[str, int]) -> str:
    total = sum(counts.values())
    present = [s for s in _SEV_ORDER if counts[s] > 0]
    if total == 0 or not present:
        return '<table width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;overflow:hidden"><tr><td style="background:#e5e7eb;height:16px;font-size:0;line-height:0">&nbsp;</td></tr></table>'
    cells = "".join(
        f'<td style="background:{_SEV_COLORS[s]};height:16px;width:{counts[s] / total * 100:.2f}%;font-size:0;line-height:0">&nbsp;</td>'
        for s in present
    )
    return f'<table width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;overflow:hidden"><tr>{cells}</tr></table>'


def _severity_legend_html(counts: dict[str, int], other: int = 0) -> str:
    def cell(label: str, color: str, value: int) -> str:
        return (
            f'<td style="padding:6px 0;font-size:13px;color:#3f3f46;width:50%">'
            f'<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:{color};margin-right:8px"></span>'
            f'{label} <span style="color:#a1a1aa">({value})</span></td>'
        )

    rows = (
        f'<tr>{cell(_SEV_LABELS["critical"], _SEV_COLORS["critical"], counts["critical"])}{cell(_SEV_LABELS["high"], _SEV_COLORS["high"], counts["high"])}</tr>'
        f'<tr>{cell(_SEV_LABELS["medium"], _SEV_COLORS["medium"], counts["medium"])}{cell(_SEV_LABELS["low"], _SEV_COLORS["low"], counts["low"])}</tr>'
    )
    if other > 0:
        rows += f'<tr>{cell("Other", "#cbd5e1", other)}<td></td></tr>'
    return f'<table width="100%" cellpadding="0" cellspacing="0">{rows}</table>'


def _category_rows_html(cats: list[tuple[str, int]]) -> str:
    maxc = max((c for _, c in cats), default=1) or 1
    rows = ""
    for i, (name, c) in enumerate(cats):
        w = c / maxc * 100
        color = _RANK_COLORS[min(i, len(_RANK_COLORS) - 1)]
        rows += (
            "<tr>"
            f'<td style="padding:7px 12px 7px 0;font-size:13px;color:#3f3f46;white-space:nowrap;width:130px">{h(name)}</td>'
            '<td style="padding:7px 0;vertical-align:middle">'
            '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
            f'<td style="background:{color};height:8px;width:{w:.1f}%;border-radius:4px;font-size:0;line-height:0">&nbsp;</td>'
            '<td style="font-size:0;line-height:0">&nbsp;</td>'
            "</tr></table></td>"
            f'<td style="padding:7px 0 7px 12px;font-size:13px;font-weight:700;color:#18181b;text-align:right;width:44px">{c}</td>'
            "</tr>"
        )
    return rows


def _delta_line(curr: int, prev: int | None, *, good_when_up: bool, suffix: str = "vs last week") -> str:
    """Small trend line under a stat value. Empty if no prior baseline."""
    if prev is None:
        return ""
    diff = curr - prev
    if diff == 0:
        return f'<span style="color:#94a3b8">No change {suffix}</span>'
    up = diff > 0
    good = up == good_when_up
    color = "#16a34a" if good else "#dc2626"
    arrow = "▲" if up else "▼"
    pct = f"{abs(round(diff / prev * 100))}%" if prev else f"{abs(diff)}"
    return f'<span style="color:{color};font-weight:700">{arrow} {pct}</span> <span style="color:#94a3b8">{suffix} ({prev})</span>'


def _stat_cell_html(label: str, value: str, value_color: str, hint_html: str, *, chart_cid: str | None = None) -> str:
    chart = (
        f'<div style="margin-top:10px"><img src="cid:{chart_cid}" width="120" alt="" style="display:block;width:100%;max-width:130px;height:auto"></div>'
        if chart_cid
        else ""
    )
    return (
        '<td style="padding:0 8px;width:25%;height:100%;vertical-align:top">'
        '<table width="100%" cellpadding="0" cellspacing="0" style="height:100%;border:1px solid #e9edf3;border-radius:12px;background:#fff">'
        '<tr><td style="padding:16px 16px 18px;vertical-align:top">'
        f'<div style="font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#94a3b8">{h(label)}</div>'
        f'<div style="font-size:28px;font-weight:800;letter-spacing:-0.02em;color:{value_color};margin-top:6px;line-height:1">{h(value)}</div>'
        f'<div style="font-size:11px;margin-top:6px">{hint_html}</div>'
        f"{chart}"
        "</td></tr></table></td>"
    )


def _sidebar_card(title: str, body: str, *, subtitle: str = "") -> str:
    sub = f'<div style="font-size:12.5px;color:#94a3b8;margin-top:3px">{subtitle}</div>' if subtitle else ""
    return (
        '<table width="100%" height="100%" cellpadding="0" cellspacing="0" style="height:100%;margin-bottom:16px;border:1px solid #eceff3;border-radius:16px;background:#fff">'
        '<tr><td style="padding:22px 22px 24px;vertical-align:top">'
        f'<div style="font-size:15px;font-weight:700;letter-spacing:-0.01em;color:#0f172a">{title}</div>{sub}'
        f'<div style="margin-top:16px">{body}</div>'
        "</td></tr></table>"
    )


def _html(
    org_name: str,
    account_label: str,
    open_findings: list[dict],
    new_this_week: list[dict],
    resolved_this_week: int,
    unsubscribe_token: str | None = None,
    *,
    counts: dict[str, int] | None = None,
    posture: int | None = None,
    per_day: list[dict] | None = None,
    coverage: dict | None = None,
    prev: dict | None = None,
    images: set[str] | None = None,
) -> str:
    unsubscribe_href = _unsubscribe_url(unsubscribe_token)
    app_url = _findings_app_url().rstrip("/")
    findings_url = f"{app_url}/findings"
    images = images or set()

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=7)
    date_range = f"{start.strftime('%b %d')} – {end.strftime('%b %d, %Y')}"

    counts = counts or _severity_counts(open_findings)
    total_open = len(open_findings)
    posture_score = posture if posture is not None else _posture_score(counts)
    score_color = "#16a34a" if posture_score >= 80 else "#f59e0b" if posture_score >= 60 else "#dc2626"
    new_count = len(new_this_week)

    # Stat-card trend lines (only when last week's snapshot exists)
    posture_hint = (
        _delta_line(posture_score, prev.get("posture_score") if prev else None, good_when_up=True)
        or '<span style="color:#94a3b8">out of 100</span>'
    )
    new_hint = (
        _delta_line(new_count, prev.get("new_count") if prev else None, good_when_up=False)
        or '<span style="color:#94a3b8">Opened or reopened</span>'
    )
    resolved_hint = (
        _delta_line(resolved_this_week, prev.get("resolved_count") if prev else None, good_when_up=True)
        or '<span style="color:#94a3b8">Closed this week</span>'
    )
    open_hint = (
        _delta_line(total_open, prev.get("open_count") if prev else None, good_when_up=False)
        or '<span style="color:#94a3b8">Total</span>'
    )

    top = sorted(open_findings, key=lambda f: -f["risk_score"])[:10]
    rows_html = ""
    for f in top:
        sev = (f.get("severity") or "").lower()
        dot = _SEV_COLORS.get(sev, "#a1a1aa")
        arn = f.get("resource_arn") or ""
        arn_short = _short_arn(arn)
        cat = _arn_category(arn)
        rows_html += (
            "<tr>"
            '<td style="padding:11px 4px 11px 0;border-bottom:1px solid #f1f1f4;font-size:13px;color:#18181b;vertical-align:top">'
            f'<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:{dot};margin-right:8px;vertical-align:middle"></span>'
            f"{h(f['title'])}"
            f'<div style="margin-top:5px;margin-left:16px;font-size:10px;color:#94a3b8;font-family:Menlo,Consolas,monospace">{h(arn_short)} · {h(cat)}</div></td>'
            f'<td style="padding:11px 0 11px 8px;border-bottom:1px solid #f1f1f4;font-size:14px;font-weight:800;color:{dot};text-align:right;vertical-align:top">'
            f"{f['risk_score']}</td>"
            "</tr>"
        )

    cats = _category_breakdown(open_findings)
    other_sev = max(0, total_open - sum(counts.values()))

    # ── Cards ──
    if "digest-donut" in images:
        severity_body = (
            '<img src="cid:digest-donut" width="170" alt="" style="display:block;margin:6px auto 20px;width:170px;max-width:100%;height:auto">'
            f"{_severity_legend_html(counts, other_sev)}"
        )
    else:
        severity_body = f'<div>{_severity_bar_html(counts)}</div><div style="margin-top:14px">{_severity_legend_html(counts, other_sev)}</div>'
    severity_card = _sidebar_card("Findings by severity", severity_body, subtitle=f"{total_open} open total")

    bars_card = ""
    if "digest-bars" in images:
        bars_card = _sidebar_card(
            "New vs resolved",
            '<img src="cid:digest-bars" width="500" alt="" style="display:block;width:100%;height:auto">'
            '<div style="margin-top:12px;font-size:12px;color:#94a3b8">'
            '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#f97316;margin-right:6px"></span>New'
            '&nbsp;&nbsp;&nbsp;<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#22c55e;margin-right:6px"></span>Resolved</div>',
            subtitle="Last 7 days",
        )

    cats_card = ""
    if cats:
        cats_card = _sidebar_card(
            "Top risk categories",
            f'<table width="100%" cellpadding="0" cellspacing="0">{_category_rows_html(cats)}</table>',
            subtitle="Open findings by service",
        )

    coverage_card = ""
    if coverage:
        cov_rows = (
            '<table width="100%" cellpadding="0" cellspacing="0">'
            '<tr><td style="padding:8px 0;font-size:13.5px;color:#3f3f46">Accounts scanned</td>'
            f'<td style="padding:8px 0;font-size:13.5px;font-weight:700;color:#16a34a;text-align:right">{coverage.get("accounts_done", 0)} / {coverage.get("accounts_total", 0)}</td></tr>'
            '<tr><td style="padding:8px 0;font-size:13.5px;color:#3f3f46;border-top:1px solid #f4f5f7">Regions scanned</td>'
            f'<td style="padding:8px 0;font-size:13.5px;font-weight:700;color:#16a34a;text-align:right;border-top:1px solid #f4f5f7">{coverage.get("regions", "—")}</td></tr>'
            "</table>"
        )
        coverage_card = _sidebar_card("Coverage", cov_rows)

    help_card = _sidebar_card(
        "Need help?",
        '<div style="font-size:13.5px;color:#52525b;line-height:1.55">Reply to this email or open the Vigil console to dig into any finding.</div>'
        f'<div style="margin-top:16px"><a href="{h(findings_url)}" style="display:inline-block;background:#0b1220;color:#fff;padding:11px 20px;border-radius:10px;font-size:13px;font-weight:700;text-decoration:none">Open Vigil Console</a></div>',
    )

    # ── Main: top open risks card ──
    if not top:
        main_body = '<div style="color:#71717a;font-size:13.5px;padding:18px 0">No open findings this week.</div>'
    else:
        main_body = (
            '<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;border-collapse:collapse">'
            f"<tbody>{rows_html}</tbody></table>"
        )
    risks_count = (
        f'<span style="color:#a1a1aa;font-weight:500;font-size:12px"> · {len(top)} of {total_open}</span>'
        if total_open > len(top)
        else ""
    )
    risks_head = (
        '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
        f'<td style="font-size:15px;font-weight:700;letter-spacing:-0.01em;color:#0f172a;vertical-align:middle">Top open risks{risks_count}</td>'
        f'<td style="text-align:right;vertical-align:middle"><a href="{h(findings_url)}" style="font-size:12px;font-weight:600;color:#2563eb;text-decoration:none">View all</a></td>'
        "</tr></table>"
    )
    risks_card = (
        '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;border:1px solid #eceff3;border-radius:16px;background:#fff">'
        f'<tr><td style="padding:22px 24px 16px">{risks_head}{main_body}</td></tr></table>'
    )

    # ── Balanced layout: pair only naturally equal-height cards in 2-col rows,
    #    keep the tall ones (risks list, category bars) full-width. ──
    def _two_col(left: str, right: str, top_margin: str = "") -> str:
        if not right or not left:
            single = left or right
            return f'<div style="{top_margin}">{single}</div>' if top_margin else single
        return (
            f'<table width="100%" cellpadding="0" cellspacing="0" style="{top_margin}"><tr>'
            f'<td width="50%" valign="top" style="height:100%;padding-right:8px">{left}</td>'
            f'<td width="50%" valign="top" style="height:100%;padding-left:8px">{right}</td>'
            "</tr></table>"
        )

    charts_row = _two_col(severity_card, bars_card, top_margin="margin-top:18px")
    bottom_row = _two_col(coverage_card, help_card)

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7;margin:0;padding:28px 16px">
  <div style="max-width:760px;margin:0 auto">

    <!-- Hero -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b1220;border-radius:18px;overflow:hidden">
      <tr><td style="padding:34px 36px">
        <div style="font-size:18px;font-weight:800;color:#fff;letter-spacing:-0.02em">Vigil</div>
        <div style="font-size:30px;font-weight:800;color:#fff;letter-spacing:-0.03em;margin-top:20px">Weekly Security Digest</div>
        <div style="font-size:14.5px;color:#94a3b8;margin-top:7px">Your security posture at a glance.</div>
        <div style="font-size:13px;color:#cbd5e1;margin-top:18px;background:rgba(255,255,255,0.07);display:inline-block;padding:7px 14px;border-radius:9px">{date_range}</div>
      </td></tr>
    </table>

    <!-- Stat cards -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:18px -8px 0;width:calc(100% + 16px)">
      <tr>
        {_stat_cell_html("Posture score", f"{posture_score}", score_color, posture_hint, chart_cid="digest-spark" if "digest-spark" in images else None)}
        {_stat_cell_html("Open findings", f"{total_open}", "#18181b", open_hint)}
        {_stat_cell_html("New this week", f"{new_count}", "#ea580c" if new_count else "#16a34a", new_hint)}
        {_stat_cell_html("Resolved", f"{resolved_this_week}", "#16a34a", resolved_hint)}
      </tr>
    </table>

    <!-- Charts: severity donut | new-vs-resolved (a naturally matched pair) -->
    {charts_row}

    <!-- Top open risks: full width (the tall list reads better wide) -->
    {risks_card}

    <!-- Top risk categories: full width (horizontal bars use the room) -->
    {cats_card}

    <!-- Coverage | Need help (a matched short pair) -->
    {bottom_row}

    <!-- Footer -->
    <div style="padding:14px 8px 8px;text-align:center">
      <div style="font-size:12px;color:#94a3b8">Vigil · AI-powered security monitoring for your cloud</div>
      <div style="font-size:11px;color:#a1a1aa;margin-top:6px">
        Weekly digest for {h(org_name)} · {h(account_label)} · {end.strftime('%B %d, %Y')}<br>
        You're receiving this because you're subscribed to the Vigil Weekly Digest. <a href="{h(unsubscribe_href)}" style="color:#71717a;text-decoration:underline">Unsubscribe</a>
      </div>
    </div>
  </div>
</body>
</html>"""


def _text(
    org_name: str,
    account_label: str,
    open_findings: list[dict],
    new_this_week: list[dict],
    resolved_this_week: int,
    unsubscribe_token: str | None = None,
) -> str:
    unsubscribe_href = _unsubscribe_url(unsubscribe_token)
    lines = [
        f"Vigil — Weekly Security Digest for {org_name}",
        f"Account: {account_label}",
        f"Date: {datetime.now(timezone.utc).strftime('%Y-%m-%d')}",
        "",
        f"Open findings: {len(open_findings)}",
        f"New this week: {len(new_this_week)}",
        f"Resolved this week: {resolved_this_week}",
        "",
        "TOP OPEN RISKS",
        "=" * 40,
    ]
    top = sorted(open_findings, key=lambda f: -f["risk_score"])[:10]
    for f in top:
        lines.append(f"[{f['severity'].upper()}] {f['title']}")
        lines.append(f"  {f['resource_arn']}")
        lines.append(f"  Score: {f['risk_score']}")
        lines.append("")
    lines.append(f"Unsubscribe: {unsubscribe_href}")
    return "\n".join(lines)


# ── Slack Block Kit digest ─────────────────────────────────────────

_SEV_SQUARE = {"critical": "🟥", "high": "🟧", "medium": "🟨", "low": "🟩"}
_SEV_ORDER = ("critical", "high", "medium", "low")


def _severity_counts(open_findings: list[dict]) -> dict[str, int]:
    counts = {s: 0 for s in _SEV_ORDER}
    for f in open_findings:
        sev = (f.get("severity") or "").lower()
        if sev in counts:
            counts[sev] += 1
    return counts


def _severity_bar(counts: dict[str, int], width: int = 18) -> str:
    """Proportional colored-square bar; every present severity gets >=1 block so
    critical never vanishes, remaining width by largest-remainder."""
    total = sum(counts.values())
    if total == 0:
        return "⬜" * width
    present = [s for s in _SEV_ORDER if counts[s] > 0]
    extra_width = max(width - len(present), 0)
    raw = {s: counts[s] / total * extra_width for s in present}
    alloc = {s: 1 + int(raw[s]) for s in present}
    used = sum(alloc.values())
    remainder = sorted(((raw[s] - int(raw[s]), s) for s in present), reverse=True)
    i = 0
    while used < width and i < len(remainder):
        alloc[remainder[i][1]] += 1
        used += 1
        i += 1
    return "".join(_SEV_SQUARE[s] * alloc.get(s, 0) for s in _SEV_ORDER)


def build_digest_slack_blocks(
    *,
    account_label: str,
    open_findings: list[dict],
    new_this_week: list[dict],
    resolved_this_week: int,
) -> tuple[str, list[dict]]:
    """Return (fallback_text, Block Kit blocks) for the weekly Slack digest."""
    total = len(open_findings)
    counts = _severity_counts(open_findings)
    crit_high = counts["critical"] + counts["high"]
    date = datetime.now(timezone.utc).strftime("%B %d, %Y")
    app_url = _findings_app_url().rstrip("/")

    fallback = (
        f"Vigil weekly digest — {account_label}: "
        f"{total} open ({crit_high} critical/high) · "
        f"{len(new_this_week)} new · {resolved_this_week} resolved"
    )

    blocks: list[dict] = [
        {"type": "header", "text": {"type": "plain_text", "text": "Vigil weekly digest", "emoji": True}},
        {"type": "context", "elements": [
            {"type": "mrkdwn", "text": f":shield: *{account_label}*  ·  {date}"}
        ]},
        {"type": "section", "fields": [
            {"type": "mrkdwn", "text": f"*Open findings*\n{total}"},
            {"type": "mrkdwn", "text": f"*Critical / High*\n{crit_high}"},
            {"type": "mrkdwn", "text": f"*New this week*\n{len(new_this_week)}"},
            {"type": "mrkdwn", "text": f"*Resolved this week*\n{resolved_this_week}"},
        ]},
    ]

    if total:
        legend = "   ".join(f"{_SEV_SQUARE[s]} {s.capitalize()} {counts[s]}" for s in _SEV_ORDER)
        blocks.append({"type": "section", "text": {
            "type": "mrkdwn", "text": f"{_severity_bar(counts)}\n{legend}"}})

    top = sorted(open_findings, key=lambda f: -(f.get("risk_score") or 0))[:5]
    if top:
        blocks.append({"type": "divider"})
        lines = [
            f"{_SEV_EMOJI.get((f.get('severity') or '').lower(), '⚪')} "
            f"*{f.get('title') or 'Finding'}*  · risk {f.get('risk_score') or 0}"
            for f in top
        ]
        blocks.append({"type": "section", "text": {
            "type": "mrkdwn", "text": "*Top findings to address*\n" + "\n".join(lines)}})

    blocks.append({"type": "actions", "elements": [
        {"type": "button", "text": {"type": "plain_text", "text": "Open Vigil", "emoji": True},
         "url": f"{app_url}/findings", "style": "primary"},
    ]})

    return fallback, blocks
