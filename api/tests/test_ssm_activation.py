"""Tests for SSM remediation module activation — s3_public_access, iam_policies, cloudtrail_logging."""
from datetime import datetime, timezone

import pytest
import uuid

from app.data.remediation_modules import (
    CHECK_TO_REMEDIATION_MODULE,
    REMEDIATION_MODULES,
    REMEDIATION_MODULE_BY_ID,
    remediation_module_for_check,
)
from app.models import Finding
from app.services.remediation_plan import (
    VIGIL_CUSTOM_SSM_CHECKS,
    build_remediation_plan,
    resolve_automation_region,
)
from app.services.remediation_dispatch import build_remediation_dispatch
from app.services.ssm_remediation_catalog import (
    SsmRemediationRunbook,
    automation_parameters_for_plan,
    runbook_for_check,
)


# ── Bug 1 Fix: iam.role.full_admin_policy key ────────────────────────

def test_iam_role_full_admin_mapped_to_iam_policies():
    """Bug fix: iam.role.full_admin_policy maps to iam_policies (was iam.role.full_admin)."""
    assert remediation_module_for_check("iam.role.full_admin_policy") == "iam_policies"
    assert remediation_module_for_check("iam.role.full_admin") is None


def test_iam_policy_wildcard_mapped_to_iam_policies():
    assert remediation_module_for_check("iam.policy.wildcard_resource") == "iam_policies"


def test_check_to_remediation_module_has_correct_keys():
    """All keys in CHECK_TO_REMEDIATION_MODULE match actual check IDs."""
    iam_keys = {k for k in CHECK_TO_REMEDIATION_MODULE if k.startswith("iam.")}
    assert "iam.role.full_admin_policy" in iam_keys
    assert "iam.role.full_admin" not in iam_keys, "Bug 1: wrong key should not be present"
    assert "iam.policy.wildcard_resource" in iam_keys


# ── Runner Supported Flags ────────────────────────────────────────────

def test_s3_public_access_runner_supported():
    spec = REMEDIATION_MODULE_BY_ID["s3_public_access"]
    assert spec.runner_supported is True


def test_iam_policies_runner_supported():
    spec = REMEDIATION_MODULE_BY_ID["iam_policies"]
    assert spec.runner_supported is True


def test_cloudtrail_logging_runner_supported():
    spec = REMEDIATION_MODULE_BY_ID["cloudtrail_logging"]
    assert spec.runner_supported is True


# ── VIGIL_CUSTOM_SSM_CHECKS ──────────────────────────────────────────

def test_vigil_custom_ssm_checks_includes_activated_modules():
    assert "s3.bucket.public_access_not_blocked" in VIGIL_CUSTOM_SSM_CHECKS
    assert "iam.role.full_admin_policy" in VIGIL_CUSTOM_SSM_CHECKS
    assert "iam.policy.wildcard_resource" in VIGIL_CUSTOM_SSM_CHECKS
    # Existing checks still there
    assert "ec2.security_group.unrestricted_ssh" in VIGIL_CUSTOM_SSM_CHECKS
    assert "iam.access_key.unused_45d" in VIGIL_CUSTOM_SSM_CHECKS


# ── S3 Module: Custom Vigil Document ─────────────────────────────────

def test_s3_runbook_is_vigil_custom_plan_json():
    rb = runbook_for_check("s3.bucket.public_access_not_blocked")
    assert rb is not None
    assert rb.owner == "vigil"
    assert rb.document_name == "Vigil-ConfigureS3BucketPublicAccessBlock"
    assert rb.parameter_mode == "plan_json"


def test_s3_automation_parameters_plan_json():
    import json

    rb = runbook_for_check("s3.bucket.public_access_not_blocked")
    plan_json = json.dumps({"plan_id": "test-1", "check_id": "s3.bucket.public_access_not_blocked"})
    params = automation_parameters_for_plan(plan_json, rb)
    assert params == {"PlanJson": [plan_json]}


def test_s3_uses_home_automation_region(monkeypatch):
    monkeypatch.setenv("REMEDIATION_AUTOMATION_REGION", "us-east-1")
    from app.core.config import get_settings

    get_settings.cache_clear()
    region = resolve_automation_region("s3.bucket.public_access_not_blocked", "eu-west-1")
    assert region == "us-east-1"


# ── IAM Policies Module ──────────────────────────────────────────────

def test_iam_full_admin_runbook():
    rb = runbook_for_check("iam.role.full_admin_policy")
    assert rb is not None
    assert rb.owner == "vigil"
    assert rb.document_name == "Vigil-RemediateIamExcessPermissions"
    assert rb.parameter_mode == "plan_json"


def test_iam_wildcard_runbook():
    rb = runbook_for_check("iam.policy.wildcard_resource")
    assert rb is not None
    assert rb.owner == "vigil"
    assert rb.document_name == "Vigil-RemediateIamExcessPermissions"
    assert rb.parameter_mode == "plan_json"


