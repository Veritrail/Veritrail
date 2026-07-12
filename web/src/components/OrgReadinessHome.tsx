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

function SectionHead({ title, linkTo, linkLabel }: { title: string; linkTo: string; linkLabel: string }) {
  return (
    <div className="org-home__section-head">
      <h2 className="org-home__section-title">{title}</h2>
      <Link to={linkTo} className="org-home__section-link">
        {linkLabel} <span aria-hidden>→</span>
      </Link>
    </div>
  );
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
          `/v1/accounts/${account.id}/compliance-timeline?framework=soc2&days=14&limit=10`,
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
      total: rows.length,
      passed: rows.filter((row) => row.status === "pass").length,
      failing: rows.filter((row) => row.status === "fail").length,
      graded: rows.some((row) => row.status !== "no_data"),
    };
  }, [controlsQ.data]);

  const anyScanCompleted = connectedAccounts.some((account) => !!account.last_scan_at);
  const latestCloudScan = useMemo(() => {
    const scans = connectedAccounts
      .map((account) => account.last_scan_at)
      .filter((value): value is string => !!value)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime());
    return scans[0] ?? null;
  }, [connectedAccounts]);
  const latestCloudScanAge = latestCloudScan
    ? Date.now() - new Date(latestCloudScan).getTime()
    : Number.POSITIVE_INFINITY;
  const cloudEvidenceState = !latestCloudScan
    ? "Not scanned"
    : latestCloudScanAge > 72 * 60 * 60 * 1000
      ? "Stale"
      : "Fresh";

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
  const nextActionCount = blockerGroups.length + capabilityItems.length;
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
  const rankedNextActions = [
    ...blockerGroups.map((group) => {
      const controls =
        group.failingControlIds.length > 0 ? group.failingControlIds : group.soc2ControlIds;
      return {
        key: `finding:${group.checkId}`,
        type: "review" as const,
        priority: group.severity === "critical" ? 0 : 1,
        tone: group.severity,
        title: labelForCheck(group.checkId),
        detail: [
          group.location,
          controls.length > 0 ? controls.slice(0, 3).join(", ") : null,
          `${group.count} finding${group.count === 1 ? "" : "s"}`,
        ]
          .filter(Boolean)
          .join(" · "),
        href: findingsHref(group.checkId),
      };
    }),
    ...capabilityItems.map((item) => ({
      key: `enable:${item.checkId}`,
      type: "enable" as const,
      priority: 2,
      tone: "enable" as const,
      title: item.capability,
      detail: `${absenceGapPrompt(item.checkId).awsOption}${item.scopeLabel ? ` · ${item.scopeLabel}` : ""} · ${item.findingCount} affected`,
      href: item.consoleUrl,
    })),
  ]
    .sort((left, right) => left.priority - right.priority);
  let nextActions = rankedNextActions.slice(0, 5);
  const firstEnableAction = rankedNextActions.find((action) => action.type === "enable");
  if (firstEnableAction && !nextActions.some((action) => action.type === "enable")) {
    nextActions = [...nextActions.slice(0, 4), firstEnableAction];
  }

  if (nextActions.length === 0 && controlsSummary.failing > 0) {
    nextActions.push({
      key: "controls:failing",
      type: "review",
      priority: 3,
      tone: "high",
      title: "Review failing controls",
      detail: `${controlsSummary.failing} control${controlsSummary.failing === 1 ? "" : "s"} need attention`,
      href: "/controls?framework=soc2",
    });
  }

  // Narrative subline for the action state: what fixing the queue actually buys.
  const shownGroups = blockerGroups.filter((group) =>
    nextActions.some((action) => action.key === `finding:${group.checkId}`),
  );
  const shownCleared = clearedByBlockers(shownGroups);
  const shownControls = formatControlList(unblockedControlIds(shownGroups));
  const actionSubline =
    shownGroups.length > 0
      ? `Fixing the ${shownGroups.length === 1 ? "item" : `${shownGroups.length} items`} below clears ${shownCleared} of ${highCount} critical or high finding${highCount === 1 ? "" : "s"}${shownControls ? ` and unblocks ${shownControls}` : ""}.`
      : `${actionReasons.join(" · ")} require attention.`;

  if (loading) {
    return (
      <div className="org-home" aria-busy="true">
        <div className="org-home__skeleton org-home__skeleton--top" />
        <div className="org-home__skeleton org-home__skeleton--metrics" />
        <div className="org-home__skeleton org-home__skeleton--card" />
      </div>
    );
  }

  if (!hasAnyConnection && !dataIncomplete) {
    return (
      <div className="org-home">
        <header className="org-home__top">
          <div>
            <p className="org-home__eyebrow">Home</p>
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
          <p className="org-home__eyebrow">Home</p>
          <h1 className="org-home__title">{orgName}</h1>
          <p className="org-home__description">
            {homeState === "incomplete"
              ? "Some evidence sources could not be loaded. The figures below may be incomplete."
              : homeState === "not-assessed"
                ? "Complete a scan or integration sync to establish your technical evidence baseline."
                : homeState === "clear"
                  ? "No critical or high blockers and no missing technical capabilities were found."
                  : actionSubline}
          </p>
        </div>
      </header>

      <section className="org-home__metrics" aria-label="Technical evidence summary">
        <div className="org-home__metric">
          <span className={`org-home__metric-value${highCount > 0 ? " is-risk" : ""}`}>
            {dataIncomplete ? "—" : highCount}
          </span>
          <span className="org-home__metric-label">Critical &amp; high findings</span>
          <span className="org-home__metric-note">
            {dataIncomplete ? "Partial findings data" : highCount === 0 ? "No priority blockers" : "Open across connected sources"}
          </span>
        </div>
        <div className="org-home__metric">
          <span className="org-home__metric-value">
            {controlsQ.isError || controlsSummary.total === 0
              ? "—"
              : `${controlsSummary.passed} / ${controlsSummary.total}`}
          </span>
          <span className="org-home__metric-label">SOC 2 controls passing</span>
          <span className="org-home__metric-note">
            {controlsSummary.failing > 0
              ? `${controlsSummary.failing} failing`
              : controlsSummary.total > 0
                ? "Mapped automated controls"
                : "Not graded yet"}
          </span>
        </div>
        <div className="org-home__metric">
          <span className={`org-home__metric-value org-home__metric-value--${cloudEvidenceState.toLowerCase().replace(" ", "-")}`}>
            {cloudEvidenceState}
          </span>
          <span className="org-home__metric-label">Latest cloud evidence</span>
          <span className="org-home__metric-note">
            {latestCloudScan ? `${formatTimelineAgo(latestCloudScan)} · ${connectedAccounts.length} connected` : "Complete the first cloud scan"}
          </span>
        </div>
      </section>

      <section className="org-home__actions" aria-label="Next actions">
        <div className="org-home__actions-head">
          <div>
            <p className="org-home__section-kicker">Priority queue</p>
            <h2 className="org-home__section-title">Next actions</h2>
          </div>
          <Link to={defaultFindingsHref} className="org-home__section-link">
            All findings <span aria-hidden>→</span>
          </Link>
        </div>
        {nextActions.length > 0 ? (
          <div className="org-home__next-list">
            {nextActions.map((action) => (
              <div key={action.key} className="org-home__next-row">
                <span className={`org-home__next-type org-home__next-type--${action.tone}`}>
                  {action.type === "enable" ? "Enable" : action.tone}
                </span>
                <div className="org-home__next-copy">
                  <strong>{action.title}</strong>
                  <span>{action.detail}</span>
                </div>
                {action.href ? (
                  action.type === "enable" ? (
                    <a href={action.href} target="_blank" rel="noopener noreferrer" className="org-home__next-action">
                      Enable <span aria-hidden>→</span>
                    </a>
                  ) : (
                    <Link to={action.href} className="org-home__next-action">
                      Review <span aria-hidden>→</span>
                    </Link>
                  )
                ) : null}
              </div>
            ))}
            {nextActionCount > nextActions.length ? (
              <div className="org-home__next-footer">
                {nextActionCount - nextActions.length} additional action{nextActionCount - nextActions.length === 1 ? "" : "s"} ·{" "}
                <Link to={defaultFindingsHref}>Findings <span aria-hidden>→</span></Link>{" "}
                <Link to="/audit">Audit <span aria-hidden>→</span></Link>
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
            No priority findings or missing technical capabilities require action.
          </div>
        )}
      </section>

      {awsAccounts.length > 0 ? (
        <section className="org-home__timeline-section org-home__timeline-section--compact" aria-label="Recent AWS activity">
          <SectionHead title="Recent AWS activity" linkTo="/history" linkLabel="History" />
          {timelineEvents.length === 0 ? (
            <p className="org-home__timeline-empty">AWS activity appears after the first completed scan.</p>
          ) : (
            <ul className="org-home__timeline">
              {timelineEvents.map((event, idx) => (
                <li key={`${event.scan_run_id}-${event.timestamp}-${idx}`} className="org-home__timeline-row">
                  <span className="org-home__timeline-time">{formatTimelineAgo(event.timestamp)}</span>
                  <span className={`org-home__timeline-dot${timelineDotIsGreen(event) ? " is-green" : ""}`} aria-hidden />
                  <span className="org-home__timeline-text">{timelineEventText(event)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
