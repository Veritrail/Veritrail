"""Tests for GET /v1/findings/summary."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.models import Finding
from app.models.org import Org, User
from app.routes.findings import findings_summary


def _seed_org_user(db):
    org = Org(name="Summary Test Co")
    db.add(org)
    db.flush()
    user = User(org_id=org.id, email=f"u{uuid.uuid4().hex[:8]}@example.com", password_hash="x", role="admin")
    db.add(user)
    db.flush()
    return org, user


def _finding(org_id, **kwargs):
    now = datetime.now(timezone.utc)
    defaults = dict(
        org_id=org_id,
        check_id="iam.user.no_mfa",
        resource_arn="arn:aws:iam::123456789012:user/alice",
        title="No MFA",
        severity="high",
        risk_score=70,
        status="open",
        evidence={},
        first_seen=now,
        last_seen=now,
    )
    defaults.update(kwargs)
    return Finding(**defaults)


def test_findings_summary(db_session):
    org, user = _seed_org_user(db_session)
    db_session.add(_finding(org.id, severity="high"))
    db_session.add(_finding(org.id, severity="critical"))
    db_session.add(
        _finding(
            org.id,
            status="resolved",
            severity="low",
            check_id="s3.bucket.public_read",
            resource_arn="arn:aws:s3:::bucket",
        )
    )
    db_session.flush()

    out = findings_summary(p={"org_id": str(org.id), "sub": str(user.id)}, db=db_session)
    assert out.total >= 3
    assert out.by_status.get("open", 0) >= 2
    assert out.by_severity.get("critical", 0) >= 1
    assert any(row["check_id"] == "iam.user.no_mfa" for row in out.top_checks)
