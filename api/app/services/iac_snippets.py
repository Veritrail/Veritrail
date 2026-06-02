"""Deterministic IaC / CLI snippets per finding (Phase 1 — no repo PR)."""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.data.remediation_modules import REMEDIATION_MODULE_BY_ID, remediation_module_for_check
from app.models import AwsAccount, Finding
from app.models.github import IdentityProvider, Repo
from app.services.remediation_plan import _supported_action
from app.services.ssm_remediation_catalog import (
    runbook_for_check,
    runbook_payload,
    runbook_source_url,
)

IAC_NOT_AVAILABLE = "iac_not_available"
IAC_SNIPPETS = "iac_snippets"
IAC_AUTOMATION_ONLY = "automation_only"

SG_CHECKS = frozenset(
    {
        "ec2.security_group.unrestricted_ssh",
        "ec2.security_group.unrestricted_rdp",
    }
)

AUTOMATION_CHECKS = frozenset(
    {
        *SG_CHECKS,
        "ssm.parameter.plaintext_secret",
        "iam.access_key.unused_45d",
        "iam.access_key.unused_90d",
        "s3.bucket.public_access_not_blocked",
        "iam.role.full_admin_policy",
        "iam.policy.wildcard_resource",
        "cloudtrail.trail.not_enabled",
    }
)


def build_iac_remediation(db: Session, finding: Finding, org_id: uuid.UUID) -> dict[str, Any]:
    """Return terraform, cloudformation, and cli snippets for a finding."""
    cid = finding.check_id
    ev = finding.evidence or {}
    builder = _BUILDERS.get(cid, _generic)
    body = builder(finding, ev)
    body["check_id"] = cid
    body["finding_id"] = str(finding.id)
    body["resource_arn"] = finding.resource_arn
    body["phase"] = "snippets"
    github = _github_context(db, org_id)
    has_tf = bool(body.get("terraform"))
    body["pr_automation"] = {
        "available": False,
        "github_connected": github["github_connected"],
        "gitlab_connected": github["gitlab_connected"],
        "providers": github["providers"],
        "repos": github["repos"],
        "note": (
            "Version-control PR automation is paused until repo-aware HCL patching ships. "
            "Use declarative Terraform (S3/KMS) or SSM Automation for live changes."
        ),
    }
    from app.services.terraform_pr import PR_PATCH_CHECKS

    pr_ok = github["github_connected"] and cid in PR_PATCH_CHECKS
    body["apply_paths"] = {
        "terraform_pr": pr_ok,
        "terraform_generic": has_tf,
        "customer_automation": cid in AUTOMATION_CHECKS,
    }
    if pr_ok:
        body["pr_automation"]["available"] = True
        body["pr_automation"]["note"] = (
            "Opens a PR with hclpatch + terraform validate when you pick a connected repo."
        )
    ssm = _ssm_remediation_panel(db, finding)
    if ssm:
        body["ssm_remediation"] = ssm
    return body


_ACTION_LABELS: dict[str, str] = {
    "deactivate_access_key": "Disable access key",
    "revoke_public_ingress": "Revoke public ingress",
    "put_public_access_block": "Block public access",
    "migrate_ssm_string_to_secure_string": "Migrate parameter to SecureString",
    "detach_full_admin": "Detach full admin policies",
    "replace_wildcard_inline": "Replace wildcard inline policy",
}


