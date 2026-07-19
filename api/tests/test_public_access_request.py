"""Marketing-site request-access endpoint (POST /v1/public/access-request)."""
from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.db import get_db
from app.models.access_request import AccessRequest


@pytest.fixture
def client(db_session):
    from app.main import app

    def _db_override():
        yield db_session

    app.dependency_overrides[get_db] = _db_override
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_access_request_emails_support_and_persists(client, db_session):
    with patch("app.services.mail.send_mail", return_value=(True, None)) as mail:
        res = client.post(
            "/v1/public/access-request",
            json={
                "name": "Ada Lovelace",
                "email": "Ada@Example.com",
                "company": "Analytical Engines Ltd",
                "message": "We need SOC 2 evidence for our next audit.",
            },
        )
    assert res.status_code == 202, res.text
    assert res.json()["ok"] is True
    mail.assert_called_once()
    kwargs = mail.call_args.kwargs
    assert kwargs["to"] == "support@veritrail.io"
    assert "Analytical Engines Ltd" in kwargs["subject"]
    assert "ada@example.com" in kwargs["text"].lower()
    assert "SOC 2 evidence" in kwargs["text"]

    row = db_session.scalar(select(AccessRequest).where(AccessRequest.email == "ada@example.com"))
    assert row is not None
    assert row.name == "Ada Lovelace"
    assert row.company == "Analytical Engines Ltd"
    assert row.mail_sent is True


def test_access_request_message_optional(client):
    with patch("app.services.mail.send_mail", return_value=(True, None)) as mail:
        res = client.post(
            "/v1/public/access-request",
            json={"name": "Grace", "email": "grace@example.com", "company": "Hopper Inc"},
        )
    assert res.status_code == 202
    mail.assert_called_once()


def test_access_request_validates_fields(client):
    res = client.post(
        "/v1/public/access-request",
        json={"name": "", "email": "not-an-email", "company": ""},
    )
    assert res.status_code == 422


def test_access_request_mail_failure_still_stored(client, db_session):
    """SMTP being down must not lose the lead — the row is kept for /admin."""
    with patch("app.services.mail.send_mail", return_value=(False, "smtp down")):
        res = client.post(
            "/v1/public/access-request",
            json={"name": "Ada", "email": "ada2@example.com", "company": "AE Ltd"},
        )
    assert res.status_code == 202
    row = db_session.scalar(select(AccessRequest).where(AccessRequest.email == "ada2@example.com"))
    assert row is not None
    assert row.mail_sent is False
