import type {
  CurrentSummary,
  HistoryEvent,
  PeriodSummary,
  PersistentGap,
  ScanCadenceDay,
} from "../lib/complianceHistory";
import { scanShortDate } from "../lib/complianceHistory";
import { causeSentence, eventTypeLabel } from "../lib/historyPresentation";
import { ComplianceTrendChart } from "./ComplianceTrendChart";

function DashboardMetric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: "neutral" | "good" | "bad" | "indigo";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-rose-700"
        : tone === "indigo"
          ? "text-indigo-700"
          : "text-zinc-950";
  const ringClass =
    tone === "good"
      ? "ring-emerald-100"
      : tone === "bad"
        ? "ring-rose-100"
        : tone === "indigo"
          ? "ring-indigo-100"
          : "ring-zinc-100";
  return (
    <div className={`min-w-0 rounded-xl border border-zinc-200 bg-white px-3.5 py-3 shadow-sm shadow-zinc-950/[0.02] ring-1 ${ringClass}`}>
      <p className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">{label}</p>
      <p className={`mt-1.5 text-xl font-bold tabular-nums tracking-tight ${toneClass}`}>{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-zinc-500">{detail}</p>
    </div>
  );
}

function ControlStatusRow({ summary }: { summary: CurrentSummary }) {
  const total = summary.controls_passed + summary.controls_failed + summary.controls_no_data;
  if (total === 0) return null;
  const pct = (n: number) => `${((n / total) * 100).toFixed(0)}%`;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm shadow-zinc-950/[0.02]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">Current control status</p>
          <p className="mt-0.5 text-xs text-zinc-500">Pass/fail state for mapped controls now.</p>
        </div>
        <span className="rounded-full bg-zinc-50 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 ring-1 ring-zinc-200">
          {total} controls
        </span>
      </div>
      <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 ring-1 ring-zinc-200/60">
        {summary.controls_passed > 0 && <div className="bg-emerald-500 transition-all" style={{ width: `${(summary.controls_passed / total) * 100}%` }} title={`Passing: ${summary.controls_passed}`} />}
        {summary.controls_failed > 0 && <div className="bg-rose-500 transition-all" style={{ width: `${(summary.controls_failed / total) * 100}%` }} title={`Failing: ${summary.controls_failed}`} />}
        {summary.controls_no_data > 0 && <div className="bg-zinc-300 transition-all" style={{ width: `${(summary.controls_no_data / total) * 100}%` }} title={`No data: ${summary.controls_no_data}`} />}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span><span className="font-semibold tabular-nums text-emerald-700">{summary.controls_passed}</span><span className="text-zinc-500"> passing ({pct(summary.controls_passed)})</span></span>
        <span><span className="font-semibold tabular-nums text-rose-700">{summary.controls_failed}</span><span className="text-zinc-500"> failing ({pct(summary.controls_failed)})</span></span>
        {summary.controls_no_data > 0 && <span><span className="font-semibold tabular-nums text-zinc-500">{summary.controls_no_data}</span><span className="text-zinc-400"> no data ({pct(summary.controls_no_data)})</span></span>}
      </div>
    </div>
  );
}

