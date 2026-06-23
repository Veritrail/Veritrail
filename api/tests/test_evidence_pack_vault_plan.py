import base64
import os
import uuid
from datetime import datetime, timezone

from app.services.evidence_vault import plan_vault_upload, vault_enabled


def test_vault_plan_included_when_enabled(monkeypatch):
    seed = os.urandom(32)
    monkeypatch.setenv("EVIDENCE_VAULT_ENABLED", "true")
    monkeypatch.setenv("EVIDENCE_VAULT_S3_URI", "s3://vault-bucket/veritrail")
    from app.core.config import get_settings

    get_settings.cache_clear()

    org = uuid.uuid4()
    acc = uuid.uuid4()
    plan = plan_vault_upload(
        org_id=org,
        account_id=acc,
        report_id="RPT001",
        framework="soc2",
        generated_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
    )
    assert plan is not None
    assert vault_enabled()
    manifest = plan.to_manifest()
    assert manifest["s3_uri"].startswith("s3://vault-bucket/")
