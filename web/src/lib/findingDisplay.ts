export type FindingLike = {
  check_id: string;
  resource_arn: string;
  evidence: Record<string, unknown>;
  first_seen: string;
  risk_score: number;
  severity: string;
};

/** IAM root identity findings (arn:...:root or iam.root.* checks). */
export function isAwsRootFinding(f: FindingLike): boolean {
  if (f.check_id.startsWith("iam.root")) return true;
  if (isVcsResourceIdentifier(f.resource_arn)) return false;
  const tail = f.resource_arn.split(":").pop() ?? "";
  return tail === "root";
}

export function resourceName(arn: string): string {
  const parts = arn.split(":");
  const region = parts[3] ?? "";
  const tail = parts.pop() ?? arn;
  const [, rest = tail] = tail.split(/\/(.+)/);
  const [name, suffix] = rest.split("#");
  const label = name || rest;
  const generic = ["detector", "trail", "vpc", "flow-log", "security-group"].includes(label);
  if (generic && region) return region;
  if (!suffix) return label;
  const masked = suffix.length > 12 ? `${suffix.slice(0, 4)}…${suffix.slice(-4)}` : suffix;
  return `${label} · ${masked}`;
}

/** Regional account-level checks (Access Analyzer, GuardDuty, etc.) store regions in evidence. */
export function regionsFromFindingEvidence(ev: Record<string, unknown>): string[] {
  const raw = ev.disabled_regions ?? ev.affected_regions;
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is string => typeof r === "string" && r.trim().length > 0);
}

