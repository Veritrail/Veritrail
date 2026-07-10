"""External ID two-phase rotation endpoints."""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.routes.accounts import (
    cancel_external_id_rotation,
    confirm_external_id_rotation,
    rotate_external_id,
)


def _connected_acc(**overrides):
    acc = MagicMock()
    acc.id = uuid4()
    acc.org_id = uuid4()
    acc.label = "Prod"
    acc.account_id = "123456789012"
    acc.role_arn = "arn:aws:iam::123456789012:role/VeritrailReadOnly"
    acc.external_id = "current-external-id-token"
    acc.pending_external_id = None
    acc.external_id_rotation_requested_at = None
    acc.status = "connected"
    acc.cfn_stack_name = "VeritrailAccountConnector"
    acc.enable_advanced_policy_generation = False
    acc.advanced_policy_generation_deployed = False
    acc.last_error = None
    acc.last_scan_at = None
    acc.cloudtrail_onboarding_mode = None
    for spec_id in (
        "enable_remediation_sg",
        "enable_remediation_s3",
        "enable_remediation_iam_keys",
        "enable_remediation_iam_policy",
        "enable_remediation_cloudtrail",
        "enable_remediation_ssm_parameters",
        "enable_remediation_kms",
        "remediation_sg_deployed",
        "remediation_s3_deployed",
        "remediation_iam_keys_deployed",
        "remediation_iam_policy_deployed",
        "remediation_cloudtrail_deployed",
        "remediation_ssm_parameters_deployed",
        "remediation_kms_deployed",
    ):
        setattr(acc, spec_id, False)
    for k, v in overrides.items():
        setattr(acc, k, v)
    return acc


@patch("app.routes.accounts.log_org_activity")
@patch("app.services.scan_schedule.has_running_scan", return_value=False)
def test_rotate_external_id_mints_pending(mock_scan, mock_log):
    acc = _connected_acc()
    db = MagicMock()
    db.get.return_value = acc
    p = {"org_id": str(acc.org_id), "sub": str(uuid4())}

    out = rotate_external_id(str(acc.id), _rbac=MagicMock(), p=p, db=db)

    assert out.pending_external_id
    assert out.pending_external_id != "current-external-id-token"
    assert out.pending_external_id in out.cfn_update_cli_command
    assert acc.pending_external_id == out.pending_external_id
    assert acc.external_id_rotation_requested_at is not None
    db.commit.assert_called()
    mock_log.assert_called()


@patch("app.services.scan_schedule.has_running_scan", return_value=True)
def test_rotate_external_id_blocked_when_scan_running(mock_scan):
    acc = _connected_acc()
    db = MagicMock()
    db.get.return_value = acc
    p = {"org_id": str(acc.org_id), "sub": str(uuid4())}

    with pytest.raises(HTTPException) as ei:
        rotate_external_id(str(acc.id), _rbac=MagicMock(), p=p, db=db)
    assert ei.value.status_code == 409


@patch("app.routes.accounts.log_org_activity")
@patch("app.core.aws.verify_account", return_value=(True, "123456789012", "Prod", None))
@patch("app.services.scan_schedule.has_running_scan", return_value=False)
def test_confirm_external_id_rotation_swaps_on_verify_ok(mock_scan, mock_verify, mock_log):
    acc = _connected_acc(
        pending_external_id="pending-new-external-id",
        external_id_rotation_requested_at=datetime.now(timezone.utc),
    )
    db = MagicMock()
    db.get.return_value = acc
    p = {"org_id": str(acc.org_id), "sub": str(uuid4())}

    out = confirm_external_id_rotation(str(acc.id), _rbac=MagicMock(), p=p, db=db)

    assert out.external_id == "pending-new-external-id"
    assert out.pending_external_id is None
    assert acc.external_id == "pending-new-external-id"
    assert acc.pending_external_id is None
    assert acc.external_id_rotation_requested_at is None
    mock_verify.assert_called_once()
    assert mock_verify.call_args.args[1] == "pending-new-external-id"


@patch("app.core.aws.verify_account", return_value=(False, None, None, "AccessDenied"))
@patch("app.services.scan_schedule.has_running_scan", return_value=False)
def test_confirm_external_id_rotation_fails_when_verify_fails(mock_scan, mock_verify):
    acc = _connected_acc(
        pending_external_id="pending-new-external-id",
        external_id_rotation_requested_at=datetime.now(timezone.utc),
    )
    db = MagicMock()
    db.get.return_value = acc
    p = {"org_id": str(acc.org_id), "sub": str(uuid4())}

    with pytest.raises(HTTPException) as ei:
        confirm_external_id_rotation(str(acc.id), _rbac=MagicMock(), p=p, db=db)
    assert ei.value.status_code == 400
    assert acc.external_id == "current-external-id-token"
    assert acc.pending_external_id == "pending-new-external-id"


@patch("app.routes.accounts.log_org_activity")
@patch("app.services.scan_schedule.has_running_scan", return_value=False)
def test_cancel_external_id_rotation(mock_scan, mock_log):
    acc = _connected_acc(
        pending_external_id="pending-new-external-id",
        external_id_rotation_requested_at=datetime.now(timezone.utc),
    )
    db = MagicMock()
    db.get.return_value = acc
    p = {"org_id": str(acc.org_id), "sub": str(uuid4())}

    out = cancel_external_id_rotation(str(acc.id), _rbac=MagicMock(), p=p, db=db)

    assert out.pending_external_id is None
    assert acc.pending_external_id is None
    assert acc.external_id == "current-external-id-token"
