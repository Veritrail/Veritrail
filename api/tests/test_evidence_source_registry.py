from app.services.evidence_source_registry import (
    category_for_composite,
    evidence_sources_for_export,
    get_evidence_sources,
    merge_evidence_sources,
)


def test_category_for_composite_maps_vuln_groups():
    assert category_for_composite("vulnerability_management") == "vulnerability_management"
    assert category_for_composite("container_vulnerability_monitoring") == "vulnerability_management"
    assert category_for_composite("identity_governance") == "identity_access"
    assert category_for_composite("endpoint_security") == "endpoint_security"


def test_merge_evidence_sources_round_trip():
    stored = {}
    merged = merge_evidence_sources(
        stored,
        {
            "vulnerability_management": {
                "vendor": "Wiz",
                "cadence": "Weekly",
                "scope_description": "Production AWS + containers",
            }
        },
        user_id="user-1",
    )
    assert merged["vulnerability_management"]["vendor"] == "Wiz"
    assert merged["vulnerability_management"]["updated_by_user_id"] == "user-1"

    cleared = merge_evidence_sources({"evidence_sources": merged}, {"vulnerability_management": {"vendor": ""}})
    assert "vulnerability_management" not in cleared


def test_evidence_sources_for_export_shape():
    payload = evidence_sources_for_export(
        {
            "evidence_sources": {
                "change_management": {"vendor": "GitHub + Jira", "updated_at": "2026-06-01"},
            }
        }
    )
    assert payload["configured_count"] == 1
    assert any(c["key"] == "change_management" and c["entry"]["vendor"] == "GitHub + Jira" for c in payload["categories"])

    assert get_evidence_sources({"evidence_sources": {"change_management": {"vendor": "GitHub"}}})["change_management"]["vendor"] == "GitHub"
