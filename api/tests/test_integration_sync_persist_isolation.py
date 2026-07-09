"""Org isolation for identity integration (org-scoped, account_id NULL) persistence."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select

from app.checks.base import FindingDraft
from app.checks.persist import persist_org_findings
from app.models import Finding
from app.models.github import IdentityProvider
from app.models.org import Org
from app.services.composite_controls import load_integration_sync_grading_context
from app.services.integration_sync_scan import resolve_integration_sync_findings_on_disconnect

CHECK = "entra.org.mfa_not_enforced"
WORKSPACE_CHECK = "google_workspace.org.mfa_not_enforced"


def _org(db, name):
    org = Org(name=name)
    db.add(org)
    db.flush()
    return org


def _entra_draft(tenant_id):
    return FindingDraft(
        check_id=CHECK,
        resource_arn=f"entra://{tenant_id}/org",
        title="Entra MFA policy not enforced",
        severity="high",
        risk_score=70,
        evidence={},
    )


def _workspace_draft(domain):
    return FindingDraft(
        check_id=WORKSPACE_CHECK,
        resource_arn=f"google_workspace://{domain}/org",
        title="Google Workspace MFA policy not enforced",
        severity="high",
        risk_score=70,
        evidence={},
    )


def _identity_provider(db, org_id, provider_type: str) -> IdentityProvider:
    provider = IdentityProvider(
        org_id=org_id,
        type=provider_type,
        status="connected",
        config_json_encrypted="{}",
        last_synced_at=datetime(2026, 7, 8, 12, 0, tzinfo=timezone.utc),
    )
    db.add(provider)
    db.flush()
    return provider


def test_integration_sync_persist_is_org_isolated(db_session):
    org_a = _org(db_session, "Org A")
    org_b = _org(db_session, "Org B")

    persist_org_findings(db_session, org_id=org_b.id, drafts=[_entra_draft("trial-b")], check_ids_run={CHECK})
    persist_org_findings(db_session, org_id=org_a.id, drafts=[_entra_draft("trial-a")], check_ids_run={CHECK})

    b_rows = db_session.scalars(_select_findings(org_b.id)).all()
    a_rows = db_session.scalars(_select_findings(org_a.id)).all()

    assert len(b_rows) == 1
    assert b_rows[0].status == "open"
    assert b_rows[0].resource_arn == "entra://trial-b/org"
    assert len(a_rows) == 1
    assert a_rows[0].resource_arn == "entra://trial-a/org"


def test_disconnect_resolves_open_entra_findings(db_session):
    org = _org(db_session, "Entra Disconnect Co")
    persist_org_findings(db_session, org_id=org.id, drafts=[_entra_draft("trial")], check_ids_run={CHECK})

    row = db_session.scalars(_select_findings(org.id)).one()
    assert row.status == "open"

    resolved = resolve_integration_sync_findings_on_disconnect(db_session, org.id, "entra_id")
    assert resolved == 1

    row = db_session.scalars(_select_findings(org.id)).one()
    assert row.status == "resolved"
    assert row.resolved_at is not None


def test_grading_context_ignores_stale_workspace_when_only_entra_connected(db_session):
    org = _org(db_session, "Entra Only Co")
    _identity_provider(db_session, org.id, "entra_id")
    persist_org_findings(
        db_session, org_id=org.id, drafts=[_workspace_draft("stale-domain")], check_ids_run={WORKSPACE_CHECK}
    )
    persist_org_findings(
        db_session, org_id=org.id, drafts=[_entra_draft("tenant-1")], check_ids_run={CHECK}
    )

    open_by_check: dict = {}
    latest_checks_run: set[str] = set()
    synced = load_integration_sync_grading_context(
        db_session, org.id, open_by_check, latest_checks_run, hidden=set()
    )

    assert synced is True
    assert WORKSPACE_CHECK not in open_by_check
    assert CHECK in open_by_check
    assert WORKSPACE_CHECK not in latest_checks_run
    assert CHECK in latest_checks_run


def _select_findings(org_id):
    return select(Finding).where(Finding.org_id == org_id, Finding.account_id.is_(None))
