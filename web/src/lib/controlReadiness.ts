import { isAbsenceGapCheck, openAbsenceGapChecks } from "./evidenceGap";

export type ReadinessMetricVariant = "green" | "yellow" | "blue";
export type ReadinessMetricIcon = "automated" | "blocking" | "evidence";

export type ReadinessMetric = {
  label: string;
  complete: number;
  total: number;
  variant: ReadinessMetricVariant;
  icon: ReadinessMetricIcon;
};

/**
 * Concrete, auditable readiness counts for a control/composite — not a
 * "likelihood to pass" score. Three independent axes:
 *  - automated checks passing: overall health across every mapped check
 *  - blocking gaps closed: health of only the checks that can fail the
 *    control's status (core tier — extended checks are informational)
 *  - evidence current: absence-gap checks (the ones Veritrail can't verify
 *    in AWS at all) that are resolved, either by enabling the AWS service
 *    or accepting external evidence — omitted entirely when the control has
 *    no absence-gap checks, since "evidence" doesn't apply to it
 */
export function controlReadinessMetrics(
  checkIds: string[],
  checkTiers: Record<string, string> | undefined,
  findingCountByCheck: Map<string, number>,
): ReadinessMetric[] {
  if (checkIds.length === 0) return [];

  const failing = checkIds.filter((id) => (findingCountByCheck.get(id) ?? 0) > 0);
  const metrics: ReadinessMetric[] = [
    {
      label: "Automated checks passing",
      complete: checkIds.length - failing.length,
      total: checkIds.length,
      variant: "green",
      icon: "automated",
    },
  ];

  const coreIds = checkIds.filter((id) => (checkTiers?.[id] ?? "core") === "core");
  if (coreIds.length > 0) {
    const coreFailing = coreIds.filter((id) => (findingCountByCheck.get(id) ?? 0) > 0);
    metrics.push({
      label: "Blocking gaps closed",
      complete: coreIds.length - coreFailing.length,
      total: coreIds.length,
      variant: "yellow",
      icon: "blocking",
    });
  }

  const absenceGapIds = checkIds.filter((id) => isAbsenceGapCheck(id));
  if (absenceGapIds.length > 0) {
    const stillOpen = openAbsenceGapChecks(checkIds, findingCountByCheck);
    metrics.push({
      label: "Evidence current",
      complete: absenceGapIds.length - stillOpen.length,
      total: absenceGapIds.length,
      variant: "blue",
      icon: "evidence",
    });
  }

  return metrics;
}
