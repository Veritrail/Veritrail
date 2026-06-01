"""Tests for CloudTrail event-based security checks."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from app.checks import (
    cloudtrail_event_root_activity,
    cloudtrail_event_trail_tampering,
    cloudtrail_event_iam_user_policy_attachment,
    cloudtrail_event_s3_bucket_policy_change,
    cloudtrail_event_iam_role_policy_mutation,
    cloudtrail_event_security_group_open_to_world,
    cloudtrail_event_kms_key_disabled_or_deleted,
    cloudtrail_event_guardduty_disabled,
    cloudtrail_event_config_recorder_stopped,
    cloudtrail_event_iam_access_key_created,
    cloudtrail_event_s3_public_access_block_disabled,
    cloudtrail_event_lambda_function_created_or_modified,
    cloudtrail_event_ec2_instance_tampering,
    cloudtrail_event_rds_instance_created_or_modified,
    cloudtrail_event_anomalous_api_volume,
)
from app.models.cloudtrail import CloudTrailEvent


def _make_event(
    account_id: uuid.UUID,
    event_name: str,
    event_source: str = "iam.amazonaws.com",
    actor: str | None = "arn:aws:iam::123456789012:user/test-user",
    source_ip: str | None = "203.0.113.1",
    event_time: datetime | None = None,
    resources: list | None = None,
    raw: dict | None = None,
) -> CloudTrailEvent:
    return CloudTrailEvent(
        id=uuid.uuid4(),
        account_id=account_id,
        event_id=str(uuid.uuid4()),
        event_name=event_name,
        event_source=event_source,
        event_time=event_time or (datetime.now(timezone.utc) - timedelta(days=5)),
        actor=actor,
        source_ip=source_ip,
        resources=resources or [],
        raw=raw or {},
    )


# ---------------------------------------------------------------------------
# Check 1: Root Activity
# ---------------------------------------------------------------------------
class TestRootActivity:
    CHECK_ID = "cloudtrail.event.root_activity"

    def test_clean_account_returns_empty(self, mock_db, account):
        mock_db.get.return_value = account
        mock_db.execute.return_value.scalar_one_or_none.return_value = None
        result = cloudtrail_event_root_activity.run(mock_db, account.id)
        assert result == []

    def test_no_account_returns_empty(self, mock_db):
        mock_db.get.return_value = None
        result = cloudtrail_event_root_activity.run(mock_db, uuid.uuid4())
        assert result == []

    def test_root_api_call_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(
            account.id,
            "CreateUser",
            actor="arn:aws:iam::123456789012:root",
        )
        mock_db.execute.return_value.scalar_one_or_none.return_value = event
        result = cloudtrail_event_root_activity.run(mock_db, account.id)
        assert len(result) == 1
        assert result[0].check_id == self.CHECK_ID
        assert result[0].severity == "critical"
        assert "root" in result[0].title.lower()

    def test_checkmfa_excluded(self, mock_db, account):
        mock_db.get.return_value = account
        mock_db.execute.return_value.scalar_one_or_none.return_value = None
        result = cloudtrail_event_root_activity.run(mock_db, account.id)
        assert result == []


# ---------------------------------------------------------------------------
# Check 2: Trail Tampering
# ---------------------------------------------------------------------------
class TestTrailTampering:
    CHECK_ID = "cloudtrail.event.trail_tampering"

    def test_clean_account_returns_empty(self, mock_db, account):
        mock_db.get.return_value = account
        mock_db.scalars.return_value.all.return_value = []
        result = cloudtrail_event_trail_tampering.run(mock_db, account.id)
        assert result == []

    def test_stop_logging_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "StopLogging")
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_trail_tampering.run(mock_db, account.id)
        assert len(result) == 1
        assert result[0].severity == "critical"

    def test_delete_trail_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "DeleteTrail")
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_trail_tampering.run(mock_db, account.id)
        assert len(result) == 1

    def test_update_trail_benign_log_validation_enabled(self, mock_db, account):
        """UpdateTrail enabling log validation should NOT trigger."""
        mock_db.get.return_value = account
        event = _make_event(account.id, "UpdateTrail", raw={
            "requestParameters": {
                "name": "my-trail",
                "enableLogFileValidation": True,
                "includeGlobalServiceEvents": True,
                "isMultiRegionTrail": True,
            }
        })
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_trail_tampering.run(mock_db, account.id)
        assert result == []

    def test_update_trail_disabling_log_validation(self, mock_db, account):
        """UpdateTrail disabling log validation SHOULD trigger."""
        mock_db.get.return_value = account
        event = _make_event(account.id, "UpdateTrail", raw={
            "requestParameters": {
                "name": "my-trail",
                "enableLogFileValidation": False,
            }
        })
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_trail_tampering.run(mock_db, account.id)
        assert len(result) == 1

    def test_update_trail_switching_to_single_region(self, mock_db, account):
        """UpdateTrail switching to single-region SHOULD trigger."""
        mock_db.get.return_value = account
        event = _make_event(account.id, "UpdateTrail", raw={
            "requestParameters": {
                "isMultiRegionTrail": False,
            }
        })
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_trail_tampering.run(mock_db, account.id)
        assert len(result) == 1


# ---------------------------------------------------------------------------
# Check 3: IAM User Policy Attachment
# ---------------------------------------------------------------------------
class TestIamUserPolicyAttachment:
    CHECK_ID = "cloudtrail.event.iam_user_policy_attachment"

    def test_clean_account_returns_empty(self, mock_db, account):
        mock_db.get.return_value = account
        mock_db.scalars.return_value.all.return_value = []
        result = cloudtrail_event_iam_user_policy_attachment.run(mock_db, account.id)
        assert result == []

    def test_attach_user_policy_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "AttachUserPolicy", raw={
            "requestParameters": {"policyArn": "arn:aws:iam::aws:policy/AdministratorAccess"}
        })
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_iam_user_policy_attachment.run(mock_db, account.id)
        assert len(result) == 1
        assert result[0].severity == "high"
        assert "AdministratorAccess" in result[0].title

    def test_add_user_to_group_returns_medium(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "AddUserToGroup")
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_iam_user_policy_attachment.run(mock_db, account.id)
        assert len(result) == 1
        assert result[0].severity == "medium"


# ---------------------------------------------------------------------------
# Check 4: S3 Bucket Policy Change
# ---------------------------------------------------------------------------
class TestS3BucketPolicyChange:
    CHECK_ID = "cloudtrail.event.s3_bucket_policy_change"

    def test_clean_account_returns_empty(self, mock_db, account):
        mock_db.get.return_value = account
        mock_db.scalars.return_value.all.return_value = []
        result = cloudtrail_event_s3_bucket_policy_change.run(mock_db, account.id)
        assert result == []

    def test_put_bucket_policy_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "PutBucketPolicy")
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_s3_bucket_policy_change.run(mock_db, account.id)
        assert len(result) == 1
        assert result[0].severity == "high"

    def test_delete_bucket_policy_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "DeleteBucketPolicy")
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_s3_bucket_policy_change.run(mock_db, account.id)
        assert len(result) == 1


# ---------------------------------------------------------------------------
# Check 5: IAM Role/Policy Mutation
# ---------------------------------------------------------------------------
class TestIamRolePolicyMutation:
    CHECK_ID = "cloudtrail.event.iam_role_policy_mutation"

    def test_clean_account_returns_empty(self, mock_db, account):
        mock_db.get.return_value = account
        mock_db.scalars.return_value.all.return_value = []
        result = cloudtrail_event_iam_role_policy_mutation.run(mock_db, account.id)
        assert result == []

    def test_create_role_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "CreateRole")
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_iam_role_policy_mutation.run(mock_db, account.id)
        assert len(result) == 1

    def test_service_linked_role_actor_filtered(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(
            account.id, "CreateRole",
            actor="arn:aws:iam::123456789012:role/AWSServiceRoleForConfig"
        )
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_iam_role_policy_mutation.run(mock_db, account.id)
        assert result == []


# ---------------------------------------------------------------------------
# Check 6: Security Group Open to World
# ---------------------------------------------------------------------------
class TestSGOpenToWorld:
    CHECK_ID = "cloudtrail.event.security_group_open_to_world"

    def test_clean_account_returns_empty(self, mock_db, account):
        mock_db.get.return_value = account
        mock_db.scalars.return_value.all.return_value = []
        result = cloudtrail_event_security_group_open_to_world.run(mock_db, account.id)
        assert result == []

    def test_sg_open_ssh_to_world(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "AuthorizeSecurityGroupIngress", raw={
            "requestParameters": {
                "ipPermissions": [{
                    "ipProtocol": "tcp",
                    "fromPort": 22,
                    "toPort": 22,
                    "ipRanges": [{"CidrIp": "0.0.0.0/0"}]
                }]
            }
        })
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_security_group_open_to_world.run(mock_db, account.id)
        assert len(result) == 1
        assert result[0].severity == "critical"  # SSH is sensitive port

    def test_sg_open_http_to_world(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "AuthorizeSecurityGroupIngress", raw={
            "requestParameters": {
                "ipPermissions": [{
                    "ipProtocol": "tcp",
                    "fromPort": 80,
                    "toPort": 80,
                    "ipRanges": [{"CidrIp": "0.0.0.0/0"}]
                }]
            }
        })
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_security_group_open_to_world.run(mock_db, account.id)
        assert len(result) == 1
        assert result[0].severity == "high"  # HTTP is not sensitive


# ---------------------------------------------------------------------------
# Check 7: KMS Key Disabled or Deleted
# ---------------------------------------------------------------------------
class TestKMSKeyDisabled:
    CHECK_ID = "cloudtrail.event.kms_key_disabled_or_deleted"

    def test_clean_account_returns_empty(self, mock_db, account):
        mock_db.get.return_value = account
        mock_db.scalars.return_value.all.return_value = []
        result = cloudtrail_event_kms_key_disabled_or_deleted.run(mock_db, account.id)
        assert result == []

    def test_disable_key_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "DisableKey")
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_kms_key_disabled_or_deleted.run(mock_db, account.id)
        assert len(result) == 1
        assert result[0].severity == "critical"

    def test_schedule_key_deletion_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "ScheduleKeyDeletion")
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_kms_key_disabled_or_deleted.run(mock_db, account.id)
        assert len(result) == 1


# ---------------------------------------------------------------------------
# Check 8: GuardDuty Disabled
# ---------------------------------------------------------------------------
class TestGuardDutyDisabled:
    CHECK_ID = "cloudtrail.event.guardduty_disabled"

    def test_clean_account_returns_empty(self, mock_db, account):
        mock_db.get.return_value = account
        mock_db.execute.return_value.scalar_one_or_none.return_value = None
        result = cloudtrail_event_guardduty_disabled.run(mock_db, account.id)
        assert result == []

    def test_delete_detector_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "DeleteDetector")
        mock_db.execute.return_value.scalar_one_or_none.return_value = event
        result = cloudtrail_event_guardduty_disabled.run(mock_db, account.id)
        assert len(result) == 1
        assert result[0].severity == "high"
        assert "deleted" in result[0].title.lower()


# ---------------------------------------------------------------------------
# Check 9: Config Recorder Stopped
# ---------------------------------------------------------------------------
class TestConfigRecorderStopped:
    CHECK_ID = "cloudtrail.event.config_recorder_stopped"

    def test_clean_account_returns_empty(self, mock_db, account):
        mock_db.get.return_value = account
        mock_db.execute.return_value.scalar_one_or_none.return_value = None
        result = cloudtrail_event_config_recorder_stopped.run(mock_db, account.id)
        assert result == []

    def test_stop_config_recorder_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "StopConfigurationRecorder")
        mock_db.execute.return_value.scalar_one_or_none.return_value = event
        result = cloudtrail_event_config_recorder_stopped.run(mock_db, account.id)
        assert len(result) == 1
        assert "stopped" in result[0].title.lower()


# ---------------------------------------------------------------------------
# Check 10: IAM Access Key Created
# ---------------------------------------------------------------------------
class TestIAMAccessKeyCreated:
    CHECK_ID = "cloudtrail.event.iam_access_key_created"

    def test_clean_account_returns_empty(self, mock_db, account):
        mock_db.get.return_value = account
        mock_db.scalars.return_value.all.return_value = []
        result = cloudtrail_event_iam_access_key_created.run(mock_db, account.id)
        assert result == []

    def test_create_access_key_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "CreateAccessKey")
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_iam_access_key_created.run(mock_db, account.id)
        assert len(result) == 1
        assert result[0].severity == "medium"
        assert "created" in result[0].title.lower()

    def test_update_access_key_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "UpdateAccessKey")
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_iam_access_key_created.run(mock_db, account.id)
        assert len(result) == 1
        assert "modified" in result[0].title.lower()


# ---------------------------------------------------------------------------
# Check 11: S3 Public Access Block Disabled
# ---------------------------------------------------------------------------
class TestS3PABDisabled:
    CHECK_ID = "cloudtrail.event.s3_public_access_block_disabled"

    def test_clean_account_returns_empty(self, mock_db, account):
        mock_db.get.return_value = account
        mock_db.scalars.return_value.all.return_value = []
        result = cloudtrail_event_s3_public_access_block_disabled.run(mock_db, account.id)
        assert result == []

    def test_delete_pab_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "DeleteBucketPublicAccessBlock")
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_s3_public_access_block_disabled.run(mock_db, account.id)
        assert len(result) == 1
        assert result[0].severity == "critical"

    def test_put_pab_enabling_returns_empty(self, mock_db, account):
        """PutBucketPublicAccessBlock with all true settings should NOT trigger (enabling PAB)."""
        mock_db.get.return_value = account
        event = _make_event(account.id, "PutBucketPublicAccessBlock", raw={
            "requestParameters": {
                "PublicAccessBlockConfiguration": {
                    "BlockPublicAcls": True,
                    "IgnorePublicAcls": True,
                    "BlockPublicPolicy": True,
                    "RestrictPublicBuckets": True,
                }
            }
        })
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_s3_public_access_block_disabled.run(mock_db, account.id)
        assert result == []

    def test_put_pab_disabling_returns_finding(self, mock_db, account):
        """PutBucketPublicAccessBlock with a false setting SHOULD trigger (disabling PAB)."""
        mock_db.get.return_value = account
        event = _make_event(account.id, "PutBucketPublicAccessBlock", raw={
            "requestParameters": {
                "PublicAccessBlockConfiguration": {
                    "BlockPublicAcls": False,
                    "IgnorePublicAcls": True,
                    "BlockPublicPolicy": True,
                    "RestrictPublicBuckets": True,
                }
            }
        })
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_s3_public_access_block_disabled.run(mock_db, account.id)
        assert len(result) == 1


# ---------------------------------------------------------------------------
# Check 12: Lambda Created or Modified
# ---------------------------------------------------------------------------
class TestLambdaModified:
    CHECK_ID = "cloudtrail.event.lambda_function_created_or_modified"

    def test_clean_account_returns_empty(self, mock_db, account):
        mock_db.get.return_value = account
        mock_db.scalars.return_value.all.return_value = []
        result = cloudtrail_event_lambda_function_created_or_modified.run(mock_db, account.id)
        assert result == []

    def test_create_function_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "CreateFunction", raw={
            "requestParameters": {"functionName": "my-function"}
        })
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_lambda_function_created_or_modified.run(mock_db, account.id)
        assert len(result) == 1
        assert result[0].severity == "medium"

    def test_update_function_config_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "UpdateFunctionConfiguration")
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_lambda_function_created_or_modified.run(mock_db, account.id)
        assert len(result) == 1


# ---------------------------------------------------------------------------
# Check 13: EC2 Instance Tampering
# ---------------------------------------------------------------------------
class TestEC2Tampering:
    CHECK_ID = "cloudtrail.event.ec2_instance_tampering"

    def test_clean_account_returns_empty(self, mock_db, account):
        mock_db.get.return_value = account
        mock_db.scalars.return_value.all.return_value = []
        result = cloudtrail_event_ec2_instance_tampering.run(mock_db, account.id)
        assert result == []

    def test_terminate_instances_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "TerminateInstances")
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_ec2_instance_tampering.run(mock_db, account.id)
        assert len(result) == 1
        assert result[0].severity == "high"

    def test_modify_instance_attribute_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "ModifyInstanceAttribute", raw={
            "requestParameters": {"attribute": "userData"}
        })
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_ec2_instance_tampering.run(mock_db, account.id)
        assert len(result) == 1


# ---------------------------------------------------------------------------
# Check 14: RDS Instance Created or Modified
# ---------------------------------------------------------------------------
class TestRDSModified:
    CHECK_ID = "cloudtrail.event.rds_instance_created_or_modified"

    def test_clean_account_returns_empty(self, mock_db, account):
        mock_db.get.return_value = account
        mock_db.scalars.return_value.all.return_value = []
        result = cloudtrail_event_rds_instance_created_or_modified.run(mock_db, account.id)
        assert result == []

    def test_create_db_instance_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "CreateDBInstance")
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_rds_instance_created_or_modified.run(mock_db, account.id)
        assert len(result) == 1
        assert result[0].severity == "high"

    def test_modify_db_instance_suspicious_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        event = _make_event(account.id, "ModifyDBInstance", raw={
            "requestParameters": {"publiclyAccessible": True, "deletionProtection": False}
        })
        mock_db.scalars.return_value.all.return_value = [event]
        result = cloudtrail_event_rds_instance_created_or_modified.run(mock_db, account.id)
        assert len(result) == 1
        assert "publiclyAccessible" in result[0].title


# ---------------------------------------------------------------------------
# Check 15: Anomalous API Volume
# ---------------------------------------------------------------------------
class TestAnomalousVolume:
    CHECK_ID = "cloudtrail.event.anomalous_api_volume"

    def test_clean_account_returns_empty(self, mock_db, account):
        mock_db.get.return_value = account
        mock_db.scalar.return_value = 0  # recent count
        mock_db.scalar.side_effect = [5, 10]  # recent, total
        result = cloudtrail_event_anomalous_api_volume.run(mock_db, account.id)
        assert result == []

    def test_below_threshold_returns_empty(self, mock_db, account):
        mock_db.get.return_value = account
        mock_db.scalar.side_effect = [4, 20]  # recent, total — below 50 min
        mock_db.execute.return_value.all.return_value = []
        result = cloudtrail_event_anomalous_api_volume.run(mock_db, account.id)
        assert result == []

    def test_normal_volume_returns_empty(self, mock_db, account):
        mock_db.get.return_value = account
        # 500 over 90d = ~5.5/day. 10 in 24h = 1.8x NOT a spike
        mock_db.scalar.side_effect = [10, 500]  # recent, total
        mock_db.execute.return_value.all.return_value = []
        result = cloudtrail_event_anomalous_api_volume.run(mock_db, account.id)
        assert result == []

    def test_spike_returns_finding(self, mock_db, account):
        mock_db.get.return_value = account
        # 100 over 90d = ~1.1/day. 50 in 24h = 45x spike
        mock_db.scalar.side_effect = [50, 100]  # recent, total
        mock_db.execute.return_value.all.return_value = [
            MagicMock(event_name="CreateUser", cnt=20),
            MagicMock(event_name="PutObject", cnt=15),
        ]
        result = cloudtrail_event_anomalous_api_volume.run(mock_db, account.id)
        assert len(result) == 1
        assert result[0].severity == "medium"
        assert "spike" in result[0].title.lower()
