"""Phase A — typed limitations, grading impacts, and audit-export verdicts."""
from __future__ import annotations

import ast
from pathlib import Path

from app.services.capability_limitations import (
    LIMITATION_REGISTRY,
    PREFIX_DEFINITIONS,
    has_blocking_limitation,
    limitation_impact,
    registered_static_codes,
    resolve_limitation,
    serialize_limitation,
)
from app.services.technical_capability import (
    CollectionMeta,
    apply_limitation_impacts,
    audit_verdict_for_lane,
    envelope,
    grade_from_enablement_and_activity,
)


def test_every_static_registry_code_resolves():
    for code in registered_static_codes():
        d = resolve_limitation(code)
        assert d.code == code
        assert d.impact in ("blocking", "degrading", "informational")
        assert d.title
        assert d.explanation
        assert d.action


def test_unknown_code_fails_closed_as_degrading():
    d = resolve_limitation("brand_new_unregistered_code")
    assert d.impact == "degrading"
    assert d.code == "brand_new_unregistered_code"
    assert "not yet classified" in d.explanation


def test_prefix_families_resolve():
    spot = resolve_limitation("spotlight_query_error_403")
    assert spot.impact == "informational"
    assert spot.code == "spotlight_query_error_403"

    threats = resolve_limitation("threats_query_error_500")
    assert threats.impact == "informational"

    insp = resolve_limitation("inspector_coverage_collection_failed:ClientError")
    assert insp.impact == "blocking"


def test_blocking_limitation_cannot_coexist_with_covered():
    assert (
        apply_limitation_impacts("covered", ["permission_denied"], collection_status="complete")
        == "unknown"
    )
    assert (
        apply_limitation_impacts(
            "covered", ["asset_denominator_not_collected"], collection_status="complete"
        )
        == "partial"
    )


def test_informational_optional_module_does_not_invalidate_covered():
    """Spotlight/Threats module gaps must not downgrade independently proven host coverage."""
    assert (
        apply_limitation_impacts(
            "covered",
            ["spotlight_vulnerabilities_not_licensed"],
            collection_status="complete",
        )
        == "covered"
    )
    assert (
        apply_limitation_impacts(
            "covered",
            ["threats_api_forbidden", "vulnerability_module_not_available"],
            collection_status="complete",
        )
        == "covered"
    )


def test_degrading_limitation_caps_covered_at_partial():
    assert (
        apply_limitation_impacts(
            "covered",
            ["enabled_without_observable_activity"],
            collection_status="complete",
        )
        == "partial"
    )


def test_incomplete_collection_cannot_stay_covered():
    assert (
        apply_limitation_impacts("covered", [], collection_status="partial") == "partial"
    )
    assert (
        apply_limitation_impacts("covered", [], collection_status="failed") == "unknown"
    )
    assert (
        apply_limitation_impacts("covered", [], collection_status="permission_denied")
        == "unknown"
    )


def test_grade_applies_limitation_and_collection_status():
    from datetime import datetime, timedelta, timezone

    now = datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc)
    scan_at = (now - timedelta(days=1)).isoformat()
    state = grade_from_enablement_and_activity(
        enabled=True,
        has_observable_activity=True,
        last_successful_scan_at=scan_at,
        capability="dependency_scanning",
        eligible=1,
        assessed=1,
        now=now,
        limitations=["permission_denied"],
    )
    assert state == "unknown"

    state_partial_coll = grade_from_enablement_and_activity(
        enabled=True,
        has_observable_activity=True,
        last_successful_scan_at=scan_at,
        capability="dependency_scanning",
        eligible=1,
        assessed=1,
        now=now,
        collection_status="partial",
    )
    assert state_partial_coll == "partial"


