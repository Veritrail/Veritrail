"""Typed capability-limitation registry (production-hardening Phase A).

Collectors emit limitation *codes* only. Serializers attach display metadata
from this registry. Unknown codes fail closed as degrading with generic copy.

See docs/evidence-coverage-production-hardening-spec.md §5.1.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

LimitationImpact = Literal["blocking", "degrading", "informational"]


@dataclass(frozen=True)
class LimitationDefinition:
    code: str
    impact: LimitationImpact
    title: str
    explanation: str
    action: str


_GENERIC_UNKNOWN = LimitationDefinition(
    code="unknown_limitation",
    impact="degrading",
    title="Evidence incomplete",
    explanation="Veritrail could not fully assess this capability for a reason that is not yet classified.",
    action="Re-sync the integration, then contact support if the issue persists.",
)


def _def(
    code: str,
    impact: LimitationImpact,
    title: str,
    explanation: str,
    action: str,
) -> tuple[str, LimitationDefinition]:
    return code, LimitationDefinition(
        code=code,
        impact=impact,
        title=title,
        explanation=explanation,
        action=action,
    )


# Static codes emitted by collectors. Dynamic families resolve via PREFIX_DEFINITIONS.
LIMITATION_REGISTRY: dict[str, LimitationDefinition] = dict(
    (
        _def(
            "permission_denied",
            "blocking",
            "Permission required",
            "Veritrail could not read the evidence needed to assess this capability.",
            "Grant the required read permission, then sync again.",
        ),
        _def(
            "unavailable_by_plan",
            "blocking",
            "Plan feature unavailable",
            "The connected provider plan does not expose this capability to Veritrail.",
            "Upgrade the provider plan or connect an equivalent source that covers this lane.",
        ),
        _def(
            "unavailable_by_plan_or_tier",
            "blocking",
            "Plan or tier unavailable",
            "The connected provider plan or product tier does not expose this capability.",
            "Upgrade the provider plan/tier or connect an equivalent source.",
        ),
        _def(
            "collection_error",
            "blocking",
            "Collection failed",
            "Veritrail could not finish collecting evidence for this capability.",
            "Retry the sync. If it keeps failing, check provider status and credentials.",
        ),
        _def(
            "enablement_only_legacy_snapshot",
            "degrading",
            "Legacy enablement snapshot",
            "Only a legacy enablement flag is available; Veritrail cannot prove activity or full scope.",
            "Re-sync so Veritrail can collect current activity and coverage evidence.",
        ),
        _def(
            "legacy_sync_summary_only",
            "degrading",
            "Legacy sync summary",
            "Only a legacy sync summary exists; it does not distinguish 'no findings' from 'no data'.",
            "Run a fresh sync that collects authoritative capability evidence.",
        ),
        _def(
            "enabled_without_observable_activity",
            "degrading",
            "Enabled but inactive",
            "The capability appears enabled, but Veritrail has not observed successful security activity.",
            "Confirm the feature is running and wait for the next successful scan, then sync again.",
        ),
        _def(
            "asset_denominator_not_collected",
            "degrading",
            "Eligible assets unknown",
            "Findings were collected without an authoritative inventory of eligible assets.",
            "Connect a source that provides an in-scope asset inventory for this lane.",
        ),
        _def(
            "scanner_connected_without_assessed_assets",
            "degrading",
            "Scanner connected without assessed assets",
            "The scanner integration is connected but Veritrail cannot prove which assets were assessed.",
            "Provide asset inventory coverage from the scanner or an equivalent native source.",
        ),
        _def(
            "inspector_status_not_collected",
            "blocking",
            "Inspector status missing",
            "Amazon Inspector enablement status could not be collected.",
            "Grant Inspector read access and re-sync the AWS account.",
        ),
        _def(
            "inspector_resource_coverage_not_collected",
            "blocking",
            "Inspector coverage missing",
            "Amazon Inspector resource coverage could not be established.",
            "Grant Inspector coverage read access and re-sync the AWS account.",
        ),
        _def(
            "inspector_disabled_all_resource_types",
            "degrading",
            "Inspector disabled",
            "Amazon Inspector is disabled for all resource types in this account.",
            "Enable Inspector for the resource types in scope, then sync again.",
        ),
        _def(
            "inspector_ec2_disabled",
            "degrading",
            "Inspector EC2 disabled",
            "Amazon Inspector EC2 scanning is disabled.",
            "Enable Inspector for EC2, then sync again.",
        ),
        _def(
            "inspector_ecr_disabled",
            "degrading",
            "Inspector ECR disabled",
            "Amazon Inspector ECR scanning is disabled.",
            "Enable Inspector for ECR, then sync again.",
        ),
        _def(
            "osconfig_not_collected",
            "blocking",
            "OS Config evidence missing",
            "GCP OS Config vulnerability evidence could not be collected.",
            "Grant OS Config read access and re-sync the GCP project.",
        ),
        _def(
            "osconfig_api_inaccessible",
            "blocking",
            "OS Config API inaccessible",
            "The GCP OS Config API was not accessible to Veritrail.",
            "Enable the OS Config API and grant read access, then sync again.",
        ),
        _def(
            "scc_not_collected",
            "blocking",
            "Security Command Center missing",
            "GCP Security Command Center evidence could not be collected.",
            "Grant SCC read access and re-sync the GCP project.",
        ),
        _def(
            "scc_aggregator_not_full_vm_coverage",
            "degrading",
            "SCC does not prove full VM coverage",
            "SCC findings alone do not prove every in-scope VM was assessed.",
            "Connect OS Config or another source that provides a complete VM assessment inventory.",
        ),
        _def(
            "scc_accessible_sources_not_enumerated",
            "degrading",
            "SCC sources not enumerated",
            "Veritrail could not enumerate all accessible SCC sources.",
            "Grant broader SCC source listing permission and re-sync.",
        ),
        _def(
            "scc_no_vulnerability_class_findings",
            "degrading",
            "No SCC vulnerability findings",
            "SCC returned no vulnerability-class findings for this scope.",
            "Confirm vulnerability sources are enabled in SCC, or connect an equivalent scanner.",
        ),
        _def(
            "defender_status_not_collected",
            "blocking",
            "Defender status missing",
            "Microsoft Defender for Cloud status could not be collected.",
            "Grant Defender read access and re-sync the Azure subscription.",
        ),
        _def(
            "defender_resource_coverage_not_collected",
            "blocking",
            "Defender coverage missing",
            "Defender resource coverage could not be established.",
            "Grant Defender coverage read access and re-sync.",
        ),
        _def(
            "enablement_only_plan_detail_missing",
            "degrading",
            "Defender plan detail missing",
            "Defender appears enabled, but plan detail needed to prove assessed assets is missing.",
            "Grant plan inventory read access and re-sync.",
        ),
        _def(
            "enablement_only_no_plan_inventory",
            "degrading",
            "No Defender plan inventory",
            "Defender enablement was observed without a plan inventory that proves assessed assets.",
            "Collect Defender plan inventory, then sync again.",
        ),
        _def(
            "servers_plan_not_confirmed",
            "degrading",
            "Servers plan not confirmed",
            "Defender for Servers plan could not be confirmed for this scope.",
            "Confirm the Servers plan is enabled and readable, then sync again.",
        ),
        _def(
            "no_ec2_inventory",
            "blocking",
            "No EC2 inventory",
            "Veritrail could not establish an EC2 inventory, so host coverage cannot be assessed.",
            "Grant EC2 inventory read access and re-sync.",
        ),
        _def(
            "no_ecr_inventory",
            "blocking",
            "No ECR inventory",
            "Veritrail could not establish an ECR inventory, so image coverage cannot be assessed.",
            "Grant ECR inventory read access and re-sync.",
        ),
        _def(
            "no_lambda_inventory",
            "blocking",
            "No Lambda inventory",
            "Veritrail could not establish a Lambda inventory, so serverless coverage cannot be assessed.",
            "Grant Lambda inventory read access and re-sync.",
        ),
        _def(
            "no_gce_inventory",
            "blocking",
            "No GCE inventory",
            "Veritrail could not establish a GCE inventory, so host coverage cannot be assessed.",
            "Grant Compute inventory read access and re-sync.",
        ),
        _def(
            "no_azure_vm_inventory",
            "blocking",
            "No Azure VM inventory",
            "Veritrail could not establish an Azure VM inventory, so host coverage cannot be assessed.",
            "Grant VM inventory read access and re-sync.",
        ),
        _def(
            "lambda_standard_only_code_scanning_off",
            "degrading",
            "Lambda code scanning off",
            "Lambda standard scanning is present but Lambda code scanning is not enabled.",
            "Enable Inspector Lambda code scanning if code-level coverage is required.",
        ),
        _def(
            "security_job_allows_failure",
            "degrading",
            "Security job allows failure",
            "CI security checks may run but are allowed to fail, so enforcement is incomplete.",
            "Require security jobs to pass on protected branches.",
        ),
        _def(
            "security_jobs_not_required",
            "degrading",
            "Security jobs not required",
            "Security jobs are not required on protected pipelines.",
            "Make security jobs required, then sync again.",
        ),
        _def(
            "security_checks_not_required",
            "degrading",
            "Security checks not required",
            "Branch protection does not require the security checks Veritrail observed.",
            "Require the security checks on protected branches.",
        ),
        _def(
            "no_pipelines",
            "degrading",
            "No pipelines observed",
            "No pipelines were available to assess CI security enforcement.",
            "Run a pipeline with security jobs, then sync again.",
        ),
        _def(
            "no_workflow_runs",
            "degrading",
            "No workflow runs observed",
            "No GitHub Actions workflow runs were available to assess CI security enforcement.",
            "Run a workflow with security jobs, then sync again.",
        ),
        _def(
            "no_recent_successful_security_workflow",
            "degrading",
            "No recent successful security workflow",
            "Veritrail did not observe a recent successful security workflow run.",
            "Ensure security workflows succeed on a regular cadence, then sync again.",
        ),
        _def(
            "connected_without_security_signals",
            "degrading",
            "Connected without security signals",
            "The integration is connected, but Veritrail has not collected security signals for this lane.",
            "Enable security signal collection in the provider, then sync again.",
        ),
        _def(
            "generic_elasticsearch_not_security_solution",
            "blocking",
            "Elasticsearch is not Security Solution",
            "A generic Elasticsearch connection does not prove Elastic Security threat detection.",
            "Connect Elastic Security / Security Solution signals, or another threat-detection source.",
        ),
        _def(
            "base_datadog_without_cloud_siem_signals",
            "blocking",
            "Datadog without Cloud SIEM signals",
            "Base Datadog connectivity without Cloud SIEM signals does not prove threat detection.",
            "Enable Datadog Cloud SIEM signals and re-sync.",
        ),
        _def(
            "splunk_index_not_configured",
            "degrading",
            "Splunk index not configured",
            "Splunk is connected but the security index Veritrail needs is not configured.",
            "Configure the security index mapping and sync again.",
        ),
        _def(
            "security_detection_rules_not_collected",
            "degrading",
            "Detection rules not collected",
            "Security detection rules could not be collected for this SIEM.",
            "Grant detection-rule read access and re-sync.",
        ),
        _def(
            "security_detection_unassessed",
            "degrading",
            "Detection unassessed",
            "Veritrail could not assess whether security detections are active.",
            "Expose detection status to Veritrail and sync again.",
        ),
        _def(
            "not_threat_detection",
            "blocking",
            "Not threat detection",
            "The connected signals are not classified as threat-detection evidence.",
            "Connect a source that produces threat-detection signals for this lane.",
        ),
        _def(
            "no_services_or_schedules",
            "degrading",
            "No on-call services or schedules",
            "PagerDuty has no services or schedules configured for incident operations.",
            "Configure on-call services/schedules, then sync again.",
        ),
        _def(
            "services_configured_without_incident_activity",
            "degrading",
            "Services without incident activity",
            "PagerDuty services exist, but Veritrail has not observed incident activity.",
            "Confirm incident routing is active; activity will appear after real or test incidents.",
        ),
        _def(
            "spotlight_vulnerabilities_not_licensed",
            "informational",
            "Spotlight not licensed",
            "CrowdStrike Spotlight vulnerability data is not licensed. Host/sensor evidence is assessed separately.",
            "License Spotlight if vulnerability evidence from CrowdStrike is required, or use another vuln source.",
        ),
        _def(
            "spotlight_vulnerabilities_unavailable",
            "informational",
            "Spotlight unavailable",
            "CrowdStrike Spotlight vulnerability data is unavailable. Host/sensor evidence is assessed separately.",
            "Enable Spotlight access or connect another vulnerability source.",
        ),
        _def(
            "threats_api_forbidden",
            "informational",
            "Threats API forbidden",
            "SentinelOne Threats API access was denied. Agent-health evidence is assessed separately.",
            "Grant Threats API permission if threat evidence is required, or rely on another source.",
        ),
        _def(
            "vulnerability_module_not_available",
            "informational",
            "Vulnerability module unavailable",
            "The EDR vulnerability module is not available. Agent/sensor health is assessed separately.",
            "Enable the vulnerability module or connect another vulnerability source.",
        ),
        _def(
            "edr_unvalidated_beta",
            "informational",
            "EDR Beta unvalidated",
            "Evidence was collected from an EDR provider that has not passed live-tenant GA validation. "
            "Coverage counts remain visible; verified verdicts are withheld until validation completes.",
            "Complete the live validation checklist in docs/edr-live-validation-record.md, "
            "then set ga_validated via the admin API.",
        ),
        _def(
            "no_managed_devices",
            "degrading",
            "No managed devices",
            "The EDR connection returned no managed devices in scope.",
            "Confirm devices are enrolled, then sync again.",
        ),
        _def(
            "no_managed_agents",
            "degrading",
            "No managed agents",
            "The EDR connection returned no managed agents in scope.",
            "Confirm agents are enrolled, then sync again.",
        ),
        _def(
            "partial_sensor_health",
            "degrading",
            "Partial sensor health",
            "Some managed devices are missing healthy sensor coverage.",
            "Remediate unhealthy sensors, then sync again.",
        ),
        _def(
            "partial_agent_health",
            "degrading",
            "Partial agent health",
            "Some managed agents are missing healthy coverage.",
            "Remediate unhealthy agents, then sync again.",
        ),
        _def(
            "assessments_collect_failed",
            "blocking",
            "Assessments collection failed",
            "Defender assessments could not be collected.",
            "Grant assessments read access and re-sync.",
        ),
        _def(
            "defender_not_enabled",
            "degrading",
            "Defender not enabled",
            "Microsoft Defender for Cloud does not appear enabled for this scope.",
            "Enable Defender for Cloud for the in-scope resources, then sync again.",
        ),
        _def(
            "defender_free_tier",
            "degrading",
            "Defender free tier",
            "Defender appears to be on a free tier that may not prove full assessment coverage.",
            "Confirm the required Defender plans are enabled, then sync again.",
        ),
        _def(
            "defender_enabled",
            "informational",
            "Defender enabled",
            "Defender enablement was observed; coverage still depends on assessments and inventory.",
            "Ensure assessments and inventory remain readable to Veritrail.",
        ),
    )
)


# Dynamic families: collectors emit ``prefix_<suffix>`` (e.g. HTTP status).
PREFIX_DEFINITIONS: tuple[tuple[str, LimitationDefinition], ...] = (
    (
        "spotlight_query_error_",
        LimitationDefinition(
            code="spotlight_query_error_*",
            impact="informational",
            title="Spotlight query error",
            explanation="CrowdStrike Spotlight returned an error while collecting vulnerabilities. Host/sensor evidence is assessed separately.",
            action="Check Spotlight API access and retry the sync.",
        ),
    ),
    (
        "threats_query_error_",
        LimitationDefinition(
            code="threats_query_error_*",
            impact="informational",
            title="Threats query error",
            explanation="SentinelOne Threats returned an error. Agent-health evidence is assessed separately.",
            action="Check Threats API access and retry the sync.",
        ),
    ),
    (
        "inspector_coverage_collection_failed:",
        LimitationDefinition(
            code="inspector_coverage_collection_failed:*",
            impact="blocking",
            title="Inspector coverage collection failed",
            explanation="Amazon Inspector coverage collection failed before an authoritative inventory was established.",
            action="Retry the sync and verify Inspector API access.",
        ),
    ),
    (
        "assessments_api_status_",
        LimitationDefinition(
            code="assessments_api_status_*",
            impact="blocking",
            title="Assessments API error",
            explanation="The Defender assessments API returned an error status.",
            action="Verify Azure permissions and retry the sync.",
        ),
    ),
    (
        "collection_limited_by_",
        LimitationDefinition(
            code="collection_limited_by_*",
            impact="blocking",
            title="Collection budget reached",
            explanation="Veritrail stopped collecting before the inventory was complete (rate limit or page/request budget).",
            action="Retry the sync later, or reduce repository scope so collection can finish.",
        ),
    ),
    (
        "scanner_",
        LimitationDefinition(
            code="scanner_*",
            impact="degrading",
            title="Scanner limitation",
            explanation="The external scanner reported a limitation that prevents complete scope proof.",
            action="Review scanner permissions and inventory coverage, then sync again.",
        ),
    ),
)


def resolve_limitation(code: str | None) -> LimitationDefinition:
    """Resolve a collector code to a definition. Unknown codes fail closed as degrading."""
    if not code:
        return _GENERIC_UNKNOWN
    exact = LIMITATION_REGISTRY.get(code)
    if exact is not None:
        return exact
    for prefix, definition in PREFIX_DEFINITIONS:
        if code.startswith(prefix):
            # Preserve the emitted code on the returned view while keeping family metadata.
            return LimitationDefinition(
                code=code,
                impact=definition.impact,
                title=definition.title,
                explanation=definition.explanation,
                action=definition.action,
            )
    return LimitationDefinition(
        code=code,
        impact=_GENERIC_UNKNOWN.impact,
        title=_GENERIC_UNKNOWN.title,
        explanation=_GENERIC_UNKNOWN.explanation,
        action=_GENERIC_UNKNOWN.action,
    )


def limitation_impact(code: str) -> LimitationImpact:
    return resolve_limitation(code).impact


def has_blocking_limitation(codes: list[str] | tuple[str, ...] | None) -> bool:
    return any(limitation_impact(c) == "blocking" for c in (codes or []))


def has_degrading_limitation(codes: list[str] | tuple[str, ...] | None) -> bool:
    return any(limitation_impact(c) == "degrading" for c in (codes or []))


def blocking_limitations(codes: list[str] | tuple[str, ...] | None) -> list[str]:
    return [c for c in (codes or []) if limitation_impact(c) == "blocking"]


def primary_limitation(codes: list[str] | tuple[str, ...] | None) -> LimitationDefinition | None:
    """Pick the most severe limitation for UI: blocking → degrading → informational."""
    items = list(codes or [])
    if not items:
        return None
    ranked = sorted(
        items,
        key=lambda c: {"blocking": 0, "degrading": 1, "informational": 2}.get(
            limitation_impact(c), 1
        ),
    )
    return resolve_limitation(ranked[0])


def serialize_limitation(code: str) -> dict[str, str]:
    d = resolve_limitation(code)
    return {
        "code": d.code,
        "impact": d.impact,
        "title": d.title,
        "explanation": d.explanation,
        "action": d.action,
    }


def serialize_limitations(codes: list[str] | tuple[str, ...] | None) -> list[dict[str, str]]:
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for code in codes or []:
        if code in seen:
            continue
        seen.add(code)
        out.append(serialize_limitation(code))
    return out


def registered_static_codes() -> frozenset[str]:
    return frozenset(LIMITATION_REGISTRY.keys())