def _ssm_remediation_panel(db: Session, finding: Finding) -> dict[str, Any] | None:
    cid = finding.check_id
    if cid not in AUTOMATION_CHECKS:
        return None
    module_id = remediation_module_for_check(cid)
    if not module_id:
        return None
    spec = REMEDIATION_MODULE_BY_ID[module_id]
    acc = db.get(AwsAccount, finding.account_id)
    enabled = deployed = False
    if acc:
        enabled = bool(getattr(acc, spec.enable_column))
        deployed = bool(getattr(acc, spec.deployed_column))
    action = _supported_action(cid)
    runbook = runbook_for_check(cid)
    from app.data.aws_owned_runbooks import remediation_automation_metadata
    from app.services.remediation_plan import automation_region_for_finding, resource_region_for_finding

    settings = get_settings()
    resource_region = resource_region_for_finding(finding)
    automation_region = automation_region_for_finding(finding)
    automation_meta = remediation_automation_metadata(
        cid, evidence=finding.evidence or {}
    )
    if runbook and runbook.owner == "aws":
        automation_meta = {
            **automation_meta,
            "automation_provider": "aws-owned",
            "aws_document_name": runbook.document_name,
            "aws_runbook_docs_url": runbook_source_url(runbook, automation_region=automation_region),
        }
    return {
        "module_id": module_id,
        "module_label": spec.label,
        "module_enabled": enabled,
        "module_deployed": deployed,
        "action": action,
        "action_label": _ACTION_LABELS.get(action or "", action or "Remediate"),
        "execution": "AWS Systems Manager Automation",
        "automation_role_name": settings.CFN_REMEDIATION_AUTOMATION_ROLE_NAME,
        "resource_region": resource_region,
        "automation_region": automation_region,
        "runbook": runbook_payload(runbook, automation_region=automation_region) if runbook else None,
        "requires_vigil_document": bool(runbook and runbook.owner == "vigil"),
        **automation_meta,
    }


def _github_context(db: Session, org_id: uuid.UUID) -> dict[str, Any]:
    """Git + GitLab connection state for IaC UI (PR flow is GitHub-only when enabled)."""
    gh = db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type == "github",
            IdentityProvider.status == "connected",
        )
    )
    gl = db.scalar(
        select(IdentityProvider).where(
            IdentityProvider.org_id == org_id,
            IdentityProvider.type == "gitlab",
            IdentityProvider.status == "connected",
        )
    )
    providers: list[str] = []
    if gh:
        providers.append("github")
    if gl:
        providers.append("gitlab")
    repos: list[dict[str, str]] = []
    if gh:
        for r in db.scalars(select(Repo).where(Repo.provider_id == gh.id).order_by(Repo.name)).all():
            repos.append({"full_name": r.name, "default_branch": r.default_branch or "main"})
    return {
        "connected": bool(gh),
        "github_connected": gh is not None,
        "gitlab_connected": gl is not None,
        "providers": providers,
        "repos": repos,
    }


# Declarative-safe TF snippet checks — expanded for all new check types.
_TERRAFORM_SNIPPET_CHECKS = frozenset(
    {
        # Existing
        "s3.bucket.public_access_not_blocked",
        "s3.bucket.no_https_policy",
        "kms.key.no_rotation",
        "kms.key.policy_wildcard_principal",
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
        # Phase 2
        "lambda.function.env_vars_unencrypted",
        "ec2.vpc.no_flow_logs",
    }
)


def _generic(finding: Finding, ev: dict) -> dict[str, Any]:
    return {
        "iac_status": IAC_NOT_AVAILABLE,
        "reason": "No IaC template for this check yet — use Console/CLI instead.",
        "terraform": None,
        "cloudformation": None,
        "cli": [],
    }


# ── Existing builders ────────────────────────────────────────────────────────


def _s3_public_access(finding: Finding, ev: dict) -> dict[str, Any]:
    bucket = ev.get("bucket_name") or _name_from_arn(finding.resource_arn)
    logical = _logical_name(bucket)
    tf = f'''resource "aws_s3_bucket_public_access_block" "{logical}" {{
  bucket = aws_s3_bucket.{logical}.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}}'''
    cfn = _cfn_s3_pab(logical, bucket)
    return {
        "iac_status": IAC_SNIPPETS,
        "terraform": tf,
        "cloudformation": cfn,
        "cli": [
            f"aws s3api put-public-access-block --bucket {bucket} "
            "--public-access-block-configuration "
            "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
        ],
        "hints": [
            f'Match bucket "{bucket}" to your `aws_s3_bucket` resource; reuse an existing `aws_s3_bucket_public_access_block` if present.',
        ],
    }


