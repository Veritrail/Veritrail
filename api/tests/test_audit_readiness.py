"""Tests for audit readiness narrative builder and API."""
from __future__ import annotations

import uuid

import pytest

from app.models import Org, User
from app.services.org_membership import add_membership
from app.services.audit_readiness import (
    _AUDITOR_TECHNICAL_PLAYBOOKS,
    _applicability_reason,
    _build_technical_playbooks,
    _technical_playbook_items,
    _without_inapplicable_checks,
    build_audit_readiness,
)
from app.services.pdf_narrative import affirmation_status, domain_section_as_dict
from tests.test_pdf_narrative import NOW, _control, _sections


def test_affirmation_status_markers():
    assert affirmation_status(checks_total=3, checks_passing=3) == "supported"
    assert affirmation_status(checks_total=3, checks_passing=1) == "partially_supported"
    assert affirmation_status(checks_total=3, checks_passing=0) == "not_affirmed"


def test_domain_section_as_dict_preserves_auditor_phrasing():
    controls = [
        _control("CC6.1", ["iam.user.no_mfa"]),
        _control(
            "CC7.2",
            ["cloudtrail.trail.not_enabled"],
            findings=[
                {
                    "id": "f1",
                    "check_id": "cloudtrail.trail.not_enabled",
                    "resource_arn": "arn:aws:cloudtrail:us-east-1:1:trail/t",
                    "title": "Trail off",
                    "severity": "high",
                    "status": "open",
                    "first_seen": NOW.isoformat(),
                    "last_seen": NOW.isoformat(),
                }
            ],
            status="fail",
        ),
    ]
    sections = _sections(controls)
    sec = next(s for s in sections if s.key == "identity_access")
    payload = domain_section_as_dict(sec, temporal_sentence="On 2026-Jul-01, 1 finding remediated.")
    assert payload["status"] == "supported"
    lowered = payload["assertion_text"].lower()
    for banned in ("fulfills", "is secure", "is compliant"):
        assert banned not in lowered
    for other in sections:
        other_lower = other.assertion.lower()
        for banned in ("fulfills", "is secure", "is compliant"):
            assert banned not in other_lower
    assert payload["temporal_sentence"] == "On 2026-Jul-01, 1 finding remediated."
    assert "assertion_text" in payload
    assert "coverage_line" in payload
    assert "control_tags" in payload


def test_audit_readiness_route(db_session):
    from fastapi.testclient import TestClient

    from app.core.db import get_db
    from app.core.security import current_principal
    from app.main import app

    client = TestClient(app)
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    db_session.add(Org(id=org_id, name="Audit Org"))
    db_session.add(
        User(id=user_id, org_id=org_id, email="viewer@audit.test", password_hash="x", role="viewer")
    )
    add_membership(db_session, user_id, org_id, "viewer")
    db_session.flush()

    client.app.dependency_overrides[get_db] = lambda: db_session
    client.app.dependency_overrides[current_principal] = lambda: {
        "sub": str(user_id),
        "org_id": str(org_id),
        "role": "viewer",
    }
    try:
        res = client.get("/v1/audit-readiness?framework=soc2")
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["framework"] == "soc2"
        assert body["org_name"] == "Audit Org"
        assert isinstance(body["playbooks"], list)
        assert isinstance(body["domains"], list)
    finally:
        client.app.dependency_overrides.clear()


def test_build_audit_readiness_empty_org(db_session):
    org_id = uuid.uuid4()
    db_session.add(Org(id=org_id, name="Empty Org"))
    db_session.flush()
    payload = build_audit_readiness(db_session, org_id, "soc2")
    assert payload["org_name"] == "Empty Org"
    # No connected evidence providers means there is nothing to grade.
    assert isinstance(payload["domains"], list)
    assert payload["domains"] == []


def test_resource_inventory_marks_workload_scanning_not_applicable():
    controls = [
        {
            "control_id": "CC7.1",
            "check_evidence_classes": {
                "ecr.repository.image_scan_disabled": "benchmark",
                "ecr.registry.enhanced_scanning_disabled": "benchmark",
            },
            "findings": [],
            "exceptions": [],
        }
    ]
    playbook = next(
        definition
        for definition in _AUDITOR_TECHNICAL_PLAYBOOKS
        if definition["key"] == "vulnerability_management"
    )

    items = _technical_playbook_items(
        playbook,
        controls,
        framework="soc2",
        named_sources=["AWS account production (123456789012)"],
        scanned_entity_types={"s3_bucket"},
    )

    assert len(items) == 1
    assert items[0]["label"] == "Amazon Inspector and ECR image scanning"
    assert items[0]["status"] == "not_applicable"
    assert items[0]["applicability_reason"] == (
        "No EC2, ECS, EKS, or ECR workloads in the latest complete inventory"
    )
    assert items[0]["controls"] == ["SOC 2 CC7.1"]


