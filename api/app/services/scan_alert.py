"""Email alert when an AWS account scan fails."""
from __future__ import annotations

import uuid

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import AwsAccount, Finding, FindingEvent, ScanRun
from app.models.org import Org, User

log = structlog.get_logger()
settings = get_settings()


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
    if not settings.RESEND_API_KEY:
        log.info("scan_alert.skipped", reason="RESEND_API_KEY not set", to=to)
        return False

    subject = f"Vigil: Scan failed — {account_label}"
    acct = f" ({account_id})" if account_id else ""
    text = (
        f"A Vigil scan failed for {account_label}{acct}.\n\n"
        f"Organization: {org_name}\n"
        f"Step: {failed_step or 'unknown'}\n"
        f"Error: {error_type or 'Error'}\n\n"
        f"{error_summary}\n\n"
        "Open Vigil → Accounts to verify your IAM role and trigger a re-scan."
    )
    html = f"""
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#18181b;max-width:560px">
      <h2 style="margin:0 0 12px;font-size:18px">Scan failed</h2>
      <p style="margin:0 0 16px;color:#52525b">
        A Vigil scan failed for <strong>{account_label}</strong>{acct}.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 0;color:#71717a;width:100px">Step</td><td>{failed_step or "unknown"}</td></tr>
        <tr><td style="padding:6px 0;color:#71717a">Error</td><td>{error_type or "Error"}</td></tr>
      </table>
      <pre style="margin:16px 0;padding:12px;background:#fafafa;border:1px solid #e4e4e7;border-radius:8px;font-size:12px;white-space:pre-wrap;word-break:break-word">{error_summary[:800]}</pre>
      <p style="margin:0;color:#71717a;font-size:13px">Open Vigil → Accounts to verify your IAM role and trigger a re-scan.</p>
    </div>
    """

    try:
        resp = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
            json={
                "from": settings.DIGEST_FROM,
                "to": [to],
                "subject": subject,
                "html": html,
                "text": text,
            },
            timeout=10,
        )
        resp.raise_for_status()
        log.info("scan_alert.sent", to=to, account=account_label)
        return True
    except Exception as e:  # noqa: BLE001
        log.error("scan_alert.failed", to=to, error=str(e))
        return False


def notify_scan_failure(db: Session, account_id: uuid.UUID, scan_run_id: uuid.UUID) -> bool:
    acc = db.get(AwsAccount, account_id)
    run = db.get(ScanRun, scan_run_id)
    if not acc or not run or run.status != "error":
        return False

    org = db.get(Org, acc.org_id)
    if not org:
        return False

    notifications = (org.settings or {}).get("notifications") or {}
    if not notifications.get("scan_failure_email_enabled", True):
        return False

    recipient = resolve_alert_recipient(org, db)
    if not recipient:
        log.info("scan_alert.skipped", reason="no recipient", org_id=str(org.id))
        return False

    stats = run.stats or {}
    error_line = (run.error or "Unknown error").split("\n", 1)[0]
    return send_scan_failure_email(
        to=recipient,
        org_name=org.name,
        account_label=acc.label,
        account_id=acc.account_id,
        failed_step=stats.get("failed_at"),
        error_type=stats.get("error_type"),
        error_summary=error_line,
    )


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
        f":rotating_light: *Vigil — {len(items)} new critical/high finding{plural}* "
        f"in {account_label}\n" + "\n".join(lines) + f"\n<{app_url}|Review in Vigil>"
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
    if not settings.RESEND_API_KEY:
        log.info("new_findings_alert.skipped", reason="RESEND_API_KEY not set", to=to)
        return False

    n = len(items)
    plural = "s" if n != 1 else ""
    acct = f" ({account_id})" if account_id else ""
    shown = items[:12]
    rows = "".join(
        f'<tr><td style="padding:4px 8px 4px 0;color:#b91c1c;font-weight:600;'
        f'white-space:nowrap;vertical-align:top">{sev.upper()}</td>'
        f'<td style="padding:4px 0">{title}</td></tr>'
        for sev, title in shown
    )
    more = (
        f'<p style="margin:8px 0 0;color:#71717a;font-size:13px">…and {n - len(shown)} more.</p>'
        if n > len(shown)
        else ""
    )
    subject = f"Vigil: {n} new critical/high finding{plural} — {account_label}"
    text = (
        f"{n} new critical/high finding{plural} in {account_label}{acct} ({org_name}).\n\n"
        + "\n".join(f"[{sev.upper()}] {title}" for sev, title in shown)
        + (f"\n…and {n - len(shown)} more." if n > len(shown) else "")
        + f"\n\nReview: {app_url}"
    )
    html = f"""
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#18181b;max-width:560px">
      <h2 style="margin:0 0 12px;font-size:18px">{n} new critical/high finding{plural}</h2>
      <p style="margin:0 0 16px;color:#52525b">Account <strong>{account_label}</strong>{acct}.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">{rows}</table>
      {more}
      <p style="margin:16px 0 0"><a href="{app_url}" style="color:#4f46e5;font-weight:600">Review in Vigil →</a></p>
    </div>
    """
    try:
        resp = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
            json={
                "from": settings.DIGEST_FROM,
                "to": [to],
                "subject": subject,
                "html": html,
                "text": text,
            },
            timeout=10,
        )
        resp.raise_for_status()
        log.info("new_findings_alert.email_sent", to=to, account=account_label, count=n)
        return True
    except Exception as e:  # noqa: BLE001
        log.error("new_findings_alert.email_failed", to=to, error=str(e))
        return False


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
    if slack_url:
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