def test_envelope_carries_collection_meta():
    from datetime import datetime, timedelta, timezone

    now = datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc)
    env = envelope(
        capability="dependency_scanning",
        provider="github_dependabot",
        scope_type="repository",
        scope_id="acme/api",
        asset_type="source_repository",
        enabled=True,
        has_observable_activity=True,
        last_successful_scan_at=(now - timedelta(days=1)).isoformat(),
        eligible=1,
        assessed=1,
        now=now,
        collection=CollectionMeta(
            collection_status="partial",
            pages_fetched=2,
            items_fetched=40,
            limited_by="page_budget",
        ),
    )
    assert env.status == "partial"
    assert env.collection.collection_status == "partial"
    assert env.as_dict()["collection"]["pages_fetched"] == 2


def test_audit_verdict_verified_requires_honesty():
    covered = {
        "capability": "dependency_scanning",
        "label": "Dependency scanning (SCA)",
        "status": "covered",
        "coverage": {"eligible": 42, "assessed": 42, "excluded": 0},
        "limitations": [],
        "envelopes": [
            {"collection": {"collection_status": "complete"}},
        ],
    }
    v = audit_verdict_for_lane(covered)
    assert v["audit_verdict"] == "verified_technical_evidence"
    assert "42 of 42" in v["verdict_reason"]
    assert "policy" in v["scope_statement"].lower()


def test_audit_verdict_rejects_blocking_even_if_status_covered():
    bad = {
        "capability": "secret_scanning",
        "label": "Secret scanning",
        "status": "covered",
        "coverage": {"eligible": 1, "assessed": 1, "excluded": 0},
        "limitations": ["permission_denied"],
        "envelopes": [{"collection": {"collection_status": "complete"}}],
    }
    v = audit_verdict_for_lane(bad)
    assert v["audit_verdict"] == "insufficient_evidence"
    assert "permission_denied" in v["blocking_limitations"]


def test_audit_verdict_rejects_incomplete_collection():
    bad = {
        "capability": "dependency_scanning",
        "label": "Dependency scanning (SCA)",
        "status": "covered",
        "coverage": {"eligible": 10, "assessed": 10, "excluded": 0},
        "limitations": [],
        "envelopes": [{"collection": {"collection_status": "partial"}}],
    }
    v = audit_verdict_for_lane(bad)
    assert v["audit_verdict"] == "insufficient_evidence"


def test_audit_verdict_rejects_unknown_denominator():
    bad = {
        "capability": "host_workload_scanning",
        "label": "Host/workload scanning",
        "status": "covered",
        "coverage": {"eligible": 5, "assessed": 5, "excluded": 0},
        "limitations": ["asset_denominator_not_collected"],
        "envelopes": [{"collection": {"collection_status": "complete"}}],
    }
    v = audit_verdict_for_lane(bad)
    assert v["audit_verdict"] == "insufficient_evidence"


def test_audit_verdict_partial_and_stale_and_na():
    assert (
        audit_verdict_for_lane(
            {
                "status": "partial",
                "label": "SCA",
                "coverage": {"eligible": 10, "assessed": 4},
                "limitations": [],
            }
        )["audit_verdict"]
        == "partial_technical_evidence"
    )
    assert (
        audit_verdict_for_lane(
            {"status": "stale", "label": "SCA", "coverage": {}, "limitations": []}
        )["audit_verdict"]
        == "insufficient_evidence"
    )
    assert (
        audit_verdict_for_lane(
            {
                "status": "not_applicable",
                "label": "Serverless scanning",
                "coverage": {},
                "limitations": [],
            }
        )["audit_verdict"]
        == "not_applicable"
    )


def test_serialize_limitation_never_requires_browser_humanization():
    payload = serialize_limitation("permission_denied")
    assert payload["title"] == "Permission required"
    assert "_" not in payload["title"]
    assert payload["impact"] == "blocking"


