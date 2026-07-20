"""Email alert when an AWS account scan fails."""
from __future__ import annotations

import uuid

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.html_email import html_email as h
from app.models import AwsAccount, Finding, FindingEvent, ScanRun
from app.models.org import Org, User
from app.services.email_template import detail_rows, render_email
from app.services.mail import send_mail

log = structlog.get_logger()


def resolve_alert_recipient(org: Org, db: Session) -> str | None:
    org_settings = org.settings or {}
    digest_email = org_settings.get("notifications", {}).get("digest_email")
    if digest_email:
        return digest_email
    user = db.scalars(
        select(User)
        .where(User.org_id == org.id)
        .where(User.email.is_not(None))
        .order_by(User.created_at.asc())
    ).first()
    return user.email if user else None


def send_scan_failure_email(
    *,
    to: str,
    org_name: str,
    account_label: str,
    account_id: str | None,
    failed_step: str | None,
    error_type: str | None,
    error_summary: str,
) -> bool:
    subject = f"Veritrail: Scan failed — {account_label}"
    acct = f" ({account_id})" if account_id else ""
    text = (
        f"A Veritrail scan failed for {account_label}{acct}.\n\n"
        f"Organization: {org_name}\n"
        f"Step: {failed_step or 'unknown'}\n"
        f"Error: {error_type or 'Error'}\n\n"
        f"{error_summary}\n\n"
        "Open Veritrail → Accounts to verify your IAM role and trigger a re-scan."
    )
    from app.services.digest import _findings_app_url

    accounts_url = f"{_findings_app_url().rstrip('/')}/accounts"
    html = render_email(
        eyebrow="Collection alert",
        title="Cloud scan failed",
        preheader=f"Evidence collection failed for {account_label}.",
        body_html=(
            f'<p style="margin:0 0 16px">Veritrail could not complete evidence collection for '
            f'<strong style="color:#273247">{h(account_label)}</strong>{h(acct)}.</p>'
            + detail_rows([
                ("Workspace", org_name),
                ("Failed step", failed_step or "Unknown"),
                ("Error type", error_type or "Error"),
            ])
            + f'<div style="margin-top:16px;padding:12px 14px;background:#fff7ed;border:1px solid #fed7aa;'
            f'border-radius:7px;color:#9a3412;font-family:Menlo,Consolas,monospace;font-size:12px;'
            f'line-height:1.5;word-break:break-word">{h(error_summary[:800])}</div>'
            '<p style="margin:16px 0 0">Verify the account role, then start a new scan.</p>'
        ),
        cta_label="Review account",
        cta_url=accounts_url,
    )
    sent, err = send_mail(to=to, subject=subject, text=text, html=html)
    if not sent:
        log.error("scan_alert.failed", to=to, error=err)
    return sent


def notify_scan_failure(db: Session, account_id: uuid.UUID, scan_run_id: uuid.UUID) -> bool:
    acc = db.get(AwsAccount, account_id)
    run = db.get(ScanRun, scan_run_id)
    if not acc or not run or run.status != "error":
        return False

    org = db.get(Org, acc.org_id)
    if not org:
        return False

    notifications = (org.settings or {}).get("notifications") or {}
    if not notifications.get("scan_failure_email_enabled", True) and not (
        notifications.get("slack_webhook_url") and notifications.get("slack_scan_failure_enabled", True)
    ):
        return False

    stats = run.stats or {}
    error_line = (run.error or "Unknown error").split("\n", 1)[0]
    sent = False

    slack_url = notifications.get("slack_webhook_url")
    if slack_url and notifications.get("slack_scan_failure_enabled", True):
        sent = _post_scan_failure_slack(
            slack_url,
            acc.label,
            stats.get("failed_at"),
            stats.get("error_type"),
            error_line,
        ) or sent

    if notifications.get("scan_failure_email_enabled", True):
        recipient = resolve_alert_recipient(org, db)
        if recipient:
            sent = (
                send_scan_failure_email(
                    to=recipient,
                    org_name=org.name,
                    account_label=acc.label,
                    account_id=acc.account_id,
                    failed_step=stats.get("failed_at"),
                    error_type=stats.get("error_type"),
                    error_summary=error_line,
                )
                or sent
            )
        elif not sent:
            log.info("scan_alert.skipped", reason="no recipient", org_id=str(org.id))

    return sent


def _post_scan_failure_slack(
    slack_url: str,
    account_label: str,
    failed_step: str | None,
    error_type: str | None,
    error_summary: str,
) -> bool:
    text = (
        f":x: *Veritrail scan failed* — `{account_label}`\n"
        f"Step: {failed_step or 'unknown'}\n"
        f"Error: {error_type or 'Error'}\n"
        f"{error_summary[:500]}"
    )
    try:
        resp = httpx.post(slack_url, json={"text": text}, timeout=10)
        resp.raise_for_status()
        return True
    except Exception as e:  # noqa: BLE001
        log.error("scan_alert.slack_failed", error=str(e))
        return False


_SEVERITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def _post_new_findings_slack(
    slack_url: str, account_label: str, items: list[tuple[str, str]], app_url: str
) -> bool:
    shown = items[:8]
    lines = [f"• *{sev.upper()}* — {title}" for sev, title in shown]
    if len(items) > len(shown):
        lines.append(f"…and {len(items) - len(shown)} more")
    plural = "s" if len(items) != 1 else ""
    text = (
        f":rotating_light: *Veritrail — {len(items)} new critical/high finding{plural}* "
        f"in {account_label}\n" + "\n".join(lines) + f"\n<{app_url}|Review in Veritrail>"
    )
    try:
        resp = httpx.post(slack_url, json={"text": text}, timeout=10)
        resp.raise_for_status()
        return True
    except Exception as e:  # noqa: BLE001
        log.error("new_findings_alert.slack_failed", error=str(e))
        return False


def send_new_findings_email(
    *,
    to: str,
    org_name: str,
    account_label: str,
    account_id: str | None,
    items: list[tuple[str, str]],
    app_url: str,
) -> bool:
    n = len(items)
    plural = "s" if n != 1 else ""
    acct = f" ({account_id})" if account_id else ""
    shown = items[:12]
    rows = "".join(
        f'<tr><td style="padding:4px 8px 4px 0;color:#b91c1c;font-weight:600;'
        f'white-space:nowrap;vertical-align:top">{h(sev.upper())}</td>'
        f'<td style="padding:4px 0">{h(title)}</td></tr>'
        for sev, title in shown
    )
    more = (
        f'<p style="margin:8px 0 0;color:#71717a;font-size:13px">…and {n - len(shown)} more.</p>'
        if n > len(shown)
        else ""
    )
    subject = f"Veritrail: {n} new critical/high finding{plural} — {account_label}"
    text = (
        f"{n} new critical/high finding{plural} in {account_label}{acct} ({org_name}).\n\n"
        + "\n".join(f"[{sev.upper()}] {title}" for sev, title in shown)
        + (f"\n…and {n - len(shown)} more." if n > len(shown) else "")
        + f"\n\nReview: {app_url}"
    )
    html = render_email(
        eyebrow="Risk alert",
        title=f"{n} new critical/high finding{plural}",
        preheader=f"New findings require attention in {account_label}.",
        body_html=(
            f'<p style="margin:0 0 16px">Detected in <strong style="color:#273247">{h(account_label)}</strong>{h(acct)}.</p>'
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'style="border-collapse:collapse;font-size:14px">{rows}</table>{more}'
        ),
        cta_label="Review findings",
        cta_url=app_url,
    )
    sent, err = send_mail(to=to, subject=subject, text=text, html=html)
    if not sent:
        log.error("new_findings_alert.email_failed", to=to, error=err)
    else:
        log.info("new_findings_alert.email_sent", to=to, account=account_label, count=n)
    return sent


def notify_new_findings(db: Session, account_id: uuid.UUID, scan_run_id: uuid.UUID) -> bool:
    """Real-time alert (Slack + email) when a scan opens new critical/high findings.

    Fires only when the scan opened or reopened findings of critical/high severity
    since the run started — silent on clean scans. Channels are best-effort and
    independent: Slack posts if a webhook is configured, email if a recipient resolves.
    """
    acc = db.get(AwsAccount, account_id)
    run = db.get(ScanRun, scan_run_id)
    if not acc or not run or run.status == "error":
        return False

    org = db.get(Org, acc.org_id)
    if not org:
        return False

    notifications = (org.settings or {}).get("notifications") or {}
    if not notifications.get("critical_alert_enabled", True):
        return False

    rows = db.execute(
        select(Finding.severity, Finding.title)
        .join(FindingEvent, FindingEvent.finding_id == Finding.id)
        .where(
            Finding.account_id == acc.id,
            Finding.status == "open",
            Finding.severity.in_(("critical", "high")),
            FindingEvent.action.in_(("opened", "reopened")),
            FindingEvent.ts >= run.started_at,
        )
        .distinct()
    ).all()
    if not rows:
        return False

    items = sorted(
        ((sev, title) for sev, title in rows),
        key=lambda r: _SEVERITY_RANK.get(r[0], 4),
    )

    from app.services.digest import _findings_app_url

    app_url = _findings_app_url()

    sent = False
    slack_url = notifications.get("slack_webhook_url")
    if slack_url and notifications.get("slack_critical_alerts_enabled", True):
        sent = _post_new_findings_slack(slack_url, acc.label, items, app_url) or sent

    recipient = resolve_alert_recipient(org, db)
    if recipient:
        sent = (
            send_new_findings_email(
                to=recipient,
                org_name=org.name,
                account_label=acc.label,
                account_id=acc.account_id,
                items=items,
                app_url=app_url,
            )
            or sent
        )

    log.info("new_findings_alert.done", account_id=str(acc.id), count=len(items), sent=sent)
    return sent


