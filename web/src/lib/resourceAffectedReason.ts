import { remediationSummaryForFinding } from "../data/remediationSummaries";

export type ResourceAffectedFinding = {
  check_id: string;
  evidence?: Record<string, unknown>;
};

/** Static copy where evidence adds no per-resource detail beyond the check category. */
const STATIC_RESOURCE_AFFECTED_DETAIL: Record<string, string> = {
  "s3.bucket.public_access_not_blocked": "Bucket allows public access via all public access settings.",
  "s3.account.public_access_not_blocked":
    "Account level guardrails are off. One bucket misconfiguration can expose data.",
  "s3.bucket.no_https_policy": "No HTTPS only bucket policy. Objects may be read over HTTP.",
  "s3.bucket.no_kms": "Objects are stored without SSE KMS at rest.",
  "s3.bucket.no_logging": "Object-level reads and writes are not recorded to a log bucket.",
};

type EvidenceReasonBuilder = (evidence: Record<string, unknown>) => string | null;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function kmsKeyLabel(evidence: Record<string, unknown>): string {
  const alias = evidence.alias;
  if (typeof alias === "string" && alias.trim()) {
    return alias.startsWith("alias/") ? alias : `alias/${alias}`;
  }
  const keyId = evidence.key_id;
  if (typeof keyId === "string" && keyId.trim()) return keyId;
  return "this key";
}

function formatSgIngressReason(rules: unknown[], portLabel: string): string | null {
  if (!Array.isArray(rules) || rules.length === 0) return null;
  const rule = rules[0];
  if (!rule || typeof rule !== "object") return null;
  const record = rule as Record<string, unknown>;
  const cidr = typeof record.cidr === "string" ? record.cidr : "0.0.0.0/0";
  const fromPort = asNumber(record.from_port);
  const toPort = asNumber(record.to_port);
  const matchReason = record.match_reason;

  if (matchReason === "all_traffic") {
    return `Allows all traffic from ${cidr} (includes ${portLabel}).`;
  }
  if (matchReason === "wide_range" && fromPort != null && toPort != null) {
    return `Allows ${cidr} on TCP ${fromPort}–${toPort} (includes ${portLabel}).`;
  }
  if (fromPort != null && toPort != null) {
    if (fromPort === toPort) return `Allows ${cidr} on port ${fromPort}.`;
    return `Allows ${cidr} on ports ${fromPort}–${toPort}.`;
  }
  return `Allows ${cidr} (${portLabel}).`;
}

