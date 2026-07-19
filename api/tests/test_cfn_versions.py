import pytest

from app.core.config import get_settings
from app.services import cfn_versions as cv


def test_connector_template_url_versioned():
    url = cv.connector_template_url("2026.07")
    assert "/infra/2026.07/veritrail-stack.yaml" in url


def test_rejects_unknown_tag():
    with pytest.raises(ValueError, match="unsupported"):
        cv.connector_template_url("v99")


def test_update_cli_is_single_flat_readonly_stack():
    cmd = cv.update_cli_command(
        external_id="ext-123",
        stack_name="VeritrailAccountConnector",
        version_tag="2026.07",
    )
    assert "update-stack" in cmd
    assert "VeritrailAccountConnector" in cmd
    assert "/infra/2026.07/veritrail-stack.yaml" in cmd
    assert "ParameterKey=ExternalId,ParameterValue=ext-123" in cmd
    assert "ParameterKey=RoleName,ParameterValue=" in cmd
    assert "CAPABILITY_NAMED_IAM" in cmd
    # Advanced / nested-template / remediation parameters are gone.
    assert "CoreScannerTemplateURL" not in cmd
    assert "EnableAdvancedPolicyGeneration" not in cmd
    assert "RemediationTemplateURL" not in cmd
    assert "EnableSecurityGroupRemediation" not in cmd


def test_allowed_versions_only_approved_tags():
    tags = {v["tag"] for v in cv.allowed_connector_versions()}
    assert tags == {"2026.07"}


def test_stack_url_filters_by_name():
    url = cv.cloudformation_stack_url("VeritrailAccountConnector")
    assert "filteringText=VeritrailAccountConnector" in url
    assert get_settings().CFN_CONSOLE_REGION in url or "us-east-1" in url
