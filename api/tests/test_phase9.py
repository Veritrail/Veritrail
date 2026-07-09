"""Phase 9 deferred P4 tests."""
from __future__ import annotations

import uuid
from unittest.mock import patch

from app.models.org import Org
from app.services.questionnaire import build_questionnaire


def _org(db_session):
    org_id = uuid.uuid4()
    db_session.add(Org(id=org_id, name="Phase 9 Org"))
    db_session.flush()
    return db_session.get(Org, org_id)


def test_heuristic_ai_pack_summary():
    from app.services.ai_pack_summary import build_ai_pack_summary

    controls = [
        {"control_id": "CC6.1", "title": "Access", "status": "fail", "finding_count": 2, "status_note": "open"},
        {"control_id": "CC6.2", "title": "Creds", "status": "pass", "finding_count": 0},
        {"control_id": "CC7.1", "title": "Changes", "status": "at_risk", "finding_count": 1},
    ]
    out = build_ai_pack_summary(controls, framework="soc2", period_days=90, account_label="prod")
    assert out["mode"] == "heuristic"
    assert "CC6.1" in out["executive_summary"]
    assert out["stats"]["fail"] == 1
    assert out["stats"]["pass"] == 1


def test_questionnaire_soc2_shape(db_session):
    org = _org(db_session)
    out = build_questionnaire(db_session, org.id, "soc2")
    assert out["framework"] == "soc2"
    assert out["control_count"] > 0
    assert "long_answer" in out["controls"][0]


def test_org_framework_crud(db_session):
    from app.services.org_frameworks import delete_org_framework, list_org_frameworks, upsert_org_framework

    org = _org(db_session)
    row = upsert_org_framework(
        db_session,
        org.id,
        slug="internal-soc",
        label="Internal SOC",
        description="Custom controls",
        control_definitions=[
            {"control_id": "INT-1", "title": "Laptops", "check_ids": ["intune.device.not_encrypted"]},
        ],
    )
    db_session.commit()
    assert row.slug == "internal-soc"
    assert len(list_org_frameworks(db_session, org.id)) == 1
    q = build_questionnaire(db_session, org.id, "org:internal-soc")
    assert q["custom"] is True
    assert q["controls"][0]["control_id"] == "INT-1"
    assert delete_org_framework(db_session, org.id, "internal-soc")
    db_session.commit()
def test_sync_evidence_requirements(db_session):
    from app.services.control_coverage_store import sync_evidence_requirements

    org = _org(db_session)
    n = sync_evidence_requirements(db_session, org.id, "soc2")
    db_session.commit()
    assert n > 0


def test_intune_sync_mock(db_session):
    from app.models.github import IdentityProvider
    from app.services.intune_sync import set_provider_config, sync_intune_provider

    org = _org(db_session)
    provider = IdentityProvider(
        id=uuid.uuid4(),
        org_id=org.id,
        type="intune",
        config_json_encrypted="{}",
        status="pending",
    )
    db_session.add(provider)
    set_provider_config(
        provider,
        {"tenant_id": "tenant-1", "access_token": "tok"},
    )
    db_session.commit()
    devices = [
        {"id": "d1", "deviceName": "MacBook", "isEncrypted": False, "complianceState": "noncompliant", "operatingSystem": "macOS"},
        {"id": "d2", "deviceName": "Surface", "isEncrypted": True, "complianceState": "compliant", "operatingSystem": "Windows"},
    ]

    def fake_paginate(_client, _token):
        return devices

    with patch("app.services.intune_sync._paginate_devices", fake_paginate):
        stats = sync_intune_provider(db_session, provider)
    assert stats.devices == 2
    assert stats.unencrypted == 1


def test_hr_vendor_categories_registered():
    from app.services.evidence_source_registry import EVIDENCE_SOURCE_CATEGORIES, EXTERNAL_EVIDENCE_ONLY_CATEGORY_KEYS

    keys = {c["key"] for c in EVIDENCE_SOURCE_CATEGORIES}
    assert "hr_training" in keys
    assert "vendor_risk" in keys
    assert "hr_training" in EXTERNAL_EVIDENCE_ONLY_CATEGORY_KEYS
