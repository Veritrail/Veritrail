import { DEFAULT_REMEDIATION_MODULES } from "../data/remediationModules";
import {
  parseCfnLaunchMeta,
  resolveDeployArtifacts,
  type CfnConnectionOptions,
} from "./cfnDeployCommands";
import { SCANNER_ROLE_NAME } from "./connectionPosture";

export type AwsConnectAccount = {
  id: string;
  label: string;
  account_id: string | null;
  status: string;
  external_id: string;
  cfn_stack_name: string;
  cfn_launch_url: string;
  cfn_update_launch_url: string;
  cfn_template_url: string;
  cfn_cli_command: string;
  cfn_update_cli_command: string;
};

export const AWS_CORE_CONNECTION_OPTIONS: CfnConnectionOptions = {
  enable_advanced_policy_generation: false,
  remediation_modules: { ...DEFAULT_REMEDIATION_MODULES },
};

export const AWS_CORE_PERMISSIONS = [
  {
    role: "VeritrailScannerRole",
    scope: "Account",
    purpose: "Read-only IAM, S3, KMS, CloudTrail, EC2, Config, GuardDuty, and security services",
  },
] as const;

export const AWS_VALIDATE_ITEMS = [
  {
    title: "Trust relationship",
    desc: "Verifies Veritrail can assume the connector role.",
  },
  {
    title: "AWS account identity",
    desc: "Discovers the AWS account ID from the assumed role.",
  },
  {
    title: "Initial scan",
    desc: "Queues a scan after the account is saved.",
  },
] as const;

export type AwsDeployTab = "console" | "cli" | "terraform";

export const AWS_DEPLOY_METHOD_ICON: Record<AwsDeployTab, string> = {
  console: "/deploy-methods/console.png",
  cli: "/deploy-methods/cli.png",
  terraform: "/deploy-methods/terraform.png",
};

function hclString(value: string): string {
  return JSON.stringify(value);
}

function terraformList(values: readonly string[], indent = "    "): string {
  if (values.length === 0) return "[]";
  return `[\n${values.map((value) => `${indent}${hclString(value)},`).join("\n")}\n${indent.slice(0, -2)}]`;
}

type PolicyStatementSummary = {
  sid: string;
  actions: readonly string[];
  resource: string;
};

