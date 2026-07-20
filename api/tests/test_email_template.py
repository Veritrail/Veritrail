from email import message_from_string
from unittest.mock import MagicMock, patch

from app.services.email_template import fallback_link, render_email
from app.services.mail import send_mail


def test_render_email_uses_brand_shell_and_escapes_controls():
    html = render_email(
        eyebrow="Workspace <invite>",
        title="Join A&B",
        body_html="<p>Trusted body</p>",
        cta_label="Open & review",
        cta_url="https://example.com/path?a=1&b=2",
        after_cta_html=fallback_link("https://example.com/path?a=1&b=2"),
    )

    assert "cid:veritrail-mark" in html
    assert "Veritrail · Continuous technical evidence" in html
    assert "Workspace &lt;invite&gt;" in html
    assert "Join A&amp;B" in html
    assert "Open &amp; review" in html
    assert 'href="https://example.com/path?a=1&amp;b=2"' in html
    assert "<p>Trusted body</p>" in html


def test_send_mail_brands_plaintext_and_embeds_mark():
    settings = MagicMock(
        SMTP_HOST="smtp.example.com",
        SMTP_PORT=587,
        SMTP_USE_TLS=True,
        SMTP_USER="sender@example.com",
        SMTP_PASSWORD="secret",
        MAIL_FROM="hello@veritrail.io",
        DIGEST_FROM="",
    )
    smtp = MagicMock()
    smtp.__enter__.return_value = smtp

    with patch("app.services.mail.get_settings", return_value=settings), patch(
        "app.services.mail.smtplib.SMTP", return_value=smtp
    ):
        sent, error = send_mail(
            to="person@example.com",
            subject="A useful notification",
            text="First line\nSecond <line>",
        )

    assert sent is True
    assert error is None
    message = smtp.sendmail.call_args.args[2]
    assert 'Content-Type: multipart/related;' in message
    assert "Content-ID: <veritrail-mark>" in message
    parsed = message_from_string(message)
    html_part = next(part for part in parsed.walk() if part.get_content_type() == "text/html")
    rendered_html = html_part.get_payload(decode=True).decode(html_part.get_content_charset() or "utf-8")
    assert "cid:veritrail-mark" in rendered_html
    assert "Second &lt;line&gt;" in rendered_html
