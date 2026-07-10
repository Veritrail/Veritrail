/** Remediation modules — write remediation retired; stubs keep client types compiling. */

export type RemediationModuleId =
  | "security_groups"
  | "s3_public_access"
  | "iam_access_keys"
  | "iam_policies"
  | "ssm_parameters"
  | "cloudtrail_logging"
  | "kms_rotation";

export type RemediationModules = Record<RemediationModuleId, boolean>;

export const DEFAULT_REMEDIATION_MODULES: RemediationModules = {
  security_groups: false,
  s3_public_access: false,
  iam_access_keys: false,
  iam_policies: false,
  ssm_parameters: false,
  cloudtrail_logging: false,
  kms_rotation: false,
};

export type RemediationModuleSpec = {
  id: RemediationModuleId;
  label: string;
  badgeLabel: string;
  cfnParameter: string;
  summary: string;
  bullets: readonly string[];
  permissions: readonly string[];
  runnerSupported: boolean;
};

/** Empty — write remediation retired. */
export const REMEDIATION_MODULE_SPECS: readonly RemediationModuleSpec[] = [];

export function anyRemediationEnabled(_modules: RemediationModules): boolean {
  return false;
}

export function countRemediationEnabled(_modules: RemediationModules): number {
  return 0;
}

export function allRemediationModulesEnabled(_modules: RemediationModules): boolean {
  return false;
}
