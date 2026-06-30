"""Org resolution from JWT principal."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.core.org_context import SESSION_STALE_MSG, resolve_org
from app.models.org import Org, User


def _principal(*, sub: uuid.UUID, org_id: uuid.UUID) -> dict:
    return {"sub": str(sub), "org_id": str(org_id)}


def test_resolve_org_returns_jwt_org_when_present():
    org_id = uuid.uuid4()
    org = MagicMock(spec=Org)
    org.id = org_id
    db = MagicMock()
    db.get.return_value = org

    result = resolve_org(db, _principal(sub=uuid.uuid4(), org_id=org_id))
    assert result is org
    db.get.assert_called_once_with(Org, org_id)


def test_resolve_org_stale_jwt_org_returns_401_when_user_has_workspace():
    user_id = uuid.uuid4()
    stale_org_id = uuid.uuid4()
    live_org_id = uuid.uuid4()
    user = MagicMock(spec=User)
    user.org_id = live_org_id
    live_org = MagicMock(spec=Org)

    db = MagicMock()

    def _get(model, pk):
        if model is Org and pk == stale_org_id:
            return None
        if model is User and pk == user_id:
            return user
        if model is Org and pk == live_org_id:
            return live_org
        return None

    db.get.side_effect = _get

    with pytest.raises(HTTPException) as exc:
        resolve_org(db, _principal(sub=user_id, org_id=stale_org_id))
    assert exc.value.status_code == 401
    assert exc.value.detail == SESSION_STALE_MSG


def test_resolve_org_unknown_user_returns_401():
    db = MagicMock()
    db.get.side_effect = lambda model, pk: None

    with pytest.raises(HTTPException) as exc:
        resolve_org(db, _principal(sub=uuid.uuid4(), org_id=uuid.uuid4()))
    assert exc.value.status_code == 401
    assert exc.value.detail == "user not found"
