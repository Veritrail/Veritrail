"""Tests for evidence source ORM store."""
from __future__ import annotations

import uuid

from app.models.evidence_source import EvidenceSource
from app.models.org import Org
from app.services.evidence_source_store import apply_evidence_source_updates, load_evidence_sources


def test_load_imports_legacy_settings(db_session):
    org_id = uuid.uuid4()
    org = Org(
        id=org_id,
        name="Legacy Org",
        settings={
            "evidence_sources": {
                "vulnerability_management": {
                    "vendor": "Wiz",
                    "scope_description": "Prod",
                }
            }
        },
    )
    db_session.add(org)
    db_session.flush()

    sources = load_evidence_sources(db_session, org_id)
    assert sources["vulnerability_management"]["vendor"] == "Wiz"
    row = db_session.query(EvidenceSource).filter(EvidenceSource.org_id == org_id).one()
    assert row.vendor == "Wiz"
    db_session.refresh(org)
    assert "evidence_sources" not in (org.settings or {})


def test_apply_evidence_source_updates_upsert_and_clear(db_session):
    org_id = uuid.uuid4()
    org = Org(id=org_id, name="Acme", settings={})
    db_session.add(org)
    db_session.flush()

    apply_evidence_source_updates(
        db_session,
        org_id,
        {"endpoint_security": {"vendor": "CrowdStrike", "cadence": "Monthly"}},
        user_id=None,
    )
    db_session.flush()
    sources = load_evidence_sources(db_session, org_id)
    assert sources["endpoint_security"]["vendor"] == "CrowdStrike"

    apply_evidence_source_updates(db_session, org_id, {"endpoint_security": {"vendor": ""}})
    db_session.flush()
    assert load_evidence_sources(db_session, org_id) == {}
