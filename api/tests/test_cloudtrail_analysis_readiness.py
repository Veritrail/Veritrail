"""Preflight for CloudTrail policy-generation in the finding drawer."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock

from app.services.access_analyzer_policy import cloudtrail_analysis_readiness


def _trail(*, logging: bool):
    t = MagicMock()
    t.is_logging = logging
    return t


def test_readiness_no_trail_when_advanced_enabled():
    acc = MagicMock()
    acc.id = uuid.uuid4()
    acc.enable_advanced_policy_generation = True
    acc.advanced_policy_generation_deployed = False
    acc.role_arn = "arn:aws:iam::123456789012:role/VeritrailScannerRole"

    db = MagicMock()
    db.scalars.return_value.all.return_value = []

    out = cloudtrail_analysis_readiness(db, acc)
    assert out["ready"] is False
    assert out["status"] == "no_trail"
    assert out["logging_trail_count"] == 0


def test_readiness_ready_when_logging_trail_exists():
    acc = MagicMock()
    acc.id = uuid.uuid4()
    acc.enable_advanced_policy_generation = True
    acc.advanced_policy_generation_deployed = False
    acc.role_arn = "arn:aws:iam::123456789012:role/VeritrailScannerRole"

    db = MagicMock()
    db.scalars.return_value.all.return_value = [_trail(logging=True)]

    out = cloudtrail_analysis_readiness(db, acc)
    assert out["ready"] is True
    assert out["status"] == "ready"
    assert out["logging_trail_count"] == 1


def test_readiness_advanced_disabled():
    acc = MagicMock()
    acc.id = uuid.uuid4()
    acc.enable_advanced_policy_generation = False
    acc.advanced_policy_generation_deployed = False
    acc.role_arn = "arn:aws:iam::123456789012:role/VeritrailScannerRole"

    db = MagicMock()
    db.scalars.return_value.all.return_value = [_trail(logging=True)]

    out = cloudtrail_analysis_readiness(db, acc)
    assert out["ready"] is False
    assert out["status"] == "advanced_disabled"
