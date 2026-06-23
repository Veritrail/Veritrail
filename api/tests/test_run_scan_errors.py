"""Tests for the early-bailout paths of run_scan + check-error isolation.

Full scan flow is exercised by integration; here we just verify:
- invalid account UUID returns a clean error without raising
- account-not-found returns a clean error without raising
- per-check exceptions are recorded in stats but the scan still succeeds
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch


def test_run_scan_invalid_account_id_returns_clean_error():
    from app.worker import tasks

    fake_db = MagicMock()
    with patch.object(tasks, "SessionLocal", return_value=fake_db):
        result = tasks.run_scan("not-a-uuid")

    assert result["ok"] is False
    assert "invalid account id" in result["error"]
    fake_db.close.assert_called()


def test_run_scan_account_not_found_returns_clean_error():
    from app.worker import tasks

    fake_db = MagicMock()
    fake_db.get.return_value = None
    with patch.object(tasks, "SessionLocal", return_value=fake_db):
        result = tasks.run_scan(str(uuid.uuid4()))

    assert result["ok"] is False
    assert "account not found" in result["error"]
    fake_db.close.assert_called()


_DICT_COLLECTORS = {
    "collect_iam",
    "collect_account_governance",
    "collect_vpc",
    "collect_ec2",
    "collect_ecs",
    "collect_inspector",
    "collect_backup",
}
_INT_COLLECTORS = {
    "collect_s3_account_public_access_block",
    "collect_s3",
    "collect_kms",
    "collect_cloudtrail",
    "collect_cloudtrail_events",
    "collect_guardduty",
    "collect_guardduty_findings",
    "collect_identity_center",
    "collect_config_compliance",
    "collect_rds",
    "collect_access_analyzer",
    "collect_config_service",
    "collect_securityhub",
    "collect_acm",
    "collect_lambda",
    "collect_secrets",
    "collect_ssm_parameters",
    "collect_iam_server_certificates",
    "collect_elb",
    "collect_dynamodb",
    "collect_sns",
    "collect_sqs",
    "collect_ecr",
    "collect_ecr_registry_settings",
    "collect_eks",
}


def _stub_all_collectors_ok(monkeypatch, tasks):
    """Stub every collector to succeed with a production-shaped return value."""
    shapes = {
        "collect_ec2": {"instances": 0, "volumes": 0, "snapshots": 0, "amis": 0, "ebs_regions": 0},
        "collect_ecs": {"clusters": 0, "services": 0, "task_definitions": 0},
        "collect_inspector": {"regions": 0, "findings": 0},
        "collect_backup": {"backup_plans": 0, "backup_vaults": 0},
    }
    for name in _DICT_COLLECTORS:
        monkeypatch.setattr(tasks, name, (lambda shape: lambda *a, **kw: shape)(shapes.get(name, {})))
    for name in _INT_COLLECTORS:
        monkeypatch.setattr(tasks, name, lambda *a, **kw: 0)


def test_run_scan_collector_failure_rolls_back_and_continues(monkeypatch):
    """If a collector raises, the pipeline rolls back that collector's
    uncommitted work, records it under stats.collector_errors, continues with
    the remaining collectors, and the scan still completes ok."""
    from app.worker import tasks

    fake_acc = MagicMock()
    fake_acc.id = uuid.uuid4()
    fake_acc.org_id = uuid.uuid4()
    fake_acc.role_arn = "arn:aws:iam::123456789012:role/VeritrailReadOnlyScannerRole"
    fake_acc.external_id = "ext"

    fake_run = MagicMock()
    fake_run.id = uuid.uuid4()
    fake_run.stats = {}

    fake_db = MagicMock()
    fake_db.get.side_effect = [fake_acc, None]  # AwsAccount, Org

    _stub_all_collectors_ok(monkeypatch, tasks)

    # One collector blows up after (hypothetically) writing partial rows.
    def _boom(*a, **kw):
        raise RuntimeError("synthetic collector failure")

    monkeypatch.setattr(tasks, "collect_iam", _boom)

    good_check = MagicMock()
    good_check.CHECK_ID = "test.good"
    good_check.run.return_value = []

    monkeypatch.setattr("app.worker.scan_pipeline.ALL_CHECKS", [good_check])
    monkeypatch.setattr("app.services.check_settings.is_check_enabled", lambda *a, **kw: True)
    monkeypatch.setattr("app.worker.scan_pipeline.persist_findings", lambda *a, **kw: (0, 0))
    monkeypatch.setattr("app.worker.scan_pipeline.build_snapshots_from_schema", lambda *a, **kw: [])
    monkeypatch.setattr(tasks, "ScanRun", lambda **kw: fake_run)
    monkeypatch.setattr(tasks.collect_perm_usage_task, "delay", lambda *a, **kw: None)

    with patch("app.worker.scan_pipeline.ensure_veritrail_role_trust", return_value=False), \
         patch.object(tasks, "SessionLocal", return_value=fake_db):
        result = tasks.run_scan(str(fake_acc.id))

    # Scan still completes despite the collector failure.
    assert result["ok"] is True
    # The failing collector triggered a rollback (its partial work is discarded).
    fake_db.rollback.assert_called()
    # Successful collectors still committed their work.
    fake_db.commit.assert_called()
    # The failure is surfaced in stats, not swallowed.
    assert "collector_errors" in fake_run.stats
    assert any(e["collector"] == "collect_iam" for e in fake_run.stats["collector_errors"])


def test_run_scan_check_failure_does_not_kill_scan(monkeypatch):
    """If a single check raises, the scan should still complete and record
    the failure under stats.check_errors (not flip the whole run to 'error')."""
    from app.worker import tasks

    # Stub: account exists, collectors return empty stats, one check raises,
    # the others succeed, persist returns (0, 0), snapshots returns 0.
    fake_acc = MagicMock()
    fake_acc.id = uuid.uuid4()
    fake_acc.org_id = uuid.uuid4()
    fake_acc.role_arn = "arn:aws:iam::123456789012:role/VeritrailReadOnlyScannerRole"
    fake_acc.external_id = "ext"

    fake_run = MagicMock()
    fake_run.id = uuid.uuid4()
    fake_run.stats = {}

    fake_db = MagicMock()
    # Two .get calls: 1) AwsAccount, 2) Org
    fake_db.get.side_effect = [fake_acc, None]

    # Stub every collector. collect_iam/vpc/ec2 must return dicts; the rest
    # return ints (matching production signatures).
    dict_collectors = {
        "collect_iam",
        "collect_account_governance",
        "collect_vpc",
        "collect_ec2",
        "collect_ecs",
        "collect_inspector",
        "collect_backup",
    }
    int_collectors = {
        "collect_s3_account_public_access_block",
        "collect_s3",
        "collect_kms",
        "collect_cloudtrail",
        "collect_cloudtrail_events",
        "collect_guardduty",
        "collect_guardduty_findings",
        "collect_identity_center",
        "collect_config_compliance",
        "collect_rds",
        "collect_access_analyzer",
        "collect_config_service",
        "collect_securityhub",
        "collect_acm",
        "collect_lambda",
        "collect_secrets",
        "collect_ssm_parameters",
        "collect_iam_server_certificates",
        "collect_elb",
        "collect_dynamodb",
        "collect_sns",
        "collect_sqs",
        "collect_ecr",
        "collect_ecr_registry_settings",
        "collect_eks",
    }
    for name in dict_collectors:
        if name == "collect_ec2":
            monkeypatch.setattr(tasks, name, lambda *a, **kw: {"instances": 0, "volumes": 0, "snapshots": 0, "amis": 0, "ebs_regions": 0})
        elif name == "collect_ecs":
            monkeypatch.setattr(tasks, name, lambda *a, **kw: {"clusters": 0, "services": 0, "task_definitions": 0})
        elif name == "collect_inspector":
            monkeypatch.setattr(tasks, name, lambda *a, **kw: {"regions": 0, "findings": 0})
        elif name == "collect_backup":
            monkeypatch.setattr(tasks, name, lambda *a, **kw: {"backup_plans": 0, "backup_vaults": 0})
        else:
            monkeypatch.setattr(tasks, name, lambda *a, **kw: {})
    for name in int_collectors:
        monkeypatch.setattr(tasks, name, lambda *a, **kw: 0)

    good_check = MagicMock()
    good_check.CHECK_ID = "test.good"
    good_check.run.return_value = []

    bad_check = MagicMock()
    bad_check.CHECK_ID = "test.bad"
    bad_check.run.side_effect = RuntimeError("synthetic check failure")

    monkeypatch.setattr("app.worker.scan_pipeline.ALL_CHECKS", [good_check, bad_check])
    monkeypatch.setattr("app.services.check_settings.is_check_enabled", lambda *a, **kw: True)
    monkeypatch.setattr("app.worker.scan_pipeline.persist_findings", lambda *a, **kw: (0, 0))
    monkeypatch.setattr("app.worker.scan_pipeline.build_snapshots_from_schema", lambda *a, **kw: [])
    monkeypatch.setattr(tasks, "ScanRun", lambda **kw: fake_run)
    monkeypatch.setattr(tasks.collect_perm_usage_task, "delay", lambda *a, **kw: None)

    # CI uses APP_ENV=dev from .env.example; ensure_veritrail_role_trust calls STS without creds.
    with patch("app.worker.scan_pipeline.ensure_veritrail_role_trust", return_value=False), \
         patch.object(tasks, "SessionLocal", return_value=fake_db):
        result = tasks.run_scan(str(fake_acc.id))

    assert result["ok"] is True
    # The scan completed; the failing check is recorded in stats.check_errors
    assert fake_run.status == "degraded"
    assert "check_errors" in fake_run.stats
    assert any(e["check_id"] == "test.bad" for e in fake_run.stats["check_errors"])
