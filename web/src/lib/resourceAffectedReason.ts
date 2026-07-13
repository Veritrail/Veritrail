import { remediationSummaryForFinding } from "../data/remediationSummaries";

export type ResourceAffectedFinding = {
  check_id: string;
  evidence?: Record<string, unknown>;
};

export type ResourceAffectedReason = {
  title: string;
  detail: string;
};

/** Static copy where evidence adds no per-resource detail beyond the check category. */
const STATIC_RESOURCE_AFFECTED_DETAIL: Record<string, ResourceAffectedReason> = {
  "s3.bucket.public_access_not_blocked": {
    title: "Public-access protection is incomplete",
    detail: "Bucket policy or ACL can expose data",
  },
  "s3.account.public_access_not_blocked":
    { title: "Account-wide public-access guardrails are off", detail: "One bucket change can expose data" },
  "s3.bucket.no_https_policy": {
    title: "Bucket accepts unencrypted HTTP",
    detail: "Data can be intercepted in transit",
  },
  "s3.bucket.no_kms": {
    title: "Bucket lacks KMS-backed encryption",
    detail: "No customer-controlled key protection",
  },
  "s3.bucket.no_logging": {
    title: "Bucket access is not logged",
    detail: "Reads and writes leave no access trail",
  },
};

type EvidenceReasonBuilder = (evidence: Record<string, unknown>) => ResourceAffectedReason | null;

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

function formatSgIngressReason(rules: unknown[], portLabel: string): ResourceAffectedReason | null {
  if (!Array.isArray(rules) || rules.length === 0) return null;
  const rule = rules[0];
  if (!rule || typeof rule !== "object") return null;
  const record = rule as Record<string, unknown>;
  const cidr = typeof record.cidr === "string" ? record.cidr : "0.0.0.0/0";
  const fromPort = asNumber(record.from_port);
  const toPort = asNumber(record.to_port);
  const matchReason = record.match_reason;

  if (matchReason === "all_traffic") {
    return { title: `Internet-exposed ${portLabel}`, detail: `All traffic · ${cidr}` };
  }
  if (matchReason === "wide_range" && fromPort != null && toPort != null) {
    return { title: `Internet-exposed ${portLabel}`, detail: `${cidr} · TCP ${fromPort}–${toPort}` };
  }
  if (fromPort != null && toPort != null) {
    const ports = fromPort === toPort ? `Port ${fromPort}` : `Ports ${fromPort}–${toPort}`;
    return { title: `Internet-exposed ${portLabel}`, detail: `${cidr} · ${ports}` };
  }
  return { title: `Internet-exposed ${portLabel}`, detail: `Public access · ${cidr}` };
}

function policySourceDetail(source: string): string {
  const [kind, ...nameParts] = source.split(":");
  const names = nameParts.join(":").trim();
  const label = kind.startsWith("inline") ? "Inline policy" : "Customer-managed";
  return names ? `${label} · ${names}` : label;
}

function withoutFinalPeriod(value: string): string {
  return value.trim().replace(/[.]$/, "");
}

