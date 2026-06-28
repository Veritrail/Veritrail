"""Org-level composite coverage overrides (out of scope / not applicable)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

COVERAGE_OVERRIDE_STATUSES = frozenset({"out_of_scope", "not_applicable"})


def get_coverage_overrides(settings: dict[str, Any] | None) -> dict[str, str]:
    """Flattened status-only view, used by scoring/coverage."""
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


def get_coverage_override_details(
    settings: dict[str, Any] | None,
) -> dict[str, dict[str, Any]]:
    """Full override records keyed by composite id (status + audit metadata)."""
    raw = (settings or {}).get("coverage_overrides") or {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for composite_id, value in raw.items():
        if isinstance(value, str) and value in COVERAGE_OVERRIDE_STATUSES:
            out[str(composite_id)] = {
                "status": value,
                "reason": None,
                "set_by": None,
                "set_at": None,
            }
        elif isinstance(value, dict):
            status = value.get("status")
            if status in COVERAGE_OVERRIDE_STATUSES:
                out[str(composite_id)] = {
                    "status": status,
                    "reason": value.get("reason") or None,
                    "set_by": value.get("set_by") or None,
                    "set_at": value.get("set_at") or None,
                }
    return out


def merge_coverage_overrides(
    stored: dict[str, Any] | None,
    patches: dict[str, Any],
    *,
    actor: str | None = None,
) -> dict[str, Any]:
    """Apply override patches. Each patch is a bare status string, ``None`` to
    clear, or a ``{"status", "reason"}`` dict. Stored entries are normalized to
    the dict form so we keep an audit trail (who set it, when, and why)."""
    current = dict((stored or {}).get("coverage_overrides") or {})
    now = datetime.now(timezone.utc).isoformat()
    for composite_id, patch in patches.items():
        if isinstance(patch, dict):
            status = patch.get("status")
            reason = patch.get("reason")
        else:
            status = patch
            reason = None
        if status is None or status == "":
            current.pop(composite_id, None)
        elif status in COVERAGE_OVERRIDE_STATUSES:
            current[composite_id] = {
                "status": status,
                "reason": (reason or None),
                "set_by": actor,
                "set_at": now,
            }
    return current
