from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx

from app.services import integration_health as health


def _provider(provider_type: str = "gitlab") -> MagicMock:
    provider = MagicMock()
    provider.type = provider_type
    provider.status = "connected"
    return provider


def test_check_gitlab_health_marks_connected_on_success():
    provider = _provider()
    db = MagicMock()
    resp = MagicMock()
    resp.status_code = 200
    resp.raise_for_status = MagicMock()

    with (
        patch("app.services.integration_health.ensure_gitlab_token", return_value="tok"),
        patch("app.services.integration_health.gitlab_provider_config", return_value={"base_url": "https://gitlab.com"}),
        patch("httpx.Client") as client_cls,
    ):
        client_cls.return_value.__enter__.return_value.get.return_value = resp
        assert health.check_gitlab_health(db, provider) == "connected"
    assert provider.status == "connected"


def test_check_gitlab_health_marks_error_when_reconnect_required():
    from app.services.gitlab_tokens import GitLabReconnectRequired

    provider = _provider()
    db = MagicMock()

    with patch("app.services.integration_health.ensure_gitlab_token", side_effect=GitLabReconnectRequired()):
        assert health.check_gitlab_health(db, provider) == "error"
    assert provider.status == "error"


def test_check_github_health_marks_error_on_401():
    provider = _provider("github")
    db = MagicMock()
    resp = httpx.Response(401, json={"message": "Bad credentials"})

    with (
        patch("app.services.integration_health.github_provider_config", return_value={"access_token": "ghp_test"}),
        patch("httpx.Client") as client_cls,
    ):
        client_cls.return_value.__enter__.return_value.get.return_value = resp
        assert health.check_github_health(db, provider) == "error"
    assert provider.status == "error"
