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

export const HR_TRAINING_TOOLS = [
  "KnowBe4",
  "Curricula",
  "Rippling",
  "Lattice",
  "Other",
] as const;

export const VENDOR_RISK_TOOLS = [
  "OneTrust",
  "Vanta",
  "Secureframe",
  "Whistic",
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
  scheduleLabel: string;
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
  scheduleLabel: "Schedule (optional)",
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
    scheduleLabel: "Scan schedule",
    defaultEvidenceType: "Scanner export",
  },
  identity_access: {
    wizardLead:
      "Upload evidence of access reviews or identity governance outside native AWS IAM reports, or remediate IAM findings in AWS.",
    toolLabel: "Identity provider or review tool",
    toolPlaceholder: "e.g. Entra ID, Google Workspace, SailPoint",
    useToolPicker: false,
    scopeLabel: "Population reviewed",
    scopePlaceholder: "e.g. All production users, privileged access",
    useScopePicker: false,
    scheduleLabel: "Schedule (optional)",
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
    scheduleLabel: "Schedule (optional)",
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
    scheduleLabel: "Schedule (optional)",
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
    scheduleLabel: "Scan schedule (optional)",
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
    scheduleLabel: "Schedule (optional)",
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
    scheduleLabel: "Backup schedule (optional)",
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
    scheduleLabel: "Refresh schedule (optional)",
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
    scheduleLabel: "Coverage schedule (optional)",
    defaultEvidenceType: "Policy / attestation",
  },
  mdm_endpoint: {
    wizardLead:
      "Connect Microsoft Intune or Jamf Pro for live device inventory, or upload policy exports when API sync is unavailable.",
    toolLabel: "MDM platform",
    toolPlaceholder: "Tool name",
    toolOptions: MDM_ENDPOINT_TOOLS,
    useToolPicker: true,
    scopeLabel: "Managed device population",
    scopePlaceholder: "e.g. Corporate laptops, mobile devices",
    useScopePicker: false,
    scheduleLabel: "Compliance schedule (optional)",
    defaultEvidenceType: "Policy / attestation",
  },
  hr_training: {
    wizardLead:
      "Upload security awareness training completion reports or LMS exports for CC1/CC2 personnel controls.",
    toolLabel: "Training platform",
    toolPlaceholder: "Tool name",
    toolOptions: HR_TRAINING_TOOLS,
    useToolPicker: true,
    scopeLabel: "Employee population",
    scopePlaceholder: "e.g. All full-time employees",
    useScopePicker: false,
    scheduleLabel: "Training cadence (optional)",
    defaultEvidenceType: "Policy / attestation",
  },
  vendor_risk: {
    wizardLead:
      "Upload vendor risk assessments, SOC reports, or questionnaire responses for critical third parties.",
    toolLabel: "Vendor risk platform",
    toolPlaceholder: "Tool name",
    toolOptions: VENDOR_RISK_TOOLS,
    useToolPicker: true,
    scopeLabel: "Vendor scope",
    scopePlaceholder: "e.g. Critical and high-risk vendors",
    useScopePicker: false,
    scheduleLabel: "Review cadence (optional)",
    defaultEvidenceType: "Policy / attestation",
  },
};

export function intakeConfigForComposite(compositeId: string): CategoryIntakeConfig {
  const key = registryKeyForComposite(compositeId);
  if (key && CATEGORY_INTAKE[key]) return CATEGORY_INTAKE[key];
  return DEFAULT_INTAKE;
}

export function scheduleOptionsForIntake(_config: CategoryIntakeConfig) {
  return [{ value: "", label: "None" }, ...VULN_SCAN_CADENCES.map((v) => ({ value: v, label: v }))];
}
