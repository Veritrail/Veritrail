/** Domain label for a check id (IAM, S3, …) — shared by Compliance and Findings. */
export function checkGroupLabel(id: string): string {
  if (id.startsWith("github.")) return "GitHub";
  if (id.startsWith("gitlab.")) return "GitLab";
  if (id.startsWith("iam.")) return "IAM";
  if (id.startsWith("s3.")) return "S3";
  if (id.startsWith("kms.")) return "KMS";
  if (id.startsWith("cloudtrail.")) return "CloudTrail";
  if (id.startsWith("ec2.")) return "EC2";
  if (id.startsWith("rds.")) return "RDS";
  if (id.startsWith("guardduty.")) return "GuardDuty";
  if (id.startsWith("aws.")) return "AWS";
  if (id.startsWith("vpc.")) return "VPC";
  if (id.startsWith("lambda.")) return "Lambda";
  if (id.startsWith("dynamodb.")) return "DynamoDB";
  if (id.startsWith("acm.")) return "ACM";
  if (id.startsWith("elb.")) return "ELB";
  if (id.startsWith("secretsmanager.")) return "Secrets";
  if (id.startsWith("ssm.")) return "SSM";
  if (id.startsWith("sns.")) return "SNS";
  if (id.startsWith("sqs.")) return "SQS";
  const prefix = id.split(".")[0] ?? id;
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

export const CHECK_GROUP_ORDER = [
  "IAM",
  "GitHub",
  "GitLab",
  "S3",
  "KMS",
  "CloudTrail",
  "EC2",
  "RDS",
  "Lambda",
  "DynamoDB",
  "ACM",
  "ELB",
  "Secrets",
  "SSM",
  "SNS",
  "SQS",
  "GuardDuty",
  "AWS",
  "VPC",
];

export function compareCheckGroupLabels(a: string, b: string): number {
  const ai = CHECK_GROUP_ORDER.indexOf(a);
  const bi = CHECK_GROUP_ORDER.indexOf(b);
  if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  return a.localeCompare(b);
}
