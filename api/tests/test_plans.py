"""Plan-tier entitlements (connected-account cap)."""
from app.data.plans import get_plan, is_account_limit_reached, plan_account_limit


def test_account_limits_per_tier():
    assert plan_account_limit("trial") == 1
    assert plan_account_limit("starter") == 3
    assert plan_account_limit("growth") == 10
    assert plan_account_limit("scale") == 25
    assert plan_account_limit("enterprise") is None  # unlimited


def test_legacy_and_unknown_slugs_fall_back():
    assert plan_account_limit("free") == 1  # legacy alias → trial
    assert plan_account_limit("paid") == 10  # legacy alias → growth
    assert plan_account_limit("nonsense") == 1  # unknown → trial default
    assert plan_account_limit(None) == 1


def test_is_account_limit_reached():
    assert is_account_limit_reached("trial", 1) is True
    assert is_account_limit_reached("trial", 0) is False
    assert is_account_limit_reached("growth", 9) is False
    assert is_account_limit_reached("growth", 10) is True
    assert is_account_limit_reached("enterprise", 10_000) is False  # unlimited never reached


def test_plan_labels():
    assert get_plan("scale").label == "Scale"
    assert get_plan("free").label == "Trial"  # alias resolves to trial tier
