"""Email password-reset links via Resend."""
from __future__ import annotations

import httpx
import structlog

from app.core.config import get_settings
from app.core.html_email import html_email as h

log = structlog.get_logger()
settings = get_settings()


def send_password_reset_email(*, to: str, reset_url: str) -> bool:
    if not settings.RESEND_API_KEY:
        log.info("password_reset.skipped", reason="RESEND_API_KEY not set", to=to)
        return False

    subject = "Reset your Vigil password"
    text = (
        "Hi,\n\n"
        "We received a request to reset your Vigil password.\n\n"
        f"Open this link to choose a new password:\n{reset_url}\n\n"
        "This link expires in 30 minutes. If you did not request this you can ignore "
        "this email — your password will not change."
    )
    html = f"""
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#18181b;max-width:560px">
      <h2 style="margin:0 0 12px;font-size:18px">Reset your password</h2>
      <p style="margin:0 0 16px;color:#52525b">We received a request to reset your Vigil password.</p>
      <p style="margin:0 0 20px">
        <a href="{h(reset_url)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
        padding:10px 18px;border-radius:8px;font-weight:600">Choose a new password</a>
      </p>
      <p style="margin:0 0 8px;color:#71717a;font-size:13px">Or copy this link:</p>
      <p style="margin:0 0 16px;font-size:12px;word-break:break-all;color:#3f3f46">{h(reset_url)}</p>
      <p style="margin:0;color:#71717a;font-size:13px">This link expires in 30 minutes. If you didn't request it, ignore this email.</p>
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
                "text": text,
                "html": html,
            },
            timeout=10,
        )
        resp.raise_for_status()
        return True
    except Exception as e:  # noqa: BLE001 — email failure must not break the request
        log.warning("password_reset.send_failed", to=to, error=str(e))
        return False
