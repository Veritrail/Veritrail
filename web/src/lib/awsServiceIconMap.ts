/**
 * Official AWS Architecture Icons (PNG) — awslabs/aws-icons-for-plantuml v19.0.
 * Vendored under /public/aws-icons/ for reliable loading (see scripts/vendor-aws-icons.sh).
 * @see https://aws.amazon.com/architecture/icons/
 */

const ICON_CDN_BASE =
  "https://raw.githubusercontent.com/awslabs/aws-icons-for-plantuml/v19.0/dist";
const ICON_LOCAL_BASE = "/aws-icons";

/** Icon key → filename in public/aws-icons/ (vendored copy of Architecture Icon PNG). */
export const AWS_ICON_FILES: Record<string, string> = {
  AWS: "aws.png",
  IAM: "iam.png",
  S3: "s3.png",
  KMS: "kms.png",
  EC2: "ec2.png",
  VPC: "vpc.png",
  RDS: "rds.png",
  LAMBDA: "lambda.png",
  CLOUDTRAIL: "cloudtrail.png",
  CLOUDWATCH: "cloudwatch.png",
  CONFIG: "config.png",
  GUARDDUTY: "guardduty.png",
  SECURITYHUB: "securityhub.png",
  ACCESSANALYZER: "access-analyzer.png",
  ORGANIZATIONS: "organizations.png",
  DYNAMODB: "dynamodb.png",
  SNS: "sns.png",
  SQS: "sqs.png",
  SSM: "ssm.png",
  SECRETSMANAGER: "secretsmanager.png",
  ELB: "elb.png",
  EKS: "eks.png",
  ECR: "ecr.png",
  ACM: "acm.png",
};

/** CDN source paths used by vendor-aws-icons.sh */
export const AWS_ICON_CDN_PATHS: Record<string, string> = {
  AWS: "General/AWSManagementConsole.png",
  IAM: "SecurityIdentityCompliance/IdentityandAccessManagement.png",
  S3: "Storage/SimpleStorageService.png",
  KMS: "SecurityIdentityCompliance/KeyManagementService.png",
  EC2: "Compute/EC2.png",
  VPC: "NetworkingContentDelivery/VPCVirtualprivatecloudVPC.png",
  RDS: "Database/RDS.png",
  LAMBDA: "Compute/Lambda.png",
  CLOUDTRAIL: "ManagementGovernance/CloudTrail.png",
  CLOUDWATCH: "ManagementGovernance/CloudWatch.png",
  CONFIG: "ManagementGovernance/Config.png",
  GUARDDUTY: "SecurityIdentityCompliance/GuardDuty.png",
  SECURITYHUB: "SecurityIdentityCompliance/SecurityHub.png",
  ACCESSANALYZER: "SecurityIdentityCompliance/IdentityAccessManagementIAMAccessAnalyzer.png",
  ORGANIZATIONS: "ManagementGovernance/OrganizationsAccount.png",
  DYNAMODB: "Database/DynamoDB.png",
  SNS: "ApplicationIntegration/SimpleNotificationService.png",
  SQS: "ApplicationIntegration/SimpleQueueService.png",
  SSM: "ManagementGovernance/SystemsManager.png",
  SECRETSMANAGER: "SecurityIdentityCompliance/SecretsManager.png",
  ELB: "NetworkingContentDelivery/ElasticLoadBalancing.png",
  EKS: "Containers/ElasticKubernetesService.png",
  ECR: "Containers/ElasticContainerRegistry.png",
  ACM: "SecurityIdentityCompliance/CertificateManager.png",
};

/** Longest-prefix wins — maps every Vigil check_id family to an Architecture Icon key. */
const CHECK_PREFIX_TO_ICON_KEY: [string, string][] = [
  ["cloudtrail.bucket", "S3"],
  ["aws.account", "ORGANIZATIONS"],
  ["aws.access_analyzer", "ACCESSANALYZER"],
  ["aws.config", "CONFIG"],
  ["aws.securityhub", "SECURITYHUB"],
  ["cloudtrail.", "CLOUDTRAIL"],
  ["guardduty.", "GUARDDUTY"],
  ["secretsmanager.", "SECRETSMANAGER"],
  ["dynamodb.", "DYNAMODB"],
  ["elb.", "ELB"],
  ["lambda.", "LAMBDA"],
  ["eks.", "EKS"],
  ["ecr.", "ECR"],
  ["acm.", "ACM"],
  ["rds.", "RDS"],
  ["ec2.", "EC2"],
  ["s3.", "S3"],
  ["kms.", "KMS"],
  ["sns.", "SNS"],
  ["sqs.", "SQS"],
  ["ssm.", "SSM"],
  ["vpc.", "VPC"],
  ["iam.", "IAM"],
];

const DEFAULT_ICON_KEY = "AWS";

export function iconKeyForCheckId(checkId: string): string {
  for (const [prefix, key] of CHECK_PREFIX_TO_ICON_KEY) {
    if (checkId.startsWith(prefix)) return key;
  }
  return DEFAULT_ICON_KEY;
}

function localIconUrl(key: string): string | null {
  const file = AWS_ICON_FILES[key];
  return file ? `${ICON_LOCAL_BASE}/${file}` : null;
}

function cdnIconUrl(key: string): string {
  const path = AWS_ICON_CDN_PATHS[key] ?? AWS_ICON_CDN_PATHS[DEFAULT_ICON_KEY];
  return `${ICON_CDN_BASE}/${path}`;
}

/** Always resolves to an official Architecture Icon URL (local first, then CDN). */
export function awsIconUrlForCheckId(checkId: string): string {
  const key = iconKeyForCheckId(checkId);
  return localIconUrl(key) ?? cdnIconUrl(key);
}

/** @deprecated Prefer awsIconUrlForCheckId — kept for ARN-derived service labels in drawer. */
export function awsServiceIconUrl(serviceLabel: string): string {
  const normalized = serviceLabel.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const alias: Record<string, string> = {
    CLOUDTRAIL: "CLOUDTRAIL",
    GUARDDUTY: "GUARDDUTY",
    SECRETSMANAGER: "SECRETSMANAGER",
    SECURITYHUB: "SECURITYHUB",
    DYNAMODB: "DYNAMODB",
    LAMBDA: "LAMBDA",
    CONFIG: "CONFIG",
  };
  const key = alias[normalized] ?? normalized;
  if (AWS_ICON_FILES[key]) return localIconUrl(key) ?? cdnIconUrl(key);
  return awsIconUrlForCheckId(`aws.${serviceLabel.toLowerCase()}`);
}
