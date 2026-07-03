"""Scanner auto-import sync tests."""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.checks.base import FindingDraft
from app.checks.persist import persist_org_findings
from app.models.github import IdentityProvider
from app.services.scanner_sync import (
    ImportedScannerFinding,
    _parse_qualys_detections,
    check_id_for_vendor,
    fetch_open_findings,
    normalize_severity,
    resource_arn_for,
    sync_scanner_provider,
)


def test_check_id_and_resource_arn_helpers():
    assert check_id_for_vendor("wiz") == "scanner.wiz.open_finding"
    assert resource_arn_for("tenable", "123") == "tenable://finding/123"
    assert normalize_severity("CRITICAL") == "critical"
    assert normalize_severity("high") == "high"


def test_parse_qualys_detections_xml():
    xml = """
    <HOST_LIST>
      <HOST>
        <ID>42</ID>
        <DNS>app.example.com</DNS>
        <DETECTION>
          <QID>90001</QID>
          <SEVERITY>4</SEVERITY>
          <TITLE>OpenSSL vulnerability</TITLE>
        </DETECTION>
      </HOST>
    </HOST_LIST>
    """
    rows = _parse_qualys_detections(xml)
    assert len(rows) == 1
    assert rows[0].external_id == "42:90001"
    assert rows[0].severity == "high"
    assert rows[0].resource_label == "app.example.com"


def test_fetch_wiz_findings_maps_nodes():
    cfg = {"api_url": "https://api.wiz.io", "client_id": "id", "client_secret": "sec"}
    payload = {
        "data": {
            "issuesV2": {
                "nodes": [
                    {
                        "id": "issue-1",
                        "severity": "HIGH",
                        "entitySnapshot": {"type": "VIRTUAL_MACHINE", "name": "vm-1"},
                        "sourceRule": {"name": "Public bucket"},
                    }
                ]
            }
        }
    }
    with patch("app.services.scanner_sync._wiz_token", return_value="tok"), patch(
        "app.services.scanner_sync.httpx.Client"
    ) as client_cls:
        client = MagicMock()
        client.__enter__.return_value = client
        client.__exit__.return_value = False
        client.post.return_value = MagicMock(status_code=200, json=lambda: payload)
        client_cls.return_value = client
        rows = fetch_open_findings("wiz", cfg)
    assert len(rows) == 1
    assert rows[0].external_id == "issue-1"
    assert "Public bucket" in rows[0].title


def test_persist_org_findings_dedup_and_resolve():
    from unittest.mock import MagicMock

    db = MagicMock()
    org_id = uuid.uuid4()
    check_id = check_id_for_vendor("wiz")
    existing = MagicMock()
    existing.check_id = check_id
    existing.resource_arn = resource_arn_for("wiz", "a")
    existing.status = "open"

    db.scalars.return_value.all.side_effect = [
        [existing],
        [],
    ]

    opened, resolved = persist_org_findings(
        db,
        org_id=org_id,
        drafts=[
            FindingDraft(
                check_id=check_id,
                resource_arn=resource_arn_for("wiz", "b"),
                title="Second",
                severity="medium",
                risk_score=40,
                evidence={"vendor": "wiz", "external_id": "b"},
            )
        ],
        check_ids_run={check_id},
    )
    assert opened == 1
    assert resolved == 1
    assert existing.status == "resolved"
    db.commit.assert_called()


def test_sync_scanner_provider_updates_stats():
    db = MagicMock()
    org_id = uuid.uuid4()
    provider = IdentityProvider(
        id=uuid.uuid4(),
        org_id=org_id,
        type="scanner_wiz",
        status="connected",
        config_json_encrypted="{}",
    )
    imported = [
        ImportedScannerFinding(
            external_id="x1",
            title="Wiz issue",
            severity="critical",
        )
    ]
    with patch("app.services.scanner_sync.fetch_open_findings", return_value=imported), patch(
        "app.services.scanner_sync.persist_org_findings",
        return_value=(1, 0),
    ) as persist_mock:
        stats = sync_scanner_provider(
            db,
            provider,
            "wiz",
            {"api_url": "https://api.wiz.io", "client_id": "a", "client_secret": "b"},
        )
    assert stats.imported == 1
    assert stats.opened == 1
    assert stats.open_findings_count == 1
    assert stats.last_synced_at
    persist_mock.assert_called_once()


def test_unsupported_vendor_raises():
    with pytest.raises(ValueError, match="Unsupported"):
        fetch_open_findings("unknown", {})