const EVIDENCE_REASON_BUILDERS: Record<string, EvidenceReasonBuilder> = {
  "iam.role.least_privilege_policy": (evidence) => {
    const sources = asStringArray(evidence.sources);
    const scope = evidence.scope;
    if (sources.length) {
      return {
        title: scope === "full_admin" || sources.some((source) => source.includes("full admin"))
          ? "Role has full administrator access"
          : "Role grants wildcard actions",
        detail: sources.map(policySourceDetail).join(" · "),
      };
    }
    if (scope === "full_admin") return { title: "Role has full administrator access", detail: "Action:* · Resource:*" };
    if (scope === "wildcard_action") return { title: "Role grants wildcard actions", detail: "Action:* · Scoped resources" };
    return null;
  },

  "iam.user.admin_policy_attached": (evidence) => {
    const policies = asStringArray(evidence.admin_policies);
    if (!policies.length) return null;
    return { title: "User has full administrator access", detail: `Managed policy · ${policies.join(", ")}` };
  },

  "iam.role.external_account_trust": (evidence) => {
    const accounts = asStringArray(evidence.external_account_ids);
    if (!accounts.length) return null;
    return { title: "External AWS account can assume this role", detail: `Trusted · ${accounts.join(", ")}` };
  },

  "iam.role.trust_wildcard": () => ({ title: "Any AWS principal can assume this role", detail: "Principal:*" }),

  "iam.policy.wildcard_resource": (evidence) => {
    const names = asStringArray(evidence.policy_names);
    if (!names.length) return null;
    return { title: "Write access spans every resource", detail: `Resource:* · ${names.join(", ")}` };
  },

  "iam.perm.granted_vs_used": (evidence) => {
    const unused = asStringArray(evidence.unused_write_actions);
    const pct = asNumber(evidence.unused_pct);
    if (!unused.length && pct == null) return null;
    const amount = pct != null ? `${pct}% unused` : `${unused.length} unused`;
    return { title: "Role retains unused write access", detail: `${amount} · 90 days` };
  },

  "iam.role.unused_services_90d": (evidence) => {
    const unused = asStringArray(evidence.unused_services);
    if (!unused.length) return null;
    const preview = unused.slice(0, 4).join(", ");
    const suffix = unused.length > 4 ? ` (+${unused.length - 4} more)` : "";
    return { title: "Role retains unused service access", detail: `${preview}${suffix} · 90 days` };
  },

  "iam.user.credentials_unused_45d": (evidence) => {
    const days = asNumber(evidence.days_inactive);
    if (days == null) return null;
    return { title: "Inactive console user still has access", detail: `No sign-in · ${days}+ days` };
  },

  "iam.access_key.unused_90d": (evidence) => {
    const days = asNumber(evidence.days_unused);
    if (days == null) return null;
    return { title: "Unused access key remains active", detail: `No use · ${days}+ days` };
  },

  "iam.access_key.unused_45d": (evidence) => {
    const days = asNumber(evidence.days_unused);
    if (days == null) return null;
    return { title: "Unused access key remains active", detail: `No use · ${days}+ days` };
  },

  "iam.access_key.no_rotation_90d": (evidence) => {
    const age = asNumber(evidence.age_days);
    if (age == null) return null;
    const threshold = asNumber(evidence.threshold_days) ?? 90;
    return { title: "Access key rotation is overdue", detail: `${age} days old · ${threshold}-day limit` };
  },

  "iam.role.unassumed_90d": (evidence) => {
    const days = asNumber(evidence.days_since_used);
    if (days == null) return null;
    return { title: "Stale IAM role still grants access", detail: `Not assumed · ${days}+ days` };
  },

  "ec2.security_group.unrestricted_ssh": (evidence) =>
    formatSgIngressReason(Array.isArray(evidence.exposing_rules) ? evidence.exposing_rules : [], "SSH") ??
    (typeof evidence.group_name === "string" ? { title: "Internet-exposed SSH", detail: `Security group · ${evidence.group_name}` } : null),

  "ec2.security_group.unrestricted_rdp": (evidence) =>
    formatSgIngressReason(Array.isArray(evidence.exposing_rules) ? evidence.exposing_rules : [], "RDP") ??
    (typeof evidence.group_name === "string" ? { title: "Internet-exposed RDP", detail: `Security group · ${evidence.group_name}` } : null),

  "ec2.security_group.default_allows_traffic": (evidence) => {
    const parts: string[] = [];
    if (evidence.has_inbound_rules === true) parts.push("non-default inbound rules");
    if (evidence.has_outbound_rules === true) parts.push("non-default outbound rules");
    if (!parts.length) return null;
    return { title: "Default security group permits traffic", detail: parts.join(" and ") };
  },

  "kms.key.policy_wildcard_principal": (evidence) =>
    ({ title: "KMS key permits any principal", detail: `Principal:* · ${kmsKeyLabel(evidence)}` }),

  "kms.key.no_rotation": (evidence) =>
    ({ title: "KMS key is not rotating", detail: kmsKeyLabel(evidence) }),

  "elb.load_balancer.weak_tls_policy": (evidence) => {
    const policy = evidence.ssl_policy;
    if (typeof policy !== "string" || !policy.trim()) return null;
    return { title: "Load balancer uses weak TLS", detail: policy };
  },

  "lambda.function.deprecated_runtime": (evidence) => {
    const runtime = evidence.runtime;
    if (typeof runtime !== "string" || !runtime.trim()) return null;
    return { title: "Lambda runs an unsupported runtime", detail: `${runtime} · No security fixes` };
  },

  "acm.certificate.expiring": (evidence) => {
    const domain = evidence.domain_name;
    const expiresAt = evidence.expires_at;
    if (typeof domain === "string" && typeof expiresAt === "string") {
      return { title: "Certificate expires soon", detail: `${domain} · ${expiresAt.slice(0, 10)}` };
    }
    if (typeof domain === "string") return { title: "Certificate expires soon", detail: domain };
    return null;
  },
};

/** Compact, two-level reason for the Resources table. */
export function resourceAffectedReasonParts(finding: ResourceAffectedFinding): ResourceAffectedReason {
  const staticOverride = STATIC_RESOURCE_AFFECTED_DETAIL[finding.check_id];
  if (staticOverride) return staticOverride;

  const builder = EVIDENCE_REASON_BUILDERS[finding.check_id];
  if (builder) {
    const reason = builder(finding.evidence ?? {});
    if (reason) return reason;
  }

  const summary = remediationSummaryForFinding(finding);
  return {
    title: withoutFinalPeriod(summary.impact),
    detail: withoutFinalPeriod(summary.risk).replace(/\s*—\s*/g, " · "),
  };
}

/** Plain-text form used by CSV export and accessible labels. */
export function resourceAffectedReason(finding: ResourceAffectedFinding): string {
  const { title, detail } = resourceAffectedReasonParts(finding);
  return detail ? `${title} — ${detail}` : title;
}
