import type { ComplianceHistoryResponse } from "./complianceHistory";

export type TimestampedValue = { timestamp: string; value: number };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Latest point at or before `daysAgo` calendar days from now. */
export function valueAtOrBeforeDaysAgo(points: TimestampedValue[], daysAgo: number): number | null {
  if (points.length === 0) return null;
  const cutoff = Date.now() - daysAgo * MS_PER_DAY;
  let best: TimestampedValue | null = null;
  let bestTs = -Infinity;
  for (const point of points) {
    const ts = new Date(point.timestamp).getTime();
    if (ts <= cutoff && ts > bestTs) {
      best = point;
      bestTs = ts;
    }
  }
  return best?.value ?? null;
}

export function postureTrendSeries(history: ComplianceHistoryResponse | undefined): TimestampedValue[] {
  return (history?.posture_trend ?? []).map((p) => ({
    timestamp: p.timestamp,
    value: p.posture_score,
  }));
}

export function openFindingsSeries(
  history: ComplianceHistoryResponse | undefined,
  currentOpen: number | null | undefined,
): TimestampedValue[] {
  const byScan = new Map<string, TimestampedValue>();
  for (const evt of history?.events ?? []) {
    const count = evt.snapshot?.open_findings_count;
    if (count == null) continue;
    byScan.set(evt.scan_run_id, { timestamp: evt.timestamp, value: count });
  }
  const points = [...byScan.values()].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  if (currentOpen != null) {
    const latest = points[points.length - 1];
    if (!latest || latest.value !== currentOpen) {
      points.push({ timestamp: new Date().toISOString(), value: currentOpen });
    }
  }
  return points;
}

export function delta7d(current: number | null | undefined, prior: number | null): number | null {
  if (current == null || prior == null) return null;
  return current - prior;
}

export type BetterWhen = "up" | "down";

export function deltaImproved(delta: number, betterWhen: BetterWhen): boolean {
  return betterWhen === "up" ? delta > 0 : delta < 0;
}

export function formatMetricDelta(delta: number, format: "count" | "percent" | "points"): string {
  const sign = delta > 0 ? "+" : "−";
  const magnitude = Math.abs(delta);
  if (format === "percent") return `${sign}${magnitude}%`;
  if (format === "points") return `${sign}${magnitude} pts`;
  return `${sign}${magnitude.toLocaleString()}`;
}
