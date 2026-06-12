"""Redact secrets in user-facing strings (access keys, etc.)."""
from __future__ import annotations

import re

_AWS_ACCESS_KEY_RE = re.compile(r"\b((?:AKIA|ASIA|AROA)[A-Z0-9]{16})\b")


def mask_access_key_id(key_id: str | None) -> str:
    key_id = (key_id or "").strip()
    if not key_id:
        return key_id
    if len(key_id) <= 8:
        return "••••"
    return f"{key_id[:4]}••••{key_id[-4:]}"


def mask_sensitive_text(text: str | None) -> str:
    if not text:
        return text or ""

    def _sub(match: re.Match[str]) -> str:
        return mask_access_key_id(match.group(1))

    return _AWS_ACCESS_KEY_RE.sub(_sub, text)
