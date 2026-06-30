"""Plan account cap counts only connected (verified) cloud accounts."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.models import AwsAccount
from app.models.org import Org
from app.routes.accounts import (
    AccountIn,
    _org_connected_account_count,
    create_account,
    plan_usage,
)


def test_connected_account_count_queries_filter_by_connected_status():
    org_id = uuid.uuid4()
    captured: list = []
    db = MagicMock()

    def _capture(stmt):
        captured.append(stmt)
        return 1

    db.scalar.side_effect = _capture

    assert _org_connected_account_count(db, org_id) == 3
    assert len(captured) == 3
    for stmt in captured:
        sql = str(stmt.compile(compile_kwargs={"literal_binds": True})).lower()
        assert "status" in sql
        assert "connected" in sql
        assert org_id.hex in sql.replace("-", "")


def test_plan_usage_ignores_incomplete_onboarding():
    org_id = uuid.uuid4()
    org = Org(id=org_id, name="Plan Test Co", plan="starter")
    db = MagicMock()
    db.get.return_value = org
    db.scalar.side_effect = [2, 0, 0]  # 2 connected AWS; pending/error rows excluded

    out = plan_usage(p={"org_id": str(org_id)}, db=db)

    assert out.used == 2
    assert out.max_accounts == 3
    assert out.can_add is True


def test_create_account_allowed_with_pending_rows_below_connected_cap():
    org_id = uuid.uuid4()
    org = Org(id=org_id, name="Plan Test Co", plan="starter")
    db = MagicMock()
    db.get.return_value = org
    db.scalar.side_effect = [2, 0, 0]

    with patch("app.routes.accounts._account_out", return_value=MagicMock()):
        create_account(
            AccountIn(label="aws-new"),
            _rbac=None,
            p={"org_id": str(org_id), "sub": str(uuid.uuid4())},
            db=db,
        )

    added = [call.args[0] for call in db.add.call_args_list]
    assert any(isinstance(obj, AwsAccount) for obj in added)
    db.commit.assert_called_once()


def test_create_account_blocked_at_connected_cap():
    org_id = uuid.uuid4()
    org = Org(id=org_id, name="Plan Test Co", plan="starter")
    db = MagicMock()
    db.get.return_value = org
    db.scalar.side_effect = [3, 0, 0]

    with pytest.raises(HTTPException) as exc:
        create_account(
            AccountIn(label="one-too-many"),
            _rbac=None,
            p={"org_id": str(org_id), "sub": str(uuid.uuid4())},
            db=db,
        )

    assert exc.value.status_code == 402
    db.add.assert_not_called()