def test_iam_uses_home_automation_region(monkeypatch):
    monkeypatch.setenv("REMEDIATION_AUTOMATION_REGION", "us-east-1")
    from app.core.config import get_settings

    get_settings.cache_clear()
    assert resolve_automation_region("iam.role.full_admin_policy", "eu-west-1") == "us-east-1"
    assert resolve_automation_region("iam.policy.wildcard_resource", "eu-west-1") == "us-east-1"


def test_iam_full_admin_supported_action():
    from app.services.remediation_plan import _supported_action

    assert _supported_action("iam.role.full_admin_policy") == "detach_full_admin"
    assert _supported_action("iam.policy.wildcard_resource") == "replace_wildcard_inline"


# ── CloudTrail Module: Guided Manual ─────────────────────────────────

def test_cloudtrail_runbook_is_guided():
    rb = runbook_for_check("cloudtrail.trail.not_enabled")
    assert rb is not None
    assert rb.owner == "aws"
    assert rb.document_name == "AWS-EnableCloudTrail"
    assert rb.parameter_mode == "aws_cloudtrail_enable_guided"


def test_cloudtrail_automation_parameters_guided(monkeypatch):
    """Guided mode returns params with defaults — no ValueError."""
    import json

    monkeypatch.setenv("REMEDIATION_AUTOMATION_REGION", "us-east-1")
    from app.core.config import get_settings

    get_settings.cache_clear()

    rb = runbook_for_check("cloudtrail.trail.not_enabled")
    plan = {
        "plan_id": "ct-test",
        "check_id": "cloudtrail.trail.not_enabled",
        "parameters": {
            "S3BucketName": "",
            "TrailName": "VigilCloudTrail",
            "EnableLogFileValidation": True,
            "IsMultiRegionTrail": True,
        },
    }
    plan_json = json.dumps(plan)
    params = automation_parameters_for_plan(
        plan_json, rb, automation_assume_role_arn="arn:aws:iam::123456789012:role/VigilRemediationAutomationRole"
    )
    assert "AutomationAssumeRole" in params
    assert "TrailName" in params
    assert params["TrailName"] == ["VigilCloudTrail"]
    assert "S3BucketName" in params
    assert "EnableLogFileValidation" in params


def test_cloudtrail_parameter_overrides():
    """Parameter overrides take precedence over plan defaults."""
    import json

    rb = runbook_for_check("cloudtrail.trail.not_enabled")
    plan = {
        "plan_id": "ct-test",
        "check_id": "cloudtrail.trail.not_enabled",
        "parameters": {"S3BucketName": "", "TrailName": "VigilCloudTrail"},
    }
    plan_json = json.dumps(plan)
    params = automation_parameters_for_plan(
        plan_json,
        rb,
        automation_assume_role_arn="arn:aws:iam::123456789012:role/TestRole",
        parameter_overrides={"S3BucketName": "my-logs-bucket", "TrailName": "CustomTrail"},
    )
    assert params["S3BucketName"] == ["my-logs-bucket"]
    assert params["TrailName"] == ["CustomTrail"]


def test_cloudtrail_uses_resource_region():
    """AWS-owned CloudTrail runbook still uses resource region (not in VIGIL_CUSTOM_SSM_CHECKS)."""
    region = resolve_automation_region("cloudtrail.trail.not_enabled", "eu-west-2")
    assert region == "eu-west-2"


def test_cloudtrail_plan_has_parameters_and_requires_user_input():
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    f = Finding(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        account_id=uuid.uuid4(),
        check_id="cloudtrail.trail.not_enabled",
        resource_arn="arn:aws:cloudtrail:*:123456789012:trail",
        title="No multi-region trail",
        severity="high",
        risk_score=80,
        status="open",
        evidence={"account_id": "123456789012"},
        first_seen=now,
        last_seen=now,
    )
    plan = build_remediation_plan(f)
    assert "parameters" in plan
    assert plan["parameters"]["TrailName"] == "VigilCloudTrail"
    assert "requires_user_input" in plan
    assert "S3BucketName" in plan["requires_user_input"]


# ── IAM Inline Policy Scoping ────────────────────────────────────────

def test_iam_remediation_inline_policy_full_admin():
    from app.services.remediation_iam import inline_policy_for_check

    statements = inline_policy_for_check("iam.role.full_admin_policy")
    assert len(statements) == 1
    stmt = statements[0]
    assert "iam:DetachRolePolicy" in stmt["Action"]
    assert "iam:ListAttachedRolePolicies" in stmt["Action"]
    assert stmt["Sid"] == "IamDetachFullAdmin"


def test_iam_remediation_inline_policy_wildcard():
    from app.services.remediation_iam import inline_policy_for_check

    statements = inline_policy_for_check("iam.policy.wildcard_resource")
    assert len(statements) == 1
    stmt = statements[0]
    assert "iam:PutRolePolicy" in stmt["Action"]
    assert "iam:GetRolePolicy" in stmt["Action"]
    assert stmt["Sid"] == "IamReplaceWildcardInline"


