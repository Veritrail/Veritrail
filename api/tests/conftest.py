"""Shared fixtures for Veritrail tests."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest


@pytest.fixture(autouse=True)
def _disable_assume_role_audit_db_writes(request, monkeypatch):
    """CI uses a real Postgres; MagicMock org/account IDs must not write assume_role_audit."""
    if request.node.fspath and "test_assume_role_audit.py" in str(request.node.fspath):
        return
    monkeypatch.setattr("app.core.aws._audit_assume_role", lambda **_kwargs: None)


@pytest.fixture(autouse=True)
def _no_real_email(monkeypatch):
    """Stub the SMTP transport so route/service tests never send real mail.

    Dev/CI containers may have working SMTP; without this, any test that
    exercises an email-sending route (auditor invite, digest, password reset)
    would dispatch a real message and bounce. send_mail still returns success.
    """
    import smtplib

    monkeypatch.setattr(smtplib, "SMTP", MagicMock())
    monkeypatch.setattr(smtplib, "SMTP_SSL", MagicMock())


def make_account(
    role_arn: str = "arn:aws:iam::123456789012:role/VeritrailScannerRole",
    external_id: str = "test-external-id",
    account_id: str = "123456789012",
) -> MagicMock:
    acc = MagicMock()
    acc.id = uuid.uuid4()
    acc.org_id = uuid.uuid4()
    acc.account_id = account_id
    acc.role_arn = role_arn
    acc.external_id = external_id
    acc.status = "connected"
    return acc


def now() -> datetime:
    return datetime.now(timezone.utc)


@pytest.fixture
def account():
    return make_account()


@pytest.fixture
def mock_db():
    """SQLAlchemy Session mock. Configure .scalars().all() per test."""
    db = MagicMock()
    # default: get() returns None, scalars().all() returns []
    db.get.return_value = None
    db.scalars.return_value.all.return_value = []
    db.scalars.return_value.first.return_value = None
    return db


@pytest.fixture
def db_session():
    """Real transactional SQLAlchemy session for integration tests.

    Binds a Session to a single connection wrapped in a transaction that is
    rolled back at teardown — every test sees real SQLAlchemy/Postgres
    behaviour (constraints, JSONB, joins) with zero persistence between tests.
    Tables come from the migrations already applied to the container DB.
    """
    from sqlalchemy.orm import Session as SASession

    from app.core.db import engine
    from app.services.seed_controls import seed_controls

    connection = engine.connect()
    trans = connection.begin()
    session = SASession(bind=connection, autoflush=False, future=True)
    seed_controls(session, commit=False)
    try:
        yield session
    finally:
        session.close()
        trans.rollback()
        connection.close()
