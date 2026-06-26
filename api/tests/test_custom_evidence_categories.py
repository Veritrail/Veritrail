"""Tests for org-defined custom evidence categories."""
from __future__ import annotations

from app.services.custom_evidence_categories import (
    get_custom_evidence_categories,
    merge_custom_evidence_categories,
)


def test_merge_custom_categories_validates_keys():
    out = merge_custom_evidence_categories(
        {},
        [
            {"key": "vendor_risk", "label": "Vendor risk"},
            {"key": "INVALID", "label": "Bad"},
            {"key": "x", "label": "Too short key ok?"},
        ],
    )
    assert len(out) == 1
    assert out[0]["key"] == "vendor_risk"


def test_get_custom_categories_from_settings():
    stored = {"custom_evidence_categories": [{"key": "hr_training", "label": "HR training"}]}
    assert get_custom_evidence_categories(stored) == [{"key": "hr_training", "label": "HR training"}]