def _s3_https(finding: Finding, ev: dict) -> dict[str, Any]:
    bucket = ev.get("bucket_name") or _name_from_arn(finding.resource_arn)
    logical = _logical_name(bucket)
    tf = f'''resource "aws_s3_bucket_policy" "{logical}_https_only" {{
  bucket = aws_s3_bucket.{logical}.id
  policy = jsonencode({{
    Version = "2012-10-17"
    Statement = [{{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [
        aws_s3_bucket.{logical}.arn,
        "${{aws_s3_bucket.{logical}.arn}}/*",
      ]
      Condition = {{
        Bool = {{ "aws:SecureTransport" = "false" }}
      }}
    }}]
  }})
}}'''
    return {
        "iac_status": IAC_SNIPPETS,
        "terraform": tf,
        "cloudformation": None,
        "cli": [],
        "hints": ["Merge with any existing bucket policy statements; do not replace unrelated allows."],
    }


def _kms_rotation(finding: Finding, ev: dict) -> dict[str, Any]:
    key_id = ev.get("key_id") or finding.resource_arn.split("/")[-1]
    logical = _logical_name(ev.get("alias") or key_id)
    tf = f'''resource "aws_kms_key" "{logical}" {{
  # existing key — enable rotation in place
  enable_key_rotation = true
}}'''
    cfn = _cfn_kms_rotation(logical, key_id)
    return {
        "iac_status": IAC_SNIPPETS,
        "terraform": tf,
        "cloudformation": cfn,
        "cli": [f"aws kms enable-key-rotation --key-id {key_id}"],
        "hints": ["For imported keys, use `aws_kms_key` data source + `aws_kms_key` managed resource carefully to avoid replacement."],
    }


def _kms_wildcard(finding: Finding, ev: dict) -> dict[str, Any]:
    key_id = ev.get("key_id") or finding.resource_arn.split("/")[-1]
    return {
        "iac_status": IAC_SNIPPETS,
        "terraform": None,
        "cloudformation": None,
        "cli": [
            f"aws kms get-key-policy --key-id {key_id} --policy-name default --output text > policy.json",
            "# Edit policy.json: remove Principal \"*\" / \"AWS\": \"*\" — scope to specific roles/accounts",
            f"aws kms put-key-policy --key-id {key_id} --policy-name default --policy file://policy.json",
        ],
        "hints": ["Key policies are not fully modeled in Terraform for all layouts — review JSON manually."],
    }


def _sg_imperative_only(finding: Finding, ev: dict, *, port_label: str) -> dict[str, Any]:
    return {
        "iac_status": IAC_AUTOMATION_ONLY,
        "terraform": None,
        "cloudformation": None,
        "cli": [],
        "reason": (
            f"Revoking live security group ingress is imperative, not declarative Terraform. "
            f"Use Console or CLI above, or SSM Automation for port {port_label}."
        ),
        "hints": [
            "Terraform PRs will require a matching rule in your connected repo (not generic snippets).",
            "Use SSM Session Manager instead of open access from the internet where possible.",
        ],
    }


def _sg_rdp(finding: Finding, ev: dict) -> dict[str, Any]:
    return _sg_imperative_only(finding, ev, port_label="3389")


def _sg_ssh(finding: Finding, ev: dict) -> dict[str, Any]:
    return _sg_imperative_only(finding, ev, port_label="22")


# ── Phase 1A: Easy attribute toggle builders ─────────────────────────────────


def _rds_encryption(finding: Finding, ev: dict) -> dict[str, Any]:
    inst_id = ev.get("db_instance_identifier") or _name_from_arn(finding.resource_arn)
    logical = _logical_name(inst_id)
    tf = f'''resource "aws_db_instance" "{logical}" {{
  # Add storage_encrypted = true to encrypt RDS at rest
  storage_encrypted = true
}}'''
    return {
        "iac_status": IAC_SNIPPETS,
        "terraform": tf,
        "cloudformation": None,
        "cli": [
            f"aws rds modify-db-instance --db-instance-identifier {inst_id} --storage-encrypted",
        ],
        "hints": [
            "Add `storage_encrypted = true` to your existing `aws_db_instance` resource. If using a KMS CMK, also add `kms_key_id`.",
            "For aws_rds_cluster resources: storage_encrypted is set at the cluster level.",
        ],
    }


