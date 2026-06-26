from app.services.check_controls import check_control_bundle, primary_control_for_check
from app.services.composite_controls import composite_defs_for_check


def test_primary_framework_priority_soc2_first():
    primary = primary_control_for_check("iam.root.no_mfa")
    assert primary is not None
    assert primary["framework"] == "soc2"
    assert primary["control_id"] == "CC6.6"


def test_bundle_includes_reference_url():
    bundle = check_control_bundle("iam.root.no_mfa")
    assert bundle["primary"]["reference_url"]
    url = bundle["primary"]["reference_url"]
    assert "ctfassets.net" in url or "aicpa" in url
    assert len(bundle["controls"]) >= 2


def test_cis_reference_security_hub():
    bundle = check_control_bundle("iam.root.no_mfa")
    cis = next((c for c in bundle["controls"] if c["framework"] == "cis_aws_l1"), None)
    assert cis is not None
    assert cis["control_id"] == "1.4"
    assert "iam-4" in cis["reference_url"]


def test_iso_reference_27002_obp():
    bundle = check_control_bundle("iam.root.no_mfa")
    iso_rows = [c for c in bundle["controls"] if c["framework"] == "iso27001"]
    assert iso_rows
    for row in iso_rows:
        assert "27002" in row["reference_url"]


def test_legacy_unused_access_key_maps_like_45d():
    legacy = check_control_bundle("iam.access_key.unused_90d")
    current = check_control_bundle("iam.access_key.unused_45d")
    assert legacy["check_id"] == "iam.access_key.unused_90d"
    assert len(legacy["controls"]) == len(current["controls"]) >= 1
    assert {c["framework"] for c in legacy["controls"]} == {c["framework"] for c in current["controls"]}


def test_branch_protection_composite_primary_and_cc8_mapping():
    bundle = check_control_bundle("github.repo.no_branch_protection")
    assert bundle["primary_composite"]["id"] == "secure_sdlc"
    assert bundle["primary"]["framework"] == "soc2"
    assert bundle["primary"]["control_id"] == "CC8.1"
    soc2_ids = [c["control_id"] for c in bundle["controls"] if c["framework"] == "soc2"]
    assert "CC6.6" not in soc2_ids


def test_env_protection_composite_primary_and_cc8_only():
    bundle = check_control_bundle("github.repo.no_env_protection")
    assert bundle["primary_composite"]["id"] == "change_management"
    soc2_ids = [c["control_id"] for c in bundle["controls"] if c["framework"] == "soc2"]
    assert soc2_ids == ["CC8.1"]


def test_composite_defs_for_check_env_protection_change_management_only():
    composites = composite_defs_for_check("gitlab.repo.no_env_protection")
    assert [c["id"] for c in composites] == ["change_management"]


def test_bundle_includes_composites_list():
    bundle = check_control_bundle("iam.root.no_mfa")
    assert "composites" in bundle
    assert bundle["primary_composite"]["id"] == "identity_governance"


def test_gcp_public_ip_maps_to_soc_cis_iso_controls():
    bundle = check_control_bundle("gcp.compute.instance_public_ip")
    assert bundle["primary_composite"]["id"] == "data_protection"
    frameworks = {c["framework"] for c in bundle["controls"]}
    assert frameworks == {"soc2", "cis_aws_l1", "iso27001"}
    soc2_ids = [c["control_id"] for c in bundle["controls"] if c["framework"] == "soc2"]
    assert soc2_ids == ["CC6.6"]


def test_every_registered_check_has_primary_composite():
    from app.checks.registry import ALL_CHECKS

    missing = []
    for mod in ALL_CHECKS:
        bundle = check_control_bundle(mod.CHECK_ID)
        if not bundle.get("primary_composite"):
            missing.append(mod.CHECK_ID)
    assert not missing, f"checks without primary_composite: {missing}"
