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
      ? `${resolved} findings verified`
      : improved > 0
        ? `${improved} controls improved`
        : events.length === 1 && events[0]?.type === "baseline_established"
          ? "Baseline recorded"
          : "No movement yet";

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm shadow-zinc-950/[0.02]">
      <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-start">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Window summary</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">{primary}</p>
          <p className="mt-1 text-sm text-zinc-500">
            {resolved > 0
              ? `Resolved in the last ${days} days.`
              : hasTrend
                ? `Movement in the last ${days} days.`
                : "Run another scan after remediation to chart posture movement."}
          </p>
          <p className="mt-3 text-xs text-zinc-500">
            <span className="font-semibold text-emerald-700">{improved}</span> controls improved
            <span className="px-2 text-zinc-300">·</span>
            <span className="font-semibold text-rose-700">{regressed}</span> regressed
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-right">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Current posture</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-zinc-950">{currentScore ?? "—"}%</p>
        </div>
      </div>
    </div>
  );
}

function MetricStrip({
  open,
  resolved,
  scans,
}: {
  open: number;
  resolved: number;
  scans: number;
}) {
  return (
    <div className="grid overflow-hidden rounded-2xl border border-zinc-200 bg-white sm:grid-cols-3">
      <div className="border-b border-zinc-100 px-4 py-3 sm:border-b-0 sm:border-r">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Open findings</p>
        <p className="mt-1 text-xl font-semibold tabular-nums text-rose-600">{open || "—"}</p>
      </div>
      <div className="border-b border-zinc-100 px-4 py-3 sm:border-b-0 sm:border-r">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Resolved</p>
        <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-600">{resolved}</p>
      </div>
      <div className="px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Scans</p>
        <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-950">{scans}</p>
      </div>
    </div>
  );
}

function ControlStatusCompact({ summary }: { summary: CurrentSummary }) {
  const total = summary.controls_passed + summary.controls_failed + summary.controls_no_data;
  if (total === 0) return null;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">Control status</p>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-zinc-100">
        {summary.controls_passed > 0 && <div className="bg-emerald-500" style={{ width: `${(summary.controls_passed / total) * 100}%` }} />}
        {summary.controls_failed > 0 && <div className="bg-rose-500" style={{ width: `${(summary.controls_failed / total) * 100}%` }} />}
        {summary.controls_no_data > 0 && <div className="bg-zinc-300" style={{ width: `${(summary.controls_no_data / total) * 100}%` }} />}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-zinc-600">
        <span><span className="font-semibold tabular-nums text-emerald-700">{summary.controls_passed}</span> passing</span>
        <span><span className="font-semibold tabular-nums text-rose-700">{summary.controls_failed}</span> failing</span>
        {summary.controls_no_data > 0 && <span><span className="font-semibold tabular-nums text-zinc-500">{summary.controls_no_data}</span> no data</span>}
      </div>
    </div>
  );
}

function NeedsAttentionCompact({ gaps }: { gaps: PersistentGap[] }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">Needs attention</p>
          <p className="mt-1 text-xs text-zinc-500">Controls with the most open findings.</p>
        </div>
      </div>
      {gaps.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No failing controls with open findings.</p>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-100">
          {gaps.slice(0, 4).map((g) => (
            <li key={g.control_id} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <span className="min-w-0 truncate text-sm font-medium text-zinc-800">{g.title}</span>
              <span className="shrink-0 tabular-nums text-sm font-semibold text-rose-600">{g.open_finding_count} open</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EvidenceCadenceCompact({ cadence, days, scanCount }: { cadence: ScanCadenceDay[]; days: number; scanCount: number }) {
  const visible = cadence.slice(-10);
  const maxScans = Math.max(1, ...visible.map((d) => d.scan_count));
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">Evidence cadence</p>
        <p className="text-[11px] text-zinc-400">{scanCount} scan{scanCount === 1 ? "" : "s"}</p>
      </div>
      {visible.length < 2 ? (
        <p className="mt-2 text-sm text-zinc-500">Markers appear after two scan days.</p>
      ) : (
        <>
          <div className="mt-3 flex gap-1">
            {visible.map((d) => {
              const intensity = d.scan_count / maxScans;
              const cls = d.posture_change_count > 0 ? "bg-indigo-500" : intensity > 0.66 ? "bg-emerald-500" : intensity > 0.33 ? "bg-emerald-300" : "bg-zinc-200";
              return <div key={d.date} className={`h-5 flex-1 rounded-md ${cls}`} title={`${d.date}: ${d.scan_count} scan${d.scan_count === 1 ? "" : "s"}`} />;
            })}
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">Last {Math.min(days, visible.length)} scan days</p>
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
  const open = openFindingsCount ?? 0;

  return (
    <div className="space-y-4">
      <WindowSummaryCard resolved={resolved} days={days} improved={improved} regressed={regressed} currentScore={currentScore} scanCount={scans} events={events} />

      <MetricStrip open={open} resolved={resolved} scans={scans} />

      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 lg:col-span-7">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">Recent movement</p>
          <p className="mt-1 text-xs text-zinc-500">Latest movement, grouped by day.</p>
          <div className="mt-4">{timeline}</div>
        </div>
        <div className="space-y-4 lg:col-span-5">
          <NeedsAttentionCompact gaps={persistentGaps} />
          {currentSummary && <ControlStatusCompact summary={currentSummary} />}
          <EvidenceCadenceCompact cadence={scanCadence} days={days} scanCount={scans} />
        </div>
      </div>
    </div>
  );
}
