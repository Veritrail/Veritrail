import { EXTERNAL_SCANNER_SOURCES } from "./externalEvidence";
import { registryKeyForComposite, VULN_ASSET_SCOPES, VULN_SCAN_CADENCES } from "./evidenceSourceRegistry";

export const ENDPOINT_SECURITY_TOOLS = [
  "CrowdStrike",
  "Microsoft Defender for Endpoint",
  "SentinelOne",
  "Jamf Protect",
  "Other",
] as const;

export const MDM_ENDPOINT_TOOLS = [
  "Microsoft Intune",
  "Jamf Pro",
  "Jamf Protect",
  "Kandji",
  "Other",
] as const;

export type CategoryIntakeConfig = {
  wizardLead: string;
  toolLabel: string;
  toolPlaceholder: string;
  toolOptions?: readonly string[];
  useToolPicker: boolean;
  scopeLabel: string;
  scopePlaceholder: string;
  scopeOptions?: readonly string[];
  useScopePicker: boolean;
  cadenceLabel: string;
  defaultEvidenceType: string;
};

const DEFAULT_INTAKE: CategoryIntakeConfig = {
  wizardLead:
    "Upload evidence that you cover this outside AWS, or enable the AWS capability in this account. This wizard pre-fills your upload for the external-evidence path.",
  toolLabel: "External system or process",
  toolPlaceholder: "e.g. internal tool, SaaS platform, runbook owner",
  useToolPicker: false,
  scopeLabel: "Scope covered",
  scopePlaceholder: "e.g. Production AWS accounts, all regions",
  useScopePicker: false,
  cadenceLabel: "Review cadence (optional)",
  defaultEvidenceType: "Policy / attestation",
};

