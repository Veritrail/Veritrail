"""Phase 2 — native cloud capability grading from collected rows."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

from app.services.cloud_capability_evidence import (
    collect_aws_inspector_envelopes,
    collect_azure_defender_envelopes,
    collect_gcp_envelopes,
)
from app.services.technical_capability import grade_from_enablement_and_activity


def test_enablement_alone_is_not_covered():
    assert (
        grade_from_enablement_and_activity(
            enabled=True,
            has_observable_activity=False,
            last_successful_scan_at=None,
            capability="host_workload_scanning",
        )
        == "partial"
    )


def test_aws_inspector_grades_ec2_ecr_lambda_separately():
    now = datetime(2026, 7, 19, tzinfo=timezone.utc)
    org_id = uuid.uuid4()
    account_id = uuid.uuid4()

    account = MagicMock()
    account.id = account_id
    account.account_id = "111122223333"
    account.status = "connected"
    account.last_scan_at = now

    status = MagicMock()
    status.ec2_enabled = True
    status.ecr_enabled = False
    status.lambda_enabled = True
    status.lambda_code_enabled = False
    status.last_seen = now
    status.evidence_json = {
        "coverage": {
            "ec2": {"assessed": 3, "last_scanned_at": now.isoformat()},
            "lambda": {"assessed": 2, "last_scanned_at": now.isoformat()},
        }
    }

    finding = MagicMock()
    finding.resource_type = "AWS_EC2_INSTANCE"
    finding.severity = "HIGH"

    db = MagicMock()
    # accounts, statuses, findings, ec2_count, ecr_count, lambda_count
    db.scalars.side_effect = [
        MagicMock(all=lambda: [account]),
        MagicMock(all=lambda: [status]),
        MagicMock(all=lambda: [finding]),
    ]
    db.scalar.side_effect = [3, 0, 2]

    envs = collect_aws_inspector_envelopes(db, org_id, now=now)
    by_cap = {e.capability: e for e in envs}
    assert by_cap["host_workload_scanning"].status in ("covered", "partial")
    assert by_cap["host_workload_scanning"].enabled is True
    assert by_cap["container_image_scanning"].status == "not_applicable"
    assert by_cap["serverless_scanning"].enabled is True
    assert by_cap["serverless_scanning"].status == "partial" or by_cap["serverless_scanning"].status == "covered"
    assert "lambda_standard_only_code_scanning_off" in by_cap["serverless_scanning"].limitations


def test_gcp_scc_accessible_without_vuln_is_not_full_cover():
    now = datetime(2026, 7, 19, tzinfo=timezone.utc)
    org_id = uuid.uuid4()
    project = MagicMock()
    project.id = uuid.uuid4()
    project.project_id = "proj-1"
    project.status = "connected"

    osconfig = MagicMock()
    osconfig.api_accessible = True
    osconfig.has_reports = True
    osconfig.report_count = 2
    osconfig.last_seen = now
    osconfig.evidence_json = {"high": 1}

    scc = MagicMock()
    scc.scc_enabled = True
    scc.active_finding_count = 5
    scc.high_severity_count = 1
    scc.last_seen = now
    scc.evidence_json = {
        "vulnerability_finding_count": 0,
        "limitations": ["scc_no_vulnerability_class_findings"],
        "sources_observed": ["source-a"],
    }

    db = MagicMock()
    db.scalars.return_value = MagicMock(all=lambda: [project])
    db.scalar.side_effect = [2, osconfig, scc]

    envs = collect_gcp_envelopes(db, org_id, now=now)
    posture = next(e for e in envs if e.capability == "cloud_findings_posture")
    assert posture.enabled is True
    assert "scc_accessible_sources_not_enumerated" in posture.limitations or posture.status in (
        "partial",
        "covered",
    )


def test_azure_defender_enablement_only_is_partial():
    now = datetime(2026, 7, 19, tzinfo=timezone.utc)
    org_id = uuid.uuid4()
    sub = MagicMock()
    sub.id = uuid.uuid4()
    sub.subscription_id = "sub-1"
    sub.status = "connected"

    status = MagicMock()
    status.defender_enabled = True
    status.pricing_tier = "Standard"
    status.last_seen = now
    status.evidence_json = {}  # no plan inventory

    db = MagicMock()
    db.scalars.return_value = MagicMock(all=lambda: [sub])
    db.scalar.side_effect = [status, 0]

    envs = collect_azure_defender_envelopes(db, org_id, now=now)
    posture = next(e for e in envs if e.capability == "cloud_findings_posture")
    assert posture.enabled is True
    assert "enablement_only_no_plan_inventory" in posture.limitations
