"""IAM least-privilege SSM plan enrichment + confidence gate."""
from datetime import datetime, timezone
import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.models import Finding
from app.services.remediation_iam_policy_plan import (
    IamPolicyRemediationNotReady,
    enrich_iam_least_privilege_plan,
    iam_supported_action_for_evidence,
)


def test_iam_supported_action_prefers_inline_replacement():
    ev = {
        "scope": "full_admin",
        "attached_policies_full_admin": ["Admin"],
        "inline_policies_full_admin": ["InlineAdmin"],
    }
    assert iam_supported_action_for_evidence(ev) == "replace_wildcard_inline"


@patch("app.services.remediation_iam_policy_plan.load_role_generated_policy")
def test_enrich_blocks_when_confidence_not_high(mock_build):
    mock_build.return_value = {
        "confidence": "medium",
        "confidence_note": "Need CloudTrail",
        "improve_via_cloudtrail": True,
        "cloudtrail_analysis": {"ready": True, "status": "ready"},
    }
    finding = Finding(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        account_id=uuid.uuid4(),
        check_id="iam.role.least_privilege_policy",
        resource_arn="arn:aws:iam::123456789012:role/AppRole",
        title="Least privilege",
        severity="high",
        risk_score=80,
        status="open",
        evidence={"inline_policies_wildcard_action": ["AppPolicy"]},
        first_seen=datetime.now(timezone.utc),
        last_seen=datetime.now(timezone.utc),
    )
    db = MagicMock()
    with pytest.raises(IamPolicyRemediationNotReady) as exc:
        enrich_iam_least_privilege_plan(db, finding, {"plan_id": "p1"})
    assert exc.value.detail["code"] == "iam_policy_confidence_gate"
    assert exc.value.detail["confidence"] == "medium"


@patch("app.services.remediation_iam_policy_plan.load_role_generated_policy")
def test_enrich_attaches_replacement_policy_when_high(mock_build):
    mock_build.return_value = {
        "confidence": "high",
        "source_label": "IAM last-accessed + CloudTrail policy generation",
        "observed_action_count": 12,
        "cleaned_policies": {
            "AppPolicy": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": "s3:ListBucket", "Resource": "*"}]},
        },
    }
    finding = Finding(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        account_id=uuid.uuid4(),
        check_id="iam.role.least_privilege_policy",
        resource_arn="arn:aws:iam::123456789012:role/AppRole",
        title="Least privilege",
        severity="high",
        risk_score=80,
        status="open",
        evidence={"inline_policies_wildcard_action": ["AppPolicy"]},
        first_seen=datetime.now(timezone.utc),
        last_seen=datetime.now(timezone.utc),
    )
    db = MagicMock()
    plan = enrich_iam_least_privilege_plan(db, finding, {"plan_id": "p1"})
    assert plan["supported_action"] == "replace_wildcard_inline"
    assert plan["replacement_policy"]["Statement"][0]["Action"] == "s3:ListBucket"
    assert plan["evidence"]["policy_names"] == ["AppPolicy"]
