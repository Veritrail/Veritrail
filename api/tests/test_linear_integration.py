"""Linear client + integration helpers (read-only evidence collection)."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.services.linear_client import LinearClient


def _resp(status_code: int = 200, json_data: dict | None = None) -> MagicMock:
    r = MagicMock()
    r.status_code = status_code
    r.json.return_value = json_data or {}
    r.raise_for_status = MagicMock()
    return r


def _fake_client(response: MagicMock) -> MagicMock:
    client = MagicMock()
    client.__enter__.return_value = client
    client.__exit__.return_value = False
    client.post.return_value = response
    return client


def test_empty_api_key_rejected():
    with pytest.raises(ValueError, match="API key is required"):
        LinearClient(api_key="   ")


def test_verify_returns_identity():
    resp = _resp(json_data={"data": {"viewer": {"id": "u1", "name": "Ada", "email": "ada@acme.io"}}})
    with patch("app.services.linear_client.httpx.Client", return_value=_fake_client(resp)):
        out = LinearClient(api_key="lin_abc").verify()
    assert out == {"user_id": "u1", "display_name": "Ada", "email": "ada@acme.io"}


def test_verify_unauthorized_raises():
    with patch("app.services.linear_client.httpx.Client", return_value=_fake_client(_resp(status_code=401))):
        with pytest.raises(ValueError, match="unauthorized"):
            LinearClient(api_key="bad").verify()


def test_graphql_errors_raise_value_error():
    resp = _resp(json_data={"errors": [{"message": "rate limited"}]})
    with patch("app.services.linear_client.httpx.Client", return_value=_fake_client(resp)):
        with pytest.raises(ValueError, match="Linear API error: rate limited"):
            LinearClient(api_key="k").verify()


def test_list_issues_normalizes_nodes():
    node = {
        "id": "i1",
        "identifier": "ENG-1",
        "title": "Rotate prod keys",
        "url": "https://linear.app/acme/issue/ENG-1",
        "state": {"name": "Done", "type": "completed"},
        "assignee": {"name": "Ada"},
        "creator": {"name": "Bob"},
        "createdAt": "2026-01-01T00:00:00Z",
        "updatedAt": "2026-01-02T00:00:00Z",
        "completedAt": "2026-01-02T00:00:00Z",
        "labels": {"nodes": [{"name": "security"}, {"name": "soc2"}]},
    }
    resp = _resp(json_data={"data": {"issues": {"nodes": [node]}}})
    with patch("app.services.linear_client.httpx.Client", return_value=_fake_client(resp)):
        rows = LinearClient(api_key="k").list_issues(first=10)

    assert len(rows) == 1
    row = rows[0]
    assert row["identifier"] == "ENG-1"
    assert row["state"] == "Done"
    assert row["assignee"] == "Ada"
    assert row["labels"] == ["security", "soc2"]


def test_list_issues_clamps_first_to_100():
    captured = {}

    def _capture_post(url, json):  # noqa: A002 - mirrors httpx signature
        captured["first"] = json["variables"]["first"]
        return _resp(json_data={"data": {"issues": {"nodes": []}}})

    client = _fake_client(_resp(json_data={"data": {"issues": {"nodes": []}}}))
    client.post.side_effect = _capture_post
    with patch("app.services.linear_client.httpx.Client", return_value=client):
        LinearClient(api_key="k").list_issues(first=9999)

    assert captured["first"] == 100
