"""Tests for clearing remediation ticket links on findings."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.models import Finding
from app.routes.findings import clear_finding_remediation_ticket, clear_remediation_ticket_link


def _finding(org_id, **kwargs):
    now = datetime.now(timezone.utc)
    defaults = dict(
        org_id=org_id,
        check_id="iam.access_key.unused",
        resource_arn="arn:aws:iam::123456789012:user/alice",
        title="Unused access key",
        severity="high",
        risk_score=70,
        status="open",
        evidence={},
        first_seen=now,
        last_seen=now,
    )
    defaults.update(kwargs)
    return Finding(**defaults)


def test_clear_finding_remediation_ticket_removes_columns_and_evidence():
    f = _finding(
        uuid.uuid4(),
        remediation_ticket_key="#1",
        remediation_ticket_url="https://github.com/o/r/issues/1",
        evidence={
            "iac_remediation_ticket": {"issue_key": "#1", "issue_url": "https://github.com/o/r/issues/1"},
            "jira": {"issue_key": "SEC-99", "issue_url": "https://jira.example/browse/SEC-99"},
            "linear": {"issue_key": "LIN-1", "issue_url": "https://linear.app/t/LIN-1"},
            "other": {"keep": True},
        },
    )

    removed = clear_finding_remediation_ticket(f)

    assert set(removed) == {"#1", "SEC-99", "LIN-1"}
    assert f.remediation_ticket_key is None
    assert f.remediation_ticket_url is None
    assert "iac_remediation_ticket" not in f.evidence
    assert "jira" not in f.evidence
    assert "linear" not in f.evidence
    assert f.evidence["other"] == {"keep": True}


def test_clear_finding_remediation_ticket_noop_when_empty():
    f = _finding(uuid.uuid4())
    assert clear_finding_remediation_ticket(f) == []


def test_clear_remediation_ticket_link_route(mock_db, monkeypatch):
    org_id = uuid.uuid4()
    finding_id = uuid.uuid4()
    finding = _finding(
        org_id,
        id=finding_id,
        remediation_ticket_key="#1",
        remediation_ticket_url="https://github.com/o/r/issues/1",
        evidence={
            "iac_remediation_ticket": {"issue_key": "#1", "issue_url": "https://github.com/o/r/issues/1"},
            "jira": {"issue_key": "SEC-1", "issue_url": "https://jira.example/browse/SEC-1"},
        },
    )
    mock_db.get.return_value = finding
    monkeypatch.setattr(
        "app.routes.findings._scope_maps",
        lambda db, oid: ({}, {}, {}),
    )

    editor = MagicMock()
    out = clear_remediation_ticket_link(
        finding_id=str(finding.id),
        _rbac=editor,
        p={"sub": "user-1", "org_id": str(org_id)},
        db=mock_db,
    )

    assert out.remediation_ticket_key is None
    assert out.remediation_ticket_url is None
    assert "iac_remediation_ticket" not in (out.evidence or {})
    assert "jira" not in (out.evidence or {})
    mock_db.add.assert_called_once()
    mock_db.commit.assert_called_once()


def test_clear_remediation_ticket_link_not_found(mock_db):
    mock_db.get.return_value = None
    editor = MagicMock()
    org_id = uuid.uuid4()

    with pytest.raises(HTTPException) as exc:
        clear_remediation_ticket_link(
            finding_id=str(uuid.uuid4()),
            _rbac=editor,
            p={"sub": "user-1", "org_id": str(org_id)},
            db=mock_db,
        )
    assert exc.value.status_code == 404
