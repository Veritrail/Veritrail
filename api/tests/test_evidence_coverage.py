import uuid
from datetime import date

from app.models.evidence_artifact import EvidenceArtifact
from app.services.category_evidence_coverage import _artifact_is_stale, _composite_display_status


def test_artifact_is_stale_when_period_end_passed():
    row = EvidenceArtifact(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        framework="soc2",
        title="t",
        status="accepted",
        period_end=date(2020, 1, 1),
        size_bytes=0,
    )
    assert _artifact_is_stale(row, date(2026, 1, 1)) is True


def test_composite_display_status_needs_evidence():
    composite = {
        "status": "fail",
        "check_ids": ["aws.vulnerability_monitoring.not_detected"],
        "check_tiers": {"aws.vulnerability_monitoring.not_detected": "core"},
    }
    open_gap = {"aws.vulnerability_monitoring.not_detected": [object()]}
    assert (
        _composite_display_status(composite, has_accepted=False, open_by_check=open_gap)
        == "needs_evidence"
    )
    assert (
        _composite_display_status(composite, has_accepted=True, open_by_check=open_gap)
        == "externally_covered"
    )


def test_composite_display_status_gap_mapped_without_open_finding_is_not_needs_evidence():
    composite = {
        "status": "fail",
        "check_ids": [
            "aws.vulnerability_monitoring.not_detected",
            "inspector.finding.critical",
        ],
        "check_tiers": {
            "aws.vulnerability_monitoring.not_detected": "core",
            "inspector.finding.critical": "core",
        },
    }
    open_other = {"inspector.finding.critical": [object()]}
    assert (
        _composite_display_status(composite, has_accepted=False, open_by_check=open_other)
        == "failing"
    )


def test_composite_display_status_passing():
    composite = {"status": "pass", "check_ids": [], "check_tiers": {}}
    assert _composite_display_status(composite, has_accepted=False, open_by_check={}) == "passing"
