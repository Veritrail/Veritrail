import type { ReactNode } from "react";
import type {
  CurrentSummary,
  HistoryEvent,
  PeriodSummary,
  PersistentGap,
} from "../lib/complianceHistory";

function ControlStatusCompact({ summary }: { summary: CurrentSummary }) {
  const total = summary.controls_passed + summary.controls_failed + summary.controls_no_data;
  if (total === 0) return null;

  return (
    <div className="flex h-full flex-col rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-sm shadow-zinc-950/[0.02]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Control status</p>
          <p className="mt-1 text-xs text-zinc-500">Pass/fail state for mapped controls.</p>
        </div>
        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-bold text-zinc-600">
          {summary.controls_failed} failing
        </span>
      </div>
      <div className="mt-auto pt-5">
        <div className="flex h-2 overflow-hidden rounded-full bg-zinc-100 ring-1 ring-zinc-200/70">
          {summary.controls_passed > 0 && <div className="bg-zinc-400" style={{ width: `${(summary.controls_passed / total) * 100}%` }} />}
          {summary.controls_failed > 0 && <div className="bg-zinc-800" style={{ width: `${(summary.controls_failed / total) * 100}%` }} />}
          {summary.controls_no_data > 0 && <div className="bg-zinc-300" style={{ width: `${(summary.controls_no_data / total) * 100}%` }} />}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
          <span><span className="font-semibold tabular-nums text-zinc-800">{summary.controls_passed}</span> passing</span>
          <span><span className="font-semibold tabular-nums text-zinc-800">{summary.controls_failed}</span> failing</span>
          {summary.controls_no_data > 0 && <span><span className="font-semibold tabular-nums text-zinc-500">{summary.controls_no_data}</span> no data</span>}
        </div>
      </div>
    </div>
  );
}

function NeedsAttentionCompact({ gaps }: { gaps: PersistentGap[] }) {
  const max = Math.max(1, ...gaps.map((g) => g.open_finding_count));

  return (
    <div className="flex h-full flex-col rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-sm shadow-zinc-950/[0.02]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Still open</p>
          <h3 className="mt-1 text-base font-semibold text-zinc-950">Controls with the most findings</h3>
        </div>
        {gaps.length > 0 && <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-bold text-zinc-600 ring-1 ring-zinc-200">Top {Math.min(gaps.length, 4)}</span>}
      </div>
      {gaps.length === 0 ? (
        <p className="mt-5 rounded-2xl bg-zinc-50 px-4 py-3 text-sm text-zinc-600 ring-1 ring-zinc-200/70">No failing controls with open findings.</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {gaps.slice(0, 4).map((g, index) => (
            <li key={g.control_id} className="rounded-2xl bg-zinc-50/70 px-3 py-3 ring-1 ring-zinc-200/70">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-white text-xs font-bold tabular-nums text-zinc-500 ring-1 ring-zinc-200">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-zinc-900">{g.title}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">{g.control_id}</p>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums text-zinc-800">{g.open_finding_count}</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white ring-1 ring-zinc-200/60">
                <div className="h-full rounded-full bg-zinc-700" style={{ width: `${Math.max(8, (g.open_finding_count / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProgressSummary({
  resolved,
  improved,
  regressed,
  currentScore,
  open,
  scans,
}: {
  resolved: number;
  improved: number;
  regressed: number;
  currentScore: number | null | undefined;
  open: number;
  scans: number;
}) {
  return (
    <section className="rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-sm shadow-zinc-950/[0.02]">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Window summary</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">{resolved} findings verified</h2>
          <p className="mt-1 text-sm text-zinc-500">Remediation movement in this audit window.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:min-w-[38rem]">
          <div className="rounded-2xl bg-zinc-50 px-4 py-3 ring-1 ring-zinc-200/80">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Improved</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-950">{improved}</p>
          </div>
          <div className="rounded-2xl bg-zinc-50 px-4 py-3 ring-1 ring-zinc-200/80">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Regressed</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-950">{regressed}</p>
          </div>
          <div className="rounded-2xl bg-zinc-50 px-4 py-3 ring-1 ring-zinc-200/80">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Open</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-950">{open || "—"}</p>
          </div>
          <div className="rounded-2xl bg-zinc-50 px-4 py-3 ring-1 ring-zinc-200/80">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Scans</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-950">{scans}</p>
          </div>
          <div className="rounded-2xl bg-zinc-50 px-4 py-3 ring-1 ring-zinc-200/80">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Posture</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-950">{currentScore ?? "—"}%</p>
          </div>
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
      <ProgressSummary resolved={resolved} improved={improved} regressed={regressed} currentScore={currentScore} open={open} scans={scans} />

      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_25rem]">
        <section className="relative overflow-hidden rounded-[1.75rem] border border-zinc-200/80 bg-white p-5 shadow-sm shadow-zinc-950/[0.02]">
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

        <aside className="grid items-stretch gap-5 lg:grid-cols-2 2xl:sticky 2xl:top-5 2xl:grid-cols-1">
          <NeedsAttentionCompact gaps={persistentGaps} />
          {currentSummary && <ControlStatusCompact summary={currentSummary} />}
        </aside>
      </div>
    </div>
  );
}
