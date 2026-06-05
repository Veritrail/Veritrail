#!/usr/bin/env bash
# Download official AWS Architecture Icon PNGs into web/public/aws-icons/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/aws-icons"
BASE="https://raw.githubusercontent.com/awslabs/aws-icons-for-plantuml/v19.0/dist"

mkdir -p "$OUT"

download() {
  local file="$1"
  local cdn_path="$2"
  local dest="$OUT/$file"
  echo "→ $file"
  curl -fsSL "$BASE/$cdn_path" -o "$dest"
}

download aws.png General/AWSManagementConsole.png
download iam.png SecurityIdentityCompliance/IdentityandAccessManagement.png
download s3.png Storage/SimpleStorageService.png
download kms.png SecurityIdentityCompliance/KeyManagementService.png
download ec2.png Compute/EC2.png
download vpc.png NetworkingContentDelivery/VPCVirtualprivatecloudVPC.png
download rds.png Database/RDS.png
download lambda.png Compute/Lambda.png
download cloudtrail.png ManagementGovernance/CloudTrail.png
download cloudwatch.png ManagementGovernance/CloudWatch.png
download config.png ManagementGovernance/Config.png
download guardduty.png SecurityIdentityCompliance/GuardDuty.png
download securityhub.png SecurityIdentityCompliance/SecurityHub.png
download access-analyzer.png SecurityIdentityCompliance/IdentityAccessManagementIAMAccessAnalyzer.png
download organizations.png ManagementGovernance/OrganizationsAccount.png
download dynamodb.png Database/DynamoDB.png
download sns.png ApplicationIntegration/SimpleNotificationService.png
download sqs.png ApplicationIntegration/SimpleQueueService.png
download ssm.png ManagementGovernance/SystemsManager.png
download secretsmanager.png SecurityIdentityCompliance/SecretsManager.png
download elb.png NetworkingContentDelivery/ElasticLoadBalancing.png
download eks.png Containers/ElasticKubernetesService.png
download ecr.png Containers/ElasticContainerRegistry.png
download acm.png SecurityIdentityCompliance/CertificateManager.png
download cloudfront.png NetworkingContentDelivery/CloudFront.png
download elasticache.png Database/ElastiCache.png
download eventbridge.png ApplicationIntegration/EventBridge.png
download cloudwatch-logs.png ManagementGovernance/CloudWatchLogs.png
download apigateway.png NetworkingContentDelivery/APIGateway.png
download route53.png NetworkingContentDelivery/Route53.png
download opensearch.png Analytics/OpenSearchService.png
download firehose.png Analytics/DataFirehose.png
download kinesis.png Analytics/Kinesis.png
download sts.png SecurityIdentityCompliance/IdentityAccessManagementAWSSTS.png

echo "Done — $(ls -1 "$OUT" | wc -l | tr -d ' ') icons in $OUT"
