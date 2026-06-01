from datetime import datetime, timezone

from app.models import Finding
from app.services.remediation_dispatch import build_remediation_dispatch
from app.services.remediation_plan import PLAN_SCHEMA, build_remediation_plan
import uuid


def _sg_finding(**ev) -> Finding:
    now = datetime.now(timezone.utc)
    base_ev = {"group_id": "sg-abc", "group_name": "test", "region": "us-east-2", "exposing_rules": [
        {"protocol": "tcp", "from_port": 3389, "to_port": 3389, "cidr": "0.0.0.0/0", "match_reason": "port_in_range"},
    ]}
    base_ev.update(ev)
    return Finding(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        account_id=uuid.uuid4(),
        check_id="ec2.security_group.unrestricted_rdp",
        resource_arn="arn:aws:ec2:us-east-2:123456789012:security-group/sg-abc",
        title="RDP open",
        severity="high",
        risk_score=80,
        status="open",
        evidence=base_ev,
        first_seen=now,
        last_seen=now,
    )


def test_remediation_plan_v2_fields(monkeypatch):
    monkeypatch.setenv("REMEDIATION_AUTOMATION_REGION", "us-east-1")
    from app.core.config import get_settings

    get_settings.cache_clear()
    f = _sg_finding()
    plan = build_remediation_plan(f)
    assert plan["schema"] == PLAN_SCHEMA
    assert plan["resource_region"] == "us-east-2"
    assert plan["automation_region"] == "us-east-1"
    assert plan["exact_match_rules"]
    assert plan["expires_at"]
    assert plan["content_sha256"]


def test_dispatch_includes_approval_block():
    f = _sg_finding()
    out = build_remediation_dispatch(f, approved_by="user-abc")
    plan = out["plan"]
    assert "approval" in plan
    assert plan["approval"]["approved_by"] == "user-abc"
    assert plan["approval"]["approval_token"]
    assert plan["approval"]["approved_at"]


def test_preview_plan_has_no_approval():
    f = _sg_finding()
    plan = build_remediation_plan(f)
    assert "approval" not in plan


def test_dispatch_custom_vigil_doc_uses_home_automation_region(monkeypatch):
    monkeypatch.setenv("REMEDIATION_AUTOMATION_REGION", "us-east-1")
    from app.core.config import get_settings

    get_settings.cache_clear()
    f = _sg_finding()
    out = build_remediation_dispatch(f, approved_by="user-abc")
    assert out["automation_region"] == "us-east-1"
    assert out["resource_region"] == "us-east-2"
    assert out["plan"]["automation_region"] == "us-east-1"
    assert out["plan"]["execution"]["runner_type"] == "ssm"
    cli = out["cli"]["start_automation"]
    assert "ssm start-automation-execution" in cli
    assert "--region us-east-1" in cli


