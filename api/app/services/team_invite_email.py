"""Email workspace team invite links."""
from __future__ import annotations

from datetime import datetime

from app.core.html_email import html_email as h
from app.services.email_template import fallback_link, render_email
from app.services.mail import send_mail


def send_team_invite_email(
    *,
    to: str,
    org_name: str,
    role: str,
    invite_url: str,
    expires_at: datetime | None,
) -> bool:
    expiry = expires_at.strftime("%b %d, %Y") if expires_at else None
    expiry_line = f"This link expires {expiry}." if expiry else "This link does not expire."
    subject = f"You're invited to {org_name} on Veritrail"
    text = (
        f"You've been invited to join {org_name} on Veritrail as {role}.\n\n"
        f"Accept invite: {invite_url}\n\n"
        f"{expiry_line}"
    )
    html = render_email(
        eyebrow="Workspace invitation",
        title=f"Join {org_name} on Veritrail",
        preheader=f"You have been invited to {org_name} as {role}.",
        body_html=(
            f'<p style="margin:0">You have been invited to join <strong style="color:#273247">{h(org_name)}</strong> '
            f'as <strong style="color:#273247">{h(role)}</strong>.</p>'
            f'<p style="margin:14px 0 0">{h(expiry_line)} If you did not expect this invitation, you can ignore it.</p>'
        ),
        cta_label="Accept invitation",
        cta_url=invite_url,
        after_cta_html=fallback_link(invite_url),
    )
    sent, _ = send_mail(to=to, subject=subject, text=text, html=html)
    return sent
