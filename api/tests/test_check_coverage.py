from app.services.check_coverage import (
    control_coverage_tier,
    extended_checks_in_list,
    tier_for_check,
)
from app.services.check_frameworks import frameworks_for_check


def test_guardduty_is_extended():
    assert tier_for_check("guardduty.detector.not_enabled") == "extended"


def test_root_keys_are_core():
    assert tier_for_check("iam.root.has_access_keys") == "core"


def test_control_coverage_mixed():
    tier = control_coverage_tier(["iam.root.no_mfa", "guardduty.detector.not_enabled"])
    assert tier == "mixed"


def test_least_privilege_maps_all_frameworks():
    assert "cis_aws_l1" in frameworks_for_check("iam.role.least_privilege_policy")
    assert "soc2" in frameworks_for_check("iam.role.least_privilege_policy")
    assert "iso27001" in frameworks_for_check("iam.role.least_privilege_policy")


def test_extended_checks_filter():
    ext = extended_checks_in_list(
        ["iam.root.no_mfa", "aws.securityhub.not_enabled", "s3.bucket.no_https_policy"]
    )
    assert ext == ["aws.securityhub.not_enabled"]
