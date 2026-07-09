/**
 * Check-id -> cloud service metadata (label + official AWS architecture icon).
 *
 * Icons are the official AWS Architecture Icons (Q2 2026 release,
 * https://aws.amazon.com/architecture/icons/) — 16px service tiles, colored
 * category background + white glyph, checked into src/assets/aws/.
 */

// Vite: eager URL imports for every bundled service tile.
const iconUrls = import.meta.glob("../assets/aws/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function iconUrl(name: string): string | undefined {
  return iconUrls[`../assets/aws/${name}.svg`];
}

export type ServiceMeta = {
  label: string;
  iconUrl?: string;
};

/** First check-id segment (second when the id is `aws.`-prefixed) -> service. */
const AWS_SERVICE_BY_KEY: Record<string, { label: string; icon: string }> = {
  s3: { label: "S3", icon: "s3" },
  iam: { label: "IAM", icon: "iam" },
  identity_center: { label: "Identity Center", icon: "identity-center" },
  access_analyzer: { label: "Access Analyzer", icon: "iam" },
  ec2: { label: "EC2", icon: "ec2" },
  vpc: { label: "VPC", icon: "vpc" },
  elb: { label: "ELB", icon: "elb" },
  cloudtrail: { label: "CloudTrail", icon: "cloudtrail" },
  guardduty: { label: "GuardDuty", icon: "guardduty" },
  kms: { label: "KMS", icon: "kms" },
  lambda: { label: "Lambda", icon: "lambda" },
  rds: { label: "RDS", icon: "rds" },
  dynamodb: { label: "DynamoDB", icon: "dynamodb" },
  eks: { label: "EKS", icon: "eks" },
  ecs: { label: "ECS", icon: "ecs" },
  ecr: { label: "ECR", icon: "ecr" },
  sns: { label: "SNS", icon: "sns" },
  sqs: { label: "SQS", icon: "sqs" },
  ssm: { label: "Systems Manager", icon: "ssm" },
  acm: { label: "ACM", icon: "acm" },
  config: { label: "Config", icon: "config" },
  backup: { label: "Backup", icon: "backup" },
  inspector: { label: "Inspector", icon: "inspector" },
  securityhub: { label: "Security Hub", icon: "securityhub" },
  secretsmanager: { label: "Secrets Manager", icon: "secretsmanager" },
  account: { label: "AWS Account", icon: "organizations" },
  vulnerability_monitoring: { label: "Vuln Monitoring", icon: "inspector" },
};

/** Non-AWS check-id heads -> text-only labels (no AWS tile for these). */
const OTHER_PROVIDER_LABEL: Record<string, string> = {
  gcp: "Google Cloud",
  azure: "Azure",
  entra: "Entra ID",
  github: "GitHub",
  gitlab: "GitLab",
  google_workspace: "Google Workspace",
  intune: "Intune",
  jamf: "Jamf",
};

export function serviceForCheck(checkId: string): ServiceMeta | null {
  const segs = checkId.split(".");
  if (segs.length < 2) return null;
  const head = segs[0] === "aws" ? segs[1] : segs[0];
  const aws = AWS_SERVICE_BY_KEY[head];
  if (aws) return { label: aws.label, iconUrl: iconUrl(aws.icon) };
  const other = OTHER_PROVIDER_LABEL[head];
  if (other) return { label: other };
  return null;
}
