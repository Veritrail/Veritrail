/** Checks with customer-hosted SSM Automation (matches api/app/services/iac_snippets.py). */
export const SSM_AUTOMATION_CHECKS = new Set([
  "ec2.security_group.unrestricted_ssh",
  "ec2.security_group.unrestricted_rdp",
  "s3.bucket.public_access_not_blocked",
  "ssm.parameter.plaintext_secret",
  "iam.access_key.unused_45d",
  "iam.access_key.unused_90d",
  "cloudtrail.trail.not_enabled",
  "iam.role.least_privilege_policy",
]);

export function supportsSsmAutomation(checkId: string): boolean {
  return SSM_AUTOMATION_CHECKS.has(checkId);
}
