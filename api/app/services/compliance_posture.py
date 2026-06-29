"""Shared compliance posture score — pass rate among evaluated controls only."""

from __future__ import annotations


def posture_score(*, passed: int, failed: int) -> int | None:
    """Percent of controls passing among those with pass/fail status (excludes no_data)."""
    scored = passed + failed
    if scored == 0:
        return None
    return round(100 * passed / scored)


def posture_score_from_counts(counts: dict[str, int]) -> int | None:
    return posture_score(
        passed=counts["controls_passed"],
        failed=counts["controls_failed"],
    )