const EVIDENCE_REASON_BUILDERS: Record<string, EvidenceReasonBuilder> = {
  "iam.role.least_privilege_policy": (evidence) => {
    const sources = asStringArray(evidence.sources);
    if (sources.length) return `Granted via ${sources.join("; ")}.`;
    const scope = evidence.scope;
    if (scope === "full_admin") return "Grants full admin (Action:* + Resource:*).";
    if (scope === "wildcard_action") return "Grants Action:* on scoped resources.";
    return null;
  },

  "iam.user.admin_policy_attached": (evidence) => {
    const policies = asStringArray(evidence.admin_policies);
    if (!policies.length) return null;
    return `Admin policy attached: ${policies.join(", ")}.`;
  },

  "iam.role.external_account_trust": (evidence) => {
    const accounts = asStringArray(evidence.external_account_ids);
    if (!accounts.length) return null;
    return `Trusts external AWS account ${accounts.join(", ")}.`;
  },

  "iam.role.trust_wildcard": () => "Trust policy allows any principal (*).",

  "iam.policy.wildcard_resource": (evidence) => {
    const names = asStringArray(evidence.policy_names);
    if (!names.length) return null;
    return `Grants write actions on Resource:* in ${names.join(", ")}.`;
  },

  "iam.perm.granted_vs_used": (evidence) => {
    const unused = asStringArray(evidence.unused_write_actions);
    const pct = asNumber(evidence.unused_pct);
    if (!unused.length && pct == null) return null;
    const pctPart = pct != null ? `${pct}% of granted write actions` : "Granted write actions";
    const countPart = unused.length ? ` (${unused.length} unused)` : "";
    return `${pctPart} unused in 90 days${countPart}.`;
  },

  "iam.role.unused_services_90d": (evidence) => {
    const unused = asStringArray(evidence.unused_services);
    if (!unused.length) return null;
    const preview = unused.slice(0, 4).join(", ");
    const suffix = unused.length > 4 ? ` (+${unused.length - 4} more)` : "";
    return `Unused services: ${preview}${suffix}.`;
  },

  "iam.access_key.unused_90d": (evidence) => {
    const days = asNumber(evidence.days_unused);
    if (days == null) return null;
    return `No use recorded in ${days}+ days.`;
  },

  "iam.access_key.unused_45d": (evidence) => {
    const days = asNumber(evidence.days_unused);
    if (days == null) return null;
    return `No use recorded in ${days}+ days.`;
  },

  "iam.access_key.no_rotation_90d": (evidence) => {
    const age = asNumber(evidence.age_days);
    if (age == null) return null;
    const threshold = asNumber(evidence.threshold_days) ?? 90;
    return `Key is ${age} days old (rotation threshold ${threshold}).`;
  },

  "iam.role.unassumed_90d": (evidence) => {
    const days = asNumber(evidence.days_since_used);
    if (days == null) return null;
    return `Not assumed in ${days}+ days.`;
  },

  "ec2.security_group.unrestricted_ssh": (evidence) =>
    formatSgIngressReason(Array.isArray(evidence.exposing_rules) ? evidence.exposing_rules : [], "SSH") ??
    (typeof evidence.group_name === "string" ? `Group \`${evidence.group_name}\` allows SSH from the internet.` : null),

  "ec2.security_group.unrestricted_rdp": (evidence) =>
    formatSgIngressReason(Array.isArray(evidence.exposing_rules) ? evidence.exposing_rules : [], "RDP") ??
    (typeof evidence.group_name === "string" ? `Group \`${evidence.group_name}\` allows RDP from the internet.` : null),

  "ec2.security_group.default_allows_traffic": (evidence) => {
    const parts: string[] = [];
    if (evidence.has_inbound_rules === true) parts.push("non-default inbound rules");
    if (evidence.has_outbound_rules === true) parts.push("non-default outbound rules");
    if (!parts.length) return null;
    return `Default security group has ${parts.join(" and ")}.`;
  },

  "kms.key.policy_wildcard_principal": (evidence) =>
    `Key policy for ${kmsKeyLabel(evidence)} allows principal *.`,

  "kms.key.no_rotation": (evidence) =>
    `Automatic rotation is disabled for ${kmsKeyLabel(evidence)}.`,

  "elb.load_balancer.weak_tls_policy": (evidence) => {
    const policy = evidence.ssl_policy;
    if (typeof policy !== "string" || !policy.trim()) return null;
    return `Uses weak TLS policy ${policy}.`;
  },

  "lambda.function.deprecated_runtime": (evidence) => {
    const runtime = evidence.runtime;
    if (typeof runtime !== "string" || !runtime.trim()) return null;
    return `Runtime ${runtime} is deprecated or end-of-life.`;
  },

  "acm.certificate.expiring": (evidence) => {
    const domain = evidence.domain_name;
    const expiresAt = evidence.expires_at;
    if (typeof domain === "string" && typeof expiresAt === "string") {
      return `Certificate for ${domain} expires ${expiresAt.slice(0, 10)}.`;
    }
    if (typeof domain === "string") return `Certificate for ${domain} is expiring soon.`;
    return null;
  },
};

/** One-line reason for the Resources table — scoped to this resource, not the finding title. */
export function resourceAffectedReason(finding: ResourceAffectedFinding): string {
  const staticOverride = STATIC_RESOURCE_AFFECTED_DETAIL[finding.check_id];
  if (staticOverride) return staticOverride;

  const builder = EVIDENCE_REASON_BUILDERS[finding.check_id];
  if (builder) {
    const reason = builder(finding.evidence ?? {});
    if (reason) return reason;
  }

  const summary = remediationSummaryForFinding(finding);
  return (summary.risk || summary.impact).replace(/\s*—\s*/g, ". ");
}
