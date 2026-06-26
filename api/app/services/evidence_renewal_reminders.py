"""Email reminders for expiring or stale external evidence."""
from __future__ import annotations

import uuid
from datetime import date, timedelta
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.html_email import html_email as h
from app.models.evidence_artifact import EvidenceArtifact
from app.models.org import Org, User
from app.services.mail import send_mail
from app.services.scan_alert import resolve_alert_recipient

log = structlog.get_logger()

REMINDER_WINDOW_DAYS = 30


def _artifact_needs_reminder(row: EvidenceArtifact, today: date, horizon: date) -> str | None:
    if row.status not in ("accepted", "submitted"):
        return None
    for field_name, field in (("expires_at", row.expires_at), ("period_end", row.period_end)):
        if not field:
            continue
        if field < today:
            return f"stale ({field_name.replace('_', ' ')})"
        if field <= horizon:
            return f"expiring ({field_name.replace('_', ' ')})"
    return None


def collect_renewal_items(db: Session, *, org_id: uuid.UUID) -> list[dict[str, Any]]:
    today = date.today()
    horizon = today + timedelta(days=REMINDER_WINDOW_DAYS)
    rows = db.scalars(
        select(EvidenceArtifact).where(
            EvidenceArtifact.org_id == org_id,
            EvidenceArtifact.status.in_(("accepted", "submitted")),
        )
    ).all()
    items: list[dict[str, Any]] = []
    for row in rows:
        reason = _artifact_needs_reminder(row, today, horizon)
        if not reason:
            continue
        items.append(
            {
                "id": str(row.id),
                "title": row.title,
                "status": row.status,
                "composite_control_id": row.composite_control_id,
                "control_ref": row.control_ref,
                "expires_at": row.expires_at.isoformat() if row.expires_at else None,
                "period_end": row.period_end.isoformat() if row.period_end else None,
                "reason": reason,
            }
        )
    return items


def renewal_recipient_emails(db: Session, org_id: uuid.UUID) -> list[str]:
    rows = db.scalars(
        select(User.email)
        .where(User.org_id == org_id)
        .where(User.email.is_not(None))
        .where(User.role.in_(("admin", "editor")))
        .order_by(User.created_at.asc())
    ).all()
    seen: set[str] = set()
    out: list[str] = []
    for email in rows:
        if email and email not in seen:
            seen.add(email)
            out.append(email)
    return out


def send_evidence_renewal_email(*, to: str, org_name: str, items: list[dict[str, Any]]) -> bool:
    count = len(items)
    subject = f"Veritrail: {count} evidence item{'s' if count != 1 else ''} need renewal"
    lines = []
    for item in items[:25]:
        scope = item.get("composite_control_id") or item.get("control_ref") or "unscoped"
        lines.append(f"- {item['title']} ({scope}) — {item['reason']}")
    if count > 25:
        lines.append(f"... and {count - 25} more")
    text = (
        f"{count} external evidence item(s) at {org_name} are expiring soon or already stale.\n\n"
        + "\n".join(lines)
        + "\n\nOpen Veritrail → Compliance Groups to upload refreshed evidence."
    )
    rows_html = "".join(
        f"<tr><td style='padding:6px 0'>{h(item['title'])}</td>"
        f"<td style='padding:6px 0;color:#71717a'>{h(item.get('reason') or '')}</td></tr>"
        for item in items[:25]
    )
    html = f"""
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#18181b;max-width:560px">
      <h2 style="margin:0 0 12px;font-size:18px">Evidence renewal reminder</h2>
      <p style="margin:0 0 16px;color:#52525b">
        <strong>{count}</strong> external evidence item(s) at <strong>{h(org_name)}</strong>
        expire within {REMINDER_WINDOW_DAYS} days or are already stale.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">{rows_html}</table>
      <p style="margin:16px 0 0;color:#71717a;font-size:13px">
        Open Veritrail → Compliance Groups to upload refreshed evidence.
      </p>
    </div>
    """
    sent, err = send_mail(to=to, subject=subject, text=text, html=html)
    if not sent:
        log.error("evidence_renewal_reminder.failed", to=to, error=err)
    return sent


def notify_org_evidence_renewals(db: Session, org_id: uuid.UUID) -> bool:
    org = db.get(Org, org_id)
    if not org:
        return False

    notifications = (org.settings or {}).get("notifications") or {}
    if notifications.get("evidence_renewal_email_enabled", True) is False:
        return False

    items = collect_renewal_items(db, org_id=org_id)
    if not items:
        return False

    recipients = renewal_recipient_emails(db, org_id)
    if not recipients:
        fallback = resolve_alert_recipient(org, db)
        if fallback:
            recipients = [fallback]

    sent_any = False
    for email in recipients:
        if send_evidence_renewal_email(to=email, org_name=org.name, items=items):
            sent_any = True
    return sent_any


def notify_all_orgs_evidence_renewals(db: Session) -> dict[str, int]:
    orgs = db.scalars(select(Org)).all()
    sent = 0
    skipped = 0
    for org in orgs:
        if notify_org_evidence_renewals(db, org.id):
            sent += 1
        else:
            skipped += 1
    return {"sent": sent, "skipped": skipped}
