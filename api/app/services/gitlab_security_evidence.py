"""Deep GitLab security evidence: dependency/SAST/secret/container + pipelines.

Phase 1 parity with GitHub semantics (docs/technical-evidence-coverage-spec.md).

Job-name heuristics remain as enablement/activity signals. When the GitLab
Vulnerability Report / findings API is available (typically Ultimate +
``read_api`` / security scopes), open findings are ingested with severity,
state, and dismissal metadata. Permission/plan gaps are recorded as limitations
and never treated as an empty inventory for auto-resolve.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from app.checks.base import FindingDraft, score
from app.services.scanner_types import normalize_severity

FINDINGS_PER_PAGE = 100

DEPENDENCY_CHECK_ID = "gitlab.dependency_scanning.open_finding"
SAST_CHECK_ID = "gitlab.sast.open_finding"
SECRET_CHECK_ID = "gitlab.secret_detection.open_finding"
CONTAINER_CHECK_ID = "gitlab.container_scanning.open_finding"

ALERT_CHECK_IDS = frozenset(
    {DEPENDENCY_CHECK_ID, SAST_CHECK_ID, SECRET_CHECK_ID, CONTAINER_CHECK_ID}
)

_REPORT_TYPE_TO_CHECK: dict[str, str] = {
    "dependency_scanning": DEPENDENCY_CHECK_ID,
    "sast": SAST_CHECK_ID,
    "secret_detection": SECRET_CHECK_ID,
    "container_scanning": CONTAINER_CHECK_ID,
}

_REPORT_TYPE_TO_CAPABILITY: dict[str, str] = {
    "dependency_scanning": "dependency_scanning",
    "sast": "source_code_scanning",
    "secret_detection": "secret_scanning",
    "container_scanning": "container_image_scanning",
}

_SECURITY_JOB_PATTERNS: dict[str, tuple[str, ...]] = {
    "sast": ("sast", "semgrep"),
    "dependency_scanning": ("dependency_scanning", "dependency-scanning", "gemnasium", "dependency"),
    "container_scanning": ("container_scanning", "container-scanning", "container scanning"),
    "secret_detection": ("secret_detection", "secret-detection", "gitleaks", "secrets"),
}

# Open vulnerability states on the Vulnerability Report API.
_OPEN_VULN_STATES = ("detected", "confirmed")


def _feature_block(
    *,
    enabled: bool | None,
    permission_status: str = "ok",
    last_successful_scan_at: str | None = None,
    open_findings: dict[str, int] | None = None,
    oldest_open_finding_at: str | None = None,
    alert_count: int = 0,
    has_observable_activity: bool = False,
    limitations: list[str] | None = None,
    job_status: str | None = None,
) -> dict[str, Any]:
    return {
        "enabled": enabled,
        "permission_status": permission_status,
        "last_successful_scan_at": last_successful_scan_at,
        "open_findings": open_findings or {"critical": 0, "high": 0, "medium": 0, "low": 0},
        "oldest_open_finding_at": oldest_open_finding_at,
        "alert_count": alert_count,
        "has_observable_activity": has_observable_activity,
        "job_status": job_status,
        "limitations": list(limitations or []),
    }


def _empty_counts() -> dict[str, int]:
    return {"critical": 0, "high": 0, "medium": 0, "low": 0}


def _bump(counts: dict[str, int], severity: str) -> None:
    key = normalize_severity(severity)
    if key == "info":
        key = "low"
    if key not in counts:
        key = "low"
    counts[key] = counts.get(key, 0) + 1


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _paginate_status(
    client: httpx.Client,
    url: str,
    *,
    params: dict[str, Any] | None = None,
) -> tuple[int, list[dict[str, Any]]]:
    """Page through a GitLab list endpoint; preserve non-200 status (no silent empty)."""
    rows: list[dict[str, Any]] = []
    page = 1
    last_status = 0
    while True:
        p = {"per_page": FINDINGS_PER_PAGE, "page": page, **(params or {})}
        resp = client.get(url, params=p)
        last_status = resp.status_code
        if resp.status_code != 200:
            return last_status, rows
        data = resp.json()
        if not isinstance(data, list):
            return last_status, rows
        if not data:
            break
        rows.extend(data)
        next_page = resp.headers.get("X-Next-Page", "")
        if not next_page:
            break
        page = int(next_page)
    return last_status, rows


def collect_gitlab_security_evidence(
    client: httpx.Client,
    api_base: str,
    project_id: int,
    default_branch: str | None,
    *,
    project_path: str | None = None,
    now: datetime | None = None,
) -> tuple[dict[str, Any], list[FindingDraft], set[str]]:
    """Return (security_features, finding drafts, collected_check_ids)."""
    now = now or datetime.now(timezone.utc)
    features: dict[str, Any] = {
        "sast": None,
        "dependency_scanning": None,
        "container_scanning": None,
        "secret_detection": None,
        "capability_evidence": {},
        "pipeline_evidence": {},
    }
    drafts: list[FindingDraft] = []
    collected: set[str] = set()

    params: dict[str, Any] = {"per_page": 10, "order_by": "id", "sort": "desc"}
    if default_branch:
        params["ref"] = default_branch

    resp = client.get(f"{api_base}/projects/{project_id}/pipelines", params=params)
    if resp.status_code in (401, 403):
        for key, cap in (
            ("dependency_scanning", "dependency_scanning"),
            ("sast", "source_code_scanning"),
            ("secret_detection", "secret_scanning"),
            ("container_scanning", "container_image_scanning"),
        ):
            features[key] = None
            features["capability_evidence"][cap] = _feature_block(
                enabled=None,
                permission_status="denied",
                limitations=["permission_denied"],
            )
        features["pipeline_evidence"] = {
            "permission_status": "denied",
            "has_observable_activity": False,
            "limitations": ["permission_denied"],
        }
        # Pipelines denied — still attempt vulnerability report (may share scopes).
        _ingest_vulnerability_report(
            client,
            api_base,
            project_id,
            project_path=project_path,
            features=features,
            drafts=drafts,
            collected=collected,
        )
        return features, drafts, collected

    if resp.status_code == 404 or not resp.is_success:
        for key in ("sast", "dependency_scanning", "container_scanning", "secret_detection"):
            features[key] = False
        features["capability_evidence"] = {
            "dependency_scanning": _feature_block(enabled=False),
            "source_code_scanning": _feature_block(enabled=False),
            "secret_scanning": _feature_block(enabled=False),
            "container_image_scanning": _feature_block(enabled=False),
        }
        features["pipeline_evidence"] = {
            "permission_status": "ok",
            "has_observable_activity": False,
            "limitations": ["no_pipelines"],
        }
        _ingest_vulnerability_report(
            client,
            api_base,
            project_id,
            project_path=project_path,
            features=features,
            drafts=drafts,
            collected=collected,
        )
        return features, drafts, collected

    pipelines = resp.json() if isinstance(resp.json(), list) else []
    job_hits: dict[str, dict[str, Any]] = {
        "sast": {},
        "dependency_scanning": {},
        "container_scanning": {},
        "secret_detection": {},
    }
    last_success_at: str | None = None
    security_required_hint = False

    for pipeline in pipelines[:5]:
        pid = pipeline.get("id")
        if not pid:
            continue
        if (pipeline.get("status") or "").lower() == "success" and last_success_at is None:
            last_success_at = pipeline.get("finished_at") or pipeline.get("updated_at")
        jobs_resp = client.get(f"{api_base}/projects/{project_id}/pipelines/{pid}/jobs")
        if jobs_resp.status_code != 200:
            continue
        for job in jobs_resp.json() if isinstance(jobs_resp.json(), list) else []:
            name = (job.get("name") or "").lower()
            status = (job.get("status") or "").lower()
            allow_failure = bool(job.get("allow_failure"))
            finished = job.get("finished_at") or job.get("created_at")
            for feature, patterns in _SECURITY_JOB_PATTERNS.items():
                if any(p in name for p in patterns):
                    prev = job_hits[feature]
                    # Prefer a successful observation.
                    if not prev or status == "success":
                        job_hits[feature] = {
                            "status": status,
                            "finished_at": finished,
                            "allow_failure": allow_failure,
                            "name": job.get("name"),
                        }
                    if not allow_failure:
                        security_required_hint = True

    for feature_key, cap_id in (
        ("dependency_scanning", "dependency_scanning"),
        ("sast", "source_code_scanning"),
        ("secret_detection", "secret_scanning"),
        ("container_scanning", "container_image_scanning"),
    ):
        hit = job_hits.get(feature_key) or {}
        enabled = bool(hit)
        features[feature_key] = enabled
        status = (hit.get("status") or "").lower()
        # A security job present on a recent pipeline is observable; failed jobs still count.
        activity = enabled and (
            status in ("success", "failed", "manual", "canceled", "") or hit.get("name")
        )
        limitations: list[str] = []
        if enabled and not activity:
            limitations.append("enabled_without_observable_activity")
        if hit.get("allow_failure"):
            limitations.append("security_job_allows_failure")
        observed_at = hit.get("finished_at") or (now.isoformat() if activity else None)
        features["capability_evidence"][cap_id] = _feature_block(
            enabled=enabled,
            last_successful_scan_at=hit.get("finished_at") if status == "success" else observed_at,
            has_observable_activity=bool(activity),
            limitations=limitations,
            job_status=status or None,
        )

    # Keep legacy keys used by existing GitLab checks.
    if features.get("secret_detection") is None:
        features["secret_detection"] = False

    features["pipeline_evidence"] = {
        "permission_status": "ok",
        "has_pipelines": bool(pipelines),
        "last_successful_pipeline_at": last_success_at,
        "security_jobs_required_hint": security_required_hint,
        "has_observable_activity": bool(pipelines) and bool(last_success_at or security_required_hint),
        "collected_at": now.isoformat(),
        "limitations": (
            []
            if security_required_hint
            else (["security_jobs_not_required"] if pipelines else ["no_pipelines"])
        ),
    }

    _ingest_vulnerability_report(
        client,
        api_base,
        project_id,
        project_path=project_path,
        features=features,
        drafts=drafts,
        collected=collected,
    )
    return features, drafts, collected


def _ingest_vulnerability_report(
    client: httpx.Client,
    api_base: str,
    project_id: int,
    *,
    project_path: str | None,
    features: dict[str, Any],
    drafts: list[FindingDraft],
    collected: set[str],
) -> None:
    """Enrich capability_evidence + emit drafts from Vulnerability Report APIs.

    Tries ``/vulnerabilities`` first (Vulnerability Report), then
    ``/vulnerability_findings``. On 401/403/404 we record a limitation and do
    **not** add check IDs to ``collected`` (no resolve-by-absence).
    """
    path = project_path or str(project_id)
    vulns_url = f"{api_base}/projects/{project_id}/vulnerabilities"
    # state[] repeated params — httpx accepts list values.
    status, rows = _paginate_status(
        client,
        vulns_url,
        params={"state": list(_OPEN_VULN_STATES)},
    )
    source = "vulnerabilities"
    if status in (401, 403, 404) or (status != 200 and not rows):
        findings_url = f"{api_base}/projects/{project_id}/vulnerability_findings"
        status, rows = _paginate_status(client, findings_url, params={"scope": "all"})
        source = "vulnerability_findings"
        if status == 200:
            # Findings API mixes dismissed; keep only non-dismissed open-like rows.
            rows = [
                r
                for r in rows
                if (r.get("state") or r.get("vulnerability_state") or "detected").lower()
                not in {"dismissed", "resolved"}
            ]

    if status in (401, 403):
        _mark_vuln_api_limitation(features, "permission_denied")
        features.setdefault("vulnerability_report", {})["permission_status"] = "denied"
        features["vulnerability_report"]["limitation"] = "permission_denied"
        features["vulnerability_report"]["api"] = source
        return
    if status == 404:
        _mark_vuln_api_limitation(features, "unavailable_by_plan_or_tier")
        features.setdefault("vulnerability_report", {})["permission_status"] = "unavailable_by_plan"
        features["vulnerability_report"]["limitation"] = "unavailable_by_plan_or_tier"
        features["vulnerability_report"]["api"] = source
        features["vulnerability_report"]["note"] = (
            "GitLab Vulnerability Report / findings APIs typically require Ultimate "
            "and a token with security read scopes. Job-name heuristics remain available."
        )
        return
    if status != 200:
        _mark_vuln_api_limitation(features, "collection_error")
        features.setdefault("vulnerability_report", {})["permission_status"] = "error"
        features["vulnerability_report"]["http_status"] = status
        return

    by_report: dict[str, list[dict[str, Any]]] = {k: [] for k in _REPORT_TYPE_TO_CHECK}
    for row in rows:
        report_type = _normalize_report_type(row)
        if report_type not in by_report:
            continue
        by_report[report_type].append(row)

    for report_type, check_id in _REPORT_TYPE_TO_CHECK.items():
        cap_id = _REPORT_TYPE_TO_CAPABILITY[report_type]
        report_rows = by_report[report_type]
        counts = _empty_counts()
        oldest = None
        for row in report_rows:
            sev = str(row.get("severity") or "medium")
            _bump(counts, sev)
            created = _parse_dt(
                row.get("created_at")
                or row.get("discovered_at")
                or (row.get("finding") or {}).get("created_at")
            )
            if created and (oldest is None or created < oldest):
                oldest = created
            drafts.append(_vuln_draft(path, project_id, report_type, check_id, row, source))

        block = features.get("capability_evidence", {}).get(cap_id) or _feature_block(enabled=None)
        block = dict(block)
        block["open_findings"] = counts
        block["alert_count"] = len(report_rows)
        block["oldest_open_finding_at"] = oldest.isoformat() if oldest else block.get("oldest_open_finding_at")
        # Authoritative inventory (including zero open findings) is observable.
        block["has_observable_activity"] = True
        if report_rows:
            block["enabled"] = True
            if report_type == "sast":
                features["sast"] = True
            elif report_type == "dependency_scanning":
                features["dependency_scanning"] = True
            elif report_type == "secret_detection":
                features["secret_detection"] = True
            elif report_type == "container_scanning":
                features["container_scanning"] = True
        elif block.get("enabled") is None:
            block["enabled"] = False
        # Drop job-only "enabled without activity" once we have a report inventory.
        lims = [x for x in (block.get("limitations") or []) if x != "enabled_without_observable_activity"]
        block["limitations"] = lims
        block["permission_status"] = "ok"
        features.setdefault("capability_evidence", {})[cap_id] = block
        collected.add(check_id)

    features["vulnerability_report"] = {
        "permission_status": "ok",
        "api": source,
        "open_count": len(rows),
        "collected_check_ids": sorted(collected & ALERT_CHECK_IDS),
    }


def _mark_vuln_api_limitation(features: dict[str, Any], limitation: str) -> None:
    for cap_id in (
        "dependency_scanning",
        "source_code_scanning",
        "secret_scanning",
        "container_image_scanning",
    ):
        block = features.get("capability_evidence", {}).get(cap_id)
        if not isinstance(block, dict):
            continue
        lims = list(block.get("limitations") or [])
        if limitation not in lims:
            lims.append(limitation)
        block["limitations"] = lims


def _normalize_report_type(row: dict[str, Any]) -> str | None:
    raw = (
        row.get("report_type")
        or (row.get("finding") or {}).get("report_type")
        or (row.get("scanner") or {}).get("report_type")
        or ""
    )
    key = str(raw).strip().lower().replace("-", "_")
    if key in _REPORT_TYPE_TO_CHECK:
        return key
    # Some APIs nest under identifiers.
    for candidate in (row.get("report_type"), (row.get("vulnerability") or {}).get("report_type")):
        if candidate and str(candidate).lower().replace("-", "_") in _REPORT_TYPE_TO_CHECK:
            return str(candidate).lower().replace("-", "_")
    return None


def _vuln_draft(
    project_path: str,
    project_id: int,
    report_type: str,
    check_id: str,
    row: dict[str, Any],
    source: str,
) -> FindingDraft:
    vuln_id = row.get("id") or row.get("uuid") or row.get("project_fingerprint") or "unknown"
    title = (
        row.get("title")
        or row.get("name")
        or (row.get("finding") or {}).get("name")
        or f"GitLab {report_type} finding"
    )
    sev = normalize_severity(str(row.get("severity") or "medium"))
    state = row.get("state") or row.get("vulnerability_state") or "detected"
    dismissal = row.get("dismissal_reason") or (row.get("dismissed_on") and "dismissed")
    identifiers = row.get("identifiers") or (row.get("finding") or {}).get("identifiers") or []
    cve = None
    for ident in identifiers if isinstance(identifiers, list) else []:
        if isinstance(ident, dict) and (ident.get("external_type") or ident.get("type") or "").upper() == "CVE":
            cve = ident.get("external_id") or ident.get("value") or ident.get("name")
            break
    return FindingDraft(
        check_id=check_id,
        resource_arn=f"gitlab://{project_path}/{report_type}/{vuln_id}",
        title=str(title)[:500],
        severity=sev,
        risk_score=score(sev),
        evidence={
            "provider": "gitlab_vulnerability_report",
            "capability": _REPORT_TYPE_TO_CAPABILITY.get(report_type),
            "project": project_path,
            "project_id": project_id,
            "report_type": report_type,
            "vulnerability_id": vuln_id,
            "state": state,
            "severity": sev,
            "cve": cve,
            "dismissal_reason": row.get("dismissal_reason"),
            "dismissed_at": row.get("dismissed_at") or row.get("dismissed_on"),
            "resolved_at": row.get("resolved_at") or row.get("resolved_on"),
            "created_at": row.get("created_at") or row.get("discovered_at"),
            "web_url": row.get("web_url"),
            "location": row.get("location") if isinstance(row.get("location"), dict) else None,
            "source_api": source,
            "source_reference": row.get("web_url") or str(vuln_id),
            "dismissed": bool(dismissal),
        },
    )
