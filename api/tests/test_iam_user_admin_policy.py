from __future__ import annotations

import uuid
from unittest.mock import MagicMock

from app.checks.iam_user_admin_policy import run, CHECK_ID
from app.models import IamUser


def test_iam_user_admin_policy_attached():
    acc_id = uuid.uuid4()
    admin = IamUser(
        id=uuid.uuid4(),
        account_id=acc_id,
        arn="arn:aws:iam::123456789012:user/admin-user",
        name="admin-user",
        attached_policies=[{"policy_name": "AdministratorAccess", "policy_type": "aws_managed"}],
        inline_policies={},
    )
    regular = IamUser(
        id=uuid.uuid4(),
        account_id=acc_id,
        arn="arn:aws:iam::123456789012:user/regular",
        name="regular",
        attached_policies=[{"policy_name": "ReadOnlyAccess", "policy_type": "aws_managed"}],
        inline_policies={},
    )

    db = MagicMock()
    db.scalars.return_value.all.return_value = [admin, regular]

    findings = run(db, acc_id)
    assert len(findings) == 1
    assert findings[0].check_id == CHECK_ID
    assert "admin-user" in findings[0].title
