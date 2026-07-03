import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useSearchParams } from "react-router-dom";

import { api } from "../api";
import { complianceTimelineSchema, compositeControlListSchema } from "../lib/apiSchemas";
import { AccountFilterDropdown } from "../components/AccountFilterDropdown";
import { AppCommandBar } from "../components/AppCommandBar";
import { FrameworkMark } from "../components/FrameworkMark";
import { HeaderSlot } from "../context/HeaderSlot";
import { useConnectedAccountOptions } from "../hooks/useConnectedAccountOptions";
import { useSelectedAccountId } from "../hooks/useSelectedAccountId";
import { HistoryFilterDropdown } from "../components/HistoryFilterDropdown";
import { HistoryPageSizeDropdown } from "../components/HistoryPageSizeDropdown";
import { HistorySnapshotDrawer } from "../components/HistorySnapshotDrawer";
import {
  type ComplianceHistoryResponse,
  type HistoryEvent,
  type PostureTrendPoint,
  downloadEvidenceForScan,
} from "../lib/complianceHistory";
import { eventPresentation } from "../lib/historyPresentation";
import {
  type EventFilter,
  controlOf,
  historyDetailLine,
  historyResourceLabel,
  historyTypeDisplay,
  buildCompositeGroupScope,
  collapseRedundantFindingEvents,
  matchesCompositeGroup,
  matchesEventFilter,
  postureSeries,
} from "../lib/historyEvidence";
import { ListPagination } from "../components/ListPagination";
import { ProductShell } from "../components/ProductShell";
import "../styles/history-page.css";

const FRAMEWORKS = [
  { value: "soc2", label: "SOC 2" },
  { value: "cis_aws_l1", label: "CIS" },
  { value: "iso27001", label: "ISO 27001" },
] as const;

const PERIODS = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "180 days" },
] as const;

const EVENT_FILTERS: { id: EventFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "improved", label: "Resolved" },
  { id: "regressed", label: "Regressed" },
  { id: "exceptions", label: "Exceptions" },
];

const DEFAULT_VISIBLE_EVENTS = 15;
const HISTORY_STALE_MS = 120_000;

const COMPOSITE_GROUP_ORDER = [
  "identity_governance",
  "asset_inventory",
  "secure_sdlc",
  "change_management",
  "data_protection",
  "network_boundary",
  "vulnerability_management",
  "logging_monitoring",
  "incident_response",
  "backup_resilience",
  "container_vulnerability_monitoring",
] as const;

type CompositeControlSummary = {
  id: string;
  title: string;
  check_ids: string[];
};

