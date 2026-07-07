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

CHECK = "okta.org.mfa_not_enforced"
ENTRA_CHECK = "entra.org.mfa_not_enforced"


def _org(db, name):
    org = Org(name=name)
    db.add(org)
    db.flush()
    return org


def _draft(org_url):
    return FindingDraft(
        check_id=CHECK,
        resource_arn=f"okta://{org_url}/org",
        title="Okta MFA policy not enforced",
        severity="high",
        risk_score=70,
        evidence={},
    )


def _entra_draft(tenant_id):
    return FindingDraft(
        check_id=ENTRA_CHECK,
        resource_arn=f"entra://{tenant_id}/org",
        title="Entra MFA policy not enforced",
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

    persist_org_findings(db_session, org_id=org_b.id, drafts=[_draft("trial-b")], check_ids_run={CHECK})
    persist_org_findings(db_session, org_id=org_a.id, drafts=[_draft("trial-a")], check_ids_run={CHECK})

    b_rows = db_session.scalars(_select_findings(org_b.id)).all()
    a_rows = db_session.scalars(_select_findings(org_a.id)).all()

    assert len(b_rows) == 1
    assert b_rows[0].status == "open"
    assert b_rows[0].resource_arn == "okta://trial-b/org"
    assert len(a_rows) == 1
    assert a_rows[0].resource_arn == "okta://trial-a/org"


def test_disconnect_resolves_open_okta_findings(db_session):
    org = _org(db_session, "Okta Disconnect Co")
    persist_org_findings(db_session, org_id=org.id, drafts=[_draft("trial")], check_ids_run={CHECK})

    row = db_session.scalars(_select_findings(org.id)).one()
    assert row.status == "open"

    resolved = resolve_integration_sync_findings_on_disconnect(db_session, org.id, "okta")
    assert resolved == 1

    row = db_session.scalars(_select_findings(org.id)).one()
    assert row.status == "resolved"
    assert row.resolved_at is not None


def test_grading_context_ignores_stale_okta_when_only_entra_connected(db_session):
    org = _org(db_session, "Entra Only Co")
    _identity_provider(db_session, org.id, "entra_id")
    persist_org_findings(db_session, org_id=org.id, drafts=[_draft("stale-okta")], check_ids_run={CHECK})
    persist_org_findings(
        db_session, org_id=org.id, drafts=[_entra_draft("tenant-1")], check_ids_run={ENTRA_CHECK}
    )

    open_by_check: dict = {}
    latest_checks_run: set[str] = set()
    synced = load_integration_sync_grading_context(
        db_session, org.id, open_by_check, latest_checks_run, hidden=set()
    )

    assert synced is True
    assert CHECK not in open_by_check
    assert ENTRA_CHECK in open_by_check
    assert CHECK not in latest_checks_run
    assert ENTRA_CHECK in latest_checks_run


def _select_findings(org_id):
    return select(Finding).where(Finding.org_id == org_id, Finding.account_id.is_(None))
