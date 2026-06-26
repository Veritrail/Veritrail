"""Integration request endpoint tests."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core.db import get_db
from app.core.rbac import current_org_user
from app.models.org import User


def _user(role: str = "viewer", org_id: uuid.UUID | None = None) -> User:
    return User(
        id=uuid.uuid4(),
        org_id=org_id or uuid.uuid4(),
        email="viewer@example.com",
        password_hash="x",
        role=role,
    )


@pytest.fixture
def client():
    from app.main import app

    return TestClient(app)


def test_integration_request_accepts_and_logs(client):
    viewer = _user("viewer")
    mock_db = MagicMock()
    mock_org = MagicMock()
    mock_org.name = "Acme Corp"
    mock_db.get.return_value = mock_org

    def _user_override():
        return viewer

    def _db_override():
        yield mock_db

    client.app.dependency_overrides[current_org_user] = _user_override
    client.app.dependency_overrides[get_db] = _db_override
    try:
        with (
            patch("app.routes.integration_requests.send_mail", return_value=(True, None)) as mail,
            patch("app.routes.integration_requests.log_org_activity") as activity,
        ):
            res = client.post(
                "/v1/integrations/integration-request",
                json={"integration_name": "ServiceNow", "message": "Need ticket sync"},
            )
            assert res.status_code == 202
            assert res.json()["ok"] is True
            mail.assert_called_once()
            assert "ServiceNow" in mail.call_args.kwargs["subject"]
            activity.assert_called_once()
            assert activity.call_args.kwargs["action"] == "integration.requested"
            mock_db.commit.assert_called_once()
    finally:
        client.app.dependency_overrides.clear()


def test_integration_request_requires_name(client):
    viewer = _user("viewer")

    def _override():
        return viewer

    client.app.dependency_overrides[current_org_user] = _override
    try:
        res = client.post(
            "/v1/integrations/integration-request",
            json={"integration_name": "", "message": ""},
        )
        assert res.status_code == 422
    finally:
        client.app.dependency_overrides.clear()
