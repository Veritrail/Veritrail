/** Short operational copy for drawer overview — full steps stay in FindingDrawer remediations. */
export type RemediationSummary = {
  impact: string;
  risk: string;
  fix: string;
};

export const remediationSummaries: Record<string, RemediationSummary> = {
  "iam.user.no_mfa": {
    impact: "Console user has no MFA.",
    risk: "Stolen password = full console access.",
    fix: "Assign MFA in IAM.",
  },
  "iam.user.inactive_90d": {
    impact: "IAM user inactive 90+ days.",
    risk: "Stale accounts hide compromise.",
    fix: "Disable console access or delete the user.",
  },
  "iam.user.credentials_unused_45d": {
    impact: "Inactive for 45+ days",
    risk: "Console user with no recent sign-in",
    fix: "Disable console access or delete the user",
  },
  "iam.user.direct_policy_attachment": {
    impact: "Policies attached directly to the user.",
    risk: "Harder to audit and revoke at scale.",
    fix: "Move permissions to groups or roles.",
  },
  "iam.access_key.unused_90d": {
    impact: "Access key unused 90+ days.",
    risk: "Long-lived credential with no owner.",
    fix: "Deactivate, verify, then delete the key.",
  },
  "iam.access_key.unused_45d": {
    impact: "Inactive for 45+ days",
    risk: "Long-lived credential with no recent use",
    fix: "Deactivate, verify, then delete the key",
  },
  "iam.access_key.no_rotation_90d": {
    impact: "Access key older than rotation threshold.",
    risk: "Key may live in old scripts or CI secrets.",
    fix: "Rotate: create new key, update workload, retire old.",
  },
  "iam.access_key.multiple_active": {
    impact: "User has multiple active access keys.",
    risk: "Duplicate keys complicate ownership.",
    fix: "Review keys and delete the unused one.",
  },
  "iam.role.unassumed_90d": {
    impact: "Role not assumed in 90+ days.",
    risk: "Orphan role may still carry broad policies.",
    fix: "Confirm with owner, then delete if unused.",
  },
  "iam.role.least_privilege_policy": {
    impact: "Customer-managed policy grants Action:* beyond least privilege.",
    risk: "Full account compromise if the role is assumed with Resource:*, or broad API access with scoped resources.",
    fix: "Replace with least-privilege policies scoped to observed usage.",
  },
  "iam.perm.granted_vs_used": {
    impact: "Write actions granted but not used in 90 days.",
    risk: "Unused write perms expand blast radius.",
    fix: "Remove unused actions from role policies.",
  },
  "iam.policy.unattached": {
    impact: "Customer-managed policy has zero attachments.",
    risk: "Stale policy may be re-attached with broad grants.",
    fix: "Review and delete if no longer needed.",
  },
  "iam.policy.wildcard_resource": {
    impact: 'Write actions on Resource: "*".',
    risk: "Role can touch every resource of that type.",
    fix: "Replace wildcards with specific ARNs.",
  },
  "iam.role.unused_services_90d": {
    impact: "Role has permissions to unused services.",
    risk: "Extra services widen compromise impact.",
    fix: "Remove unused service statements from policies.",
  },
  "iam.role.trust_wildcard": {
    impact: "Trust policy allows any AWS principal.",
    risk: "Unintended principals may assume the role.",
    fix: "Scope Principal to specific accounts or roles.",
  },
  "iam.root.has_access_keys": {
    impact: "Root account has active access keys.",
    risk: "Root keys bypass all IAM policies.",
    fix: "Delete root keys; use IAM users for automation.",
  },
  "iam.root.no_mfa": {
    impact: "Root account has no MFA.",
    risk: "Highest-severity identity exposure.",
    fix: "Enable hardware MFA on root immediately.",
  },
  "iam.root.usage": {
    impact: "Root credentials used for API activity.",
    risk: "Root bypasses all IAM and SCP controls.",
    fix: "Move tasks to IAM admin; reserve root for account tasks.",
  },
  "aws.account.contact_incomplete": {
    impact: "Primary AWS account contact details are incomplete.",
    risk: "Billing and operational notifications may not reach the right owner.",
    fix: "Complete address, city, country, and phone in Account → Contact information.",
  },
  "aws.account.security_contact_missing": {
    impact: "No security alternate contact is registered.",
    risk: "AWS security notifications may not reach your security team.",
    fix: "Add security alternate contact with email and phone in Account settings.",
  },
  "iam.server_certificate.expired": {
    impact: "An IAM server certificate is past its expiration date.",
    risk: "TLS endpoints using the cert may fail or use stale credentials.",
    fix: "Delete the expired certificate in IAM → Server certificates.",
  },
  "iam.cloudshell_full_access_granted": {
    impact: "AWSCloudShellFullAccess is attached to an IAM principal.",
    risk: "Broad shell access increases blast radius if the principal is compromised.",
    fix: "Detach AWSCloudShellFullAccess except break-glass roles.",
  },
  "s3.bucket.public_access_not_blocked": {
    impact: "S3 Block Public Access not fully enabled.",
    risk: "Misconfigured ACL or policy can expose objects.",
    fix: "Enable all four Block Public Access settings.",
  },
  "s3.account.public_access_not_blocked": {
    impact: "Account-level S3 public access block off.",
    risk: "One bucket mistake can expose data publicly.",
    fix: "Enable account-wide Block Public Access.",
  },
  "s3.bucket.no_https_policy": {
    impact: "No deny-insecure-transport bucket policy.",
    risk: "Legacy http:// clients could read objects.",
    fix: "Add Deny when aws:SecureTransport is false.",
  },
  "s3.bucket.no_kms": {
    impact: "Bucket not using SSE-KMS.",
    risk: "No customer control over encryption keys.",
    fix: "Enable default SSE-KMS on the bucket.",
  },
  "s3.bucket.no_logging": {
    impact: "S3 server access logging disabled.",
    risk: "No audit trail for bucket access.",
    fix: "Enable logging to a dedicated log bucket.",
  },
  "kms.key.policy_wildcard_principal": {
    impact: "KMS key policy allows wildcard principal.",
    risk: "Any principal matching the policy may use the key.",
    fix: "Remove `Principal: *` and scope to specific accounts or roles.",
  },
  "kms.key.no_rotation": {
    impact: "KMS key rotation disabled.",
    risk: "Longer exposure window if key material leaks.",
    fix: "Enable annual automatic key rotation.",
  },
  "cloudtrail.trail.not_enabled": {
    impact: "No CloudTrail logging in this region.",
    risk: "API activity is invisible to investigation.",
    fix: "Create a multi-region trail with S3 delivery.",
  },
  "cloudtrail.trail.no_log_validation": {
    impact: "CloudTrail log file validation off.",
    risk: "Tampered logs look authentic.",
    fix: "Enable log file validation on the trail.",
  },
  "cloudtrail.trail.no_kms": {
    impact: "CloudTrail logs not SSE-KMS encrypted.",
    risk: "Weaker control over audit log access.",
    fix: "Enable KMS encryption on the trail.",
  },
  "guardduty.open_findings": {
    impact: "GuardDuty has active findings.",
    risk: "Unresolved threats may indicate compromise.",
    fix: "Triage, remediate, or archive with justification.",
  },
  "aws.config.rules_non_compliant": {
    impact: "Config rules report non-compliant resources.",
    risk: "Baseline drift hidden until audit.",
    fix: "Remediate resources or document exceptions.",
  },
  "ec2.ami.aged": {
    impact: "AMI exceeds patch-age threshold.",
    risk: "Instances may lack current OS patches.",
    fix: "Refresh workloads onto a newer AMI.",
  },
  "iam.access_inventory_gap": {
    impact: "IAM inventory incomplete after scan.",
    risk: "Access roster may omit principals.",
    fix: "Fix role permissions and re-scan.",
  },
  "github.repo.no_codeowners": {
    impact: "No CODEOWNERS file (optional Git check).",
    risk: "No code-owner review rules possible.",
    fix: "Add CODEOWNERS or disable the check.",
  },
  "gitlab.repo.no_codeowners": {
    impact: "No CODEOWNERS file (optional Git check).",
    risk: "No code-owner review rules possible.",
    fix: "Add CODEOWNERS or disable the check.",
  },
  "guardduty.detector.not_enabled": {
    impact: "GuardDuty disabled in region.",
    risk: "Threats go undetected automatically.",
    fix: "Enable GuardDuty in affected regions.",
  },
  "vpc.flow_logs.not_enabled": {
    impact: "VPC flow logs not enabled.",
    risk: "Network attacks invisible at VPC layer.",
    fix: "Create flow log to CloudWatch or S3.",
  },
  "ec2.security_group.unrestricted_ssh": {
    impact: "SSH (22) open to 0.0.0.0/0.",
    risk: "Internet-wide brute force on SSH.",
    fix: "Restrict source IP or use SSM Session Manager.",
  },
  "ec2.security_group.unrestricted_rdp": {
    impact: "RDP (3389) open to 0.0.0.0/0.",
    risk: "Common ransomware entry point.",
    fix: "Restrict source IP or use Fleet Manager.",
  },
  "rds.instance.publicly_accessible": {
    impact: "RDS instance reachable from internet.",
    risk: "Direct path to database exfiltration.",
    fix: 'Set "Publicly accessible" to No.',
  },
  "rds.instance.no_encryption": {
    impact: "RDS storage not encrypted.",
    risk: "Snapshot or disk leak exposes plaintext.",
    fix: "Snapshot, copy encrypted, restore new instance.",
  },
  "rds.instance.no_automated_backup": {
    impact: "Automated RDS backups disabled.",
    risk: "No point-in-time recovery.",
    fix: "Set backup retention to at least 7 days.",
  },
  "dynamodb.table.no_encryption": {
    impact: "DynamoDB table encryption not explicit.",
    risk: "Data at rest not clearly protected.",
    fix: "Enable encryption at rest on the table.",
  },
  "dynamodb.table.no_pitr": {
    impact: "Point-in-time recovery disabled.",
    risk: "Accidental deletes may be permanent.",
    fix: "Enable PITR on the table.",
  },
  "s3.bucket.no_default_encryption": {
    impact: "Default bucket encryption off.",
    risk: "New uploads may land unencrypted.",
    fix: "Enable default SSE-S3 or SSE-KMS.",
  },
  "s3.bucket.no_mfa_delete": {
    impact: "Versioning on without MFA Delete.",
    risk: "Compromised IAM can wipe all versions.",
    fix: "Enable MFA Delete (requires root).",
  },
  "ec2.ebs.snapshot_public": {
    impact: "EBS snapshot shared publicly.",
    risk: "Disk image may contain secrets or data.",
    fix: "Remove public createVolumePermission.",
  },
  "ec2.ebs.snapshot_unencrypted": {
    impact: "EBS snapshot stored unencrypted.",
    risk: "Full disk readable from snapshot access.",
    fix: "Copy snapshot with encryption enabled.",
  },
  "ec2.ami.public": {
    impact: "AMI shared with all AWS accounts.",
    risk: "Image may contain secrets or IP.",
    fix: "Set AMI visibility to private.",
  },
  "cloudtrail.trail.s3_bucket_public": {
    impact: "CloudTrail log bucket is public.",
    risk: "Full API history exposed to internet.",
    fix: "Block public access on log bucket immediately.",
  },
  "cloudtrail.trail.no_cloudwatch_logs": {
    impact: "Trail not shipping to CloudWatch Logs.",
    risk: "Delayed detection of suspicious API use.",
    fix: "Enable CloudWatch Logs on the trail.",
  },
  "cloudtrail.trail.s3_bucket_no_logging": {
    impact: "CloudTrail S3 bucket has no access logs.",
    risk: "Access to audit trail itself unlogged.",
    fix: "Enable server access logging on log bucket.",
  },
  "acm.certificate.expiring": {
    impact: "TLS certificate expiring soon.",
    risk: "HTTPS breaks for attached services.",
    fix: "Renew or replace cert before expiry.",
  },
  "lambda.function.deprecated_runtime": {
    impact: "Lambda on unsupported runtime.",
    risk: "No security patches; invocation may stop.",
    fix: "Upgrade to a supported runtime and test.",
  },
  "lambda.function.no_dlq": {
    impact: "Async Lambda has no dead-letter queue.",
    risk: "Failed invocations disappear silently.",
    fix: "Attach SQS/SNS DLQ with retry limit.",
  },
  "lambda.function.public_url": {
    impact: "Lambda function URL accepts unauthenticated requests.",
    risk: "Internet callers can invoke code directly.",
    fix: "Require IAM auth or remove the function URL.",
  },
  "ecr.repository.image_scan_disabled": {
    impact: "Container images are not scanned on push.",
    risk: "Known vulnerable images can reach runtime unnoticed.",
    fix: "Enable ECR scan-on-push or enhanced scanning.",
  },
  "rds.instance.no_deletion_protection": {
    impact: "RDS deletion protection off.",
    risk: "One API call can destroy the database.",
    fix: "Enable deletion protection on instance.",
  },
  "rds.instance.no_multi_az": {
    impact: "RDS single-AZ deployment.",
    risk: "No automatic failover on host failure.",
    fix: "Enable Multi-AZ during maintenance window.",
  },
  "rds.snapshot.public": {
    impact: "RDS snapshot is publicly restorable.",
    risk: "Database contents may be copied externally.",
    fix: "Remove public restore permissions immediately.",
  },
  "eks.cluster.public_endpoint": {
    impact: "EKS API endpoint is internet reachable.",
    risk: "Attackers can probe Kubernetes API auth paths.",
    fix: "Restrict public CIDRs or use private endpoint access.",
  },
  "secretsmanager.secret.no_rotation": {
    impact: "Secret has no automatic rotation.",
    risk: "Static credentials harder to revoke.",
    fix: "Enable rotation with a Lambda function.",
  },
  "ssm.parameter.plaintext_secret": {
    impact: "Secret stored as plaintext SSM String.",
    risk: "Value visible in API and CloudTrail.",
    fix: "Migrate to SecureString parameter.",
  },
  "elb.load_balancer.no_access_logs": {
    impact: "Load balancer access logging off.",
    risk: "No request-level audit for abuse.",
    fix: "Enable access logs to S3.",
  },
  "elb.load_balancer.weak_tls_policy": {
    impact: "Load balancer allows legacy TLS/ciphers.",
    risk: "Weak encryption on client connections.",
    fix: "Upgrade listener to TLS 1.2+ policy.",
  },
  "sns.topic.no_encryption": {
    impact: "SNS topic not KMS-encrypted.",
    risk: "Messages readable at rest.",
    fix: "Enable SSE-KMS on the topic.",
  },
  "sqs.queue.no_encryption": {
    impact: "SQS queue not KMS-encrypted.",
    risk: "Queue payloads readable at rest.",
    fix: "Enable SSE-KMS on the queue.",
  },
  "iam.account.no_support_role": {
    impact: "No IAM role with AWSSupportAccess.",
    risk: "Support cases may require root or ad-hoc elevated access.",
    fix: "Create a dedicated support role with AWSSupportAccess.",
  },
  "iam.account.password_policy_weak": {
    impact: "IAM password policy below baseline.",
    risk: "Weak passwords easier to crack.",
    fix: "Strengthen length, complexity, and rotation.",
  },
  "aws.access_analyzer.not_enabled": {
    impact: "IAM Access Analyzer not enabled.",
    risk: "External resource sharing undetected.",
    fix: "Create an analyzer in each active region.",
  },
  "aws.config.not_enabled": {
    impact: "AWS Config not recording changes.",
    risk: "No configuration history for audits.",
    fix: "Enable Config recorder and delivery channel.",
  },
  "aws.securityhub.not_enabled": {
    impact: "Security Hub disabled in region.",
    risk: "Findings fragmented across services.",
    fix: "Enable Security Hub and FSBP standard.",
  },
  "ec2.security_group.default_allows_traffic": {
    impact: "VPC default security group has inbound or outbound rules.",
    risk: "Resources launched without an explicit SG inherit those rules.",
    fix: "Delete rules on the default SG; use named SGs on instances.",
  },
  "iam.role.external_account_trust": {
    impact: "Role trust policy allows another AWS account to assume it.",
    risk: "External account can use this role's permissions in your account.",
    fix: "Review trust policy; remove unapproved cross-account principals.",
  },
  "ec2.instance.imdsv2_not_required": {
    impact: "IMDSv1 still allowed on instance.",
    risk: "SSRF can steal instance IAM credentials.",
    fix: "Require IMDSv2 on instance metadata.",
  },
  "ec2.ebs.encryption_not_default": {
    impact: "EBS encryption by default off.",
    risk: "New volumes may launch unencrypted.",
    fix: "Enable default EBS encryption per region.",
  },
  "ec2.ebs.volume_unencrypted": {
    impact: "Existing EBS volume unencrypted.",
    risk: "Data at rest outside encryption baseline.",
    fix: "Snapshot, encrypt copy, attach new volume.",
  },
  "github.org.mfa_not_enforced": {
    impact: "Org does not require MFA.",
    risk: "Phished password = full repo write access.",
    fix: "Require 2FA for all org members.",
  },
  "github.org.dormant_members": {
    impact: "Dormant org members still present.",
    risk: "Stale tokens act as insider access.",
    fix: "Remove members with no recent activity.",
  },
  "github.org.outside_collaborators": {
    impact: "Outside collaborators on repositories.",
    risk: "Access persists after projects end.",
    fix: "Review and revoke stale collaborators.",
  },
  "github.repo.no_branch_protection": {
    impact: "Default branch has no protection rules.",
    risk: "Direct pushes skip review and CI.",
    fix: "Add branch protection with required reviews.",
  },
  "github.repo.no_env_protection": {
    impact: "Deployment environment lacks reviewers.",
    risk: "Workflows can deploy without approval.",
    fix: "Add required reviewers on production env.",
  },
  "github.repo.self_merge_allowed": {
    impact: "Authors can merge their own PRs.",
    risk: "Peer review control bypassed.",
    fix: "Require external approval on default branch.",
  },
  "github.repo.insufficient_reviews": {
    impact: "PRs merged below required review count.",
    risk: "Gap in change-management evidence.",
    fix: "Raise required approvals and enforce policy.",
  },
  "gitlab.org.mfa_not_enforced": {
    impact: "Group does not require 2FA.",
    risk: "Phished password = full project access.",
    fix: "Require 2FA for all group members.",
  },
  "gitlab.org.dormant_members": {
    impact: "Dormant group members still present.",
    risk: "Stale tokens usable indefinitely.",
    fix: "Remove inactive members from the group.",
  },
  "gitlab.repo.no_branch_protection": {
    impact: "Default branch not protected.",
    risk: "Direct pushes skip MR review and CI.",
    fix: "Protect default branch; block direct push.",
  },
  "gitlab.repo.self_merge_allowed": {
    impact: "MR authors can approve own changes.",
    risk: "Segregation of duties broken.",
    fix: "Prevent author self-approval in settings.",
  },
  "gitlab.repo.insufficient_reviews": {
    impact: "MRs merged below approval threshold.",
    risk: "Change-management evidence gap.",
    fix: "Increase required approvals and reset on push.",
  },
  "iam.user.admin_policy_attached": {
    impact: "User has admin-equivalent policy attached.",
    risk: "Compromised user credentials grant full account control.",
    fix: "Remove admin policy; grant least-privilege via group or role.",
  },
  "cloudtrail.event.root_activity": {
    impact: "Root user API call recorded in CloudTrail.",
    risk: "Root bypasses IAM boundaries and SCP controls.",
    fix: "Identify the process using root; move tasks to IAM admin roles.",
  },
  "cloudtrail.event.trail_tampering": {
    impact: "CloudTrail trail was stopped, deleted, or modified.",
    risk: "Audit logging gap hides subsequent API activity.",
    fix: "Restore logging, recreate trail, and investigate the actor.",
  },
  "cloudtrail.event.iam_user_policy_attachment": {
    impact: "IAM user policy attachment changed.",
    risk: "Direct user grants bypass group-based access reviews.",
    fix: "Review attachment in IAM; move permissions to groups or roles.",
  },
  "cloudtrail.event.s3_bucket_policy_change": {
    impact: "S3 bucket policy was modified.",
    risk: "Policy change may expose objects or weaken encryption.",
    fix: "Review policy diff in S3; revert unauthorized changes.",
  },
  "cloudtrail.event.iam_role_policy_mutation": {
    impact: "IAM role policy was attached, detached, or edited.",
    risk: "Role permission changes affect every principal that can assume it.",
    fix: "Review role policies in IAM; scope to least privilege.",
  },
  "cloudtrail.event.security_group_open_to_world": {
    impact: "Security group rule opened to the internet.",
    risk: "Immediate network exposure to brute force and scanning.",
    fix: "Restrict source CIDRs or remove the rule; verify attached instances.",
  },
  "cloudtrail.event.kms_key_disabled_or_deleted": {
    impact: "KMS key disabled or scheduled for deletion.",
    risk: "Encrypted data and secrets may become unreadable.",
    fix: "Cancel deletion or re-enable key; investigate actor.",
  },
  "cloudtrail.event.guardduty_disabled": {
    impact: "GuardDuty detector was deleted or disabled.",
    risk: "Threat detection blind spot until re-enabled.",
    fix: "Re-enable GuardDuty in affected regions; review who disabled it.",
  },
  "cloudtrail.event.config_recorder_stopped": {
    impact: "AWS Config recorder was stopped.",
    risk: "Configuration change history stops recording.",
    fix: "Start the recorder and verify delivery channel.",
  },
  "cloudtrail.event.iam_access_key_created": {
    impact: "New IAM access key created.",
    risk: "Long-lived credential added without rotation policy.",
    fix: "Confirm owner and need; delete if unauthorized.",
  },
  "cloudtrail.event.s3_public_access_block_disabled": {
    impact: "S3 Block Public Access settings were weakened.",
    risk: "Buckets may become publicly readable or writable.",
    fix: "Re-enable block public access at account or bucket level.",
  },
  "cloudtrail.event.lambda_function_created_or_modified": {
    impact: "Lambda function created or updated.",
    risk: "Code or config change may introduce exposure or privilege escalation.",
    fix: "Review function code, IAM role, and trigger configuration.",
  },
  "cloudtrail.event.ec2_instance_tampering": {
    impact: "EC2 instance security settings changed.",
    risk: "Metadata, security groups, or user data may weaken isolation.",
    fix: "Review instance changes; revert unauthorized modifications.",
  },
  "cloudtrail.event.rds_instance_created_or_modified": {
    impact: "RDS instance created or modified.",
    risk: "Public access, encryption, or backup settings may have changed.",
    fix: "Review instance configuration against your database baseline.",
  },
  "cloudtrail.event.anomalous_api_volume": {
    impact: "Unusual API call volume detected.",
    risk: "May indicate automation gone wrong or unauthorized activity.",
    fix: "Identify calling principal; throttle or revoke credentials if malicious.",
  },
  "github.org.admin_unreviewed": {
    impact: "GitHub org admin has not been access-reviewed.",
    risk: "Stale admin access persists after role changes.",
    fix: "Confirm admin still needs org-level privileges.",
  },
  "github.repo.dependabot_disabled": {
    impact: "Dependabot alerts disabled on repository.",
    risk: "Known vulnerable dependencies may go unpatched.",
    fix: "Enable Dependabot alerts and security updates.",
  },
  "github.repo.code_scanning_disabled": {
    impact: "GitHub code scanning not enabled.",
    risk: "Static analysis gaps in CI pipeline.",
    fix: "Enable code scanning with CodeQL or third-party integration.",
  },
  "github.repo.secret_scanning_disabled": {
    impact: "GitHub secret scanning not enabled.",
    risk: "Leaked credentials may remain in git history.",
    fix: "Enable secret scanning and push protection.",
  },
  "github.repo.security_status_checks_missing": {
    impact: "Required security status checks not configured.",
    risk: "PRs can merge without security CI passing.",
    fix: "Add branch protection rules requiring security checks.",
  },
  "gitlab.repo.sast_disabled": {
    impact: "GitLab SAST not configured in CI.",
    risk: "Static analysis gaps before merge.",
    fix: "Add SAST template to .gitlab-ci.yml.",
  },
  "gitlab.repo.dependency_scanning_disabled": {
    impact: "GitLab dependency scanning not in CI.",
    risk: "Vulnerable dependencies may reach default branch.",
    fix: "Add dependency scanning job to CI pipeline.",
  },
  "gitlab.repo.container_scanning_disabled": {
    impact: "GitLab container scanning not in CI.",
    risk: "Container images may ship with known CVEs.",
    fix: "Add container scanning job to CI pipeline.",
  },
  "gitlab.repo.security_ci_not_required": {
    impact: "Security CI jobs not required before merge.",
    risk: "MRs can merge without passing security scans.",
    fix: "Require security jobs in protected branch settings.",
  },
  "google_workspace.org.mfa_not_enforced": {
    impact: "Google Workspace does not require 2-step verification.",
    risk: "Password-only Google accounts remain vulnerable to phishing.",
    fix: "Enforce 2SV for all users in Admin console.",
  },
  "google_workspace.user.inactive_90d": {
    impact: "Google Workspace user inactive 90+ days.",
    risk: "Stale accounts retain mailbox and SSO access.",
    fix: "Suspend or delete user after confirming no active use.",
  },
  "google_workspace.admin.unreviewed": {
    impact: "Google Workspace admin role unreviewed.",
    risk: "Privileged access may outlast job changes.",
    fix: "Confirm admin roles in Admin console → Admin roles.",
  },
  "entra.org.mfa_not_enforced": {
    impact: "Entra ID does not enforce MFA org-wide.",
    risk: "Password-only Microsoft accounts remain vulnerable.",
    fix: "Require MFA via Conditional Access policies.",
  },
  "entra.user.inactive_90d": {
    impact: "Entra user inactive 90+ days.",
    risk: "Stale accounts retain SSO and mailbox access.",
    fix: "Disable account after confirming no active dependency.",
  },
  "entra.admin.unreviewed": {
    impact: "Entra privileged role unreviewed.",
    risk: "Admin access may outlast role changes.",
    fix: "Review role assignments in Entra admin center.",
  },
  "identity_center.user.inactive_90d": {
    impact: "Identity Center user stale 90+ days.",
    risk: "Permission sets may still grant AWS console access.",
    fix: "Remove permission sets or delete user after review.",
  },
  "ecr.registry.enhanced_scanning_disabled": {
    impact: "ECR enhanced scanning not enabled.",
    risk: "Container CVEs may reach runtime unnoticed.",
    fix: "Enable enhanced scanning in ECR settings.",
  },
  "eks.cluster.control_plane_logging_disabled": {
    impact: "EKS control plane logging disabled.",
    risk: "Kubernetes API activity invisible to CloudWatch.",
    fix: "Enable api, audit, authenticator, controllerManager, and scheduler logs.",
  },
  "eks.cluster.secrets_encryption_disabled": {
    impact: "EKS secrets not encrypted with KMS.",
    risk: "etcd secrets readable without customer-managed key control.",
    fix: "Enable envelope encryption with a KMS key on the cluster.",
  },
  "ecs.cluster.container_insights_disabled": {
    impact: "ECS Container Insights disabled.",
    risk: "Limited observability for task failures and resource use.",
    fix: "Enable Container Insights on the cluster.",
  },
  "ecs.service.public_ip_enabled": {
    impact: "ECS service assigns public IP to tasks.",
    risk: "Tasks reachable from the internet if security groups allow.",
    fix: "Disable public IP; use NAT gateway or VPC endpoints.",
  },
  "ecs.task_definition.privileged_container": {
    impact: "ECS task runs a privileged container.",
    risk: "Container escape grants host-level access.",
    fix: "Remove privileged flag unless required; use specific Linux capabilities.",
  },
  "aws.vulnerability_monitoring.not_detected": {
    impact: "Container workloads are present but no image scanning evidence was found.",
    risk: "Container images may ship with known CVEs undetected before deployment.",
    fix: "Enable Inspector for ECR, ECR enhanced scanning, or scan-on-push on repositories.",
  },
  "aws.inspector.active_critical_finding": {
    impact: "Inspector reports an active critical vulnerability.",
    risk: "Exploitable CVE on a running workload.",
    fix: "Patch, upgrade, or isolate affected resource; suppress only with justification.",
  },
};

export const fallbackRemediationSummary: RemediationSummary = {
  impact: "Configuration does not meet this check.",
  risk: "Unresolved finding increases attack surface.",
  fix: "Review the resource and apply your security baseline.",
};

export function remediationSummaryFor(checkId: string): RemediationSummary {
  return remediationSummaries[checkId] ?? fallbackRemediationSummary;
}

/** Scope-aware copy for merged least-privilege finding. */
export function remediationSummaryForFinding(finding: {
  check_id: string;
  evidence?: Record<string, unknown>;
}): RemediationSummary {
  if (finding.check_id === "iam.role.least_privilege_policy") {
    const base = remediationSummaries["iam.role.least_privilege_policy"];
    const scope = finding.evidence?.scope;
    if (scope === "full_admin") {
      return {
        ...base,
        impact: "Policy grants Action:* on Resource:* (full admin).",
        risk: "Role has customer-managed Action:* and Resource:* (full admin).",
      };
    }
    if (scope === "wildcard_action") {
      return {
        ...base,
        impact: "Policy grants Action:* on scoped resources.",
        risk: "Role has customer-managed Action:* on scoped resources.",
      };
    }
    return base;
  }
  return remediationSummaryFor(finding.check_id);
}
