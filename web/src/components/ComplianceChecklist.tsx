import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { api } from "../api";
import { frameworkLabel } from "../data/frameworks";
import { howToForCheck } from "../lib/activationRunbooks";
import { auditReadinessSchema } from "../lib/apiSchemas";
import { controlFamily } from "../lib/controlFamilies";
import { AbsenceGapSummaryTile } from "./AbsenceGapSummaryTile";
import {
  ChecklistStepResourceDisplay,
  type NamedResourceRow,
} from "./ChecklistStepResourceDisplay";
import {
  capabilityForAbsenceCheck,
  isAbsenceGapCheck,
  openAbsenceGapChecks,
} from "../lib/evidenceGap";
import {
  regionsFromFindingEvidence,
  resourceRegionForFinding,
  resourceShortName,
  type FindingLike,
} from "../lib/findingDisplay";
import { manualEvidenceHint, type ManualEvidenceHint } from "../lib/manualEvidenceHints";
import type { ExternalEvidenceArtifact } from "../lib/externalEvidence";
import {
  ControlDetailPanel,
  type ControlDetailTabId,
} from "./ControlDetailPanel";

export type ChecklistOpenFinding = {
  id: string;
  check_id: string;
  resource_arn: string;
  evidence?: Record<string, unknown>;
};

type ChecklistState = "verified" | "action" | "manual";
type ChecklistStatusFilter = "todo" | "verified";
type ChecklistResolution = "enable" | "connect" | "evidence";
type ChecklistResolutionFilter = "all" | ChecklistResolution;

type ChecklistControl = {
  id: string;
  control_id: string;
  title: string;
  description?: string;
  check_ids: string[];
  kind?: "auto" | "manual";
};

type ReadinessPlaybookItem = {
  key: string;
  check_ids: string[];
  label: string;
  status: string;
  summary: string;
  controls: string[];
  action_kind: "activate" | "review" | null;
  action_url: string | null;
  activation_label: string | null;
  is_enablement: boolean;
};

type SelectedTechnicalStep = {
  item: ReadinessPlaybookItem;
  title: string;
  state: ChecklistState;
};

const CHECKLIST_STEP_TAB: ControlDetailTabId = "overview";

type ReadinessPlaybook = {
  key: string;
  label: string;
  question: string;
  controls: string[];
  items: ReadinessPlaybookItem[];
};

type TechnicalWorkItem = {
  id: string;
  kind: "technical";
  status: ChecklistStatusFilter;
  resolution: "enable";
  title: string;
  criteria: string[];
  item: ReadinessPlaybookItem;
};

type ManualWorkItem = {
  id: string;
  kind: "manual";
  status: ChecklistStatusFilter;
  resolution: "connect" | "evidence";
  title: string;
  criteria: string[];
  control: ChecklistControl;
  hint: ManualEvidenceHint | null;
};

type ChecklistWorkItem = TechnicalWorkItem | ManualWorkItem;

type ChecklistDomain = {
  key: string;
  label: string;
  question: string;
  items: ChecklistWorkItem[];
};

type ComplianceChecklistProps = {
  accountId: string;
  framework: string;
  /** Header action (audit-package export) — lives here, not in a toolbar strip. */
  action?: ReactNode;
  controls: ChecklistControl[];
  artifacts: ExternalEvidenceArtifact[];
  selectedControlId: string | null;
  openFindingsByCheck: Map<string, ChecklistOpenFinding[]>;
  findingCountByCheck: Map<string, number>;
  onSelectManualControl: (id: string) => void;
};

function stateForTechnicalItem(status: string): ChecklistState {
  return status === "verified" ? "verified" : "action";
}

