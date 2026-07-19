"""Deep GitHub security evidence: Dependabot, CodeQL, secret scanning, Actions.

Phase 1 of docs/technical-evidence-coverage-spec.md. Collectors enrich
``Repo.security_features`` beyond enablement flags and optionally emit
provider-native alert findings.

Alert findings are only eligible for auto-resolve when collection returned an
authoritative open-alert inventory (HTTP 200, or a definitive feature-off).
Permission denied / unavailable / error must never resolve findings by absence.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from app.checks.base import FindingDraft, score
from app.services.scanner_types import normalize_severity

GITHUB_API = "https://api.github.com"
ALERTS_PER_PAGE = 100

DEPENDABOT_CHECK_ID = "github.dependabot.open_alert"
CODE_SCANNING_CHECK_ID = "github.code_scanning.open_alert"
SECRET_SCANNING_CHECK_ID = "github.secret_scanning.open_alert"

ALERT_CHECK_IDS = frozenset(
    {DEPENDABOT_CHECK_ID, CODE_SCANNING_CHECK_ID, SECRET_SCANNING_CHECK_ID}
)


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _empty_counts() -> dict[str, int]:
    return {"critical": 0, "high": 0, "medium": 0, "low": 0}


def _bump(counts: dict[str, int], severity: str) -> None:
    key = normalize_severity(severity)
    if key == "info":
        key = "low"
    if key not in counts:
        key = "low"
    counts[key] = counts.get(key, 0) + 1


def _feature_block(
    *,
    enabled: bool | None,
    permission_status: str,
    last_successful_scan_at: str | None = None,
    open_findings: dict[str, int] | None = None,
    oldest_open_finding_at: str | None = None,
    alert_count: int = 0,
    limitations: list[str] | None = None,
    has_observable_activity: bool = False,
) -> dict[str, Any]:
    return {
        "enabled": enabled,
        "permission_status": permission_status,
        "last_successful_scan_at": last_successful_scan_at,
        "open_findings": open_findings or _empty_counts(),
        "oldest_open_finding_at": oldest_open_finding_at,
        "alert_count": alert_count,
        "has_observable_activity": has_observable_activity,
        "limitations": list(limitations or []),
    }


def _paginate_list(
    client: httpx.Client,
    url: str,
    *,
    params: dict[str, Any] | None = None,
) -> tuple[int, list[dict[str, Any]]]:
    """Fetch all pages of a GitHub list endpoint.

    Returns (final_status_code, rows). On the first non-success response, returns
    that status and any rows collected so far (usually empty).
    """
    rows: list[dict[str, Any]] = []
    next_url: str | None = url
    next_params: dict[str, Any] | None = {"per_page": ALERTS_PER_PAGE, **(params or {})}
    last_status = 0
    while next_url:
        resp = client.get(next_url, params=next_params)
        last_status = resp.status_code
        if resp.status_code != 200:
            return last_status, rows
        data = resp.json()
        if not isinstance(data, list):
            return last_status, rows
        rows.extend(data)
        next_url = resp.links.get("next", {}).get("url")
        next_params = None  # absolute next URL already includes query params
    return last_status, rows


def collect_github_security_evidence(
    client: httpx.Client,
    owner: str,
    repo_name: str,
    *,
    now: datetime | None = None,
) -> tuple[dict[str, Any], list[FindingDraft], set[str]]:
    """Collect enablement + alert activity for one repository.

    Returns (security_features, alert FindingDrafts, collected_check_ids).

    ``collected_check_ids`` lists alert check IDs for which this repo produced an
    authoritative open-alert inventory. Callers must intersect these across repos
    before passing ``check_ids_run`` to persist — never resolve on partial/failed
    collection.
    """
    now = now or datetime.now(timezone.utc)
    features: dict[str, Any] = {
        "dependabot_alerts": None,
        "code_scanning": None,
        "secret_scanning": None,
        "capability_evidence": {},
        "actions_evidence": {},
    }
    drafts: list[FindingDraft] = []
    collected: set[str] = set()
    cap = features["capability_evidence"]

    # --- Dependabot enablement ---
    dep_resp = client.get(f"{GITHUB_API}/repos/{owner}/{repo_name}/vulnerability-alerts")
    if dep_resp.status_code == 204:
        features["dependabot_alerts"] = True
    elif dep_resp.status_code == 404:
        features["dependabot_alerts"] = False
    elif dep_resp.status_code in (401, 403):
        features["dependabot_alerts"] = None
        cap["dependency_scanning"] = _feature_block(
            enabled=None,
            permission_status="denied",
            limitations=["permission_denied"],
        )
    else:
        features["dependabot_alerts"] = None

    # --- Dependabot alerts ---
    if features["dependabot_alerts"] is False and "dependency_scanning" not in cap:
        # Feature off is an authoritative empty inventory for this repo.
        cap["dependency_scanning"] = _feature_block(
            enabled=False,
            permission_status="ok",
            has_observable_activity=False,
        )
        collected.add(DEPENDABOT_CHECK_ID)
    elif features["dependabot_alerts"] is not False and "dependency_scanning" not in cap:
        alerts_status, alerts = _paginate_list(
            client,
            f"{GITHUB_API}/repos/{owner}/{repo_name}/dependabot/alerts",
            params={"state": "open"},
        )
        if alerts_status == 200:
            counts = _empty_counts()
            oldest: datetime | None = None
            for alert in alerts:
                sev = (
                    ((alert.get("security_advisory") or {}).get("severity"))
                    or alert.get("severity")
                    or "medium"
                )
                _bump(counts, str(sev))
                created = _parse_dt(alert.get("created_at"))
                if created and (oldest is None or created < oldest):
                    oldest = created
                drafts.append(_dependabot_draft(owner, repo_name, alert))
            # Observable activity: API succeeded (even with zero open alerts).
            features["capability_evidence"]["dependency_scanning"] = _feature_block(
                enabled=features["dependabot_alerts"] is True,
                permission_status="ok",
                last_successful_scan_at=_iso(now),
                open_findings=counts,
                oldest_open_finding_at=_iso(oldest),
                alert_count=len(alerts),
                has_observable_activity=True,
            )
            collected.add(DEPENDABOT_CHECK_ID)
        elif alerts_status in (401, 403):
            features["capability_evidence"]["dependency_scanning"] = _feature_block(
                enabled=features["dependabot_alerts"],
                permission_status="denied",
                limitations=["permission_denied"],
                has_observable_activity=False,
            )
        elif alerts_status == 404:
            # Alerts API unavailable (plan) while vulnerability-alerts may still 204.
            # Not authoritative — do not mark check collected (no resolve-by-absence).
            features["capability_evidence"]["dependency_scanning"] = _feature_block(
                enabled=features["dependabot_alerts"],
                permission_status="unavailable_by_plan",
                limitations=["unavailable_by_plan"],
                has_observable_activity=False,
            )
        elif features["dependabot_alerts"] is True:
            features["capability_evidence"]["dependency_scanning"] = _feature_block(
                enabled=True,
                permission_status="ok",
                has_observable_activity=False,
                limitations=["enabled_without_observable_activity"],
            )
        elif features["dependabot_alerts"] is False:
            features["capability_evidence"]["dependency_scanning"] = _feature_block(
                enabled=False,
                permission_status="ok",
                has_observable_activity=False,
            )
            collected.add(DEPENDABOT_CHECK_ID)

    # --- Code scanning analyses + alerts ---
    code_analyses = client.get(
        f"{GITHUB_API}/repos/{owner}/{repo_name}/code-scanning/analyses",
        params={"per_page": 5},
    )
    last_analysis_at: str | None = None
    code_enabled: bool | None = None
    code_perm = "ok"
    if code_analyses.status_code == 200:
        rows = code_analyses.json() if isinstance(code_analyses.json(), list) else []
        code_enabled = bool(rows)
        for row in rows:
            completed = row.get("created_at") or row.get("committed_date")
            if completed:
                last_analysis_at = completed
                break
    elif code_analyses.status_code == 404:
        code_enabled = False
    elif code_analyses.status_code in (401, 403):
        code_enabled = None
        code_perm = "denied"
    features["code_scanning"] = code_enabled

    code_alerts_status, code_alerts = _paginate_list(
        client,
        f"{GITHUB_API}/repos/{owner}/{repo_name}/code-scanning/alerts",
        params={"state": "open"},
    )
    if code_alerts_status == 200:
        counts = _empty_counts()
        oldest = None
        for alert in code_alerts:
            sev = (
                alert.get("security_severity_level")
                or (alert.get("rule") or {}).get("security_severity_level")
                or (alert.get("rule") or {}).get("severity")
                or "medium"
            )
            _bump(counts, str(sev))
            created = _parse_dt(alert.get("created_at"))
            if created and (oldest is None or created < oldest):
                oldest = created
            drafts.append(_code_scanning_draft(owner, repo_name, alert))
        features["capability_evidence"]["source_code_scanning"] = _feature_block(
            enabled=True if code_enabled or code_alerts else code_enabled,
            permission_status="ok",
            last_successful_scan_at=last_analysis_at or _iso(now),
            open_findings=counts,
            oldest_open_finding_at=_iso(oldest),
            alert_count=len(code_alerts),
            has_observable_activity=True,
        )
        if features["capability_evidence"]["source_code_scanning"]["enabled"] is None:
            features["capability_evidence"]["source_code_scanning"]["enabled"] = True
        if code_enabled is False and not code_alerts:
            features["capability_evidence"]["source_code_scanning"]["enabled"] = False
            features["capability_evidence"]["source_code_scanning"]["has_observable_activity"] = False
        collected.add(CODE_SCANNING_CHECK_ID)
    elif code_perm == "denied" or code_alerts_status in (401, 403):
        features["capability_evidence"]["source_code_scanning"] = _feature_block(
            enabled=code_enabled,
            permission_status="denied",
            limitations=["permission_denied"],
            last_successful_scan_at=last_analysis_at,
            has_observable_activity=bool(last_analysis_at),
        )
    elif code_alerts_status == 404 and code_enabled is False:
        # Feature off + alerts endpoint absent → authoritative empty inventory.
        features["capability_evidence"]["source_code_scanning"] = _feature_block(
            enabled=False,
            permission_status="ok",
            last_successful_scan_at=last_analysis_at,
            has_observable_activity=False,
        )
        collected.add(CODE_SCANNING_CHECK_ID)
    else:
        limitations: list[str] = []
        if code_alerts_status == 404:
            limitations.append("unavailable_by_plan")
        elif code_enabled and not last_analysis_at:
            limitations.append("enabled_without_observable_activity")
        features["capability_evidence"]["source_code_scanning"] = _feature_block(
            enabled=code_enabled,
            permission_status="unavailable_by_plan" if code_alerts_status == 404 else "ok",
            last_successful_scan_at=last_analysis_at,
            has_observable_activity=bool(last_analysis_at),
            limitations=limitations,
        )

    # --- Secret scanning ---
    secret_status, secret_alerts = _paginate_list(
        client,
        f"{GITHUB_API}/repos/{owner}/{repo_name}/secret-scanning/alerts",
        params={"state": "open"},
    )
    if secret_status == 200:
        features["secret_scanning"] = True
        counts = _empty_counts()
        oldest = None
        for alert in secret_alerts:
            # Secret alerts are typically high severity when open.
            _bump(counts, "high")
            created = _parse_dt(alert.get("created_at"))
            if created and (oldest is None or created < oldest):
                oldest = created
            drafts.append(_secret_scanning_draft(owner, repo_name, alert))
        features["capability_evidence"]["secret_scanning"] = _feature_block(
            enabled=True,
            permission_status="ok",
            last_successful_scan_at=_iso(now),
            open_findings=counts,
            oldest_open_finding_at=_iso(oldest),
            alert_count=len(secret_alerts),
            has_observable_activity=True,
        )
        collected.add(SECRET_SCANNING_CHECK_ID)
    elif secret_status == 404:
        features["secret_scanning"] = False
        features["capability_evidence"]["secret_scanning"] = _feature_block(
            enabled=False,
            permission_status="ok",
        )
        collected.add(SECRET_SCANNING_CHECK_ID)
    elif secret_status in (401, 403):
        features["secret_scanning"] = None
        # Distinguish plan vs permission when possible via header/body is brittle;
        # treat as denied so grade → unknown rather than false pass.
        features["capability_evidence"]["secret_scanning"] = _feature_block(
            enabled=None,
            permission_status="denied",
            limitations=["permission_denied"],
        )
    else:
        features["secret_scanning"] = None
        features["capability_evidence"]["secret_scanning"] = _feature_block(
            enabled=None,
            permission_status="unknown",
        )

    # --- GitHub Actions evidence (CI security enforcement) ---
    features["actions_evidence"] = _collect_actions_evidence(client, owner, repo_name, now)

    return features, drafts, collected


def _collect_actions_evidence(
    client: httpx.Client,
    owner: str,
    repo_name: str,
    now: datetime,
) -> dict[str, Any]:
    resp = client.get(
        f"{GITHUB_API}/repos/{owner}/{repo_name}/actions/runs",
        params={"per_page": 20},
    )
    if resp.status_code in (401, 403):
        return {
            "permission_status": "denied",
            "has_workflows": None,
            "recent_success": False,
            "security_job_success": False,
            "last_successful_run_at": None,
            "has_observable_activity": False,
            "limitations": ["permission_denied"],
        }
    if resp.status_code == 404 or not resp.is_success:
        return {
            "permission_status": "ok",
            "has_workflows": False,
            "recent_success": False,
            "security_job_success": False,
            "last_successful_run_at": None,
            "has_observable_activity": False,
        }

    runs = resp.json().get("workflow_runs") or []
    security_patterns = (
        "codeql",
        "code scanning",
        "dependabot",
        "secret scanning",
        "security",
        "sast",
        "semgrep",
        "trivy",
        "gitleaks",
    )
    last_success: str | None = None
    security_success = False
    recent_success = False
    for run in runs:
        conclusion = (run.get("conclusion") or "").lower()
        name = (run.get("name") or "").lower()
        path = (run.get("path") or "").lower()
        completed = run.get("updated_at") or run.get("run_started_at")
        if conclusion == "success":
            recent_success = True
            if last_success is None:
                last_success = completed
            if any(p in name or p in path for p in security_patterns):
                security_success = True
    return {
        "permission_status": "ok",
        "has_workflows": bool(runs),
        "recent_success": recent_success,
        "security_job_success": security_success,
        "last_successful_run_at": last_success,
        "has_observable_activity": recent_success,
        "workflow_run_sample_count": len(runs),
        "collected_at": now.isoformat(),
        "limitations": (
            []
            if security_success or recent_success
            else (["no_recent_successful_security_workflow"] if runs else ["no_workflow_runs"])
        ),
    }


def _dependabot_draft(owner: str, repo: str, alert: dict[str, Any]) -> FindingDraft:
    number = alert.get("number") or alert.get("ghsa_id") or alert.get("html_url") or "unknown"
    advisory = alert.get("security_advisory") or {}
    dependency = alert.get("dependency") or {}
    pkg = (dependency.get("package") or {}).get("name") or "dependency"
    sev = normalize_severity(str(advisory.get("severity") or alert.get("severity") or "medium"))
    ghsa = advisory.get("ghsa_id") or alert.get("ghsa_id")
    cve = None
    for ident in advisory.get("identifiers") or []:
        if (ident.get("type") or "").upper() == "CVE":
            cve = ident.get("value")
            break
    title = advisory.get("summary") or f"Dependabot alert for {pkg}"
    return FindingDraft(
        check_id=DEPENDABOT_CHECK_ID,
        resource_arn=f"github://{owner}/{repo}/dependabot/{number}",
        title=title[:500],
        severity=sev,
        risk_score=score(sev),
        evidence={
            "provider": "github_dependabot",
            "capability": "dependency_scanning",
            "repo": f"{owner}/{repo}",
            "alert_number": alert.get("number"),
            "state": alert.get("state"),
            "dependency": pkg,
            "manifest": dependency.get("manifest_path"),
            "ecosystem": (dependency.get("package") or {}).get("ecosystem"),
            "ghsa_id": ghsa,
            "cve": cve,
            "severity": sev,
            "created_at": alert.get("created_at"),
            "fixed_at": alert.get("fixed_at"),
            "dismissed_at": alert.get("dismissed_at"),
            "dismissed_reason": alert.get("dismissed_reason"),
            "html_url": alert.get("html_url"),
            "source_reference": alert.get("html_url") or str(number),
        },
    )


def _code_scanning_draft(owner: str, repo: str, alert: dict[str, Any]) -> FindingDraft:
    number = alert.get("number") or alert.get("html_url") or "unknown"
    rule = alert.get("rule") or {}
    sev = normalize_severity(
        str(
            alert.get("security_severity_level")
            or rule.get("security_severity_level")
            or rule.get("severity")
            or "medium"
        )
    )
    title = rule.get("description") or rule.get("name") or f"Code scanning alert #{number}"
    return FindingDraft(
        check_id=CODE_SCANNING_CHECK_ID,
        resource_arn=f"github://{owner}/{repo}/code-scanning/{number}",
        title=str(title)[:500],
        severity=sev,
        risk_score=score(sev),
        evidence={
            "provider": "github_codeql",
            "capability": "source_code_scanning",
            "repo": f"{owner}/{repo}",
            "alert_number": alert.get("number"),
            "state": alert.get("state"),
            "tool": (alert.get("tool") or {}).get("name"),
            "rule_id": rule.get("id"),
            "severity": sev,
            "ref": alert.get("most_recent_instance", {}).get("ref") if isinstance(alert.get("most_recent_instance"), dict) else alert.get("refs"),
            "created_at": alert.get("created_at"),
            "fixed_at": alert.get("fixed_at"),
            "dismissed_reason": alert.get("dismissed_reason"),
            "html_url": alert.get("html_url"),
            "source_reference": alert.get("html_url") or str(number),
        },
    )


def _secret_scanning_draft(owner: str, repo: str, alert: dict[str, Any]) -> FindingDraft:
    number = alert.get("number") or alert.get("html_url") or "unknown"
    secret_type = alert.get("secret_type_display_name") or alert.get("secret_type") or "secret"
    return FindingDraft(
        check_id=SECRET_SCANNING_CHECK_ID,
        resource_arn=f"github://{owner}/{repo}/secret-scanning/{number}",
        title=f"Secret scanning alert: {secret_type}"[:500],
        severity="high",
        risk_score=score("high"),
        evidence={
            "provider": "github_secret_scanning",
            "capability": "secret_scanning",
            "repo": f"{owner}/{repo}",
            "alert_number": alert.get("number"),
            "state": alert.get("state"),
            "secret_type": alert.get("secret_type"),
            "validity": alert.get("validity"),
            "resolution": alert.get("resolution"),
            "created_at": alert.get("created_at"),
            "resolved_at": alert.get("resolved_at"),
            "push_protection_bypassed": alert.get("push_protection_bypassed"),
            "html_url": alert.get("html_url"),
            "source_reference": alert.get("html_url") or str(number),
        },
    )
