/** Synthetic finding list groups — resources keep per-check type pills when expanded. */

export const ACTIVITY_DETECTIONS_GROUP = "activity_detections";

export const ENCRYPTION_AT_REST_GROUP = "encryption";
export const ENCRYPTION_IN_TRANSIT_GROUP = "encryption_in_transit";
export const REMOTE_ACCESS_GROUP = "remote_access";
export const LEAST_PRIVILEGE_GROUP = "least_privilege";

export type FindingGroupMeta = {
  title: string;
  searchTerms?: string[];
};

export const ENCRYPTION_IN_TRANSIT_CHECK_IDS = new Set([
  "s3.bucket.no_https_policy",
  "elb.load_balancer.weak_tls_policy",
]);

export const ENCRYPTION_AT_REST_CHECK_IDS = new Set([
  "s3.bucket.no_kms",
  "s3.bucket.no_default_encryption",
  "s3.bucket.no_encryption",
  "cloudtrail.trail.no_kms",
  "dynamodb.table.no_encryption",
  "sns.topic.no_encryption",
  "sqs.queue.no_encryption",
  "ec2.ebs.encryption_not_default",
  "ec2.ebs.volume_unencrypted",
  "ec2.ebs.snapshot_unencrypted",
  "rds.instance.no_encryption",
  "eks.cluster.secrets_encryption_disabled",
]);

export const REMOTE_ACCESS_CHECK_IDS = new Set([
  "ec2.security_group.unrestricted_ssh",
  "ec2.security_group.unrestricted_rdp",
]);

export const LEAST_PRIVILEGE_CHECK_IDS = new Set([
  "iam.role.least_privilege_policy",
  "iam.policy.wildcard_resource",
  "iam.user.admin_policy_attached",
]);

const CHECK_ID_TO_GROUP = new Map<string, string>();
for (const id of ENCRYPTION_IN_TRANSIT_CHECK_IDS) CHECK_ID_TO_GROUP.set(id, ENCRYPTION_IN_TRANSIT_GROUP);
for (const id of ENCRYPTION_AT_REST_CHECK_IDS) CHECK_ID_TO_GROUP.set(id, ENCRYPTION_AT_REST_GROUP);
for (const id of REMOTE_ACCESS_CHECK_IDS) CHECK_ID_TO_GROUP.set(id, REMOTE_ACCESS_GROUP);
for (const id of LEAST_PRIVILEGE_CHECK_IDS) CHECK_ID_TO_GROUP.set(id, LEAST_PRIVILEGE_GROUP);

export const FINDING_GROUP_META: Record<string, FindingGroupMeta> = {
  [ACTIVITY_DETECTIONS_GROUP]: {
    title: "Activity detections",
    searchTerms: ["cloudtrail", "activity", "detection", "api event", "tampering"],
  },
  [ENCRYPTION_AT_REST_GROUP]: {
    title: "Data encryption at rest not enforced",
    searchTerms: ["encryption", "sse-kms", "kms", "at rest"],
  },
  [ENCRYPTION_IN_TRANSIT_GROUP]: {
    title: "Data encryption in transit not enforced",
    searchTerms: ["https", "tls", "ssl", "secure transport", "in transit", "encryption"],
  },
  [REMOTE_ACCESS_GROUP]: {
    title: "Unrestricted remote access",
    searchTerms: ["ssh", "rdp", "security group", "remote access", "port 22", "port 3389"],
  },
  [LEAST_PRIVILEGE_GROUP]: {
    title: "Least privilege policy violation",
    searchTerms: ["wildcard", "full admin", "administrator", "least privilege", "overprivileged"],
  },
};

