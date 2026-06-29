"""Shared compliance posture score — pass rate across the full control set."""

from __future__ import annotations


def posture_score(*, passed: int, total: int) -> int | None:
    """Percent of controls passing out of all applicable controls."""
    if total == 0:
        return None
    return round(100 * passed / total)


def posture_score_from_counts(counts: dict[str, int]) -> int | None:
    return posture_score(
        passed=counts["controls_passed"],
        total=counts["controls_total"],
    )
