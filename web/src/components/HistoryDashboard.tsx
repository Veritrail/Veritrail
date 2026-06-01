import type { ReactNode } from "react";
import type {
  CurrentSummary,
  HistoryEvent,
  PeriodSummary,
  PersistentGap,
  ScanCadenceDay,
} from "../lib/complianceHistory";
import { ComplianceTrendChart } from "./ComplianceTrendChart";

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: "neutral" | "good" | "bad";
}) {
  const valueClass =
    tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-rose-700" : "text-zinc-950";
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 shadow-sm shadow-zinc-950/[0.02]">
      <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${valueClass}`}>{value}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{detail}</p>
    </div>
  );
}

function buildInsightCopy(
  events: HistoryEvent[],
  currentScore: number | null | undefined,
  days: number,
  resolvedInPeriod: number,
  periodSummary?: PeriodSummary,
): { headline: string; subline: string; previous: number | null; current: number | null; delta: number | null } {
  const chronological = [...events].reverse();
  const scores = chronological.map((e) => e.posture_after).filter((v): v is number => v != null);
  const current = currentScore ?? scores[scores.length - 1] ?? null;
  const previous = scores.length >= 2 ? scores[0] : null;
  const delta = previous != null && current != null ? current - previous : null;

  if (scores.length < 2) {
    if (resolvedInPeriod > 0) {
      return {
        headline: `${resolvedInPeriod} finding${resolvedInPeriod === 1 ? "" : "s"} verified in this window`,
        subline: `Resolved in the last ${days} days. Run another scan to chart posture movement.`,
        previous,
        current,
        delta: null,
      };
    }
    if (events.length === 1 && events[0]?.type === "baseline_established") {
      return {
        headline: "Baseline recorded",
        subline: "History starts with your first completed scan. Remediations, exceptions, and control changes will appear here.",
        previous: null,
        current,
        delta: null,
      };
    }
    return {
      headline: "Not enough completed scans to calculate movement",
      subline: "Trend and posture delta appear after two completed scans in this window.",
      previous,
      current,
      delta: null,
    };
  }

  if (delta != null && delta !== 0) {
    const improved = delta > 0;
    return {
      headline: `Posture ${improved ? "increased" : "decreased"} ${Math.abs(delta)} points in this window`,
      subline: previous != null && current != null ? `${previous}% → ${current}% for the selected framework` : "",
      previous,
      current,
      delta,
    };
  }

  const improved = periodSummary?.controls_improved ?? 0;
  const regressed = periodSummary?.controls_regressed ?? 0;
  if (resolvedInPeriod > 0) {
    return {
      headline: `${resolvedInPeriod} finding${resolvedInPeriod === 1 ? "" : "s"} verified as resolved in this window`,
      subline: "Posture score held steady while findings closed.",
      previous,
      current,
      delta: 0,
    };
  }
  if (improved > 0 || regressed > 0) {
    return {
      headline: "Posture held steady in this window",
      subline: `${improved} control${improved === 1 ? "" : "s"} improved · ${regressed} regressed`,
      previous,
      current,
      delta: 0,
    };
  }

  return {
    headline: current != null ? `Posture steady at ${current}%` : "Posture steady in this window",
    subline: `No material score change in the last ${days} days.`,
    previous,
    current,
    delta: 0,
  };
}

function MainInsightCard({
  events,
  currentScore,
  days,
  resolvedInPeriod,
  periodSummary,
}: {
  events: HistoryEvent[];
  currentScore: number | null | undefined;
  days: number;
  resolvedInPeriod: number;
  periodSummary?: PeriodSummary;
}) {
  const insight = buildInsightCopy(events, currentScore, days, resolvedInPeriod, periodSummary);
  const deltaTone =
    insight.delta == null
      ? "text-zinc-500"
      : insight.delta > 0
        ? "text-emerald-700"
        : insight.delta < 0
          ? "text-rose-700"
          : "text-zinc-700";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3.5 shadow-sm shadow-zinc-950/[0.02]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Window summary</p>
          <h2 className="mt-1 text-base font-bold tracking-tight text-zinc-950">{insight.headline}</h2>
          {insight.subline && <p className="mt-1 text-sm leading-relaxed text-zinc-500">{insight.subline}</p>}
        </div>
        {insight.current != null && (
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Current</p>
            <p className="text-2xl font-bold tabular-nums text-zinc-950">{insight.current}%</p>
            {insight.previous != null && insight.delta != null && insight.delta !== 0 && (
              <p className={`text-xs font-semibold tabular-nums ${deltaTone}`}>
                from {insight.previous}% ({insight.delta > 0 ? "+" : "−"}
                {Math.abs(insight.delta)} pts)
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ControlStatusCompact({ summary }: { summary: CurrentSummary }) {
  const total = summary.controls_passed + summary.controls_failed + summary.controls_no_data;
  if (total === 0) return null;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 shadow-sm shadow-zinc-950/[0.02]">
      <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Current control status</p>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-zinc-100 ring-1 ring-zinc-200/60">
        {summary.controls_passed > 0 && (
          <div className="bg-emerald-500" style={{ width: `${(summary.controls_passed / total) * 100}%` }} />
        )}
        {summary.controls_failed > 0 && (
          <div className="bg-rose-500" style={{ width: `${(summary.controls_failed / total) * 100}%` }} />
        )}
        {summary.controls_no_data > 0 && (
          <div className="bg-zinc-300" style={{ width: `${(summary.controls_no_data / total) * 100}%` }} />
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-zinc-600">
        <span>
          <span className="font-semibold tabular-nums text-emerald-700">{summary.controls_passed}</span> passing
        </span>
        <span>
          <span className="font-semibold tabular-nums text-rose-700">{summary.controls_failed}</span> failing
        </span>
        {summary.controls_no_data > 0 && (
          <span>
            <span className="font-semibold tabular-nums text-zinc-500">{summary.controls_no_data}</span> no data
          </span>
        )}
      </div>
    </div>
  );
}

function PersistentGapsCompact({ gaps }: { gaps: PersistentGap[] }) {
  if (gaps.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 shadow-sm shadow-zinc-950/[0.02]">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Persistent gaps</p>
        <p className="mt-1 text-xs text-zinc-500">No failing controls with open findings right now.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 shadow-sm shadow-zinc-950/[0.02]">
      <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Persistent gaps</p>
      <p className="mt-0.5 text-[11px] text-zinc-500">Controls with the most open findings.</p>
      <ul className="mt-2 space-y-1">
        {gaps.slice(0, 4).map((g) => (
          <li key={g.control_id} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="min-w-0 truncate font-medium text-zinc-800">{g.title}</span>
            <span className="shrink-0 tabular-nums font-semibold text-rose-700">{g.open_finding_count} open</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EvidenceCadenceCompact({
  cadence,
  days,
  scanCount,
}: {
  cadence: ScanCadenceDay[];
  days: number;
  scanCount: number;
}) {
  const visible = cadence.slice(-14);
  const maxScans = Math.max(1, ...visible.map((d) => d.scan_count));

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 shadow-sm shadow-zinc-950/[0.02]">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Evidence cadence</p>
        <p className="text-[10px] text-zinc-400">{scanCount} scan{scanCount === 1 ? "" : "s"}</p>
      </div>
      {visible.length < 2 ? (
        <p className="mt-1.5 text-xs text-zinc-500">Cadence appears after two scan days.</p>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-[repeat(14,minmax(0,1fr))] gap-0.5">
            {visible.map((d) => {
              const intensity = d.scan_count / maxScans;
              const cls =
                d.posture_change_count > 0
                  ? "bg-indigo-500"
                  : intensity > 0.66
                    ? "bg-emerald-500"
                    : intensity > 0.33
                      ? "bg-emerald-300"
                      : "bg-emerald-100";
              return (
                <div
                  key={d.date}
                  className={`h-4 rounded-sm ${cls}`}
                  title={`${d.date}: ${d.scan_count} scan${d.scan_count === 1 ? "" : "s"}`}
                />
              );
            })}
          </div>
          <p className="mt-1 text-[10px] text-zinc-500">Last {Math.min(days, visible.length)} scan days</p>
        </>
      )}
    </div>
  );
}

export function HistoryDashboard({
  events,
  days,
  currentScore,
  currentSummary,
  periodSummary,
  scanCount,
  scanCadence = [],
  persistentGaps = [],
  openFindingsCount,
  resolvedInPeriod,
  onSelectSnapshot,
  timeline,
}: {
  events: HistoryEvent[];
  days: number;
  currentScore: number | null | undefined;
  currentSummary?: CurrentSummary | null;
  periodSummary?: PeriodSummary;
  scanCount?: number;
  scanCadence?: ScanCadenceDay[];
  persistentGaps?: PersistentGap[];
  openFindingsCount?: number;
  resolvedInPeriod?: number;
  onSelectSnapshot?: (scanRunId: string) => void;
  timeline?: ReactNode;
}) {
  const improved = periodSummary?.controls_improved ?? 0;
  const regressed = periodSummary?.controls_regressed ?? 0;
  const changed = improved + regressed;
  const openFindings = openFindingsCount ?? 0;
  const resolved = resolvedInPeriod ?? 0;
  const scans = scanCount ?? 0;
  const hasTrend = events.length >= 2;

  return (
    <div className="space-y-3">
      <MainInsightCard
        events={events}
        currentScore={currentScore}
        days={days}
        resolvedInPeriod={resolved}
        periodSummary={periodSummary}
      />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Open findings"
          value={openFindings}
          detail="Active in Findings now"
          tone={openFindings > 0 ? "bad" : "good"}
        />
        <MetricCard
          label="Resolved"
          value={resolved}
          detail={`Verified in the last ${days} days`}
          tone={resolved > 0 ? "good" : "neutral"}
        />
        <MetricCard
          label="Controls changed"
          value={changed}
          detail={`${improved} improved · ${regressed} regressed`}
          tone={regressed > 0 ? "bad" : changed > 0 ? "good" : "neutral"}
        />
        <MetricCard label="Scans" value={scans} detail={`Completed in ${days}-day window`} />
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-7">
          <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 shadow-sm shadow-zinc-950/[0.02]">
            <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Posture trend</p>
            {hasTrend ? (
              <div className="mt-2">
                <ComplianceTrendChart
                  compact
                  events={events}
                  currentScore={currentScore}
                  days={days}
                  periodSummary={periodSummary}
                  onSelectSnapshot={onSelectSnapshot}
                />
              </div>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-zinc-500">Trend appears after two completed scans.</p>
            )}
          </div>
          {timeline}
        </div>

        <div className="space-y-3 lg:col-span-5">
          {currentSummary && <ControlStatusCompact summary={currentSummary} />}
          <PersistentGapsCompact gaps={persistentGaps} />
          <EvidenceCadenceCompact cadence={scanCadence} days={days} scanCount={scans} />
        </div>
      </div>
    </div>
  );
}
