"""Fast finding recheck after remediation."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError

from app.services.fast_recheck import try_fast_finding_recheck


def _client_error(code: str = "AccessDenied") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": "test"}}, "TestOp")


def _finding(*, check_id: str, bucket_name: str = "vigil-worm-storage"):
    f = MagicMock()
    f.id = uuid.uuid4()
    f.check_id = check_id
    f.resource_arn = f"arn:aws:s3:::{bucket_name}"
    f.evidence = {"bucket_name": bucket_name}
    f.status = "open"
    return f


def _account():
    acc = MagicMock()
    acc.id = uuid.uuid4()
    acc.role_arn = "arn:aws:iam::123:role/VigilScanner"
    acc.external_id = "ext"
    return acc


def test_unsupported_check_when_no_module():
    db = MagicMock()
    finding = _finding(check_id="unknown.check")
    with patch("app.services.fast_recheck.engine.refresh_resource_for_finding", return_value=True):
        out = try_fast_finding_recheck(db, account=_account(), finding=finding, actor="x")
    assert out == {"checked": False, "resolved": False}


@patch("app.services.fast_recheck.targeted_refresh._session")
def test_s3_public_access_fast_resolve_when_blocked(mock_session):
    db = MagicMock()
    finding = _finding(check_id="s3.bucket.public_access_not_blocked")
    account = _account()

    mock_s3 = MagicMock()
    mock_s3.get_public_access_block.return_value = {
        "PublicAccessBlockConfiguration": {
            "BlockPublicAcls": True,
            "IgnorePublicAcls": True,
            "BlockPublicPolicy": True,
            "RestrictPublicBuckets": True,
        },
    }
    mock_s3.get_bucket_logging.side_effect = _client_error()
    mock_s3.get_bucket_encryption.side_effect = _client_error()
    mock_s3.get_bucket_versioning.side_effect = _client_error()
    mock_s3.get_bucket_policy.side_effect = _client_error()
    mock_sess = MagicMock()
    mock_sess.client.return_value = mock_s3
    mock_session.return_value = mock_sess

    mock_mod = MagicMock()
    mock_mod.run.return_value = []

    with patch.dict(
        "app.services.fast_recheck.engine._CHECK_BY_ID",
        {"s3.bucket.public_access_not_blocked": mock_mod},
        clear=False,
    ):
        out = try_fast_finding_recheck(db, account=account, finding=finding, actor="user@test")

    assert out["checked"] is True
    assert out["resolved"] is True
    assert finding.status == "resolved"


@patch("app.services.fast_recheck.targeted_refresh._session")
def test_s3_public_access_fast_unchanged_when_still_open(mock_session):
    db = MagicMock()
    finding = _finding(check_id="s3.bucket.public_access_not_blocked")
    account = _account()

    mock_s3 = MagicMock()
    mock_s3.get_public_access_block.return_value = {
        "PublicAccessBlockConfiguration": {
            "BlockPublicAcls": True,
            "IgnorePublicAcls": False,
            "BlockPublicPolicy": False,
            "RestrictPublicBuckets": False,
        },
    }
    mock_s3.get_bucket_logging.side_effect = _client_error()
    mock_s3.get_bucket_encryption.side_effect = _client_error()
    mock_s3.get_bucket_versioning.side_effect = _client_error()
    mock_s3.get_bucket_policy.side_effect = _client_error()
    mock_sess = MagicMock()
    mock_sess.client.return_value = mock_s3
    mock_session.return_value = mock_sess

    draft = MagicMock()
    draft.check_id = "s3.bucket.public_access_not_blocked"
    draft.resource_arn = finding.resource_arn
    mock_mod = MagicMock()
    mock_mod.run.return_value = [draft]

    with patch.dict(
        "app.services.fast_recheck.engine._CHECK_BY_ID",
        {"s3.bucket.public_access_not_blocked": mock_mod},
        clear=False,
    ):
        out = try_fast_finding_recheck(db, account=account, finding=finding, actor="user@test")

    assert out["checked"] is True
    assert out["resolved"] is False
    assert out["reason"] == "resource_still_failing"


def test_github_check_not_fast():
    db = MagicMock()
    finding = MagicMock()
    finding.check_id = "github.org.mfa_not_enforced"
    finding.resource_arn = "org:foo"
    out = try_fast_finding_recheck(db, account=_account(), finding=finding, actor="x")
    assert out == {"checked": False, "resolved": False}
