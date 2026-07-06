"""Org isolation for source-control (org-scoped, account_id NULL) persistence.

Regression: run_source_control_checks must persist via persist_org_findings,
which filters by org_id. Using persist_findings(account_id=None) would treat
every org's account_id-NULL findings as one bucket, so one org's git sync would
mutate/auto-resolve another org's Secure SDLC findings.
"""
from __future__ import annotations

from app.checks.base import FindingDraft
from app.checks.persist import persist_org_findings
from app.models import Finding
from app.models.org import Org

CHECK = "github.repo.no_branch_protection"


def _org(db, name):
    org = Org(name=name)
    db.add(org)
    db.flush()
    return org


def _draft(repo):
    return FindingDraft(
        check_id=CHECK,
        resource_arn=f"github://acme/{repo}",
        title=f"{repo} has no branch protection",
        severity="high",
        risk_score=70,
        evidence={},
    )


def test_source_control_persist_is_org_isolated(db_session):
    org_a = _org(db_session, "Org A")
    org_b = _org(db_session, "Org B")

    # Org B already has an open source-control finding.
    persist_org_findings(db_session, org_id=org_b.id, drafts=[_draft("b-repo")], check_ids_run={CHECK})
    # Org A syncs and reports its own repo (B's repo is NOT in A's drafts).
    persist_org_findings(db_session, org_id=org_a.id, drafts=[_draft("a-repo")], check_ids_run={CHECK})

    b_rows = db_session.scalars(select_findings(org_b.id)).all()
    a_rows = db_session.scalars(select_findings(org_a.id)).all()

    # Org B's finding must remain OPEN — A's sync must not resolve it.
    assert len(b_rows) == 1
    assert b_rows[0].status == "open"
    assert b_rows[0].resource_arn == "github://acme/b-repo"
    # Org A owns exactly its own finding.
    assert len(a_rows) == 1
    assert a_rows[0].resource_arn == "github://acme/a-repo"


def select_findings(org_id):
    from sqlalchemy import select

    return select(Finding).where(Finding.org_id == org_id, Finding.account_id.is_(None))
