import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";

import { api } from "../api";
import { HistoryDashboard } from "../components/HistoryDashboard";
import { HistorySnapshotDrawer } from "../components/HistorySnapshotDrawer";
import { PageShell } from "../components/PageShell";
import {
  type ComplianceHistoryResponse,
  type HistoryEvent,
  scanShortDate,
} from "../lib/complianceHistory";
import { groupEventsByDay, sumFindingsResolvedInPeriod } from "../lib/historyTimeline";
import { eventPresentation } from "../lib/historyPresentation";
import {
  type EventFilter,
  cleanDetail,
  controlOf,
  eventBadge,
  matchesControl,
  matchesEventFilter,
  shortResource,
} from "../lib/historyEvidence";

interface Account {
  id: string;
  label: string;
  account_id: string | null;
  status: string;
}

const FRAMEWORKS = [
  { value: "soc2", label: "SOC 2" },
  { value: "cis_aws_l1", label: "CIS" },
  { value: "iso27001", label: "ISO" },
] as const;

const PERIODS = [30, 90, 180] as const;

const EVENT_FILTERS: { id: EventFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "resolved", label: "Resolved" },
  { id: "regressed", label: "Regressed" },
  { id: "exceptions", label: "Exceptions" },
  { id: "scans", label: "Scans" },
];

type DrawerPayload = {
  event: HistoryEvent;
  previous: HistoryEvent | null;
  tab: "snapshot" | "compare";
  infra: boolean;
};

