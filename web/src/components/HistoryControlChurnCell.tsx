import { useMemo } from "react";

import type { HistoryEvent, ScanCadenceDay } from "../lib/complianceHistory";
import { BAR_COUNT, HistoryCadenceBars, bucketActivitySeries } from "./HistoryCadenceBars";

function uniqueControlsChanged(events: HistoryEvent[]): number {
  const ids = new Set<string>();
  for (const evt of events) {
    if (evt.type === "baseline_established" || evt.type.startsWith("finding_")) continue;
    for (const c of evt.diff?.newly_failed ?? []) ids.add(c.control_id);
    for (const c of evt.diff?.newly_passed ?? []) ids.add(c.control_id);
  }
  return ids.size;
}

function churnDaySeries(scanCadence: ScanCadenceDay[] | undefined, periodDays: number): number[] {
  const byDay = new Map<string, number>();
  for (const row of scanCadence ?? []) {
    byDay.set(row.date, row.posture_change_count);
  }

  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const daily: number[] = [];
  for (let i = periodDays - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    daily.push(byDay.get(d.toISOString().slice(0, 10)) ?? 0);
  }

  return bucketActivitySeries(daily, BAR_COUNT);
}

export function HistoryControlChurnCell({
  events,
  scanCadence,
  periodDays,
  showActivity = true,
}: {
  events: HistoryEvent[];
  scanCadence?: ScanCadenceDay[];
  periodDays: number;
  showActivity?: boolean;
}) {
  const changed = useMemo(() => uniqueControlsChanged(events), [events]);
  const series = useMemo(() => churnDaySeries(scanCadence, periodDays), [scanCadence, periodDays]);

  return (
    <div className="history-churn">
      <p className="history-stats__label">Control churn</p>
      <p className="history-churn__stat">
        <span className="history-churn__count">{changed}</span>
        <span className="history-churn__suffix">control{changed === 1 ? "" : "s"} changed</span>
      </p>
      {showActivity ? (
        <HistoryCadenceBars values={series} />
      ) : (
        <p className="history-churn__note">Point-in-time control movement</p>
      )}
    </div>
  );
}
