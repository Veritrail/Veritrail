import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { api } from "../api";
import { FrameworkMark } from "../components/FrameworkMark";
import { HistoryFilterDropdown } from "../components/HistoryFilterDropdown";
import { HistoryPageSizeDropdown } from "../components/HistoryPageSizeDropdown";
import { HistorySnapshotDrawer } from "../components/HistorySnapshotDrawer";
import { HistoryControlChurnCell } from "../components/HistoryControlChurnCell";
import { HistorySparkline } from "../components/HistorySparkline";
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
  scanCoverageDays,
} from "../lib/historyEvidence";
import { AWS_LOGO_LIGHT } from "../lib/awsBrand";
import "../styles/history-page.css";

interface Account {
  id: string;
  label: string;
  account_id: string | null;
  status: string;
}

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

const COMPOSITE_GROUP_ORDER = [
  "identity_governance",
  "asset_inventory",
  "secure_sdlc",
  "change_management",
  "data_protection",
  "vulnerability_management",
  "logging_monitoring",
  "backup_resilience",
  "container_vulnerability_monitoring",
] as const;

type CompositeControlSummary = {
  id: string;
  title: string;
  check_ids: string[];
};

/** Frameworks assessed at a point in time — no Type II day-coverage bar. */
const POINT_IN_TIME_FRAMEWORKS = new Set(["cis_aws_l1", "iso27001"]);

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

