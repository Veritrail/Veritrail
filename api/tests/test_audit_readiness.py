"""Tests for audit readiness narrative builder and API."""
from __future__ import annotations

import uuid

import pytest

from app.models import Org, User
from app.services.org_membership import add_membership
from app.services.audit_readiness import build_audit_readiness
from app.services.pdf_narrative import affirmation_status, domain_section_as_dict
from tests.test_pdf_narrative import NOW, _control, _sections


def test_affirmation_status_markers():
    assert affirmation_status(checks_total=3, checks_passing=3) == "supported"
    assert affirmation_status(checks_total=3, checks_passing=1) == "partially_supported"
    assert affirmation_status(checks_total=3, checks_passing=0) == "not_affirmed"


def test_domain_section_as_dict_preserves_auditor_phrasing():
    controls = [
        _control("CC6.1", ["iam.user.no_mfa"]),
        _control(
            "CC7.2",
            ["cloudtrail.trail.not_enabled"],
            findings=[
                {
                    "id": "f1",
                    "check_id": "cloudtrail.trail.not_enabled",
                    "resource_arn": "arn:aws:cloudtrail:us-east-1:1:trail/t",
                    "title": "Trail off",
                    "severity": "high",
                    "status": "open",
                    "first_seen": NOW.isoformat(),
                    "last_seen": NOW.isoformat(),
                }
            ],
            status="fail",
        ),
    ]
    sections = _sections(controls)
    sec = next(s for s in sections if s.key == "identity_access")
    payload = domain_section_as_dict(sec, temporal_sentence="On 2026-Jul-01, 1 finding remediated.")
    assert payload["status"] == "supported"
    lowered = payload["assertion_text"].lower()
    for banned in ("fulfills", "is secure", "is compliant"):
        assert banned not in lowered
    for other in sections:
        other_lower = other.assertion.lower()
        for banned in ("fulfills", "is secure", "is compliant"):
            assert banned not in other_lower
    assert payload["temporal_sentence"] == "On 2026-Jul-01, 1 finding remediated."
    assert "assertion_text" in payload
    assert "coverage_line" in payload
    assert "control_tags" in payload


def test_audit_readiness_route(db_session):
    from fastapi.testclient import TestClient

    from app.core.db import get_db
    from app.core.security import current_principal
    from app.main import app

    client = TestClient(app)
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    db_session.add(Org(id=org_id, name="Audit Org"))
    db_session.add(
        User(id=user_id, org_id=org_id, email="viewer@audit.test", password_hash="x", role="viewer")
    )
    add_membership(db_session, user_id, org_id, "viewer")
    db_session.flush()

    client.app.dependency_overrides[get_db] = lambda: db_session
    client.app.dependency_overrides[current_principal] = lambda: {
        "sub": str(user_id),
        "org_id": str(org_id),
        "role": "viewer",
    }
    try:
        res = client.get("/v1/audit-readiness?framework=soc2")
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["framework"] == "soc2"
        assert body["org_name"] == "Audit Org"
        assert isinstance(body["domains"], list)
    finally:
        client.app.dependency_overrides.clear()


def test_build_audit_readiness_empty_org(db_session):
    org_id = uuid.uuid4()
    db_session.add(Org(id=org_id, name="Empty Org"))
    db_session.flush()
    payload = build_audit_readiness(db_session, org_id, "soc2")
    assert payload["org_name"] == "Empty Org"
    # No connected accounts, but framework controls still produce capability domains.
    assert isinstance(payload["domains"], list)
    assert len(payload["domains"]) > 0
    for domain in payload["domains"]:
        assert domain["status"] == "supported"
        assert domain["checks_total"] >= 0