const CORE_SCANNER_STATEMENTS: readonly PolicyStatementSummary[] = [
  { sid: "IamUserAndKeyEnumeration", actions: ["iam:ListUsers", "iam:ListMFADevices", "iam:GetLoginProfile", "iam:ListAccessKeys", "iam:GetAccessKeyLastUsed", "iam:GetAccountSummary", "iam:ListAccountAliases", "iam:GetAccountPasswordPolicy"], resource: "*" },
  { sid: "IamRoleEnumeration", actions: ["iam:ListRoles", "iam:ListRolePolicies", "iam:GetRolePolicy", "iam:ListAttachedRolePolicies", "iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListPolicies"], resource: "*" },
  { sid: "IamServiceLastAccessedRead", actions: ["iam:GetServiceLastAccessedDetails"], resource: "*" },
  { sid: "IamServerCertificates", actions: ["iam:ListServerCertificates", "iam:GetServerCertificate"], resource: "*" },
  { sid: "AccountContacts", actions: ["account:GetContactInformation", "account:GetAlternateContact", "account:GetAccountInformation"], resource: "*" },
  { sid: "S3BucketConfiguration", actions: ["s3:ListAllMyBuckets", "s3:GetAccountPublicAccessBlock", "s3:GetBucketLogging", "s3:GetEncryptionConfiguration", "s3:GetBucketVersioning", "s3:GetBucketPublicAccessBlock", "s3:GetBucketPolicy", "s3:GetBucketAcl"], resource: "*" },
  { sid: "KmsKeyConfiguration", actions: ["kms:ListKeys", "kms:DescribeKey", "kms:GetKeyRotationStatus", "kms:GetKeyPolicy", "kms:ListAliases"], resource: "*" },
  { sid: "CloudTrailConfiguration", actions: ["cloudtrail:DescribeTrails", "cloudtrail:GetTrailStatus", "cloudtrail:LookupEvents"], resource: "*" },
  { sid: "AwsBackupConfiguration", actions: ["backup:ListBackupPlans", "backup:ListBackupVaults"], resource: "*" },
  { sid: "GuardDutyConfiguration", actions: ["guardduty:ListDetectors", "guardduty:GetDetector", "guardduty:ListFindings", "guardduty:GetFindings"], resource: "*" },
  { sid: "SecurityHubConfiguration", actions: ["securityhub:DescribeHub"], resource: "*" },
  { sid: "VpcAndSecurityGroupEnumeration", actions: ["ec2:DescribeRegions", "ec2:DescribeVpcs", "ec2:DescribeFlowLogs", "ec2:DescribeSecurityGroups"], resource: "*" },
  { sid: "Ec2InstanceEnumeration", actions: ["ec2:DescribeInstances", "ec2:DescribeVolumes", "ec2:DescribeSnapshots", "ec2:DescribeSnapshotAttribute", "ec2:DescribeImages", "ec2:GetEbsEncryptionByDefault"], resource: "*" },
  { sid: "AccessAnalyzerEnumeration", actions: ["access-analyzer:ListAnalyzers"], resource: "*" },
  { sid: "ConfigServiceConfiguration", actions: ["config:DescribeConfigurationRecorders", "config:DescribeConfigurationRecorderStatus", "config:DescribeDeliveryChannels", "config:DescribeComplianceByConfigRule"], resource: "*" },
  { sid: "IdentityCenterDirectory", actions: ["sso:ListInstances", "sso:DescribeInstance", "sso:ListPermissionSets", "sso:DescribePermissionSet", "sso:ListAccountsForProvisionedPermissionSet", "sso:ListAccountAssignments", "identitystore:ListUsers", "identitystore:DescribeUser", "identitystore:DescribeGroup"], resource: "*" },
  { sid: "RdsConfiguration", actions: ["rds:DescribeDBInstances", "rds:DescribeDBSnapshots", "rds:DescribeDBSnapshotAttributes"], resource: "*" },
  { sid: "AcmCertificates", actions: ["acm:ListCertificates", "acm:DescribeCertificate"], resource: "*" },
  { sid: "LambdaConfiguration", actions: ["lambda:ListFunctions", "lambda:GetFunctionEventInvokeConfig"], resource: "*" },
  { sid: "SecretsManagerConfiguration", actions: ["secretsmanager:ListSecrets"], resource: "*" },
  { sid: "SsmParameters", actions: ["ssm:DescribeParameters"], resource: "*" },
  { sid: "ElbConfiguration", actions: ["elasticloadbalancing:DescribeLoadBalancers", "elasticloadbalancing:DescribeLoadBalancerAttributes", "elasticloadbalancing:DescribeListeners"], resource: "*" },
  { sid: "DynamoDbConfiguration", actions: ["dynamodb:ListTables", "dynamodb:DescribeTable", "dynamodb:DescribeContinuousBackups"], resource: "*" },
  { sid: "SnsConfiguration", actions: ["sns:ListTopics", "sns:GetTopicAttributes"], resource: "*" },
  { sid: "SqsConfiguration", actions: ["sqs:ListQueues", "sqs:GetQueueAttributes"], resource: "*" },
  { sid: "EcrConfiguration", actions: ["ecr:DescribeRepositories", "ecr:GetRegistryScanningConfiguration"], resource: "*" },
  { sid: "EksConfiguration", actions: ["eks:ListClusters", "eks:DescribeCluster"], resource: "*" },
  { sid: "EcsConfiguration", actions: ["ecs:ListClusters", "ecs:DescribeClusters", "ecs:ListServices", "ecs:DescribeServices", "ecs:DescribeTaskDefinition"], resource: "*" },
  { sid: "InspectorConfiguration", actions: ["inspector2:BatchGetAccountStatus", "inspector2:ListCoverage", "inspector2:ListFindings", "inspector2:BatchGetFindingDetails"], resource: "*" },
  { sid: "OrganizationsAccountLabel", actions: ["organizations:DescribeAccount"], resource: "*" },
] as const;

function terraformPolicyDocumentForStatements(statements: readonly PolicyStatementSummary[]): string {
  return statements
    .map((statement) => {
      return `  statement {\n    sid       = ${hclString(statement.sid)}\n    effect    = "Allow"\n    actions   = ${terraformList(statement.actions, "      ")}\n    resources = [${hclString(statement.resource)}]\n  }`;
    })
    .join("\n\n");
}

