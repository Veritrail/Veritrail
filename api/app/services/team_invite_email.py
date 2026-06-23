"""Email workspace team invite links."""
from __future__ import annotations

from datetime import datetime

from app.core.html_email import html_email as h
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
    html = f"""
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 12px;font-size:18px">Join {h(org_name)} on Veritrail</h2>
      <p style="margin:0 0 16px;color:#52525b">
        You've been invited as <strong>{h(role)}</strong>.
      </p>
      <p style="margin:0 0 20px">
        <a href="{h(invite_url)}" style="display:inline-block;background:#0ea5e9;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">
          Accept invite
        </a>
      </p>
      <p style="margin:0;font-size:12px;color:#71717a">{h(expiry_line)} If you didn't expect this, ignore this email.</p>
    </div>
    """
    sent, _ = send_mail(to=to, subject=subject, text=text, html=html)
    return sent