function ControlChip({ id, onClick }: { id: string; onClick?: () => void }) {
  const base =
    "inline-flex items-center rounded-md bg-zinc-50 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-600 ring-1 ring-inset ring-zinc-200/70";
  // Rendered inside the ResourceGroup toggle button when non-interactive — a nested
  // <button> is invalid DOM, so fall back to a <span> unless a handler is given.
  if (!onClick) {
    return <span className={base}>{id}</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} transition hover:bg-zinc-100 hover:text-zinc-900`}
    >
      {id}
    </button>
  );
}

function EvidenceRow({
  event,
  previous,
  onEvidence,
  onCompare,
  onControl,
}: {
  event: HistoryEvent;
  previous: HistoryEvent | null;
  onEvidence: () => void;
  onCompare: () => void;
  onControl: (controlId: string) => void;
}) {
  const badge = eventBadge(event.type);
  const control = controlOf(event);
  const res = shortResource(event.resource_arn);
  const isFinding = event.type.startsWith("finding_");
  const detail = cleanDetail(event.detail) || (isFinding ? eventPresentation(event).subline : "");
  const before = event.posture_before;
  const after = event.posture_after;
  const canCompare = !isFinding && event.type !== "baseline_established" && !!previous;

  return (
    <article className={`border-l-2 ${badge.rail} py-2 pl-3.5`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${badge.chip}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} aria-hidden />
          {badge.label}
        </span>
        {control && <ControlChip id={control.id} onClick={() => onControl(control.id)} />}
        <time className="ml-auto text-xs tabular-nums text-zinc-400">{scanShortDate(event.timestamp)}</time>
      </div>

      {res ? (
        <p className="mt-1.5 text-sm leading-snug text-zinc-900">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{res.kind}</span>{" "}
          <span className="font-mono font-medium break-all">{res.name}</span>
          {detail && <span className="font-normal text-zinc-500"> — {detail}</span>}
        </p>
      ) : (
        <p className="mt-1.5 text-sm leading-snug text-zinc-700">{control?.title ?? detail ?? eventPresentation(event).headline}</p>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {before != null && after != null && before !== after && (
          <span className="tabular-nums text-zinc-500">
            {before}% <span className="text-zinc-300">→</span> <span className="font-semibold text-zinc-900">{after}%</span>
          </span>
        )}
        <button type="button" onClick={onEvidence} className="font-medium text-indigo-600 hover:text-indigo-800">
          View evidence
        </button>
        {canCompare && (
          <button type="button" onClick={onCompare} className="text-zinc-500 hover:text-zinc-700">
            Compare
          </button>
        )}
      </div>
    </article>
  );
}

function ResourceGroup({
  label,
  events,
  onEvidence,
  onControl,
}: {
  label: string;
  events: HistoryEvent[];
  onEvidence: (event: HistoryEvent) => void;
  onControl: (controlId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const badge = eventBadge(events[0].type);
  const control = controlOf(events[0]);

  return (
    <div className={`border-l-2 ${badge.rail} py-2 pl-3.5`}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-2 text-left">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${badge.chip}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} aria-hidden />
          {badge.label}
        </span>
        {control && <ControlChip id={control.id} />}
        <span className="text-sm font-semibold text-zinc-900">{events.length} resources</span>
        <span className="min-w-0 truncate text-sm text-zinc-500">· {label}</span>
        <span className="ml-auto text-zinc-400">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <ul className="mt-2 space-y-1 border-l border-zinc-100 pl-3">
          {events.map((e, i) => {
            const r = shortResource(e.resource_arn);
            return (
              <li key={`${e.scan_run_id}:${e.resource_arn ?? i}`} className="flex items-center gap-2 text-xs">
                {r && <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{r.kind}</span>}
                <span className="min-w-0 flex-1 truncate font-mono text-zinc-700">{r?.name ?? "—"}</span>
                <button type="button" onClick={() => onEvidence(e)} className="shrink-0 font-medium text-indigo-600 hover:text-indigo-800">
                  evidence
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DayFeed({
  events,
  previousById,
  onDrawer,
  onControl,
}: {
  events: HistoryEvent[];
  previousById: Map<string, HistoryEvent | null>;
  onDrawer: (payload: DrawerPayload) => void;
  onControl: (controlId: string) => void;
}) {
  const groups = new Map<string, HistoryEvent[]>();
  const singles: HistoryEvent[] = [];

  for (const e of events) {
    const groupable =
      (e.type === "finding_resolved" || e.type === "finding_excepted" || e.type === "finding_reopened") && !!e.resource_arn;
    if (groupable) {
      const key = `${e.type}::${cleanDetail(e.detail)}`;
      groups.set(key, [...(groups.get(key) ?? []), e]);
    } else {
      singles.push(e);
    }
  }

  const nodes: { key: string; ts: string; node: ReactNode }[] = [];
  for (const [key, evs] of groups) {
    if (evs.length >= 3) {
      nodes.push({
        key,
        ts: evs[0].timestamp,
        node: (
          <ResourceGroup
            label={cleanDetail(evs[0].detail) || "change verified"}
            events={evs}
            onEvidence={(e) => onDrawer({ event: e, previous: previousById.get(e.scan_run_id) ?? null, tab: "snapshot", infra: false })}
            onControl={onControl}
          />
        ),
      });
    } else {
      singles.push(...evs);
    }
  }

  for (const e of singles) {
    const previous = previousById.get(e.scan_run_id) ?? null;
    nodes.push({
      key: `${e.scan_run_id}:${e.resource_arn ?? ""}:${e.type}`,
      ts: e.timestamp,
      node: (
        <EvidenceRow
          event={e}
          previous={previous}
          onEvidence={() => onDrawer({ event: e, previous, tab: "snapshot", infra: false })}
          onCompare={() => onDrawer({ event: e, previous, tab: "compare", infra: false })}
          onControl={onControl}
        />
      ),
    });
  }

  nodes.sort((a, b) => b.ts.localeCompare(a.ts));

  return (
    <div className="space-y-2.5">
      {nodes.map((n) => (
        <div key={n.key}>{n.node}</div>
      ))}
    </div>
  );
}

function EvidenceTimeline({
  dayGroups,
  previousById,
  onDrawer,
  onControl,
}: {
  dayGroups: ReturnType<typeof groupEventsByDay>;
  previousById: Map<string, HistoryEvent | null>;
  onDrawer: (payload: DrawerPayload) => void;
  onControl: (controlId: string) => void;
}) {
  return (
    <div className="space-y-5">
      {dayGroups.map((group) => (
        <div key={group.day}>
          <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-400">{group.label}</h3>
          <div className="mt-2">
            <DayFeed events={group.events} previousById={previousById} onDrawer={onDrawer} onControl={onControl} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function HistoryV2() {
  const [days, setDays] = useState(90);
  const [framework, setFramework] = useState("soc2");
  const [accountId, setAccountId] = useState("");
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [controlFilter, setControlFilter] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerPayload | null>(null);

  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/v1/accounts") });
  const connected = accountsQ.data?.filter((a) => a.status === "connected") ?? [];
  const effectiveAccountId = accountId || connected[0]?.id || "";

  const historyQ = useQuery<ComplianceHistoryResponse>({
    queryKey: ["history", effectiveAccountId, framework, days],
    queryFn: () =>
      api(`/v1/accounts/${effectiveAccountId}/compliance-timeline?framework=${framework}&days=${days}&limit=40`),
    enabled: !!effectiveAccountId,
  });

  const events = useMemo(() => historyQ.data?.events ?? [], [historyQ.data]);
  const previousById = useMemo(() => {
    const map = new Map<string, HistoryEvent | null>();
    events.forEach((evt, index) => map.set(evt.scan_run_id, index + 1 < events.length ? events[index + 1] : null));
    return map;
  }, [events]);

  // Counts respect the active control filter, not the event filter.
  const controlScoped = useMemo(() => events.filter((e) => matchesControl(e, controlFilter)), [events, controlFilter]);
  const filterCounts = useMemo(() => {
    const counts: Record<EventFilter, number> = { all: 0, resolved: 0, regressed: 0, exceptions: 0, scans: 0 };
    for (const f of EVENT_FILTERS) counts[f.id] = controlScoped.filter((e) => matchesEventFilter(e, f.id)).length;
    return counts;
  }, [controlScoped]);

  const filteredEvents = useMemo(
    () => controlScoped.filter((e) => matchesEventFilter(e, eventFilter)),
    [controlScoped, eventFilter],
  );

  const dayGroups = useMemo(() => groupEventsByDay(filteredEvents), [filteredEvents]);
  const resolvedInPeriod = sumFindingsResolvedInPeriod(events);
  const onlyBaseline = events.length === 1 && events[0]?.type === "baseline_established";

  if (accountsQ.data && connected.length === 0) return <Navigate to="/accounts" replace />;

  const headerActions = (
    <div className="flex flex-wrap items-center justify-end gap-2 rounded-xl border border-zinc-200 bg-white p-1 shadow-sm shadow-zinc-950/[0.02]">
      <select
        value={effectiveAccountId}
        onChange={(e) => setAccountId(e.target.value)}
        className="h-8 max-w-[12rem] truncate rounded-lg border-0 bg-zinc-50 px-2 text-xs font-semibold text-zinc-700 outline-none ring-1 ring-inset ring-zinc-200"
        aria-label="Account"
      >
        {connected.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
      <div className="h-6 w-px bg-zinc-200" />
      <div className="inline-flex rounded-lg bg-zinc-100 p-0.5" role="group" aria-label="Framework">
        {FRAMEWORKS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFramework(f.value)}
            className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
              framework === f.value ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="inline-flex rounded-lg bg-zinc-100 p-0.5" role="group" aria-label="Period">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setDays(p)}
            className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
              days === p ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            {p}d
          </button>
        ))}
      </div>
    </div>
  );

  const filterBar = (
    <div className="mb-4 inline-flex flex-wrap gap-1 rounded-xl bg-zinc-100 p-0.5" role="tablist" aria-label="Event type">
      {EVENT_FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          role="tab"
          aria-selected={eventFilter === f.id}
          onClick={() => setEventFilter(f.id)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            eventFilter === f.id ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-900"
          }`}
        >
          {f.label}
          <span className={eventFilter === f.id ? "text-zinc-400" : "text-zinc-400/80"}> · {filterCounts[f.id]}</span>
        </button>
      ))}
    </div>
  );

  const timelineNode = onlyBaseline ? (
    <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/50 px-3 py-4 text-center">
      <p className="text-xs font-medium text-zinc-800">Baseline recorded</p>
      <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-zinc-500">
        History starts with your first completed scan. Remediations, exceptions, and control changes will appear here.
      </p>
    </div>
  ) : events.length === 0 ? (
    <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/50 px-3 py-4 text-center">
      <p className="text-xs font-medium text-zinc-800">No events in this window</p>
      <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-zinc-500">
        Run a scan or verify a remediation from Findings to populate this timeline.
      </p>
    </div>
  ) : (
    <>
      {filterBar}
      {dayGroups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/50 px-3 py-6 text-center text-xs text-zinc-500">
          No changes match these filters.
        </p>
      ) : (
        <EvidenceTimeline dayGroups={dayGroups} previousById={previousById} onDrawer={setDrawer} onControl={(id) => setControlFilter(id)} />
      )}
    </>
  );

  return (
    <>
      <PageShell
        variant="compact"
        eyebrow="SECURITY PROGRESS"
        title="History"
        description="What changed over time — every remediation, exception, and control movement with its resource and evidence."
        actions={headerActions}
        width="w-full max-w-none"
      >
        {historyQ.isLoading && (
          <p className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-center text-sm text-zinc-500">Loading history…</p>
        )}

        {historyQ.isError && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-900">
            History is temporarily unavailable. Try again in a moment.
          </p>
        )}

        {!historyQ.isLoading && !historyQ.isError && historyQ.data && (
          <HistoryDashboard
            events={events}
            days={days}
            currentScore={historyQ.data.current_posture_score}
            currentSummary={historyQ.data.current_summary}
            periodSummary={historyQ.data.period_summary}
            scanCount={historyQ.data.scan_count}
            persistentGaps={historyQ.data.persistent_gaps}
            openFindingsCount={historyQ.data.current_summary?.open_findings_count}
            resolvedInPeriod={resolvedInPeriod}
            activeControl={controlFilter}
            onSelectControl={setControlFilter}
            timeline={timelineNode}
          />
        )}
      </PageShell>

      {drawer && (
        <HistorySnapshotDrawer
          event={drawer.event}
          previousEvent={drawer.previous}
          accountId={effectiveAccountId}
          periodDays={days}
          initialTab={drawer.tab}
          expandInfrastructure={drawer.infra}
          onClose={() => setDrawer(null)}
        />
      )}
    </>
  );
}