# --- stale-scan alerting -----------------------------------------------------
# For an evidence product the one unforgivable failure is a silent scan gap
# inside the audit window. Alert when a connected account has not completed a
# scan within its configured interval (+ grace), once per stale episode.

_STALE_GRACE_HOURS = 2
_STALE_REALERT_HOURS = 24


def _expected_interval_hours(org_settings: dict | None) -> int | None:
    from app.services.scan_schedule import _INTERVAL_HOURS, get_scanning_settings

    scanning = get_scanning_settings(org_settings)
    if not scanning.get("enabled") or scanning.get("interval") == "manual":
        return None
    if scanning["interval"] == "custom":
        return scanning.get("custom_hours") or 24
    return _INTERVAL_HOURS.get(scanning["interval"], 24)


def send_stale_scan_email(
    *, to: str, org_name: str, account_label: str, account_id: str | None,
    hours_overdue: int, last_scan_label: str,
) -> bool:
    acct = f" ({account_id})" if account_id else ""
    subject = f"Veritrail: No recent scan — {account_label}"
    text = (
        f"Veritrail has not completed a scan for {account_label}{acct} in over "
        f"{hours_overdue} hours (last scan {last_scan_label}).\n\n"
        f"Organization: {org_name}\n\n"
        "Continuous evidence has a gap until the next successful scan. Open "
        "Veritrail → Accounts to verify the IAM role and trigger a scan."
    )
    from app.services.digest import _findings_app_url

    accounts_url = f"{_findings_app_url().rstrip('/')}/accounts"
    html = render_email(
        eyebrow="Evidence coverage",
        title="Cloud scan is overdue",
        preheader=f"Evidence collection is overdue for {account_label}.",
        body_html=(
            f'<p style="margin:0">Veritrail has not completed a scan for '
            f'<strong style="color:#273247">{h(account_label)}</strong>{h(acct)} in more than '
            f'<strong style="color:#273247">{hours_overdue} hours</strong>.</p>'
            f'<p style="margin:14px 0 0">The last successful scan was {h(last_scan_label)}. '
            "Continuous evidence has a gap until the next successful scan.</p>"
        ),
        cta_label="Review account",
        cta_url=accounts_url,
    )
    sent, err = send_mail(to=to, subject=subject, text=text, html=html)
    if not sent:
        log.error("stale_scan_alert.email_failed", error=err)
    return sent


def _post_stale_scan_slack(slack_url: str, account_label: str, hours_overdue: int) -> bool:
    text = (
        f":warning: *Veritrail scan gap* — `{account_label}` has not completed a scan "
        f"in over {hours_overdue}h. Evidence collection has a gap until the next "
        "successful scan."
    )
    try:
        resp = httpx.post(slack_url, json={"text": text}, timeout=10)
        resp.raise_for_status()
        return True
    except Exception as e:  # noqa: BLE001
        log.error("stale_scan_alert.slack_failed", error=str(e))
        return False


def notify_stale_scans(db: Session) -> int:
    """Alert once per stale episode for every connected, schedule-enabled
    account whose last scan exceeds interval + grace. Returns alerts sent."""
    from datetime import datetime, timedelta, timezone

    from sqlalchemy.orm.attributes import flag_modified

    now = datetime.now(timezone.utc)
    sent_count = 0
    accounts = db.scalars(
        select(AwsAccount).where(AwsAccount.status == "connected")
    ).all()
    for acc in accounts:
        org = db.get(Org, acc.org_id)
        if not org:
            continue
        hours = _expected_interval_hours(org.settings)
        if hours is None or not acc.last_scan_at:
            continue
        last = acc.last_scan_at
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        deadline = last + timedelta(hours=hours + _STALE_GRACE_HOURS)

        notifications = (org.settings or {}).setdefault("notifications", {})
        markers = notifications.setdefault("stale_scan_alerted", {})
        key = str(acc.id)

        if now <= deadline:
            if key in markers:
                del markers[key]
                flag_modified(org, "settings")
                db.commit()
            continue

        prev = markers.get(key)
        if prev:
            try:
                prev_dt = datetime.fromisoformat(prev)
            except ValueError:
                prev_dt = None
            if prev_dt and now - prev_dt < timedelta(hours=_STALE_REALERT_HOURS):
                continue

        hours_overdue = int((now - last).total_seconds() // 3600)
        last_label = last.strftime("%Y-%m-%d %H:%M UTC")
        sent = False
        slack_url = notifications.get("slack_webhook_url")
        if slack_url:
            sent = _post_stale_scan_slack(slack_url, acc.label, hours_overdue) or sent
        recipient = resolve_alert_recipient(org, db)
        if recipient:
            sent = send_stale_scan_email(
                to=recipient, org_name=org.name, account_label=acc.label,
                account_id=acc.account_id, hours_overdue=hours_overdue,
                last_scan_label=last_label,
            ) or sent
        if sent:
            markers[key] = now.isoformat()
            flag_modified(org, "settings")
            db.commit()
            sent_count += 1
            log.info("stale_scan_alert.sent", account_id=key, hours_overdue=hours_overdue)
    return sent_count
