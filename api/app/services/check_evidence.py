"""Canonical evidence classification for checks (product + exports)."""
from __future__ import annotations

from functools import lru_cache

from app.checks.optional_checks import OPTIONAL_CHECK_IDS
from app.services.check_coverage import TIER_EXTENDED, tier_for_check
from app.services.check_frameworks import check_framework_map

CLASS_BENCHMARK = "benchmark"
CLASS_SUPPORTING = "supporting"
CLASS_HYGIENE = "hygiene"
CLASS_ACTIVITY = "activity"

CLASS_LABELS: dict[str, str] = {
    CLASS_BENCHMARK: "Required benchmark mapping",
    CLASS_SUPPORTING: "Supporting evidence",
    CLASS_HYGIENE: "Hygiene only",
    CLASS_ACTIVITY: "Activity detection",
}

# Mapped to frameworks but too indirect to fail SOC 2 / ISO controls by default.
_SUPPORTING_ONLY_CHECKS = frozenset({
    "iam.policy.wildcard_resource",
    "s3.bucket.no_mfa_delete",
})


def evidence_class_for_check(check_id: str) -> str:
    if check_id.startswith("cloudtrail.event."):
        return CLASS_ACTIVITY
    if check_id in OPTIONAL_CHECK_IDS:
        return CLASS_HYGIENE
    if check_id in _SUPPORTING_ONLY_CHECKS:
        return CLASS_SUPPORTING
    if tier_for_check(check_id) == TIER_EXTENDED:
        return CLASS_SUPPORTING
    if check_id in check_framework_map():
        return CLASS_BENCHMARK
    return CLASS_HYGIENE


@lru_cache(maxsize=1)
def all_evidence_classes() -> dict[str, str]:
    ids = set(check_framework_map()) | OPTIONAL_CHECK_IDS
    from app.checks.registry import ALL_CHECKS

    for mod in ALL_CHECKS:
        ids.add(mod.CHECK_ID)
    return {cid: evidence_class_for_check(cid) for cid in sorted(ids)}


def evidence_class_label(evidence_class: str) -> str:
    return CLASS_LABELS.get(evidence_class, evidence_class)