def test_inspector_playbook_is_applicable_for_ec2_workloads():
    finding = {
        "id": "f1",
        "check_id": "aws.inspector.active_critical_finding",
        "resource_arn": "arn:aws:ec2:us-east-1:123:instance/i-1",
        "title": "Critical package vulnerability",
        "severity": "critical",
    }
    controls = [
        {
            "control_id": "CC7.1",
            "check_evidence_classes": {
                "aws.inspector.active_critical_finding": "benchmark",
                "aws.vulnerability_monitoring.not_detected": "benchmark",
            },
            "findings": [finding],
            "exceptions": [],
        }
    ]
    playbook = next(
        definition
        for definition in _AUDITOR_TECHNICAL_PLAYBOOKS
        if definition["key"] == "vulnerability_management"
    )

    items = _technical_playbook_items(
        playbook,
        controls,
        framework="soc2",
        named_sources=[],
        scanned_entity_types={"ec2_instance"},
    )

    assert len(items) == 1
    assert items[0]["status"] == "action"
    assert items[0]["action_kind"] == "review"
    assert items[0]["finding_count"] == 1


def test_ec2_inspector_is_not_assessed_without_positive_enablement_evidence():
    controls = [
        {
            "control_id": "CC7.1",
            "check_evidence_classes": {
                "aws.inspector.active_critical_finding": "benchmark",
                "aws.vulnerability_monitoring.not_detected": "benchmark",
            },
            "findings": [],
            "exceptions": [],
        }
    ]
    playbook = next(
        definition
        for definition in _AUDITOR_TECHNICAL_PLAYBOOKS
        if definition["key"] == "vulnerability_management"
    )

    items = _technical_playbook_items(
        playbook,
        controls,
        framework="soc2",
        named_sources=[],
        scanned_entity_types={"ec2_instance"},
    )

    assert len(items) == 1
    assert items[0]["status"] == "not_assessed"
    assert items[0]["action_kind"] is None
    assert "cannot distinguish" in items[0]["summary"]


def test_dr_rows_are_na_without_stateful_resources():
    controls = [
        {
            "control_id": "A1.2",
            "check_evidence_classes": {
                "rds.instance.no_automated_backup": "benchmark",
                "dynamodb.table.no_pitr": "benchmark",
                "backup.plan.missing": "benchmark",
            },
            "findings": [],
            "exceptions": [],
        }
    ]
    playbook = next(
        definition
        for definition in _AUDITOR_TECHNICAL_PLAYBOOKS
        if definition["key"] == "disaster_recovery"
    )

    items = _technical_playbook_items(
        playbook,
        controls,
        framework="soc2",
        named_sources=[],
        scanned_entity_types={"s3_bucket"},
    )

    assert len(items) == 3
    assert {item["status"] for item in items} == {"not_applicable"}
    assert all("latest complete inventory" in item["summary"] for item in items)


def _dr_items(controls, scanned_entity_types):
    playbook = next(
        definition
        for definition in _AUDITOR_TECHNICAL_PLAYBOOKS
        if definition["key"] == "disaster_recovery"
    )
    return _technical_playbook_items(
        playbook,
        controls,
        framework="soc2",
        named_sources=[],
        scanned_entity_types=scanned_entity_types,
    )


def test_dr_definition_is_restore_focused_and_excludes_multi_az():
    playbook = next(
        definition
        for definition in _AUDITOR_TECHNICAL_PLAYBOOKS
        if definition["key"] == "disaster_recovery"
    )

    assert all(
        "rds.instance.no_multi_az" not in item["checks"] for item in playbook["items"]
    )
    assert "accidentally deleted" in playbook["question"]
    assert "corrupted" in playbook["question"]
    assert "maliciously encrypted" in playbook["question"]
    assert "restore-tested" in playbook["outcome"]
    assert not any(
        definition["key"] == "availability_resilience"
        for definition in _AUDITOR_TECHNICAL_PLAYBOOKS
    )


