import pytest

from app.core.config import get_settings
from app.services import cfn_versions as cv


def test_connector_template_url_versioned():
    url = cv.connector_template_url("2026.06")
    assert "/infra/2026.06/veritrail-stack.yaml" in url


def test_connector_child_template_url_versioned():
    url = cv.connector_child_template_url("2026.06", "veritrail-core-scanner.yaml")
    assert "/infra/2026.06/veritrail-core-scanner.yaml" in url


def test_rejects_unknown_tag():
    with pytest.raises(ValueError, match="unsupported"):
        cv.connector_template_url("v99")


def test_update_cli_includes_capabilities_and_modules():
    cmd = cv.update_cli_command(
        external_id="ext-123",
        stack_name="VeritrailAccountConnector",
        version_tag="2026.06",
        enable_advanced_policy_generation=True,
        remediation_modules={"security_groups": True, "s3_public_access": False},
    )
    assert "update-stack" in cmd
    assert "VeritrailAccountConnector" in cmd
    assert "/infra/2026.06/veritrail-stack.yaml" in cmd
    assert "CoreScannerTemplateURL,ParameterValue=" in cmd
    assert "/infra/2026.06/veritrail-core-scanner.yaml" in cmd
    assert "RemediationTemplateURL,ParameterValue=" in cmd
    assert "/infra/2026.06/veritrail-remediation-ssm.yaml" in cmd
    assert "CAPABILITY_NAMED_IAM" in cmd
    assert "EnableAdvancedPolicyGeneration,ParameterValue=Yes" in cmd
    assert "EnableSecurityGroupRemediation,ParameterValue=Yes" in cmd
    assert "EnableS3Remediation,ParameterValue=No" in cmd


def test_allowed_versions_only_approved_tags():
    tags = {v["tag"] for v in cv.allowed_connector_versions()}
    assert tags == {"2026.06"}


def test_stack_url_filters_by_name():
    url = cv.cloudformation_stack_url("VeritrailAccountConnector")
    assert "filteringText=VeritrailAccountConnector" in url
    assert get_settings().CFN_CONSOLE_REGION in url or "us-east-1" in url
