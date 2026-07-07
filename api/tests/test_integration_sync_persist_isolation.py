"""Org isolation for identity integration (org-scoped, account_id NULL) persistence."""
from __future__ import annotations

from sqlalchemy import select

from app.checks.base import FindingDraft
from app.checks.persist import persist_org_findings
from app.models import Finding
from app.models.org import Org

CHECK = "okta.org.mfa_not_enforced"


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


def _select_findings(org_id):
    return select(Finding).where(Finding.org_id == org_id, Finding.account_id.is_(None))
