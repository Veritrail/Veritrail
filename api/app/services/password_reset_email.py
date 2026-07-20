"""Email password-reset links."""
from __future__ import annotations

from app.services.email_template import fallback_link, render_email
from app.services.mail import send_mail


def send_password_reset_email(*, to: str, reset_url: str) -> bool:
    subject = "Reset your Veritrail password"
    text = (
        "Hi,\n\n"
        "We received a request to reset your Veritrail password.\n\n"
        f"Open this link to choose a new password:\n{reset_url}\n\n"
        "This link expires in 30 minutes. If you did not request this you can ignore "
        "this email — your password will not change."
    )
    html = render_email(
        eyebrow="Account security",
        title="Reset your password",
        preheader="Choose a new Veritrail password. This link expires in 30 minutes.",
        body_html=(
            '<p style="margin:0">We received a request to reset your Veritrail password.</p>'
            '<p style="margin:14px 0 0">This secure link expires in <strong style="color:#273247">30 minutes</strong>. '
            "If you did not request a reset, you can safely ignore this email.</p>"
        ),
        cta_label="Choose a new password",
        cta_url=reset_url,
        after_cta_html=fallback_link(reset_url),
    )
    sent, _ = send_mail(to=to, subject=subject, text=text, html=html)
    return sent
