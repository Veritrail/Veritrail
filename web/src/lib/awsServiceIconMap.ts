/**
 * Official AWS Architecture Icons (PNG) — awslabs/aws-icons-for-plantuml v19.0.
 * Vendored under /public/aws-icons/ for reliable loading (see scripts/vendor-aws-icons.sh).
 * @see https://aws.amazon.com/architecture/icons/
 */

import { AWS_LOGO_LIGHT } from "./awsBrand";

const ICON_CDN_BASE =
  "https://raw.githubusercontent.com/awslabs/aws-icons-for-plantuml/v19.0/dist";
const ICON_LOCAL_BASE = "/aws-icons";

/** Icon key → filename in public/aws-icons/ (vendored copy of Architecture Icon PNG). */
export const AWS_ICON_FILES: Record<string, string> = {
  AWS: "aws.png",
  IAM: "iam.svg",
  S3: "s3.svg",
  KMS: "kms.svg",
  EC2: "ec2.svg",
  VPC: "vpc.svg",
  RDS: "rds.svg",
  LAMBDA: "lambda.svg",
  CLOUDTRAIL: "cloudtrail.svg",
  CLOUDWATCH: "cloudwatch.svg",
  CONFIG: "config.svg",
  GUARDDUTY: "guardduty.svg",
  SECURITYHUB: "securityhub.svg",
  ACCESSANALYZER: "access-analyzer.png",
  ORGANIZATIONS: "organizations.svg",
  DYNAMODB: "dynamodb.svg",
  SNS: "sns.svg",
  SQS: "sqs.svg",
  SSM: "ssm.svg",
  SECRETSMANAGER: "secretsmanager.svg",
  ELB: "elb.svg",
  EKS: "eks.svg",
  ECR: "ecr.svg",
  ACM: "acm.svg",
  CLOUDFRONT: "cloudfront.svg",
  ELASTICACHE: "elasticache.svg",
  EVENTBRIDGE: "eventbridge.svg",
  CLOUDWATCHLOGS: "cloudwatch-logs.svg",
  APIGATEWAY: "apigateway.svg",
  ROUTE53: "route53.svg",
  ES: "opensearch.svg",
  FIREHOSE: "firehose.svg",
  KINESIS: "kinesis.svg",
  STS: "sts.svg",
};

/** IAM action prefix labels (uppercase, non-alphanumeric stripped) → Architecture Icon key. */
const SERVICE_LABEL_TO_ICON_KEY: Record<string, string> = {
  ECRPUBLIC: "ECR",
  LOGS: "CLOUDWATCHLOGS",
  EVENTS: "EVENTBRIDGE",
  EVENTBRIDGE: "EVENTBRIDGE",
  ELASTICLOADBALANCING: "ELB",
  ELASTICLOADBALANCINGV2: "ELB",
  MONITORING: "CLOUDWATCH",
  CLOUDFRONT: "CLOUDFRONT",
  ELASTICACHE: "ELASTICACHE",
  ES: "ES",
  ELASTICSEARCH: "ES",
  OPENSEARCH: "ES",
  FIREHOSE: "FIREHOSE",
  KINESIS: "KINESIS",
  APIGATEWAY: "APIGATEWAY",
  ROUTE53: "ROUTE53",
  ROUTE53DOMAINS: "ROUTE53",
  STS: "STS",
  SDB: "AWS",
  SWF: "AWS",
  AUTOSCALING: "EC2",
  ELASTICBEANSTALK: "EC2",
  CLOUDFORMATION: "CONFIG",
  CODEBUILD: "AWS",
  CODECOMMIT: "AWS",
  CODEDEPLOY: "AWS",
  CODEPIPELINE: "AWS",
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
  CLOUDFRONT: "NetworkingContentDelivery/CloudFront.png",
  ELASTICACHE: "Database/ElastiCache.png",
  EVENTBRIDGE: "ApplicationIntegration/EventBridge.png",
  CLOUDWATCHLOGS: "ManagementGovernance/CloudWatchLogs.png",
  APIGATEWAY: "NetworkingContentDelivery/APIGateway.png",
  ROUTE53: "NetworkingContentDelivery/Route53.png",
  ES: "Analytics/OpenSearchService.png",
  FIREHOSE: "Analytics/DataFirehose.png",
  KINESIS: "Analytics/Kinesis.png",
  STS: "SecurityIdentityCompliance/IdentityAccessManagementAWSSTS.png",
};

/** Longest-prefix wins — maps every Veritrail check_id family to an Architecture Icon key. */
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

/** Use the brand AWS favicon for generic / IAM sources (not per-service architecture tiles). */
const BRAND_FAVICON_ICON_KEYS = new Set(["IAM", "AWS"]);

export function iconKeyForCheckId(checkId: string): string {
  for (const [prefix, key] of CHECK_PREFIX_TO_ICON_KEY) {
    if (checkId.startsWith(prefix)) return key;
  }
  return DEFAULT_ICON_KEY;
}

/** Map IAM service prefix labels (e.g. LOGS, CLOUDFRONT, ECR-PUBLIC) to Architecture Icon keys. */
export function iconKeyForServiceLabel(serviceLabel: string): string {
  const normalized = serviceLabel.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (SERVICE_LABEL_TO_ICON_KEY[normalized]) return SERVICE_LABEL_TO_ICON_KEY[normalized];
  if (AWS_ICON_FILES[normalized]) return normalized;
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

function awsIconUrlForKey(key: string): string {
  if (BRAND_FAVICON_ICON_KEYS.has(key)) return AWS_LOGO_LIGHT;
  return localIconUrl(key) ?? cdnIconUrl(key);
}

/** Always resolves to an official Architecture Icon URL (local first, then CDN). */
export function awsIconUrlForCheckId(checkId: string): string {
  return awsIconUrlForKey(iconKeyForCheckId(checkId));
}

/** IAM service prefix from policy actions (ec2:DescribeInstances → EC2). */
export function awsServiceIconUrl(serviceLabel: string): string {
  return awsIconUrlForKey(iconKeyForServiceLabel(serviceLabel));
}
