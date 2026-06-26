"""Tests for GET /v1/findings/summary."""
from __future__ import annotations


def test_findings_summary(client, auth_headers, finding_factory):
    finding_factory(status="open", severity="high", check_id="iam.user.no_mfa")
    finding_factory(status="open", severity="critical", check_id="iam.user.no_mfa")
    finding_factory(status="resolved", severity="low", check_id="s3.bucket.public_read")

    resp = client.get("/v1/findings/summary", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 3
    assert data["by_status"].get("open", 0) >= 2
    assert data["by_severity"].get("critical", 0) >= 1
    assert any(row["check_id"] == "iam.user.no_mfa" for row in data["top_checks"])
