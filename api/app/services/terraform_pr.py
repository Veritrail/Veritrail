"""Repo-aware Terraform PR flow (hclpatch scan/patch + terraform validate).

Supports both GitHub and GitLab providers. The provider type is auto-detected from
the connected integration for the org — GitHub and GitLab use different APIs for
repo fetching, branch creation, and PR/MR opening.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select, or_
from sqlalchemy.orm import Session

from app.models import Finding
from app.models.github import IdentityProvider
from app.services.github_iac_pr import create_terraform_pr
from app.services.github_repo_tf import fetch_terraform_files as fetch_github_tf
from app.services.gitlab_iac_pr import create_terraform_mr
from app.services.gitlab_repo_tf import fetch_terraform_files as fetch_gitlab_tf
from app.services.hcl_patch import hcl_patch_preview, hcl_repo_scan
from app.services.iac_snippets import _TERRAFORM_SNIPPET_CHECKS
from app.services.terraform_fmt_validate import terraform_fmt_validate

# Checks we can open PRs for (declarative patch supported by hclpatch).
PR_PATCH_CHECKS = frozenset(
    {
        # Existing
        "s3.bucket.public_access_not_blocked",
        "kms.key.no_rotation",
        # Phase 1A — easy attribute toggles
        "rds.instance.no_storage_encryption",
        "rds.instance.publicly_accessible",
        "sns.topic.no_encryption",
        "sqs.queue.no_encryption",
        "guardduty.detector.disabled",
        "ec2.ebs.encryption_not_default",
        "iam.account.password_policy_weak",
        "ecr.repository.image_scan_disabled",
        # Phase 1B — block insertions
        "s3.bucket.default_encryption_disabled",
        "cloudtrail.trail.not_enabled",
        "elb.access_logs_disabled",
        # Phase 2 — complex (partial support)
        "s3.bucket.no_https_policy",
        "lambda.function.env_vars_unencrypted",
        "ec2.vpc.no_flow_logs",
        "kms.key.policy_wildcard_principal",
    }
)

# Providers that support IaC PR/MR automation
_IAC_SUPPORTED_PROVIDERS = frozenset({"github", "gitlab"})


def _connected_iac_provider(db: Session, org_id: str) -> IdentityProvider | None:
    """Return the first connected iac-compatible identity provider for the org.

    Prefers GitHub when both exist (GitHub is the original/primary IaC provider).
    """
    providers = db.scalars(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type.in_(_IAC_SUPPORTED_PROVIDERS),
            IdentityProvider.status == "connected",
        ).order_by(IdentityProvider.type)  # github comes before gitlab alphabetically
    ).all()
    return providers[0] if providers else None


def _extract_arn_component(resource_arn: str, prefix: str, *, idx: int = -1) -> str | None:
    """Extract a component from a resource ARN by removing a prefix."""
    if not resource_arn:
        return None
    if prefix in resource_arn:
        parts = resource_arn.split(prefix)
        if len(parts) > 1:
            return parts[1].split("/")[0] if idx == -1 else parts[1].rsplit(":", 3)[-1]
    return None


def _evidence_targets(finding: Finding) -> dict[str, str | None]:
    ev = finding.evidence or {}
    arn = finding.resource_arn or ""

    # S3
    bucket_name = ev.get("bucket_name") or ev.get("bucket")
    if not bucket_name and arn.startswith("arn:aws:s3:::"):
        bucket_name = arn.split(":::")[-1].split("/")[0]

    # KMS
    key_id = ev.get("key_id")
    if not key_id and ":key/" in arn:
        key_id = arn.split("/")[-1]

    # RDS
    instance_id = ev.get("db_instance_identifier")
    if not instance_id and ":rds:" in arn:
        instance_id = arn.rsplit(":", 3)[-1]

    # SNS
    topic_name = ev.get("topic_name")
    if not topic_name and ":sns:" in arn:
        topic_name = arn.rsplit(":", 1)[-1]

    # SQS
    queue_name = ev.get("queue_name")
    if not queue_name and ":sqs:" in arn:
        queue_name = arn.rsplit(":", 1)[-1]

    # ECR
    repo_name = ev.get("repository_name") or ev.get("repositoryName")
    if not repo_name and ":repository/" in arn:
        repo_name = arn.split(":repository/")[-1].split("/")[0]

    # Lambda
    function_name = ev.get("function_name") or ev.get("functionName")
    if not function_name and ":function:" in arn:
        function_name = arn.split(":function:")[-1].split(":")[0]

    # ELB
    lb_name = ev.get("load_balancer_name") or ev.get("loadBalancerName") or ev.get("name")
    if not lb_name and ":loadbalancer/" in arn:
        lb_name = arn.split(":loadbalancer/")[-1].split("/")[0]

    # VPC
    vpc_id = ev.get("vpc_id") or ev.get("vpcId")
    if not vpc_id and ":vpc/" in arn:
        vpc_id = arn.split(":vpc/")[-1]

    return {
        "bucket_name": bucket_name,
        "key_id": key_id,
        "group_id": ev.get("group_id") or ev.get("groupId"),
        "group_name": ev.get("group_name") or ev.get("groupName"),
        "instance_id": instance_id,
        "topic_name": topic_name,
        "queue_name": queue_name,
        "repo_name": repo_name,
        "vpc_id": vpc_id,
        "function_name": function_name,
        "lb_name": lb_name,
    }


def _fetch_tf_files(
    provider: IdentityProvider,
    db: Session,
    repo_full_name: str,
    ref: str | None = None,
) -> list[dict[str, str]]:
    """Fetch Terraform/HCL files from a connected repo for any supported provider."""
    if provider.type == "gitlab":
        return fetch_gitlab_tf(provider, db, repo_full_name, ref=ref)
    # Default: GitHub
    return fetch_github_tf(provider, repo_full_name, ref=ref)


def scan_repo_for_finding(
    db: Session,
    *,
    finding: Finding,
    org_id,
    repo_full_name: str,
    base_branch: str | None,
    provider_type: str | None = None,
) -> dict[str, Any]:
    """Scan a connected repo for Terraform resources matching a finding.

    Supports both GitHub and GitLab. If provider_type is specified, only that
    provider type is checked; otherwise the first connected provider is used.
    """
    if provider_type and provider_type not in _IAC_SUPPORTED_PROVIDERS:
        raise ValueError(f"IaC scan not supported for provider type: {provider_type}")

    provider_filter = (
        IdentityProvider.type == provider_type
        if provider_type
        else IdentityProvider.type.in_(_IAC_SUPPORTED_PROVIDERS)
    )
    provider = db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            provider_filter,
            IdentityProvider.status == "connected",
        )
    )
    if not provider:
        label = provider_type if provider_type else "a Git provider"
        raise ValueError(f"Connect {label} in Integrations to scan repositories")

    files = _fetch_tf_files(provider, db, repo_full_name, ref=base_branch)
    if not files:
        return {
            "status": "empty",
            "message": "No .tf or .hcl files found in repository",
            "files_scanned": 0,
        }

    t = _evidence_targets(finding)
    scan = hcl_repo_scan(
        check_id=finding.check_id,
        files=files,
        **t,
    )
    scan["repo"] = repo_full_name
    scan["provider_type"] = provider.type
    scan["can_open_pr"] = finding.check_id in PR_PATCH_CHECKS and scan.get("can_patch", False)
    return scan


def build_terraform_pr(
    db: Session,
    *,
    finding: Finding,
    org_id,
    repo_full_name: str,
    file_path: str,
    base_branch: str | None,
    provider_type: str | None = None,
) -> dict[str, Any]:
    """Open a Terraform remediation PR/MR on the connected Git provider.

    Auto-detects the provider type from the connected integration. Supports:
    - GitHub: opens a Pull Request via github_iac_pr.create_terraform_pr()
    - GitLab: opens a Merge Request via gitlab_iac_pr.create_terraform_mr()

    If provider_type is explicit, only that provider is used; otherwise the first
    connected GitHub or GitLab provider is auto-selected (GitHub preferred).
    """
    if finding.check_id not in _TERRAFORM_SNIPPET_CHECKS:
        raise ValueError(f"Terraform PR not supported for check {finding.check_id}")
    if finding.check_id not in PR_PATCH_CHECKS:
        scan = scan_repo_for_finding(
            db, finding=finding, org_id=org_id,
            repo_full_name=repo_full_name, base_branch=base_branch,
            provider_type=provider_type,
        )
        raise ValueError(
            scan.get("message")
            or "Repo match may exist but automatic patch is not supported — use SSM Automation or edit Terraform manually."
        )

    # Resolve provider — explicit type or auto-detect
    provider = None
    if provider_type:
        provider = db.scalar(
            select(IdentityProvider).where(
                IdentityProvider.org_id == org_id,
                IdentityProvider.type == provider_type,
                IdentityProvider.status == "connected",
            )
        )
        if not provider:
            raise ValueError(
                f"Connect {provider_type.capitalize() if provider_type else 'a Git provider'} "
                f"in Integrations to open Terraform {'MRs' if provider_type == 'gitlab' else 'PRs'}"
            )
    else:
        provider = _connected_iac_provider(db, org_id)
        if not provider:
            raise ValueError(
                "Connect GitHub or GitLab in Integrations to open Terraform PRs/MRs"
            )

    files = _fetch_tf_files(provider, db, repo_full_name, ref=base_branch)
    if not files:
        raise ValueError("No .tf/.hcl files found in repository — cannot match resources")

    t = _evidence_targets(finding)
    preview = hcl_patch_preview(
        check_id=finding.check_id,
        files=files,
        **t,
    )
    if preview.get("status") in ("unsupported", "not_found", "error", "repo_context_required"):
        raise ValueError(preview.get("message") or f"Cannot patch: {preview.get('status')}")

    target_path = preview.get("file_path") or file_path
    patched = preview.get("patched_content")
    if not patched:
        raise ValueError("No patched content produced — ambiguous repo match")

    patched_files = []
    replaced = False
    for f in files:
        if f["path"] == target_path:
            patched_files.append({"path": target_path, "content": patched})
            replaced = True
        else:
            patched_files.append(f)
    if not replaced:
        patched_files.append({"path": target_path, "content": patched})

    validation = terraform_fmt_validate(patched_files)
    if not validation.get("ok"):
        raise ValueError(
            f"terraform {validation.get('step', 'validate')} failed: {validation.get('error', '')[:500]}"
        )

    title = f"Veritrail: remediate {finding.check_id}"
    mr_or_pr = "Merge request" if provider.type == "gitlab" else "PR"
    body = (
        f"Automated Terraform remediation for finding `{finding.title}`.\n\n"
        f"- Check: `{finding.check_id}`\n"
        f"- Resource: `{finding.resource_arn}`\n"
        f"- Action: {preview.get('action', 'patch')}\n"
    )
    if preview.get("matches"):
        body += f"- Matched {len(preview['matches'])} resource block(s) in repo\n"
    body += f"\nGenerated by Veritrail (hclpatch + terraform validate). Review before merge.\n"
    body += f"Provider: {provider.type}"

    if provider.type == "gitlab":
        result = create_terraform_mr(
            provider,
            db,
            repo_full_name=repo_full_name,
            title=title,
            body=body,
            terraform_hcl=patched,
            file_path=target_path,
            base_branch=base_branch,
        )
    else:
        result = create_terraform_pr(
            provider,
            repo_full_name=repo_full_name,
            title=title,
            body=body,
            terraform_hcl=patched,
            file_path=target_path,
            base_branch=base_branch,
        )

    return {
        **result,
        "provider_type": provider.type,
        "preview": preview,
        "validation": validation,
    }
