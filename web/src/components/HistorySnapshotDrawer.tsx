import { useState } from "react";
import { Link } from "react-router-dom";
import { frameworkLabel } from "../data/frameworks";
import { InfrastructureEventsList } from "./InfrastructureEventsList";
import { ImpactList } from "./ImpactList";
import { causeSentence, impactItems } from "../lib/historyPresentation";
import {
  type HistoryEvent,
  scanAsOfDate,
  scanDateLabel,
  downloadEvidenceForScan,
} from "../lib/complianceHistory";

function PostureShift({ before, after }: { before: number | null; after: number | null }) {
  if (after == null) return <span className="text-zinc-500">—</span>;
  if (before == null || before === after) {
    return <span className="text-4xl font-semibold tabular-nums tracking-tight text-zinc-950">{after}%</span>;
  }

  const down = after < before;
  const pts = after - before;
  return (
    <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <span className="flex items-baseline gap-2 text-4xl font-semibold tabular-nums tracking-tight">
        <span className="text-zinc-300">{before}%</span>
        <span className="text-xl font-normal text-zinc-300">→</span>
        <span className={down ? "text-rose-700" : "text-emerald-700"}>{after}%</span>
      </span>
      <span className={`rounded-full px-2 py-1 text-xs font-bold tabular-nums ${down ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
        {pts > 0 ? "+" : "−"}{Math.abs(pts)} pts
      </span>
    </span>
  );
}

function ControlChangeList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "fail" | "pass";
  items: { control_id: string; title: string; open_finding_count?: number }[];
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-[13px] font-semibold text-zinc-900">{title}</h4>
      <ul className="mt-2 space-y-2">
        {items.map((c) => (
          <li key={c.control_id} className="rounded-xl border border-zinc-200/80 bg-white px-3 py-3 text-sm shadow-sm shadow-zinc-950/[0.02]">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-mono text-[11px] font-semibold text-zinc-500">{c.control_id}</span>
              <span className={`text-[10px] font-bold uppercase tracking-wide ${tone === "fail" ? "text-rose-700" : "text-emerald-700"}`}>
                {tone === "fail" ? "PASS → FAIL" : "FAIL → PASS"}
              </span>
            </div>
            <p className="mt-1 font-medium text-zinc-900">{c.title}</p>
            {(c.open_finding_count ?? 0) > 0 && (
              <p className="mt-0.5 text-xs text-zinc-500">{c.open_finding_count} open finding{c.open_finding_count === 1 ? "" : "s"}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CompareRow({
  label,
  before,
  after,
  betterWhen,
}: {
  label: string;
  before: number | null | undefined;
  after: number | null | undefined;
  betterWhen: "lower" | "higher";
}) {
  const b = before ?? null;
  const a = after ?? null;
  const delta = b != null && a != null ? a - b : null;
  const improved = delta == null || delta === 0 ? null : betterWhen === "lower" ? delta < 0 : delta > 0;
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <span className="text-xs text-zinc-600">{label}</span>
      <span className="flex items-center gap-1.5 text-xs tabular-nums">
        <span className="text-zinc-400">{b ?? "—"}</span>
        <span className="text-zinc-300">→</span>
        <span className="font-semibold text-zinc-900">{a ?? "—"}</span>
        {delta != null && delta !== 0 && (
          <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${improved ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
            {delta > 0 ? `+${delta}` : delta}
          </span>
        )}
      </span>
    </div>
  );
}

function SummaryTile({ label, value, detail, tone = "zinc" }: { label: string; value: string | number; detail?: string; tone?: "zinc" | "emerald" | "rose" }) {
  const toneClass = tone === "emerald" ? "text-emerald-700 bg-emerald-50 ring-emerald-100" : tone === "rose" ? "text-rose-700 bg-rose-50 ring-rose-100" : "text-zinc-950 bg-zinc-50 ring-zinc-200/70";
  return (
    <div className={`rounded-2xl px-3 py-3 ring-1 ${toneClass}`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {detail && <p className="mt-0.5 text-[11px] font-medium opacity-70">{detail}</p>}
    </div>
  );
}

export function HistorySnapshotDrawer({
  event,
  previousEvent,
  accountId,
  periodDays,
  initialTab,
  expandInfrastructure = false,
  onClose,
}: {
  event: HistoryEvent;
  previousEvent: HistoryEvent | null;
  accountId: string;
  periodDays: number;
  initialTab: "snapshot" | "compare";
  expandInfrastructure?: boolean;
  onClose: () => void;
}) {
  const canCompare = !!previousEvent;
  const [activeTab, setActiveTab] = useState<"snapshot" | "compare">(canCompare && initialTab === "compare" ? "compare" : "snapshot");
  const [downloading, setDownloading] = useState(false);

  const snap = event.snapshot;
  const cause = causeSentence(event);
  const impacts = impactItems(event);
  const openedThisScan = event.type === "baseline_established" ? event.findings_discovered ?? event.findings_opened : snap?.findings_opened ?? event.findings_opened;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-zinc-950/25 backdrop-blur-[2px]" onClick={onClose} aria-hidden />

      <div className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col overflow-hidden bg-white shadow-2xl" role="dialog" aria-labelledby="history-snapshot-title">
        <header className="shrink-0 border-b border-zinc-200 bg-white px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-500">{frameworkLabel(event.framework)} snapshot</p>
              <h2 id="history-snapshot-title" className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950">{scanDateLabel(event.timestamp)}</h2>
            </div>
            <button type="button" onClick={onClose} className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" aria-label="Close">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {canCompare && (
            <div className="mt-4 inline-flex rounded-2xl bg-zinc-100 p-1" role="group" aria-label="Snapshot view">
              {(["snapshot", "compare"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${activeTab === tab ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-900"}`}
                >
                  {tab === "snapshot" ? "Overview" : `Compare to ${new Date(previousEvent!.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
                </button>
              ))}
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {activeTab === "snapshot" && (
            <div className="space-y-6">
              <section className="rounded-3xl border border-zinc-200/80 bg-gradient-to-br from-zinc-50 to-white p-5 shadow-sm shadow-zinc-950/[0.02]">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Posture movement</p>
                    <div className="mt-2">
                      {event.type !== "baseline_established" ? (
                        <PostureShift before={event.posture_before} after={event.posture_after} />
                      ) : (
                        <p className="text-4xl font-semibold tabular-nums tracking-tight text-zinc-950">{event.posture_after != null ? `${event.posture_after}%` : "—"}</p>
                      )}
                    </div>
                  </div>
                  <SummaryTile label="Resolved" value={event.findings_resolved ?? 0} detail="findings" tone={(event.findings_resolved ?? 0) > 0 ? "emerald" : "zinc"} />
                </div>

                {cause && event.type !== "baseline_established" && (
                  <p className="mt-5 text-base leading-snug text-zinc-900">
                    <span className="font-semibold">{cause.control}</span>{" "}
                    <span className={cause.tone === "bad" ? "text-rose-600" : cause.tone === "good" ? "text-emerald-600" : "text-zinc-500"}>{cause.text}</span>
                  </p>
                )}

                {event.type === "baseline_established" && <p className="mt-3 text-sm leading-relaxed text-zinc-600">First recorded posture for this framework in the selected window.</p>}
              </section>

              {impacts.length > 0 && (
                <section className="rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-sm shadow-zinc-950/[0.02]">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">What changed</p>
                  <div className="mt-3"><ImpactList items={impacts} size="sm" /></div>
                </section>
              )}

              {event.type !== "baseline_established" && (event.diff.newly_failed.length > 0 || event.diff.newly_passed.length > 0) && (
                <section className="space-y-4 rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-sm shadow-zinc-950/[0.02]">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Control changes</p>
                  <ControlChangeList title="Controls that failed" tone="fail" items={event.diff.newly_failed} />
                  <ControlChangeList title="Controls that passed" tone="pass" items={event.diff.newly_passed} />
                </section>
              )}

              <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SummaryTile label="Passing" value={snap?.controls_passed ?? "—"} tone="emerald" />
                <SummaryTile label="Failing" value={snap?.controls_failed ?? "—"} tone="rose" />
                <SummaryTile label="No data" value={snap?.controls_no_data ?? "—"} />
                <SummaryTile label="Opened" value={openedThisScan ?? "—"} detail="this scan" />
              </section>

              {(event.infrastructure_events_count ?? 0) > 0 && event.type !== "baseline_established" && (
                <details className="rounded-2xl border border-zinc-200/80 bg-zinc-50/40 px-4 py-3" open={expandInfrastructure}>
                  <summary className="cursor-pointer text-[12px] font-semibold text-zinc-600">Technical CloudTrail context ({event.infrastructure_events_count})</summary>
                  <div className="mt-3">
                    <InfrastructureEventsList accountId={accountId} onDate={scanAsOfDate(event.timestamp)} count={event.infrastructure_events_count ?? 0} defaultExpanded />
                  </div>
                </details>
              )}
            </div>
          )}

          {activeTab === "compare" && previousEvent && (
            <div className="space-y-5">
              <section className="rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-sm shadow-zinc-950/[0.02]">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Scan comparison</p>
                <p className="mt-2 text-sm font-semibold text-zinc-700">
                  {new Date(previousEvent.timestamp).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
                  <span className="mx-2 font-normal text-zinc-400">→</span>
                  {scanDateLabel(event.timestamp)}
                </p>
                <div className="mt-4 divide-y divide-zinc-100 rounded-2xl bg-zinc-50/70 px-4 py-1 ring-1 ring-zinc-200/70">
                  <CompareRow label="Score" before={previousEvent.posture_after} after={event.posture_after} betterWhen="higher" />
                  <CompareRow label="Passing controls" before={previousEvent.snapshot?.controls_passed} after={event.snapshot?.controls_passed} betterWhen="higher" />
                  <CompareRow label="Failing controls" before={previousEvent.snapshot?.controls_failed} after={event.snapshot?.controls_failed} betterWhen="lower" />
                  <CompareRow label="No data" before={previousEvent.snapshot?.controls_no_data} after={event.snapshot?.controls_no_data} betterWhen="lower" />
                  <CompareRow label="Findings opened" before={previousEvent.findings_opened} after={event.findings_opened} betterWhen="lower" />
                  <CompareRow label="Findings resolved" before={previousEvent.findings_resolved} after={event.findings_resolved} betterWhen="higher" />
                </div>
              </section>

              {(event.diff.newly_failed.length > 0 || event.diff.newly_passed.length > 0) && (
                <section className="space-y-4 rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-sm shadow-zinc-950/[0.02]">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">Changes in this scan</p>
                  <ControlChangeList title="Controls that failed" tone="fail" items={event.diff.newly_failed} />
                  <ControlChangeList title="Controls that passed" tone="pass" items={event.diff.newly_passed} />
                </section>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-zinc-100 bg-white px-6 py-4">
          <button
            type="button"
            disabled={downloading}
            onClick={() => {
              setDownloading(true);
              void downloadEvidenceForScan(accountId, event.framework, event.timestamp, periodDays).finally(() => setDownloading(false));
            }}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-indigo-600 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {downloading ? "Generating…" : "Download Audit Package"}
          </button>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            Evidence as of {scanAsOfDate(event.timestamp)}. Rolling packs on{" "}
            <Link to="/controls" className="font-medium text-indigo-600 hover:text-indigo-800">Compliance</Link>.
          </p>
        </div>
      </div>
    </>
  );
}
