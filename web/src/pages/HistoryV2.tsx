import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";

import { api } from "../api";
import { HistoryDashboard } from "../components/HistoryDashboard";
import { HistorySnapshotDrawer } from "../components/HistorySnapshotDrawer";
import { HistoryPeriodSummary } from "../components/HistoryPeriodSummary";
import { ImpactList } from "../components/ImpactList";
import { type ComplianceHistoryResponse, type HistoryEvent, scanShortDate } from "../lib/complianceHistory";
import { causeSentence, eventPresentation, eventTypeLabel, impactItems } from "../lib/historyPresentation";

interface Account {
  id: string;
  label: string;
  account_id: string | null;
  status: string;
}

const FRAMEWORKS = [
  { value: "soc2", label: "SOC 2" },
  { value: "cis_aws_l1", label: "CIS AWS L1" },
  { value: "iso27001", label: "ISO 27001" },
] as const;

const PERIODS = [30, 90, 180] as const;

function ScoreDelta({ before, after }: { before: number | null; after: number | null }) {
  if (after == null) return null;
  if (before == null || before === after) return <span className="text-2xl font-bold tabular-nums text-zinc-950">{after}%</span>;
  const down = after < before;
  const diff = after - before;
  return (
    <span className="flex flex-wrap items-baseline gap-2">
      <span className="text-xl font-bold tabular-nums text-zinc-300">{before}%</span>
      <span className="text-zinc-300">→</span>
      <span className={`text-2xl font-bold tabular-nums ${down ? "text-rose-700" : "text-emerald-700"}`}>{after}%</span>
      <span className={`rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ${down ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
        {diff > 0 ? "+" : "−"}{Math.abs(diff)} pts
      </span>
    </span>
  );
}

function TimelineCard({
  event,
  previous,
  onOpen,
  onCompare,
  onInfra,
}: {
  event: HistoryEvent;
  previous: HistoryEvent | null;
  onOpen: () => void;
  onCompare: () => void;
  onInfra: () => void;
}) {
  const pres = eventPresentation(event);
  const cause = causeSentence(event);
  const impacts = impactItems(event);
  const baseline = event.type === "baseline_established";

  return (
    <article className={`relative rounded-2xl border px-5 py-4 pl-9 shadow-sm shadow-zinc-950/[0.03] ${pres.cardClass}`}>
      <span className={`absolute left-4 top-5 h-3 w-3 rounded-full ring-4 ring-white ${pres.dotClass}`} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-zinc-500">
        <div className="flex items-center gap-2">
          <time className="font-semibold text-zinc-700">{scanShortDate(event.timestamp)}</time>
          <span className="text-zinc-300">·</span>
          <span>{eventTypeLabel(event.type)}</span>
        </div>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 ring-1 ring-zinc-200/70">{event.framework}</span>
      </div>

      {baseline ? <h3 className="mt-2 text-lg font-semibold tracking-tight text-zinc-950">{pres.headline}</h3> : <div className="mt-2"><ScoreDelta before={event.posture_before} after={event.posture_after} /></div>}
      <p className="mt-2 text-sm leading-relaxed text-zinc-600">{pres.subline}</p>

      {cause && !baseline && <p className="mt-2 text-sm text-zinc-900"><span className="font-semibold">{cause.control}</span> <span className={cause.tone === "bad" ? "text-rose-600" : cause.tone === "good" ? "text-emerald-600" : "text-zinc-500"}>{cause.text}</span></p>}
      {impacts.length > 0 && <div className="mt-3"><ImpactList items={impacts} size="sm" /></div>}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <button type="button" onClick={onOpen} className="font-semibold text-indigo-700 hover:text-indigo-900">View evidence</button>
        {previous && !baseline && <button type="button" onClick={onCompare} className="font-medium text-zinc-500 hover:text-zinc-900">Compare</button>}
        {(event.infrastructure_events_count ?? 0) > 0 && <button type="button" onClick={onInfra} className="font-medium text-zinc-500 hover:text-zinc-900">{event.infrastructure_events_count} supporting event{event.infrastructure_events_count === 1 ? "" : "s"}</button>}
      </div>
    </article>
  );
}

export default function HistoryV2() {
  const [days, setDays] = useState(90);
  const [framework, setFramework] = useState("soc2");
  const [accountId, setAccountId] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [drawer, setDrawer] = useState<{ event: HistoryEvent; previous: HistoryEvent | null; tab: "snapshot" | "compare"; infra: boolean } | null>(null);

  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/v1/accounts") });
  const connected = accountsQ.data?.filter((a) => a.status === "connected") ?? [];
  const effectiveAccountId = accountId || connected[0]?.id || "";

  const historyQ = useQuery<ComplianceHistoryResponse>({
    queryKey: ["history", effectiveAccountId, framework, days],
    queryFn: () => api(`/v1/accounts/${effectiveAccountId}/compliance-timeline?framework=${framework}&days=${days}&limit=40`),
    enabled: !!effectiveAccountId,
  });

  const events = historyQ.data?.events ?? [];
  const previousById = useMemo(() => {
    const map = new Map<string, HistoryEvent | null>();
    events.forEach((evt, index) => map.set(evt.scan_run_id, index + 1 < events.length ? events[index + 1] : null));
    return map;
  }, [events]);

  if (accountsQ.data && connected.length === 0) return <Navigate to="/accounts" replace />;

  return (
    <div className={`w-full space-y-6 ${drawer ? "xl:pr-[26rem]" : ""}`}>
      <header className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm shadow-zinc-950/[0.04]">
        <div className="flex flex-wrap items-end justify-between gap-5 border-b border-zinc-100 bg-gradient-to-br from-zinc-50 via-white to-indigo-50/40 px-6 py-5">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-indigo-500">Audit narrative</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-950">Posture history</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-500">Compliance movement, verified remediations, and persistent gaps. Infrastructure events stay as supporting evidence.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={effectiveAccountId} onChange={(e) => setAccountId(e.target.value)} className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 shadow-sm" aria-label="Account">
              {connected.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            <div className="inline-flex rounded-xl border border-zinc-200 bg-zinc-100/60 p-1">
              {FRAMEWORKS.map((f) => <button key={f.value} type="button" onClick={() => setFramework(f.value)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${framework === f.value ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"}`}>{f.label}</button>)}
            </div>
            <div className="inline-flex rounded-xl border border-zinc-200 bg-zinc-100/60 p-1">
              {PERIODS.map((p) => <button key={p} type="button" onClick={() => setDays(p)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${days === p ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"}`}>{p}d</button>)}
            </div>
          </div>
        </div>
        <div className="px-6 py-3 text-xs text-zinc-500">Answers: <span className="font-semibold text-zinc-700">what changed</span>, <span className="font-semibold text-zinc-700">what was fixed</span>, and <span className="font-semibold text-zinc-700">what still blocks readiness</span>.</div>
      </header>

      {historyQ.isLoading && <p className="rounded-2xl border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500">Loading compliance dashboard…</p>}
      {historyQ.error && <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-700">Could not load timeline.</p>}

      {!historyQ.isLoading && !historyQ.error && historyQ.data && <HistoryDashboard events={events} days={days} currentScore={historyQ.data.current_posture_score} currentSummary={historyQ.data.current_summary} periodSummary={historyQ.data.period_summary} scanCount={historyQ.data.scan_count} scanCadence={historyQ.data.scan_cadence} persistentGaps={historyQ.data.persistent_gaps} onSelectSnapshot={(id) => { const evt = events.find((e) => e.scan_run_id === id); if (evt) setDrawer({ event: evt, previous: previousById.get(id) ?? null, tab: "snapshot", infra: false }); }} />}

      {!historyQ.isLoading && !historyQ.error && events.length === 0 && (historyQ.data?.scan_count ?? 0) === 0 && <p className="rounded-2xl border border-dashed border-zinc-300 bg-white px-4 py-12 text-sm text-zinc-500">No scans in this window. Run a scan after connecting your account.</p>}

      {!historyQ.isLoading && events.length > 0 && (
        <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm shadow-zinc-950/[0.03]">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div><h2 className="text-sm font-bold text-zinc-900">Audit timeline</h2><HistoryPeriodSummary summary={historyQ.data?.period_summary} /></div>
            <button type="button" onClick={() => setExpanded((v) => !v)} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100">{expanded ? "Collapse" : `Show ${events.length} event${events.length === 1 ? "" : "s"}`}</button>
          </div>
          {expanded ? <div className="grid gap-3 border-t border-zinc-100 bg-zinc-50/50 p-4">{events.map((evt) => {
            const previous = previousById.get(evt.scan_run_id) ?? null;
            return <TimelineCard key={evt.scan_run_id} event={evt} previous={previous} onOpen={() => setDrawer({ event: evt, previous, tab: "snapshot", infra: false })} onCompare={() => setDrawer({ event: evt, previous, tab: "compare", infra: false })} onInfra={() => setDrawer({ event: evt, previous, tab: "snapshot", infra: true })} />;
          })}</div> : <div className="border-t border-zinc-100 px-5 py-4 text-sm text-zinc-500">Latest event: {scanShortDate(events[0].timestamp)} · {eventTypeLabel(events[0].type)}</div>}
        </section>
      )}

      {drawer && <HistorySnapshotDrawer event={drawer.event} previousEvent={drawer.previous} accountId={effectiveAccountId} periodDays={days} initialTab={drawer.tab} expandInfrastructure={drawer.infra} onClose={() => setDrawer(null)} />}
    </div>
  );
}
