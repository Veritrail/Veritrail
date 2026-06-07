from app.services.check_settings import hidden_check_ids, is_check_enabled, optional_checks_for_ui


def test_wildcard_resource_on_by_default():
    assert is_check_enabled({}, "iam.policy.wildcard_resource") is True
    assert is_check_enabled({}, "iam.policy.unattached") is False
    assert is_check_enabled({}, "git.repo.no_codeowners") is False
    assert is_check_enabled({}, "github.repo.no_codeowners") is False
    assert is_check_enabled({}, "gitlab.repo.no_codeowners") is False


def test_wildcard_resource_can_be_disabled():
    settings = {"checks": {"iam.policy.wildcard_resource": {"enabled": False}}}
    assert is_check_enabled(settings, "iam.policy.wildcard_resource") is False
    settings2 = {"checks": {"iam.policy.unattached": {"enabled": True}}}
    assert is_check_enabled(settings2, "iam.policy.unattached") is True


def test_benchmark_check_on_by_default():
    assert is_check_enabled({}, "iam.role.least_privilege_policy") is True


def test_hidden_check_ids():
    hidden = hidden_check_ids({})
    assert "iam.policy.unattached" in hidden
    assert "git.repo.no_codeowners" in hidden
    assert "github.repo.no_codeowners" in hidden
    assert "gitlab.repo.no_codeowners" in hidden
    assert "iam.policy.wildcard_resource" not in hidden
    assert "iam.policy.unattached" not in hidden_check_ids(
        {"checks": {"iam.policy.unattached": {"enabled": True}}}
    )
    assert "gitlab.repo.no_codeowners" not in hidden_check_ids(
        {"checks": {"git.repo.no_codeowners": {"enabled": True}}}
    )


def test_git_codeowners_toggle_enables_both_providers():
    enabled = {"checks": {"git.repo.no_codeowners": {"enabled": True}}}
    assert is_check_enabled(enabled, "github.repo.no_codeowners") is True
    assert is_check_enabled(enabled, "gitlab.repo.no_codeowners") is True


def test_legacy_github_codeowners_setting_still_works():
    legacy = {"checks": {"github.repo.no_codeowners": {"enabled": True}}}
    assert is_check_enabled(legacy, "git.repo.no_codeowners") is True
    assert is_check_enabled(legacy, "gitlab.repo.no_codeowners") is True


def test_optional_checks_for_ui():
    rows = optional_checks_for_ui({})
    assert len(rows) == 2
    ids = {r["check_id"] for r in rows}
    assert ids == {"iam.policy.unattached", "git.repo.no_codeowners"}
    assert all(r["enabled"] is False for r in rows)
