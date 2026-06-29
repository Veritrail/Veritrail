import { labelForCheck } from "../data/checkLabels";

/** Veritrail cannot auto-collect this in AWS — customer may cover it externally. */
export const ABSENCE_GAP_CHECK_SUFFIXES = [".not_detected", ".not_enabled", ".missing"] as const;

export type AbsenceGapPrompt = {
  capability: string;
  externalOption: string;
  awsOption: string;
};

type AbsenceGapActions = {
  externalOption: string;
  awsOption: string;
};

/** Capability name (not the failure-state label from the findings table). */
const ABSENCE_GAP_CAPABILITY: Record<string, string> = {
  "aws.vulnerability_monitoring.not_detected": "Vulnerability management",
  "vpc.flow_logs.not_enabled": "VPC flow logging",
  "aws.config.not_enabled": "AWS Config",
  "guardduty.detector.not_enabled": "GuardDuty threat detection",
  "aws.securityhub.not_enabled": "AWS Security Hub",
  "aws.access_analyzer.not_enabled": "IAM Access Analyzer",
  "cloudtrail.trail.not_enabled": "CloudTrail logging",
  "backup.plan.missing": "AWS Backup plan coverage",
};

const ABSENCE_GAP_ACTIONS: Record<string, AbsenceGapActions> = {
  "aws.vulnerability_monitoring.not_detected": {
    externalOption:
      "Provide evidence that you manage vulnerability management outside AWS (e.g. Wiz, Orca, Snyk, or Tenable export or dashboard link).",
    awsOption: "Enable AWS Inspector and container/image scanning in this account.",
  },
  "vpc.flow_logs.not_enabled": {
    externalOption:
      "Provide evidence of equivalent network visibility — e.g. transit gateway flow logs, traffic mirroring to an NDR appliance, or a SIEM ingesting equivalent telemetry.",
    awsOption: "Enable VPC flow logs on in-scope VPCs.",
  },
  "aws.config.not_enabled": {
    externalOption:
      "Provide evidence that configuration monitoring is covered elsewhere (e.g. a CSPM such as Wiz, Orca, or Prisma).",
    awsOption: "Enable the AWS Config recorder and delivery channel in this account.",
  },
  "guardduty.detector.not_enabled": {
    externalOption:
      "Provide evidence that threat detection is covered by your security stack outside GuardDuty.",
    awsOption: "Enable Amazon GuardDuty in in-scope regions.",
  },
  "aws.securityhub.not_enabled": {
    externalOption:
      "Provide evidence that your central security platform covers the same controls Security Hub would aggregate.",
    awsOption: "Enable AWS Security Hub in this account.",
  },
  "aws.access_analyzer.not_enabled": {
    externalOption:
      "Provide evidence of equivalent access-governance or external-access review coverage.",
    awsOption: "Enable IAM Access Analyzer in in-scope regions.",
  },
  "cloudtrail.trail.not_enabled": {
    externalOption:
      "Provide evidence that equivalent API audit logging exists elsewhere (e.g. org trail, SIEM, or logging platform).",
    awsOption: "Enable CloudTrail logging in this account.",
  },
  "backup.plan.missing": {
    externalOption:
      "Provide evidence of another backup process that covers the same data on a defined schedule.",
    awsOption: "Create an AWS Backup plan for in-scope resources.",
  },
};

function absenceGapSuffix(checkId: string): (typeof ABSENCE_GAP_CHECK_SUFFIXES)[number] | null {
  return ABSENCE_GAP_CHECK_SUFFIXES.find((suffix) => checkId.endsWith(suffix)) ?? null;
}

export function isAbsenceGapCheck(checkId: string): boolean {
  return absenceGapSuffix(checkId) !== null;
}

export function openAbsenceGapChecks(
  checkIds: string[],
  findingCountByCheck: Map<string, number>,
): string[] {
  return checkIds.filter((id) => isAbsenceGapCheck(id) && (findingCountByCheck.get(id) ?? 0) > 0);
}

/**
 * Absence gaps that a *different* AWS account can legitimately satisfy AND that
 * we can't auto-detect from this member account — so "covered in another AWS
 * account" is a real option worth offering.
 *
 * Deliberately narrow. Org CloudTrail, GuardDuty, Config and Security Hub are
 * already detected from the member (the org trail shows in DescribeTrails;
 * delegated-admin coverage enables the member resource), so a remaining gap on
 * those is genuine — not something another account covers. Per-account controls
 * (VPC flow logs, backups) can't be covered elsewhere at all. IAM Access
 * Analyzer's org analyzer lives only in the admin account and is invisible from
 * a member, so it's the one case left.
 */
