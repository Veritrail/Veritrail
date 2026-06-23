"""TOTP helpers for user MFA."""
from __future__ import annotations

import base64
import io

import pyotp

_ISSUER = "Veritrail"


def new_secret() -> str:
    return pyotp.random_base32()


def provisioning_uri(email: str, secret: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=_ISSUER)


def verify_totp(secret: str, code: str) -> bool:
    if not secret or not code:
        return False
    normalized = code.strip().replace(" ", "")
    if not normalized.isdigit() or len(normalized) != 6:
        return False
    return pyotp.TOTP(secret).verify(normalized, valid_window=1)


def qr_png_data_url(provisioning_uri: str) -> str | None:
    try:
        import qrcode
    except ImportError:
        return None
    img = qrcode.make(provisioning_uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    encoded = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{encoded}"
