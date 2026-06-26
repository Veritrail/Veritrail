"""Org-level composite coverage overrides (out of scope / not applicable)."""
from __future__ import annotations

from typing import Any

COVERAGE_OVERRIDE_STATUSES = frozenset({"out_of_scope", "not_applicable"})


def get_coverage_overrides(settings: dict[str, Any] | None) -> dict[str, str]:
    raw = (settings or {}).get("coverage_overrides") or {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for composite_id, value in raw.items():
        if isinstance(value, str) and value in COVERAGE_OVERRIDE_STATUSES:
            out[str(composite_id)] = value
        elif isinstance(value, dict):
            status = value.get("status")
            if status in COVERAGE_OVERRIDE_STATUSES:
                out[str(composite_id)] = status
    return out


def merge_coverage_overrides(
    stored: dict[str, Any] | None,
    patches: dict[str, str | None],
) -> dict[str, Any]:
    current = dict((stored or {}).get("coverage_overrides") or {})
    for composite_id, status in patches.items():
        if status is None or status == "":
            current.pop(composite_id, None)
        elif status in COVERAGE_OVERRIDE_STATUSES:
            current[composite_id] = status
    return current
