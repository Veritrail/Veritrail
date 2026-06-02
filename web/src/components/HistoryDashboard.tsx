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
  const metrics = [
    { label: "Posture", value: `${currentScore ?? "—"}%`, detail: "Current score", tone: "text-zinc-950" },
    { label: "Resolved", value: resolved, detail: `${improved} improved · ${regressed} regressed`, tone: "text-emerald-600" },
    { label: "Open findings", value: open || "—", detail: "Active now", tone: "text-rose-600" },
    { label: "Scans", value: scans, detail: "In this window", tone: "text-zinc-950" },
  ];

  return (
    <div className="grid overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_18px_55px_-35px_rgba(15,23,42,0.35)] sm:grid-cols-4">
      {metrics.map((metric, index) => (
        <div
          key={metric.label}
          className={`relative min-h-24 px-6 py-5 ${index < metrics.length - 1 ? "border-b border-zinc-100 sm:border-b-0 sm:border-r" : ""}`}
        >
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zinc-200 to-transparent" />
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">{metric.label}</p>
          <p className={`mt-2 text-3xl font-semibold tracking-tight tabular-nums ${metric.tone}`}>{metric.value}</p>
          <p className="mt-1 text-xs text-zinc-500">{metric.detail}</p>
        </div>
      ))}
    </div>
  );
}

function ControlStatusCompact({ summary }: { summary: CurrentSummary }) {
  const total = summary.controls_passed + summary.controls_failed + summary.controls_no_data;
  if (total === 0) return null;

  return (
    <div className="rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-[0_16px_45px_-34px_rgba(15,23,42,0.35)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Control status</p>
          <p className="mt-1 text-xs text-zinc-500">Pass/fail state for mapped controls.</p>
        </div>
        <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-rose-700">
          {summary.controls_failed} failing
        </span>
      </div>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-zinc-100 ring-1 ring-zinc-200/70">
        {summary.controls_passed > 0 && <div className="bg-emerald-500" style={{ width: `${(summary.controls_passed / total) * 100}%` }} />}
        {summary.controls_failed > 0 && <div className="bg-rose-500" style={{ width: `${(summary.controls_failed / total) * 100}%` }} />}
        {summary.controls_no_data > 0 && <div className="bg-zinc-300" style={{ width: `${(summary.controls_no_data / total) * 100}%` }} />}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
        <span><span className="font-semibold tabular-nums text-emerald-700">{summary.controls_passed}</span> passing</span>
        <span><span className="font-semibold tabular-nums text-rose-700">{summary.controls_failed}</span> failing</span>
        {summary.controls_no_data > 0 && <span><span className="font-semibold tabular-nums text-zinc-500">{summary.controls_no_data}</span> no data</span>}
      </div>
    </div>
  );
}

function NeedsAttentionCompact({ gaps }: { gaps: PersistentGap[] }) {
  return (
    <div className="rounded-3xl border border-rose-100 bg-gradient-to-br from-white via-white to-rose-50/70 p-5 shadow-[0_16px_45px_-34px_rgba(244,63,94,0.45)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-rose-400">Still open</p>
          <h3 className="mt-1 text-base font-semibold text-zinc-950">Largest unresolved controls</h3>
        </div>
        {gaps.length > 0 && <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-rose-700 ring-1 ring-rose-100">Top {Math.min(gaps.length, 4)}</span>}
      </div>
      {gaps.length === 0 ? (
        <p className="mt-5 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">No failing controls with open findings.</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {gaps.slice(0, 4).map((g, index) => (
            <li key={g.control_id} className="flex items-center gap-3 rounded-2xl bg-white/85 px-3 py-3 ring-1 ring-zinc-200/70">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-xs font-bold tabular-nums text-rose-600">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zinc-900">{g.title}</p>
                <p className="mt-0.5 text-[11px] text-zinc-500">{g.control_id}</p>
              </div>
              <span className="shrink-0 text-lg font-bold tabular-nums text-rose-600">{g.open_finding_count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProgressHero({
  resolved,
  improved,
  regressed,
  currentScore,
}: {
  resolved: number;
  improved: number;
  regressed: number;
  currentScore: number | null | undefined;
}) {
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-zinc-200/80 bg-zinc-950 px-7 py-6 text-white shadow-[0_24px_90px_-50px_rgba(15,23,42,0.75)]">
      <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />
      <div className="absolute right-20 top-6 h-32 w-32 rounded-full bg-indigo-400/20 blur-3xl" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-300/90">Window summary</p>
          <h2 className="mt-2 text-4xl font-semibold tracking-tight">{resolved} findings verified</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-300">
            Remediation movement in this audit window. The feed below shows what changed, not raw infrastructure noise.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-200 ring-1 ring-emerald-300/20">{improved} controls improved</span>
            <span className="rounded-full bg-rose-400/15 px-3 py-1 text-xs font-semibold text-rose-200 ring-1 ring-rose-300/20">{regressed} regressed</span>
          </div>
        </div>
        <div className="rounded-3xl bg-white/10 px-6 py-4 text-right ring-1 ring-white/15 backdrop-blur">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300">Current posture</p>
          <p className="mt-1 text-5xl font-semibold tabular-nums tracking-tight">{currentScore ?? "—"}%</p>
        </div>
      </div>
    </section>
  );
}

export function HistoryDashboard({
  currentScore,
  currentSummary,
  periodSummary,
  scanCount,
  scanCadence,
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
  scanCadence?: unknown;
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
  void scanCadence;

  return (
    <div className="space-y-5">
      <ProgressHero resolved={resolved} improved={improved} regressed={regressed} currentScore={currentScore} />
      <MetricStrip open={open} resolved={resolved} scans={scans} currentScore={currentScore} improved={improved} regressed={regressed} />

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_25rem] 2xl:items-start">
        <section className="relative overflow-hidden rounded-[1.75rem] border border-zinc-200/80 bg-white p-5 shadow-[0_20px_70px_-45px_rgba(15,23,42,0.45)]">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-indigo-500 to-rose-400" />
          <div className="flex items-start justify-between gap-3 border-b border-zinc-100 pb-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Activity timeline</p>
              <h3 className="mt-1 text-lg font-semibold tracking-tight text-zinc-950">What changed</h3>
              <p className="mt-1 text-xs text-zinc-500">Scans, remediations, and control movement.</p>
            </div>
            {resolved > 0 && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">{resolved} verified</span>}
          </div>
          <div className="mt-4">{timeline}</div>
        </section>

        <aside className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-1">
          <NeedsAttentionCompact gaps={persistentGaps} />
          {currentSummary && <ControlStatusCompact summary={currentSummary} />}
        </aside>
      </div>
    </div>
  );
}
