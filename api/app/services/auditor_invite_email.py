"""Email auditor invite links."""
from __future__ import annotations

from datetime import datetime

from app.core.html_email import html_email as h
from app.services.mail import send_mail


def send_auditor_invite_email(
    *,
    to: str,
    org_name: str,
    auditor_name: str | None,
    verify_url: str,
    expires_at: datetime,
) -> tuple[bool, str | None]:
    greeting = auditor_name or "there"
    expiry_label = expires_at.strftime("%B %d, %Y")
    subject = f"{org_name} invited you to Vigil auditor access"

    text = (
        f"Hi {greeting},\n\n"
        f"{org_name} invited you to review compliance evidence in Vigil.\n\n"
        f"Open this link to start your read-only auditor session:\n{verify_url}\n\n"
        f"Access expires on {expiry_label}.\n\n"
        "If you did not expect this invite, you can ignore this email."
    )

    html = f"""
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#18181b;max-width:560px">
      <h2 style="margin:0 0 12px;font-size:18px">You're invited to Vigil</h2>
      <p style="margin:0 0 16px;color:#52525b">
        <strong>{h(org_name)}</strong> invited you to review compliance evidence with read-only auditor access.
      </p>
      <p style="margin:0 0 20px">
        <a href="{h(verify_url)}" style="display:inline-block;background:#0ea5e9;color:#fff;text-decoration:none;
        padding:10px 18px;border-radius:8px;font-weight:600">Open auditor portal</a>
      </p>
      <p style="margin:0 0 8px;color:#71717a;font-size:13px">Or copy this link:</p>
      <p style="margin:0 0 16px;font-size:12px;word-break:break-all;color:#3f3f46">{h(verify_url)}</p>
      <p style="margin:0;color:#71717a;font-size:13px">Access expires on {expiry_label}.</p>
    </div>
    """

    return send_mail(to=to, subject=subject, text=text, html=html)
