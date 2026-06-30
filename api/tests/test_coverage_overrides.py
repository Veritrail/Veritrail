from app.services.coverage_overrides import get_coverage_overrides, merge_coverage_overrides


def test_get_coverage_overrides_filters_invalid():
    settings = {
        "coverage_overrides": {
            "vulnerability_management": "out_of_scope",
            "logging_monitoring": "invalid",
            "backup_resilience": {"status": "not_applicable"},
        }
    }
    assert get_coverage_overrides(settings) == {
        "vulnerability_management": "out_of_scope",
        "backup_resilience": "not_applicable",
    }


def test_merge_coverage_overrides_adds_and_clears():
    stored = {"coverage_overrides": {"vulnerability_management": "out_of_scope"}}
    merged = merge_coverage_overrides(stored, {"logging_monitoring": "not_applicable", "vulnerability_management": None})
    assert set(merged.keys()) == {"logging_monitoring"}
    assert merged["logging_monitoring"]["status"] == "not_applicable"
    assert merged["logging_monitoring"]["set_at"] is not None
    assert get_coverage_overrides({"coverage_overrides": merged}) == {
        "logging_monitoring": "not_applicable",
    }