def test_dispatch_iam_keys_use_home_automation_region(monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setenv("REMEDIATION_AUTOMATION_REGION", "us-east-1")
    get_settings.cache_clear()

    now = datetime.now(timezone.utc)
    f = Finding(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        account_id=uuid.uuid4(),
        check_id="iam.access_key.unused_45d",
        resource_arn="arn:aws:iam::123456789012:user/alice#AKIAEXAMPLE",
        title="Unused access key",
        severity="high",
        risk_score=90,
        status="open",
        evidence={"user_arn": "arn:aws:iam::123456789012:user/alice", "key_id": "AKIAEXAMPLE"},
        first_seen=now,
        last_seen=now,
    )
    out = build_remediation_dispatch(f, approved_by="user-abc")
    assert out["automation_region"] == "us-east-1"
    assert "--region us-east-1" in out["cli"]["start_automation"]


def test_sg_iac_no_terraform():
    from unittest.mock import MagicMock

    from app.services.iac_snippets import build_iac_remediation

    f = _sg_finding()
    db = MagicMock()
    db.scalar.return_value = None
    db.scalars.return_value.all.return_value = []
    out = build_iac_remediation(db, f, f.org_id)
    assert out["terraform"] is None
    assert out["iac_status"] == "automation_only"
    assert out["apply_paths"]["terraform_generic"] is False
    assert out["apply_paths"]["customer_automation"] is True


def test_dispatch_does_not_execute_ssm_by_default():
    f = _sg_finding()
    out = build_remediation_dispatch(f, approved_by="user-abc", execute=False)
    assert out.get("executed") is False
    assert out.get("automation_execution_id") is None


def test_iac_includes_ssm_remediation_panel():
    from unittest.mock import MagicMock

    from app.services.iac_snippets import build_iac_remediation

    f = _sg_finding()
    db = MagicMock()
    acc = MagicMock()
    acc.enable_remediation_sg = True
    acc.remediation_sg_deployed = True
    db.get.return_value = acc
    db.scalar.return_value = None
    db.scalars.return_value.all.return_value = []
    out = build_iac_remediation(db, f, f.org_id)
    ssm = out["ssm_remediation"]
    assert ssm["module_id"] == "security_groups"
    assert ssm["module_enabled"] is True
    assert ssm["automation_provider"] == "vigil"
    assert ssm["aws_document_name"] is None
    assert ssm["runbook"]["document_name"] == "Vigil-RevokeSecurityGroupIngressExact"


def test_iac_ssm_panel_s3_shows_aws_owned_metadata_execution_unchanged():
    from unittest.mock import MagicMock

    from app.services.iac_snippets import build_iac_remediation
    from app.services.ssm_remediation_catalog import runbook_for_check

    now = datetime.now(timezone.utc)
    f = Finding(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        account_id=uuid.uuid4(),
        check_id="s3.bucket.public_access_not_blocked",
        resource_arn="arn:aws:s3:::my-bucket",
        title="Public bucket",
        severity="high",
        risk_score=70,
        status="open",
        evidence={"bucket_name": "my-bucket"},
        first_seen=now,
        last_seen=now,
    )
    db = MagicMock()
    acc = MagicMock()
    acc.enable_remediation_s3 = True
    acc.remediation_s3_deployed = True
    db.get.return_value = acc
    db.scalar.return_value = None
    db.scalars.return_value.all.return_value = []
    out = build_iac_remediation(db, f, f.org_id)
    ssm = out["ssm_remediation"]
    assert ssm["automation_provider"] == "aws-owned"
    assert ssm["aws_document_name"] == "AWSConfigRemediation-ConfigureS3BucketPublicAccessBlock"
    assert ssm["automation_confidence"] == "high"
    exec_rb = runbook_for_check("s3.bucket.public_access_not_blocked")
    assert exec_rb is not None
    assert exec_rb.owner == "aws"
    assert ssm["runbook"]["document_name"] == "AWSConfigRemediation-ConfigureS3BucketPublicAccessBlock"
    assert ssm["requires_vigil_document"] is False


def test_iac_ssm_panel_iam_key_shows_vigil_metadata():
    from unittest.mock import MagicMock

    from app.services.iac_snippets import build_iac_remediation

    now = datetime.now(timezone.utc)
    f = Finding(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        account_id=uuid.uuid4(),
        check_id="iam.access_key.unused_90d",
        resource_arn="arn:aws:iam::123456789012:user/alice#AKIAEXAMPLE",
        title="Unused key",
        severity="high",
        risk_score=80,
        status="open",
        evidence={"user_arn": "arn:aws:iam::123456789012:user/alice", "key_id": "AKIAEXAMPLE"},
        first_seen=now,
        last_seen=now,
    )
    db = MagicMock()
    acc = MagicMock()
    acc.enable_remediation_iam_keys = True
    acc.remediation_iam_keys_deployed = True
    db.get.return_value = acc
    db.scalar.return_value = None
    db.scalars.return_value.all.return_value = []
    out = build_iac_remediation(db, f, f.org_id)
    ssm = out["ssm_remediation"]
    assert ssm["automation_provider"] == "vigil"
    assert ssm["runbook"]["document_name"] == "Vigil-DeactivateIamAccessKey"


def test_access_key_unused_plan_enables_automation():
    from unittest.mock import MagicMock

    from app.services.iac_snippets import build_iac_remediation

    now = datetime.now(timezone.utc)
    f = Finding(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        account_id=uuid.uuid4(),
        check_id="iam.access_key.unused_45d",
        resource_arn="arn:aws:iam::123456789012:user/alice#AKIAEXAMPLE",
        title="Unused access key",
        severity="high",
        risk_score=90,
        status="open",
        evidence={"user_arn": "arn:aws:iam::123456789012:user/alice", "key_id": "AKIAEXAMPLE"},
        first_seen=now,
        last_seen=now,
    )
    plan = build_remediation_plan(f)
    assert plan["supported_action"] == "deactivate_access_key"

    db = MagicMock()
    db.scalar.return_value = None
    db.scalars.return_value.all.return_value = []
    out = build_iac_remediation(db, f, f.org_id)
    assert out["apply_paths"]["customer_automation"] is True


def test_resolve_automation_region_vigil_custom_uses_home_region():
    from app.services.remediation_plan import resolve_automation_region

    # S3 uses AWS-owned runbook in the resource region
    assert (
        resolve_automation_region("s3.bucket.public_access_not_blocked", "eu-west-1")
        == "eu-west-1"
    )
    # SSM parameter — Vigil custom, uses home
    assert (
        resolve_automation_region("ssm.parameter.plaintext_secret", "eu-west-1")
        == "us-east-1"
    )
    # IAM keys — Vigil custom, uses home
    assert (
        resolve_automation_region("iam.access_key.unused_45d", "eu-west-1")
        == "us-east-1"
    )
    # Unknown check — falls through to resource region
    assert (
        resolve_automation_region("some.unknown.check", "eu-west-1")
        == "eu-west-1"
    )
    # Unknown check, no resource region — falls through to home
    assert (
        resolve_automation_region("some.unknown.check", None)
        == "us-east-1"
    )


def test_ssm_plan_uses_arn_region_and_enables_automation(monkeypatch):
    monkeypatch.setenv("REMEDIATION_AUTOMATION_REGION", "us-east-1")
    from app.core.config import get_settings

    get_settings.cache_clear()
    from unittest.mock import MagicMock

    from app.services.iac_snippets import build_iac_remediation

    now = datetime.now(timezone.utc)
    f = Finding(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        account_id=uuid.uuid4(),
        check_id="ssm.parameter.plaintext_secret",
        resource_arn="arn:aws:ssm:eu-west-1:123456789012:parameter/prod/db/password",
        title="Plaintext parameter",
        severity="high",
        risk_score=90,
        status="open",
        evidence={"parameter_name": "/prod/db/password", "parameter_type": "String"},
        first_seen=now,
        last_seen=now,
    )

    plan = build_remediation_plan(f)
    assert plan["resource_region"] == "eu-west-1"
    assert plan["automation_region"] == "us-east-1"
    assert plan["supported_action"] == "migrate_ssm_string_to_secure_string"

    db = MagicMock()
    db.scalar.return_value = None
    db.scalars.return_value.all.return_value = []
    out = build_iac_remediation(db, f, f.org_id)
    assert out["apply_paths"]["customer_automation"] is True
