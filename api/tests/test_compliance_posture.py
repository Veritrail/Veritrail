"""Tests for shared compliance posture score calculation."""
from app.services.compliance_posture import posture_score, posture_score_from_counts


def test_posture_score_uses_total_controls():
    assert posture_score(passed=1, total=2) == 50
    assert posture_score(passed=1, total=10) == 10
    assert posture_score(passed=0, total=1) == 0


def test_posture_score_none_when_nothing_evaluated():
    assert posture_score(passed=0, total=0) is None


def test_posture_score_from_counts_matches_timeline_shape():
    counts = {
        "controls_passed": 1,
        "controls_failed": 32,
        "controls_no_data": 100,
        "controls_total": 133,
    }
    assert posture_score_from_counts(counts) == 1

    all_no_data = {
        "controls_passed": 0,
        "controls_failed": 0,
        "controls_no_data": 50,
        "controls_total": 50,
    }
    assert posture_score_from_counts(all_no_data) == 0
