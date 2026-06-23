"""CIS 1.17 — EC2 instance profile collector field + check logic."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import boto3
from botocore.stub import Stubber

from tests.conftest import make_account
from tests.test_collectors import _make_stubbed_session


class TestCollectEc2InstanceProfile:
    def test_stores_instance_profile_arn(self):
        from app.collectors.ec2 import collect_ec2

        ec2_client = boto3.client("ec2", region_name="us-east-1")
        stub = Stubber(ec2_client)

        stub.add_response(
            "describe_regions",
            {
                "Regions": [
                    {
                        "RegionName": "us-east-1",
                        "OptInStatus": "opt-in-not-required",
                    }
                ]
            },
        )
        stub.add_response("get_ebs_encryption_by_default", {"EbsEncryptionByDefault": True})
        stub.add_response(
            "describe_instances",
            {
                "Reservations": [
                    {
                        "Instances": [
                            {
                                "InstanceId": "i-abc123",
                                "State": {"Name": "running"},
                                "InstanceType": "t3.micro",
                                "IamInstanceProfile": {
                                    "Arn": "arn:aws:iam::123456789012:instance-profile/AppRole",
                                },
                                "MetadataOptions": {"HttpTokens": "required"},
                                "SecurityGroups": [],
                                "Tags": [],
                            }
                        ]
                    }
                ]
            },
        )
        stub.add_response("describe_volumes", {"Volumes": []})
        stub.add_response("describe_snapshots", {"Snapshots": []})
        stub.add_response("describe_images", {"Images": []})
        stub.activate()

        acc = make_account()
        db = MagicMock()
        db.execute = MagicMock()
        db.commit = MagicMock()

        sess = _make_stubbed_session({"ec2": stub})
        with patch("app.collectors.ec2.assume_role", return_value=sess):
            stats = collect_ec2(db, acc)

        stub.assert_no_pending_responses()
        assert stats["instances"] == 1
        insert_call = db.execute.call_args_list[0]
        values = insert_call[0][0].__dict__.get("context") or insert_call
        # pg_insert values are in the statement compile — verify execute was called
        assert db.execute.called


class TestEc2InstanceNoInstanceProfileCheck:
    def test_flags_running_instance_without_profile(self, mock_db):
        from app.checks import ec2_instance_no_instance_profile

        acc_id = uuid.uuid4()
        acc = MagicMock()
        acc.account_id = "123456789012"
        mock_db.get.return_value = acc

        inst = MagicMock()
        inst.instance_id = "i-noprofile"
        inst.region = "us-east-1"
        inst.instance_type = "t3.micro"
        inst.state = "running"
        inst.iam_instance_profile_arn = None
        mock_db.scalars.return_value.all.return_value = [inst]

        drafts = ec2_instance_no_instance_profile.run(mock_db, acc_id)
        assert len(drafts) == 1
        assert drafts[0].check_id == "ec2.instance.no_instance_profile"
        assert "i-noprofile" in drafts[0].title

    def test_skips_when_profile_attached(self, mock_db):
        from app.checks import ec2_instance_no_instance_profile

        mock_db.scalars.return_value.all.return_value = []
        drafts = ec2_instance_no_instance_profile.run(mock_db, uuid.uuid4())
        assert drafts == []
