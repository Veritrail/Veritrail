"""Tests for findings org-level scope filters (all_cloud, source_control)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models import AwsAccount, Finding
from app.models.gcp_project import GcpProject
from app.models.org import Org, User
from app.routes.findings import findings_summary, list_findings
from app.services.findings_scope import apply_findings_scope


def _seed_org_user(db):
    org = Org(name="Findings Scope Co")
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


def _seed_mixed_findings(db_session):
    org, user = _seed_org_user(db_session)
    aws = AwsAccount(
        org_id=org.id,
        label="Prod",
        account_id="123456789012",
        external_id="ext-aws",
        status="connected",
    )
    gcp = GcpProject(org_id=org.id, project_id="demo-gcp", label="Demo GCP", status="connected")
    db_session.add_all([aws, gcp])
    db_session.flush()

    aws_finding = _finding(org.id, account_id=aws.id)
    gcp_finding = _finding(
        org.id,
        account_id=None,
        gcp_project_id=gcp.id,
        check_id="gcp.logging.not_enabled",
        resource_arn="gcp://logging/demo-gcp",
    )
    github_finding = _finding(
        org.id,
        account_id=None,
        check_id="github.branch_protection.missing",
        resource_arn="github://org/acme/repo/app",
    )
    gitlab_finding = _finding(
        org.id,
        account_id=None,
        check_id="gitlab.merge_request_approvals.missing",
        resource_arn="gitlab://group/acme/project/app",
    )
    entra_finding = _finding(
        org.id,
        account_id=None,
        check_id="entra.org.mfa_not_enforced",
        resource_arn="entra://trial/org",
    )
    scanner_finding = _finding(
        org.id,
        account_id=None,
        check_id="scanner.wiz.cve_open",
        resource_arn="scanner://wiz/issue/1",
    )
    db_session.add_all([aws_finding, gcp_finding, github_finding, gitlab_finding, entra_finding, scanner_finding])
    db_session.flush()
    return org, user, aws, gcp


def _list_findings(db_session, org, user, **kwargs):
    principal = {"org_id": str(org.id), "sub": str(user.id)}
    return list_findings(
        status_filter=kwargs.pop("status_filter", "all"),
        cursor=None,
        limit=100,
        p=principal,
        db=db_session,
        **kwargs,
    )


def test_all_cloud_excludes_source_control_and_scanner(db_session):
    org, user, aws, _gcp = _seed_mixed_findings(db_session)

    page = _list_findings(db_session, org, user, provider="all_cloud")
    check_ids = {item.check_id for item in page.items}
    assert "iam.user.no_mfa" in check_ids
    assert "gcp.logging.not_enabled" in check_ids
    assert "github.branch_protection.missing" not in check_ids
    assert "gitlab.merge_request_approvals.missing" not in check_ids
    assert "entra.org.mfa_not_enforced" not in check_ids
    assert "scanner.wiz.cve_open" not in check_ids
    assert page.total == 2

    summary = findings_summary(provider="all_cloud", p={"org_id": str(org.id), "sub": str(user.id)}, db=db_session)
    assert summary.total == 2


def test_source_control_includes_github_and_gitlab_only(db_session):
    org, user, _aws, _gcp = _seed_mixed_findings(db_session)

    page = _list_findings(db_session, org, user, provider="source_control")
    check_ids = {item.check_id for item in page.items}
    assert check_ids == {
        "github.branch_protection.missing",
        "gitlab.merge_request_approvals.missing",
    }
    assert page.total == 2

    summary = findings_summary(provider="source_control", p={"org_id": str(org.id), "sub": str(user.id)}, db=db_session)
    assert summary.total == 2


def test_identity_includes_entra_and_workspace_only(db_session):
    org, user, _aws, _gcp = _seed_mixed_findings(db_session)

    page = _list_findings(db_session, org, user, provider="identity")
    check_ids = {item.check_id for item in page.items}
    assert check_ids == {"entra.org.mfa_not_enforced"}
    assert page.total == 1

    summary = findings_summary(provider="identity", p={"org_id": str(org.id), "sub": str(user.id)}, db=db_session)
    assert summary.total == 1


def test_provider_identity_rejects_cloud_account_params(db_session):
    org, user, aws, _gcp = _seed_mixed_findings(db_session)

    with pytest.raises(HTTPException) as exc:
        _list_findings(
            db_session,
            org,
            user,
            provider="identity",
            account_id=str(aws.id),
        )
    assert exc.value.status_code == 400


def test_legacy_github_and_gitlab_providers_unchanged(db_session):
    org, user, _aws, _gcp = _seed_mixed_findings(db_session)

    github_page = _list_findings(db_session, org, user, provider="github")
    assert github_page.total == 1
    assert github_page.items[0].check_id == "github.branch_protection.missing"

    gitlab_page = _list_findings(db_session, org, user, provider="gitlab")
    assert gitlab_page.total == 1
    assert gitlab_page.items[0].check_id == "gitlab.merge_request_approvals.missing"


def test_unscoped_list_returns_all_org_findings(db_session):
    org, user, _aws, _gcp = _seed_mixed_findings(db_session)

    page = _list_findings(db_session, org, user)
    assert page.total == 6


def test_provider_all_cloud_rejects_cloud_account_params(db_session):
    org, user, aws, _gcp = _seed_mixed_findings(db_session)

    with pytest.raises(HTTPException) as exc:
        _list_findings(db_session, org, user, provider="all_cloud", account_id=str(aws.id))
    assert exc.value.status_code == 400


def test_provider_source_control_rejects_cloud_account_params(db_session):
    org, user, aws, _gcp = _seed_mixed_findings(db_session)

    with pytest.raises(HTTPException) as exc:
        _list_findings(
            db_session,
            org,
            user,
            provider="source_control",
            gcp_project_id=str(uuid.uuid4()),
        )
    assert exc.value.status_code == 400


def test_invalid_provider_returns_400(db_session):
    org, user, _aws, _gcp = _seed_mixed_findings(db_session)

    with pytest.raises(HTTPException) as exc:
        _list_findings(db_session, org, user, provider="invalid")
    assert exc.value.status_code == 400


def test_export_scope_matches_list_filters(db_session):
    org, user, _aws, _gcp = _seed_mixed_findings(db_session)
    org_id = org.id

    def scoped_check_ids(*, provider: str | None) -> set[str]:
        q = apply_findings_scope(
            select(Finding.check_id).where(Finding.org_id == org_id),
            provider=provider,
            account_id=None,
            gcp_project_id=None,
            azure_subscription_id=None,
        )
        return set(db_session.scalars(q).all())

    assert scoped_check_ids(provider="all_cloud") == {"iam.user.no_mfa", "gcp.logging.not_enabled"}
    assert scoped_check_ids(provider="source_control") == {
        "github.branch_protection.missing",
        "gitlab.merge_request_approvals.missing",
    }
    assert scoped_check_ids(provider="identity") == {"entra.org.mfa_not_enforced"}