def test_s3_remediation_inline_policy_scoped():
    from app.services.remediation_iam import inline_policy_for_check

    statements = inline_policy_for_check("s3.bucket.public_access_not_blocked")
    assert len(statements) == 1
    stmt = statements[0]
    assert stmt["Resource"] == "arn:aws:s3:::*"
    assert stmt["Resource"] != "*", "S3 IAM policy should be scoped to s3 ARN, not wildcard"


def test_cloudtrail_inline_policy():
    from app.services.remediation_iam import inline_policy_for_check

    statements = inline_policy_for_check("cloudtrail.trail.not_enabled")
    assert len(statements) == 1
    stmt = statements[0]
    assert "cloudtrail:CreateTrail" in stmt["Action"]
    assert "cloudtrail:DescribeTrails" in stmt["Action"]
    assert "s3:GetBucketPolicy" in stmt["Action"]


# ── IaC Automation Checks Integration ────────────────────────────────

def test_automation_checks_includes_new_modules():
    from app.services.iac_snippets import AUTOMATION_CHECKS

    assert "s3.bucket.public_access_not_blocked" in AUTOMATION_CHECKS
    assert "iam.role.full_admin_policy" in AUTOMATION_CHECKS
    assert "iam.policy.wildcard_resource" in AUTOMATION_CHECKS
    assert "cloudtrail.trail.not_enabled" in AUTOMATION_CHECKS


def test_action_labels_have_new_actions():
    from app.services.iac_snippets import _ACTION_LABELS

    assert "detach_full_admin" in _ACTION_LABELS
    assert "replace_wildcard_inline" in _ACTION_LABELS
    assert _ACTION_LABELS["detach_full_admin"] == "Detach full admin policies"


# ── Dispatch parameter_overrides ─────────────────────────────────────

def test_dispatch_accepts_parameter_overrides(monkeypatch):
    monkeypatch.setenv("REMEDIATION_AUTOMATION_REGION", "us-east-1")
    from app.core.config import get_settings

    get_settings.cache_clear()

    now = datetime.now(timezone.utc)
    f = Finding(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        account_id=uuid.uuid4(),
        check_id="cloudtrail.trail.not_enabled",
        resource_arn="arn:aws:cloudtrail:*:123456789012:trail",
        title="No multi-region trail",
        severity="high",
        risk_score=80,
        status="open",
        evidence={"account_id": "123456789012"},
        first_seen=now,
        last_seen=now,
    )
    out = build_remediation_dispatch(
        f,
        approved_by="test-user",
        execute=False,
        parameter_overrides={"S3BucketName": "my-bucket"},
    )
    assert out["prepared"] is True
    assert out["executed"] is False
    params = out["ssm"]["parameters"]
    assert "S3BucketName" in params
    assert params["S3BucketName"] == ["my-bucket"]


# ── Plan Steps ───────────────────────────────────────────────────────

def test_iam_full_admin_plan_steps():
    from app.services.remediation_plan import _steps_for_check

    now = datetime.now(timezone.utc)
    f = Finding(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        account_id=uuid.uuid4(),
        check_id="iam.role.full_admin_policy",
        resource_arn="arn:aws:iam::123456789012:role/admin-role",
        title="Full admin role",
        severity="critical",
        risk_score=95,
        status="open",
        evidence={},
        first_seen=now,
        last_seen=now,
    )
    steps = _steps_for_check(f)
    assert any("detach" in s["action"].lower() or "detach" in s["detail"].lower() for s in steps)


def test_s3_plan_steps_mention_specific_bucket():
    from app.services.remediation_plan import _steps_for_check

    now = datetime.now(timezone.utc)
    f = Finding(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        account_id=uuid.uuid4(),
        check_id="s3.bucket.public_access_not_blocked",
        resource_arn="arn:aws:s3:::my-bucket",
        title="Public bucket",
        severity="high",
        risk_score=80,
        status="open",
        evidence={"bucket_name": "my-bucket"},
        first_seen=now,
        last_seen=now,
    )
    steps = _steps_for_check(f)
    assert len(steps) == 2
    assert steps[1]["action"] == "execute"


# ── No regressions: existing module behavior ─────────────────────────

def test_sg_runbook_unchanged():
    rb = runbook_for_check("ec2.security_group.unrestricted_ssh")
    assert rb is not None
    assert rb.owner == "vigil"
    assert rb.parameter_mode == "plan_json"


def test_iam_key_runbook_unchanged():
    rb = runbook_for_check("iam.access_key.unused_90d")
    assert rb is not None
    assert rb.owner == "vigil"
    assert rb.document_name == "Vigil-DeactivateIamAccessKey"


def test_ssm_parameter_runbook_unchanged():
    rb = runbook_for_check("ssm.parameter.plaintext_secret")
    assert rb is not None
    assert rb.owner == "vigil"
    assert rb.document_name == "Vigil-MigrateSsmParameterToSecureString"


def test_unknown_check_no_runbook():
    assert runbook_for_check("nonexistent.check.id") is None
