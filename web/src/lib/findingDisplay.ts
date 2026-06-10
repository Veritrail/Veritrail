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

export function vcsOrgSlugFromFinding(f: FindingLike): string | null {
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

export type FindingScopeProvider = "aws" | "github" | "gitlab";

export function isVcsFinding(f: { check_id: string; resource_arn?: string }): boolean {
  return (
    f.check_id.startsWith("github.") ||
    f.check_id.startsWith("gitlab.") ||
    (f.resource_arn ? isVcsResourceIdentifier(f.resource_arn) : false)
  );
}

export function findingScopeProvider(f: {
  check_id: string;
  account_provider?: string | null;
}): FindingScopeProvider {
  const p = (f.account_provider ?? "").toLowerCase();
  if (p === "github" || p === "gitlab") return p;
  if (f.check_id.startsWith("github.")) return "github";
  if (f.check_id.startsWith("gitlab.")) return "gitlab";
  return "aws";
}

/** 12-digit AWS account id from API or resource ARN (not Vigil's internal account uuid). */
export function awsAccountIdFromFinding(f: {
  aws_account_id?: string | null;
  resource_arn?: string;
}): string | null {
  const fromApi = (f.aws_account_id ?? "").trim();
  if (/^\d{12}$/.test(fromApi)) return fromApi;
  const parts = (f.resource_arn ?? "").split(":");
  if (parts.length > 4 && parts[2] === "aws" && /^\d{12}$/.test(parts[4] ?? "")) {
    return parts[4]!;
  }
  return null;
}

/** Display name for the Account column — AWS account alias or Git org/group. */
export function findingScopeDisplayName(
  f: FindingLike & {
    account_id?: string | null;
    account_name?: string | null;
    account_label?: string | null;
  },
  awsAccountsById?: Map<string, { label?: string | null; account_id?: string | null; account_name?: string | null }>,
): string {
  const provider = findingScopeProvider(f);
  if (provider !== "aws") {
    const fromApi = (f.account_name ?? f.account_label ?? "").trim();
    if (fromApi) return fromApi;
    return vcsOrgSlugFromFinding(f) ?? (provider === "github" ? "GitHub organization" : "GitLab group");
  }
  const acc = f.account_id ? awsAccountsById?.get(f.account_id) : undefined;
  if (acc) {
    if (acc.account_name?.trim()) return acc.account_name.trim();
    const label = (acc.label ?? "").trim();
    const aid = (acc.account_id ?? "").trim();
    if (label && label !== aid) return label;
    if (label) return label;
  }
  const fromApi = (f.account_name ?? f.account_label ?? "").trim();
  if (fromApi) return fromApi;
  return "AWS account";
}

/** https://github.com/org/repo or GitLab project URL for a VCS finding. */
export function vcsResourceWebUrl(f: FindingLike): string | null {
  const provider = vcsProviderFromArn(f.resource_arn);
  if (!provider) return null;

  if (f.check_id.includes(".org.")) {
    const org = vcsOrgSlugFromFinding(f);
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

/** Singular, compact label for list-row asset type pills (Orca-style). */
const RESOURCE_TYPE_PILL_LABELS: Record<string, string> = {
  "iam.user": "IAM user",
  "iam.role": "IAM role",
  "iam.access_key": "Access key",
  "iam.root": "Root account",
  "iam.policy": "IAM policy",
  "iam.account": "Account setting",
  "iam.perm": "IAM permission",
  "s3.bucket": "S3 bucket",
  "s3.account": "S3 account",
  "kms.key": "KMS key",
  "dynamodb.table": "DynamoDB table",
  "lambda.function": "Lambda function",
  "ec2.instance": "EC2 instance",
  "ec2.ebs": "EBS volume",
  "ec2.security_group": "Security group",
  "rds.instance": "RDS instance",
  "cloudtrail.trail": "CloudTrail trail",
  "cloudtrail.bucket": "CloudTrail bucket",
  "guardduty.detector": "GuardDuty",
  "guardduty.open": "GuardDuty finding",
  "aws.config": "AWS Config",
  "aws.securityhub": "Security Hub",
  "aws.account": "AWS account",
  "vpc.flow_logs": "VPC flow logs",
  "secretsmanager.secret": "Secrets Manager",
  "sns.topic": "SNS topic",
  "sqs.queue": "SQS queue",
  "elb.load_balancer": "Load balancer",
  "eks.cluster": "EKS cluster",
  "ecr.repository": "ECR repository",
  "ecs.cluster": "ECS cluster",
  "ecs.service": "ECS service",
  "ecs.task_definition": "ECS task definition",
  "acm.certificate": "ACM certificate",
  "ssm.parameter": "SSM parameter",
  "github.repo": "GitHub repo",
  "github.org": "GitHub org",
  "gitlab.repo": "GitLab project",
  "gitlab.org": "GitLab group",
};

export function resourceTypePillLabel(checkId: string): string {
  const match = Object.entries(RESOURCE_TYPE_PILL_LABELS).find(([prefix]) => checkId.startsWith(prefix));
  if (match) return match[1];
  const parts = checkId.split(".");
  if (parts.length >= 2) {
    const service = parts[0].toUpperCase();
    const noun = parts[1].replace(/_/g, " ");
    return `${service} ${noun}`;
  }
  return "AWS resource";
}

export type ResourceTypeIconKind =
  | "iam"
  | "s3"
  | "kms"
  | "ec2"
  | "rds"
  | "lambda"
  | "cloudtrail"
  | "dynamodb"
  | "github"
  | "cloud";

export function resourceTypeIconKind(checkId: string): ResourceTypeIconKind {
  if (checkId.startsWith("github.") || checkId.startsWith("gitlab.")) return "github";
  if (checkId.startsWith("iam.") || checkId.startsWith("aws.access_analyzer")) return "iam";
  if (checkId.startsWith("s3.")) return "s3";
  if (checkId.startsWith("kms.")) return "kms";
  if (
    checkId.startsWith("ec2.") ||
    checkId.startsWith("ebs.") ||
    checkId.startsWith("vpc.") ||
    checkId.startsWith("elb.") ||
    checkId.startsWith("eks.") ||
    checkId.startsWith("ecr.") ||
    checkId.startsWith("ecs.")
  )
    return "ec2";
  if (checkId.startsWith("rds.")) return "rds";
  if (checkId.startsWith("lambda.")) return "lambda";
  if (checkId.startsWith("cloudtrail.")) return "cloudtrail";
  if (checkId.startsWith("dynamodb.")) return "dynamodb";
  return "cloud";
}

export type AssetPillTone = "orange" | "green" | "grey" | "blue";

/** Orca-style pill border/text colors by AWS service family. */
export function resourceTypePillTone(checkId: string): AssetPillTone {
  const kind = resourceTypeIconKind(checkId);
  if (kind === "iam" || kind === "github") return "grey";
  if (kind === "s3" || kind === "rds" || kind === "dynamodb") return "green";
  if (kind === "lambda" || kind === "ec2") return "orange";
  if (kind === "kms" || kind === "cloudtrail") return "blue";
  return "orange";
}

/** Label passed to AwsServiceIcon / awsServiceIconUrl. */
export function awsServiceLabelForCheck(checkId: string): string {
  const prefix = checkId.split(".")[0] ?? "";
  const labels: Record<string, string> = {
    iam: "IAM",
    s3: "S3",
    kms: "KMS",
    ec2: "EC2",
    ebs: "EC2",
    vpc: "VPC",
    elb: "ELB",
    eks: "EKS",
    ecr: "ECR",
    rds: "RDS",
    lambda: "Lambda",
    cloudtrail: "CloudTrail",
    dynamodb: "DynamoDB",
    guardduty: "GuardDuty",
    sns: "SNS",
    sqs: "SQS",
    secretsmanager: "SecretsManager",
    ssm: "SSM",
    acm: "ACM",
    aws: "Config",
  };
  if (prefix === "github" || prefix === "gitlab") return "";
  return labels[prefix] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

/** Human-readable AWS service name for IAM action prefixes (policy Services tab). */
const IAM_SERVICE_DISPLAY_NAMES: Record<string, string> = {
  ACM: "Certificate Manager",
  APIGATEWAY: "API Gateway",
  AUTOSCALING: "Auto Scaling",
  CLOUDFORMATION: "CloudFormation",
  CLOUDFRONT: "CloudFront",
  CLOUDTRAIL: "CloudTrail",
  CLOUDWATCH: "CloudWatch",
  CLOUDWATCHLOGS: "CloudWatch Logs",
  CONFIG: "AWS Config",
  DYNAMODB: "DynamoDB",
  EC2: "EC2",
  ECR: "ECR",
  ECRPUBLIC: "ECR Public",
  EKS: "EKS",
  ELASTICACHE: "ElastiCache",
  ELASTICBEANSTALK: "Elastic Beanstalk",
  ELB: "Elastic Load Balancing",
  ES: "OpenSearch",
  EVENTBRIDGE: "EventBridge",
  EVENTS: "EventBridge",
  FIREHOSE: "Kinesis Data Firehose",
  GUARDDUTY: "GuardDuty",
  IAM: "IAM",
  KINESIS: "Kinesis",
  KMS: "KMS",
  LAMBDA: "Lambda",
  LOGS: "CloudWatch Logs",
  ORGANIZATIONS: "Organizations",
  RDS: "RDS",
  ROUTE53: "Route 53",
  ROUTE53DOMAINS: "Route 53 Domains",
  S3: "S3",
  SECRETSMANAGER: "Secrets Manager",
  SECURITYHUB: "Security Hub",
  SNS: "SNS",
  SQS: "SQS",
  SSM: "Systems Manager",
  STS: "STS",
  VPC: "VPC",
};

export function formatIamServiceDisplayName(serviceLabel: string): string {
  const key = serviceLabel.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (IAM_SERVICE_DISPLAY_NAMES[key]) return IAM_SERVICE_DISPLAY_NAMES[key];
  const lower = serviceLabel.trim().toLowerCase();
  if (!lower) return serviceLabel;
  return lower.replace(/(^|[^a-z0-9]+)([a-z0-9]+)/g, (_, sep, word) => {
    const w = word as string;
    if (w.length <= 4 && w === w.toUpperCase()) return (sep as string) + w.toUpperCase();
    return (sep as string) + w.charAt(0).toUpperCase() + w.slice(1);
  });
}

/** Human asset type for resource rows (S3 Bucket, IAM Role, …). */
export function assetTypeLabel(checkId: string): string {
  if (checkId.startsWith("iam.root")) return "AWS Root User";
  if (checkId.startsWith("iam.role")) return "IAM Role";
  if (checkId.startsWith("iam.user")) return "IAM User";
  if (checkId.startsWith("iam.access_key")) return "IAM ARN";
  if (checkId.startsWith("ec2.ebs")) return "EBS Volume";
  if (checkId.startsWith("s3.bucket")) return "S3 Bucket";
  return resourceTypePillLabel(checkId)
    .split(" ")
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower === "iam") return "IAM";
      if (lower === "aws") return "AWS";
      if (lower === "s3") return "S3";
      if (lower === "kms") return "KMS";
      if (lower === "ec2") return "EC2";
      if (lower === "rds") return "RDS";
      if (lower === "eks") return "EKS";
      if (lower === "ecr") return "ECR";
      if (lower === "ecs") return "ECS";
      if (lower === "acm") return "ACM";
      if (lower === "ssm") return "SSM";
      if (lower === "sns") return "SNS";
      if (lower === "sqs") return "SQS";
      if (lower === "elb") return "ELB";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export function findingStatusLabel(status: string): string {
  if (status === "excepted") return "Exception";
  if (status === "ignored") return "Ignored";
  if (status === "resolved") return "Resolved";
  if (status === "snoozed") return "Snoozed";
  return "Open";
}

export type AssetTypePillEntry = { checkId: string; label: string };

/** Unique asset type pills for a grouped findings row (stable order). */
export function assetTypePillEntries(items: FindingLike[]): AssetTypePillEntry[] {
  const byLabel = new Map<string, string>();
  for (const f of items) {
    const label = resourceTypePillLabel(f.check_id);
    if (!byLabel.has(label)) byLabel.set(label, f.check_id);
  }
  return [...byLabel.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, checkId]) => ({ checkId, label }));
}

export function daysAgo(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 30) return `${d} days ago`;
  if (d < 365) return `${Math.floor(d / 30)} mo ago`;
  return `${Math.floor(d / 365)} yr ago`;
}

/** First/last seen in finding drawer — relative label plus calendar date (and time when recent). */
export function formatFindingSeenAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const now = new Date();
  const dayDiff = Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) /
      86400000,
  );

  const calendar = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  if (dayDiff === 0) return `Today, ${calendar} at ${time}`;
  if (dayDiff === 1) return `Yesterday, ${calendar} at ${time}`;
  if (dayDiff < 7) return `${dayDiff} days ago, ${calendar}`;

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function severityLabel(sev: string): string {
  return sev.charAt(0).toUpperCase() + sev.slice(1);
}

/** Compact severity pill — matches Findings table (critical/high red, medium amber, low slate). */
export function severityPillClassName(severity: string): string {
  const base =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-semibold";
  if (severity === "critical") {
    return `${base} bg-red-50 text-red-800 ring-1 ring-red-200/60`;
  }
  if (severity === "high") {
    return `${base} bg-red-50/90 text-red-700 ring-1 ring-red-200/55`;
  }
  if (severity === "medium") {
    return `${base} bg-amber-50 text-amber-800 ring-1 ring-amber-200/70`;
  }
  if (severity === "info") {
    return `${base} bg-zinc-50 text-zinc-500 ring-1 ring-zinc-200/70`;
  }
  return `${base} bg-slate-50 text-slate-600 ring-1 ring-slate-200/80`;
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
