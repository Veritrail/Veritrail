"""Tests for the optional external IaC scanner wrappers (Checkov / tfsec).

The binaries are not installed in CI, so these cover the pure parsers + the graceful-degradation
contract (missing binary / unsupported engine never raises).
"""
from __future__ import annotations

from app.services import iac_external_scan as ext
from app.services.iac_external_scan import (
    parse_checkov_json,
    parse_tfsec_json,
    run_engine,
    run_external,
)
from app.services.iac_security_scan import SEV_HIGH, SEV_MEDIUM


def test_parse_checkov_json_maps_failed_checks():
    data = {
        "check_type": "terraform",
        "results": {
            "failed_checks": [
                {
                    "check_id": "CKV_AWS_18",
                    "check_name": "Ensure S3 has access logging",
                    "severity": "LOW",
                    "file_path": "/main.tf",
                    "file_line_range": [10, 14],
                    "resource": "aws_s3_bucket.logs",
                    "guideline": "https://docs.example/ckv18",
                },
            ]
        },
    }
    findings = parse_checkov_json(data)
    assert len(findings) == 1
    f = findings[0]
    assert f.rule_id == "checkov.CKV_AWS_18"
    assert f.engine == "checkov"
    assert f.resource_type == "aws_s3_bucket"
    assert f.resource_name == "logs"
    assert f.file_path == "main.tf"  # leading slash stripped
    assert f.line == 10


def test_parse_checkov_json_empty_is_safe():
    assert parse_checkov_json({}) == []
    assert parse_checkov_json({"results": {}}) == []


def test_parse_tfsec_json_maps_results_and_severity():
    data = {
        "results": [
            {
                "rule_id": "aws-vpc-no-public-ingress-sgr",
                "rule_description": "Security group rule allows ingress from public internet",
                "severity": "CRITICAL",
                "resource": "aws_security_group_rule.ssh",
                "location": {"filename": "/sg.tf", "start_line": 5},
                "resolution": "Restrict the CIDR block",
                "links": ["https://tfsec.dev/docs/x"],
            }
        ]
    }
    findings = parse_tfsec_json(data)
    assert len(findings) == 1
    f = findings[0]
    assert f.rule_id == "tfsec.aws-vpc-no-public-ingress-sgr"
    assert f.severity == SEV_HIGH  # CRITICAL -> high
    assert f.resource_type == "aws_security_group_rule"
    assert f.file_path == "sg.tf"
    assert f.line == 5
    assert f.refs == ["https://tfsec.dev/docs/x"]


def test_severity_mapping_medium_and_unknown_default():
    data = {"results": [{"rule_id": "r1", "severity": "WARNING", "location": {}},
                        {"rule_id": "r2", "severity": "weird", "location": {}}]}
    sevs = [f.severity for f in parse_tfsec_json(data)]
    assert sevs[0] == SEV_MEDIUM  # WARNING -> medium
    assert sevs[1] == SEV_MEDIUM  # unknown -> medium default


def test_run_engine_unsupported_is_graceful():
    res = run_engine("trivy", [{"path": "main.tf", "content": ""}])
    assert res["available"] is False
    assert "unsupported" in res["reason"]
    assert res["findings"] == []


def test_run_engine_missing_binary_is_graceful(monkeypatch):
    monkeypatch.setattr(ext, "external_engine_available", lambda e: False)
    res = run_engine("checkov", [{"path": "main.tf", "content": 'resource "aws_s3_bucket" "b" {}'}])
    assert res["available"] is False
    assert "not found on PATH" in res["reason"]
    assert res["findings"] == []


def test_run_external_returns_one_result_per_engine(monkeypatch):
    monkeypatch.setattr(ext, "external_engine_available", lambda e: False)
    results = run_external([{"path": "main.tf", "content": ""}], ["checkov", "tfsec"])
    assert [r["engine"] for r in results] == ["checkov", "tfsec"]
    assert all(r["available"] is False for r in results)