def test_emitted_static_limitation_codes_are_registered():
    """Fail when a collector emits a new static code without a registry entry.

    Dynamic families (HTTP suffixes) must match a documented prefix definition.
    """
    root = Path(__file__).resolve().parents[1] / "app"
    targets = [
        root / "services" / "github_security_evidence.py",
        root / "services" / "gitlab_security_evidence.py",
        root / "services" / "cloud_capability_evidence.py",
        root / "services" / "scanner_capability_evidence.py",
        root / "services" / "operational_capability.py",
        root / "services" / "edr_integrations.py",
        root / "services" / "capability_lane_coverage.py",
        root / "services" / "technical_capability.py",
        root / "collectors" / "inspector.py",
        root / "collectors" / "azure" / "defender.py",
    ]
    registered = registered_static_codes()
    prefixes = tuple(p for p, _ in PREFIX_DEFINITIONS)

    def _const_str(node: ast.AST) -> str | None:
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        return None

    def _list_strs(node: ast.AST) -> list[str]:
        if isinstance(node, ast.List):
            return [s for elt in node.elts if (s := _const_str(elt)) is not None]
        if isinstance(node, ast.IfExp):
            return _list_strs(node.body) + _list_strs(node.orelse)
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            return _list_strs(node.left) + _list_strs(node.right)
        return []

    emitted: set[str] = set()
    for path in targets:
        if not path.exists():
            continue
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            # limitations=["code", ...]  or  limitations=list([...]) handled via List
            if isinstance(node, ast.keyword) and node.arg == "limitations":
                emitted.update(_list_strs(node.value))
                s = _const_str(node.value)
                if s:
                    emitted.add(s)
            # limitations.append("code") / .extend(["code"])
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                if node.func.attr in ("append", "extend") and isinstance(
                    node.func.value, ast.Name
                ):
                    if node.func.value.id == "limitations" or node.func.value.id.endswith(
                        "_limitations"
                    ):
                        for arg in node.args:
                            s = _const_str(arg)
                            if s:
                                emitted.add(s)
                            emitted.update(_list_strs(arg))
                            # f"prefix_{expr}" → record prefix family via JoinedStr
                            if isinstance(arg, ast.JoinedStr) and arg.values:
                                first = arg.values[0]
                                if isinstance(first, ast.Constant) and isinstance(
                                    first.value, str
                                ):
                                    emitted.add(first.value.rstrip("_") + "_")
            # "limitations": ["code"]
            if isinstance(node, ast.Dict):
                for key, value in zip(node.keys, node.values):
                    if _const_str(key) == "limitations":
                        emitted.update(_list_strs(value))

    missing = sorted(
        c
        for c in emitted
        if c
        and not c.endswith("_")  # prefix markers from f-strings
        and c not in registered
        and not any(c.startswith(p) for p in prefixes)
    )
    # Prefix markers themselves must match PREFIX_DEFINITIONS.
    missing_prefixes = sorted(
        c
        for c in emitted
        if c.endswith("_") and not any(c.startswith(p) or p.startswith(c) for p in prefixes)
        and c
        not in (
            # allow exact family keys that are registered as static when no dynamic suffix
        )
    )
    # Only require prefix markers that look like error families.
    missing_prefixes = [
        c
        for c in missing_prefixes
        if any(tok in c for tok in ("error", "failed", "status", "query"))
    ]
    assert not missing, f"Unregistered limitation codes: {missing}"
    assert not missing_prefixes, f"Unregistered limitation prefixes: {missing_prefixes}"


def test_blocking_helper():
    assert has_blocking_limitation(["permission_denied", "enabled_without_observable_activity"])
    assert not has_blocking_limitation(["spotlight_vulnerabilities_not_licensed"])
    assert limitation_impact("enablement_only_legacy_snapshot") == "degrading"


def test_registry_covers_spec_required_codes():
    required = {
        "permission_denied",
        "unavailable_by_plan",
        "unavailable_by_plan_or_tier",
        "enablement_only_legacy_snapshot",
        "legacy_sync_summary_only",
        "asset_denominator_not_collected",
        "scanner_connected_without_assessed_assets",
        "inspector_resource_coverage_not_collected",
        "enablement_only_plan_detail_missing",
        "enablement_only_no_plan_inventory",
        "threats_api_forbidden",
        "spotlight_vulnerabilities_not_licensed",
        "vulnerability_module_not_available",
        "collection_error",
    }
    assert required <= registered_static_codes()
    assert LIMITATION_REGISTRY  # nonzero