function belongsInEnablementChecklist(item: {
  status: string;
  action_kind: "activate" | "review" | null;
  is_enablement: boolean;
}): boolean {
  // Unified Compliance view: every actionable technical item belongs — both
  // "activate" (enable a capability) and "review" (failing checks on named
  // resources). Verified rows keep the enablement filter so one-time setup
  // items don't crowd the Completed phase with every passing check.
  if (item.status === "action") return item.action_kind !== null;
  return item.is_enablement;
}

function findingsHref(checkIds: string[], accountId: string): string {
  const params = new URLSearchParams({ checks: checkIds.join(","), account_id: accountId });
  return `/findings?${params.toString()}`;
}

function primaryCheckForHowTo(
  checkIds: string[],
  findingCountByCheck: Map<string, number>,
): string | null {
  if (checkIds.length === 0) return null;
  const openAbsence = openAbsenceGapChecks(checkIds, findingCountByCheck);
  if (openAbsence.length > 0) return openAbsence[0];
  const withFindings = checkIds.filter((id) => (findingCountByCheck.get(id) ?? 0) > 0);
  if (withFindings.length > 0) return withFindings[0];
  return checkIds[0];
}

function findingForDisplay(f: ChecklistOpenFinding): FindingLike {
  return {
    check_id: f.check_id,
    resource_arn: f.resource_arn,
    evidence: f.evidence ?? {},
    first_seen: "",
    risk_score: 0,
    severity: "",
  };
}

type AbsenceGapResourceSummary = {
  kind: "absence";
  regionCount: number;
  regions: string[];
  capability: string;
  checkId: string;
};

type NamedResourceSummary = {
  kind: "named";
  resources: NamedResourceRow[];
};

type StepResourceData = AbsenceGapResourceSummary | NamedResourceSummary;