def _rds_public(finding: Finding, ev: dict) -> dict[str, Any]:
    inst_id = ev.get("db_instance_identifier") or _name_from_arn(finding.resource_arn)
    logical = _logical_name(inst_id)
    tf = f'''resource "aws_db_instance" "{logical}" {{
  # Set publicly_accessible = false to remove the public endpoint
  publicly_accessible = false
}}'''
    return {
        "iac_status": IAC_SNIPPETS,
        "terraform": tf,
        "cloudformation": None,
        "cli": [
            f"aws rds modify-db-instance --db-instance-identifier {inst_id} --no-publicly-accessible",
        ],
        "hints": [
            "Set `publicly_accessible = false` in your `aws_db_instance` resource.",
            "Ensure the RDS instance is deployed in private subnets with proper security groups.",
        ],
    }


def _sns_encryption(finding: Finding, ev: dict) -> dict[str, Any]:
    topic = ev.get("topic_name") or _name_from_arn(finding.resource_arn)
    logical = _logical_name(topic)
    tf = f'''resource "aws_sns_topic" "{logical}" {{
  name              = "{topic}"
  kms_master_key_id = "alias/aws/sns"
}}'''
    return {
        "iac_status": IAC_SNIPPETS,
        "terraform": tf,
        "cloudformation": None,
        "cli": [
            f"aws sns set-topic-attributes --topic-arn {finding.resource_arn} "
            "--attribute-name KmsMasterKeyId --attribute-value alias/aws/sns",
        ],
        "hints": [
            'Add `kms_master_key_id = "alias/aws/sns"` to your `aws_sns_topic` resource (AWS-managed SNS KMS key).',
            "For a custom KMS key (CMK), replace with your key ARN or alias.",
        ],
    }


def _sqs_encryption(finding: Finding, ev: dict) -> dict[str, Any]:
    queue = ev.get("queue_name") or _name_from_arn(finding.resource_arn)
    logical = _logical_name(queue)
    tf = f'''resource "aws_sqs_queue" "{logical}" {{
  name                      = "{queue}"
  sqs_managed_sse_enabled   = true
}}'''
    return {
        "iac_status": IAC_SNIPPETS,
        "terraform": tf,
        "cloudformation": None,
        "cli": [
            f"aws sqs set-queue-attributes --queue-url <queue-url> "
            "--attributes SqsManagedSseEnabled=true",
        ],
        "hints": [
            "Add `sqs_managed_sse_enabled = true` (AWS provider >= 5.x) or `kms_master_key_id = \"alias/aws/sqs\"` to your `aws_sqs_queue` resource.",
        ],
    }


def _guardduty_enable(finding: Finding, ev: dict) -> dict[str, Any]:
    tf = '''resource "aws_guardduty_detector" "this" {
  enable                       = true
  finding_publishing_frequency = "SIX_HOURS"
}'''
    return {
        "iac_status": IAC_SNIPPETS,
        "terraform": tf,
        "cloudformation": None,
        "cli": [
            f"aws guardduty create-detector --enable --finding-publishing-frequency SIX_HOURS "
            f"--region {ev.get('region', 'us-east-1')}",
        ],
        "hints": [
            "GuardDuty is a per-region service. Add `aws_guardduty_detector` per region or use a provider alias loop.",
            "GuardDuty auto-creates a service-linked role — no IAM configuration needed.",
        ],
    }


def _ebs_default_encryption(finding: Finding, ev: dict) -> dict[str, Any]:
    region = ev.get("region", "us-east-1")
    tf = '''resource "aws_ebs_encryption_by_default" "this" {
  enabled = true
}'''
    return {
        "iac_status": IAC_SNIPPETS,
        "terraform": tf,
        "cloudformation": None,
        "cli": [
            f"aws ec2 enable-ebs-encryption-by-default --region {region}",
        ],
        "hints": [
            "This is an account-level regional setting. Add `aws_ebs_encryption_by_default` once per region.",
            "Only one `aws_ebs_encryption_by_default` resource can exist per account+region.",
        ],
    }


