"""Pull open findings from connected vulnerability scanners into the findings table."""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.checks.base import FindingDraft, score
from app.checks.persist import persist_org_findings
from app.models.github import IdentityProvider
from app.services.scanner_integrations import VENDOR_LABELS, _wiz_token
from app.services.scanner_types import ImportedScannerFinding, normalize_severity
from app.services.snyk_shaped_scanner import FETCH_BY_VENDOR

MAX_FINDINGS_PER_SYNC = 500


@dataclass
class ScannerSyncStats:
    vendor: str
    imported: int = 0
    opened: int = 0
    resolved: int = 0
    open_findings_count: int = 0
    last_synced_at: str = ""


def check_id_for_vendor(vendor: str) -> str:
    key = (vendor or "").strip().lower()
    return f"scanner.{key}.open_finding"


def resource_arn_for(vendor: str, external_id: str) -> str:
    return f"{vendor.lower()}://finding/{external_id}"


def fetch_open_findings(vendor: str, cfg: dict[str, Any]) -> list[ImportedScannerFinding]:
    key = (vendor or "").strip().lower()
    if key == "wiz":
        return _fetch_wiz_findings(cfg)
    if key == "tenable":
        return _fetch_tenable_findings(cfg)
    if key == "qualys":
        return _fetch_qualys_findings(cfg)
    fetch = FETCH_BY_VENDOR.get(key)
    if fetch:
        return fetch(cfg)
    raise ValueError(f"Unsupported scanner vendor: {vendor}")


def _to_drafts(vendor: str, rows: list[ImportedScannerFinding]) -> list[FindingDraft]:
    check_id = check_id_for_vendor(vendor)
    label = VENDOR_LABELS.get(vendor, vendor.title())
    drafts: list[FindingDraft] = []
    for row in rows:
        severity = normalize_severity(row.severity)
        title = row.title.strip() or f"{label} open finding"
        drafts.append(
            FindingDraft(
                check_id=check_id,
                resource_arn=resource_arn_for(vendor, row.external_id),
                title=title,
                severity=severity,
                risk_score=score(severity),
                evidence={
                    "vendor": vendor,
                    "external_id": row.external_id,
                    "source": label,
                    "resource_label": row.resource_label,
                    **row.extra,
                },
            )
        )
    return drafts


def sync_scanner_provider(
    db: Session,
    provider: IdentityProvider,
    vendor: str,
    cfg: dict[str, Any],
) -> ScannerSyncStats:
    """Fetch scanner findings, upsert with dedup, and auto-resolve stale rows."""
    key = (vendor or "").strip().lower()
    imported = fetch_open_findings(key, cfg)
    check_id = check_id_for_vendor(key)
    drafts = _to_drafts(key, imported)
    opened, resolved = persist_org_findings(
        db,
        org_id=provider.org_id,
        drafts=drafts,
        check_ids_run={check_id},
    )
    now = datetime.now(timezone.utc).isoformat()
    return ScannerSyncStats(
        vendor=key,
        imported=len(imported),
        opened=opened,
        resolved=resolved,
        open_findings_count=len(imported),
        last_synced_at=now,
    )


def _fetch_wiz_findings(cfg: dict[str, Any]) -> list[ImportedScannerFinding]:
    api_url = (cfg.get("api_url") or "").rstrip("/")
    token = _wiz_token(api_url, cfg["client_id"], cfg["client_secret"])
    query = """
    query ($first: Int) {
      issuesV2(filterBy: {status: [OPEN]}, first: $first) {
        nodes {
          id
          severity
          entitySnapshot { type name }
          sourceRule { name }
        }
      }
    }
    """
    with httpx.Client(timeout=60.0) as client:
        resp = client.post(
            f"{api_url}/graphql",
            headers={"Authorization": f"Bearer {token}"},
            json={"query": query, "variables": {"first": min(MAX_FINDINGS_PER_SYNC, 200)}},
        )
    if resp.status_code >= 400:
        raise ValueError(f"Wiz sync error {resp.status_code}")
    nodes = ((resp.json().get("data") or {}).get("issuesV2") or {}).get("nodes") or []
    out: list[ImportedScannerFinding] = []
    for node in nodes:
        issue_id = node.get("id")
        if not issue_id:
            continue
        entity = node.get("entitySnapshot") or {}
        rule = (node.get("sourceRule") or {}).get("name")
        entity_name = entity.get("name") or entity.get("type")
        title_bits = [bit for bit in (rule, entity_name) if bit]
        out.append(
            ImportedScannerFinding(
                external_id=str(issue_id),
                title=" — ".join(title_bits) if title_bits else "Wiz open issue",
                severity=str(node.get("severity") or "medium"),
                resource_label=entity_name if isinstance(entity_name, str) else None,
                extra={"entity_type": entity.get("type")},
            )
        )
    return out[:MAX_FINDINGS_PER_SYNC]


