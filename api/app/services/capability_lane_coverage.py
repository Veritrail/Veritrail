"""Grade technical capability lanes from connected provider evidence (Phase 0/1)."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.github import IdentityProvider, Repo, RepoProtection
from app.services.capability_limitations import (
    primary_limitation,
    serialize_limitations,
)
from app.services.technical_capability import (
    CAPABILITY_LABELS,
    SECURE_SDLC_LANES,
    VULNERABILITY_MANAGEMENT_LANES,
    CapabilityId,
    CoverageState,
    EvidenceEnvelope,
    OpenFindingsSummary,
    apply_limitation_impacts,
    audit_verdict_for_lane,
    envelope,
    merge_lane_states,
    rollup_control_status,
    vendor_absence_does_not_fail,
)

_GITHUB_CAP_PROVIDERS: dict[str, str] = {
    "dependency_scanning": "github_dependabot",
    "source_code_scanning": "github_codeql",
    "secret_scanning": "github_secret_scanning",
    "ci_security_enforcement": "github_actions",
}

_GITLAB_CAP_PROVIDERS: dict[str, str] = {
    "dependency_scanning": "gitlab_dependency_scanning",
    "source_code_scanning": "gitlab_sast",
    "secret_scanning": "gitlab_secret_detection",
    "container_image_scanning": "gitlab_container_scanning",
    "ci_security_enforcement": "gitlab_pipelines",
}

_GITHUB_FEATURE_TO_CAP: dict[str, CapabilityId] = {
    "dependabot_alerts": "dependency_scanning",
    "code_scanning": "source_code_scanning",
    "secret_scanning": "secret_scanning",
}


def _provider_type(provider: IdentityProvider) -> str:
    return (provider.type or "").strip().lower()


def _repo_eligible(repo: Repo) -> bool:
    """Archived / intentionally excluded repos leave the denominator when flagged."""
    features = repo.security_features if isinstance(repo.security_features, dict) else {}
    if features.get("excluded") is True or features.get("archived") is True:
        return False
    name = (repo.name or "").lower()
    if name.endswith(".disabled"):
        return False
    return True


def _open_findings_from_block(block: dict[str, Any]) -> OpenFindingsSummary:
    raw = block.get("open_findings") or {}
    return OpenFindingsSummary(
        critical=int(raw.get("critical") or 0),
        high=int(raw.get("high") or 0),
        medium=int(raw.get("medium") or 0),
        low=int(raw.get("low") or 0),
    )


def _envelope_from_capability_block(
    *,
    capability: CapabilityId,
    provider: str,
    repo_name: str,
    block: dict[str, Any],
    now: datetime,
) -> EvidenceEnvelope:
    from app.services.technical_capability import CollectionMeta

    perm = (block.get("permission_status") or "ok").lower()
    coll_raw = block.get("collection") if isinstance(block.get("collection"), dict) else {}
    coll_status = coll_raw.get("collection_status") or "complete"
    collection = CollectionMeta(
        collection_status=coll_status,  # type: ignore[arg-type]
        pages_fetched=int(coll_raw.get("pages_fetched") or 0),
        items_fetched=int(coll_raw.get("items_fetched") or 0),
        retry_count=int(coll_raw.get("retry_count") or 0),
        limited_by=coll_raw.get("limited_by"),
        started_at=coll_raw.get("started_at"),
        completed_at=coll_raw.get("completed_at"),
    )
    return envelope(
        capability=capability,
        provider=provider,
        scope_type="repository",
        scope_id=repo_name,
        asset_type="source_repository",
        enabled=block.get("enabled"),
        has_observable_activity=bool(block.get("has_observable_activity")),
        last_observed_at=block.get("last_successful_scan_at"),
        last_successful_scan_at=block.get("last_successful_scan_at"),
        eligible=1,
        assessed=1 if block.get("has_observable_activity") and block.get("enabled") else 0,
        open_findings=_open_findings_from_block(block),
        oldest_open_finding_at=block.get("oldest_open_finding_at"),
        source_reference=f"{provider}:{repo_name}",
        limitations=list(block.get("limitations") or []),
        permission_denied=perm in ("denied", "permission_denied"),
        unavailable_by_plan=perm == "unavailable_by_plan",
        now=now,
        collection=collection,
    )


def _github_repo_envelopes(
    repo: Repo,
    protection: RepoProtection | None,
    *,
    now: datetime,
) -> list[EvidenceEnvelope]:
    features = repo.security_features if isinstance(repo.security_features, dict) else {}
    cap_ev = features.get("capability_evidence") if isinstance(features.get("capability_evidence"), dict) else {}
    out: list[EvidenceEnvelope] = []

    for cap_id, provider in _GITHUB_CAP_PROVIDERS.items():
        if cap_id == "ci_security_enforcement":
            actions = features.get("actions_evidence") if isinstance(features.get("actions_evidence"), dict) else {}
            required = []
            if protection and isinstance(protection.required_status_checks, list):
                required = [c for c in protection.required_status_checks if isinstance(c, str)]
            security_required = any(
                any(
                    p in c.lower()
                    for p in ("codeql", "code scanning", "dependabot", "secret", "security", "sast")
                )
                for c in required
            )
            has_activity = bool(actions.get("has_observable_activity") or actions.get("security_job_success"))
            enabled = bool(actions.get("has_workflows")) or bool(required)
            lim = list(actions.get("limitations") or [])
            if enabled and not security_required and not actions.get("security_job_success"):
                lim.append("security_checks_not_required")
            out.append(
                envelope(
                    capability="ci_security_enforcement",
                    provider=provider,
                    scope_type="repository",
                    scope_id=repo.name,
                    asset_type="source_repository",
                    enabled=enabled if actions or protection else None,
                    has_observable_activity=has_activity and (security_required or bool(actions.get("security_job_success"))),
                    last_observed_at=actions.get("last_successful_run_at"),
                    last_successful_scan_at=actions.get("last_successful_run_at"),
                    eligible=1,
                    assessed=1 if has_activity and security_required else 0,
                    limitations=lim,
                    permission_denied=(actions.get("permission_status") == "denied"),
                    now=now,
                )
            )
            continue

        block = cap_ev.get(cap_id) if isinstance(cap_ev.get(cap_id), dict) else None
        if block:
            out.append(
                _envelope_from_capability_block(
                    capability=cap_id,  # type: ignore[arg-type]
                    provider=provider,
                    repo_name=repo.name,
                    block=block,
                    now=now,
                )
            )
            continue

        # Legacy enablement-only features → partial when True (honesty rule).
        legacy_key = next((k for k, v in _GITHUB_FEATURE_TO_CAP.items() if v == cap_id), None)
        enabled = features.get(legacy_key) if legacy_key else None
        out.append(
            envelope(
                capability=cap_id,  # type: ignore[arg-type]
                provider=provider,
                scope_type="repository",
                scope_id=repo.name,
                asset_type="source_repository",
                enabled=enabled if isinstance(enabled, bool) else None,
                has_observable_activity=False,
                eligible=1,
                assessed=0,
                limitations=["enablement_only_legacy_snapshot"] if enabled is True else [],
                now=now,
            )
        )
    return out


def _gitlab_repo_envelopes(repo: Repo, *, now: datetime) -> list[EvidenceEnvelope]:
    features = repo.security_features if isinstance(repo.security_features, dict) else {}
    cap_ev = features.get("capability_evidence") if isinstance(features.get("capability_evidence"), dict) else {}
    out: list[EvidenceEnvelope] = []

    for cap_id, provider in _GITLAB_CAP_PROVIDERS.items():
        if cap_id == "ci_security_enforcement":
            pipe = features.get("pipeline_evidence") if isinstance(features.get("pipeline_evidence"), dict) else {}
            out.append(
                envelope(
                    capability="ci_security_enforcement",
                    provider=provider,
                    scope_type="repository",
                    scope_id=repo.name,
                    asset_type="source_repository",
                    enabled=bool(pipe.get("has_pipelines")),
                    has_observable_activity=bool(pipe.get("has_observable_activity"))
                    and bool(pipe.get("security_jobs_required_hint")),
                    last_observed_at=pipe.get("last_successful_pipeline_at"),
                    last_successful_scan_at=pipe.get("last_successful_pipeline_at"),
                    eligible=1,
                    assessed=1 if pipe.get("security_jobs_required_hint") else 0,
                    limitations=list(pipe.get("limitations") or []),
                    permission_denied=pipe.get("permission_status") == "denied",
                    now=now,
                )
            )
            continue

        block = cap_ev.get(cap_id) if isinstance(cap_ev.get(cap_id), dict) else None
        if block:
            out.append(
                _envelope_from_capability_block(
                    capability=cap_id,  # type: ignore[arg-type]
                    provider=provider,
                    repo_name=repo.name,
                    block=block,
                    now=now,
                )
            )
            continue

        legacy_map = {
            "dependency_scanning": "dependency_scanning",
            "source_code_scanning": "sast",
            "secret_scanning": "secret_detection",
            "container_image_scanning": "container_scanning",
        }
        legacy_key = legacy_map.get(cap_id)
        enabled = features.get(legacy_key) if legacy_key else None
        out.append(
            envelope(
                capability=cap_id,  # type: ignore[arg-type]
                provider=provider,
                scope_type="repository",
                scope_id=repo.name,
                asset_type="source_repository",
                enabled=enabled if isinstance(enabled, bool) else None,
                has_observable_activity=False,
                eligible=1,
                assessed=0,
                limitations=["enablement_only_legacy_snapshot"] if enabled is True else [],
                now=now,
            )
        )
    return out


def _merge_scope_states(envelopes: list[EvidenceEnvelope]) -> CoverageState:
    """Union per-scope envelope statuses into one lane CoverageState."""
    if not envelopes:
        return "unknown"
    by_scope: dict[tuple[str, str], list[EvidenceEnvelope]] = {}
    for env in envelopes:
        by_scope.setdefault((env.scope_type, env.scope_id), []).append(env)
    scope_states: list[CoverageState] = []
    for scoped in by_scope.values():
        scoped_states = [e.status for e in scoped]
        if any(state == "covered" for state in scoped_states):
            scope_states.append("covered")
        else:
            scope_states.append(merge_lane_states(scoped_states))
    return merge_lane_states(scope_states) if scope_states else "unknown"


def _summarize_lane(
    capability: CapabilityId,
    envelopes: list[EvidenceEnvelope],
    connected_providers: set[str],
) -> dict[str, Any]:
    # Provider equivalence is evaluated per scope. Two providers describing the
    # same repository/account/device fleet must not double the denominator or
    # findings, and a fully-covering provider may satisfy the scope even when a
    # second optional provider is incomplete.
    by_scope: dict[tuple[str, str], list[EvidenceEnvelope]] = {}
    for env in envelopes:
        by_scope.setdefault((env.scope_type, env.scope_id), []).append(env)

    merged = _merge_scope_states(envelopes)
    # No repos in inventory → unknown (empty response ≠ not_applicable).
    if not envelopes:
        merged = "unknown"
    merged = vendor_absence_does_not_fail(
        capability,
        connected_providers,
        lane_state_from_connected=merged,  # type: ignore[arg-type]
    )
    eligible = sum(max((e.coverage.eligible for e in scoped), default=0) for scoped in by_scope.values())
    assessed = sum(max((e.coverage.assessed for e in scoped), default=0) for scoped in by_scope.values())
    excluded = sum(max((e.coverage.excluded for e in scoped), default=0) for scoped in by_scope.values())
    open_findings = OpenFindingsSummary()
    for scoped in by_scope.values():
        # Provider-native records do not yet share stable cross-provider IDs.
        # Taking the per-scope maximum prevents duplicate integrations from
        # inflating the audit count while retaining a conservative summary.
        open_findings.critical += max((e.open_findings.critical for e in scoped), default=0)
        open_findings.high += max((e.open_findings.high for e in scoped), default=0)
        open_findings.medium += max((e.open_findings.medium for e in scoped), default=0)
        open_findings.low += max((e.open_findings.low for e in scoped), default=0)
    providers = sorted({e.provider for e in envelopes if e.enabled or e.status == "covered"})
    limitations: list[str] = []
    for e in envelopes:
        # Surface limitations from incomplete statuses and from unvalidated sources
        # (even when the collector still reports covered).
        if e.status in ("partial", "stale", "not_covered", "unknown") or not e.validated:
            for lim in e.limitations:
                if lim not in limitations:
                    limitations.append(lim)
    # Incomplete collection on any envelope cannot leave the lane covered.
    collection_statuses = [e.collection.collection_status for e in envelopes]
    coll_status: str = "complete"
    if any(s != "complete" for s in collection_statuses):
        if any(s == "permission_denied" for s in collection_statuses):
            coll_status = "permission_denied"
        elif any(s == "unavailable_by_plan" for s in collection_statuses):
            coll_status = "unavailable_by_plan"
        elif any(s == "failed" for s in collection_statuses):
            coll_status = "failed"
        else:
            coll_status = "partial"
    merged = apply_limitation_impacts(
        merged,  # type: ignore[arg-type]
        limitations,
        collection_status=coll_status,  # type: ignore[arg-type]
    )

    # Unvalidated Beta EDR cannot be load-bearing for a covered verdict.
    if merged == "covered" and any(not e.validated for e in envelopes):
        validated_only = [e for e in envelopes if e.validated]
        state_without_unvalidated: CoverageState = (
            _merge_scope_states(validated_only) if validated_only else "unknown"
        )
        if validated_only:
            state_without_unvalidated = vendor_absence_does_not_fail(
                capability,
                connected_providers,
                lane_state_from_connected=state_without_unvalidated,
            )
        if state_without_unvalidated != "covered":
            merged = "unvalidated"
            if "edr_unvalidated_beta" not in limitations:
                limitations.append("edr_unvalidated_beta")

    action = None
    label = CAPABILITY_LABELS[capability].lower()
    primary = primary_limitation(limitations)
    if merged == "partial" and eligible > assessed:
        missing = eligible - assessed
        if capability in (
            "dependency_scanning",
            "source_code_scanning",
            "secret_scanning",
            "ci_security_enforcement",
        ):
            action = f"Enable {label} for {missing} repositor{'y' if missing == 1 else 'ies'}"
        else:
            action = f"Extend {label} coverage for {missing} in-scope asset{'s' if missing != 1 else ''}"
    elif merged == "not_covered":
        action = f"Enable {label} for in-scope assets (native cloud, source control, or an equivalent scanner)"
    elif merged == "stale":
        action = f"Refresh {label} evidence (last scan outside freshness window)"
    elif merged == "unvalidated":
        action = (
            "Complete live validation for this EDR provider before treating "
            "host/workload evidence as verified"
        )
    elif merged == "unknown" and not envelopes:
        action = f"Connect a qualifying source or collect inventory so {label} can be assessed"
    elif primary is not None and not action:
        action = primary.action

    summary = {
        "capability": capability,
        "label": CAPABILITY_LABELS[capability],
        "status": merged,
        "providers": providers,
        "coverage": {
            "eligible": eligible,
            "assessed": assessed,
            "excluded": excluded,
        },
        "open_findings": open_findings.as_dict(),
        "limitations": limitations[:8],
        "limitations_detail": serialize_limitations(limitations[:8]),
        "action": action,
        "envelopes": [e.as_dict() for e in envelopes[:50]],
    }
    summary.update(audit_verdict_for_lane(summary))
    return summary


_SCANNER_PROVIDER_TYPES = (
    "snyk",
    "wiz",
    "tenable",
    "qualys",
    "orca",
    "aikido",
    "scanner_snyk",
    "scanner_wiz",
    "scanner_tenable",
    "scanner_qualys",
    "scanner_orca",
    "scanner_aikido",
)

_EDR_PROVIDER_TYPES = ("edr_crowdstrike", "edr_sentinelone")


def _persist_capability_snapshot(db: Session, org_id: uuid.UUID, payload: dict[str, Any]) -> None:
    """Stage a durable, hourly-deduplicated historical snapshot."""
    try:
        from app.models.capability_coverage import CapabilityCoverageSnapshot

        latest = db.scalar(
            select(CapabilityCoverageSnapshot)
            .where(CapabilityCoverageSnapshot.org_id == org_id)
            .order_by(CapabilityCoverageSnapshot.taken_at.desc())
            .limit(1)
        )
        latest_at = latest.taken_at if latest else None
        if latest_at:
            if latest_at.tzinfo is None:
                latest_at = latest_at.replace(tzinfo=timezone.utc)
            if latest_at >= datetime.now(timezone.utc) - timedelta(hours=1):
                return

        lean_lanes = {
            key: {k: v for k, v in lane.items() if k != "envelopes"}
            for key, lane in (payload.get("lanes") or {}).items()
        }
        snap = CapabilityCoverageSnapshot(
            org_id=org_id,
            payload_json={
                "generated_at": payload.get("generated_at"),
                "connected_providers": payload.get("connected_providers"),
                "repos_total": payload.get("repos_total"),
                "repos_eligible": payload.get("repos_eligible"),
                "secure_sdlc_rollup": payload.get("secure_sdlc_rollup"),
                "vulnerability_management_rollup": payload.get("vulnerability_management_rollup"),
                "lanes": lean_lanes,
                "operational": {
                    "lanes": {
                        k: {kk: vv for kk, vv in lane.items() if kk != "envelopes"}
                        for k, lane in ((payload.get("operational") or {}).get("lanes") or {}).items()
                    }
                },
            },
        )
        with db.begin_nested():
            db.add(snap)
            db.flush()
    except Exception:  # noqa: BLE001
        pass


def build_capability_lane_coverage(
    db: Session,
    org_id: uuid.UUID,
    *,
    now: datetime | None = None,
    persist_snapshot: bool = True,
) -> dict[str, Any]:
    """Org-level capability lane breakdown for Secure SDLC / Vulnerability Management."""
    from app.services.cloud_capability_evidence import (
        collect_native_cloud_envelopes,
        connected_cloud_providers,
    )
    from app.services.edr_integrations import envelopes_from_edr_config
    from app.services.github_sync import provider_config
    from app.services.operational_capability import build_operational_capability_coverage
    from app.services.scanner_capability_evidence import envelopes_from_scanner_config

    now = now or datetime.now(timezone.utc)
    providers = list(
        db.scalars(
            select(IdentityProvider).where(
                IdentityProvider.org_id == org_id,
                IdentityProvider.type.in_(("github", "gitlab")),
            )
        ).all()
    )
    connected_providers: set[str] = set()
    all_envelopes: list[EvidenceEnvelope] = []
    repo_total = 0
    repo_eligible = 0

    for provider in providers:
        ptype = _provider_type(provider)
        repos = list(db.scalars(select(Repo).where(Repo.provider_id == provider.id)).all())
        for repo in repos:
            repo_total += 1
            if not _repo_eligible(repo):
                continue
            repo_eligible += 1
            if ptype == "github":
                connected_providers.update(_GITHUB_CAP_PROVIDERS.values())
                branch = (repo.default_branch or "main").strip()
                protection = db.scalar(
                    select(RepoProtection).where(
                        RepoProtection.repo_id == repo.id,
                        RepoProtection.branch == branch,
                    )
                )
                all_envelopes.extend(_github_repo_envelopes(repo, protection, now=now))
            elif ptype == "gitlab":
                connected_providers.update(_GITLAB_CAP_PROVIDERS.values())
                all_envelopes.extend(_gitlab_repo_envelopes(repo, now=now))

    # Optional scanners — emit envelopes; absence never fails.
    scanner_providers = list(
        db.scalars(
            select(IdentityProvider).where(
                IdentityProvider.org_id == org_id,
                IdentityProvider.type.in_(_SCANNER_PROVIDER_TYPES),
            )
        ).all()
    )
    for sp in scanner_providers:
        key = _provider_type(sp).removeprefix("scanner_")
        connected_providers.add(key)
        all_envelopes.extend(
            envelopes_from_scanner_config(sp.type, provider_config(sp), now=now)
        )

    # Native cloud (Phase 2)
    cloud_envs = collect_native_cloud_envelopes(db, org_id, now=now)
    all_envelopes.extend(cloud_envs)
    connected_providers.update(connected_cloud_providers(db, org_id))

    # EDR (Phase 4)
    edr_providers = list(
        db.scalars(
            select(IdentityProvider).where(
                IdentityProvider.org_id == org_id,
                IdentityProvider.type.in_(_EDR_PROVIDER_TYPES),
            )
        ).all()
    )
    for ep in edr_providers:
        key = _provider_type(ep).removeprefix("edr_")
        connected_providers.add(key)
        all_envelopes.extend(envelopes_from_edr_config(provider_config(ep), now=now))

    lane_ids = (
        "dependency_scanning",
        "source_code_scanning",
        "secret_scanning",
        "ci_security_enforcement",
        "container_image_scanning",
        "host_workload_scanning",
        "serverless_scanning",
        "cloud_findings_posture",
    )
    lanes_out: dict[str, Any] = {}
    for capability in lane_ids:
        caps = [e for e in all_envelopes if e.capability == capability]
        lanes_out[capability] = _summarize_lane(
            capability,  # type: ignore[arg-type]
            caps,
            connected_providers,
        )

    operational = build_operational_capability_coverage(db, org_id, now=now)

    sdlc_states: dict[CapabilityId, CoverageState] = {
        lane: lanes_out[lane]["status"] for lane in SECURE_SDLC_LANES  # type: ignore[misc]
    }
    vuln_states: dict[CapabilityId, CoverageState] = {
        lane: lanes_out[lane]["status"] for lane in VULNERABILITY_MANAGEMENT_LANES  # type: ignore[misc]
    }

    result = {
        "generated_at": now.isoformat(),
        "repos_total": repo_total,
        "repos_eligible": repo_eligible,
        "connected_providers": sorted(connected_providers),
        "lanes": lanes_out,
        "operational": operational,
        "secure_sdlc_rollup": rollup_control_status(
            sdlc_states, required_lanes=SECURE_SDLC_LANES
        ),
        "vulnerability_management_rollup": rollup_control_status(
            vuln_states, required_lanes=VULNERABILITY_MANAGEMENT_LANES
        ),
        "phase1_lanes": [
            lanes_out[k]
            for k in (
                "dependency_scanning",
                "source_code_scanning",
                "secret_scanning",
                "ci_security_enforcement",
            )
        ],
    }
    if persist_snapshot:
        _persist_capability_snapshot(db, org_id, result)
    return result


def capability_lanes_for_composite(
    db: Session,
    org_id: uuid.UUID,
    composite_id: str,
    *,
    precomputed: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    data = precomputed if precomputed is not None else build_capability_lane_coverage(db, org_id)
    if composite_id == "secure_sdlc":
        return {
            "rollup": data["secure_sdlc_rollup"],
            "lanes": data["phase1_lanes"],
            "repos_total": data["repos_total"],
            "repos_eligible": data["repos_eligible"],
            "connected_providers": data["connected_providers"],
            "generated_at": data["generated_at"],
        }
    if composite_id == "vulnerability_management":
        lane_ids = (
            "dependency_scanning",
            "source_code_scanning",
            "secret_scanning",
            "container_image_scanning",
            "host_workload_scanning",
            "serverless_scanning",
            "cloud_findings_posture",
        )
        return {
            "rollup": data["vulnerability_management_rollup"],
            "lanes": [data["lanes"][k] for k in lane_ids],
            "repos_total": data["repos_total"],
            "repos_eligible": data["repos_eligible"],
            "connected_providers": data["connected_providers"],
            "generated_at": data["generated_at"],
        }
    operational_map = {
        "logging_monitoring": "logging_monitoring",
        "incident_response": "threat_detection_signals",
    }
    operational_id = operational_map.get(composite_id)
    if operational_id:
        operational = data.get("operational") or {}
        lane = (operational.get("lanes") or {}).get(operational_id)
        if not lane:
            return None
        rollup = "verified" if lane.get("status") in ("covered", "not_applicable") else "action_needed"
        return {
            "rollup": rollup,
            "lanes": [lane],
            "repos_total": 0,
            "repos_eligible": 0,
            "connected_providers": operational.get("connected_providers") or [],
            "generated_at": operational.get("generated_at") or data["generated_at"],
            "scope_summary": "Operational evidence",
        }
    return None
