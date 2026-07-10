"""Unit tests for OCSF findings export shape."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from app.services.ocsf_export import finding_to_ocsf, findings_to_ocsf_bundle


def _finding(**overrides):
    base = dict(
        id=uuid.uuid4(),
        check_id="iam.user.no_mfa",
        resource_arn="arn:aws:iam::123456789012:user/alice",
        title="IAM user alice has no MFA",
        severity="high",
        risk_score=80,
        status="open",
        evidence={"user_name": "alice"},
        first_seen=datetime(2026, 1, 1, tzinfo=timezone.utc),
        last_seen=datetime(2026, 1, 10, tzinfo=timezone.utc),
        account_id=uuid.uuid4(),
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_compliance_finding_ocsf_shape():
    event = finding_to_ocsf(_finding(), as_compliance=True, account_label="Prod")
    assert event["class_uid"] == 2003
    assert event["class_name"] == "Compliance Finding"
    assert event["category_uid"] == 2
    assert event["type_uid"] == 200301
    assert event["severity_id"] == 4
    assert event["finding_info"]["title"]
    assert event["finding_info"]["types"] == ["iam.user.no_mfa"]
    assert event["resources"][0]["uid"].startswith("arn:aws:iam::")
    assert event["compliance"]["control"] == "iam.user.no_mfa"
    assert event["compliance"]["status"] == "Fail"
    assert event["unmapped"]["check_id"] == "iam.user.no_mfa"
    assert event["unmapped"]["account_label"] == "Prod"
    assert event["metadata"]["version"] == "1.1.0"
    assert "evidence" in event["unmapped"]


def test_security_finding_ocsf_shape():
    event = finding_to_ocsf(_finding(status="resolved"), as_compliance=False)
    assert event["class_uid"] == 2001
    assert event["activity_id"] == 3
    assert event["type_uid"] == 200103
    assert "compliance" not in event


def test_ocsf_bundle_wraps_events():
    bundle = findings_to_ocsf_bundle([_finding(), _finding(severity="critical")], as_compliance=True)
    assert bundle["ocsf_version"] == "1.1.0"
    assert bundle["export_format"] == "compliance_finding"
    assert bundle["count"] == 2
    assert len(bundle["events"]) == 2