export function terraformForCoreConnection(acc: AwsConnectAccount): string {
  const trustPrincipalArn = parseCfnLaunchMeta(acc.cfn_launch_url).trustPrincipalArn;
  const veritrailPrincipalArnVar = trustPrincipalArn
    ? `variable "veritrail_principal_arn" {\n  description = "AWS principal ARN that Veritrail uses to assume the connector role. Confirm this in your Veritrail deployment settings before applying."\n  type        = string\n  default     = ${hclString(trustPrincipalArn)}\n}`
    : `variable "veritrail_principal_arn" {\n  description = "AWS principal ARN that Veritrail uses to assume the connector role. Confirm this in your Veritrail deployment settings before applying."\n  type        = string\n}`;
  const roleBlocks = `data "aws_iam_policy_document" "veritrail_core_scanner_role_trust" {\n  statement {\n    sid     = "AllowVeritrailAssumeRole"\n    effect  = "Allow"\n    actions = ["sts:AssumeRole"]\n\n    principals {\n      type        = "AWS"\n      identifiers = [var.veritrail_principal_arn]\n    }\n\n    condition {\n      test     = "StringEquals"\n      variable = "sts:ExternalId"\n      values   = [var.external_id]\n    }\n  }\n\n  statement {\n    sid     = "AllowVeritrailRoleChainingContext"\n    effect  = "Allow"\n    actions = ["sts:SetSourceIdentity", "sts:TagSession"]\n\n    principals {\n      type        = "AWS"\n      identifiers = [var.veritrail_principal_arn]\n    }\n  }\n}\n\ndata "aws_iam_policy_document" "veritrail_core_scanner_role_policy" {\n${terraformPolicyDocumentForStatements(CORE_SCANNER_STATEMENTS)}\n}\n\nresource "aws_iam_role" "veritrail_core_scanner_role" {\n  name = var.veritrail_core_scanner_role_name\n\n  assume_role_policy = data.aws_iam_policy_document.veritrail_core_scanner_role_trust.json\n\n  tags = merge(var.tags, {\n    Name        = var.veritrail_core_scanner_role_name\n    ManagedBy   = "Terraform"\n    Application = "Veritrail"\n  })\n}\n\nresource "aws_iam_role_policy" "veritrail_core_scanner_role" {\n  name   = "VeritrailScannerAccess"\n  role   = aws_iam_role.veritrail_core_scanner_role.id\n  policy = data.aws_iam_policy_document.veritrail_core_scanner_role_policy.json\n}`;
  const outputs = `output "veritrail_core_scanner_role_arn" {\n  description = "ARN of the Veritrail core scanner role. Paste this back into Veritrail during verification."\n  value       = aws_iam_role.veritrail_core_scanner_role.arn\n}`;

  return `terraform {\n  required_version = ">= 1.5.0"\n\n  required_providers {\n    aws = {\n      source  = "hashicorp/aws"\n      version = ">= 5.0"\n    }\n  }\n}\n\nprovider "aws" {\n  region = var.aws_region\n}\n\nvariable "aws_region" {\n  description = "AWS region used by the AWS provider. IAM roles are global, but the provider still requires a region."\n  type        = string\n  default     = "us-east-1"\n}\n\nvariable "external_id" {\n  description = "External ID generated by Veritrail for this account connection."\n  type        = string\n  default     = ${hclString(acc.external_id)}\n}\n\n${veritrailPrincipalArnVar}\n\nvariable "veritrail_core_scanner_role_name" {\n  description = "Name of the Veritrail read-only scanner role."\n  type        = string\n  default     = ${hclString(SCANNER_ROLE_NAME)}\n}\n\nvariable "tags" {\n  description = "Tags applied to IAM roles."\n  type        = map(string)\n  default = {\n    ManagedBy = "Terraform"\n    Vendor    = "Veritrail"\n  }\n}\n\n${roleBlocks}\n\n${outputs}\n`;
}

export function downloadTerraformModule(code: string, filename = "veritrail-connector.tf") {
  const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function resolveCoreDeployArtifacts(acc: AwsConnectAccount) {
  return resolveDeployArtifacts(acc, AWS_CORE_CONNECTION_OPTIONS, "create");
}
