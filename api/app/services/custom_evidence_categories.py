"""Org-defined custom evidence categories (max 5)."""
from __future__ import annotations

import re
from typing import Any

_MAX_CUSTOM = 5
_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{1,39}$")


def get_custom_evidence_categories(stored: dict | None) -> list[dict[str, str]]:
    raw = (stored or {}).get("custom_evidence_categories") or []
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for entry in raw[:_MAX_CUSTOM]:
        if not isinstance(entry, dict):
            continue
        key = (entry.get("key") or "").strip()
        label = (entry.get("label") or "").strip()
        if not key or not label or not _KEY_RE.match(key):
            continue
        out.append({"key": key, "label": label[:120]})
    return out


def merge_custom_evidence_categories(stored: dict | None, entries: list[dict[str, str]]) -> list[dict[str, str]]:
    cleaned: list[dict[str, str]] = []
    seen: set[str] = set()
    for entry in entries[:_MAX_CUSTOM]:
        key = (entry.get("key") or "").strip()
        label = (entry.get("label") or "").strip()
        if not key or not label or not _KEY_RE.match(key) or key in seen:
            continue
        seen.add(key)
        cleaned.append({"key": key, "label": label[:120]})
    return cleaned


def custom_category_defs(stored: dict | None) -> list[dict[str, str]]:
    return [
        {"key": c["key"], "label": c["label"], "composite_ids": []}
        for c in get_custom_evidence_categories(stored)
    ]
