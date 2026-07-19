"""Narrative capability-domain sections for the compliance evidence PDF.

Transforms per-control results (as assembled by evidence_pack) into
auditor-style capability domains: an evidence-anchored assertion paragraph,
a coverage line, documented exceptions vs open gaps, framework control tags,
and resource rows for the report appendix.

Phrasing rules (consistent with control_narratives.py): assertions say a
capability "is supported" by collected evidence — never "fulfills",
"is compliant", or "is secure". Only checks that actually ran and reported
no open findings are asserted, always scoped to the account and as-of time.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

# ── Domain definitions ────────────────────────────────────────────────────────
# key → (label, capability phrase used as the sentence subject, composite ids)
DOMAIN_DEFS: list[dict[str, Any]] = [
    {
        "key": "identity_access",
        "label": "Identity & Access Management",
        "capability": "Identity and access management capability",
        "composites": ["identity_governance", "asset_inventory"],
    },
    {
        "key": "secure_sdlc",
        "label": "SDLC & Source Control",
        "capability": "Secure software development and source-control review capability",
        "composites": ["secure_sdlc"],
    },
    {
        "key": "change_management",
        "label": "Change Management",
        "capability": "Infrastructure and deployment change-management capability",
        "composites": ["change_management"],
    },
    {
        "key": "data_protection",
        "label": "Data Protection & Encryption",
        "capability": "Data protection and encryption capability",
        "composites": ["data_protection"],
    },
    {
        "key": "network_boundary",
        "label": "Network & Boundary Security",
        "capability": "Network and boundary protection capability",
        "composites": ["network_boundary"],
    },
    {
        "key": "vulnerability_management",
        "label": "Vulnerability Management",
        "capability": "Vulnerability management capability",
        "composites": ["vulnerability_management", "container_vulnerability_monitoring"],
    },
    {
        "key": "logging_monitoring",
        "label": "Logging & Monitoring",
        "capability": "Audit logging and monitoring capability",
        "composites": ["logging_monitoring"],
    },
    {
        "key": "incident_response",
        "label": "Threat Detection",
        "capability": "Threat detection service coverage",
        "composites": ["incident_response"],
        # Boundary note is attached via DOMAIN_BOUNDARY_NOTES below.
    },
    {
        "key": "backup_dr",
        "label": "Backup & Data Recovery",
        "capability": "Backup and data-restoration capability",
        "composites": ["backup_resilience"],
    },
]

_COMPOSITE_TO_DOMAIN: dict[str, str] = {
    comp: d["key"] for d in DOMAIN_DEFS for comp in d["composites"]
}

# Multi-AZ is availability evidence, not evidence that lost data can be restored.
# There is not yet a useful availability domain with enough collectable checks, so
# omit this check from capability narratives rather than misclassifying it as DR.
_DOMAIN_EXCLUDED_CHECKS = frozenset({"rds.instance.no_multi_az"})

# Fallback when a check has no composite roll-up: match on check-id prefix,
# longest prefix wins.
_PREFIX_DOMAIN: list[tuple[str, str]] = [
    ("github.repo.", "secure_sdlc"),
    ("gitlab.repo.", "secure_sdlc"),
    ("github.", "identity_access"),
    ("gitlab.", "identity_access"),
    ("iam.", "identity_access"),
    ("identity_center.", "identity_access"),
    ("google_workspace.", "identity_access"),
    ("entra.", "identity_access"),
    ("azure.entra.", "identity_access"),
    ("s3.", "data_protection"),
    ("kms.", "data_protection"),
    ("dynamodb.", "data_protection"),
    ("sns.", "data_protection"),
    ("sqs.", "data_protection"),
    ("secretsmanager.", "data_protection"),
    ("ssm.", "data_protection"),
    ("ec2.security_group.", "network_boundary"),
    ("ec2.", "network_boundary"),
    ("ecs.", "network_boundary"),
    ("eks.", "network_boundary"),
    ("elb.", "network_boundary"),
    ("lambda.", "change_management"),
    ("rds.instance.no_automated_backup", "backup_dr"),
    ("rds.instance.no_deletion_protection", "backup_dr"),
    ("rds.", "data_protection"),
    ("backup.", "backup_dr"),
    ("cloudtrail.", "logging_monitoring"),
    ("vpc.", "logging_monitoring"),
    ("aws.config", "logging_monitoring"),
    ("guardduty.", "incident_response"),
    ("aws.securityhub", "incident_response"),
    ("azure.defender", "incident_response"),
    ("scanner.", "vulnerability_management"),
    ("aws.inspector", "vulnerability_management"),
    ("aws.vulnerability_monitoring", "vulnerability_management"),
    ("ecr.", "vulnerability_management"),
    ("acm.", "data_protection"),
    ("aws.access_analyzer", "identity_access"),
    ("aws.account.", "identity_access"),
]

# ── Verified-capability phrases per check ─────────────────────────────────────
# What a PASS on this check verifies, phrased for the assertion paragraph.
# Checks without an entry are still counted in coverage math; they are simply
# not called out by name in the narrative sentence.
CHECK_VERIFIED_PHRASES: dict[str, str] = {
    # Identity & access
    "iam.root.no_mfa": "MFA is enabled on the AWS root account",
    "iam.root.has_access_keys": "no programmatic access keys exist for the root account",
    "iam.root.usage": "no root-credential activity was observed",
    "iam.user.no_mfa": "console IAM users have MFA devices enrolled",
    "iam.user.credentials_unused_45d": "no IAM user credentials are dormant beyond the inactivity threshold",
    "iam.access_key.unused_45d": "no access keys are unused beyond the inactivity threshold",
    "iam.access_key.no_rotation_90d": "access keys are rotated within 90 days",
    "iam.access_key.multiple_active": "no IAM user holds more than one active access key",
    "iam.account.password_policy_weak": "the account password policy meets minimum complexity requirements",
    "iam.user.direct_policy_attachment": "IAM policies are not attached directly to users",
    "iam.user.admin_policy_attached": "no IAM user carries administrator-level policies",
    "iam.role.least_privilege_policy": "no role policies grant wildcard administrative actions",
    "iam.policy.wildcard_resource": "customer-managed policies avoid wildcard resource scopes",
    "iam.role.trust_wildcard": "no role trust policies allow wildcard principals",
    "iam.role.external_account_trust": "role trust relationships to external accounts are accounted for",
    "iam.role.unassumed_90d": "no roles have gone unassumed beyond the review threshold",
    "iam.perm.granted_vs_used": "granted permissions align with observed service usage",
    "iam.server_certificate.expired": "no expired IAM server certificates are present",
    "iam.cloudshell_full_access_granted": "broad CloudShell access is not granted",
    "aws.access_analyzer.not_enabled": "IAM Access Analyzer is enabled",
    "github.org.mfa_not_enforced": "organization MFA enforcement is enabled in GitHub",
    "gitlab.org.mfa_not_enforced": "organization MFA enforcement is enabled in GitLab",
    "github.org.dormant_members": "no dormant GitHub organization members were detected",
    "github.org.outside_collaborators": "outside collaborators with repository access are accounted for",
    # SDLC / source control
    "github.repo.no_branch_protection": "branch protection is enabled on default branches",
    "gitlab.repo.no_branch_protection": "branch protection is enabled on default branches",
    "github.repo.insufficient_reviews": "pull requests require reviewer approval before merge",
    "gitlab.repo.insufficient_reviews": "merge requests require reviewer approval before merge",
    "github.repo.self_merge_allowed": "self-merged pull requests are prevented",
    "gitlab.repo.self_merge_allowed": "self-merged merge requests are prevented",
    "github.repo.secret_scanning_disabled": "secret scanning is enabled on repositories",
    "github.repo.code_scanning_disabled": "code scanning is enabled on repositories",
    "github.repo.dependabot_disabled": "dependency update automation is enabled",
    # Change management
    "github.repo.no_env_protection": "deployment environments are protected",
    "gitlab.repo.no_env_protection": "deployment environments are protected",
    "lambda.function.deprecated_runtime": "Lambda functions run on supported runtimes",
    # Data protection
    "s3.bucket.no_default_encryption": "S3 buckets have default encryption enabled",
    "s3.bucket.no_kms": "S3 buckets use KMS-managed encryption where required",
    "s3.bucket.no_https_policy": "S3 bucket policies enforce HTTPS-only access",
    "s3.account.public_access_not_blocked": "account-level S3 Block Public Access is enabled",
    "s3.bucket.public_access_not_blocked": "per-bucket S3 Block Public Access is enabled",
    "kms.key.no_rotation": "customer-managed KMS keys have automatic rotation enabled",
    "kms.key.policy_wildcard_principal": "KMS key policies avoid wildcard principals",
    "rds.instance.no_encryption": "RDS instance storage encryption is enabled",
    "ec2.ebs.volume_unencrypted": "EBS volumes are encrypted at rest",
    "ec2.ebs.encryption_not_default": "EBS encryption-by-default is enabled",
    "dynamodb.table.no_encryption": "DynamoDB tables are encrypted",
    "sns.topic.no_encryption": "SNS topics are encrypted",
    "sqs.queue.no_encryption": "SQS queues are encrypted",
    "secretsmanager.secret.no_rotation": "Secrets Manager secrets have rotation configured",
    "ssm.parameter.plaintext_secret": "no plaintext secrets were detected in SSM parameters",
    "acm.certificate.expiring": "no ACM certificates are near expiry",
    # Network & boundary
    "ec2.security_group.unrestricted_ssh": "security groups do not expose SSH to the internet",
    "ec2.security_group.unrestricted_rdp": "security groups do not expose RDP to the internet",
    "ec2.security_group.default_allows_traffic": "default VPC security groups allow no traffic",
    "ec2.instance.imdsv2_not_required": "EC2 instances require IMDSv2",
    "rds.instance.publicly_accessible": "no RDS instances are publicly accessible",
    "rds.snapshot.public": "no RDS snapshots are shared publicly",
    "ec2.ami.public": "no AMIs are shared publicly",
    "ec2.ebs.snapshot_public": "no EBS snapshots are shared publicly",
    "eks.cluster.public_endpoint": "EKS cluster endpoints are not publicly exposed",
    "ecs.service.public_ip_enabled": "ECS services do not auto-assign public IPs",
    "lambda.function.public_url": "no Lambda function URLs are publicly exposed",
    "elb.load_balancer.weak_tls_policy": "load balancers enforce modern TLS policies",
    # Vulnerability management
    "aws.inspector.active_critical_finding": "no active critical Inspector findings are open",
    "aws.vulnerability_monitoring.not_detected": "vulnerability monitoring coverage was detected",
    "ecr.repository.image_scan_disabled": "ECR image scanning is enabled",
    "ecr.registry.enhanced_scanning_disabled": "ECR enhanced scanning is enabled",
    # Logging & monitoring
    "cloudtrail.trail.not_enabled": "CloudTrail is enabled with multi-region coverage",
    "cloudtrail.trail.no_log_validation": "CloudTrail log file validation is enabled",
    "cloudtrail.trail.no_kms": "CloudTrail logs are encrypted with KMS",
    "cloudtrail.trail.no_cloudwatch_logs": "CloudTrail trails deliver to CloudWatch Logs",
    "cloudtrail.trail.s3_bucket_public": "CloudTrail delivery buckets are not public",
    "cloudtrail.trail.s3_bucket_no_logging": "access logging is enabled on CloudTrail delivery buckets",
    "cloudtrail.event.trail_tampering": "no CloudTrail tampering events were observed",
    "aws.config.not_enabled": "AWS Config recording is enabled",
    "aws.config.rules_non_compliant": "AWS Config managed rules report compliant",
    "vpc.flow_logs.not_enabled": "VPC flow logging is enabled",
    "s3.bucket.no_logging": "S3 server access logging is enabled where required",
    "elb.load_balancer.no_access_logs": "load balancer access logging is enabled",
    "eks.cluster.control_plane_logging_disabled": "EKS control-plane logging is enabled",
    # Incident response
    "guardduty.detector.not_enabled": "GuardDuty threat detection is enabled across regions",
    "guardduty.open_findings": "no unresolved GuardDuty findings are open",
    "aws.securityhub.not_enabled": "Security Hub is enabled",
    "cloudtrail.event.guardduty_disabled": "no attempts to disable GuardDuty were observed",
    # Backup & DR
    "backup.plan.missing": "at least one AWS Backup plan is configured",
    "rds.instance.no_automated_backup": (
        "automated backups and point-in-time restoration are enabled on RDS instances"
    ),
    "rds.instance.no_deletion_protection": (
        "deletion protection is enabled as a preventive safeguard on RDS instances"
    ),
    "dynamodb.table.no_pitr": "point-in-time recovery is enabled on DynamoDB tables",
}

_MAX_VERIFIED_PHRASES = 4
_MAX_APPENDIX_ROWS = 40


@dataclass
class DomainSection:
    key: str
    label: str
    assertion: str
    coverage_line: str
    control_tags: list[str]
    exceptions: list[dict[str, Any]]  # deduped excepted findings (with exception info)
    gaps: list[dict[str, Any]]  # deduped open findings
    appendix_rows: list[dict[str, Any]]
    checks_total: int = 0
    checks_passing: int = 0
    scope_note: str | None = None
    verified_phrases: list[str] = field(default_factory=list)


def domain_for_check(check_id: str) -> str | None:
    """Resolve a check id to a capability domain key."""
    if check_id in _DOMAIN_EXCLUDED_CHECKS:
        return None
    try:
        from app.services.composite_controls import primary_composite_id_for_check

        comp = primary_composite_id_for_check(check_id)
    except Exception:
        comp = None
    if comp and comp in _COMPOSITE_TO_DOMAIN:
        return _COMPOSITE_TO_DOMAIN[comp]
    best: str | None = None
    best_len = -1
    for prefix, key in _PREFIX_DOMAIN:
        if check_id.startswith(prefix) and len(prefix) > best_len:
            best, best_len = key, len(prefix)
    return best


def _control_check_ids(control: dict[str, Any]) -> list[str]:
    for source in ("check_evidence_classes", "check_tiers"):
        val = control.get(source)
        if isinstance(val, dict) and val:
            return list(val.keys())
    # Fall back to check ids observed on findings/exceptions.
    ids: list[str] = []
    for f in (control.get("findings") or []) + (control.get("exceptions") or []):
        cid = f.get("check_id")
        if cid:
            ids.append(cid)
    return ids


def _finding_key(f: dict[str, Any]) -> str:
    return str(f.get("id") or f"{f.get('check_id')}::{f.get('resource_arn')}")


def _fmt_ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M UTC")


def _join_clauses(clauses: list[str]) -> str:
    if not clauses:
        return ""
    if len(clauses) == 1:
        return clauses[0]
    return ", ".join(clauses[:-1]) + ", and " + clauses[-1]


def _framework_tag(framework: str, control_id: str) -> str:
    label = {"soc2": "SOC 2", "cis_aws_l1": "CIS AWS", "iso27001": "ISO 27001"}.get(framework, framework.upper())
    return f"{label} {control_id}"


def _cross_framework_tags(domain_def: dict[str, Any], framework: str) -> list[str]:
    """Secondary tags from composite defs (SOC 2, and ISO where mapped)."""
    tags: list[str] = []
    try:
        from app.services.composite_controls import composite_control_definitions

        defs = {e["id"]: e for e in composite_control_definitions()}
    except Exception:
        return tags
    for comp in domain_def["composites"]:
        entry = defs.get(comp) or {}
        if framework != "soc2":
            for c in entry.get("soc2_criteria") or []:
                tags.append(f"SOC 2 {c}")
        if framework != "iso27001":
            for c in entry.get("iso_criteria") or []:
                tags.append(f"ISO 27001 {c}")
    seen: set[str] = set()
    out = []
    for t in tags:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


def _assertion_text(
    domain_def: dict[str, Any],
    *,
    checks_total: int,
    checks_passing: int,
    verified_phrases: list[str],
    gap_findings: list[dict[str, Any]],
    exception_findings: list[dict[str, Any]],
    account_scope: str,
    as_of: datetime,
    workspace_scope: bool,
) -> str:
    capability = domain_def["capability"]
    scope = "the connected source-control workspace" if workspace_scope else account_scope
    parts: list[str] = []

    if checks_total and checks_passing == checks_total:
        parts.append(f"{capability} is supported by automated evidence collected from {scope}.")
    elif checks_passing:
        parts.append(
            f"{capability} is partially supported by automated evidence collected from {scope}."
        )
    else:
        parts.append(
            f"{capability} could not be affirmed from automated evidence in this period for {scope}."
        )

    parts.append(
        f"As of {_fmt_ts(as_of)}, {checks_passing} of {checks_total} automated checks in this domain "
        f"reported no open findings."
    )

    if verified_phrases:
        shown = verified_phrases[:_MAX_VERIFIED_PHRASES]
        extra = checks_passing - len(shown)
        sentence = f"Collected evidence verifies that {_join_clauses(shown)}"
        if extra > 0:
            sentence += f"; {extra} further check(s) also reported no open findings"
        parts.append(sentence + ".")

    if gap_findings:
        resources = {f.get("resource_arn") for f in gap_findings if f.get("resource_arn")}
        parts.append(
            f"{len(gap_findings)} open finding(s) affecting {len(resources)} resource(s) remain and are "
            "reported as gaps below; open findings are not treated as exceptions."
        )
    if exception_findings:
        parts.append(
            f"{len(exception_findings)} finding(s) in this domain are covered by documented, "
            "risk-accepted exceptions recorded with approver and rationale."
        )
    return " ".join(parts)


def _coverage_line(
    *,
    checks_total: int,
    checks_passing: int,
    gap_findings: list[dict[str, Any]],
    exception_findings: list[dict[str, Any]],
    account_scope: str,
    workspace_scope: bool,
) -> str:
    bits = [f"{checks_passing} of {checks_total} automated checks passing"]
    if gap_findings:
        resources = {f.get("resource_arn") for f in gap_findings if f.get("resource_arn")}
        bits.append(f"{len(gap_findings)} open finding(s) on {len(resources)} resource(s)")
    if exception_findings:
        bits.append(f"{len(exception_findings)} documented exception(s)")
    bits.append("scope: connected source-control workspace" if workspace_scope else f"scope: {account_scope}")
    return "  ·  ".join(bits)


DOMAIN_BOUNDARY_NOTES: dict[str, str] = {
    "incident_response": (
        "Technical detection verified only: these checks confirm detection services "
        "are enabled and surface open findings. Incident-response plans, triage "
        "workflows, and alert routing are separate evidence (SOC 2 CC7.3/CC7.4) and "
        "are not verified here."
    ),
    "data_protection": (
        "Cloud configuration evidence only. Media-disposal policy (SOC 2 CC6.5) is "
        "separate uploaded evidence and is not verified by these checks."
    ),
}


def build_domain_sections(
    control_results: list[dict[str, Any]],
    *,
    framework: str,
    account_label: str,
    account_id: str,
    generated_at: datetime,
) -> list[DomainSection]:
    """Group check results into capability-domain narrative sections.

    Open findings become gaps; ``excepted`` findings become documented
    exceptions carrying their recorded reason. Findings are deduplicated per
    domain (a finding can map to several controls).
    """
    account_scope = f"account {account_label} ({account_id})"

    checks_by_domain: dict[str, set[str]] = {}
    failing_checks: dict[str, set[str]] = {}
    gaps_by_domain: dict[str, dict[str, dict[str, Any]]] = {}
    excs_by_domain: dict[str, dict[str, dict[str, Any]]] = {}
    controls_by_domain: dict[str, set[str]] = {}

    for control in control_results:
        control_domains: set[str] = set()
        for cid in _control_check_ids(control):
            domain = domain_for_check(cid)
            if not domain:
                continue
            checks_by_domain.setdefault(domain, set()).add(cid)
            control_domains.add(domain)
        for f in control.get("findings") or []:
            domain = domain_for_check(f.get("check_id") or "")
            if not domain:
                continue
            checks_by_domain.setdefault(domain, set()).add(f.get("check_id"))
            failing_checks.setdefault(domain, set()).add(f.get("check_id"))
            gaps_by_domain.setdefault(domain, {})[_finding_key(f)] = f
            control_domains.add(domain)
        for f in control.get("exceptions") or []:
            domain = domain_for_check(f.get("check_id") or "")
            if not domain:
                continue
            checks_by_domain.setdefault(domain, set()).add(f.get("check_id"))
            excs_by_domain.setdefault(domain, {})[_finding_key(f)] = f
            control_domains.add(domain)
        for domain in control_domains:
            controls_by_domain.setdefault(domain, set()).add(control.get("control_id") or "")

    sections: list[DomainSection] = []
    for domain_def in DOMAIN_DEFS:
        key = domain_def["key"]
        checks = checks_by_domain.get(key) or set()
        if not checks:
            continue
        failing = failing_checks.get(key) or set()
        passing = sorted(checks - failing)
        gaps = sorted(
            gaps_by_domain.get(key, {}).values(),
            key=lambda f: ({"critical": 0, "high": 1, "medium": 2, "low": 3}.get(str(f.get("severity")).lower(), 9), str(f.get("resource_arn"))),
        )
        exceptions = sorted(
            excs_by_domain.get(key, {}).values(),
            key=lambda f: str(f.get("resource_arn")),
        )
        workspace_scope = key == "secure_sdlc" and all(
            c.startswith(("github.", "gitlab.")) for c in checks
        )

        verified = [CHECK_VERIFIED_PHRASES[c] for c in passing if c in CHECK_VERIFIED_PHRASES]

        tags = [
            _framework_tag(framework, c)
            for c in sorted(controls_by_domain.get(key) or set())
            if c
        ]
        tags += _cross_framework_tags(domain_def, framework)

        appendix_rows = [
            {
                "resource_arn": f.get("resource_arn") or "-",
                "check_id": f.get("check_id") or "-",
                "title": f.get("title") or "-",
                "severity": f.get("severity") or "-",
                "disposition": "Documented exception" if f.get("exception") or str(f.get("status")) == "excepted" else "Open gap",
                "first_seen": str(f.get("first_seen") or "")[:10],
                "exception_reason": (f.get("exception") or {}).get("reason"),
            }
            for f in (gaps + exceptions)[:_MAX_APPENDIX_ROWS]
        ]

        sections.append(
            DomainSection(
                key=key,
                label=domain_def["label"],
                assertion=_assertion_text(
                    domain_def,
                    checks_total=len(checks),
                    checks_passing=len(passing),
                    verified_phrases=verified,
                    gap_findings=gaps,
                    exception_findings=exceptions,
                    account_scope=account_scope,
                    as_of=generated_at,
                    workspace_scope=workspace_scope,
                ),
                coverage_line=_coverage_line(
                    checks_total=len(checks),
                    checks_passing=len(passing),
                    gap_findings=gaps,
                    exception_findings=exceptions,
                    account_scope=account_scope,
                    workspace_scope=workspace_scope,
                ),
                control_tags=tags,
                exceptions=exceptions,
                gaps=gaps,
                appendix_rows=appendix_rows,
                checks_total=len(checks),
                checks_passing=len(passing),
                scope_note=(
                    " ".join(
                        note
                        for note in (
                            (
                                "Workspace-level source-control evidence (GitHub/GitLab) — not scoped to this cloud account."
                                if workspace_scope
                                else None
                            ),
                            DOMAIN_BOUNDARY_NOTES.get(key),
                        )
                        if note
                    )
                    or None
                ),
                verified_phrases=verified,
            )
        )
    return sections


def affirmation_status(*, checks_total: int, checks_passing: int) -> str:
    """Auditor-facing status marker for a capability domain."""
    if checks_total and checks_passing == checks_total:
        return "supported"
    if checks_passing:
        return "partially_supported"
    return "not_affirmed"


def domain_section_as_dict(
    section: DomainSection,
    *,
    temporal_sentence: str | None = None,
    named_sources: list[str] | None = None,
    check_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Structured JSON for the Audit readiness page and API (shared with PDF builder)."""
    gaps = [
        {
            "id": g.get("id"),
            "check_id": g.get("check_id"),
            "resource_arn": g.get("resource_arn"),
            "title": g.get("title"),
            "severity": g.get("severity"),
        }
        for g in section.gaps
    ]
    exceptions = [
        {
            "id": e.get("id"),
            "check_id": e.get("check_id"),
            "resource_arn": e.get("resource_arn"),
            "title": e.get("title"),
            "narrative": exception_narrative(e),
        }
        for e in section.exceptions
    ]
    evidence_refs = [g["id"] for g in gaps if g.get("id")]
    evidence_refs += [e["id"] for e in exceptions if e.get("id")]
    return {
        "key": section.key,
        "label": section.label,
        "status": affirmation_status(
            checks_total=section.checks_total,
            checks_passing=section.checks_passing,
        ),
        "assertion_text": section.assertion,
        "coverage_line": section.coverage_line,
        "verified_phrases": list(section.verified_phrases),
        "gaps": gaps,
        "exceptions": exceptions,
        "control_tags": list(section.control_tags),
        "evidence_refs": evidence_refs,
        "checks_total": section.checks_total,
        "checks_passing": section.checks_passing,
        "scope_note": section.scope_note,
        "temporal_sentence": temporal_sentence,
        "named_sources": named_sources or [],
        "check_ids": check_ids or [],
    }


def exception_narrative(finding: dict[str, Any]) -> str:
    """One-line documented-deviation narrative with the recorded reason."""
    exc = finding.get("exception") or {}
    reason = exc.get("reason") or "No reason recorded"
    approver = exc.get("approved_by") or "unknown approver"
    expires = exc.get("expires_at")
    expiry = f", expires {str(expires)[:10]}" if expires else ""
    title = finding.get("title") or finding.get("check_id") or "Finding"
    return f"{title} — risk accepted by {approver}{expiry}. Reason: {reason}"
