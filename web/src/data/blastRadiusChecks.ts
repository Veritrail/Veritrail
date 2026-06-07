/** Prefixes / IDs supported by GET /v1/accounts/{id}/blast-radius (keep in sync with accounts.py). */
const BLAST_RADIUS_PREFIXES = [
  "iam.role.",
  "iam.access_key.",
  "iam.user.",
  "iam.root.",
  "iam.policy.",
  "ec2.security_group.",
  "kms.key.",
  "s3.bucket.",
  "rds.instance.",
  "rds.snapshot.",
  "dynamodb.table.",
  "cloudtrail.trail.",
  "ec2.ebs.snapshot",
  "lambda.function.",
  "elb.load_balancer.",
  "eks.cluster.",
  "ecs.cluster.",
  "ecs.service.",
  "ecs.task_definition.",
  "ecr.repository.",
  "github.",
  "gitlab.",
] as const;

const BLAST_RADIUS_EXACT = new Set([
  "iam.account.password_policy_weak",
  "iam.perm.granted_vs_used",
  "s3.account.public_access_not_blocked",
  "vpc.flow_logs.not_enabled",
  "guardduty.detector.not_enabled",
  "aws.config.not_enabled",
  "aws.securityhub.not_enabled",
  "aws.access_analyzer.not_enabled",
  "ec2.instance.imdsv2_not_required",
  "ec2.ebs.volume_unencrypted",
  "ec2.ebs.encryption_not_default",
  "ec2.ami.public",
  "acm.certificate.expiring",
  "secretsmanager.secret.no_rotation",
  "ssm.parameter.plaintext_secret",
  "sns.topic.no_encryption",
  "sqs.queue.no_encryption",
]);

/** Checks that always show the What If tab with static copy instead of blast-radius API. */
const WHAT_IF_UNAVAILABLE: Record<string, string> = {
  "iam.account.no_support_role":
    "Account-level baseline — creating a support role does not remove access from existing principals.",
  "iam.access_inventory_gap":
    "Scan coverage gap — re-run a full account scan after fixing IAM list permissions; no single resource to analyze.",
  "guardduty.open_findings":
    "Active GuardDuty findings require triage in the GuardDuty console — impact depends on finding type, not one configuration change.",
  "aws.account.contact_incomplete":
    "Account contact metadata only — completing it does not change workload access.",
  "aws.account.security_contact_missing":
    "Account security contact metadata only — adding the contact does not change workload access.",
  "iam.server_certificate.expired":
    "Expired server certificate — renew or replace on attached endpoints before deleting the IAM cert.",
  "iam.cloudshell_full_access_granted":
    "CloudShell policy attachment — detaching is low risk for unused principals; confirm the principal is not an active break-glass path.",
  "aws.config.rules_non_compliant":
    "Config rule violations vary by rule — review each non-compliant resource listed in evidence.",
  "ec2.ami.aged":
    "AMI patch-age signal — blast radius depends on instances launched from this image; refresh during planned maintenance.",
  "ecr.registry.enhanced_scanning_disabled":
    "Registry-level scanning — enabling enhanced scanning does not block image pulls.",
  "aws.vulnerability_monitoring.not_detected":
    "Coverage detection — enable Inspector or your container scanner; no single resource dependency graph.",
  "aws.inspector.active_critical_finding":
    "Inspector vulnerability — remediate or suppress in Inspector; impact varies by CVE and workload.",
  "google_workspace.org.mfa_not_enforced":
    "Google Workspace policy — org-wide 2-step verification affects all users on next sign-in.",
  "google_workspace.user.inactive_90d":
    "Google Workspace user lifecycle — suspending removes Workspace access; verify mailbox and SSO mappings first.",
  "google_workspace.admin.unreviewed":
    "Access review item — confirm privileged admin roles in Google Admin console.",
  "entra.org.mfa_not_enforced":
    "Entra ID policy — MFA enforcement affects Microsoft sign-ins via Conditional Access.",
  "entra.user.inactive_90d":
    "Entra user lifecycle — disable after confirming no active SSO or mailbox dependency.",
  "entra.admin.unreviewed":
    "Access review item — confirm privileged roles in the Entra admin center.",
  "identity_center.user.inactive_90d":
    "Identity Center user stale — removing permission sets revokes AWS access for that user.",
};

/** True when GET /v1/accounts/{id}/blast-radius supports this check. */
export function supportsBlastRadius(checkId: string): boolean {
  if (BLAST_RADIUS_EXACT.has(checkId)) return true;
  return BLAST_RADIUS_PREFIXES.some((p) => checkId.startsWith(p));
}

/** Static What If copy when blast-radius API is not available (null = use API). */
export function whatIfUnavailableReason(checkId: string): string | null {
  if (supportsBlastRadius(checkId)) return null;
  if (WHAT_IF_UNAVAILABLE[checkId]) return WHAT_IF_UNAVAILABLE[checkId];
  if (checkId.startsWith("cloudtrail.event.")) {
    return "CloudTrail event detections flag a point-in-time API action. Review the event timeline and actor — there is no ongoing misconfiguration to simulate removing.";
  }
  return "What-if dependency analysis is not available for this check — use Overview and Remediation to assess impact before fixing.";
}

/** Whether the finding drawer should show the What If tab. */
export function showWhatIfTab(checkId: string, accountId?: string | null): boolean {
  if (checkId.startsWith("github.") || checkId.startsWith("gitlab.")) return true;
  if (
    checkId.startsWith("google_workspace.") ||
    checkId.startsWith("entra.") ||
    checkId.startsWith("identity_center.")
  ) {
    return true;
  }
  return !!accountId;
}

/**
 * @deprecated Prefer supportsBlastRadius — static set drifts when new checks ship.
 * Kept for imports that expect a Set; not exhaustive.
 */
export const BLAST_RADIUS_CHECKS = new Set<string>();