function evidenceString(e: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = e[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** AWS region from a standard ARN (empty partition segment for global S3 → us-east-1). */
export function resourceRegionForFinding(f: FindingLike): string {
  const fromEvidence = evidenceString(f.evidence, "region", "home_region");
  if (fromEvidence) return fromEvidence;
  return awsRegionFromArn(f.resource_arn) ?? "us-east-1";
}

export function awsRegionFromArn(arn: string): string | null {
  const parts = arn.split(":");
  if (parts.length < 4) return null;
  if (parts[2] === "s3" && !parts[3]) return "us-east-1";
  return parts[3] || null;
}

export function isVcsResourceIdentifier(arn: string): boolean {
  return arn.startsWith("github://") || arn.startsWith("gitlab://");
}

function vcsProviderFromArn(arn: string): "github" | "gitlab" | null {
  if (arn.startsWith("github://")) return "github";
  if (arn.startsWith("gitlab://")) return "gitlab";
  return null;
}

function gitlabHostFromEvidence(e: Record<string, unknown>): string {
  const raw = evidenceString(e, "base_url", "gitlab_url") ?? "https://gitlab.com";
  return raw.replace(/\/$/, "");
}

/** Readable path for github:// or gitlab:// resource identifiers (not AWS ARNs). */
export function vcsResourcePath(arn: string): string {
  const rest = arn.replace(/^github:\/\//, "").replace(/^gitlab:\/\//, "").replace(/^\/+/, "");
  const normalized = rest.replace(/^(repo|org)\//, "");
  if (!normalized) return arn;
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function vcsRepoSlug(f: FindingLike): string | null {
  const repo = evidenceString(f.evidence, "repo", "repo_name", "full_name");
  if (repo) return repo.replace(/^\/+/, "");
  const path = vcsResourcePath(f.resource_arn).replace(/^\/+/, "");
  return path || null;
}

function vcsOrgSlug(f: FindingLike): string | null {
  const org = evidenceString(f.evidence, "source", "org", "organization");
  if (org) return org.replace(/^\/+/, "");
  if (f.resource_arn.includes("://org/")) {
    const match = f.resource_arn.match(/:\/\/org\/([^/?#]+)/);
    if (match?.[1]) return match[1];
  }
  const slug = vcsRepoSlug(f);
  if (!slug) return null;
  return slug.split("/")[0] ?? null;
}

/** https://github.com/org/repo or GitLab project URL for a VCS finding. */
export function vcsResourceWebUrl(f: FindingLike): string | null {
  const provider = vcsProviderFromArn(f.resource_arn);
  if (!provider) return null;

  if (f.check_id.includes(".org.")) {
    const org = vcsOrgSlug(f);
    if (!org) return null;
    if (provider === "github") return `https://github.com/${org}`;
    return `${gitlabHostFromEvidence(f.evidence)}/${org}`;
  }

  const slug = vcsRepoSlug(f);
  if (!slug) return null;
  if (provider === "github") return `https://github.com/${slug}`;
  return `${gitlabHostFromEvidence(f.evidence)}/${slug}`;
}

export function resourceIdentifierLabel(arn: string): string {
  if (!isVcsResourceIdentifier(arn)) return "ARN";
  if (arn.includes("://org/")) return "Organization";
  return "Repository";
}

export function resourceIdentifierValue(f: FindingLike): string {
  if (!isVcsResourceIdentifier(f.resource_arn)) return f.resource_arn;
  return vcsResourceWebUrl(f) ?? vcsResourcePath(f.resource_arn);
}

export type ResourceDetailRow = {
  label: string;
  value: string;
  mono?: boolean;
};

export function resourceDetailRowsFromFinding(f: FindingLike): ResourceDetailRow[] {
  const e = f.evidence;
  const rows: ResourceDetailRow[] = [];
  const push = (label: string, value: string | null | undefined, mono = false) => {
    if (value) rows.push({ label, value, mono });
  };

  const cid = f.check_id;

  if (cid.startsWith("ec2.security_group.")) {
    push("Name", evidenceString(e, "group_name"));
    push("Security group", evidenceString(e, "group_id"), true);
    push("Region", evidenceString(e, "region") ?? awsRegionFromArn(f.resource_arn), true);
    push("VPC", evidenceString(e, "vpc_id"), true);
    if (e.is_default === true) push("Default SG", "Yes");
    return rows;
  }

  if (cid.startsWith("vpc.")) {
    push("VPC", evidenceString(e, "vpc_id"), true);
    push("Region", evidenceString(e, "region") ?? awsRegionFromArn(f.resource_arn), true);
    return rows;
  }

  if (cid.startsWith("iam.access_key")) {
    push("Access key", evidenceString(e, "key_id"), true);
    push("IAM user", evidenceString(e, "user_name", "user_arn"));
    return rows;
  }

  if (cid.startsWith("iam.user.")) {
    push("IAM user", evidenceString(e, "user_name", "user_arn"));
    return rows;
  }

  if (cid.startsWith("iam.role.")) {
    return rows;
  }

  if (cid.startsWith("s3.bucket.") || cid.startsWith("s3.")) {
    push("Bucket", evidenceString(e, "bucket_name", "name"));
    return rows;
  }

  if (cid.startsWith("kms.")) {
    push("Key", evidenceString(e, "key_id"), true);
    push("Alias", evidenceString(e, "alias"));
    return rows;
  }

  if (cid.startsWith("rds.")) {
    push("Instance", evidenceString(e, "db_instance_id"), true);
    push("Engine", evidenceString(e, "engine"));
    push("Region", evidenceString(e, "region") ?? awsRegionFromArn(f.resource_arn), true);
    return rows;
  }

  if (cid.startsWith("dynamodb.")) {
    push("Table", evidenceString(e, "table_name"), true);
    push("Region", evidenceString(e, "region") ?? awsRegionFromArn(f.resource_arn), true);
    return rows;
  }

  if (cid.startsWith("ec2.instance") || cid === "ec2.imdsv2.not_required") {
    push("Instance", evidenceString(e, "instance_id"), true);
    push("Type", evidenceString(e, "instance_type"));
    push("Region", evidenceString(e, "region") ?? awsRegionFromArn(f.resource_arn), true);
    return rows;
  }

  if (cid.startsWith("ec2.ebs") || cid.startsWith("ebs.")) {
    push("Volume", evidenceString(e, "volume_id"), true);
    push("Snapshot", evidenceString(e, "snapshot_id"), true);
    push("Region", evidenceString(e, "region") ?? awsRegionFromArn(f.resource_arn), true);
    return rows;
  }

  if (cid.startsWith("lambda.")) {
    push("Function", evidenceString(e, "function_name"));
    push("Runtime", evidenceString(e, "runtime"));
    push("Region", evidenceString(e, "region") ?? awsRegionFromArn(f.resource_arn), true);
    return rows;
  }

  if (cid.startsWith("cloudtrail.")) {
    push("Trail", evidenceString(e, "trail_name", "name"));
    push("Home region", evidenceString(e, "home_region", "region"), true);
    return rows;
  }

  if (cid.startsWith("ssm.")) {
    push("Parameter", evidenceString(e, "parameter_name"), true);
    push("Type", evidenceString(e, "parameter_type"));
    push("Region", evidenceString(e, "region") ?? awsRegionFromArn(f.resource_arn), true);
    return rows;
  }

  if (cid.startsWith("secretsmanager.")) {
    push("Secret", evidenceString(e, "secret_name", "name"));
    push("Region", evidenceString(e, "region") ?? awsRegionFromArn(f.resource_arn), true);
    return rows;
  }

  if (cid.startsWith("elb.") || cid.startsWith("elasticloadbalancing.")) {
    push("Load balancer", evidenceString(e, "name", "load_balancer_name"));
    push("Region", evidenceString(e, "region") ?? awsRegionFromArn(f.resource_arn), true);
    return rows;
  }

  if (cid.startsWith("sns.") || cid.startsWith("sqs.")) {
    push("Name", evidenceString(e, "topic_name", "queue_name", "name"));
    push("Region", evidenceString(e, "region") ?? awsRegionFromArn(f.resource_arn), true);
    return rows;
  }

  if (cid.startsWith("acm.")) {
    push("Domain", evidenceString(e, "domain_name"));
    push("Region", evidenceString(e, "region") ?? awsRegionFromArn(f.resource_arn), true);
    return rows;
  }

  if (cid.startsWith("github.") || cid.startsWith("gitlab.")) {
    return rows;
  }

  push("Region", evidenceString(e, "region", "home_region") ?? awsRegionFromArn(f.resource_arn), true);
  return rows;
}

/** Detail row labels that repeat the resource name already shown in the picker / hero. */
const RESOURCE_IDENTITY_DETAIL_LABELS = new Set([
  "Access key",
  "Bucket",
  "Domain",
  "Function",
  "Instance",
  "Key",
  "Load balancer",
  "Name",
  "Parameter",
  "Secret",
  "Security group",
  "Table",
  "Trail",
  "Volume",
  "VPC",
  "IAM user",
]);

/** Canonical names for the affected resource (list label, hero title, ARN tail). */
export function resourcePrimaryIdentifiers(f: FindingLike): Set<string> {
  const ids = new Set<string>();
  const add = (s: string | null | undefined) => {
    const t = s?.trim();
    if (t) ids.add(t);
  };
  add(resourceShortName(f));
  add(resourceDisplayName(f));
  add(resourceName(f.resource_arn));
  const short = resourceShortName(f).trim();
  if (short.includes(" · ")) add(short.split(" · ")[0]);
  const paren = short.match(/^(.+?)\s+\([^)]+\)$/);
  if (paren) add(paren[1].trim());
  return ids;
}

/** Drop identity rows whose value is already shown above in the inspector. */
export function filterRedundantResourceDetailRows(
  rows: ResourceDetailRow[],
  f: FindingLike,
): ResourceDetailRow[] {
  const primaryIds = resourcePrimaryIdentifiers(f);
  return rows.filter((row) => {
    if (!RESOURCE_IDENTITY_DETAIL_LABELS.has(row.label)) return true;
    return !primaryIds.has(row.value.trim());
  });
}

/** Primary resource label without region suffix (Resources tab detail). */
export function resourceShortName(f: FindingLike): string {
  const e = f.evidence;
  const pick = (...keys: string[]) => evidenceString(e, ...keys);
  if (f.check_id.startsWith("ec2.security_group.")) {
    return pick("group_name") ?? resourceName(f.resource_arn);
  }
  const full = resourceDisplayName(f);
  const region = pick("region") ?? awsRegionFromArn(f.resource_arn);
  if (region && full.endsWith(` · ${region}`)) return full.slice(0, -(region.length + 3));
  if (region && full.endsWith(` (${region})`)) return full.slice(0, -(region.length + 3));
  return full;
}

export function resourceDisplayName(f: FindingLike): string {
  const e = f.evidence;
  if (isVcsResourceIdentifier(f.resource_arn)) {
    return vcsResourceWebUrl(f) ?? vcsResourcePath(f.resource_arn);
  }
  const regions = regionsFromFindingEvidence(e);
  if (regions.length > 0) {
    const n = typeof e.region_count === "number" ? e.region_count : regions.length;
    return `${n} region${n === 1 ? "" : "s"}`;
  }
  const pick = (...keys: string[]) => evidenceString(e, ...keys);
  if (f.check_id.startsWith("ec2.security_group.")) {
    const name = pick("group_name") ?? resourceName(f.resource_arn);
    const region = pick("region") ?? awsRegionFromArn(f.resource_arn);
    const gid = pick("group_id");
    if (region && gid) return `${name} · ${region}`;
    if (region) return `${name} (${region})`;
    return name;
  }
  return (
    pick(
      "user_name",
      "role_name",
      "bucket_name",
      "table_name",
      "key_id",
      "trail_name",
      "group_name",
      "repo_name",
      "instance_id",
      "volume_id",
      "function_name",
      "secret_name",
      "topic_name",
      "queue_name",
      "load_balancer_name",
      "policy_name",
      "db_instance_id",
      "vpc_id",
      "parameter_name"
    ) ?? resourceName(f.resource_arn)
  );
}

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  "iam.user": "IAM users",
  "iam.role": "IAM roles",
  "iam.access_key": "Access keys",
  "iam.root": "Root account",
  "iam.policy": "IAM policies",
  "iam.account": "Account settings",
  "iam.perm": "IAM permissions",
  "s3.bucket": "S3 buckets",
  "s3.account": "S3 account",
  "kms.key": "KMS keys",
  "dynamodb.table": "DynamoDB tables",
  "lambda.function": "Lambda functions",
  "ec2.instance": "EC2 instances",
  "ec2.ebs": "EBS volumes",
  "ec2.security_group": "Security groups",
  "rds.instance": "RDS instances",
  "cloudtrail.trail": "CloudTrail trails",
  "github.repo": "Repositories",
  "github.org": "Organizations",
  "gitlab.repo": "Projects",
  "gitlab.org": "Groups",
};

export function resourceTypeLabel(checkId: string): string {
  const match = Object.entries(RESOURCE_TYPE_LABELS).find(([prefix]) => checkId.startsWith(prefix));
  if (match) return match[1];
  const parts = checkId.split(".");
  if (parts.length >= 2) {
    return `${parts[0].toUpperCase()} ${parts[1].replace(/_/g, " ")}s`;
  }
  return "Resources";
}

export function daysAgo(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "1 day ago";
  if (d < 30) return `${d} days ago`;
  if (d < 365) return `${Math.floor(d / 30)} mo ago`;
  return `${Math.floor(d / 365)} yr ago`;
}

export function severityLabel(sev: string): string {
  return sev.charAt(0).toUpperCase() + sev.slice(1);
}

/** Comma-separated preview of affected resource names for compact list rows. */
export function affectedResourcesPreview(items: FindingLike[], max = 3): string {
  const names = [...items]
    .sort((a, b) => resourceDisplayName(a).localeCompare(resourceDisplayName(b)))
    .map((f) => resourceDisplayName(f))
    .slice(0, max);
  const rest = items.length - names.length;
  if (rest > 0) return `${names.join(", ")} +${rest} more`;
  return names.join(", ");
}
