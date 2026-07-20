"""Shared, email-client-safe Veritrail presentation helpers."""
from __future__ import annotations

from html import escape


def render_email(
    *,
    title: str,
    body_html: str,
    eyebrow: str | None = None,
    preheader: str | None = None,
    cta_label: str | None = None,
    cta_url: str | None = None,
    after_cta_html: str = "",
    footer_html: str = "",
) -> str:
    """Render a restrained transactional-email shell.

    Dynamic values inside ``body_html``/footer fragments must be escaped by the
    caller. Title, eyebrow, preheader, and CTA values are escaped here.
    """
    safe_title = escape(title, quote=True)
    safe_eyebrow = escape(eyebrow, quote=True) if eyebrow else ""
    hidden_preheader = escape(preheader or title, quote=True)
    eyebrow_html = (
        f'<div style="margin:0 0 8px;color:#0f766e;font-size:11px;font-weight:700;'
        f'letter-spacing:.08em;text-transform:uppercase">{safe_eyebrow}</div>'
        if eyebrow
        else ""
    )
    cta_html = ""
    if cta_label and cta_url:
        cta_html = f"""
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0">
          <tr><td bgcolor="#0f766e" style="border-radius:7px">
            <a href="{escape(cta_url, quote=True)}" style="display:inline-block;padding:12px 18px;
              color:#ffffff;font-size:14px;font-weight:700;line-height:1;text-decoration:none">
              {escape(cta_label, quote=True)}
            </a>
          </td></tr>
        </table>"""

    footer = footer_html or (
        "This message was sent by Veritrail because it relates to your workspace, "
        "account, or notification settings."
    )
    return f"""<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f8;color:#172033">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">{hidden_preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
        <tr><td style="padding:0 4px 16px">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;padding-right:10px">
              <img src="cid:veritrail-mark" width="34" height="34" alt=""
                style="display:block;width:34px;height:34px;border:0;border-radius:8px">
            </td>
            <td style="vertical-align:middle;color:#172033;font-family:Arial,Helvetica,sans-serif;
              font-size:18px;font-weight:700;letter-spacing:-.01em">Veritrail</td>
          </tr></table>
        </td></tr>
        <tr><td style="background:#ffffff;border:1px solid #dfe4ea;border-radius:10px;padding:32px;
          font-family:Arial,Helvetica,sans-serif">
          {eyebrow_html}
          <h1 style="margin:0 0 16px;color:#172033;font-size:22px;font-weight:700;line-height:1.3;
            letter-spacing:-.015em">{safe_title}</h1>
          <div style="color:#4b586e;font-size:14px;line-height:1.6">{body_html}</div>
          {cta_html}
          {after_cta_html}
        </td></tr>
        <tr><td style="padding:18px 18px 0;text-align:center;color:#8a94a6;
          font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.55">
          {footer}
          <div style="margin-top:6px">Veritrail · Continuous technical evidence</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def render_plain_text_email(*, title: str, text: str) -> str:
    """Give legacy/internal plaintext notifications the same branded shell."""
    body = escape(text, quote=True).replace("\n", "<br>")
    return render_email(title=title, body_html=body, preheader=text.splitlines()[0] if text else title)


def fallback_link(url: str, *, label: str = "If the button does not work, copy this link:") -> str:
    safe_url = escape(url, quote=True)
    return (
        f'<div style="margin-top:22px;padding-top:18px;border-top:1px solid #edf0f3;'
        f'color:#7a8495;font-size:12px;line-height:1.5">{escape(label)}<br>'
        f'<a href="{safe_url}" style="color:#506079;word-break:break-all">{safe_url}</a></div>'
    )


def detail_rows(rows: list[tuple[str, str]]) -> str:
    rendered = "".join(
        '<tr>'
        f'<td style="padding:8px 14px 8px 0;color:#7a8495;vertical-align:top;white-space:nowrap">{escape(label)}</td>'
        f'<td style="padding:8px 0;color:#273247;vertical-align:top">{value}</td>'
        '</tr>'
        for label, value in rows
    )
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">{rendered}</table>'
