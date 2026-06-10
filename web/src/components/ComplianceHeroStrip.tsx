import type { ReactNode } from "react";

function ScoreRing({ pct, size = 56 }: { pct: number | null; size?: number }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const value = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const offset = c - (value / 100) * c;
  const ringClass =
    value >= 80 ? "text-emerald-500" : value >= 50 ? "text-amber-500" : value > 0 ? "text-rose-500" : "text-zinc-300";

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-zinc-100" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className={`${ringClass} transition-[stroke-dashoffset] duration-500`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-sm font-bold tabular-nums leading-none ${pct == null ? "text-zinc-400" : "text-zinc-900"}`}>
          {pct == null ? "—" : `${pct}%`}
        </span>
      </div>
    </div>
  );
}

export function ComplianceHeroStrip({
  frameworkLabel,
  passRate,
  passed,
  total,
  failed,
  openFindings,
  controlsImproved,
  controlsRegressed,
  findingsResolved,
  periodDays,
  topBlocker,
  onTopBlockerClick,
  loading,
}: {
  frameworkLabel: string;
  passRate: number | null;
  passed: number;
  total: number;
  failed: number;
  openFindings: number;
  controlsImproved: number;
  controlsRegressed: number;
  findingsResolved: number;
  periodDays: number;
  topBlocker: ReactNode;
  onTopBlockerClick?: () => void;
  loading?: boolean;
}) {
  const netControls = controlsImproved - controlsRegressed;
  const trendLabel =
    netControls > 0
      ? `+${netControls} control${netControls === 1 ? "" : "s"} improved`
      : netControls < 0
        ? `${netControls} control${netControls === -1 ? "" : "s"} regressed`
        : "No control changes";
  const trendClass =
    netControls > 0 ? "text-emerald-700" : netControls < 0 ? "text-rose-700" : "text-zinc-500";

  return (
    <div className="border-b border-zinc-100 bg-gradient-to-r from-zinc-50/90 via-white to-zinc-50/40 px-5 py-4">
      <div className="flex flex-wrap items-center gap-4 lg:gap-5">
        <ScoreRing pct={loading ? null : passRate} />

        <div className="min-w-0 flex-1">
          <p className="text-meta font-semibold text-zinc-500">{frameworkLabel} posture</p>
          <p className="mt-0.5 text-body font-semibold text-zinc-900">
            {loading ? (
              "Loading…"
            ) : total === 0 ? (
              "Awaiting scan data"
            ) : (
              <>
                <span className="text-emerald-700">{passed}</span>
                <span className="text-zinc-500"> of </span>
                <span>{total}</span>
                <span className="text-zinc-500"> controls passing</span>
              </>
            )}
          </p>
          {!loading && total > 0 ? (
            <p className="mt-1 text-meta text-zinc-500">
              <span className="font-medium text-rose-600">{failed} failing</span>
              {" · "}
              <span className="tabular-nums">{openFindings} open findings</span>
            </p>
          ) : null}
        </div>

        <div className="flex min-w-[9rem] flex-col gap-1 border-l border-zinc-100 pl-4">
          <p className="vigil-kicker">Last {periodDays} days</p>
          <p className={`text-meta font-semibold tabular-nums ${trendClass}`}>{loading ? "—" : trendLabel}</p>
          {!loading && findingsResolved > 0 ? (
            <p className="text-meta text-emerald-700">{findingsResolved} findings resolved</p>
          ) : null}
        </div>

        {topBlocker ? (
          <div className="w-full min-w-[12rem] flex-1 border-t border-zinc-100 pt-3 lg:max-w-md lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
            <p className="vigil-kicker">Top blocker</p>
            {onTopBlockerClick ? (
              <button
                type="button"
                onClick={onTopBlockerClick}
                className="mt-1 text-left text-meta font-semibold text-indigo-700 transition hover:text-indigo-900"
              >
                {topBlocker}
              </button>
            ) : (
              <p className="mt-1 text-meta font-medium text-zinc-700">{topBlocker}</p>
            )}
          </div>
        ) : !loading && total > 0 && failed === 0 ? (
          <div className="w-full min-w-[12rem] flex-1 border-t border-zinc-100 pt-3 lg:max-w-md lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
            <p className="vigil-kicker">Status</p>
            <p className="mt-1 text-meta font-semibold text-emerald-700">All mapped controls passing</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
