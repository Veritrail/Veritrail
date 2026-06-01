import type { ReactNode } from "react";
import type {
  CurrentSummary,
  HistoryEvent,
  PeriodSummary,
  PersistentGap,
  ScanCadenceDay,
} from "../lib/complianceHistory";

function WindowSummaryCard({
  resolved,
  days,
  improved,
  regressed,
  currentScore,
  scanCount,
  events,
}: {
  resolved: number;
  days: number;
  improved: number;
  regressed: number;
  currentScore: number | null | undefined;
  scanCount: number;
  events: HistoryEvent[];
}) {
  const hasTrend = scanCount >= 2 || events.length >= 2;
  const primary =
    resolved > 0
      ? `${resolved} finding${resolved === 1 ? "" : "s"} verified`
      : improved > 0
        ? `${improved} control${improved === 1 ? "" : "s"} improved`
        : events.length === 1 && events[0]?.type === "baseline_established"
          ? "Baseline recorded"
          : currentScore != null
            ? `Posture at ${currentScore}%`
            : "No movement yet";

  const supporting =
    resolved > 0
      ? `Resolved in the last ${days} days.`
      : events.length === 1 && events[0]?.type === "baseline_established"
        ? "History starts after your first completed scan."
        : `Window: last ${days} days.`;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xl font-bold tracking-tight text-zinc-950">{primary}</p>
          <p className="mt-0.5 text-sm text-zinc-500">{supporting}</p>
          <p className="mt-1.5 text-xs text-zinc-600">
            <span className="font-medium text-emerald-700">{improved}</span> controls improved
            <span className="text-zinc-300"> · </span>
            <span className="font-medium text-rose-700">{regressed}</span> regressed
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Current posture</p>
          <p className="text-2xl font-bold tabular-nums text-zinc-950">{currentScore ?? "—"}%</p>
          {!hasTrend && (
            <p className="mt-0.5 max-w-[12rem] text-[11px] leading-snug text-zinc-500">
              Run another scan to chart posture movement.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ControlStatusCompact({ summary }: { summary: CurrentSummary }) {
  const total = summary.controls_passed + summary.controls_failed + summary.controls_no_data;
  if (total === 0) return null;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Control status</p>
      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-zinc-100">
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

function NeedsAttentionCompact({ gaps }: { gaps: PersistentGap[] }) {
  if (gaps.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Needs attention</p>
        <p className="mt-1 text-xs text-zinc-500">No failing controls with open findings.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Needs attention</p>
      <p className="mt-0.5 text-[11px] text-zinc-500">Controls with the most open findings.</p>
      <ul className="mt-2 space-y-1">
        {gaps.slice(0, 4).map((g) => (
          <li key={g.control_id} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="min-w-0 truncate text-zinc-800">{g.title}</span>
            <span className="shrink-0 tabular-nums font-semibold text-zinc-900">{g.open_finding_count}</span>
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
  const visible = cadence.slice(-10);
  const maxScans = Math.max(1, ...visible.map((d) => d.scan_count));

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Evidence cadence</p>
        <p className="text-[10px] text-zinc-400">{scanCount} scan{scanCount === 1 ? "" : "s"}</p>
      </div>
      {visible.length < 2 ? (
        <p className="mt-1.5 text-xs text-zinc-500">Markers appear after two scan days.</p>
      ) : (
        <>
          <div className="mt-2 flex gap-0.5">
            {visible.map((d) => {
              const intensity = d.scan_count / maxScans;
              const cls =
                d.posture_change_count > 0
                  ? "bg-indigo-400"
                  : intensity > 0.66
                    ? "bg-emerald-500"
                    : intensity > 0.33
                      ? "bg-emerald-300"
                      : "bg-zinc-200";
              return (
                <div
                  key={d.date}
                  className={`h-3 flex-1 rounded-sm ${cls}`}
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
  resolvedInPeriod,
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
  const resolved = resolvedInPeriod ?? 0;
  const scans = scanCount ?? 0;

  return (
    <div className="space-y-4">
      <WindowSummaryCard
        resolved={resolved}
        days={days}
        improved={improved}
        regressed={regressed}
        currentScore={currentScore}
        scanCount={scans}
        events={events}
      />

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Recent movement</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">Grouped by day.</p>
            <div className="mt-2.5">{timeline}</div>
          </div>
        </div>

        <div className="space-y-3 lg:col-span-5">
          <NeedsAttentionCompact gaps={persistentGaps} />
          {currentSummary && <ControlStatusCompact summary={currentSummary} />}
          <EvidenceCadenceCompact cadence={scanCadence} days={days} scanCount={scans} />
        </div>
      </div>
    </div>
  );
}