/** Remaining consolidation groups — same shape, registered below. */
const ADDITIONAL_GROUPS: { key: string; title: string; checkIds: string[]; searchTerms: string[] }[] = [
  {
    key: "security_services",
    title: "Security service not enabled",
    checkIds: [
      "guardduty.detector.not_enabled",
      "aws.config.not_enabled",
      "aws.securityhub.not_enabled",
      "aws.access_analyzer.not_enabled",
      "aws.vulnerability_monitoring.not_detected",
    ],
    searchTerms: ["guardduty", "config", "security hub", "access analyzer", "inspector", "detector", "not enabled"],
  },
  {
    key: "public_snapshot",
    title: "Snapshot or image shared publicly",
    checkIds: ["ec2.ebs.snapshot_public", "ec2.snapshot.public", "rds.snapshot.public", "ec2.ami.public"],
    searchTerms: ["public", "snapshot", "ami", "shared", "rds snapshot", "ebs snapshot"],
  },
  {
    key: "ci_scanning",
    title: "Security scanning not enabled in CI",
    checkIds: [
      "github.repo.dependabot_disabled",
      "github.repo.code_scanning_disabled",
      "github.repo.secret_scanning_disabled",
      "gitlab.repo.sast_disabled",
      "gitlab.repo.dependency_scanning_disabled",
      "gitlab.repo.container_scanning_disabled",
    ],
    searchTerms: ["scanning", "sast", "dependabot", "code scanning", "secret scanning", "dependency", "container", "ci"],
  },
  {
    key: "public_messaging",
    title: "Messaging resource allows public access",
    checkIds: ["sns.topic.public", "sqs.queue.public"],
    searchTerms: ["public", "sns", "sqs", "topic", "queue", "messaging"],
  },
  {
    key: "access_logging",
    title: "Access logging disabled",
    checkIds: ["s3.bucket.no_logging", "elb.load_balancer.no_access_logs", "cloudtrail.trail.s3_bucket_no_logging"],
    searchTerms: ["logging", "access logs", "s3 logging", "elb logs", "cloudtrail logging"],
  },
  {
    key: "s3_public_access",
    title: "Bucket public access not blocked",
    checkIds: ["s3.account.public_access_not_blocked", "s3.bucket.public_access_not_blocked"],
    searchTerms: ["s3", "public access", "block public access", "bucket", "account"],
  },
  {
    key: "public_endpoint",
    title: "Resource exposed to the public internet",
    checkIds: [
      "rds.instance.publicly_accessible",
      "eks.cluster.public_endpoint",
      "ecs.service.public_ip_enabled",
      "lambda.function.public_url",
    ],
    searchTerms: ["public", "internet", "endpoint", "publicly accessible", "exposed", "rds", "eks", "ecs", "lambda"],
  },
  {
    key: "mfa_not_enforced",
    title: "MFA / 2SV not enforced",
    checkIds: [
      "github.org.mfa_not_enforced",
      "gitlab.org.mfa_not_enforced",
      "google_workspace.org.mfa_not_enforced",
      "entra.org.mfa_not_enforced",
    ],
    searchTerms: ["mfa", "2sv", "two-factor", "not enforced", "github", "gitlab", "google", "entra"],
  },
  {
    key: "inactive_identity",
    title: "Inactive or dormant identity",
    checkIds: [
      "google_workspace.user.inactive_90d",
      "entra.user.inactive_90d",
      "identity_center.user.inactive_90d",
      "github.org.dormant_members",
      "gitlab.org.dormant_members",
    ],
    searchTerms: ["inactive", "dormant", "stale", "unused", "90 days", "identity", "user"],
  },
  {
    key: "branch_protection",
    title: "Default branch not protected",
    checkIds: ["github.repo.no_branch_protection", "gitlab.repo.no_branch_protection"],
    searchTerms: ["branch protection", "default branch", "github", "gitlab", "repo"],
  },
  {
    key: "self_merge",
    title: "Self-merge allowed",
    checkIds: ["github.repo.self_merge_allowed", "gitlab.repo.self_merge_allowed"],
    searchTerms: ["self-merge", "self merge", "review", "github", "gitlab"],
  },
  {
    key: "pr_reviews",
    title: "Insufficient review approvals",
    checkIds: ["github.repo.insufficient_reviews", "gitlab.repo.insufficient_reviews"],
    searchTerms: ["review", "approval", "pull request", "merge request", "pr", "mr"],
  },
  {
    key: "deploy_approvals",
    title: "Production deployment approvals missing",
    checkIds: ["github.repo.no_env_protection", "gitlab.repo.no_env_protection"],
    searchTerms: ["environment", "deployment", "approval", "production", "protection"],
  },
  {
    key: "codeowners",
    title: "Repository missing CODEOWNERS",
    checkIds: ["github.repo.no_codeowners", "gitlab.repo.no_codeowners"],
    searchTerms: ["codeowners", "code owners", "repo", "github", "gitlab"],
  },
  {
    key: "rds_multi_az",
    title: "RDS not Multi-AZ",
    checkIds: ["rds.instance.no_multi_az", "rds.instance.single_az"],
    searchTerms: ["multi-az", "multi az", "rds", "availability", "single az"],
  },
  {
    key: "acm_expiring",
    title: "Certificate expired or expiring",
    checkIds: ["acm.certificate.expiring", "acm.certificate.expiring_soon", "iam.server_certificate.expired"],
    searchTerms: ["certificate", "acm", "expiring", "expired", "expiry", "tls", "server certificate"],
  },
  {
    key: "cloudtrail_bucket_private",
    title: "CloudTrail bucket not private",
    checkIds: ["cloudtrail.trail.s3_bucket_public", "cloudtrail.bucket.not_private"],
    searchTerms: ["cloudtrail", "bucket", "private", "public", "s3"],
  },
  {
    // Same vuln class (a stale/unused IAM credential) across credential types —
    // programmatic access keys and human console passwords. Remediation differs
    // per resource type, mirroring the encryption-at-rest group.
    key: "unused_credentials",
    title: "Unused IAM credentials",
    checkIds: [
      "iam.access_key.unused_45d",
      "iam.access_key.unused_90d",
      "iam.user.credentials_unused_45d",
      "iam.user.inactive_90d",
    ],
    searchTerms: ["access key", "console", "password", "credential", "credentials", "unused", "stale", "dormant", "iam", "45 days", "90 days"],
  },
  {
    key: "ssm_secret",
    title: "Unencrypted SSM parameter",
    checkIds: ["ssm.parameter.plaintext_secret", "ssm.parameter.unencrypted"],
    searchTerms: ["ssm", "parameter", "secret", "plaintext", "unencrypted", "securestring"],
  },
  {
    key: "root_account",
    title: "Root account not hardened",
    checkIds: ["iam.root.no_mfa", "iam.root.has_access_keys", "iam.root.usage"],
    searchTerms: ["root", "root account", "mfa", "access key", "root usage", "hardening"],
  },
  {
    key: "rotation_disabled",
    title: "Key or secret rotation disabled",
    checkIds: ["kms.key.no_rotation", "secretsmanager.secret.no_rotation", "iam.access_key.no_rotation_90d"],
    searchTerms: ["rotation", "rotate", "kms", "secret", "secrets manager", "access key", "90 days"],
  },
  {
    key: "backup_recovery",
    title: "Backup or recovery not configured",
    checkIds: ["backup.plan.missing", "rds.instance.no_automated_backup", "dynamodb.table.no_pitr"],
    searchTerms: ["backup", "recovery", "pitr", "point in time", "snapshot", "rds", "dynamodb", "aws backup"],
  },
  {
    key: "role_trust",
    title: "IAM role trust policy too permissive",
    checkIds: ["iam.role.external_account_trust", "iam.role.trust_wildcard"],
    searchTerms: ["trust", "trust policy", "assume role", "external account", "wildcard", "iam role"],
  },
  {
    key: "admin_unreviewed",
    title: "Admin access not reviewed",
    checkIds: ["entra.admin.unreviewed", "github.org.admin_unreviewed", "google_workspace.admin.unreviewed"],
    searchTerms: ["admin", "administrator", "privileged", "unreviewed", "review", "entra", "github", "google"],
  },
  {
    key: "image_scanning",
    title: "Container image scanning disabled",
    checkIds: ["ecr.registry.enhanced_scanning_disabled", "ecr.repository.image_scan_disabled"],
    searchTerms: ["ecr", "image scan", "container", "scanning", "vulnerability", "registry", "repository"],
  },
  {
    key: "account_contact",
    title: "Account contact information incomplete",
    checkIds: ["aws.account.contact_incomplete", "aws.account.security_contact_missing"],
    searchTerms: ["account", "contact", "security contact", "alternate contact", "billing"],
  },
  {
    key: "security_checks_required",
    title: "Security checks not required before merge",
    checkIds: ["github.repo.security_status_checks_missing", "gitlab.repo.security_ci_not_required"],
    searchTerms: ["status checks", "required", "security ci", "merge", "github", "gitlab", "gate"],
  },
  {
    key: "audit_logging",
    title: "Audit logging disabled",
    checkIds: ["vpc.flow_logs.not_enabled", "eks.cluster.control_plane_logging_disabled", "cloudtrail.trail.no_cloudwatch_logs"],
    searchTerms: ["audit log", "flow logs", "vpc", "control plane", "eks", "cloudwatch", "cloudtrail logging"],
  },
  {
    key: "underused_role",
    title: "Underused IAM role",
    checkIds: ["iam.role.unassumed_90d", "iam.role.unused_services_90d"],
    searchTerms: ["role", "unassumed", "unused", "granted services", "least privilege", "90 days", "iam role"],
  },
  {
    key: "unresolved_security_findings",
    title: "Unresolved security-service findings",
    checkIds: ["guardduty.open_findings", "aws.inspector.active_critical_finding"],
    searchTerms: ["guardduty", "inspector", "finding", "critical", "threat", "unresolved", "open findings"],
  },
];

for (const g of ADDITIONAL_GROUPS) {
  for (const id of g.checkIds) CHECK_ID_TO_GROUP.set(id, g.key);
  FINDING_GROUP_META[g.key] = { title: g.title, searchTerms: g.searchTerms };
}

export function isActivityCheck(checkId: string): boolean {
  return checkId.startsWith("cloudtrail.event.");
}

export function findingDisplayGroupKey(checkId: string): string {
  return CHECK_ID_TO_GROUP.get(checkId) ?? checkId;
}

export function findingGroupMeta(groupKey: string): FindingGroupMeta | null {
  return FINDING_GROUP_META[groupKey] ?? null;
}

export function findingGroupLabel(groupKey: string): string | null {
  return FINDING_GROUP_META[groupKey]?.title ?? null;
}

export function findingGroupSearchText(groupKey: string): string {
  const meta = FINDING_GROUP_META[groupKey];
  if (!meta) return "";
  return [meta.title, ...(meta.searchTerms ?? [])].join(" ");
}