export const CATEGORY_INTAKE: Record<string, CategoryIntakeConfig> = {
  vulnerability_management: {
    wizardLead:
      "Upload evidence that you manage vulnerability management outside AWS, or enable AWS Inspector in this account. This wizard pre-fills your upload for the external-evidence path.",
    toolLabel: "External scanner or tool",
    toolPlaceholder: "Tool name",
    toolOptions: EXTERNAL_SCANNER_SOURCES,
    useToolPicker: true,
    scopeLabel: "Asset scope",
    scopePlaceholder: "Select asset scope…",
    scopeOptions: VULN_ASSET_SCOPES,
    useScopePicker: true,
    cadenceLabel: "Scan cadence",
    defaultEvidenceType: "Scanner export",
  },
  identity_access: {
    wizardLead:
      "Upload evidence of access reviews or identity governance outside native AWS IAM reports, or remediate IAM findings in AWS.",
    toolLabel: "Identity provider or review tool",
    toolPlaceholder: "e.g. Okta, Entra ID, Google Workspace, SailPoint",
    useToolPicker: false,
    scopeLabel: "Population reviewed",
    scopePlaceholder: "e.g. All production users, privileged access",
    useScopePicker: false,
    cadenceLabel: "Review cadence (optional)",
    defaultEvidenceType: "Policy / attestation",
  },
  logging_monitoring: {
    wizardLead:
      "Upload evidence that logging and monitoring are covered outside the missing AWS controls, or enable them in AWS.",
    toolLabel: "Logging or monitoring platform",
    toolPlaceholder: "e.g. Datadog, Splunk, Panther, Sumo Logic",
    useToolPicker: false,
    scopeLabel: "Log sources covered",
    scopePlaceholder: "e.g. VPC, CloudTrail, application tiers",
    useScopePicker: false,
    cadenceLabel: "Review cadence (optional)",
    defaultEvidenceType: "Dashboard screenshot",
  },
  change_management: {
    wizardLead:
      "Upload evidence of change approval outside AWS-native checks, or remediate branch and deployment protections in AWS.",
    toolLabel: "Change management tool",
    toolPlaceholder: "e.g. Jira, ServiceNow, GitHub pull requests",
    useToolPicker: false,
    scopeLabel: "Systems in scope",
    scopePlaceholder: "e.g. Production repos, infrastructure changes",
    useScopePicker: false,
    cadenceLabel: "Review cadence (optional)",
    defaultEvidenceType: "Policy / attestation",
  },
  secure_sdlc: {
    wizardLead:
      "Upload evidence of SDLC security controls from your pipeline tooling, or remediate CI and repository findings in AWS.",
    toolLabel: "SDLC or CI security tool",
    toolPlaceholder: "e.g. GitHub Advanced Security, GitLab, Snyk CI",
    useToolPicker: false,
    scopeLabel: "Repositories or pipelines covered",
    scopePlaceholder: "e.g. Production services, release branches",
    useScopePicker: false,
    cadenceLabel: "Scan cadence (optional)",
    defaultEvidenceType: "Scanner export",
  },
  data_protection: {
    wizardLead:
      "Upload evidence of encryption or data-protection controls managed outside AWS Config findings, or remediate in AWS.",
    toolLabel: "Data protection tool or process",
    toolPlaceholder: "e.g. KMS runbook, DLP platform, key custodian",
    useToolPicker: false,
    scopeLabel: "Data or systems covered",
    scopePlaceholder: "e.g. Customer PII stores, production databases",
    useScopePicker: false,
    cadenceLabel: "Review cadence (optional)",
    defaultEvidenceType: "Policy / attestation",
  },
  backup_resilience: {
    wizardLead:
      "Upload evidence of backup and recovery outside AWS Backup plans, or configure AWS Backup for in-scope resources.",
    toolLabel: "Backup or DR platform",
    toolPlaceholder: "e.g. Veeam, Rubrik, custom snapshot process",
    useToolPicker: false,
    scopeLabel: "Resources covered",
    scopePlaceholder: "e.g. RDS, EBS, critical workloads",
    useScopePicker: false,
    cadenceLabel: "Backup cadence (optional)",
    defaultEvidenceType: "Policy / attestation",
  },
  asset_inventory: {
    wizardLead:
      "Upload evidence of asset inventory maintained outside AWS-native discovery, or remediate inventory gaps in AWS.",
    toolLabel: "Asset inventory source",
    toolPlaceholder: "e.g. CMDB, ServiceNow, internal asset register",
    useToolPicker: false,
    scopeLabel: "Asset scope",
    scopePlaceholder: "e.g. All production accounts and regions",
    useScopePicker: false,
    cadenceLabel: "Refresh cadence (optional)",
    defaultEvidenceType: "Policy / attestation",
  },
  endpoint_security: {
    wizardLead:
      "Upload evidence that corporate endpoints are protected by EDR outside AWS, or remediate AWS-side detection gaps (GuardDuty, SSM coverage) in this account.",
    toolLabel: "EDR platform",
    toolPlaceholder: "Tool name",
    toolOptions: ENDPOINT_SECURITY_TOOLS,
    useToolPicker: true,
    scopeLabel: "Endpoint population",
    scopePlaceholder: "e.g. All employee laptops, production servers",
    useScopePicker: false,
    cadenceLabel: "Coverage review cadence (optional)",
    defaultEvidenceType: "Policy / attestation",
  },
  mdm_endpoint: {
    wizardLead:
      "Declare your MDM platform for device management evidence. Live Intune/Jamf API sync is not required — upload policy exports or attestation when prompted.",
    toolLabel: "MDM platform",
    toolPlaceholder: "Tool name",
    toolOptions: MDM_ENDPOINT_TOOLS,
    useToolPicker: true,
    scopeLabel: "Managed device population",
    scopePlaceholder: "e.g. Corporate laptops, mobile devices",
    useScopePicker: false,
    cadenceLabel: "Compliance review cadence (optional)",
    defaultEvidenceType: "Policy / attestation",
  },
};

export function intakeConfigForComposite(compositeId: string): CategoryIntakeConfig {
  const key = registryKeyForComposite(compositeId);
  if (key && CATEGORY_INTAKE[key]) return CATEGORY_INTAKE[key];
  return DEFAULT_INTAKE;
}

export function cadenceOptionsForIntake(config: CategoryIntakeConfig) {
  return [{ value: "", label: config.cadenceLabel }, ...VULN_SCAN_CADENCES.map((v) => ({ value: v, label: v }))];
}
