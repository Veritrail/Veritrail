export type ControlFindingEvent = {
  timestamp: string;
  type: string;
  finding_id?: string;
  finding_status?: string;
  affects_control_status?: boolean;
  detail?: string;
  check_id?: string;
};

/**
 * Collapse the API's event stream into one current lifecycle row per finding.
 * The stream intentionally contains both a synthesized first-seen event and a
 * persisted `opened` event; rendering it literally made one finding appear
 * twice and made historical detections look like currently open findings.
 */
export function collapseFindingLifecycles<T extends ControlFindingEvent>(rows: T[]): T[] {
  const byFinding = new Map<string, T>();
  const legacySeen = new Set<string>();

  for (const event of rows) {
    if (!event.type.startsWith("finding_")) continue;
    if (event.affects_control_status === false) continue;

    if (!event.finding_id) {
      // Backward-compatible fallback while an older API response is cached.
      // Normalize to the displayed minute because seconds are not shown.
      const minute = Math.floor(new Date(event.timestamp).getTime() / 60_000);
      const normalizedType = ["finding_detected", "finding_opened"].includes(event.type)
        ? "finding_detected"
        : event.type;
      const key = `${minute}|${normalizedType}|${event.detail ?? event.check_id ?? ""}`;
      if (legacySeen.has(key)) continue;
      legacySeen.add(key);
      byFinding.set(`legacy:${key}`, event);
      continue;
    }

    const existing = byFinding.get(event.finding_id);
    const firstObserved =
      !existing || new Date(event.timestamp).getTime() < new Date(existing.timestamp).getTime()
        ? event
        : existing;
    const status = event.finding_status ?? existing?.finding_status;
    byFinding.set(event.finding_id, {
      ...firstObserved,
      finding_id: event.finding_id,
      finding_status: status,
      type: status ? `finding_${status}` : firstObserved.type,
    });
  }

  return Array.from(byFinding.values())
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 12);
}
