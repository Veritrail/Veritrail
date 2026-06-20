"""KMS key-rotation live-SSM remediation wiring (AWS-owned runbook)."""
import json

from app.data.remediation_modules import (
    REMEDIATION_MODULE_BY_ID,
    remediation_module_for_check,
)
from app.services.ssm_remediation_catalog import (
    automation_parameters_for_plan,
    runbook_for_check,
)

CHECK = "kms.key.no_rotation"
ROLE = "arn:aws:iam::123456789012:role/VigilRemediationAutomationRole"


def test_kms_runbook_is_aws_owned():
    rb = runbook_for_check(CHECK)
    assert rb is not None
    assert rb.owner == "aws"
    assert rb.document_name == "AWSConfigRemediation-EnableKeyRotation"
    assert rb.parameter_mode == "aws_kms_enable_rotation"


def test_kms_params_from_evidence_key_id():
    rb = runbook_for_check(CHECK)
    plan = json.dumps({"evidence": {"key_id": "abcd-1234"}, "resource_arn": ""})
    params = automation_parameters_for_plan(plan, rb, automation_assume_role_arn=ROLE)
    assert params == {"AutomationAssumeRole": [ROLE], "KeyId": ["abcd-1234"]}


def test_kms_params_fall_back_to_arn():
    rb = runbook_for_check(CHECK)
    arn = "arn:aws:kms:us-east-1:123456789012:key/9f8e-7d6c"
    plan = json.dumps({"evidence": {}, "resource_arn": arn})
    params = automation_parameters_for_plan(plan, rb, automation_assume_role_arn=ROLE)
    assert params["KeyId"] == ["9f8e-7d6c"]


def test_kms_params_require_automation_role():
    rb = runbook_for_check(CHECK)
    plan = json.dumps({"evidence": {"key_id": "k"}, "resource_arn": ""})
    try:
        automation_parameters_for_plan(plan, rb, automation_assume_role_arn=None)
    except ValueError as e:
        assert "AutomationAssumeRole" in str(e)
    else:
        raise AssertionError("expected ValueError for missing AutomationAssumeRole")


def test_kms_check_maps_to_module():
    assert remediation_module_for_check(CHECK) == "kms_rotation"
    spec = REMEDIATION_MODULE_BY_ID["kms_rotation"]
    assert spec.cfn_parameter == "EnableKmsRotationRemediation"
    assert spec.enable_column == "enable_remediation_kms"
    assert "kms:EnableKeyRotation" in spec.permissions
