import type { ReactNode } from "react";
import { Link } from "react-router-dom";

function passRateBarColor(pct: number) {
  if (pct >= 80) return "bg-emerald-500";
  if (pct >= 50) return "bg-amber-500";
  return "bg-rose-500";
}

export function CompliancePostureLine({
  unitLabel,
  passed,
  total,
  failed,
  openFindings,
  passRate,
  trendImproved,
  trendRegressed,
  findingsResolved,
  topBlocker,
  onTopBlockerClick,
  loading,
}: {
  unitLabel: "groups" | "criteria";
  passed: number;
  total: number;
  failed: number;
  openFindings: number;
  passRate: number | null;
  trendImproved: number;
  trendRegressed: number;
  findingsResolved: number;
  topBlocker: ReactNode;
  onTopBlockerClick?: () => void;
  loading?: boolean;
}) {
  const netTrend = trendImproved - trendRegressed;
  const trendCredible = total > 0 && trendImproved <= total && trendRegressed <= total;
  const showTrend = !loading && trendCredible && netTrend !== 0;

  return (
    <div className="mt-1.5 space-y-2">
      <p className="text-sm text-zinc-500">
        {loading ? (
          "Loading control status…"
        ) : total === 0 ? (
          "Control status against selected frameworks."
        ) : (
          <>
            <span className="font-medium text-zinc-700">
              {passed} of {total} {unitLabel} passing
            </span>
            {failed > 0 ? (
              <>
                {" · "}
                <span className="text-rose-600">{failed} failing</span>
              </>
            ) : null}
            {" · "}
            <span className="tabular-nums">{openFindings} open findings</span>
            {showTrend ? (
              <>
                {" · "}
                <span className={netTrend > 0 ? "text-emerald-700" : "text-rose-700"}>
                  {netTrend > 0 ? `+${netTrend}` : netTrend} {unitLabel} this week
                </span>
              </>
            ) : null}
            {!loading && findingsResolved > 0 ? (
              <>
                {" · "}
                <span className="text-emerald-700">{findingsResolved} resolved</span>
              </>
            ) : null}
            {topBlocker ? (
              <>
                {" · "}
                <span className="text-zinc-400">start with </span>
                {onTopBlockerClick ? (
                  <button
                    type="button"
                    onClick={onTopBlockerClick}
                    className="font-medium text-indigo-700 transition hover:text-indigo-900"
                  >
                    {topBlocker}
                  </button>
                ) : (
                  <span className="font-medium text-zinc-700">{topBlocker}</span>
                )}
              </>
            ) : null}
            {!loading && showTrend ? (
              <>
                {" · "}
                <Link to="/history" className="font-medium text-zinc-500 transition hover:text-indigo-700">
                  History
                </Link>
              </>
            ) : null}
          </>
        )}
      </p>
      {!loading && total > 0 && passRate != null ? (
        <div className="h-1 max-w-md overflow-hidden rounded-full bg-zinc-100">
          <div
            className={`h-full rounded-full transition-all duration-500 ${passRateBarColor(passRate)}`}
            style={{ width: `${Math.max(passRate, passRate > 0 ? 4 : 0)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