def _password_policy(finding: Finding, ev: dict) -> dict[str, Any]:
    tf = '''resource "aws_iam_account_password_policy" "strict" {
  minimum_password_length        = 14
  require_lowercase_characters   = true
  require_uppercase_characters   = true
  require_numbers                = true
  require_symbols                = true
  allow_users_to_change_password = true
  max_password_age               = 90
  password_reuse_prevention      = 24
}'''
    return {
        "iac_status": IAC_SNIPPETS,
        "terraform": tf,
        "cloudformation": None,
        "cli": [
            "aws iam update-account-password-policy --minimum-password-length 14 "
            "--require-lowercase-characters --require-uppercase-characters "
            "--require-numbers --require-symbols --allow-users-to-change-password "
            "--max-password-age 90 --password-reuse-prevention 24",
        ],
        "hints": [
            "This is an account-level singleton. Only one `aws_iam_account_password_policy` can exist.",
        ],
    }


def _ecr_scanning(finding: Finding, ev: dict) -> dict[str, Any]:
    repo = ev.get("repository_name") or _name_from_arn(finding.resource_arn)
    logical = _logical_name(repo)
    tf = f'''resource "aws_ecr_repository" "{logical}" {{
  name = "{repo}"

  image_scanning_configuration {{
    scan_on_push = true
  }}
}}'''
    return {
        "iac_status": IAC_SNIPPETS,
        "terraform": tf,
        "cloudformation": None,
        "cli": [
            f"aws ecr put-image-scanning-configuration --repository-name {repo} "
            "--image-scanning-configuration scanOnPush=true",
        ],
        "hints": [
            "Add `image_scanning_configuration { scan_on_push = true }` to your `aws_ecr_repository` resource.",
            "Enable enhanced scanning with Amazon Inspector for continuous vulnerability scanning.",
        ],
    }


# ── Phase 1B: Block insertion builders ───────────────────────────────────────


def _s3_sse(finding: Finding, ev: dict) -> dict[str, Any]:
    bucket = ev.get("bucket_name") or _name_from_arn(finding.resource_arn)
    logical = _logical_name(bucket)
    tf = f'''resource "aws_s3_bucket_server_side_encryption_configuration" "{logical}" {{
  bucket = aws_s3_bucket.{logical}.id

  rule {{
    apply_server_side_encryption_by_default {{
      sse_algorithm = "AES256"
    }}
  }}
}}'''
    return {
        "iac_status": IAC_SNIPPETS,
        "terraform": tf,
        "cloudformation": None,
        "cli": [
            f"aws s3api put-bucket-encryption --bucket {bucket} "
            "--server-side-encryption-configuration "
            '\'{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}\'',
        ],
        "hints": [
            "Default to AES256 (SSE-S3) for simplicity. Use aws:kms for additional key control.",
            "Add alongside your `aws_s3_bucket` resource — the SSE config is a separate resource.",
        ],
    }


def _cloudtrail_enable(finding: Finding, ev: dict) -> dict[str, Any]:
    tf = '''resource "aws_s3_bucket" "cloudtrail_logs" {
  bucket        = "${var.aws_account_id}-cloudtrail-logs"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "cloudtrail_logs" {
  bucket                  = aws_s3_bucket.cloudtrail_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AWSCloudTrailAclCheck"
        Effect    = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action    = "s3:GetBucketAcl"
        Resource  = aws_s3_bucket.cloudtrail_logs.arn
      },
      {
        Sid       = "AWSCloudTrailWrite"
        Effect    = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.cloudtrail_logs.arn}/*"
        Condition = {
          StringEquals = { "s3:x-amz-acl" = "bucket-owner-full-control" }
        }
      }
    ]
  })
}

resource "aws_cloudtrail" "this" {
  name                          = "vigil-multi-region-trail"
  s3_bucket_name                = aws_s3_bucket.cloudtrail_logs.id
  enable_logging                = true
  enable_log_file_validation    = true
  is_multi_region_trail         = true
  include_global_service_events = true
}'''
    return {
        "iac_status": IAC_SNIPPETS,
        "terraform": tf,
        "cloudformation": None,
        "cli": [
            "# Create an S3 bucket for CloudTrail logs first, then:",
            f"aws cloudtrail create-trail --name vigil-multi-region-trail "
            f"--s3-bucket-name <bucket> --is-multi-region-trail "
            f"--enable-log-file-validation --include-global-service-events",
            "aws cloudtrail start-logging --name vigil-multi-region-trail",
        ],
        "hints": [
            "The S3 bucket name must be globally unique — replace ${var.aws_account_id} with your actual account ID.",
            "Attach an S3 bucket policy granting CloudTrail write access to the logs bucket.",
        ],
    }


