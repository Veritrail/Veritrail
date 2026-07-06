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
def test_findings_summary_scoped_to_gcp_project(db_session):
    from app.models.gcp_project import GcpProject

    org, user = _seed_org_user(db_session)
    project = GcpProject(org_id=org.id, project_id="carwiz-prod", label="carwiz", status="connected")
    db_session.add(project)
    db_session.flush()
    db_session.add(_finding(org.id, severity="high"))
    db_session.add(
        _finding(
            org.id,
            severity="critical",
            check_id="gcp.logging.not_enabled",
            resource_arn="gcp://project/carwiz-prod/logging",
            gcp_project_id=project.id,
            account_id=None,
        )
    )
    db_session.flush()

    out_all = findings_summary(p={"org_id": str(org.id), "sub": str(user.id)}, db=db_session)
    out_scoped = findings_summary(
        gcp_project_id=str(project.id),
        p={"org_id": str(org.id), "sub": str(user.id)},
        db=db_session,
    )
    assert out_all.total >= 2
    assert out_scoped.total == 1
    assert out_scoped.by_severity.get("critical", 0) == 1


def test_findings_summary_all_cloud_and_source_control(db_session):
    from app.models import AwsAccount

    org, user = _seed_org_user(db_session)
    aws = AwsAccount(
        org_id=org.id,
        label="Prod",
        account_id="123456789012",
        external_id="ext-aws",
        status="connected",
    )
    db_session.add(aws)
    db_session.flush()
    db_session.add(_finding(org.id, account_id=aws.id))
    db_session.add(
        _finding(
            org.id,
            account_id=None,
            check_id="github.branch_protection.missing",
            resource_arn="github://org/acme/repo/app",
        )
    )
    db_session.flush()

    principal = {"org_id": str(org.id), "sub": str(user.id)}
    out_all_cloud = findings_summary(provider="all_cloud", p=principal, db=db_session)
    out_scm = findings_summary(provider="source_control", p=principal, db=db_session)
    assert out_all_cloud.total == 1
    assert out_scm.total == 1
