import uuid

import pytest

from app.services.evidence_vault import (
    object_key_for_pack,
    parse_s3_uri,
    plan_vault_upload,
    vault_enabled,
)


def test_parse_s3_uri():
    loc = parse_s3_uri("s3://my-bucket/veritrail-evidence/prod")
    assert loc.bucket == "my-bucket"
    assert loc.prefix == "veritrail-evidence/prod"
    assert loc.base_uri == "s3://my-bucket/veritrail-evidence/prod"


def test_parse_s3_uri_bucket_only():
    loc = parse_s3_uri("s3://bucket-only")
    assert loc.bucket == "bucket-only"
    assert loc.prefix == ""


def test_parse_s3_uri_invalid():
    with pytest.raises(ValueError):
        parse_s3_uri("https://example.com/nope")


def test_object_key_is_immutable_per_report():
    ts = __import__("datetime").datetime(2026, 5, 1, tzinfo=__import__("datetime").timezone.utc)
    k1 = object_key_for_pack(
        prefix="veritrail-worm-storage",
        app_env="dev",
        aws_account_id="946796614687",
        report_id="REPORT001",
        generated_at=ts,
    )
    k2 = object_key_for_pack(
        prefix="veritrail-worm-storage",
        app_env="dev",
        aws_account_id="946796614687",
        report_id="REPORT002",
        generated_at=ts,
    )
    assert k1 != k2
    assert k1.endswith("REPORT001.zip")
    assert "/dev/946796614687/2026-05-01/" in k1


def test_plan_returns_none_when_disabled(monkeypatch):
    monkeypatch.setenv("EVIDENCE_VAULT_ENABLED", "false")
    monkeypatch.setenv("EVIDENCE_VAULT_S3_URI", "")
    from app.core.config import get_settings

    get_settings.cache_clear()

    plan = plan_vault_upload(
        org_id=uuid.uuid4(),
        account_id=uuid.uuid4(),
        report_id="R1",
        framework="soc2",
    )
    assert plan is None
    assert vault_enabled() is False


def test_plan_when_enabled(monkeypatch):
    monkeypatch.setenv("EVIDENCE_VAULT_ENABLED", "true")
    monkeypatch.setenv("EVIDENCE_VAULT_S3_URI", "s3://audit-vault/veritrail")
    from app.core.config import get_settings

    get_settings.cache_clear()

    org = uuid.uuid4()
    acc = uuid.uuid4()
    plan = plan_vault_upload(
        org_id=org,
        account_id=acc,
        report_id="REPORT99",
        framework="cis_aws_l1",
        content_sha256="abc",
    )
    assert plan is not None
    assert plan.s3_uri.startswith("s3://audit-vault/")
    assert "REPORT99.zip" in plan.object_key
    assert "REPORT99.zip" in plan.object_key
