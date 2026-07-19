import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { SecurityScoreGauge } from "./SecurityScoreGauge";
import type { HistoryEvent } from "../lib/complianceHistory";
import { historyDetailLine, historyTypeDisplay } from "../lib/historyEvidence";
import { formatPercentDelta } from "../lib/accountMetricDeltas";
import { serviceForCheck } from "../data/awsServiceMeta";
import {
  buildRecommendedActions,
  postureGradeLabel,
  postureGradeTone,
  postureGuidance,
  postureHeadline,
  type FindingSeverityStats,
} from "../lib/accountPosture";

type PriorityFinding = {
  id: string;
  title: string;
  severity: string;
  risk_score: number;
  check_id?: string;
};

type RecentScanRow = {
  key: string;
  timestamp: string;
  succeeded: boolean;
  resourcesScanned?: number | null;
};

function formatRelativeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function scanDayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatActivityTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function severityChipClass(severity: string): string {
  const sev = severity.toLowerCase();
  if (sev === "critical" || sev === "high") return "accounts-overview-priority__chip--high";
  if (sev === "medium") return "accounts-overview-priority__chip--medium";
  return "accounts-overview-priority__chip--low";
}

function severityLabel(severity: string): string {
  const sev = severity.toLowerCase();
  if (sev === "critical") return "Critical";
  if (sev === "high") return "High";
  if (sev === "medium") return "Medium";
  if (sev === "low") return "Low";
  return severity;
}

function activityLabel(event: HistoryEvent): string {
  const detail = historyDetailLine(event);
  if (detail) return detail;
  return historyTypeDisplay(event).label;
}

function activitySeverityChip(event: HistoryEvent): "High" | "Medium" | "Low" | null {
  if (event.type === "compliance_regressed" || event.type === "finding_reopened") return "High";
  if (event.type === "finding_excepted") return "Medium";
  if (event.type === "scan_with_changes") {
    const failed = event.diff?.newly_failed?.length ?? event.new_failures_count ?? 0;
    const passed = event.diff?.newly_passed?.length ?? event.resolved_count ?? 0;
    if (failed > passed) return "Medium";
    return "Low";
  }
  if (event.type === "finding_resolved" || event.type === "compliance_improved") return "Low";
  if ((event.infrastructure_events_count ?? 0) > 0) return "Medium";
  return null;
}

function activitySeverityClass(severity: "High" | "Medium" | "Low"): string {
  if (severity === "High") return "accounts-overview-changes__chip--high";
  if (severity === "Medium") return "accounts-overview-changes__chip--medium";
  return "accounts-overview-changes__chip--low";
}

function resourceTagForFinding(finding: PriorityFinding): string | null {
  if (!finding.check_id) return null;
  return serviceForCheck(finding.check_id)?.label ?? null;
}

