import { useMemo } from "react";

import type { HistoryEvent } from "../lib/complianceHistory";

function uniqueControlsChanged(events: HistoryEvent[]): number {
  const ids = new Set<string>();
  for (const evt of events) {
    if (evt.type === "baseline_established" || evt.type.startsWith("finding_")) continue;
    for (const c of evt.diff?.newly_failed ?? []) ids.add(c.control_id);
    for (const c of evt.diff?.newly_passed ?? []) ids.add(c.control_id);
  }
  return ids.size;
}

export function HistoryControlChurnCell({
  events,
}: {
  events: HistoryEvent[];
}) {
  const changed = useMemo(() => uniqueControlsChanged(events), [events]);
  const hasChurn = changed > 0;

  return (
    <div className="history-churn">
      <p className="history-stats__label">Control churn</p>
      <div className={`history-churn__summary${hasChurn ? " history-churn__summary--active" : ""}`}>
        <span className="history-churn__count">{changed}</span>
        <span className="history-churn__suffix">control{changed === 1 ? "" : "s"} changed</span>
      </div>
      <p className="history-churn__note">
        {hasChurn ? "Movement detected in this window" : "No control movement in this window"}
      </p>
    </div>
  );
}
