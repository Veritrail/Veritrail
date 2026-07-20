// Org-first readiness home — default `/home` view (spec: docs/org-readiness-home.md).
// Answers "is the company's technical evidence ready and what blocks it" org-wide.
import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import {
  complianceTimelineSchema,
  controlListSchema,
  integrationStatusNullableSchema,
} from "../lib/apiSchemas";
import { fetchAllFindings } from "../lib/fetchAllFindings";
import type { ComplianceHistoryResponse, HistoryEvent } from "../lib/complianceHistory";
import { historyDetailLine, historyTypeDisplay } from "../lib/historyEvidence";
import { labelForCheck } from "../data/checkLabels";
import {
  assertBlockerMath,
  clearedByBlockers,
  formatControlList,
  groupBlockerFindings,
  isHighSeverity,
  partitionBlockerFindings,
  unblockedControlIds,
  type BlockerFinding,
} from "../lib/orgReadinessBlockers";
import {
  defaultOrgFindingsHref,
  findingsHrefForCheckIds,
  type FindingsProviderScope,
  useConnectedAccountOptions,
} from "../hooks/useConnectedAccountOptions";
import { useMe } from "../hooks/useMe";
import {
  absenceGapEnableItems,
  absenceGapPrompt,
  isAbsenceGapCheck,
} from "../lib/evidenceGap";

/** Query keys aligned with FindingsWorkspace so findings invalidation keeps N fresh. */
function orgScopeFindingsQueryKey(provider: FindingsProviderScope) {
  const scopeParams = { provider };
  return ["findings", "open", "", scopeParams, provider] as const;
}

function formatTimelineAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function timelineEventText(event: HistoryEvent): string {
  const label = historyTypeDisplay(event).label;
  const detail = historyDetailLine(event);
  return detail ? `${label} — ${detail}` : label;
}

function timelineDotIsGreen(event: HistoryEvent): boolean {
  return event.type === "finding_resolved" || event.type === "compliance_improved";
}

