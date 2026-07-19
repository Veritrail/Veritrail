import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { z } from "zod";

import { api } from "../api";
import {
  controlsHistorySummarySchema,
  type ControlTimelineRow,
} from "../lib/apiSchemas";
import { compareControlIds, controlFamily, isHiddenComplianceFamily } from "../lib/controlFamilies";
import { findingsHrefForCheckIds } from "../hooks/useConnectedAccountOptions";

/** Drill-down payload from GET /v1/controls/{id}/history (loose parse). */
const controlHistoryDrillSchema = z
  .object({
    events: z
      .array(
        z.object({
          timestamp: z.string(),
          type: z.string(),
          detail: z.string().optional(),
          check_id: z.string().optional(),
        }),
      )
      .default([]),
  })
  .passthrough();

type ControlTimelineBoardProps = {
  accountId: string;
  framework: string;
  days: number;
  /** Restrict to controls touching these check ids (composite group filter). */
  checkIdFilter?: Set<string> | null;
};

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function drillTypeLabel(type: string): string {
  switch (type) {
    case "finding_detected":
    case "finding_opened":
      return "Detected";
    case "finding_resolved":
      return "Resolved";
    case "finding_reopened":
      return "Reopened";
    case "finding_excepted":
      return "Exception";
    case "scan_completed":
      return "Scan";
    default:
      return type.replace(/^scan_/, "Scan ").replace(/_/g, " ");
  }
}

function rowSummary(row: ControlTimelineRow): {
  label: string;
  meta: string | null;
  tone: string;
} {
  if (row.current_status === "fail") {
    const parts = [
      row.failing_since ? `since ${formatDay(row.failing_since)}` : null,
      row.open_finding_count > 0 ? `${row.open_finding_count} open` : null,
    ].filter(Boolean);
    return { label: "Failing", meta: parts.join(" · ") || null, tone: "fail" };
  }
  if (row.current_status === "pass") {
    // Duration of the trailing pass stretch, so "fixed last week" is visible.
    const lastSegment = row.segments[row.segments.length - 1];
    if (lastSegment && lastSegment.status === "pass") {
      const passDays = Math.floor(lastSegment.duration_seconds / 86_400);
      return { label: "Passing", meta: passDays >= 1 ? `${passDays}d` : null, tone: "pass" };
    }
    return { label: "Passing", meta: null, tone: "pass" };
  }
  return { label: "No data", meta: null, tone: "no-data" };
}

type PostureChange = {
  controlId: string;
  title: string;
  direction: "regressed" | "recovered";
  at: string;
};

/** Last pass↔fail flip inside the window — no_data boundaries are not "changes". */
function lastTransition(row: ControlTimelineRow, windowStartMs: number): PostureChange | null {
  const graded = row.segments.filter(
    (segment) =>
      (segment.status === "pass" || segment.status === "fail") &&
      new Date(segment.to).getTime() > windowStartMs,
  );
  for (let i = graded.length - 1; i > 0; i--) {
    if (graded[i].status !== graded[i - 1].status) {
      return {
        controlId: row.control_id,
        title: row.title,
        direction: graded[i].status === "fail" ? "regressed" : "recovered",
        at: graded[i].from,
      };
    }
  }
  return null;
}

