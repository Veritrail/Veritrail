import type { ReactNode } from "react";
import type {
  CurrentSummary,
  HistoryEvent,
  PeriodSummary,
  PersistentGap,
} from "../lib/complianceHistory";

function MetricStrip({
  open,
  resolved,
  scans,
  currentScore,
  improved,
  regressed,
}: {
  open: number;
  resolved: number;
  scans: number;
  currentScore: number | null | undefined;
  improved: number;
  regressed: number;
}) {
  return (
    <div className="grid overflow-hidden rounded-2xl border border-zinc-200 bg-white sm:grid-cols-4">
      <div className="border-b border-zinc-100 px-4 py-3 sm:border-b-0 sm:border-r">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Posture</p>
        <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-950">{currentScore ?? "—"}%</p>
      </div>
      <div className="border-b border-zinc-100 px-4 py-3 sm:border-b-0 sm:border-r">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Resolved</p>
        <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-600">{resolved}</p>
        <p className="mt-0.5 text-[11px] text-zinc-500">{improved} controls improved · {regressed} regressed</p>
      </div>
      <div className="border-b border-zinc-100 px-4 py-3 sm:border-b-0 sm:border-r">
        <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Open findings</p>
        <p className="mt-1 text-xl font-semibold tabular-nums text-rose-600">{open || "—"}</p>
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
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">Needs attention</p>
      <p className="mt-1 text-xs text-zinc-500">Controls with the most open findings.</p>
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

export function HistoryDashboard({
  currentScore,
  currentSummary,
  periodSummary,
  scanCount,
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
      <MetricStrip open={open} resolved={resolved} scans={scans} currentScore={currentScore} improved={improved} regressed={regressed} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">Timeline</p>
              <p className="mt-1 text-xs text-zinc-500">Scans, remediations, and control movement.</p>
            </div>
            {resolved > 0 && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">{resolved} verified</span>}
          </div>
          <div className="mt-4">{timeline}</div>
        </section>

        <aside className="space-y-4">
          <NeedsAttentionCompact gaps={persistentGaps} />
          {currentSummary && <ControlStatusCompact summary={currentSummary} />}
        </aside>
      </div>
    </div>
  );
}
