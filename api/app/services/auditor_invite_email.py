"""Email auditor invite links."""
from __future__ import annotations

from datetime import datetime

from app.core.html_email import html_email as h
from app.services.email_template import fallback_link, render_email
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
    subject = f"{org_name} invited you to Veritrail auditor access"

    text = (
        f"Hi {greeting},\n\n"
        f"{org_name} invited you to review compliance evidence in Veritrail.\n\n"
        f"Open this link to start your read-only auditor session:\n{verify_url}\n\n"
        f"Access expires on {expiry_label}.\n\n"
        "If you did not expect this invite, you can ignore this email."
    )

    html = render_email(
        eyebrow="Auditor access",
        title="Review compliance evidence",
        preheader=f"{org_name} invited you to a read-only auditor session.",
        body_html=(
            f'<p style="margin:0">Hi {h(greeting)},</p>'
            f'<p style="margin:14px 0 0"><strong style="color:#273247">{h(org_name)}</strong> invited you to review '
            "compliance evidence in a read-only Veritrail auditor session.</p>"
            f'<p style="margin:14px 0 0">Access expires on <strong style="color:#273247">{h(expiry_label)}</strong>. '
            "If you did not expect this invitation, you can ignore it.</p>"
        ),
        cta_label="Open auditor portal",
        cta_url=verify_url,
        after_cta_html=fallback_link(verify_url),
    )

    return send_mail(to=to, subject=subject, text=text, html=html)
