"""Acceptance tests for web resourceAffectedReason (Resources tab "why" column)."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
WEB_ROOT = REPO_ROOT / "web"
TS_PATH = WEB_ROOT / "src" / "lib" / "resourceAffectedReason.ts"

FIXTURES = [
    {
        "check_id": "iam.role.least_privilege_policy",
        "evidence": {"sources": ["customer managed full admin: AdminAccessPolicy"]},
        "expected": "Granted via customer managed full admin: AdminAccessPolicy.",
    },
    {
        "check_id": "iam.role.least_privilege_policy",
        "evidence": {"scope": "full_admin"},
        "expected": "Grants full admin (Action:* + Resource:*).",
    },
    {
        "check_id": "iam.user.admin_policy_attached",
        "evidence": {"admin_policies": ["AdministratorAccess"]},
        "expected": "Admin policy attached: AdministratorAccess.",
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
        "expected": "Allows 0.0.0.0/0 on port 22.",
    },
    {
        "check_id": "kms.key.policy_wildcard_principal",
        "evidence": {"alias": "alias/prod-secrets", "key_id": "abc-123"},
        "expected": "Key policy for alias/prod-secrets allows principal *.",
    },
    {
        "check_id": "iam.role.external_account_trust",
        "evidence": {"external_account_ids": ["111122223333", "444455556666"]},
        "expected": "Trusts external AWS account 111122223333, 444455556666.",
    },
    {
        "check_id": "iam.access_key.unused_90d",
        "evidence": {"days_unused": 120},
        "expected": "No use recorded in 120+ days.",
    },
    {
        "check_id": "s3.bucket.no_kms",
        "evidence": {},
        "expected": "Objects are stored without SSE KMS at rest.",
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


def test_resource_affected_reason_fixtures():
    assert TS_PATH.exists(), f"missing implementation: {TS_PATH}"
    for case in FIXTURES:
        got = _run_resource_affected_reason(case["check_id"], case["evidence"])
        assert got == case["expected"], f"{case['check_id']}: got {got!r}, want {case['expected']!r}"
