from unittest.mock import MagicMock

from app.services.iac_snippets import build_iac_remediation
from app.services.terraform_iac import preview_terraform_patch
from app.models import Finding
import uuid
from datetime import datetime, timezone


def _db_no_github():
    db = MagicMock()
    db.scalar.return_value = None
    db.scalars.return_value.all.return_value = []
    return db


def _finding(**kwargs) -> Finding:
    now = datetime.now(timezone.utc)
    base = dict(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        account_id=uuid.uuid4(),
        check_id="s3.bucket.public_access_not_blocked",
        resource_arn="arn:aws:s3:::app-logs-prod",
        title="test",
        severity="high",
        risk_score=80,
        status="open",
        evidence={"bucket_name": "app-logs-prod"},
        first_seen=now,
        last_seen=now,
    )
    base.update(kwargs)
    return Finding(**base)


def test_s3_public_access_snippet():
    f = _finding()
    out = build_iac_remediation(_db_no_github(), f, f.org_id)
    assert out["iac_status"] == "iac_snippets"
    assert "aws_s3_bucket_public_access_block" in out["terraform"]
    assert "app-logs-prod" in out["cli"][0]


def test_terraform_preview_create_pab():
    tf = '''
resource "aws_s3_bucket" "logs" {
  bucket = "app-logs-prod"
}
'''
    out = preview_terraform_patch(
        check_id="s3.bucket.public_access_not_blocked",
        bucket_name="app-logs-prod",
        files=[{"path": "s3.tf", "content": tf}],
    )
    assert out["status"] == "create_new"
    assert "aws_s3_bucket_public_access_block" in out["suggested_hcl"]


def test_terraform_preview_modify_existing_pab():
    tf = '''
resource "aws_s3_bucket" "logs" {
  bucket = "app-logs-prod"
}
resource "aws_s3_bucket_public_access_block" "logs" {
  bucket = aws_s3_bucket.logs.id
  block_public_acls = false
}
'''
    out = preview_terraform_patch(
        check_id="s3.bucket.public_access_not_blocked",
        bucket_name="app-logs-prod",
        files=[{"path": "s3.tf", "content": tf}],
    )
    assert out["status"] == "modify_existing"
    assert out["public_access_block"]["name"] == "logs"


def test_kms_wildcard_check_import():
    from app.checks.kms_key_policy_wildcard import CHECK_ID

    assert CHECK_ID == "kms.key.policy_wildcard_principal"


def _registry_check_ids() -> set[str]:
    from app.checks.registry import ALL_CHECKS

    return {m.CHECK_ID for m in ALL_CHECKS}


def test_all_builder_keys_map_to_real_checks():
    """Every IaC builder must be keyed to a check that actually exists, else
    the builder is dead code and the real finding silently falls back to the
    generic 'no IaC template' message. (Regression: 6 builders were keyed to
    non-existent check IDs.)"""
    from app.services.iac_snippets import _BUILDERS

    real = _registry_check_ids()
    orphans = sorted(set(_BUILDERS) - real)
    assert not orphans, f"_BUILDERS keyed to non-existent checks: {orphans}"


def test_terraform_snippet_gate_is_real_and_emits_tf():
    """Every check in the PR-gate set must be real and have a builder that
    actually returns a terraform snippet."""
    from app.services.iac_snippets import _BUILDERS, _TERRAFORM_SNIPPET_CHECKS

    real = _registry_check_ids()
    orphans = sorted(_TERRAFORM_SNIPPET_CHECKS - real)
    assert not orphans, f"_TERRAFORM_SNIPPET_CHECKS has non-existent checks: {orphans}"

    missing_builder = sorted(_TERRAFORM_SNIPPET_CHECKS - set(_BUILDERS))
    assert not missing_builder, f"gate lists checks with no builder: {missing_builder}"

    for cid in _TERRAFORM_SNIPPET_CHECKS:
        out = _BUILDERS[cid](_finding(check_id=cid, evidence={}), {})
        assert out.get("terraform"), f"{cid} builder returned no terraform"
        # HCL should never contain adjacent double braces — that signals an
        # f-string escaping bug. (CLI/JSON snippets legitimately nest braces.)
        assert "{{" not in out["terraform"] and "}}" not in out["terraform"], f"{cid} HCL has unescaped braces"


_NEW_BUILDER_CASES = [
    ("rds.instance.no_encryption", {"db_instance_id": "prod-db"}, "storage_encrypted", "prod-db"),
    ("rds.instance.no_deletion_protection", {"db_instance_id": "prod-db"}, "deletion_protection", "prod-db"),
    ("s3.bucket.no_default_encryption", {"bucket_name": "app-logs"}, "aws_s3_bucket_server_side_encryption_configuration", "app-logs"),
    ("dynamodb.table.no_encryption", {"table_name": "orders"}, "server_side_encryption", "orders"),
    ("dynamodb.table.no_pitr", {"table_name": "orders"}, "point_in_time_recovery", "orders"),
    ("ec2.instance.imdsv2_not_required", {"instance_id": "i-0abc", "region": "us-east-1"}, "http_tokens", "i-0abc"),
    ("cloudtrail.trail.no_log_validation", {"trail_name": "org-trail"}, "enable_log_file_validation", "org-trail"),
    ("eks.cluster.control_plane_logging_disabled", {"cluster_name": "prod"}, "enabled_cluster_log_types", "prod"),
    ("ecr.registry.enhanced_scanning_disabled", {"region": "us-east-1"}, "aws_ecr_registry_scanning_configuration", "ENHANCED"),
    ("lambda.function.public_url", {"function_name": "checkout"}, "authorization_type", "checkout"),
    ("vpc.flow_logs.not_enabled", {"vpc_id": "vpc-1", "region": "us-east-1"}, "aws_flow_log", "vpc-1"),
    ("elb.load_balancer.no_access_logs", {"name": "web-alb"}, "access_logs", "web-alb"),
    ("guardduty.detector.not_enabled", {"disabled_regions": ["us-east-1"]}, "aws_guardduty_detector", "enable"),
]


def test_new_builders_emit_expected_terraform():
    for cid, ev, needle, _token in _NEW_BUILDER_CASES:
        f = _finding(check_id=cid, evidence=ev, resource_arn=f"arn:aws:x:::r/{ev.get('db_instance_id') or ev.get('table_name') or ev.get('instance_id') or ev.get('trail_name') or ev.get('cluster_name') or ev.get('function_name') or ev.get('vpc_id') or ev.get('name') or 'r'}")
        out = build_iac_remediation(_db_no_github(), f, f.org_id)
        assert out["iac_status"] == "iac_snippets", f"{cid} not rendered"
        assert needle in out["terraform"], f"{cid} missing {needle!r} in terraform"
