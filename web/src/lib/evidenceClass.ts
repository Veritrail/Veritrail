/** Whether an open finding should count toward control fail UI (benchmark checks only). */
export function openFindingFailsControl(
  checkId: string,
  evidenceClasses?: Record<string, string>,
): boolean {
  const cls = evidenceClasses?.[checkId];
  if (cls) return cls === "benchmark";
  return !checkId.startsWith("cloudtrail.event.");
}

export function isActivityCheck(checkId: string): boolean {
  return checkId.startsWith("cloudtrail.event.");
}
