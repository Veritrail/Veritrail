const CLASS_BENCHMARK = "benchmark";
const CLASS_SUPPORTING = "supporting";
const CLASS_ACTIVITY = "activity";

/** Whether an open finding should count toward control fail UI (benchmark checks only). */
export function openFindingFailsControl(
  checkId: string,
  evidenceClasses?: Record<string, string>,
): boolean {
  const cls = evidenceClasses?.[checkId];
  if (cls) return cls === CLASS_BENCHMARK;
  return !checkId.startsWith("cloudtrail.event.");
}

/** Whether an open finding should appear in compliance gap UI and status roll-ups.
 *  Includes benchmark, supporting, and activity classes — matching backend
 *  compute_control_status / at_risk surfacing (e.g. GuardDuty off on IR composites). */
export function openFindingAffectsControlStatus(
  checkId: string,
  evidenceClasses?: Record<string, string>,
): boolean {
  const cls = evidenceClasses?.[checkId];
  if (cls) {
    return (
      cls === CLASS_BENCHMARK || cls === CLASS_SUPPORTING || cls === CLASS_ACTIVITY
    );
  }
  // Before evidence classes load, include all open findings; hygiene is filtered once loaded.
  return true;
}

export function isActivityCheck(checkId: string): boolean {
  return checkId.startsWith("cloudtrail.event.");
}
