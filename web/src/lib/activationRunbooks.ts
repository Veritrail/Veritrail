export type ActivationRunbook = {
  /** One-line AWS console navigation path. */
  consolePath: string;
  /** Copyable AWS CLI snippet, when a standard command exists. */
  cli?: string;
};

/** Runbook entries for service-level enablement (absence-gap) checks. */
const SEEDED_ACTIVATION_RUNBOOKS: Record<string, ActivationRunbook> = {
  "aws.vulnerability_monitoring.not_detected": {
    consolePath: "Inspector → Settings → activate scanning for EC2, ECR, Lambda, and ECS",
    cli: `aws inspector2 enable --resource-types ECR,EC2,ECR_CONTAINER,ECS,LAMBDA`,
  },
  "vpc.flow_logs.not_enabled": {
    consolePath: "VPC → Your VPCs → select VPC → Flow logs → Create flow log",
    cli: `aws ec2 create-flow-logs \\
  --resource-type VPC \\
  --resource-ids <vpc-id> \\
  --traffic-type ALL \\
  --log-destination-type cloud-watch-logs \\
  --log-group-name /aws/vpc/flowlogs \\
  --deliver-logs-permission-arn <delivery-role-arn>`,
  },
  "aws.config.not_enabled": {
    consolePath: "AWS Config → Get started → Record all resources → Confirm",
    cli: `aws configservice put-configuration-recorder \\
  --configuration-recorder name=default,roleARN=<config-role-arn>
aws configservice put-delivery-channel \\
  --delivery-channel name=default,s3BucketName=<bucket>
aws configservice start-configuration-recorder --configuration-recorder-name default`,
  },
  "guardduty.detector.not_enabled": {
    consolePath: "GuardDuty → Get Started → Enable GuardDuty (repeat per region)",
    cli: `aws guardduty create-detector --enable --region <region>`,
  },
  "aws.securityhub.not_enabled": {
    consolePath: "Security Hub → Enable Security Hub (repeat per active region)",
    cli: `aws securityhub enable-security-hub --region <region>`,
  },
  "aws.access_analyzer.not_enabled": {
    consolePath: "IAM → Access Analyzer → Create analyzer (per region)",
    cli: `aws accessanalyzer create-analyzer \\
  --analyzer-name veritrail-analyzer \\
  --type ACCOUNT \\
  --region <region>`,
  },
  "cloudtrail.trail.not_enabled": {
    consolePath: "CloudTrail → Trails → Create trail → Enable multi-region logging",
    cli: `aws cloudtrail create-trail \\
  --name veritrail-audit \\
  --s3-bucket-name <your-log-bucket> \\
  --is-multi-region-trail \\
  --enable-log-file-validation
aws cloudtrail start-logging --name veritrail-audit`,
  },
  "backup.plan.missing": {
    consolePath: "AWS Backup → Backup plans → Create backup plan",
    cli: `aws backup create-backup-plan --backup-plan file://backup-plan.json`,
  },
};

/** Resource-scoped activation checks surfaced on the technical checklist. */
const RESOURCE_ACTIVATION_RUNBOOKS: Record<string, ActivationRunbook> = {
  "dynamodb.table.no_pitr": {
    consolePath: "DynamoDB → Tables → select table → Backups → Edit → Turn on point-in-time recovery",
    cli: `aws dynamodb update-continuous-backups \\
  --table-name <table> \\
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true`,
  },
  "rds.instance.no_automated_backup": {
    consolePath: "RDS → Databases → select instance → Modify → Backup retention period",
    cli: `aws rds modify-db-instance \\
  --db-instance-identifier <instance> \\
  --backup-retention-period 7 \\
  --apply-immediately`,
  },
  "rds.instance.no_deletion_protection": {
    consolePath: "RDS → Databases → select instance → Modify → Enable deletion protection",
    cli: `aws rds modify-db-instance \\
  --db-instance-identifier <instance> \\
  --deletion-protection \\
  --apply-immediately`,
  },
  "ecr.registry.enhanced_scanning_disabled": {
    consolePath: "ECR → Private registry → Settings → Scanning configuration → Enhanced scanning",
    cli: `aws ecr put-registry-scanning-configuration \\
  --scan-type ENHANCED \\
  --rules file://scan-rules.json`,
  },
  "ecr.repository.image_scan_disabled": {
    consolePath: "ECR → Repositories → select repository → Scan on push → Enable",
    cli: `aws ecr put-image-scanning-configuration \\
  --repository-name <repo> \\
  --image-scanning-configuration scanOnPush=true`,
  },
  "elb.load_balancer.no_access_logs": {
    consolePath: "EC2 → Load Balancers → select balancer → Attributes → Access logs",
    cli: `aws elbv2 modify-load-balancer-attributes \\
  --load-balancer-arn <arn> \\
  --attributes Key=access_logs.s3.enabled,Value=true Key=access_logs.s3.bucket,Value=<bucket>`,
  },
  "eks.cluster.control_plane_logging_disabled": {
    consolePath: "EKS → Clusters → select cluster → Observability → Control plane logging",
    cli: `aws eks update-cluster-config \\
  --name <cluster> \\
  --logging '{"clusterLogging":[{"types":["api","audit","authenticator","controllerManager","scheduler"],"enabled":true}]}'`,
  },
  "ecs.cluster.container_insights_disabled": {
    consolePath: "ECS → Clusters → select cluster → Update cluster → Container Insights",
    cli: `aws ecs update-cluster-settings \\
  --cluster <cluster> \\
  --settings name=containerInsights,value=enabled`,
  },
};

const ACTIVATION_RUNBOOKS: Record<string, ActivationRunbook> = {
  ...SEEDED_ACTIVATION_RUNBOOKS,
  ...RESOURCE_ACTIVATION_RUNBOOKS,
};

export function activationRunbook(checkId: string): ActivationRunbook | null {
  return ACTIVATION_RUNBOOKS[checkId] ?? null;
}

/** Console path + optional CLI; only returns entries with explicit runbooks. */
export function howToForCheck(checkId: string): ActivationRunbook | null {
  return activationRunbook(checkId);
}

/** Seeded absence-gap activate check ids (8). */
export const SEEDED_ACTIVATION_CHECK_IDS = Object.keys(SEEDED_ACTIVATION_RUNBOOKS);