function prettifyOrgName(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function OrgReadinessHome() {
  const meQ = useMe();
  const orgName = prettifyOrgName(meQ.data?.org_name?.trim() || "Your company");

  const {
    options: connectedAccounts,
    isSuccess: accountsReady,
    accountsQ,
    cloudAccountsQ,
  } = useConnectedAccountOptions();

  const githubQ = useQuery({
    queryKey: ["github-provider"],
    queryFn: () => api("/v1/integrations/github", { schema: integrationStatusNullableSchema }),
    staleTime: 300_000,
  });
  const gitlabQ = useQuery({
    queryKey: ["gitlab-provider"],
    queryFn: () => api("/v1/integrations/gitlab", { schema: integrationStatusNullableSchema }),
    staleTime: 300_000,
  });
  const entraQ = useQuery({
    queryKey: ["integration", "entra"],
    queryFn: () => api("/v1/integrations/entra", { schema: integrationStatusNullableSchema }),
    staleTime: 300_000,
  });
  const googleWorkspaceQ = useQuery({
    queryKey: ["integration", "google-workspace"],
    queryFn: () => api("/v1/integrations/google-workspace", { schema: integrationStatusNullableSchema }),
    staleTime: 300_000,
  });
  const hasGithub = !!githubQ.data;
  const hasGitlab = !!gitlabQ.data;
  const hasSourceControl = hasGithub || hasGitlab;
  const hasIdentity = !!entraQ.data || !!googleWorkspaceQ.data;
  const integrationsReady =
    githubQ.isFetched && gitlabQ.isFetched && entraQ.isFetched && googleWorkspaceQ.isFetched;

  const hasCloudAccounts = connectedAccounts.length >= 1;
  const hasAnyConnection = hasCloudAccounts || hasSourceControl || hasIdentity;

  const needsCloudFindings = accountsReady && hasCloudAccounts;
  const needsSourceFindings = integrationsReady && hasSourceControl;
  const needsIdentityFindings = integrationsReady && hasIdentity;

  const cloudFindingsQ = useQuery({
    queryKey: orgScopeFindingsQueryKey("all_cloud"),
    queryFn: () => fetchAllFindings<BlockerFinding>({ status: "open", provider: "all_cloud" }),
    enabled: needsCloudFindings,
    refetchOnMount: "always",
  });
  const sourceControlFindingsQ = useQuery({
    queryKey: orgScopeFindingsQueryKey("source_control"),
    queryFn: () => fetchAllFindings<BlockerFinding>({ status: "open", provider: "source_control" }),
    enabled: needsSourceFindings,
    refetchOnMount: "always",
  });
  const identityFindingsQ = useQuery({
    queryKey: orgScopeFindingsQueryKey("identity"),
    queryFn: () => fetchAllFindings<BlockerFinding>({ status: "open", provider: "identity" }),
    enabled: needsIdentityFindings,
    refetchOnMount: "always",
  });

  const controlsQ = useQuery({
    queryKey: ["controls", "soc2", "org-readiness"],
    queryFn: () => api("/v1/controls?framework=soc2", { schema: controlListSchema }),
  });

  const controlStatusById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of controlsQ.data ?? []) {
      if (row.control_id) map[row.control_id] = row.status;
    }
    return map;
  }, [controlsQ.data]);

  const awsAccounts = useMemo(
    () => connectedAccounts.filter((account) => account.provider === "aws"),
    [connectedAccounts],
  );

  const timelineQs = useQueries({
    queries: awsAccounts.map((account) => ({
      queryKey: ["org-readiness", "timeline", account.id],
      queryFn: () =>
        api<ComplianceHistoryResponse>(
          `/v1/accounts/${account.id}/compliance-timeline?framework=soc2&days=90&limit=40`,
          { schema: complianceTimelineSchema },
        ),
      enabled: !!account.last_scan_at,
      staleTime: 60_000,
    })),
  });

  const openFindings = useMemo(() => {
    const byId = new Map<string, BlockerFinding>();
    for (const q of [cloudFindingsQ.data, sourceControlFindingsQ.data, identityFindingsQ.data]) {
      for (const finding of q?.items ?? []) byId.set(finding.id, finding);
    }
    return [...byId.values()];
  }, [cloudFindingsQ.data, sourceControlFindingsQ.data, identityFindingsQ.data]);

  const highFindings = useMemo(() => openFindings.filter((f) => isHighSeverity(f.severity)), [openFindings]);
  const highCount = highFindings.length;
  const { blockerFindings, absenceGapFindings } = useMemo(
    () => partitionBlockerFindings(highFindings),
    [highFindings],
  );
  const blockerGroups = useMemo(
    () => groupBlockerFindings(blockerFindings, 100, controlStatusById),
    [blockerFindings, controlStatusById],
  );
  // Absence gaps are "turn this service on" nudges, not severity-ranked
  // blockers — surface them across all open findings, not just high, so the
  // recommended list reflects every disabled capability (e.g. VPC flow logs).
  const allAbsenceGapFindings = useMemo(
    () => openFindings.filter((f) => isAbsenceGapCheck(f.check_id)),
    [openFindings],
  );
  const capabilityItems = useMemo(() => {
    const findingCountByCheck = new Map<string, number>();
    for (const finding of allAbsenceGapFindings) {
      findingCountByCheck.set(
        finding.check_id,
        (findingCountByCheck.get(finding.check_id) ?? 0) + 1,
      );
    }
    // Rank most-impactful first so the top items aren't arbitrary array order.
    const ranked = [...findingCountByCheck.keys()].sort(
      (a, b) => (findingCountByCheck.get(b) ?? 0) - (findingCountByCheck.get(a) ?? 0),
    );
    return absenceGapEnableItems(ranked, findingCountByCheck).map((item) => {
      const matchingFindings = allAbsenceGapFindings.filter(
        (finding) => finding.check_id === item.checkId,
      );
      const accounts = [
        ...new Set(
          matchingFindings
            .map(
              (finding) =>
                finding.account_label ?? finding.account_name ?? finding.account_id ?? null,
            )
            .filter((value): value is string => !!value),
        ),
      ];
      return {
        ...item,
        findingCount: findingCountByCheck.get(item.checkId) ?? 0,
        scopeLabel:
          accounts.length === 0
            ? null
            : accounts.length <= 2
              ? accounts.join(", ")
              : `${accounts.slice(0, 2).join(", ")} +${accounts.length - 2}`,
      };
    });
  }, [allAbsenceGapFindings]);

  if (import.meta.env.DEV && (blockerGroups.length > 0 || absenceGapFindings.length > 0)) {
    assertBlockerMath(highCount, blockerGroups, { absenceGapCount: absenceGapFindings.length });
  }

  const controlsSummary = useMemo(() => {
    const rows = controlsQ.data ?? [];
    return {
      failing: rows.filter((row) => row.status === "fail").length,
      passing: rows.filter((row) => row.status === "pass").length,
      atRisk: rows.filter((row) => row.status === "at_risk").length,
      graded: rows.some((row) => row.status !== "no_data"),
    };
  }, [controlsQ.data]);

  // Hero coverage: how much of the framework is actually assessed. Denominator is
  // ALL controls (incl. no_data), so unevaluated controls are never hidden —
  // "% passing of the graded few" would over-state readiness. Null until
  // something is graded, so the hero stays clean pre-baseline.
  const readiness = useMemo(() => {
    const assessed = controlsSummary.passing + controlsSummary.failing + controlsSummary.atRisk;
    const total = controlsQ.data?.length ?? 0;
    if (!controlsSummary.graded || total === 0) return null;
    const notAssessed = total - assessed;
    const segments = [
      { value: controlsSummary.passing, color: "#0e9268" },
      { value: controlsSummary.atRisk, color: "#eea23d" },
      { value: controlsSummary.failing, color: "#e15564" },
      { value: notAssessed, color: "#dde2e9" },
    ].filter((segment) => segment.value > 0);
    let cursor = 0;
    const gap = 1.4;
    const ringStops: string[] = [];
    for (const segment of segments) {
      const start = cursor;
      const end = cursor + (segment.value / total) * 360;
      const colorStart = Math.min(start + gap / 2, end);
      const colorEnd = Math.max(end - gap / 2, colorStart);
      ringStops.push(
        `#ffffff ${start}deg ${colorStart}deg`,
        `${segment.color} ${colorStart}deg ${colorEnd}deg`,
        `#ffffff ${colorEnd}deg ${end}deg`,
      );
      cursor = end;
    }
    return {
      total,
      assessed,
      notAssessed,
      pct: Math.round((assessed / total) * 100),
      ring: `conic-gradient(${ringStops.join(", ")})`,
    };
  }, [controlsSummary, controlsQ.data]);

  const anyScanCompleted = connectedAccounts.some((account) => !!account.last_scan_at);

  const findingsLoading =
    (needsCloudFindings && cloudFindingsQ.isPending) ||
    (needsSourceFindings && sourceControlFindingsQ.isPending) ||
    (needsIdentityFindings && identityFindingsQ.isPending);
  const connectionsFailed = accountsQ.isError || cloudAccountsQ.isError;
  const dataIncomplete =
    connectionsFailed ||
    githubQ.isError ||
    gitlabQ.isError ||
    entraQ.isError ||
    googleWorkspaceQ.isError ||
    cloudFindingsQ.isError ||
    sourceControlFindingsQ.isError ||
    identityFindingsQ.isError ||
    controlsQ.isError;
  const loading =
    (!accountsReady && !connectionsFailed) ||
    !integrationsReady ||
    findingsLoading ||
    controlsQ.isPending;

  const timelineEvents = useMemo(() => {
    const events: HistoryEvent[] = [];
    for (const q of timelineQs) {
      for (const event of q.data?.events ?? []) {
        if (event.type === "baseline_established") continue;
        events.push(event);
      }
    }
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return events.slice(0, 4);
  }, [timelineQs]);
  const timelineFetching = timelineQs.some((query) => query.fetchStatus === "fetching");
  const timelinePlaceholderCount = timelineFetching
    ? Math.max(0, 4 - timelineEvents.length)
    : 0;

  const defaultFindingsHref = defaultOrgFindingsHref({ hasCloudAccounts, hasSourceControl, hasIdentity });
  const findingsHref = (checkId: string) => findingsHrefForCheckIds([checkId]) ?? defaultFindingsHref;
  const hasEvidenceData = anyScanCompleted || controlsSummary.graded || openFindings.length > 0;
  const hasActionableWork =
    highCount > 0 || capabilityItems.length > 0 || controlsSummary.failing > 0;
  // Clear means graded with nothing actionable; ungraded (`no_data`) controls
  // must not force a contradictory "Action required" chip over an empty queue.
  const evidenceClear = hasEvidenceData && controlsSummary.graded && !hasActionableWork;
  const homeState = dataIncomplete
    ? "incomplete"
    : !hasEvidenceData || !controlsSummary.graded
      ? "not-assessed"
      : evidenceClear
        ? "clear"
        : "action";
  const actionReasons = [
    highCount > 0
      ? `${highCount} critical or high finding${highCount === 1 ? "" : "s"}`
      : null,
    capabilityItems.length > 0
      ? `${capabilityItems.length} missing capabilit${capabilityItems.length === 1 ? "y" : "ies"}`
      : null,
    controlsSummary.failing > 0
      ? `${controlsSummary.failing} failing control${controlsSummary.failing === 1 ? "" : "s"}`
      : null,
  ].filter((reason): reason is string => !!reason);
  const priorityFindings = blockerGroups.slice(0, 3).map((group) => {
      const controls =
        group.failingControlIds.length > 0 ? group.failingControlIds : group.soc2ControlIds;
      return {
        key: `finding:${group.checkId}`,
        title: labelForCheck(group.checkId),
        detail: [
          controls.length > 0 ? `Unblocks ${controls.slice(0, 3).join(", ")}` : null,
          `${group.count} finding${group.count === 1 ? "" : "s"}`,
          group.location,
        ]
          .filter(Boolean)
          .join(" · "),
        href: findingsHref(group.checkId),
      };
    });
  const enableActions = capabilityItems.slice(0, 3).map((item) => ({
      key: `enable:${item.checkId}`,
      title: item.capability,
      detail: `${absenceGapPrompt(item.checkId).awsOption}${item.scopeLabel ? ` · ${item.scopeLabel}` : ""} · ${item.findingCount} affected`,
      href: item.consoleUrl,
    }));

  if (priorityFindings.length === 0 && controlsSummary.failing > 0) {
    priorityFindings.push({
      key: "controls:failing",
      title: "Review failing controls",
      detail: `${controlsSummary.failing} control${controlsSummary.failing === 1 ? "" : "s"} need attention`,
      href: "/checklist?framework=soc2",
    });
  }

  // Narrative subline for the action state: what fixing the queue actually buys.
  const shownGroups = blockerGroups.filter((group) =>
    priorityFindings.some((action) => action.key === `finding:${group.checkId}`),
  );
  const shownCleared = clearedByBlockers(shownGroups);
  const shownControls = formatControlList(unblockedControlIds(shownGroups));
  // Hero headline above already states the total ("32 high findings…"), so
  // the subline says "of them" instead of repeating the count.
  const actionSubline =
    shownGroups.length > 0
      ? `Fixing the ${shownGroups.length === 1 ? "item" : `${shownGroups.length} items`} below clears ${shownCleared} of them${shownControls ? ` and unblocks ${shownControls}` : ""}.`
      : `${actionReasons.join(" · ")} require attention.`;

  if (loading) {
    return (
      <div className="org-home" aria-busy="true">
        <div className="org-home__skeleton org-home__skeleton--top" />
        <div className="org-home__skeleton org-home__skeleton--card" />
      </div>
    );
  }

  if (!hasAnyConnection && !dataIncomplete) {
    return (
      <div className="org-home">
        <header className="org-home__top">
          <div>
            <h1 className="org-home__title">{orgName}</h1>
            <p className="org-home__description">
              Connect a cloud, identity, or source-control integration to establish your technical
              evidence baseline.
            </p>
          </div>
        </header>
        <section className="org-home__empty-card">
          <div>
            <h2>Connect your first evidence source</h2>
            <p>Veritrail will begin collecting findings, control status, and evidence activity.</p>
          </div>
          <Link to="/integrations" className="org-home__primary-action">
            Go to Integrations <span aria-hidden>→</span>
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="org-home">
      <header className="org-home__top">
        <div>
          <p className="org-home__section-kicker">SOC 2 readiness</p>
          <h1 className="org-home__title">
            <span className="org-home__title-brand">{orgName}</span>
            {homeState === "action" && highCount > 0 ? (
              <span className="org-home__title-statement">
                {" — "}
                <span className="org-home__headline-em">{highCount} high</span> finding
                {highCount === 1 ? "" : "s"} stand{highCount === 1 ? "s" : ""} between you and SOC 2 technical readiness.
              </span>
            ) : homeState === "clear" ? (
              <span className="org-home__title-statement">
                {" "}— no high findings stand between you and SOC 2 technical readiness.
              </span>
            ) : null}
          </h1>
          <p className="org-home__description">
            {homeState === "incomplete"
              ? "Some evidence sources could not be loaded. Readiness data may be incomplete."
              : homeState === "not-assessed"
                ? "Complete a scan or integration sync to establish your technical evidence baseline."
                : homeState === "clear"
                  ? "No critical or high blockers and no missing technical capabilities were found."
                  : actionSubline}
          </p>
        </div>
        {readiness ? (
          <div
            className="org-home__readiness"
            role="img"
            aria-label={`${readiness.assessed} of ${readiness.total} SOC 2 controls assessed (${readiness.pct}%): ${controlsSummary.passing} passing, ${controlsSummary.atRisk} at risk, ${controlsSummary.failing} failing, ${readiness.notAssessed} not assessed`}
          >
            <div className="org-home__readiness-ring" style={{ background: readiness.ring }} aria-hidden>
              <div className="org-home__readiness-ring-value">
                <strong>{readiness.pct}%</strong>
                <span>assessed</span>
              </div>
            </div>
            <div className="org-home__readiness-copy">
              <span className="org-home__readiness-label">Assessment coverage</span>
              <ul className="org-home__readiness-legend">
                <li className="is-pass"><i aria-hidden /><b>{controlsSummary.passing}</b> passing</li>
                {controlsSummary.atRisk > 0 ? (
                  <li className="is-risk"><i aria-hidden /><b>{controlsSummary.atRisk}</b> at risk</li>
                ) : null}
                <li className="is-fail"><i aria-hidden /><b>{controlsSummary.failing}</b> failing</li>
                <li className="is-none"><i aria-hidden /><b>{readiness.notAssessed}</b> not assessed</li>
              </ul>
            </div>
          </div>
        ) : null}
      </header>

      <div className={`org-home__content-grid${enableActions.length === 0 ? " is-single" : ""}`}>
        <section className="org-home__priority-section org-home__priority-section--primary" aria-label="What's blocking you">
          <div className="org-home__priority-heading">
            <div>
              <p className="org-home__section-kicker">Priority queue</p>
              <h2 className="org-home__section-title">What&apos;s blocking you</h2>
              <p className="org-home__section-description">Highest-impact work, ranked by the evidence it clears.</p>
            </div>
            <Link to={defaultFindingsHref} className="org-home__section-link">
              View findings <span aria-hidden>→</span>
            </Link>
          </div>
          <div className="org-home__actions">
            {priorityFindings.length > 0 ? (
              <div className="org-home__next-list">
                {priorityFindings.map((action, index) => (
                  <div key={action.key} className="org-home__next-row">
                    <span className="org-home__next-rank" aria-label={`Priority ${index + 1}`}>
                      {index + 1}
                    </span>
                    <div className="org-home__next-copy">
                      <strong>{action.title}</strong>
                      <span>{action.detail}</span>
                    </div>
                    <Link to={action.href} className="org-home__next-action">
                      Review <span aria-hidden>→</span>
                    </Link>
                  </div>
                ))}
                {blockerGroups.length > priorityFindings.length ? (
                  <div className="org-home__next-footer">
                    <Link to={defaultFindingsHref}>
                      {blockerGroups.length - priorityFindings.length} additional priorit{blockerGroups.length - priorityFindings.length === 1 ? "y" : "ies"} <span aria-hidden>→</span>
                    </Link>
                  </div>
                ) : null}
              </div>
            ) : dataIncomplete ? (
              <div className="org-home__actions-empty">
                <span>Some data could not be loaded, so no complete action list is available.</span>
                <button type="button" onClick={() => window.location.reload()}>Retry</button>
              </div>
            ) : homeState === "not-assessed" ? (
              <div className="org-home__actions-empty">
                Next actions appear after the first completed scan or integration sync.
              </div>
            ) : (
              <div className="org-home__actions-empty is-clear">
                <span aria-hidden>✓</span>
                No priority findings require action.
              </div>
            )}
          </div>
        </section>

        {enableActions.length > 0 ? (
              <section className="org-home__priority-section org-home__priority-section--secondary" aria-label="Capabilities to turn on">
                <div className="org-home__priority-heading">
                  <div>
                    <p className="org-home__section-kicker">Coverage</p>
                    <h2 className="org-home__section-title">Capabilities to turn on</h2>
                  </div>
                  <Link to="/controls" className="org-home__section-link">
                    View all <span aria-hidden>→</span>
                  </Link>
                </div>
                <div className="org-home__actions">
                  <div className="org-home__next-list">
                    {enableActions.map((action, index) => (
                      <div key={action.key} className="org-home__next-row">
                        <div className="org-home__next-copy">
                          <strong>{action.title}</strong>
                          <span>{action.detail}</span>
                        </div>
                        {action.href ? (
                          <a href={action.href} target="_blank" rel="noopener noreferrer" className="org-home__next-action">
                            Enable <span aria-hidden>→</span>
                          </a>
                        ) : null}
                      </div>
                    ))}
                    {capabilityItems.length > enableActions.length ? (
                      <div className="org-home__next-footer">
                        <Link to="/controls">
                          {capabilityItems.length - enableActions.length} additional enablement priorit{capabilityItems.length - enableActions.length === 1 ? "y" : "ies"} <span aria-hidden>→</span>
                        </Link>
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
        ) : null}
      </div>

      {awsAccounts.length > 0 ? (
              <section className="org-home__timeline-section org-home__timeline-section--compact org-home__timeline-section--wide" aria-label="Recent changes">
                <div className="org-home__section-head">
                  <div>
                    <p className="org-home__section-kicker">Activity</p>
                    <h2 className="org-home__section-title">Recent changes</h2>
                  </div>
                  <Link to="/history" className="org-home__section-link">
                    History <span aria-hidden>→</span>
                  </Link>
                </div>
                {timelineEvents.length === 0 && !timelineFetching ? (
                  <p className="org-home__timeline-empty">AWS activity appears after the first completed scan.</p>
                ) : (
                  <ul className="org-home__timeline" aria-busy={timelineFetching || undefined}>
                    {timelineEvents.map((event, idx) => (
                      <li key={`${event.scan_run_id}-${event.timestamp}-${idx}`} className="org-home__timeline-row">
                        <span className="org-home__timeline-time">{formatTimelineAgo(event.timestamp)}</span>
                        <span className={`org-home__timeline-dot${timelineDotIsGreen(event) ? " is-green" : ""}`} aria-hidden />
                        <span className="org-home__timeline-text">{timelineEventText(event)}</span>
                      </li>
                    ))}
                    {Array.from({ length: timelinePlaceholderCount }, (_, index) => (
                      <li key={`timeline-placeholder-${index}`} className="org-home__timeline-row org-home__timeline-row--loading" aria-hidden>
                        <span className="org-home__timeline-skeleton org-home__timeline-skeleton--time" />
                        <span className="org-home__timeline-dot" />
                        <span className="org-home__timeline-skeleton org-home__timeline-skeleton--text" />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
      ) : null}

      {hasEvidenceData ? (
        <footer className="org-home__meta">
          <span>SOC 2 technical framework</span>
          {readiness ? (
            <>
              <span aria-hidden>·</span>
              <span>{readiness.total} controls tracked</span>
            </>
          ) : null}
          <span aria-hidden>·</span>
          <span>
            {connectedAccounts.length} account{connectedAccounts.length === 1 ? "" : "s"} connected
          </span>
        </footer>
      ) : null}
    </div>
  );
}