def _elb_logs(finding: Finding, ev: dict) -> dict[str, Any]:
    lb = ev.get("load_balancer_name") or _name_from_arn(finding.resource_arn)
    logical = _logical_name(lb)
    tf = f'''resource "aws_lb" "{logical}" {{
  # ... existing configuration ...

  access_logs {{
    enabled = true
    bucket  = aws_s3_bucket.lb_logs.bucket
  }}
}}'''
    return {
        "iac_status": IAC_SNIPPETS,
        "terraform": tf,
        "cloudformation": None,
        "cli": [
            f"aws elbv2 modify-load-balancer-attributes --load-balancer-arn {finding.resource_arn} "
            "--attributes Key=access_logs.s3.enabled,Value=true "
            "Key=access_logs.s3.bucket,Value=<log-bucket-name>",
        ],
        "hints": [
            "Add an `access_logs {{ enabled = true; bucket = ... }}` block to your `aws_lb` or `aws_elb` resource.",
            "The S3 bucket for access logs needs a policy granting the ELB service write access (s3:PutObject).",
            'Bucket ARN format: `arn:aws:s3:::bucket-name/prefix/AWSLogs/your-account-id/*`',
        ],
    }


# ── Phase 2: Complex builders ────────────────────────────────────────────────


def _lambda_env_encryption(finding: Finding, ev: dict) -> dict[str, Any]:
    func = ev.get("function_name") or _name_from_arn(finding.resource_arn)
    logical = _logical_name(func)
    tf = f'''resource "aws_kms_key" "lambda_env" {{
  description             = "KMS key for Lambda environment variable encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true
}}

resource "aws_lambda_function" "{logical}" {{
  # ... existing configuration ...

  environment {{
    # ... existing variables ...
    variables = {{}}

    kms_key_arn = aws_kms_key.lambda_env.arn
  }}
}}'''
    return {
        "iac_status": IAC_SNIPPETS,
        "terraform": tf,
        "cloudformation": None,
        "cli": [
            f"aws lambda update-function-configuration --function-name {func} "
            "--kms-key-arn <kms-key-arn>",
        ],
        "hints": [
            "Create a KMS key with Lambda service principal access, then add `kms_key_arn` to the `environment` block.",
            "The KMS key policy must grant `kms:Decrypt` to the Lambda execution role.",
        ],
    }


def _vpc_flow_logs(finding: Finding, ev: dict) -> dict[str, Any]:
    vpc = ev.get("vpc_id") or _name_from_arn(finding.resource_arn)
    logical = _logical_name(vpc)
    tf = f'''resource "aws_cloudwatch_log_group" "vpc_flow_logs" {{
  name              = "/aws/vpc/{logical}/flow-logs"
  retention_in_days = 30
}}

resource "aws_iam_role" "flow_logs" {{
  name = "vpc-flow-logs-role"
  assume_role_policy = jsonencode({{
    Version = "2012-10-17"
    Statement = [{{
      Effect    = "Allow"
      Principal = {{ Service = "vpc-flow-logs.amazonaws.com" }}
      Action    = "sts:AssumeRole"
    }}]
  }})
}}

resource "aws_iam_role_policy" "flow_logs" {{
  role = aws_iam_role.flow_logs.id
  policy = jsonencode({{
    Version = "2012-10-17"
    Statement = [{{
      Effect = "Allow"
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
      ]
      Resource = "*"
    }}]
  }})
}}

resource "aws_flow_log" "{logical}" {{
  vpc_id               = aws_vpc.{logical}.id
  traffic_type         = "ALL"
  log_destination_type = "cloud-watch-logs"
  log_destination      = aws_cloudwatch_log_group.{logical}.arn
  iam_role_arn         = aws_iam_role.flow_logs.arn
}}'''
    return {
        "iac_status": IAC_SNIPPETS,
        "terraform": tf,
        "cloudformation": None,
        "cli": [
            f"aws ec2 create-flow-logs --resource-type VPC --resource-ids {vpc} "
            "--traffic-type ALL --log-destination-type cloud-watch-logs "
            "--log-group-name /aws/vpc/flow-logs --deliver-logs-permission-arn <iam-role-arn>",
        ],
        "hints": [
            "Flow logs require an IAM role with permissions to write to CloudWatch Logs.",
            "Use S3 destination for long-term storage and Athena querying; CloudWatch for real-time analysis.",
        ],
    }