function EventsFooter({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPage,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  const pages: (number | "ellipsis")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1, 2, 3, "ellipsis", totalPages);
  }

  return (
    <div className="history-footer">
      <span>
        Showing {start}-{end} of {totalItems} events
      </span>
      <div className="history-pagination">
        <button type="button" className="history-page-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          ‹
        </button>
        {pages.map((p, i) =>
          p === "ellipsis" ? (
            <span key={`e-${i}`} className="px-1 text-zinc-400">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={`history-page-btn${p === page ? " history-page-btn--active" : ""}`}
              onClick={() => onPage(p)}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          className="history-page-btn"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          ›
        </button>
      </div>
    </div>
  );
}

export default function HistoryV2() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [days, setDays] = useState(90);
  const [framework, setFramework] = useState(() => searchParams.get("framework") ?? "soc2");
  const [accountId, setAccountId] = useState(() => searchParams.get("account_id") ?? "");
  const [compositeFilter, setCompositeFilter] = useState(() => searchParams.get("composite") ?? "");
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(DEFAULT_VISIBLE_EVENTS);
  const [page, setPage] = useState(1);
  const [drawer, setDrawer] = useState<DrawerPayload | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: () => api<Account[]>("/v1/accounts") });
  const connected = accountsQ.data?.filter((a) => a.status === "connected") ?? [];
  const effectiveAccountId = accountId || connected[0]?.id || "";

  const compositesQ = useQuery({
    queryKey: ["controls", "composites", effectiveAccountId],
    queryFn: () =>
      api<CompositeControlSummary[]>(
        `/v1/controls/composites${effectiveAccountId ? `?account_id=${effectiveAccountId}` : ""}`,
      ),
    enabled: !!effectiveAccountId,
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
    const nextAccountId = searchParams.get("account_id");
    const nextComposite = searchParams.get("composite") ?? "";
    if (nextFramework) setFramework(nextFramework);
    setAccountId(nextAccountId ?? "");
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
      api(`/v1/accounts/${effectiveAccountId}/compliance-timeline?framework=${framework}&days=${days}&limit=100`),
    enabled: !!effectiveAccountId,
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

  const startScore = trendPoints[0]?.posture_score ?? null;
  const currentScore =
    historyQ.data?.current_posture_score ?? trendPoints[trendPoints.length - 1]?.posture_score ?? null;
  const scoreDelta = startScore != null && currentScore != null ? currentScore - startScore : null;
  const positive = (scoreDelta ?? 0) >= 0;

  const periodSummary = historyQ.data?.period_summary;
  const controlsPassed = periodSummary?.controls_improved ?? 0;
  const findingsResolved = periodSummary?.findings_resolved ?? 0;
  const regressed = periodSummary?.controls_regressed ?? 0;
  const scans = historyQ.data?.scan_count ?? 0;
  const coverage = scanCoverageDays(historyQ.data?.scan_cadence, days);

  const onlyBaseline = events.length === 1 && events[0]?.type === "baseline_established";

  if (accountsQ.data && connected.length === 0) return <Navigate to="/accounts" replace />;

  async function handleDownload(event: HistoryEvent) {
    setDownloadingId(event.scan_run_id);
    try {
      await downloadEvidenceForScan(effectiveAccountId, framework, event.timestamp, days);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="history-page history-page--fill px-1 pb-8 pt-2 sm:px-0">
      <div className="history-filter-bar">
          <HistoryFilterDropdown
            label="Account"
            boxClassName="history-filter-box--account"
            ariaLabel="Account"
            value={effectiveAccountId}
            options={connected.map((a) => ({ value: a.id, label: a.label }))}
            onChange={(id) => {
              setAccountId(id);
              setPageSize(DEFAULT_VISIBLE_EVENTS);
              setPage(1);
              patchSearchParams({ account_id: id });
            }}
            valueIcon={<img src={AWS_LOGO_LIGHT} alt="" className="history-filter-box__aws" width={30} height={19} />}
            optionIcon={() => (
              <img
                src={AWS_LOGO_LIGHT}
                alt=""
                className="history-filter-menu__icon history-filter-menu__aws"
                width={30}
                height={19}
              />
            )}
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

        <Link to="/controls" className="history-compliance-link">
          View in compliance
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 17 17 7M7 7h10v10" />
          </svg>
        </Link>
      </div>

      {historyQ.isLoading && <p className="history-loading">Loading history…</p>}

      {historyQ.isError && (
        <p className="history-empty text-amber-800">History is temporarily unavailable. Try again in a moment.</p>
      )}

      {!historyQ.isLoading && !historyQ.isError && historyQ.data && (
        <>
          <div className="history-stats">
            <div className="history-stats__cell history-stats__cell--posture">
              <p className="history-stats__label">Posture</p>
              <p className="history-stats__value">
                {currentScore != null ? `${currentScore}%` : "—"}
                {scoreDelta != null && scoreDelta !== 0 && (
                  <span className={`history-stats__delta${positive ? "" : " history-stats__delta--down"}`}>
                    {positive ? "▲" : "▼"} {Math.abs(scoreDelta)} pts
                  </span>
                )}
              </p>
            </div>

            <div className="history-stats__cell history-stats__cell--chart">
              <HistorySparkline points={trendPoints} />
            </div>

            <div className="history-stats__cell history-stats__cell--metric">
              <p className="history-stats__label">Scans</p>
              <p className="history-stats__value">{scans}</p>
            </div>

            <div
              className="history-stats__cell history-stats__cell--metric"
              title={
                controlsPassed > 0
                  ? `${controlsPassed} control${controlsPassed === 1 ? "" : "s"} fully passed on Compliance`
                  : "Findings verified or cleared — a control only passes when all its findings are gone"
              }
            >
              <p className="history-stats__label history-stats__label--good">Resolved</p>
              <p className="history-stats__value history-stats__num--good">{findingsResolved}</p>
            </div>

            <div className="history-stats__cell history-stats__cell--metric">
              <p className="history-stats__label history-stats__label--bad">Regressed</p>
              <p className="history-stats__value history-stats__num--bad">{regressed}</p>
            </div>

            <div className="history-stats__cell history-stats__cell--coverage">
              {POINT_IN_TIME_FRAMEWORKS.has(framework) ? (
                <HistoryControlChurnCell events={events} />
              ) : (
                <div className="history-coverage">
                  <p className="history-stats__label">Coverage</p>
                  <div className="history-coverage__row">
                    <p className="history-coverage__stat">
                      <span className="history-coverage__count">{coverage.covered}</span>
                      <span className="history-coverage__suffix">/ {coverage.total} days</span>
                    </p>
                    <span className="history-coverage__gap">
                      {coverage.gap === 1 ? "1 gap" : `${coverage.gap} gaps`}
                    </span>
                  </div>
                  <div className="history-coverage__bar">
                    <div
                      className="history-coverage__fill"
                      style={{ width: `${coverage.total > 0 ? (coverage.covered / coverage.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

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
                  <label className="history-search__input-wrap">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth={2} aria-hidden>
                      <circle cx="11" cy="11" r="7" />
                      <path strokeLinecap="round" d="M20 20l-3-3" />
                    </svg>
                    <input
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

                <EventsFooter
                  page={safePage}
                  totalPages={totalPages}
                  totalItems={filteredEvents.length}
                  pageSize={pageSize}
                  onPage={setPage}
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
  );
}