function TopPersistentGaps({ gaps }: { gaps: PersistentGap[] }) {
  if (gaps.length === 0) return null;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm shadow-zinc-950/[0.02]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">Persistent gaps</p>
          <p className="mt-0.5 text-xs text-zinc-500">Controls with the most open findings right now.</p>
        </div>
        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-rose-100">
          Needs attention
        </span>
      </div>
      <ul className="mt-3 space-y-1.5">
        {gaps.slice(0, 4).map((g) => (
          <li key={g.control_id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-zinc-100 bg-zinc-50/70 px-3 py-2">
            <div className="min-w-0">
              <span className="line-clamp-1 text-sm font-medium text-zinc-900">{g.title}</span>
              <span className="font-mono text-[10px] text-zinc-500">{g.control_id}</span>
            </div>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-rose-700">{g.open_finding_count} open</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScanCadence({ cadence, days, scanCount }: { cadence: ScanCadenceDay[]; days: number; scanCount: number }) {
  if (scanCount < 2) return null;
  const visible = cadence.slice(-18);
  if (visible.length < 2) return null;
  const maxScans = Math.max(1, ...visible.map((d) => d.scan_count));

  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm shadow-zinc-950/[0.02]">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">Evidence cadence</p>
        <p className="text-[10px] text-zinc-400">Last {Math.min(days, visible.length)} scan days</p>
      </div>
      <div className="mt-3 grid grid-cols-[repeat(18,minmax(0,1fr))] gap-1">
        {visible.map((d) => {
          const intensity = d.scan_count / maxScans;
          const cls = d.posture_change_count > 0 ? "bg-indigo-600" : intensity > 0.66 ? "bg-emerald-600" : intensity > 0.33 ? "bg-emerald-400" : "bg-emerald-200";
          return <div key={d.date} className={`h-6 rounded-md ${cls}`} title={`${d.date}: ${d.scan_count} scan${d.scan_count === 1 ? "" : "s"}${d.posture_change_count > 0 ? `, ${d.posture_change_count} posture change${d.posture_change_count === 1 ? "" : "s"}` : ""}`} />;
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-zinc-500">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-400" />Scanned</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-indigo-600" />Posture changed</span>
      </div>
    </div>
  );
}

function LatestChangeCard({ events }: { events: HistoryEvent[] }) {
  const meaningful = events.find((e) => e.type !== "baseline_established") ?? events[0];
  if (!meaningful) return null;
  const cause = causeSentence(meaningful);
  const isRemediation = meaningful.type === "finding_resolved" || meaningful.type === "finding_excepted" || meaningful.type === "finding_reopened";
  const title = isRemediation ? eventTypeLabel(meaningful.type) : "Latest posture change";

  return (
    <div className="rounded-xl border border-zinc-200 bg-gradient-to-br from-white via-white to-indigo-50/40 px-4 py-3 shadow-sm shadow-zinc-950/[0.02]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">What changed</p>
          <h3 className="mt-1 text-sm font-bold tracking-tight text-zinc-950">{title}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
            {cause ? <><span className="font-semibold text-zinc-800">{cause.control}</span> {cause.text}.</> : meaningful.top_change?.title || "A new evidence snapshot was recorded."}
          </p>
        </div>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200">
          {scanShortDate(meaningful.timestamp)}
        </span>
      </div>
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
  onSelectSnapshot,
}: {
  events: HistoryEvent[];
  days: number;
  currentScore: number | null | undefined;
  currentSummary?: CurrentSummary | null;
  periodSummary?: PeriodSummary;
  scanCount?: number;
  scanCadence?: ScanCadenceDay[];
  persistentGaps?: PersistentGap[];
  onSelectSnapshot?: (scanRunId: string) => void;
}) {
  const failing = currentSummary?.controls_failed ?? 0;
  const passed = currentSummary?.controls_passed ?? 0;
  const noData = currentSummary?.controls_no_data ?? 0;
  const improved = periodSummary?.controls_improved ?? 0;
  const regressed = periodSummary?.controls_regressed ?? 0;
  const changed = improved + regressed;
  const remediationEvents = periodSummary?.remediation_events ?? events.filter((e) => e.type === "finding_resolved" || e.type === "finding_excepted" || e.type === "finding_reopened").length;

  return (
    <div className="space-y-4">
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardMetric label="Current posture" value={currentScore != null ? `${currentScore}%` : "No data"} detail={`${passed} passing, ${failing} failing`} tone={failing > 0 ? "bad" : currentScore != null ? "good" : "neutral"} />
        <DashboardMetric label="Failing controls" value={failing} detail={noData > 0 ? `${noData} controls without data` : "All mapped controls have data"} tone={failing > 0 ? "bad" : "good"} />
        <DashboardMetric label="Changes" value={changed} detail={`${improved} improved, ${regressed} regressed`} tone={regressed > 0 ? "bad" : changed > 0 ? "good" : "neutral"} />
        <DashboardMetric label="Remediations" value={remediationEvents} detail={`In the last ${days} days`} tone={remediationEvents > 0 ? "indigo" : "neutral"} />
      </div>

      <LatestChangeCard events={events} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)]">
        <div className="space-y-4">
          {currentSummary && <ControlStatusRow summary={currentSummary} />}
          {events.length >= 2 ? (
            <ComplianceTrendChart events={events} currentScore={currentScore} days={days} periodSummary={periodSummary} onSelectSnapshot={onSelectSnapshot} />
          ) : events.length === 1 ? (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/50 px-5 py-5 text-sm text-zinc-600">
              <p className="font-semibold text-zinc-800">Trend needs another scan</p>
              <p className="mt-1 leading-relaxed">History already has one evidence snapshot. The chart becomes useful after the next scan or verified remediation event.</p>
            </div>
          ) : null}
        </div>
        <div className="space-y-4">
          <TopPersistentGaps gaps={persistentGaps} />
          <ScanCadence cadence={scanCadence} days={days} scanCount={scanCount ?? 0} />
        </div>
      </div>

      {events.length === 0 && currentScore != null && (
        <div className="rounded-2xl border border-zinc-200/90 bg-white px-5 py-5 shadow-sm shadow-zinc-950/[0.04]">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Compliance posture</p>
          <p className="mt-3 text-4xl font-bold tabular-nums tracking-tight text-zinc-950">{currentScore}%</p>
          <p className="mt-2 text-sm text-zinc-500">Posture held steady — {scanCount ?? 0} scan{(scanCount ?? 0) === 1 ? "" : "s"} in the last {days} days with no control pass/fail changes.</p>
        </div>
      )}
    </div>
  );
}
