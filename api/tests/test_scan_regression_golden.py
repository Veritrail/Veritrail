"""Deterministic scan-regression golden: check outputs match fixed fixture counts.

No live AWS — uses the same mock_db / fixture pattern as test_checks.py.
CI runs this under `pytest -q` (see .github/workflows/ci.yml).
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock

import pytest

GOLDEN_PATH = Path(__file__).parent / "golden" / "finding_counts.json"


def _load_golden() -> dict[str, int]:
    data = json.loads(GOLDEN_PATH.read_text())
    return {str(k): int(v) for k, v in data["checks"].items()}


def _user(*, name="veritrail-qa-no-mfa", has_console_password=True, mfa_enabled=False, account_id=None):
    u = MagicMock()
    u.account_id = account_id or uuid.uuid4()
    u.arn = f"arn:aws:iam::123456789012:user/{name}"
    u.name = name
    u.has_console_password = has_console_password
    u.mfa_enabled = mfa_enabled
    u.last_used_at = None
    u.created_at = datetime.now(timezone.utc) - timedelta(days=30)
    return u


def _bucket(*, name="veritrail-qa-unencrypted", encrypted=False, account_id=None):
    b = MagicMock()
    b.account_id = account_id or uuid.uuid4()
    b.name = name
    b.arn = f"arn:aws:s3:::{name}"
    b.encrypted = encrypted
    return b


def _sg(*, group_id="sg-qa0001", group_name="default", unrestricted_ssh=True, account_id=None):
    sg = MagicMock()
    sg.account_id = account_id or uuid.uuid4()
    sg.group_id = group_id
    sg.group_name = group_name
    sg.region = "us-east-1"
    sg.vpc_id = "vpc-qa"
    sg.unrestricted_ssh = unrestricted_ssh
    sg.public_exposure = {"ssh": [{"cidr": "0.0.0.0/0", "port": 22}]}
    return sg


def _run_check(mock_db, check_id: str, account_id: uuid.UUID) -> int:
    """Seed a fixed fixture for each golden check and return draft count."""
    if check_id == "iam.user.no_mfa":
        from app.checks import iam_user_no_mfa

        mock_db.scalars.return_value.all.return_value = [_user(account_id=account_id)]
        return len(iam_user_no_mfa.run(mock_db, account_id))

    if check_id == "s3.bucket.no_default_encryption":
        from app.checks import s3_no_default_encryption

        mock_db.scalars.return_value.all.return_value = [_bucket(account_id=account_id)]
        return len(s3_no_default_encryption.run(mock_db, account_id))

    if check_id == "ec2.security_group.unrestricted_ssh":
        from app.checks import sg_unrestricted_ssh

        acc = MagicMock()
        acc.account_id = "123456789012"
        mock_db.get.return_value = acc
        mock_db.scalars.return_value.all.return_value = [_sg(account_id=account_id)]
        return len(sg_unrestricted_ssh.run(mock_db, account_id))

    raise AssertionError(f"no fixture runner for golden check {check_id}")


def test_scan_regression_golden_counts(mock_db):
    golden = _load_golden()
    assert golden, "golden finding_counts.json must list at least one check"

    account_id = uuid.uuid4()
    actual: dict[str, int] = {}
    for check_id in golden:
        actual[check_id] = _run_check(mock_db, check_id, account_id)

    assert actual == golden, f"finding-count drift vs golden: {actual} != {golden}"


def test_golden_manifest_keys_are_known_checks():
    """Guard against typos in the golden file."""
    from app.checks.registry import ALL_CHECKS

    known = {mod.CHECK_ID for mod in ALL_CHECKS}
    for check_id in _load_golden():
        assert check_id in known, f"unknown check_id in golden: {check_id}"
