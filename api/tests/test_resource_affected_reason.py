"""Acceptance tests for web resourceAffectedReason (Resources tab "why" column).

Primary CI coverage lives in web (`npm run test:resource-affected`). This module
keeps a local/dev path when Node is available; the API Docker image has no npx.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
# compose.yml mounts ./web at /web inside the API container; locally parents[2] is repo root.
WEB_ROOT = Path("/web") if Path("/web/src/lib/resourceAffectedReason.ts").exists() else REPO_ROOT / "web"
TS_PATH = WEB_ROOT / "src" / "lib" / "resourceAffectedReason.ts"

FIXTURES = [
    {
        "check_id": "iam.role.least_privilege_policy",
        "evidence": {"sources": ["customer managed full admin: AdminAccessPolicy"]},
        "expected": "Role has full administrator access — Customer-managed · AdminAccessPolicy",
    },
    {
        "check_id": "iam.role.least_privilege_policy",
        "evidence": {"scope": "full_admin"},
        "expected": "Role has full administrator access — Action:* · Resource:*",
    },
    {
        "check_id": "iam.user.admin_policy_attached",
        "evidence": {"admin_policies": ["AdministratorAccess"]},
        "expected": "User has full administrator access — Managed policy · AdministratorAccess",
    },
    {
        "check_id": "ec2.security_group.unrestricted_ssh",
        "evidence": {
            "group_name": "web",
            "exposing_rules": [
                {
                    "protocol": "tcp",
                    "from_port": 22,
                    "to_port": 22,
                    "cidr": "0.0.0.0/0",
                    "match_reason": "port_in_range",
                }
            ],
        },
        "expected": "Internet-exposed SSH — 0.0.0.0/0 · Port 22",
    },
    {
        "check_id": "kms.key.policy_wildcard_principal",
        "evidence": {"alias": "alias/prod-secrets", "key_id": "abc-123"},
        "expected": "KMS key permits any principal — Principal:* · alias/prod-secrets",
    },
    {
        "check_id": "iam.role.external_account_trust",
        "evidence": {"external_account_ids": ["111122223333", "444455556666"]},
        "expected": "External AWS account can assume this role — Trusted · 111122223333, 444455556666",
    },
    {
        "check_id": "iam.access_key.unused_90d",
        "evidence": {"days_unused": 120},
        "expected": "Unused access key remains active — No use · 120+ days",
    },
    {
        "check_id": "s3.bucket.no_kms",
        "evidence": {},
        "expected": "Bucket lacks KMS-backed encryption — No customer-controlled key protection",
    },
]


def _run_resource_affected_reason(check_id: str, evidence: dict) -> str:
    payload = json.dumps({"check_id": check_id, "evidence": evidence})
    script = f"""
import {{ resourceAffectedReason }} from './src/lib/resourceAffectedReason.ts';
const input = {payload};
const result = resourceAffectedReason(input);
console.log(JSON.stringify(result));
"""
    proc = subprocess.run(
        ["npx", "--yes", "tsx", "-e", script],
        cwd=WEB_ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    if proc.returncode != 0:
        raise AssertionError(
            f"tsx failed ({proc.returncode}): stdout={proc.stdout!r} stderr={proc.stderr!r}"
        )
    return json.loads(proc.stdout.strip())


@pytest.mark.skipif(shutil.which("npx") is None, reason="npx not available in API image; covered by web CI")
def test_resource_affected_reason_fixtures():
    assert TS_PATH.exists(), f"missing implementation: {TS_PATH}"
    for case in FIXTURES:
        got = _run_resource_affected_reason(case["check_id"], case["evidence"])
        assert got == case["expected"], f"{case['check_id']}: got {got!r}, want {case['expected']!r}"