function affectedResourcesForStep(
  checkIds: string[],
  openFindingsByCheck: Map<string, ChecklistOpenFinding[]>,
  findingCountByCheck: Map<string, number>,
): StepResourceData {
  const primaryCheck = primaryCheckForHowTo(checkIds, findingCountByCheck);
  if (primaryCheck && isAbsenceGapCheck(primaryCheck)) {
    const regions = new Set<string>();
    for (const checkId of checkIds) {
      if (!isAbsenceGapCheck(checkId)) continue;
      for (const finding of openFindingsByCheck.get(checkId) ?? []) {
        const evidence = finding.evidence ?? {};
        const evidenceRegions = regionsFromFindingEvidence(evidence);
        if (evidenceRegions.length > 0) {
          for (const region of evidenceRegions) regions.add(region);
          continue;
        }
        regions.add(resourceRegionForFinding(findingForDisplay(finding)));
      }
    }
    const sortedRegions = [...regions].sort();
    return {
      kind: "absence",
      regionCount: sortedRegions.length,
      regions: sortedRegions,
      capability: capabilityForAbsenceCheck(primaryCheck),
      checkId: primaryCheck,
    };
  }

  const seen = new Set<string>();
  const out: NamedResourceRow[] = [];
  for (const checkId of checkIds) {
    for (const finding of openFindingsByCheck.get(checkId) ?? []) {
      const displayFinding = findingForDisplay(finding);
      const name = resourceShortName(displayFinding);
      const region = resourceRegionForFinding(displayFinding);
      const key = `${name}\0${region}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, region });
    }
  }
  return { kind: "named", resources: out };
}

function cliFilenameTag(cli: string): string {
  const first = cli.trim().split(/\s+/)[0]?.toLowerCase() ?? "cli";
  if (first === "aws") return "aws-cli";
  return first;
}

function CopyCliButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  // Runbook CLI is authored with `\` line-continuations (one flag per line),
  // which leaves most of the wide code block empty. Collapse to one logical
  // command so it flows and wraps at the block's edge, filling the width —
  // and pastes as a single runnable line.
  const displayCode = code.replace(/\\\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();

  const copy = () => {
    void navigator.clipboard.writeText(displayCode).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className="compliance-checklist__cli-block">
      <div className="compliance-checklist__cli-toolbar">
        <span className="compliance-checklist__cli-filename">{cliFilenameTag(code)}</span>
        <button type="button" className="compliance-checklist__cli-copy" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="compliance-checklist__cli-code">
        <code>{displayCode}</code>
      </pre>
    </div>
  );
}

function ChecklistStepStatusChip({ state }: { state: ChecklistState }) {
  if (state === "action") {
    return (
      <span className="checklist-step-drawer__status is-amber">
        <span className="checklist-step-drawer__status-dot" aria-hidden />
        To enable
      </span>
    );
  }
  if (state === "verified") {
    return (
      <span className="checklist-step-drawer__status is-green">
        <span className="checklist-step-drawer__status-dot" aria-hidden />
        Verified
      </span>
    );
  }
  return null;
}

function ChecklistStepDrawerContent({
  item,
  accountId,
  state,
  openFindingsByCheck,
  findingCountByCheck,
}: {
  item: ReadinessPlaybookItem;
  accountId: string;
  state: ChecklistState;
  openFindingsByCheck: Map<string, ChecklistOpenFinding[]>;
  findingCountByCheck: Map<string, number>;
}) {
  const resourceData = affectedResourcesForStep(
    item.check_ids,
    openFindingsByCheck,
    findingCountByCheck,
  );
  const primaryCheck = primaryCheckForHowTo(item.check_ids, findingCountByCheck);
  const howTo = primaryCheck ? howToForCheck(primaryCheck) : null;
  const affectedCount =
    resourceData.kind === "absence"
      ? resourceData.regionCount
      : resourceData.resources.length;

  return (
    <div className="control-detail-stack checklist-step-drawer">
      <div className="checklist-step-drawer__card">
        {howTo ? (
          <section className="checklist-step-drawer__section">
            <div className="checklist-step-drawer__section-head">
              <h3 className="checklist-step-drawer__section-title">How to</h3>
            </div>
            <p className="checklist-step-drawer__console-path">{howTo.consolePath}</p>
            {howTo.cli ? <CopyCliButton code={howTo.cli} /> : null}
          </section>
        ) : null}

        {state === "action" ? (
          <section className="checklist-step-drawer__section">
            <div className="checklist-step-drawer__section-head">
              <h3 className="checklist-step-drawer__section-title">Actions</h3>
            </div>
            <div className="checklist-step-drawer__actions">
              {item.action_kind === "activate" && item.action_url ? (
                <a
                  className="compliance-checklist__item-action checklist-step-drawer__primary-action"
                  href={item.action_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in AWS <span aria-hidden>↗</span>
                </a>
              ) : item.action_kind === "review" ? (
                <Link
                  className="compliance-checklist__item-action checklist-step-drawer__primary-action"
                  to={findingsHref(item.check_ids, accountId)}
                >
                  Review findings
                </Link>
              ) : null}
            </div>
            <p className="checklist-step-drawer__rescan-note">
              Re-scanning verifies this automatically.
            </p>
          </section>
        ) : null}

        <section className="checklist-step-drawer__section checklist-step-drawer__section--resources">
          <div className="checklist-step-drawer__section-head">
            <h3 className="checklist-step-drawer__section-title">
              {resourceData.kind === "absence"
                ? "Affected resources — account-wide"
                : "Affected resources"}
            </h3>
            {resourceData.kind === "named" && resourceData.resources.length > 0 ? (
              <span className="checklist-step-drawer__count-pill">{affectedCount}</span>
            ) : null}
          </div>
          {resourceData.kind === "absence" ? (
            resourceData.regionCount > 0 ? (
              <AbsenceGapSummaryTile
                regionCount={resourceData.regionCount}
                capability={resourceData.capability}
                checkId={resourceData.checkId}
              />
            ) : (
              <p className="checklist-step-drawer__muted">No open findings on mapped checks.</p>
            )
          ) : resourceData.resources.length > 0 ? (
            <ChecklistStepResourceDisplay resources={resourceData.resources} />
          ) : (
            <p className="checklist-step-drawer__muted">No open findings on mapped checks.</p>
          )}
        </section>
      </div>
    </div>
  );
}

export function ComplianceChecklist({
  accountId,
  framework,
  action,
  controls,
  artifacts,
  selectedControlId,
  openFindingsByCheck,
  findingCountByCheck,
  onSelectManualControl,
}: ComplianceChecklistProps) {
  const [statusFilter, setStatusFilter] = useState<ChecklistStatusFilter>("todo");
  const [resolutionFilter, setResolutionFilter] =
    useState<ChecklistResolutionFilter>("all");
  const [openDomainKey, setOpenDomainKey] = useState<string | null>(null);
  const [selectedTechnicalStep, setSelectedTechnicalStep] =
    useState<SelectedTechnicalStep | null>(null);
  const [domainInitialized, setDomainInitialized] = useState(false);

  const readinessQ = useQuery({
    queryKey: ["audit-readiness", framework, accountId],
    queryFn: () =>
      api(
        `/v1/audit-readiness?framework=${encodeURIComponent(framework)}&account_id=${encodeURIComponent(accountId)}`,
        { schema: auditReadinessSchema },
      ),
    enabled: !!accountId,
  });

  const acceptedControlIds = useMemo(() => {
    const ids = new Set<string>();
    for (const artifact of artifacts) {
      if (artifact.status === "accepted" && artifact.control_id) ids.add(artifact.control_id);
    }
    return ids;
  }, [artifacts]);

  const automatedFamilyKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const control of controls) {
      if (control.check_ids.length > 0) {
        keys.add(controlFamily(framework, control.control_id).key);
      }
    }
    return keys;
  }, [controls, framework]);

  const manualControls = useMemo(
    () =>
      controls.filter(
        (control) =>
          control.kind === "manual" &&
          control.check_ids.length === 0 &&
          automatedFamilyKeys.has(controlFamily(framework, control.control_id).key),
      ),
    [automatedFamilyKeys, controls, framework],
  );

  const domainItems = useMemo(() => {
    const playbooks = (readinessQ.data?.playbooks ?? []) as ReadinessPlaybook[];
    const domains = new Map<
      string,
      { key: string; label: string; question: string; items: ChecklistWorkItem[] }
    >();

    const getDomain = (key: string, label: string, question: string) => {
      const existing = domains.get(key);
      if (existing) return existing;
      const next = { key, label, question, items: [] as ChecklistWorkItem[] };
      domains.set(key, next);
      return next;
    };

    for (const playbook of playbooks) {
      const domain = getDomain(playbook.key, playbook.label, playbook.question);
      for (const item of playbook.items) {
        if (item.status === "not_applicable" || item.status === "not_assessed") continue;
        if (!belongsInEnablementChecklist(item)) continue;
        const state = stateForTechnicalItem(item.status);
        domain.items.push({
          id: `technical:${item.key}`,
          kind: "technical",
          status: state === "verified" ? "verified" : "todo",
          resolution: "enable",
          title: state === "action" ? item.activation_label || item.label : item.label,
          criteria: item.controls,
          item,
        });
      }
    }

    for (const control of manualControls) {
      const mappedPlaybook = playbooks.find((playbook) =>
        playbook.controls.some(
          (tag) => tag === control.control_id || tag.endsWith(` ${control.control_id}`),
        ),
      );
      const family = controlFamily(framework, control.control_id);
      const domain = mappedPlaybook
        ? getDomain(mappedPlaybook.key, mappedPlaybook.label, mappedPlaybook.question)
        : getDomain(
            `manual:${family.key}`,
            family.label,
            "Do the policies and human processes for this area have current evidence?",
          );
      const hint = manualEvidenceHint(framework, control.control_id);
      domain.items.push({
        id: `manual:${control.id}`,
        kind: "manual",
        status: acceptedControlIds.has(control.id) ? "verified" : "todo",
        resolution: hint?.collectionMode === "connect" ? "connect" : "evidence",
        title: control.title,
        criteria: [control.control_id],
        control,
        hint,
      });
    }

    return [...domains.values()].filter((domain) => domain.items.length > 0);
  }, [acceptedControlIds, framework, manualControls, readinessQ.data]);

  const allWorkItems = useMemo(
    () => domainItems.flatMap((domain) => domain.items),
    [domainItems],
  );

  const total = allWorkItems.length;
  const verifiedCount = allWorkItems.filter((item) => item.status === "verified").length;
  const remaining = total - verifiedCount;
  const verifiedPct = total > 0 ? Math.round((verifiedCount / total) * 100) : 0;

  const resolutionCounts = useMemo(() => {
    const inStatus = allWorkItems.filter((item) => item.status === statusFilter);
    return {
      all: inStatus.length,
      enable: inStatus.filter((item) => item.resolution === "enable").length,
      connect: inStatus.filter((item) => item.resolution === "connect").length,
      evidence: inStatus.filter((item) => item.resolution === "evidence").length,
    };
  }, [allWorkItems, statusFilter]);

  const visibleDomains = useMemo<ChecklistDomain[]>(
    () =>
      domainItems
        .map((domain) => ({
          key: domain.key,
          label: domain.label,
          question: domain.question,
          items: domain.items.filter(
            (item) =>
              item.status === statusFilter &&
              (resolutionFilter === "all" || item.resolution === resolutionFilter),
          ),
        }))
        .filter((domain) => domain.items.length > 0)
        .sort((a, b) => {
          return statusFilter === "todo"
            ? b.items.length - a.items.length
            : a.label.localeCompare(b.label);
        }),
    [domainItems, resolutionFilter, statusFilter],
  );

  useEffect(() => {
    setStatusFilter("todo");
    setResolutionFilter("all");
    setOpenDomainKey(null);
    setDomainInitialized(false);
    setSelectedTechnicalStep(null);
  }, [accountId, framework]);

  useEffect(() => {
    if (!readinessQ.isSuccess) return;
    setOpenDomainKey((current) =>
      domainInitialized && current && visibleDomains.some((domain) => domain.key === current)
        ? current
        : visibleDomains[0]?.key ?? null,
    );
    if (!domainInitialized) setDomainInitialized(true);
  }, [domainInitialized, readinessQ.isSuccess, visibleDomains]);

  useEffect(() => {
    if (resolutionFilter === "all") return;
    if (resolutionCounts[resolutionFilter] === 0) setResolutionFilter("all");
  }, [resolutionCounts, resolutionFilter]);

  const toggleDomain = (key: string) => {
    setOpenDomainKey((current) => (current === key ? null : key));
  };

  const openTechnicalStep = (item: ReadinessPlaybookItem, state: ChecklistState) => {
    const title = state === "action" ? item.activation_label || item.label : item.label;
    setSelectedTechnicalStep({ item, title, state });
  };

  if (readinessQ.isLoading) {
    return <p className="compliance-checklist__loading">Building your checklist…</p>;
  }

  if (readinessQ.isError) {
    return (
      <p className="compliance-checklist__empty">
        The checklist is temporarily unavailable. Try again in a moment.
      </p>
    );
  }

  return (
    <div className="compliance-checklist">
      <div className="compliance-checklist__surface">
        <header className="compliance-checklist__intro">
          <div className="compliance-checklist__intro-copy">
            <h1>{frameworkLabel(framework)} readiness checklist</h1>
            <p>
              {remaining > 0
                ? `${remaining} requirement${remaining === 1 ? "" : "s"} still ${remaining === 1 ? "needs" : "need"} action before the mapped criteria are audit-ready.`
                : "Every mapped requirement is verified and ready for review."}
            </p>
            <p className="compliance-checklist__honesty">
              <span aria-hidden>ⓘ</span>
              Technical controls are checked automatically. Policies and processes count only after evidence is accepted.
            </p>
          </div>
          <div className="compliance-checklist__intro-side">
            <div className="compliance-checklist__readiness-summary">
              <div className="compliance-checklist__readiness-copy">
                <span>
                  <strong>{verifiedCount}</strong> of {total || 0} verified
                </span>
                <em>{verifiedPct}%</em>
              </div>
              <div
                className="compliance-checklist__progress"
                role="progressbar"
                aria-label={`${verifiedCount} of ${total || 0} requirements verified`}
                aria-valuemin={0}
                aria-valuemax={total || 0}
                aria-valuenow={verifiedCount}
              >
                <span style={{ width: `${verifiedPct}%` }} />
              </div>
            </div>
            {action ? <div className="compliance-checklist__export">{action}</div> : null}
          </div>
        </header>

        <section className="compliance-checklist__workqueue" aria-label="Readiness requirements">
          <div className="compliance-checklist__workqueue-toolbar">
            <div
              className="compliance-checklist__status-tabs"
              role="tablist"
              aria-label="Requirement status"
            >
              <button
                type="button"
                role="tab"
                aria-selected={statusFilter === "todo"}
                className={`compliance-checklist__status-tab${statusFilter === "todo" ? " is-active" : ""}`}
                onClick={() => setStatusFilter("todo")}
              >
                Open <span>{remaining}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={statusFilter === "verified"}
                className={`compliance-checklist__status-tab${statusFilter === "verified" ? " is-active" : ""}`}
                onClick={() => setStatusFilter("verified")}
              >
                Verified <span>{verifiedCount}</span>
              </button>
            </div>

            <div className="compliance-checklist__resolution-bar">
              <span className="compliance-checklist__resolution-label">Work type</span>
              <div className="compliance-checklist__resolution-filters" aria-label="Resolution type">
                {(
                  [
                    ["all", "All"],
                    ["enable", "Enable"],
                    ["connect", "Connect"],
                    ["evidence", "Evidence"],
                  ] as const
                )
                  .filter(([id]) => id === "all" || resolutionCounts[id] > 0)
                  .map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={resolutionFilter === id}
                      className={`compliance-checklist__resolution-filter${
                        resolutionFilter === id ? " is-active" : ""
                      }`}
                      onClick={() => setResolutionFilter(id)}
                    >
                      {label} <span>{resolutionCounts[id]}</span>
                    </button>
                  ))}
              </div>
            </div>
          </div>

          {visibleDomains.length > 0 ? (
            <div className="compliance-checklist__domain-list">
              {visibleDomains.map((domain) => {
                const isExpanded = openDomainKey === domain.key;

                return (
                  <section
                    key={domain.key}
                    className={`compliance-checklist__domain${isExpanded ? " is-expanded" : ""}`}
                  >
                    <button
                      type="button"
                      className="compliance-checklist__domain-summary"
                      aria-expanded={isExpanded}
                      onClick={() => toggleDomain(domain.key)}
                    >
                      <span className="compliance-checklist__domain-copy">
                        <strong>{domain.label}</strong>
                        <small>{domain.question}</small>
                      </span>
                      <span className="compliance-checklist__domain-meta">
                        <span className="compliance-checklist__domain-count">
                          <strong>{domain.items.length}</strong>{" "}
                          {statusFilter === "todo" ? "open" : "verified"}
                        </span>
                        <span
                          className={`compliance-checklist__domain-chevron${isExpanded ? " is-open" : ""}`}
                          aria-hidden
                        >
                          ›
                        </span>
                      </span>
                    </button>

                    {isExpanded ? (
                      <div className="compliance-checklist__requirement-list">
                        {domain.items.map((workItem) => {
                          const isSelected =
                            workItem.kind === "manual"
                              ? selectedControlId === workItem.control.id
                              : selectedTechnicalStep?.item.key === workItem.item.key;
                          const openDetail = () => {
                            if (workItem.kind === "manual") {
                              onSelectManualControl(workItem.control.id);
                              return;
                            }
                            openTechnicalStep(
                              workItem.item,
                              workItem.status === "verified" ? "verified" : "action",
                            );
                          };
                          const actionLabel =
                            workItem.status === "verified"
                              ? "View evidence"
                              : workItem.resolution === "enable"
                                ? "Enable"
                                : workItem.resolution === "connect"
                                  ? "Connect"
                                  : "Add evidence";
                          let detail = "";
                          if (workItem.kind === "manual") {
                            detail =
                              workItem.status === "verified"
                                ? "Accepted evidence attached"
                                : workItem.hint?.expected ||
                                  workItem.control.description ||
                                  "External evidence required";
                          } else {
                            const resourceData = affectedResourcesForStep(
                              workItem.item.check_ids,
                              openFindingsByCheck,
                              findingCountByCheck,
                            );
                            if (resourceData.kind === "absence") {
                              detail =
                                resourceData.regionCount > 0
                                  ? `${resourceData.regionCount} region${resourceData.regionCount === 1 ? "" : "s"} affected`
                                  : "Account-wide capability";
                            } else {
                              detail =
                                resourceData.resources.length > 0
                                  ? `${resourceData.resources.length} affected resource${resourceData.resources.length === 1 ? "" : "s"}`
                                  : workItem.item.summary;
                            }
                          }

                          return (
                            <button
                              key={workItem.id}
                              type="button"
                              aria-current={isSelected ? "true" : undefined}
                              className={`compliance-checklist__requirement-row is-${workItem.resolution}${
                                isSelected ? " is-selected" : ""
                              }`}
                              onClick={openDetail}
                            >
                              <span className="compliance-checklist__requirement-main">
                                <strong className="compliance-checklist__requirement-title">
                                  {workItem.title}
                                </strong>
                                <span className="compliance-checklist__requirement-meta">
                                  {workItem.criteria.length > 0 ? (
                                    <span>{workItem.criteria.slice(0, 4).join(" · ")}</span>
                                  ) : null}
                                  {workItem.criteria.length > 0 && detail ? <i aria-hidden /> : null}
                                  {detail ? <span title={detail}>{detail}</span> : null}
                                </span>
                              </span>
                              <span
                                className={`compliance-checklist__requirement-action is-${
                                  workItem.status === "verified" ? "verified" : workItem.resolution
                                }`}
                              >
                                {actionLabel} <span aria-hidden>→</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : (
            <p className="compliance-checklist__no-results">
              {statusFilter === "verified"
                ? "No verified requirements match this work type yet."
                : "No open requirements match this work type."}
            </p>
          )}
        </section>
      </div>

      {selectedTechnicalStep ? (
        <ControlDetailPanel
          key={selectedTechnicalStep.item.key}
          tabs={[
            {
              id: CHECKLIST_STEP_TAB,
              label: "Details",
              content: (
                <ChecklistStepDrawerContent
                  item={selectedTechnicalStep.item}
                  accountId={accountId}
                  state={selectedTechnicalStep.state}
                  openFindingsByCheck={openFindingsByCheck}
                  findingCountByCheck={findingCountByCheck}
                />
              ),
            },
          ]}
          activeTab={CHECKLIST_STEP_TAB}
          onTabChange={() => {}}
          onClose={() => setSelectedTechnicalStep(null)}
          headerTitle={selectedTechnicalStep.title}
          headerDescription={selectedTechnicalStep.item.summary}
          headerStatus={
            <div className="control-detail-panel__header-status">
              <ChecklistStepStatusChip state={selectedTechnicalStep.state} />
            </div>
          }
          mode="overlay"
        />
      ) : null}
    </div>
  );
}
