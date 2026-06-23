/**
 * Per-check documentation: what the scanner evaluates and why the finding exists.
 * Detailed overrides below; all other checks with remediationSummaries fall back automatically.
 */
import { complianceCopyForCheck, scanDescriptionForCheck } from "./checkComplianceCopy";
import { remediationSummaries } from "./remediationSummaries";

export type CheckDocumentation = {
  whatWeCheck: string;
  whyShown: string;
  overview?: {
    context?: string;
    exposure?: string;
    fix?: string;
  };
  /** Drawer Compliance tab — check-specific auditor copy (not whole-control catalog text). */
  compliance?: {
    evidenceGuidance?: string;
    auditNarrative?: string;
  };
};

/** Hand-authored copy for checks that confuse users without extra context. */
const checkDocumentationOverrides: Record<string, CheckDocumentation> = {
  "ec2.security_group.default_allows_traffic": {
    whatWeCheck:
      "In each VPC, AWS creates a security group named default. Veritrail flags that group when it has any inbound or outbound rules. An empty default SG (no custom rules) is what we treat as passing.",
    whyShown:
      "This is not saying your instances are wide open right now. It means: if someone launches a resource without choosing a security group, AWS attaches the default SG — and any rules on it become that resource's firewall. CIS and SOC 2 expect the default SG to stay empty so accidental launches do not inherit permissive rules.",
    overview: {
      context:
        "Every VPC has a default security group. AWS auto-attaches it to ENIs/instances when no other SG is specified at launch.",
      exposure:
        "Custom rules on the default SG apply to anything that lands on it by mistake — a common source of 'we thought it was locked down' gaps.",
      fix:
        "Remove inbound/outbound rules from each VPC's default SG; put real rules on named security groups and attach those explicitly to workloads.",
    },
  },
  "iam.role.external_account_trust": {
    whatWeCheck:
      "We read each IAM role's trust policy (AssumeRolePolicyDocument). If an Allow statement grants sts:AssumeRole to a principal in another AWS account (12-digit account ID ≠ yours), we open a finding. VeritrailReadOnly and trust limited to your Veritrail scan principal are excluded.",
    whyShown:
      "Cross-account role trust is how vendors, partners, or compromised third parties access your account. It is mapped to SOC 2 external-access controls — not a CIS line item. Expected integrations (e.g. your read-only scan role) should not appear after a re-scan.",
    overview: {
      context:
        "The trust policy defines who may assume the role. External account IDs in Principal.AWS are intentional cross-account access paths.",
      exposure:
        "A role assumed from outside your account can use every permission attached to that role until trust or policies are tightened.",
      fix:
        "Confirm each external account is approved; remove stale principals or add ExternalId / condition keys to narrow assumption.",
    },
  },
  "iam.root.no_mfa": {
    whatWeCheck:
      "We read the root user's MFA status from IAM. If no virtual or hardware MFA device is assigned, we open this finding.",
    whyShown:
      "Root credentials bypass normal IAM boundaries. SOC 2 and CIS require MFA on the root account because a single compromised password grants full account control.",
    overview: {
      context: "The AWS account root user is the ultimate break-glass identity.",
      exposure: "Without MFA, a leaked root password alone is sufficient for full account takeover.",
      fix: "Sign in as root → Security credentials → assign a hardware MFA device (virtual MFA is discouraged for root).",
    },
  },
  "iam.user.no_mfa": {
    whatWeCheck:
      "For IAM users with console access enabled, we verify MFA is assigned on the user (virtual or hardware device). No MFA on console-capable users → finding.",
    whyShown:
      "Password-only console sign-in fails most SOC 2 / CIS identity controls. This check is about requiring a second factor for console login — not deleting the user or removing access keys.",
    overview: {
      context:
        "Console users without MFA can be fully compromised with a stolen password alone.",
      exposure:
        "Phished or leaked passwords grant interactive AWS Console access until MFA is enforced.",
      fix:
        "Assign an MFA device on the user's Security credentials tab. Access keys are unchanged until you rotate them separately.",
    },
  },
  "iam.policy.unattached": {
    whatWeCheck:
      "We list customer-managed IAM policies in your account and flag any with zero attachments to users, groups, or roles.",
    whyShown:
      "Optional hygiene only — off by default in Settings. Not mapped to SOC 2, CIS, or ISO controls. Useful for IAM cleanup, not benchmark pass/fail.",
  },
  "github.repo.no_codeowners": {
    whatWeCheck:
      "After Git sync, we look for a CODEOWNERS file in `/`, `.github/`, or `docs/` on GitHub. If none exists, we flag the repository.",
    whyShown:
      "Optional security check — off by default. SOC 2 change-management evidence uses branch protection and required PR reviews, not CODEOWNERS alone.",
  },
  "gitlab.repo.no_codeowners": {
    whatWeCheck:
      "After Git sync, we look for CODEOWNERS at the repo root, `.gitlab/CODEOWNERS`, or `docs/CODEOWNERS` on GitLab. If none exists, we flag the project.",
    whyShown:
      "Optional security check — off by default, same toggle as other Git CODEOWNERS checks. SOC 2 change-management evidence uses branch protection and required MR approvals, not CODEOWNERS alone.",
  },
};

function fromSummary(checkId: string): CheckDocumentation | null {
  const s = remediationSummaries[checkId];
  if (!s) return null;
  const compliance = complianceCopyForCheck(checkId);
  return {
    whatWeCheck: scanDescriptionForCheck(checkId, s),
    whyShown: s.risk,
    overview: {
      context: s.impact,
      exposure: s.risk,
      fix: s.fix,
    },
    ...(compliance ? { compliance } : {}),
  };
}

export function documentationForCheck(checkId: string): CheckDocumentation | null {
  const base = checkDocumentationOverrides[checkId] ?? fromSummary(checkId);
  if (!base) return null;
  if (base.compliance) return base;
  const compliance = complianceCopyForCheck(checkId);
  return compliance ? { ...base, compliance } : base;
}

export function allDocumentedCheckIds(): string[] {
  const ids = new Set<string>(Object.keys(checkDocumentationOverrides));
  for (const id of Object.keys(remediationSummaries)) {
    ids.add(id);
  }
  return [...ids].sort();
}
