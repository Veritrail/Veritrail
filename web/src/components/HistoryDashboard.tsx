import type { ReactNode } from "react";
import type {
  CurrentSummary,
  HistoryEvent,
  PeriodSummary,
  PersistentGap,
} from "../lib/complianceHistory";
import { PostureTrend } from "./PostureTrend";

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
        <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-rose-700 ring-1 ring-rose-100">
          {summary.controls_failed} failing
        </span>
      </div>
      <div className="mt-auto pt-5">
        <div className="flex h-2 overflow-hidden rounded-full bg-zinc-100 ring-1 ring-zinc-200/70">
          {summary.controls_passed > 0 && <div className="bg-emerald-400" style={{ width: `${(summary.controls_passed / total) * 100}%` }} />}
          {summary.controls_failed > 0 && <div className="bg-rose-500" style={{ width: `${(summary.controls_failed / total) * 100}%` }} />}
          {summary.controls_no_data > 0 && <div className="bg-zinc-300" style={{ width: `${(summary.controls_no_data / total) * 100}%` }} />}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
          <span><span className="font-semibold tabular-nums text-emerald-700">{summary.controls_passed}</span> passing</span>
          <span><span className="font-semibold tabular-nums text-rose-700">{summary.controls_failed}</span> failing</span>
          {summary.controls_no_data > 0 && <span><span className="font-semibold tabular-nums text-zinc-500">{summary.controls_no_data}</span> no data</span>}
        </div>
      </div>
    </div>
  );
}

function NeedsAttentionCompact({
  gaps,
  activeControl,
  onSelect,
}: {
  gaps: PersistentGap[];
  activeControl: string | null;
  onSelect: (controlId: string | null) => void;
}) {
  const max = Math.max(1, ...gaps.map((g) => g.open_finding_count));

  return (
    <div className="flex h-full flex-col rounded-3xl border border-rose-100/80 bg-white p-5 shadow-sm shadow-rose-950/[0.03]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-rose-400">Still open</p>
          <h3 className="mt-1 text-base font-semibold text-zinc-950">Controls with the most findings</h3>
          <p className="mt-0.5 text-[11px] text-zinc-400">Click a control to filter the timeline.</p>
        </div>
        {gaps.length > 0 && <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-bold text-rose-700 ring-1 ring-rose-100">Top {Math.min(gaps.length, 4)}</span>}
      </div>
      {gaps.length === 0 ? (
        <p className="mt-5 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-emerald-100">No failing controls with open findings.</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {gaps.slice(0, 4).map((g, index) => {
            const active = activeControl === g.control_id;
            return (
              <li key={g.control_id}>
                <button
                  type="button"
                  onClick={() => onSelect(active ? null : g.control_id)}
                  aria-pressed={active}
                  className={`w-full rounded-2xl px-3 py-3 text-left ring-1 transition ${
                    active ? "bg-rose-100/70 ring-rose-300" : "bg-rose-50/35 ring-rose-100/80 hover:bg-rose-50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-white text-xs font-bold tabular-nums text-rose-600 ring-1 ring-rose-100">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-zinc-900">{g.title}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">{g.control_id}</p>
                    </div>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-rose-600">{g.open_finding_count}</span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white ring-1 ring-rose-100/70">
                    <div className="h-full rounded-full bg-rose-400" style={{ width: `${Math.max(8, (g.open_finding_count / max) * 100)}%` }} />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
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
  persistentGaps = [],
  openFindingsCount,
  resolvedInPeriod,
  activeControl = null,
  onSelectControl = () => {},
  scanCadence,
  onSelectSnapshot,
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
  activeControl?: string | null;
  onSelectControl?: (controlId: string | null) => void;
  scanCadence?: unknown;
  onSelectSnapshot?: (scanRunId: string) => void;
  timeline?: ReactNode;
}) {
  void scanCadence;
  void onSelectSnapshot;
  const improved = periodSummary?.controls_improved ?? 0;
  const regressed = periodSummary?.controls_regressed ?? 0;
  const resolved = resolvedInPeriod ?? 0;
  const scans = scanCount ?? 0;
  const open = openFindingsCount ?? currentSummary?.open_findings_count ?? 0;

  return (
    <div className="space-y-5">
      <PostureTrend
        events={events}
        currentScore={currentScore}
        days={days}
        verified={resolved}
        improved={improved}
        regressed={regressed}
        open={open}
        scans={scans}
      />

      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_25rem]">
        <section className="relative overflow-hidden rounded-[1.75rem] border border-zinc-200/80 bg-white p-5 shadow-sm shadow-zinc-950/[0.02]">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-indigo-500 to-rose-400" />
          <div className="flex items-start justify-between gap-3 border-b border-zinc-100 pb-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Activity timeline</p>
              <h3 className="mt-1 text-lg font-semibold tracking-tight text-zinc-950">What changed</h3>
              <p className="mt-1 text-xs text-zinc-500">Each change with its resource, mapped control, and posture movement.</p>
            </div>
            {resolved > 0 && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">{resolved} verified</span>}
          </div>

          {activeControl && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-xs ring-1 ring-indigo-100">
              <span className="font-semibold text-indigo-700">Filtered to {activeControl}</span>
              <button type="button" onClick={() => onSelectControl(null)} className="ml-auto font-semibold text-indigo-600 hover:text-indigo-800">
                Clear
              </button>
            </div>
          )}

          <div className="mt-4">{timeline}</div>
        </section>

        <aside className="grid items-stretch gap-5 lg:grid-cols-2 2xl:sticky 2xl:top-5 2xl:grid-cols-1">
          <NeedsAttentionCompact gaps={persistentGaps} activeControl={activeControl} onSelect={onSelectControl} />
          {currentSummary && <ControlStatusCompact summary={currentSummary} />}
        </aside>
      </div>
    </div>
  );
}
