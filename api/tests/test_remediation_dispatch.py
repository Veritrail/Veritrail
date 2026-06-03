import uuid
from unittest.mock import MagicMock

from app.models import AwsAccount, Finding
from app.services.remediation_dispatch import remediation_automation_role_arn


def test_remediation_automation_role_arn_uses_aws_account_id_not_vigil_uuid():
    acc = MagicMock(spec=AwsAccount)
    acc.account_id = "123456789012"
    acc.role_arn = "arn:aws:iam::123456789012:role/VigilScannerRole"
    arn = remediation_automation_role_arn(acc)
    assert arn == "arn:aws:iam::123456789012:role/VigilRemediationAutomationRole"
    assert str(uuid.uuid4()) not in arn


def test_remediation_automation_role_arn_from_role_arn_when_account_id_missing():
    acc = MagicMock(spec=AwsAccount)
    acc.account_id = None
    acc.role_arn = "arn:aws:iam::999888777666:role/VigilScannerRole"
    arn = remediation_automation_role_arn(acc)
    assert arn == "arn:aws:iam::999888777666:role/VigilRemediationAutomationRole"
