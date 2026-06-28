"""Cross-account coverage: a control satisfied in another AWS account we do not
yet scan (e.g. delegated-admin GuardDuty, an org-level CloudTrail, a central
log-archive or backup account).

Attested for now — account id + reason + expiry + who/when. ``verified`` stays
False until that account is connected and scanned clean, at which point a
collector can flip it to True automatically. Distinct from coverage_overrides
(out of scope / not applicable, which *exclude* a control) — this one *satisfies*
the control with cross-account evidence.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

# A control gap is an "absence gap" when the underlying AWS capability is simply
# off. These mirror web/src/lib/evidenceGap.ts so cross-account verification
# checks the same capabilities the UI offers to cover.
ABSENCE_GAP_SUFFIXES = (".not_detected", ".not_enabled", ".missing")

# Mirrors CROSS_ACCOUNT_COVERABLE_CHECKS in web/src/lib/evidenceGap.ts: gaps a
# different account can satisfy that we can't auto-detect from this member
# (org CloudTrail / GuardDuty / Config / Security Hub are detected from the
# member, so a remaining gap there is genuine). IAM Access Analyzer's org
# analyzer is invisible from a member — the one cross-account case.
CROSS_ACCOUNT_COVERABLE_CHECKS = frozenset({"aws.access_analyzer.not_enabled"})


def absence_checks(check_ids: list[str]) -> list[str]:
    return [c for c in check_ids if c.endswith(ABSENCE_GAP_SUFFIXES)]


def cross_account_coverable_checks(check_ids: list[str]) -> list[str]:
    return [c for c in check_ids if c in CROSS_ACCOUNT_COVERABLE_CHECKS]


def _normalize(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    account_id = str(value.get("account_id") or "").strip()
    if not account_id:
        return None
    return {
        "account_id": account_id,
        "reason": value.get("reason") or None,
        "expires_at": value.get("expires_at") or None,
        "set_by": value.get("set_by") or None,
        "set_at": value.get("set_at") or None,
        "verified": bool(value.get("verified")),
    }


def get_cross_account_coverage(
    settings: dict[str, Any] | None,
) -> dict[str, dict[str, Any]]:
    raw = (settings or {}).get("cross_account_coverage") or {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for composite_id, value in raw.items():
        norm = _normalize(value)
        if norm:
            out[str(composite_id)] = norm
    return out


def merge_cross_account_coverage(
    stored: dict[str, Any] | None,
    patches: dict[str, Any],
    *,
    actor: str | None = None,
) -> dict[str, Any]:
    """Apply patches. Each patch is ``None`` (clear) or a dict with at least
    ``account_id``; stored entries always carry the audit metadata."""
    current = dict((stored or {}).get("cross_account_coverage") or {})
    now = datetime.now(timezone.utc).isoformat()
    for composite_id, patch in patches.items():
        if not isinstance(patch, dict):
            current.pop(composite_id, None)
            continue
        account_id = str(patch.get("account_id") or "").strip()
        if not account_id:
            current.pop(composite_id, None)
            continue
        current[composite_id] = {
            "account_id": account_id,
            "reason": (patch.get("reason") or None),
            "expires_at": (patch.get("expires_at") or None),
            "set_by": actor,
            "set_at": now,
            "verified": False,
        }
    return current