function ControlDrilldown({
  controlId,
  accountId,
  framework,
  days,
  checkIds,
}: {
  controlId: string;
  accountId: string;
  framework: string;
  days: number;
  checkIds: string[];
}) {
  const drillQ = useQuery({
    queryKey: ["control-history-drill", accountId, framework, controlId, days],
    queryFn: () =>
      api(
        `/v1/controls/${encodeURIComponent(controlId)}/history?framework=${encodeURIComponent(framework)}&account_id=${encodeURIComponent(accountId)}&days=${days}`,
        { schema: controlHistoryDrillSchema },
      ),
    staleTime: 120_000,
  });

  const events = useMemo(() => {
    const rows = drillQ.data?.events ?? [];
    // Newest first; scans are context noise here — keep finding-state changes.
    // The API emits both finding_detected (first_seen) and finding_opened
    // (FindingEvent) for the same moment — keep one per timestamp+detail.
    const seen = new Set<string>();
    return rows
      .filter((event) => {
        if (!event.type.startsWith("finding_")) return false;
        const key = `${event.timestamp}|${event.detail ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice()
      .reverse()
      .slice(0, 12);
  }, [drillQ.data]);

  // Pin the link to this board's account scope: the shared helper guesses a
  // provider from check ids (mixed IAM + source-control controls came out as
  // provider=source_control, landing users on an empty Findings scope).
  const findingsHref = useMemo(() => {
    const base = findingsHrefForCheckIds(checkIds);
    if (!base) return null;
    const [path, query] = base.split("?");
    const params = new URLSearchParams(query ?? "");
    params.delete("provider");
    params.set("account_id", accountId);
    return `${path}?${params.toString()}`;
  }, [accountId, checkIds]);

  return (
    <div className="history-controls__drill">
      {drillQ.isLoading ? (
        <p className="history-controls__drill-empty">Loading events…</p>
      ) : events.length === 0 ? (
        <p className="history-controls__drill-empty">
          No finding-level changes for this control in the selected period.
        </p>
      ) : (
        <ul className="history-controls__drill-list">
          {events.map((event, index) => (
            <li key={`${event.timestamp}-${event.type}-${index}`}>
              <span className="history-controls__drill-time">{formatEventTime(event.timestamp)}</span>
              <span className={`history-controls__drill-type is-${event.type.replace("finding_", "")}`}>
                {drillTypeLabel(event.type)}
              </span>
              <span className="history-controls__drill-detail">{event.detail ?? event.check_id ?? ""}</span>
            </li>
          ))}
        </ul>
      )}
      {findingsHref ? (
        <Link to={findingsHref} className="history-controls__drill-link">
          View findings <span aria-hidden>→</span>
        </Link>
      ) : null}
    </div>
  );
}

export function ControlTimelineBoard({
  accountId,
  framework,
  days,
  checkIdFilter,
}: ControlTimelineBoardProps) {
  const [selectedControlId, setSelectedControlId] = useState<string | null>(null);

  const summaryQ = useQuery({
    queryKey: ["controls-history-summary", accountId, framework, days],
    queryFn: () =>
      api(
        `/v1/controls/history-summary?framework=${encodeURIComponent(framework)}&account_id=${encodeURIComponent(accountId)}&days=${days}`,
        { schema: controlsHistorySummarySchema },
      ),
    staleTime: 120_000,
  });

  // Clamp the visible window to the first real evidence: rendering weeks of
  // pre-first-scan "no data" makes every bar an identical grey-then-red wall.
  const evidenceStartMs = useMemo(() => {
    let min = Number.POSITIVE_INFINITY;
    for (const row of summaryQ.data?.controls ?? []) {
      for (const segment of row.segments) {
        if (segment.status !== "no_data") {
          min = Math.min(min, new Date(segment.from).getTime());
        }
      }
    }
    return Number.isFinite(min) ? min : null;
  }, [summaryQ.data]);

  const groups = useMemo(() => {
    const rows = (summaryQ.data?.controls ?? []).filter((row) => {
      if (!checkIdFilter) return true;
      return row.check_ids.some((id) => checkIdFilter.has(id));
    });
    const byFamily = new Map<string, { key: string; label: string; rows: ControlTimelineRow[] }>();
    for (const row of rows) {
      const family = controlFamily(framework, row.control_id);
      if (isHiddenComplianceFamily(family.key)) continue;
      const group = byFamily.get(family.key) ?? { ...family, rows: [] };
      group.rows.push(row);
      byFamily.set(family.key, group);
    }
    for (const group of byFamily.values()) {
      group.rows.sort((a, b) => compareControlIds(a.control_id, b.control_id));
    }
    return Array.from(byFamily.values()).sort(
      (a, b) => (a.key === "other" ? 1 : 0) - (b.key === "other" ? 1 : 0),
    );
  }, [summaryQ.data, framework, checkIdFilter]);

  const visibleRows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  if (summaryQ.isLoading) {
    return <p className="history-loading">Loading control timelines…</p>;
  }
  if (summaryQ.isError) {
    return (
      <p className="history-empty text-amber-800">
        Control timelines are temporarily unavailable. Try again in a moment.
      </p>
    );
  }

  const data = summaryQ.data;
  if (!data || data.controls.length === 0 || visibleRows.length === 0) {
    return (
      <div className="history-empty">
        <p className="font-semibold text-zinc-800">No graded controls yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">
          Control timelines appear after the first completed scan.
        </p>
      </div>
    );
  }

  const windowStartMs = evidenceStartMs ?? new Date(data.from).getTime();
  const clampedToEvidence =
    evidenceStartMs !== null && evidenceStartMs > new Date(data.from).getTime() + 86_400_000;
  const failingCount = visibleRows.filter((row) => row.current_status === "fail").length;
  const passingCount = visibleRows.filter((row) => row.current_status === "pass").length;
  const noDataCount = visibleRows.length - failingCount - passingCount;
  const postureChanges = visibleRows
    .map((row) => lastTransition(row, windowStartMs))
    .filter((change): change is PostureChange => change !== null)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const changeByControlId = new Map(postureChanges.map((change) => [change.controlId, change]));

  return (
    <div className="history-controls">
      <div className="history-controls__summary">
        <div>
          <p className="history-controls__summary-eyebrow">{days}-day control history</p>
          <h2>Where posture changed — and what still needs attention</h2>
          <p>Selected framework only · {formatDay(new Date(windowStartMs).toISOString())}{clampedToEvidence ? " first evidence" : ""} to today</p>
        </div>
        <div className="history-controls__summary-stats" aria-label="Control status summary">
          <span className="is-fail"><strong>{failingCount}</strong> failing</span>
          <span className="is-pass"><strong>{passingCount}</strong> passing</span>
          {noDataCount > 0 ? <span><strong>{noDataCount}</strong> no data</span> : null}
        </div>
      </div>

      <section className="history-controls__changes" aria-label="Posture changes in period">
        {postureChanges.length === 0 ? (
          <p className="history-controls__changes-empty">
            No posture changes in this period — every graded control has held the same state
            since its first evidence.
          </p>
        ) : (
          <ul className="history-controls__changes-list">
            {postureChanges.map((change) => (
              <li key={`${change.controlId}-${change.at}`}>
                <button
                  type="button"
                  className={`history-controls__change is-${change.direction}`}
                  onClick={() => {
                    setSelectedControlId(change.controlId);
                    requestAnimationFrame(() => {
                      document
                        .getElementById(`history-row-${change.controlId}`)
                        ?.scrollIntoView({ behavior: "smooth", block: "center" });
                    });
                  }}
                >
                  <span className="history-controls__change-badge">
                    {change.direction === "regressed" ? "Regressed" : "Recovered"}
                  </span>
                  <strong>{change.controlId}</strong>
                  <span className="history-controls__change-title">{change.title}</span>
                  <span className="history-controls__change-date">{formatDay(change.at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {groups.map((group) => (
        <section key={group.key} className="history-controls__group">
          <div className="history-controls__group-head">
            <h3 className="history-controls__group-title">{group.label}</h3>
            <span>{group.rows.length} controls</span>
          </div>
          <div className="history-controls__rows">
            <div className="history-controls__columns" aria-hidden>
              <span>Control</span><span>History</span><span>Current state</span>
            </div>
            {group.rows.map((row) => {
              const summary = rowSummary(row);
              const isExpanded = row.control_id === selectedControlId;
              return (
                <Fragment key={row.control_id}>
                  <button
                    type="button"
                    id={`history-row-${row.control_id}`}
                    className={`history-controls__row${isExpanded ? " is-expanded" : ""}`}
                    aria-expanded={isExpanded}
                    onClick={() =>
                      setSelectedControlId((current) =>
                        current === row.control_id ? null : row.control_id,
                      )
                    }
                  >
                    <span className={`history-controls__status-dot is-${summary.tone}`} aria-hidden />
                    <span className="history-controls__row-copy">
                      <strong>{row.control_id}</strong>
                      <span>{row.title}</span>
                    </span>
                    <span className="history-controls__bar-wrap">
                      {(() => {
                        const change = changeByControlId.get(row.control_id);
                        if (!change) {
                          return (
                            <span className="history-controls__steady">
                              {summary.tone === "no-data" ? "No evidence in period" : "No changes in period"}
                            </span>
                          );
                        }
                        const fromPass = change.direction === "regressed";
                        return (
                          <span className="history-controls__transition">
                            <span className={`history-controls__transition-state is-${fromPass ? "pass" : "fail"}`}>
                              <i aria-hidden />
                              {fromPass ? "Passing" : "Failing"}
                            </span>
                            <span className="history-controls__transition-arrow" aria-hidden>→</span>
                            <span className={`history-controls__transition-state is-${fromPass ? "fail" : "pass"}`}>
                              <i aria-hidden />
                              {fromPass ? "Failing" : "Passing"}
                            </span>
                            <span className="history-controls__transition-date">{formatDay(change.at)}</span>
                          </span>
                        );
                      })()}
                    </span>
                    <span className={`history-controls__row-state is-${summary.tone}`}>
                      <strong>{summary.label}</strong>
                      {summary.meta ? <span className="history-controls__row-meta">{summary.meta}</span> : null}
                    </span>
                    <span className="history-controls__row-arrow" aria-hidden>{isExpanded ? "⌃" : "⌄"}</span>
                  </button>
                  {isExpanded ? (
                    <div className="history-controls__row-drill">
                      <ControlDrilldown
                        controlId={row.control_id}
                        accountId={accountId}
                        framework={framework}
                        days={days}
                        checkIds={row.check_ids}
                      />
                    </div>
                  ) : null}
                </Fragment>
              );
            })}
          </div>
        </section>
      ))}

    </div>
  );
}