def _fetch_tenable_findings(cfg: dict[str, Any]) -> list[ImportedScannerFinding]:
    api_url = (cfg.get("api_url") or "https://cloud.tenable.com").rstrip("/")
    headers = {"X-ApiKeys": f"accessKey={cfg['access_key']}; secretKey={cfg['secret_key']}"}
    with httpx.Client(timeout=60.0) as client:
        resp = client.get(
            f"{api_url}/workbenches/vulnerabilities",
            headers=headers,
            params={"date_range": 30, "limit": min(MAX_FINDINGS_PER_SYNC, 200)},
        )
    if resp.status_code >= 400:
        raise ValueError(f"Tenable sync error {resp.status_code}")
    rows = resp.json() or []
    if not isinstance(rows, list):
        rows = rows.get("vulnerabilities") or rows.get("items") or []
    out: list[ImportedScannerFinding] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        plugin = row.get("plugin") or {}
        plugin_id = plugin.get("id") or row.get("plugin_id")
        if plugin_id is None:
            continue
        title = plugin.get("name") or row.get("plugin_name") or f"Tenable plugin {plugin_id}"
        severity = plugin.get("severity") or row.get("severity") or "medium"
        asset = row.get("asset") or {}
        resource = asset.get("hostname") or asset.get("fqdn") or asset.get("uuid")
        out.append(
            ImportedScannerFinding(
                external_id=str(plugin_id),
                title=str(title),
                severity=str(severity),
                resource_label=str(resource) if resource else None,
                extra={"plugin_id": plugin_id, "count": row.get("count")},
            )
        )
    return out[:MAX_FINDINGS_PER_SYNC]


def _fetch_qualys_findings(cfg: dict[str, Any]) -> list[ImportedScannerFinding]:
    platform_url = (cfg.get("platform_url") or "").rstrip("/")
    auth = (cfg["username"], cfg["password"])
    headers = {"X-Requested-With": "Veritrail"}
    with httpx.Client(timeout=60.0) as client:
        resp = client.get(
            f"{platform_url}/api/2.0/fo/asset/host/vm/detection/",
            params={
                "action": "list",
                "status": "New,Active,Re-Opened",
                "truncation_limit": min(MAX_FINDINGS_PER_SYNC, 200),
                "show_results": 1,
            },
            auth=auth,
            headers=headers,
        )
    if resp.status_code >= 400:
        raise ValueError(f"Qualys sync error {resp.status_code}")
    return _parse_qualys_detections(resp.text or "")[:MAX_FINDINGS_PER_SYNC]


def _parse_qualys_detections(xml_text: str) -> list[ImportedScannerFinding]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    out: list[ImportedScannerFinding] = []
    for host in root.findall(".//HOST"):
        host_id = host.findtext("ID") or host.findtext("ID_REF")
        dns = host.findtext("DNS") or host.findtext("IP")
        for detection in host.findall("DETECTION"):
            qid = detection.findtext("QID")
            if not qid:
                continue
            severity = detection.findtext("SEVERITY") or "3"
            title = detection.findtext("TITLE") or f"Qualys detection QID {qid}"
            external_id = f"{host_id}:{qid}" if host_id else qid
            out.append(
                ImportedScannerFinding(
                    external_id=external_id,
                    title=title.strip(),
                    severity=_qualys_severity(severity),
                    resource_label=dns.strip() if isinstance(dns, str) and dns.strip() else None,
                    extra={"qid": qid, "host_id": host_id},
                )
            )
    if out:
        return out
    # Fallback: count-only KB response (legacy path) — no per-finding import.
    records = _qualys_records_count(xml_text)
    if records:
        return [
            ImportedScannerFinding(
                external_id="summary",
                title=f"Qualys reports {records} open detections (detail import unavailable)",
                severity="info",
                extra={"summary_only": True, "records": records},
            )
        ]
    return []


def _qualys_severity(raw: str) -> str:
    try:
        level = int(str(raw).strip())
    except ValueError:
        return "medium"
    if level >= 5:
        return "critical"
    if level == 4:
        return "high"
    if level == 3:
        return "medium"
    if level == 2:
        return "low"
    return "info"


def _qualys_records_count(xml_text: str) -> int:
    match = re.search(r"<RECORDS>\s*(\d+)\s*</RECORDS>", xml_text, re.I)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            return 0
    return 0