export function AccountOverviewDashboard({
  accountId,
  stats,
  coveragePct,
  coverageDelta,
  securityScore,
  hasScanned,
  loading,
  priorityFindings,
  recentScanRows,
  recentActivity,
  onViewScans,
  onViewScanRow,
  formatScanResources,
}: {
  accountId: string;
  stats: FindingSeverityStats;
  coveragePct: number | null;
  coverageDelta?: number | null;
  securityScore: number | null;
  hasScanned: boolean;
  loading?: boolean;
  priorityFindings: PriorityFinding[];
  recentScanRows: RecentScanRow[];
  recentActivity: HistoryEvent[];
  onViewScans: () => void;
  onViewScanRow?: (row: RecentScanRow) => void;
  formatScanResources: (resources: number | null | undefined) => string;
}) {
  const navigate = useNavigate();

  const grade = securityScore != null ? postureGradeLabel(securityScore) : null;
  const tone = securityScore != null ? postureGradeTone(securityScore) : "fair";
  const headline = postureHeadline(stats, grade ?? "Fair");
  const guidance = postureGuidance(stats);
  const actions = useMemo(() => buildRecommendedActions(stats), [stats]);
  const topSeverity = stats.critHigh > 0 ? "high" : stats.medium > 0 ? "medium" : stats.low > 0 ? "low" : null;
  const coverageTrend =
    coverageDelta != null && coverageDelta !== 0 ? formatPercentDelta(coverageDelta) : null;

  const viewHighFindings = () => {
    navigate(`/findings?account_id=${encodeURIComponent(accountId)}`);
  };

  const openFinding = (finding: PriorityFinding) => {
    navigate(
      `/findings?account_id=${encodeURIComponent(accountId)}&q=${encodeURIComponent(finding.title)}`,
    );
  };

  if (loading) {
    return (
      <div className="accounts-overview animate-pulse" aria-hidden>
        <div className="accounts-overview-posture accounts-overview-posture--skeleton" />
        <div className="accounts-overview-band accounts-overview-band--skeleton" />
      </div>
    );
  }

  return (
    <div className="accounts-overview">
      <section className="accounts-overview-posture" aria-label="Security posture summary">
        <div className="accounts-overview-hero">
          <div className="accounts-overview-hero__copy">
            <h2 className="accounts-overview-hero__headline">
              {stats.open === 0 ? (
                headline
              ) : (
                <>
                  {grade ?? "—"} posture driven by{" "}
                  <span
                    className={
                      topSeverity === "high"
                        ? "accounts-overview-hero__accent--high"
                        : topSeverity === "medium"
                          ? "accounts-overview-hero__accent--medium"
                          : "accounts-overview-hero__accent--low"
                    }
                  >
                    {(topSeverity === "high"
                      ? stats.critHigh
                      : topSeverity === "medium"
                        ? stats.medium
                        : stats.low
                    ).toLocaleString()}{" "}
                    {topSeverity}
                  </span>{" "}
                  finding
                  {(topSeverity === "high"
                    ? stats.critHigh
                    : topSeverity === "medium"
                      ? stats.medium
                      : stats.low) === 1
                    ? ""
                    : "s"}
                  .
                </>
              )}
            </h2>
            <p className="accounts-overview-hero__subline">{guidance}</p>
          </div>
          <div className="accounts-overview-hero__score">
            {hasScanned && securityScore != null && grade ? (
              <SecurityScoreGauge
                score={securityScore}
                tone={tone}
                hubDisplay={grade}
                hubKind="label"
                size={88}
              />
            ) : (
              <p className="accounts-overview-hero__score-empty">Run a scan first</p>
            )}
          </div>
        </div>

        <div className="accounts-overview-metrics" aria-label="Account metrics">
          <div className="accounts-overview-metrics__tile accounts-overview-metrics__tile--high">
            <span className="accounts-overview-metrics__dot" aria-hidden />
            <div className="accounts-overview-metrics__copy">
              <span className="accounts-overview-metrics__value">
                {hasScanned ? stats.critHigh.toLocaleString() : "—"}
              </span>
              <span className="accounts-overview-metrics__label">High</span>
              <span className="accounts-overview-metrics__sub">open findings</span>
            </div>
          </div>
          <div className="accounts-overview-metrics__tile accounts-overview-metrics__tile--medium">
            <span className="accounts-overview-metrics__dot" aria-hidden />
            <div className="accounts-overview-metrics__copy">
              <span className="accounts-overview-metrics__value">
                {hasScanned ? stats.medium.toLocaleString() : "—"}
              </span>
              <span className="accounts-overview-metrics__label">Medium</span>
              <span className="accounts-overview-metrics__sub">open findings</span>
            </div>
          </div>
          <div className="accounts-overview-metrics__tile accounts-overview-metrics__tile--low">
            <span className="accounts-overview-metrics__dot" aria-hidden />
            <div className="accounts-overview-metrics__copy">
              <span className="accounts-overview-metrics__value">
                {hasScanned ? stats.low.toLocaleString() : "—"}
              </span>
              <span className="accounts-overview-metrics__label">Low</span>
              <span className="accounts-overview-metrics__sub">open findings</span>
            </div>
          </div>
          <div className="accounts-overview-metrics__tile accounts-overview-metrics__tile--coverage">
            <div className="accounts-overview-metrics__copy">
              <div className="accounts-overview-metrics__coverage-head">
                <span className="accounts-overview-metrics__value">
                  {coveragePct != null ? `${coveragePct}%` : "—"}
                </span>
                {coverageTrend ? (
                  <span
                    className={`accounts-overview-metrics__trend${
                      coverageDelta != null && coverageDelta > 0
                        ? " accounts-overview-metrics__trend--up"
                        : " accounts-overview-metrics__trend--down"
                    }`}
                  >
                    {coverageTrend}
                  </span>
                ) : null}
              </div>
              <span className="accounts-overview-metrics__label">Evidence coverage</span>
              {hasScanned && coveragePct != null ? (
                <>
                  <div
                    className="accounts-overview-metrics__progress"
                    role="progressbar"
                    aria-valuenow={coveragePct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Evidence coverage"
                  >
                    <div
                      className="accounts-overview-metrics__progress-fill"
                      style={{ width: `${Math.min(100, coveragePct)}%` }}
                    />
                  </div>
                  <span className="accounts-overview-metrics__sub">Evidence window: last 7 days</span>
                </>
              ) : (
                <span className="accounts-overview-metrics__sub">Run a scan first</span>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="accounts-overview-band">
        <section className="accounts-overview-card accounts-overview-card--actions">
          <h3 className="accounts-overview-card__title">Recommended next action</h3>
          {actions.length > 0 ? (
            <ul className="accounts-overview-actions">
              {actions.map((action) => (
                <li key={action.id} className="accounts-overview-actions__item">
                  <span className="accounts-overview-actions__label">{action.label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="accounts-overview-card__empty">No recommended actions — posture looks clean.</p>
          )}
          {stats.critHigh > 0 ? (
            <button type="button" className="accounts-overview-card__primary" onClick={viewHighFindings}>
              View high findings
            </button>
          ) : null}
        </section>

        <section className="accounts-overview-card accounts-overview-card--findings">
          <div className="accounts-overview-card__head">
            <h3 className="accounts-overview-card__title">Priority findings</h3>
            {priorityFindings.length > 0 ? (
              <button type="button" className="accounts-overview-card__link" onClick={viewHighFindings}>
                View all
              </button>
            ) : null}
          </div>
          {priorityFindings.length > 0 ? (
            <>
              <ol className="accounts-overview-priority">
                {priorityFindings.map((finding, index) => {
                  const resourceTag = resourceTagForFinding(finding);
                  return (
                    <li key={finding.id}>
                      <button
                        type="button"
                        className="accounts-overview-priority__row"
                        onClick={() => openFinding(finding)}
                      >
                        <span className="accounts-overview-priority__rank">{index + 1}.</span>
                        <span className="accounts-overview-priority__title">{finding.title}</span>
                        {resourceTag ? (
                          <span className="accounts-overview-priority__resource">{resourceTag}</span>
                        ) : null}
                        <span
                          className={`accounts-overview-priority__chip ${severityChipClass(finding.severity)}`}
                        >
                          <i aria-hidden />
                          {severityLabel(finding.severity)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              {stats.critHigh > priorityFindings.length ? (
                <p className="accounts-overview-priority__footer">
                  Showing top {priorityFindings.length} of {stats.critHigh.toLocaleString()} high findings
                </p>
              ) : null}
            </>
          ) : (
            <p className="accounts-overview-card__empty">
              {hasScanned ? "No high-severity findings right now." : "Run a scan to surface priority findings."}
            </p>
          )}
        </section>
      </div>

      <div className="accounts-overview-band accounts-overview-band--bottom">
        <section className="accounts-overview-card accounts-overview-card--scans">
          <h3 className="accounts-overview-card__title">Recent scans</h3>
          {recentScanRows.length > 0 ? (
            <div className="accounts-overview-scans-table">
              {recentScanRows.map((row) => (
                <div key={row.key} className="accounts-overview-scans-table__row">
                  <span
                    className={`accounts-overview-scans-table__mark${row.succeeded ? "" : " accounts-overview-scans-table__mark--failed"}`}
                    aria-hidden
                  >
                    {row.succeeded ? (
                      <svg fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" />
                      </svg>
                    ) : (
                      <svg fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
                      </svg>
                    )}
                  </span>
                  <div className="accounts-overview-scans-table__when">
                    <span className="accounts-overview-scans-table__date">{scanDayLabel(row.timestamp)}</span>
                    <span className="accounts-overview-scans-table__ago">{formatRelativeAgo(row.timestamp)}</span>
                  </div>
                  <span className="accounts-overview-scans-table__resources">
                    {formatScanResources(row.resourcesScanned)}
                  </span>
                  <div className="accounts-overview-scans-table__findings">
                    <span className="accounts-overview-scans-table__finding accounts-overview-scans-table__finding--high">
                      <i aria-hidden />
                      {hasScanned ? stats.critHigh : "—"}
                    </span>
                    <span className="accounts-overview-scans-table__finding accounts-overview-scans-table__finding--medium">
                      <i aria-hidden />
                      {hasScanned ? stats.medium : "—"}
                    </span>
                    <span className="accounts-overview-scans-table__finding accounts-overview-scans-table__finding--low">
                      <i aria-hidden />
                      {hasScanned ? stats.low : "—"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="accounts-overview-scans-table__view"
                    onClick={() => (onViewScanRow ? onViewScanRow(row) : onViewScans())}
                  >
                    View
                  </button>
                </div>
              ))}
              <button type="button" className="accounts-overview-card__link accounts-overview-card__link--footer" onClick={onViewScans}>
                View all scans →
              </button>
            </div>
          ) : (
            <p className="accounts-overview-card__empty">
              {hasScanned ? "No recent scans recorded." : "Run a scan to populate scan history."}
            </p>
          )}
        </section>

        <section className="accounts-overview-card accounts-overview-card--changes">
          <h3 className="accounts-overview-card__title">Recent changes</h3>
          {recentActivity.length > 0 ? (
            <ul className="accounts-overview-changes">
              {recentActivity.map((event) => {
                const severity = activitySeverityChip(event);
                return (
                  <li key={`${event.scan_run_id}-${event.timestamp}`} className="accounts-overview-changes__row">
                    <span className="accounts-overview-changes__label">{activityLabel(event)}</span>
                    <div className="accounts-overview-changes__meta">
                      {severity ? (
                        <span className={`accounts-overview-changes__chip ${activitySeverityClass(severity)}`}>
                          <i aria-hidden />
                          {severity}
                        </span>
                      ) : null}
                      <span className="accounts-overview-changes__ago">{formatActivityTimestamp(event.timestamp)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="accounts-overview-card__empty">
              {hasScanned ? "No recent change events." : "Activity appears after your first scan."}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