_BUILDERS = {
    # Existing
    "s3.bucket.public_access_not_blocked": _s3_public_access,
    "s3.bucket.no_https_policy": _s3_https,
    "kms.key.no_rotation": _kms_rotation,
    "kms.key.policy_wildcard_principal": _kms_wildcard,
    "ec2.security_group.unrestricted_ssh": _sg_ssh,
    "ec2.security_group.unrestricted_rdp": _sg_rdp,
    # Phase 1A — easy attribute toggles
    "rds.instance.no_storage_encryption": _rds_encryption,
    "rds.instance.publicly_accessible": _rds_public,
    "sns.topic.no_encryption": _sns_encryption,
    "sqs.queue.no_encryption": _sqs_encryption,
    "guardduty.detector.disabled": _guardduty_enable,
    "ec2.ebs.encryption_not_default": _ebs_default_encryption,
    "iam.account.password_policy_weak": _password_policy,
    "ecr.repository.image_scan_disabled": _ecr_scanning,
    # Phase 1B — block insertions
    "s3.bucket.default_encryption_disabled": _s3_sse,
    "cloudtrail.trail.not_enabled": _cloudtrail_enable,
    "elb.access_logs_disabled": _elb_logs,
    # Phase 2 — complex
    "lambda.function.env_vars_unencrypted": _lambda_env_encryption,
    "ec2.vpc.no_flow_logs": _vpc_flow_logs,
}


def _name_from_arn(arn: str | None) -> str:
    if not arn:
        return "resource"
    if arn.startswith("arn:aws:s3:::"):
        return arn.split(":::")[-1].split("/")[0]
    return arn.rsplit("/", 1)[-1]


def _logical_name(raw: str) -> str:
    out = "".join(c if c.isalnum() else "_" for c in raw)
    if out and out[0].isdigit():
        out = f"r_{out}"
    return out or "resource"


# ── CloudFormation snippet helpers ───────────────────────────────────────────


def _cfn_s3_pab(logical: str, bucket: str) -> str:
    """CloudFormation YAML snippet for S3 Public Access Block."""
    return f"""{logical}PublicAccessBlock:
  Type: AWS::S3::BucketPolicy
  Properties:
    Bucket: !Ref {logical}Bucket
    PolicyDocument:
      Version: "2012-10-17"
      Statement:
        - Sid: PublicAccessBlock
          Effect: Deny
          Principal: "*"
          Action: "s3:*"
          Resource:
            - !Sub "arn:aws:s3:::${{{logical}Bucket}}/*"
            - !Sub "arn:aws:s3:::${{{logical}Bucket}}"
          Condition:
            Bool:
              "s3:x-amz-public-access-block": false
"""


def _cfn_kms_rotation(logical: str, key_id: str) -> str:
    """CloudFormation YAML snippet for KMS key rotation.

    Note: CloudFormation cannot retroactively enable rotation on an existing
    KMS key that was created outside the stack. For existing keys, use the
    AWS CLI or Console.
    """
    return f"""{logical}Key:
  Type: AWS::KMS::Key
  Properties:
    EnableKeyRotation: true
    KeyPolicy:
      Version: "2012-10-17"
      Id: key-default-1
      Statement:
        - Sid: EnableIAMUserPermissions
          Effect: Allow
          Principal:
            AWS: !Sub "arn:aws:iam::${{AWS::AccountId}}:root"
          Action: "kms:*"
          Resource: "*"
# Note: For existing keys ({key_id}), CloudFormation cannot
# enable rotation on keys it did not create. Use CLI instead:
# aws kms enable-key-rotation --key-id {key_id}
"""
