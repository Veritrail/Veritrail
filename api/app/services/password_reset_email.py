"""Email password-reset links."""
from __future__ import annotations

from app.core.html_email import html_email as h
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
    html = f"""
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#18181b;max-width:560px">
      <h2 style="margin:0 0 12px;font-size:18px">Reset your password</h2>
      <p style="margin:0 0 16px;color:#52525b">We received a request to reset your Veritrail password.</p>
      <p style="margin:0 0 20px">
        <a href="{h(reset_url)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
        padding:10px 18px;border-radius:8px;font-weight:600">Choose a new password</a>
      </p>
      <p style="margin:0 0 8px;color:#71717a;font-size:13px">Or copy this link:</p>
      <p style="margin:0 0 16px;font-size:12px;word-break:break-all;color:#3f3f46">{h(reset_url)}</p>
      <p style="margin:0;color:#71717a;font-size:13px">This link expires in 30 minutes. If you didn't request it, ignore this email.</p>
    </div>
    """
    sent, _ = send_mail(to=to, subject=subject, text=text, html=html)
    return sent
