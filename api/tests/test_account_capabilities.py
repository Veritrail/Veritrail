"""Capability verification is a read-only no-op (advanced policy generation retired)."""

from unittest.mock import MagicMock

from app.services.account_capabilities import (
    apply_capability_verification,
    remediation_modules_payload,
)


def test_apply_capability_verification_returns_empty_remediation_stubs():
    acc = MagicMock()
    acc.role_arn = "arn:aws:iam::123456789012:role/VeritrailScannerRole"

    results = apply_capability_verification(acc)

    assert results["remediation_modules"] == {}
    assert results["verification"]["scanner_role_arn"] == acc.role_arn
    # No advanced/write capabilities are reported anymore.
    assert "advanced_policy_generation" not in results
    assert "ssm_remediation" not in results


def test_remediation_modules_payload_all_disabled():
    acc = MagicMock()
    payload = remediation_modules_payload(acc)
    assert set(payload) == {"enabled", "deployed"}
    assert all(v is False for v in payload["enabled"].values())
    assert all(v is False for v in payload["deployed"].values())
