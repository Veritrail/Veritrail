import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { api } from "../api";
import { settingsSchema } from "../lib/apiSchemas";
import { frameworkLabel } from "../data/frameworks";
import { HistorySparkline } from "./HistorySparkline";
import { InfrastructureEventsList } from "./InfrastructureEventsList";
import { DrawerShell } from "./DrawerShell";
import {
  drawerComparePreviousScan,
  drawerPostureDelta,
  drawerPostureScore,
  drawerSnapshotSummary,
  findingRemediatedControl,
  remediationsBetween,
  reopeningsBetween,
  snapshotOpenFindings,
} from "../lib/historyEvidence";
import { causeSentence } from "../lib/historyPresentation";
import {
  type HistoryEvent,
  type PostureTrendPoint,
  scanAsOfDate,
  scanDateLabel,
  scanShortDate,
  downloadEvidenceForScan,
} from "../lib/complianceHistory";
import "../styles/history-page.css";

const FRAMEWORK_DISPLAY: Record<string, string> = {
  soc2: "SOC 2 Trust Services Criteria",
  cis_aws_l1: "CIS AWS Foundations Benchmark",
  iso27001: "ISO 27001:2022",
};

const PREVIEW_LIMIT = 3;

type ControlItem = { control_id: string; title: string; open_finding_count?: number };

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatNextScan(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function compareColumnDate(iso: string): string {
  return new Date(iso)
    .toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    .toUpperCase();
}

function primaryCauseBanner(event: HistoryEvent): string | null {
  const cause = causeSentence(event);
  if (!cause) return null;
  if ((event.infrastructure_events_count ?? 0) > 0 && cause.tone === "bad") {
    return `A spike in unusual API activity triggered a regression in ${cause.control}.`;
  }
  if (cause.tone === "bad") {
    return `${cause.control} ${cause.text}.`;
  }
  if (cause.tone === "good") {
    return `${cause.control} ${cause.text}.`;
  }
  return `${cause.control} ${cause.text}.`;
}

function ChangePreview({
  tone,
  countLabel,
  items,
}: {
  tone: "pass" | "fail";
  countLabel: string;
  items: ControlItem[];
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  const visible = expanded ? items : items.slice(0, PREVIEW_LIMIT);
  const headClass = tone === "pass" ? "history-drawer__change-head--pass" : "history-drawer__change-head--fail";

  return (
    <div className="history-drawer__change-card">
      <div className={`history-drawer__change-head ${headClass}`}>
        {tone === "pass" ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
        <span>{countLabel}</span>
      </div>
      <ul className="history-drawer__change-list">
        {visible.map((c) => (
          <li key={c.control_id}>
            <span className="font-mono text-[11px] text-zinc-500">{c.control_id}</span> {c.title}
          </li>
        ))}
      </ul>
      {items.length > PREVIEW_LIMIT && (
        <button type="button" className="history-drawer__view-all" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : `View all (${items.length})`}
        </button>
      )}
    </div>
  );
}

function CompareChange({
  delta,
  betterWhen,
  pts = false,
}: {
  delta: number | null;
  betterWhen: "lower" | "higher";
  pts?: boolean;
}) {
  if (delta == null || delta === 0) return <span className="text-zinc-400">—</span>;
  const improved = betterWhen === "lower" ? delta < 0 : delta > 0;
  const cls = improved ? "history-drawer__chg--good" : "history-drawer__chg--bad";
  const arrow = delta > 0 ? "↑" : "↓";
  const label = pts ? `${arrow} ${Math.abs(delta)} pts` : `${arrow} ${Math.abs(delta)}`;
  return <span className={`history-drawer__chg ${cls}`}>{label}</span>;
}

function complianceControlHref(
  framework: string,
  controlId: string,
  accountId: string,
  status: "fail" | "pass",
): string {
  const params = new URLSearchParams({
    framework,
    control: controlId,
    view: "detailed",
    status,
  });
  if (accountId) params.set("account_id", accountId);
  return `/controls?${params}`;
}

type ControlRowTone = "fail" | "pass" | "improved" | "reopened";

const CONTROL_ROW_META: Record<
  ControlRowTone,
  { title: string; transition: string; transitionClass: string; complianceStatus: "fail" | "pass" }
> = {
  pass: {
    title: "Controls that passed",
    transition: "FAIL → PASS",
    transitionClass: "history-drawer__control-transition--pass",
    complianceStatus: "pass",
  },
  improved: {
    title: "Controls improved",
    transition: "Improved",
    transitionClass: "history-drawer__control-transition--improved",
    complianceStatus: "fail",
  },
  fail: {
    title: "Controls that failed",
    transition: "PASS → FAIL",
    transitionClass: "history-drawer__control-transition--fail",
    complianceStatus: "fail",
  },
  reopened: {
    title: "Controls regressed",
    transition: "Reopened",
    transitionClass: "history-drawer__control-transition--reopened",
    complianceStatus: "fail",
  },
};

function ControlRows({
  tone,
  items,
  framework,
  accountId,
  onNavigate,
}: {
  tone: ControlRowTone;
  items: ControlItem[];
  framework: string;
  accountId: string;
  onNavigate: () => void;
}) {
  if (items.length === 0) return null;
  const meta = CONTROL_ROW_META[tone];

  return (
    <div className="history-drawer__card history-drawer__controls">
      <div className="history-drawer__controls-head">
        <span>{meta.title}</span>
        <span className="history-drawer__controls-count">{items.length}</span>
      </div>
      {items.map((c) => (
        <Link
          key={c.control_id}
          to={complianceControlHref(framework, c.control_id, accountId, meta.complianceStatus)}
          onClick={onNavigate}
          className="history-drawer__control-row"
        >
          <div className="min-w-0">
            <div className="history-drawer__control-line">
              <span className="history-drawer__control-id">{c.control_id}</span>
              <span className={`history-drawer__control-transition ${meta.transitionClass}`}>{meta.transition}</span>
            </div>
            <p className="history-drawer__control-title">{c.title}</p>
          </div>
          <svg className="history-drawer__control-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      ))}
    </div>
  );
}

function findingPartialControlItems(event: HistoryEvent, kind: "improved" | "reopened"): ControlItem[] {
  if (kind === "improved" && event.type !== "finding_resolved" && event.type !== "finding_excepted") return [];
  if (kind === "reopened" && event.type !== "finding_reopened") return [];
  const c = findingRemediatedControl(event);
  if (!c) return [];
  return [{ control_id: c.control_id, title: c.title }];
}

export function HistorySnapshotDrawer({
  event,
  previousEvent,
  accountId,
  periodDays,
  initialTab,
  expandInfrastructure = false,
  postureTrend = [],
  allEvents = [],
  scansInWindow,
  onClose,
}: {
  event: HistoryEvent;
  previousEvent: HistoryEvent | null;
  accountId: string;
  periodDays: number;
  initialTab: "snapshot" | "compare";
  expandInfrastructure?: boolean;
  postureTrend?: PostureTrendPoint[];
  allEvents?: HistoryEvent[];
  scansInWindow?: number;
  onClose: () => void;
}) {
  const comparePrevious = useMemo(() => drawerComparePreviousScan(allEvents, event), [allEvents, event]);
  const compareSnap = comparePrevious ? drawerSnapshotSummary(comparePrevious, allEvents) : null;
  const canCompare = comparePrevious != null;
  const [activeTab, setActiveTab] = useState<"snapshot" | "compare">(canCompare && initialTab === "compare" ? "compare" : "snapshot");
  const [downloading, setDownloading] = useState(false);

  const settingsQ = useQuery({
    queryKey: ["settings"],
    queryFn: () => api("/v1/settings", { schema: settingsSchema }),
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const snap = drawerSnapshotSummary(event, allEvents);
  const causeBanner = primaryCauseBanner(event);
  const openedThisScan =
    event.type === "baseline_established"
      ? (event.findings_discovered ?? event.findings_opened)
      : event.type.startsWith("finding_")
        ? event.findings_opened
        : (snap?.findings_opened ?? event.findings_opened);

  const score = drawerPostureScore(event, allEvents, postureTrend);
  const vsPrev = drawerPostureDelta(event, comparePrevious, allEvents, postureTrend);

  const trendUpToEvent = useMemo(() => {
    const cutoff = new Date(event.timestamp).getTime();
    return postureTrend.filter((p) => new Date(p.timestamp).getTime() <= cutoff);
  }, [postureTrend, event.timestamp]);

  const passed = event.diff.newly_passed;
  const failed = event.diff.newly_failed;
  const improved = findingPartialControlItems(event, "improved");
  const reopened = findingPartialControlItems(event, "reopened");
  const openNow = snapshotOpenFindings(snap);
  const openBefore = comparePrevious ? snapshotOpenFindings(compareSnap ?? undefined) : null;
  const resolvedSince =
    comparePrevious != null ? remediationsBetween(allEvents, comparePrevious.timestamp, event.timestamp) : 0;
  const reopenedSince =
    comparePrevious != null ? reopeningsBetween(allEvents, comparePrevious.timestamp, event.timestamp) : 0;

  const overlay = (
    <DrawerShell
      onClose={onClose}
      labelledBy="history-snapshot-title"
      backdropZIndexClassName="z-[60]"
      panelZIndexClassName="z-[70]"
      panelClassName="history-drawer-shell history-drawer history-drawer__panel"
      backdropClassName="history-drawer-backdrop"
    >
      <header className="history-drawer__header">
          <p className="history-drawer__eyebrow">{frameworkLabel(event.framework)} snapshot</p>
          <div className="history-drawer__title-row">
            <h2 id="history-snapshot-title" className="history-drawer__title">
              {scanDateLabel(event.timestamp)}
              {activeTab === "compare" && <span className="history-drawer__badge">Current scan</span>}
            </h2>
            <button type="button" onClick={onClose} className="history-drawer__close" aria-label="Close">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {canCompare && (
            <div className="history-drawer__tabs history-tabs" role="group" aria-label="Snapshot view">
              {(["snapshot", "compare"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`history-tab${activeTab === tab ? " history-tab--active" : ""}`}
                >
                  {tab === "snapshot" ? "Overview" : "Compare to previous"}
                </button>
              ))}
            </div>
          )}
        </header>

        <div className="history-drawer__body">
          {activeTab === "snapshot" && (
            <>
              <div className="history-drawer__card history-drawer__posture-card">
                <div className="history-drawer__posture-half">
                  <p className="history-drawer__card-label">Posture score</p>
                  <p className="history-drawer__score">{score}%</p>
                  {vsPrev != null && (
                    <p className={`history-drawer__delta ${vsPrev < 0 ? "history-drawer__delta--down" : "history-drawer__delta--up"}`}>
                      {vsPrev < 0 ? "▼" : "▲"} {Math.abs(vsPrev)} pts vs previous
                    </p>
                  )}
                </div>
                <div className="history-drawer__posture-half">
                  <p className="history-drawer__card-label">Score over time</p>
                  <HistorySparkline points={trendUpToEvent} className="history-drawer__spark" />
                </div>
              </div>

              <div className="history-drawer__grid">
                <div className="history-drawer__stat history-drawer__stat--pass">
                  <p className="history-drawer__stat-label">Passing</p>
                  <p className="history-drawer__stat-value">{snap?.controls_passed ?? "—"}</p>
                  <p className="history-drawer__stat-detail">controls</p>
                </div>
                <div className="history-drawer__stat history-drawer__stat--fail">
                  <p className="history-drawer__stat-label">Failing</p>
                  <p className="history-drawer__stat-value">{snap?.controls_failed ?? "—"}</p>
                  <p className="history-drawer__stat-detail">controls</p>
                </div>
                <div className="history-drawer__stat">
                  <p className="history-drawer__stat-label">No data</p>
                  <p className="history-drawer__stat-value">{snap?.controls_no_data ?? "—"}</p>
                  <p className="history-drawer__stat-detail">controls</p>
                </div>
                <div className="history-drawer__stat history-drawer__stat--open">
                  <p className="history-drawer__stat-label">Opened this scan</p>
                  <p className="history-drawer__stat-value">{openedThisScan ?? "—"}</p>
                  <p className="history-drawer__stat-detail">finding{openedThisScan === 1 ? "" : "s"}</p>
                </div>
              </div>

              {causeBanner && event.type !== "baseline_established" && (
                <div className="history-drawer__cause" style={{ marginTop: "0.875rem" }}>
                  <svg className="history-drawer__cause-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <circle cx="12" cy="12" r="9" />
                    <path strokeLinecap="round" d="M12 10v6M12 7h.01" />
                  </svg>
                  <p>{causeBanner}</p>
                </div>
              )}

              {event.type === "baseline_established" && (
                <p className="mt-3 text-sm leading-relaxed text-zinc-600">First recorded posture for this framework in the selected window.</p>
              )}

              {(passed.length > 0 || failed.length > 0) && event.type !== "baseline_established" && (
                <div className="history-drawer__split" style={{ marginTop: "0.875rem" }}>
                  <ChangePreview
                    tone="pass"
                    countLabel={`+${passed.length} control${passed.length === 1 ? "" : "s"}`}
                    items={passed}
                  />
                  <ChangePreview
                    tone="fail"
                    countLabel={`+${failed.length} control${failed.length === 1 ? "" : "s"}`}
                    items={failed}
                  />
                </div>
              )}

              {event.type !== "baseline_established" && (
                <div style={{ marginTop: improved.length > 0 || reopened.length > 0 ? "0.875rem" : undefined }}>
                  <ControlRows
                    tone="improved"
                    items={improved}
                    framework={event.framework}
                    accountId={accountId}
                    onNavigate={onClose}
                  />
                  <ControlRows
                    tone="reopened"
                    items={reopened}
                    framework={event.framework}
                    accountId={accountId}
                    onNavigate={onClose}
                  />
                </div>
              )}

              <div className="history-drawer__card history-drawer__meta" style={{ marginTop: "0.875rem" }}>
                <div className="history-drawer__meta-row">
                  <span className="history-drawer__meta-key">Scan time</span>
                  <span className="history-drawer__meta-val">{formatDateTime(event.timestamp)}</span>
                </div>
                <div className="history-drawer__meta-row">
                  <span className="history-drawer__meta-key">Framework</span>
                  <span className="history-drawer__meta-val">{FRAMEWORK_DISPLAY[event.framework] ?? frameworkLabel(event.framework)}</span>
                </div>
                <div className="history-drawer__meta-row">
                  <span className="history-drawer__meta-key">Scans in window</span>
                  <span className="history-drawer__meta-val">{scansInWindow ?? "—"}</span>
                </div>
                <div className="history-drawer__meta-row">
                  <span className="history-drawer__meta-key">Next scan</span>
                  <span className="history-drawer__meta-val">{formatNextScan(settingsQ.data?.scan_status.next_scan_at)}</span>
                </div>
              </div>

              {(event.infrastructure_events_count ?? 0) > 0 && event.type !== "baseline_established" && (
                <details className="history-drawer__card" style={{ marginTop: "0.875rem", padding: "0.75rem 1rem" }} open={expandInfrastructure}>
                  <summary className="cursor-pointer text-xs font-semibold text-zinc-600">
                    Technical CloudTrail context ({event.infrastructure_events_count})
                  </summary>
                  <div className="mt-3">
                    <InfrastructureEventsList
                      accountId={accountId}
                      onDate={scanAsOfDate(event.timestamp)}
                      count={event.infrastructure_events_count ?? 0}
                      defaultExpanded
                    />
                  </div>
                </details>
              )}
            </>
          )}

          {activeTab === "compare" && comparePrevious && (
            <>
              <div className="history-drawer__card">
                <p className="history-drawer__section-label">Scan comparison</p>
                <p className="history-drawer__compare-title">
                  {scanShortDate(event.timestamp)}
                  <span className="mx-2 font-normal text-zinc-400">→</span>
                  {scanShortDate(comparePrevious.timestamp)}
                </p>
                <table className="history-drawer__table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>{compareColumnDate(event.timestamp)}</th>
                      <th>{compareColumnDate(comparePrevious.timestamp)}</th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Score</td>
                      <td>{score}</td>
                      <td>{drawerPostureScore(comparePrevious, allEvents, postureTrend)}</td>
                      <td>
                        <CompareChange
                          delta={score - drawerPostureScore(comparePrevious, allEvents, postureTrend)}
                          betterWhen="higher"
                          pts
                        />
                      </td>
                    </tr>
                    <tr>
                      <td>Passing controls</td>
                      <td>{snap?.controls_passed ?? "—"}</td>
                      <td>{compareSnap?.controls_passed ?? "—"}</td>
                      <td>
                        <CompareChange
                          delta={
                            snap?.controls_passed != null && compareSnap?.controls_passed != null
                              ? snap.controls_passed - compareSnap.controls_passed
                              : null
                          }
                          betterWhen="higher"
                        />
                      </td>
                    </tr>
                    <tr>
                      <td>Failing controls</td>
                      <td>{snap?.controls_failed ?? "—"}</td>
                      <td>{compareSnap?.controls_failed ?? "—"}</td>
                      <td>
                        <CompareChange
                          delta={
                            snap?.controls_failed != null && compareSnap?.controls_failed != null
                              ? snap.controls_failed - compareSnap.controls_failed
                              : null
                          }
                          betterWhen="lower"
                        />
                      </td>
                    </tr>
                    <tr>
                      <td>No data</td>
                      <td>{snap?.controls_no_data ?? "—"}</td>
                      <td>{compareSnap?.controls_no_data ?? "—"}</td>
                      <td>
                        <CompareChange
                          delta={
                            snap?.controls_no_data != null && compareSnap?.controls_no_data != null
                              ? snap.controls_no_data - compareSnap.controls_no_data
                              : null
                          }
                          betterWhen="lower"
                        />
                      </td>
                    </tr>
                    <tr>
                      <td>Open findings</td>
                      <td>{openNow ?? "—"}</td>
                      <td>{openBefore ?? "—"}</td>
                      <td>
                        <CompareChange
                          delta={openNow != null && openBefore != null ? openNow - openBefore : null}
                          betterWhen="lower"
                        />
                      </td>
                    </tr>
                    <tr>
                      <td>Resolved since prior scan</td>
                      <td>{resolvedSince}</td>
                      <td>—</td>
                      <td>
                        <CompareChange delta={resolvedSince > 0 ? resolvedSince : null} betterWhen="higher" />
                      </td>
                    </tr>
                    {reopenedSince > 0 && (
                      <tr>
                        <td>Reopened since prior scan</td>
                        <td>{reopenedSince}</td>
                        <td>—</td>
                        <td>
                          <CompareChange delta={reopenedSince} betterWhen="lower" />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <ControlRows
                tone="fail"
                items={failed}
                framework={event.framework}
                accountId={accountId}
                onNavigate={onClose}
              />
              <ControlRows
                tone="pass"
                items={passed}
                framework={event.framework}
                accountId={accountId}
                onNavigate={onClose}
              />
              <ControlRows
                tone="improved"
                items={improved}
                framework={event.framework}
                accountId={accountId}
                onNavigate={onClose}
              />
              <ControlRows
                tone="reopened"
                items={reopened}
                framework={event.framework}
                accountId={accountId}
                onNavigate={onClose}
              />

              {causeBanner && (
                <div className="history-drawer__card" style={{ marginTop: "0.875rem" }}>
                  <p className="history-drawer__section-label">Primary cause</p>
                  <p className="history-drawer__primary-cause">{causeBanner}</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="history-drawer__footer">
          <button
            type="button"
            disabled={downloading}
            onClick={() => {
              setDownloading(true);
              void downloadEvidenceForScan(accountId, event.framework, event.timestamp, periodDays).finally(() =>
                setDownloading(false),
              );
            }}
            className="history-drawer__download"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" />
            </svg>
            {downloading ? "Generating…" : "Download audit package"}
          </button>
        </div>
    </DrawerShell>
  );

  return createPortal(overlay, document.body);
}
