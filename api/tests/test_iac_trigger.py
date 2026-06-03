"""Tests for IaC scan orchestration (native + optional external) and GitHub webhook helpers."""
from __future__ import annotations

import hashlib
import hmac

from app.services import iac_external_scan as ext
from app.services.github_webhook import (
    changed_iac_paths,
    event_context,
    verify_github_signature,
)
from app.services.iac_external_scan import combined_scan
from app.services.iac_security_scan import SEV_HIGH

_ADMIN_TF = '''
resource "aws_iam_policy" "admin" {
  policy = jsonencode({ Statement = [{ Effect = "Allow", Action = "*", Resource = "*" }] })
}
'''


def test_combined_scan_native_always_on_external_unavailable(monkeypatch):
    monkeypatch.setattr(ext, "external_engine_available", lambda e: False)
    summary = combined_scan([{"path": "main.tf", "content": _ADMIN_TF}], ["checkov"])
    # native wildcard_action present
    assert summary["total"] >= 1
    assert summary["highest_severity"] == SEV_HIGH
    rule_ids = {f["rule_id"] for f in summary["findings"]}
    assert "iac.iam.wildcard_action" in rule_ids
    # engine status: native available + checkov reported unavailable (graceful)
    engines = {e["engine"]: e for e in summary["engines"]}
    assert engines["native"]["available"] is True
    assert engines["checkov"]["available"] is False


def test_combined_scan_no_engines_is_native_only():
    summary = combined_scan([{"path": "main.tf", "content": _ADMIN_TF}], [])
    assert [e["engine"] for e in summary["engines"]] == ["native"]
    assert summary["total"] >= 1


def test_verify_github_signature_roundtrip():
    secret = "whisper"
    payload = b'{"zen":"keep it simple"}'
    good = "sha256=" + hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    assert verify_github_signature(secret, payload, good) is True
    # wrong signature, wrong secret, missing header, empty secret all fail closed
    assert verify_github_signature(secret, payload, "sha256=deadbeef") is False
    assert verify_github_signature("other", payload, good) is False
    assert verify_github_signature(secret, payload, None) is False
    assert verify_github_signature("", payload, good) is False
    assert verify_github_signature(secret, payload, "md5=abc") is False


def test_changed_iac_paths_filters_tf_and_hcl():
    event = {
        "commits": [
            {"added": ["infra/main.tf", "README.md"], "modified": ["app/handler.py"]},
            {"added": ["infra/network.hcl"], "modified": ["infra/main.tf", "docs/x.md"]},
        ]
    }
    assert changed_iac_paths(event) == ["infra/main.tf", "infra/network.hcl"]


def test_changed_iac_paths_empty_is_safe():
    assert changed_iac_paths({}) == []
    assert changed_iac_paths({"commits": []}) == []


def test_event_context_push_and_pull_request():
    push = {"repository": {"full_name": "acme/infra"}, "ref": "refs/heads/main"}
    ctx = event_context(push)
    assert ctx == {"repo": "acme/infra", "branch": "main", "pr_number": None}

    pr = {
        "repository": {"full_name": "acme/infra"},
        "number": 42,
        "pull_request": {"head": {"ref": "feature/vpc"}},
    }
    ctx = event_context(pr)
    assert ctx["repo"] == "acme/infra"
    assert ctx["branch"] == "feature/vpc"
    assert ctx["pr_number"] == 42
