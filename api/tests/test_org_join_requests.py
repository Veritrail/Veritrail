"""Request-access (join request) service guards."""
from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services import org_join_requests as svc
from app.services.org_join_requests import create_join_request


def test_public_domain_never_creates_request():
    db = MagicMock()
    assert create_join_request(db, "someone@gmail.com") is None
    db.add.assert_not_called()


def test_unclaimed_corporate_domain_returns_none(monkeypatch):
    monkeypatch.setattr(svc, "org_claiming_email_domain", lambda db, email: None)
    db = MagicMock()
    assert create_join_request(db, "founder@brand-new-co.com") is None
    db.add.assert_not_called()


def test_existing_account_is_not_a_request(monkeypatch):
    fake_org = SimpleNamespace(id=uuid.uuid4())
    monkeypatch.setattr(svc, "org_claiming_email_domain", lambda db, email: fake_org)
    db = MagicMock()
    db.scalar.return_value = uuid.uuid4()  # user-exists check returns a row
    assert create_join_request(db, "existing@acme.com") is None
    db.add.assert_not_called()


def test_creates_request_for_claimed_domain(monkeypatch):
    fake_org = SimpleNamespace(id=uuid.uuid4())
    monkeypatch.setattr(svc, "org_claiming_email_domain", lambda db, email: fake_org)
    db = MagicMock()
    db.scalar.side_effect = [None, None]  # user-exists None, existing-request None
    result = create_join_request(db, "new.hire@acme.com")
    assert result is not None
    org, jr = result
    assert org is fake_org
    assert jr.email == "new.hire@acme.com"
    db.add.assert_called_once()


def test_dedupes_existing_pending_request(monkeypatch):
    fake_org = SimpleNamespace(id=uuid.uuid4())
    monkeypatch.setattr(svc, "org_claiming_email_domain", lambda db, email: fake_org)
    db = MagicMock()
    sentinel = object()
    db.scalar.side_effect = [None, sentinel]  # user-exists None, existing pending found
    org, jr = create_join_request(db, "dup@acme.com")
    assert jr is sentinel
    db.add.assert_not_called()
