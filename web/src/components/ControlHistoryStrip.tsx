import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "../api";
import { controlsHistorySummarySchema } from "../lib/apiSchemas";

function shortDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ControlHistoryStrip({
  accountId,
  framework,
  checkIds,
  days = 90,
}: {
  accountId: string;
  framework: string;
  checkIds: string[];
  days?: number;
}) {
  const historyQ = useQuery({
    queryKey: ["controls-history-summary", accountId, framework, days],
    queryFn: () =>
      api(
        `/v1/controls/history-summary?framework=${encodeURIComponent(framework)}&account_id=${encodeURIComponent(accountId)}&days=${days}`,
        { schema: controlsHistorySummarySchema },
      ),
    staleTime: 120_000,
  });

  const rows = useMemo(() => {
    const wanted = new Set(checkIds);
    return (historyQ.data?.controls ?? [])
      .filter((row) => row.check_ids.some((id) => wanted.has(id)))
      .sort((left, right) => {
        if (left.current_status === right.current_status) {
          return left.control_id.localeCompare(right.control_id, undefined, { numeric: true });
        }
        return left.current_status === "fail" ? -1 : 1;
      })
      .slice(0, 8);
  }, [checkIds, historyQ.data]);

  if (historyQ.isLoading) {
    return <p className="control-history-strip__empty">Loading check history…</p>;
  }
  if (historyQ.isError || rows.length === 0) {
    return <p className="control-history-strip__empty">No history is available for these checks yet.</p>;
  }

  return (
    <div className="control-history-strip">
      {rows.map((row) => (
        <div key={row.control_id} className="control-history-strip__row">
          <div className="control-history-strip__copy">
            <strong>{row.control_id}</strong>
            <span>{row.title}</span>
          </div>
          <div className="control-history-strip__timeline">
            <span className="control-history-strip__bar">
              {row.segments.map((segment, index) => (
                <i
                  key={`${segment.from}-${index}`}
                  className={`is-${segment.status.replace("_", "-")}`}
                  style={{ flexGrow: Math.max(segment.duration_seconds, 1) }}
                  title={`${shortDate(segment.from)}–${shortDate(segment.to)} · ${segment.status.replace("_", " ")}`}
                />
              ))}
            </span>
            <small>{days} days</small>
          </div>
          <span className={`control-history-strip__status is-${row.current_status.replace("_", "-")}`}>
            {row.current_status === "pass" ? "Passing" : row.current_status === "fail" ? "Failing" : "No data"}
          </span>
        </div>
      ))}
    </div>
  );
}
