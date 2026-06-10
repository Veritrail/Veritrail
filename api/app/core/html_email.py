"""Escape dynamic values before embedding in HTML email bodies."""
from __future__ import annotations

from html import escape


def html_email(value: object) -> str:
    """Turn user/data text into safe HTML (e.g. `<` → `&lt;`)."""
    if value is None:
        return ""
    return escape(str(value), quote=True)
