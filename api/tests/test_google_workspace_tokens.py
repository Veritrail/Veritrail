from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.services import google_workspace_tokens as tokens


def _config(*, expires_in: int | None = 3600, refresh_token: str | None = "rt-1") -> dict:
    cfg = {"access_token": "at-old", "refresh_token": refresh_token}
    if expires_in is not None:
        cfg["token_expires_at"] = (
            datetime.now(timezone.utc) + timedelta(seconds=expires_in)
        ).isoformat()
    return cfg


def test_apply_oauth_tokens_stores_refresh_and_expiry():
    out = tokens.apply_oauth_tokens(
        {"access_token": "old"},
        {"access_token": "new", "refresh_token": "rt-2", "expires_in": 7200},
    )
    assert out["access_token"] == "new"
    assert out["refresh_token"] == "rt-2"
    assert out["token_expires_at"]


def test_ensure_token_refreshes_when_near_expiry():
    provider = MagicMock()
    db = MagicMock()
    cfg = _config(expires_in=30)
    with (
        patch("app.services.google_workspace_tokens.provider_config", side_effect=[cfg, {**cfg, "access_token": "at-new"}]),
        patch("app.services.google_workspace_tokens.refresh_google_workspace_token", return_value="at-new") as refresh,
    ):
        assert tokens.ensure_google_workspace_token(db, provider) == "at-new"
    refresh.assert_called_once_with(db, provider)


def test_refresh_without_refresh_token_raises_reconnect():
    provider = MagicMock()
    db = MagicMock()
    with (
        patch("app.services.google_workspace_tokens.provider_config", return_value=_config(refresh_token=None)),
        pytest.raises(tokens.GoogleWorkspaceReconnectRequired),
    ):
        tokens.refresh_google_workspace_token(db, provider)