def test_dr_orders_restore_mechanisms_before_deletion_prevention():
    checks = (
        ("rds.instance.no_automated_backup", "low"),
        ("dynamodb.table.no_pitr", "medium"),
        ("backup.plan.missing", "high"),
        ("rds.instance.no_deletion_protection", "critical"),
        ("rds.instance.no_multi_az", "critical"),
    )
    controls = [
        {
            "control_id": "A1.2",
            "check_evidence_classes": {
                check_id: "benchmark" for check_id, _severity in checks
            },
            "findings": [
                {
                    "id": check_id,
                    "check_id": check_id,
                    "resource_arn": f"arn:aws:test:us-east-1:123:resource/{index}",
                    "title": f"Explicit failing evidence for {check_id}",
                    "severity": severity,
                }
                for index, (check_id, severity) in enumerate(checks)
            ],
            "exceptions": [],
        }
    ]

    playbooks = _build_technical_playbooks(
        controls,
        framework="soc2",
        account=None,
        scanned_entity_types={
            "rds_instance",
            "dynamodb_table",
            "ec2_instance",
        },
    )
    dr = next(playbook for playbook in playbooks if playbook["key"] == "disaster_recovery")

    assert [item["key"] for item in dr["items"]] == [
        "rds_backups",
        "dynamodb_recovery",
        "backup_coverage",
        "rds_deletion_protection",
    ]
    assert all("multi_az" not in item["key"] for item in dr["items"])
    assert dr["additional_action_count"] == 0
    assert "prevention, not a data restoration mechanism" in dr["items"][-1]["summary"]


def test_dynamodb_pitr_action_requires_inventory_and_explicit_disabled_evidence():
    finding = {
        "id": "pitr-disabled",
        "check_id": "dynamodb.table.no_pitr",
        "resource_arn": "arn:aws:dynamodb:us-east-1:123:table/orders",
        "title": "DynamoDB table `orders` does not have point-in-time recovery enabled",
        "severity": "medium",
    }
    controls = [
        {
            "control_id": "A1.2",
            "check_evidence_classes": {"dynamodb.table.no_pitr": "benchmark"},
            "findings": [finding],
            "exceptions": [],
        }
    ]

    present = _dr_items(controls, {"dynamodb_table"})
    pitr = next(item for item in present if item["key"] == "dynamodb_recovery")
    assert pitr["status"] == "action"
    assert pitr["action_kind"] == "activate"
    assert pitr["action_label"] == "Enable"

    unknown = _dr_items(controls, None)
    pitr_unknown = next(item for item in unknown if item["key"] == "dynamodb_recovery")
    assert pitr_unknown["status"] == "not_assessed"
    assert pitr_unknown["action_kind"] is None

    absent = _dr_items(controls, {"s3_bucket"})
    pitr_absent = next(item for item in absent if item["key"] == "dynamodb_recovery")
    assert pitr_absent["status"] == "not_applicable"
    assert pitr_absent["action_kind"] is None


def test_dynamodb_inventory_without_disabled_evidence_is_not_an_action():
    controls = [
        {
            "control_id": "A1.2",
            "check_evidence_classes": {"dynamodb.table.no_pitr": "benchmark"},
            "findings": [],
            "exceptions": [],
        }
    ]

    pitr = next(
        item
        for item in _dr_items(controls, {"dynamodb_table"})
        if item["key"] == "dynamodb_recovery"
    )
    assert pitr["status"] == "verified"
    assert pitr["action_kind"] is None


@pytest.mark.parametrize(
    ("check_id", "entity_type", "item_key"),
    [
        ("rds.instance.no_automated_backup", "rds_instance", "rds_backups"),
        ("backup.plan.missing", "ec2_instance", "backup_coverage"),
    ],
)
def test_resource_scoped_recovery_actions_require_matching_latest_inventory(
    check_id, entity_type, item_key
):
    controls = [
        {
            "control_id": "A1.2",
            "check_evidence_classes": {check_id: "benchmark"},
            "findings": [
                {
                    "id": check_id,
                    "check_id": check_id,
                    "resource_arn": "arn:aws:test:us-east-1:123:resource/example",
                    "title": "Collected disabled evidence",
                    "severity": "high",
                }
            ],
            "exceptions": [],
        }
    ]

    applicable = next(
        item for item in _dr_items(controls, {entity_type}) if item["key"] == item_key
    )
    assert applicable["status"] == "action"

    unknown = next(item for item in _dr_items(controls, None) if item["key"] == item_key)
    assert unknown["status"] == "not_assessed"
    assert unknown["action_kind"] is None


def test_not_applicable_checks_are_excluded_from_readiness_rollup():
    controls = [
        {
            "control_id": "CC7.1",
            "check_evidence_classes": {
                "ecr.repository.image_scan_disabled": "benchmark",
                "guardduty.detector.not_enabled": "benchmark",
            },
            "findings": [],
            "exceptions": [],
        }
    ]

    filtered = _without_inapplicable_checks(controls, {"ec2_instance"})

    assert list(filtered[0]["check_evidence_classes"]) == [
        "guardduty.detector.not_enabled"
    ]


def test_applicability_stays_unknown_without_complete_inventory():
    assert (
        _applicability_reason(
            ["ecr.repository.image_scan_disabled"],
            scanned_entity_types=None,
            observed_check_ids=set(),
        )
        is None
    )
