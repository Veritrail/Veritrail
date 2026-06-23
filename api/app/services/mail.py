"""Outbound email via SMTP (stdlib)."""
from __future__ import annotations

import smtplib
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import structlog

from app.core.config import get_settings

log = structlog.get_logger()


def mail_configured() -> bool:
    s = get_settings()
    return bool(s.SMTP_HOST.strip() and s.SMTP_USER.strip() and s.SMTP_PASSWORD.strip())


def mail_from_address() -> str:
    s = get_settings()
    return (s.MAIL_FROM or s.SMTP_USER or s.DIGEST_FROM or "").strip()


def send_mail(
    *,
    to: str,
    subject: str,
    text: str,
    html: str | None = None,
    inline_images: dict[str, bytes] | None = None,
) -> tuple[bool, str | None]:
    """Send one email. Returns (sent, error_note_for_ui).

    inline_images maps a Content-ID (referenced in the HTML as ``cid:<id>``) to
    PNG bytes; when present the message is wrapped as multipart/related so the
    images embed without external hosting.
    """
    s = get_settings()
    if not mail_configured():
        return False, "Set SMTP_HOST, SMTP_USER, and SMTP_PASSWORD in .env and restart the API."

    from_addr = mail_from_address()
    if not from_addr:
        return False, "Set MAIL_FROM or SMTP_USER in .env."

    alternative = MIMEMultipart("alternative")
    alternative.attach(MIMEText(text, "plain", "utf-8"))
    if html:
        alternative.attach(MIMEText(html, "html", "utf-8"))

    if inline_images:
        msg = MIMEMultipart("related")
        msg.attach(alternative)
        for cid, data in inline_images.items():
            img = MIMEImage(data, _subtype="png")
            img.add_header("Content-ID", f"<{cid}>")
            img.add_header("Content-Disposition", "inline", filename=f"{cid}.png")
            msg.attach(img)
    else:
        msg = alternative

    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to

    try:
        with smtplib.SMTP(s.SMTP_HOST, s.SMTP_PORT, timeout=20) as server:
            if s.SMTP_USE_TLS:
                server.starttls()
            server.login(s.SMTP_USER, s.SMTP_PASSWORD)
            server.sendmail(from_addr, [to], msg.as_string())
        log.info("mail.sent", to=to, subject=subject)
        return True, None
    except smtplib.SMTPAuthenticationError:
        log.error("mail.auth_failed", to=to)
        return False, "SMTP login failed — check SMTP_USER and SMTP_PASSWORD (use a Gmail app password)."
    except Exception as e:  # noqa: BLE001
        log.error("mail.failed", to=to, error=str(e))
        note = str(e)
        if len(note) > 200:
            note = note[:197] + "…"
        return False, f"Email could not be sent: {note}"