export const CROSS_ACCOUNT_COVERABLE_CHECKS = new Set<string>([
  "aws.access_analyzer.not_enabled",
]);

export function openCrossAccountCoverableChecks(
  checkIds: string[],
  findingCountByCheck: Map<string, number>,
): string[] {
  return openAbsenceGapChecks(checkIds, findingCountByCheck).filter((id) =>
    CROSS_ACCOUNT_COVERABLE_CHECKS.has(id),
  );
}

/** AWS console deep-link for the service behind an absence gap, so the user
 *  can jump straight to enabling it. */
const ABSENCE_GAP_CONSOLE_URL: Record<string, string> = {
  "aws.access_analyzer.not_enabled": "https://console.aws.amazon.com/access-analyzer/home",
  "guardduty.detector.not_enabled": "https://console.aws.amazon.com/guardduty/home",
  "aws.config.not_enabled": "https://console.aws.amazon.com/config/home",
  "aws.securityhub.not_enabled": "https://console.aws.amazon.com/securityhub/home",
  "cloudtrail.trail.not_enabled": "https://console.aws.amazon.com/cloudtrail/home",
  "vpc.flow_logs.not_enabled": "https://console.aws.amazon.com/vpc/home#vpcs:",
  "backup.plan.missing": "https://console.aws.amazon.com/backup/home",
  "aws.vulnerability_monitoring.not_detected": "https://console.aws.amazon.com/inspector/v2/home",
};

export function absenceGapConsoleUrl(checkId: string): string | null {
  return ABSENCE_GAP_CONSOLE_URL[checkId] ?? null;
}

/** Deduped list of the AWS capabilities to enable for a composite's open
 *  absence gaps: { checkId, capability, consoleUrl }. */
export function absenceGapEnableItems(
  checkIds: string[],
  findingCountByCheck: Map<string, number>,
): { checkId: string; capability: string; consoleUrl: string | null }[] {
  const seen = new Set<string>();
  const out: { checkId: string; capability: string; consoleUrl: string | null }[] = [];
  for (const id of openAbsenceGapChecks(checkIds, findingCountByCheck)) {
    const capability = absenceGapCapabilityName(id);
    if (seen.has(capability)) continue;
    seen.add(capability);
    out.push({ checkId: id, capability, consoleUrl: absenceGapConsoleUrl(id) });
  }
  return out;
}

export function absenceGapCapabilityName(checkId: string): string {
  if (ABSENCE_GAP_CAPABILITY[checkId]) return ABSENCE_GAP_CAPABILITY[checkId];
  const label = labelForCheck(checkId);
  return label.replace(/\s+(disabled|not enabled|missing|non-compliant)$/i, "").trim() || label;
}

function defaultActions(capability: string, suffix: (typeof ABSENCE_GAP_CHECK_SUFFIXES)[number]): AbsenceGapActions {
  if (suffix === ".not_detected") {
    return {
      externalOption: `Provide evidence that you manage ${capability.toLowerCase()} outside AWS.`,
      awsOption: `Enable the corresponding AWS capability for ${capability.toLowerCase()} in this account.`,
    };
  }
  if (suffix === ".missing") {
    return {
      externalOption: `Provide evidence that ${capability.toLowerCase()} is covered another way.`,
      awsOption: `Configure ${capability.toLowerCase()} in AWS for in-scope resources.`,
    };
  }
  return {
    externalOption: `Provide evidence of an equivalent control that covers ${capability.toLowerCase()}.`,
    awsOption: `Enable ${capability.toLowerCase()} in this account.`,
  };
}

export function absenceGapPrompt(checkId: string): AbsenceGapPrompt {
  const capability = absenceGapCapabilityName(checkId);
  const suffix = absenceGapSuffix(checkId) ?? ".not_enabled";
  const actions = ABSENCE_GAP_ACTIONS[checkId] ?? defaultActions(capability, suffix);
  return { capability, ...actions };
}

export function findingsHrefForAbsenceGaps(
  checkIds: string[],
  findingCountByCheck: Map<string, number>,
): string | null {
  const gaps = openAbsenceGapChecks(checkIds, findingCountByCheck);
  if (gaps.length === 0) return null;
  return `/findings?checks=${encodeURIComponent(gaps.join(","))}`;
}

export function compositeNeedsExternalEvidence(
  groupStatus: "pass" | "fail" | "at_risk" | "no_data",
  checkIds: string[],
  findingCountByCheck: Map<string, number>,
  acceptedCount: number,
): boolean {
  if (groupStatus !== "fail" || acceptedCount > 0) return false;
  return openAbsenceGapChecks(checkIds, findingCountByCheck).length > 0;
}