type DrawerPayload = {
  event: HistoryEvent;
  previous: HistoryEvent | null;
  tab: "snapshot" | "compare";
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function HistoryV2() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [days, setDays] = useState(90);
  const [framework, setFramework] = useState(() => searchParams.get("framework") ?? "soc2");
  const [compositeFilter, setCompositeFilter] = useState(() => searchParams.get("composite") ?? "");
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(DEFAULT_VISIBLE_EVENTS);
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState<DrawerPayload | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const { options: connectedAccounts, isLoading: accountsLoading, isSuccess: accountsReady } =
    useConnectedAccountOptions();
  const { accountId: effectiveAccountId, activeAccount, setAccountId } = useSelectedAccountId(
    connectedAccounts,
    accountsReady,
  );
  const isAwsAccount = !activeAccount?.provider || activeAccount.provider === "aws";

  const compositesQ = useQuery({
    queryKey: ["controls", "composites", effectiveAccountId],
    queryFn: () =>
      api(
        `/v1/controls/composites${effectiveAccountId ? `?account_id=${effectiveAccountId}` : ""}`,
        { schema: compositeControlListSchema },
      ),
    enabled: !!effectiveAccountId && isAwsAccount,
  });

  const compositeOptions = useMemo(() => {
    const order = new Map(COMPOSITE_GROUP_ORDER.map((id, index) => [id, index]));
    const rows = [...(compositesQ.data ?? [])].sort(
      (a, b) => (order.get(a.id as (typeof COMPOSITE_GROUP_ORDER)[number]) ?? 99) - (order.get(b.id as (typeof COMPOSITE_GROUP_ORDER)[number]) ?? 99),
    );
    return [{ value: "", label: "All groups" }, ...rows.map((row) => ({ value: row.id, label: row.title }))];
  }, [compositesQ.data]);

  const compositeGroupScope = useMemo(() => {
    if (!compositeFilter) return null;
    const composite = compositesQ.data?.find((row) => row.id === compositeFilter);
    if (!composite) {
      if (compositesQ.isSuccess) {
        return { checkIds: new Set<string>(), controlIds: new Set<string>() };
      }
      return null;
    }
    return buildCompositeGroupScope(composite);
  }, [compositeFilter, compositesQ.data, compositesQ.isSuccess]);

  const activeCompositeLabel = compositeOptions.find((option) => option.value === compositeFilter)?.label;

  useEffect(() => {
    const nextFramework = searchParams.get("framework");
    const nextComposite = searchParams.get("composite") ?? "";
    if (nextFramework) setFramework(nextFramework);
    setCompositeFilter(nextComposite);
  }, [searchParams]);

  function patchSearchParams(patch: Record<string, string | null | undefined>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }

  const historyQ = useQuery<ComplianceHistoryResponse>({
    queryKey: ["history", effectiveAccountId, framework, days],
    queryFn: () =>
      api(`/v1/accounts/${effectiveAccountId}/compliance-timeline?framework=${framework}&days=${days}&limit=100`, {
        schema: complianceTimelineSchema,
      }),
    enabled: !!effectiveAccountId && isAwsAccount,
    staleTime: HISTORY_STALE_MS,
  });

  const events = useMemo(() => historyQ.data?.events ?? [], [historyQ.data]);

  const previousById = useMemo(() => {
    const map = new Map<string, HistoryEvent | null>();
    events.forEach((evt, index) => map.set(evt.scan_run_id, index + 1 < events.length ? events[index + 1] : null));
    return map;
  }, [events]);

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = events.filter((e) => {
      if (!matchesEventFilter(e, eventFilter)) return false;
      if (!matchesCompositeGroup(e, compositeGroupScope)) return false;
      if (!q) return true;
      const typeLabel = historyTypeDisplay(e).label.toLowerCase();
      const control = controlOf(e)?.id?.toLowerCase() ?? "";
      const resource = historyResourceLabel(e).toLowerCase();
      const detail = historyDetailLine(e).toLowerCase();
      return typeLabel.includes(q) || control.includes(q) || resource.includes(q) || detail.includes(q);
    });
    return collapseRedundantFindingEvents(filtered);
  }, [events, eventFilter, search, compositeGroupScope]);

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageEvents = filteredEvents.slice((safePage - 1) * pageSize, safePage * pageSize);

  const fallbackSeries = useMemo(() => postureSeries(events), [events]);
  const trendPoints = useMemo(() => {
    const api = historyQ.data?.posture_trend ?? [];
    if (api.length > 0) return api;
    return fallbackSeries.map((p) => ({
      timestamp: p.t,
      posture_score: p.posture,
    }));
  }, [historyQ.data?.posture_trend, fallbackSeries]);

  const scans = historyQ.data?.scan_count ?? 0;

  const onlyBaseline = events.length === 1 && events[0]?.type === "baseline_established";

  if (accountsReady && !accountsLoading && connectedAccounts.length === 0) {
    return <Navigate to="/accounts" replace />;
  }

  async function handleDownload(event: HistoryEvent) {
    setDownloadingId(event.scan_run_id);
    try {
      await downloadEvidenceForScan(effectiveAccountId, framework, event.timestamp, days);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <ProductShell className="flex flex-1 flex-col">
    <div className="history-page history-page--fill px-1 pt-2 sm:px-0">
      <HeaderSlot>
        <AppCommandBar className="history-filter-bar">
          <AccountFilterDropdown
            accounts={connectedAccounts}
            value={effectiveAccountId}
            onChange={(id) => {
              setAccountId(id);
              setPageSize(DEFAULT_VISIBLE_EVENTS);
              setPage(1);
            }}
          />

          <HistoryFilterDropdown
            label="Period"
            boxClassName="history-filter-box--period"
            ariaLabel="Period"
            value={String(days)}
            options={PERIODS.map((p) => ({ value: String(p.value), label: p.label }))}
            onChange={(v) => {
              setDays(Number(v));
              setPageSize(DEFAULT_VISIBLE_EVENTS);
              setPage(1);
            }}
          />

          <HistoryFilterDropdown
            label="Framework"
            boxClassName="history-filter-box--framework"
            ariaLabel="Framework"
            value={framework}
            options={FRAMEWORKS.map((f) => ({ value: f.value, label: f.label }))}
            onChange={(v) => {
              setFramework(v);
              setPageSize(DEFAULT_VISIBLE_EVENTS);
              setPage(1);
              patchSearchParams({ framework: v });
            }}
            valueIcon={<FrameworkMark framework={framework} className="history-filter-box__framework-mark" />}
            optionIcon={(id) => <FrameworkMark framework={id} className="history-filter-menu__icon" />}
          />

          <HistoryFilterDropdown
            label="Group"
            boxClassName="history-filter-box--group"
            ariaLabel="Compliance group"
            value={compositeFilter}
            options={compositeOptions}
            onChange={(value) => {
              setCompositeFilter(value);
              setPageSize(DEFAULT_VISIBLE_EVENTS);
              setPage(1);
              patchSearchParams({ composite: value || null });
            }}
          />
        </AppCommandBar>
      </HeaderSlot>

      {isAwsAccount && historyQ.isLoading && <p className="history-loading">Loading history…</p>}

      {isAwsAccount && historyQ.isError && (
        <p className="history-empty text-amber-800">History is temporarily unavailable. Try again in a moment.</p>
      )}

      {!isAwsAccount && effectiveAccountId && (
        <div className="history-empty">
          <p className="font-semibold text-zinc-800">Compliance history</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">
            Detailed event history is available for AWS accounts. View scan results and findings for this account on
            Findings.
          </p>
        </div>
      )}

      {isAwsAccount && !historyQ.isLoading && !historyQ.isError && historyQ.data && (
        <>
          <div className="history-panel history-panel--fill">
            <div className="history-toolbar">
              <div className="history-tabs" role="tablist" aria-label="Event type">
                {EVENT_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={eventFilter === f.id}
                    className={`history-tab${eventFilter === f.id ? " history-tab--active" : ""}`}
                    onClick={() => {
                      setEventFilter(f.id);
                      setPageSize(DEFAULT_VISIBLE_EVENTS);
                      setPage(1);
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="history-toolbar__end">
                {filteredEvents.length > 0 ? (
                  <HistoryPageSizeDropdown
                    value={pageSize}
                    defaultSize={DEFAULT_VISIBLE_EVENTS}
                    onChange={(size) => {
                      setPageSize(size);
                      setPage(1);
                    }}
                  />
                ) : null}
                <div className="history-search">
                  <label className="history-search__input-wrap" htmlFor="history-search">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth={2} aria-hidden>
                      <circle cx="11" cy="11" r="7" />
                      <path strokeLinecap="round" d="M20 20l-3-3" />
                    </svg>
                    <input
                      id="history-search"
                      name="history-search"
                      type="search"
                      placeholder="Search events…"
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPageSize(DEFAULT_VISIBLE_EVENTS);
                        setPage(1);
                      }}
                      aria-label="Search events"
                    />
                  </label>
                </div>
              </div>
            </div>

            {onlyBaseline ? (
              <div className="history-empty">
                <p className="font-semibold text-emerald-800">Baseline recorded</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">
                  History starts with your first completed scan. Remediations and control changes will appear here.
                </p>
              </div>
            ) : events.length === 0 ? (
              <div className="history-empty">
                <p className="font-semibold text-zinc-800">No events in this window</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">
                  Run a scan or verify a remediation from Findings to populate this timeline.
                </p>
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="history-empty">
                {compositeFilter
                  ? `No changes for ${activeCompositeLabel ?? "this group"} match these filters.`
                  : "No changes match these filters."}
              </div>
            ) : (
              <div className="history-table-body">
                <div className="history-table-wrap">
                  <div className="history-table-inner">
                    <table className="history-table">
                      <colgroup>
                        <col className="history-col-datetime" />
                        <col className="history-col-type" />
                        <col className="history-col-control" />
                        <col className="history-col-resource" />
                        <col className="history-col-detail" />
                        <col className="history-col-actions" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Date/Time</th>
                          <th>Type</th>
                          <th>Control</th>
                          <th>Resource</th>
                          <th>Detail</th>
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                      {pageEvents.map((event) => {
                        const typeDisplay = historyTypeDisplay(event);
                        const control = controlOf(event);
                        const resource = historyResourceLabel(event);
                        const detail = historyDetailLine(event) || eventPresentation(event).subline;
                        const previous = previousById.get(event.scan_run_id) ?? null;

                        return (
                          <tr key={`${event.scan_run_id}:${event.timestamp}:${event.type}`}>
                            <td className="history-table__datetime">{formatDateTime(event.timestamp)}</td>
                            <td>
                              <span className={`history-type ${typeDisplay.className}`}>{typeDisplay.label}</span>
                            </td>
                            <td className="history-table__control">{control?.id ?? "—"}</td>
                            <td className="history-table__resource">{resource}</td>
                            <td className="history-table__detail">{detail || "—"}</td>
                            <td className="history-table__actions">
                              <button
                                type="button"
                                className="history-icon-btn"
                                title="View snapshot"
                                aria-label="View snapshot"
                                onClick={() => setDrawer({ event, previous, tab: "snapshot" })}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 3h7v7M10 14 21 3M5 10H3v11h11v-2" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="history-icon-btn"
                                title="Download evidence"
                                aria-label="Download evidence"
                                disabled={downloadingId === event.scan_run_id}
                                onClick={() => void handleDownload(event)}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" />
                                </svg>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <ListPagination
                  variant="card"
                  page={safePage}
                  totalPages={totalPages}
                  totalItems={filteredEvents.length}
                  pageSize={pageSize}
                  onPage={setPage}
                  itemLabel="events"
                />
              </div>
            )}
          </div>
        </>
      )}

      {drawer && (
        <HistorySnapshotDrawer
          event={drawer.event}
          previousEvent={drawer.previous}
          accountId={effectiveAccountId}
          periodDays={days}
          initialTab={drawer.tab}
          expandInfrastructure={false}
          postureTrend={trendPoints}
          allEvents={events}
          scansInWindow={scans}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
    </ProductShell>
  );
}
