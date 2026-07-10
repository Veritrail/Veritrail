"""Optional capability deployment verification (advanced policy generation)."""

from unittest.mock import MagicMock, patch

from app.services.account_capabilities import (
    apply_capability_verification,
    build_capability_verification_context,
    verify_advanced_policy_generation,
)


@patch("app.services.account_capabilities.cloudtrail_monitor_role_exists", return_value=False)
@patch(
    "app.services.account_capabilities.cloudtrail_monitor_role_name",
    return_value="VeritrailScannerRoleAccessAnalyzerMonitor",
)
@patch("app.services.account_capabilities.check_actions_on_documents")
@patch("app.services.account_capabilities.build_capability_verification_context")
def test_verify_advanced_inspects_role_even_when_not_enabled(
    mock_ctx_build, mock_check, _mock_name, _mock_exists
):
    mock_ctx_build.return_value = MagicMock(
        session_error=None,
        scanner_documents=[{"Statement": []}],
    )
    mock_check.return_value = {
        a: False
        for a in (
            "iam:GenerateServiceLastAccessedDetails",
            "access-analyzer:StartPolicyGeneration",
            "access-analyzer:CancelPolicyGeneration",
            "access-analyzer:GetGeneratedPolicy",
        )
    }
    acc = MagicMock(
        enable_advanced_policy_generation=False,
        role_arn="arn:aws:iam::123456789012:role/VeritrailScannerRole",
        external_id="ext",
    )
    out = verify_advanced_policy_generation(acc)
    assert out["deployed"] is False
    assert out["status"] == "not_requested"
    mock_check.assert_called_once()


@patch("app.services.account_capabilities.cloudtrail_monitor_role_exists", return_value=True)
@patch(
    "app.services.account_capabilities.cloudtrail_monitor_role_name",
    return_value="VeritrailScannerRoleAccessAnalyzerMonitor",
)
@patch("app.services.account_capabilities.check_actions_on_documents")
@patch("app.services.account_capabilities.build_capability_verification_context")
def test_verify_advanced_all_granted(mock_ctx_build, mock_check, _mock_name, _mock_exists):
    mock_ctx_build.return_value = MagicMock(
        session_error=None,
        scanner_documents=[{"Statement": []}],
        session=MagicMock(),
    )
    mock_check.return_value = {a: True for a in (
        "iam:GenerateServiceLastAccessedDetails",
        "access-analyzer:StartPolicyGeneration",
        "access-analyzer:CancelPolicyGeneration",
        "access-analyzer:GetGeneratedPolicy",
        "access-analyzer:ListPolicyGenerations",
        "iam:PassRole",
    )}
    acc = MagicMock(
        enable_advanced_policy_generation=True,
        role_arn="arn:aws:iam::123456789012:role/VeritrailScannerRole",
        external_id="ext",
    )
    out = verify_advanced_policy_generation(acc)
    assert out["deployed"] is True
    assert out["status"] == "ready"
    assert out["error"] is None
    assert out["granted_count"] == 6


@patch("app.services.account_capabilities.verify_advanced_policy_generation")
def test_apply_clears_deployed_when_iam_missing(mock_adv):
    mock_adv.return_value = {"deployed": False, "requested": False, "status": "not_requested", "error": None}
    acc = MagicMock(
        enable_advanced_policy_generation=False,
        advanced_policy_generation_deployed=True,
    )
    apply_capability_verification(acc)
    assert acc.advanced_policy_generation_deployed is False


@patch("app.services.account_capabilities.verify_advanced_policy_generation")
def test_apply_syncs_enable_when_iam_has_advanced(mock_adv):
    mock_adv.return_value = {
        "deployed": True,
        "requested": True,
        "status": "ready",
        "error": None,
    }
    acc = MagicMock(
        enable_advanced_policy_generation=False,
        advanced_policy_generation_deployed=False,
    )
    apply_capability_verification(acc)
    assert acc.advanced_policy_generation_deployed is True
    assert acc.enable_advanced_policy_generation is True


@patch("app.services.account_capabilities.load_role_policy_documents", return_value=[])
@patch("app.services.account_capabilities.assume_role")
def test_apply_assumes_role_once(mock_assume, mock_load_docs):
    mock_sess = MagicMock()
    mock_assume.return_value = mock_sess
    mock_sess.client.return_value.get_caller_identity.return_value = {"Account": "123456789012"}

    acc = MagicMock(
        role_arn="arn:aws:iam::123456789012:role/VeritrailScannerRole",
        external_id="ext",
        enable_advanced_policy_generation=True,
        advanced_policy_generation_deployed=False,
    )

    apply_capability_verification(acc)

    assert mock_assume.call_count == 1
    assert mock_load_docs.call_count == 1


@patch("app.services.account_capabilities.load_role_policy_documents", return_value=[])
@patch("app.services.account_capabilities.assume_role")
def test_build_context_single_session(mock_assume, mock_load_docs):
    mock_sess = MagicMock()
    mock_assume.return_value = mock_sess
    mock_sess.client.return_value.get_caller_identity.return_value = {"Account": "123456789012"}

    acc = MagicMock(
        role_arn="arn:aws:iam::123456789012:role/VeritrailScannerRole",
        external_id="ext",
    )
    ctx = build_capability_verification_context(acc)
    assert ctx.session is mock_sess
    assert mock_assume.call_count == 1
    assert mock_load_docs.call_count == 1


@patch("app.services.account_capabilities.verify_advanced_policy_generation")
def test_apply_returns_empty_remediation_stubs(mock_adv):
    mock_adv.return_value = {"deployed": False, "requested": False, "status": "not_requested", "error": None}
    acc = MagicMock(
        enable_advanced_policy_generation=False,
        advanced_policy_generation_deployed=False,
        role_arn="arn:aws:iam::123456789012:role/VeritrailScannerRole",
    )
    results = apply_capability_verification(acc)
    assert results["ssm_remediation"]["status"] == "not_requested"
    assert results["remediation_modules"] == {}
