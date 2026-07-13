import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { api } from "../api";
import { frameworkLabel } from "../data/frameworks";
import { howToForCheck } from "../lib/activationRunbooks";
import { auditReadinessSchema } from "../lib/apiSchemas";
import { controlFamily } from "../lib/controlFamilies";
import { openAbsenceGapChecks } from "../lib/evidenceGap";
import { resourceRegionForFinding, resourceShortName } from "../lib/findingDisplay";
import { manualEvidenceHint } from "../lib/manualEvidenceHints";
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
type ChecklistPhaseId = "technical-gaps" | "evidence-required" | "completed";

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
  items: ReadinessPlaybookItem[];
};

type PlaybookGroup = {
  playbook: ReadinessPlaybook;
  items: ReadinessPlaybookItem[];
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

const PHASE_STORAGE_KEY = "veritrail-checklist-open-phases";

const CHECKLIST_PHASES: {
  id: ChecklistPhaseId;
  title: string;
  description: string;
}[] = [
  {
    id: "technical-gaps",
    title: "Technical gaps",
    description: "Capabilities and checks that still need to be enabled or reviewed.",
  },
  {
    id: "evidence-required",
    title: "Evidence required",
    description: "Policies, runbooks, and human processes that need accepted evidence.",
  },
  {
    id: "completed",
    title: "Completed",
    description: "Verified technical controls and externally covered manual criteria.",
  },
];

function groupStorageKey(accountId: string, framework: string) {
  return `veritrail-checklist-open-groups:${accountId}:${framework}`;
}

function readStoredPhaseIds(): Set<ChecklistPhaseId> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PHASE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return new Set(
      parsed.filter((id): id is ChecklistPhaseId =>
        id === "technical-gaps" || id === "evidence-required" || id === "completed",
      ),
    );
  } catch {
    return null;
  }
}

function writeStoredPhaseIds(ids: Set<ChecklistPhaseId>) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(PHASE_STORAGE_KEY, JSON.stringify([...ids]));
}

function readStoredGroupKeys(accountId: string, framework: string): Set<string> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(groupStorageKey(accountId, framework));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((key): key is string => typeof key === "string"));
  } catch {
    return null;
  }
}

function writeStoredGroupKeys(accountId: string, framework: string, keys: Set<string>) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(groupStorageKey(accountId, framework), JSON.stringify([...keys]));
}

function stateForTechnicalItem(status: string): ChecklistState {
  return status === "verified" ? "verified" : "action";
}

function belongsInEnablementChecklist(item: {
  status: string;
  action_kind: "activate" | "review" | null;
  is_enablement: boolean;
}): boolean {
  if (item.status === "action") return item.action_kind === "activate";
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

function affectedResourcesForStep(
  checkIds: string[],
  openFindingsByCheck: Map<string, ChecklistOpenFinding[]>,
): { name: string; region: string }[] {
  const seen = new Set<string>();
  const out: { name: string; region: string }[] = [];
  for (const checkId of checkIds) {
    for (const finding of openFindingsByCheck.get(checkId) ?? []) {
      const name = resourceShortName(finding);
      const region = resourceRegionForFinding(finding);
      const key = `${name}\0${region}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, region });
    }
  }
  return out;
}

function stopRowAction(event: MouseEvent<HTMLElement>) {
  event.stopPropagation();
}

function activateRow(event: KeyboardEvent<HTMLElement>, action: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

function ChecklistGroupChip({
  tone,
  label,
}: {
  tone: "amber" | "violet" | "green";
  label: string;
}) {
  return (
    <span className={`compliance-checklist__group-chip is-${tone}`}>
      {label}
    </span>
  );
}

function ChecklistCcChips({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <div className="compliance-checklist__cc-chips">
      {ids.slice(0, 4).map((id) => (
        <span key={id} className="compliance-checklist__cc-chip">
          {id}
        </span>
      ))}
    </div>
  );
}

function CopyCliButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className="compliance-checklist__cli-block">
      <div className="compliance-checklist__cli-toolbar">
        <button type="button" className="compliance-checklist__cli-copy" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="compliance-checklist__cli-code">
        <code>{code}</code>
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
  const resources = affectedResourcesForStep(item.check_ids, openFindingsByCheck);
  const primaryCheck = primaryCheckForHowTo(item.check_ids, findingCountByCheck);
  const howTo = primaryCheck ? howToForCheck(primaryCheck) : null;

  return (
    <div className="control-detail-stack checklist-step-drawer">
      {howTo ? (
        <section className="control-detail-section">
          <div className="control-detail-section__head">
            <h3 className="control-detail-section__title">How to</h3>
          </div>
          <p className="checklist-step-drawer__console-path">{howTo.consolePath}</p>
          {howTo.cli ? <CopyCliButton code={howTo.cli} /> : null}
        </section>
      ) : null}

      {state === "action" ? (
        <section className="control-detail-section">
          <div className="control-detail-section__head">
            <h3 className="control-detail-section__title">Actions</h3>
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

      <section className="control-detail-section">
        <div className="control-detail-section__head">
          <h3 className="control-detail-section__title">
            Affected resources ({resources.length})
          </h3>
        </div>
        {resources.length > 0 ? (
          <ul className="checklist-step-drawer__resource-list">
            {resources.map((resource) => (
              <li key={`${resource.name}:${resource.region}`}>
                <span className="checklist-step-drawer__resource-name">{resource.name}</span>
                <span className="checklist-step-drawer__resource-region">{resource.region}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="checklist-step-drawer__muted">No open findings on mapped checks.</p>
        )}
      </section>
    </div>
  );
}

function phaseVisibleInPhase(phase: ChecklistPhaseId, state: ChecklistState): boolean {
  if (phase === "technical-gaps") return state === "action";
  if (phase === "evidence-required") return state === "manual";
  return state === "verified";
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
  const [expandedPhases, setExpandedPhases] = useState<Set<ChecklistPhaseId>>(() => {
    return readStoredPhaseIds() ?? new Set();
  });
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    return readStoredGroupKeys(accountId, framework) ?? new Set();
  });
  const [selectedTechnicalStep, setSelectedTechnicalStep] =
    useState<SelectedTechnicalStep | null>(null);
  const [autoExpandedPhases, setAutoExpandedPhases] = useState(false);

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

  const technicalItems = useMemo(
    () =>
      (readinessQ.data?.playbooks ?? []).flatMap((playbook) =>
        playbook.items
          .filter(
            (item) =>
              item.status !== "not_applicable" &&
              item.status !== "not_assessed" &&
              belongsInEnablementChecklist(item),
          )
          .map((item) => ({
            item,
            state: stateForTechnicalItem(item.status),
          })),
      ),
    [readinessQ.data],
  );

  const counts = useMemo(() => {
    const result: Record<ChecklistState, number> = { verified: 0, action: 0, manual: 0 };
    for (const row of technicalItems) result[row.state] += 1;
    for (const control of manualControls) {
      result[acceptedControlIds.has(control.id) ? "verified" : "manual"] += 1;
    }
    return result;
  }, [acceptedControlIds, manualControls, technicalItems]);

  const total = counts.verified + counts.action + counts.manual;
  const remaining = counts.action + counts.manual;
  const verifiedPct = total > 0 ? Math.round((counts.verified / total) * 100) : 0;

  const playbooksByPhase = useMemo(() => {
    const result: Record<ChecklistPhaseId, PlaybookGroup[]> = {
      "technical-gaps": [],
      "evidence-required": [],
      completed: [],
    };

    for (const playbook of readinessQ.data?.playbooks ?? []) {
      for (const phase of CHECKLIST_PHASES) {
        const items = playbook.items.filter((item) => {
          if (item.status === "not_applicable" || item.status === "not_assessed") return false;
          if (!belongsInEnablementChecklist(item)) return false;
          return phaseVisibleInPhase(phase.id, stateForTechnicalItem(item.status));
        });
        if (items.length > 0) {
          result[phase.id].push({ playbook, items });
        }
      }
    }

    for (const phase of CHECKLIST_PHASES) {
      result[phase.id].sort((a, b) => {
        const aUnmet = a.items.filter(
          (item) => stateForTechnicalItem(item.status) === "action",
        ).length;
        const bUnmet = b.items.filter(
          (item) => stateForTechnicalItem(item.status) === "action",
        ).length;
        return bUnmet - aUnmet;
      });
    }

    return result;
  }, [readinessQ.data]);

  const manualControlsByPhase = useMemo(() => {
    const result: Record<ChecklistPhaseId, ChecklistControl[]> = {
      "technical-gaps": [],
      "evidence-required": manualControls.filter(
        (control) => !acceptedControlIds.has(control.id),
      ),
      completed: manualControls.filter((control) => acceptedControlIds.has(control.id)),
    };
    return result;
  }, [acceptedControlIds, manualControls]);

  const phaseCounts = useMemo(
    () => ({
      "technical-gaps": counts.action,
      "evidence-required": counts.manual,
      completed: counts.verified,
    }),
    [counts],
  );

  const firstOpenPhase = useMemo((): ChecklistPhaseId | null => {
    for (const phase of CHECKLIST_PHASES) {
      const hasPlaybooks = playbooksByPhase[phase.id].length > 0;
      const hasManual = manualControlsByPhase[phase.id].length > 0;
      if (hasPlaybooks || hasManual) return phase.id;
    }
    return null;
  }, [manualControlsByPhase, playbooksByPhase]);

  useEffect(() => {
    setExpandedGroups(readStoredGroupKeys(accountId, framework) ?? new Set());
    setSelectedTechnicalStep(null);
  }, [accountId, framework]);

  useEffect(() => {
    if (!readinessQ.isSuccess || autoExpandedPhases) return;
    if (readStoredPhaseIds()) {
      setAutoExpandedPhases(true);
      return;
    }
    if (!firstOpenPhase) {
      setAutoExpandedPhases(true);
      return;
    }
    const next = new Set<ChecklistPhaseId>([firstOpenPhase]);
    setExpandedPhases(next);
    writeStoredPhaseIds(next);
    setAutoExpandedPhases(true);
  }, [autoExpandedPhases, firstOpenPhase, readinessQ.isSuccess]);

  const togglePhase = (phaseId: ChecklistPhaseId) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      writeStoredPhaseIds(next);
      return next;
    });
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeStoredGroupKeys(accountId, framework, next);
      return next;
    });
  };

  const openTechnicalStep = (item: ReadinessPlaybookItem, state: ChecklistState) => {
    const title = state === "action" ? item.activation_label || item.label : item.label;
    setSelectedTechnicalStep({ item, title, state });
  };

  const renderPlaybookGroups = (phaseId: ChecklistPhaseId, playbooks: PlaybookGroup[]) =>
    playbooks.map(({ playbook, items }) => {
      const allPlaybookItems = playbook.items.filter((item) => {
        if (item.status === "not_applicable" || item.status === "not_assessed") return false;
        return belongsInEnablementChecklist(item);
      });
      const unmetCount = allPlaybookItems.filter(
        (item) => stateForTechnicalItem(item.status) === "action",
      ).length;
      const groupKey = `${phaseId}:${playbook.key}`;
      const isExpanded = expandedGroups.has(groupKey);

      return (
        <div
          key={groupKey}
          className={`compliance-control-card compliance-checklist__group${isExpanded ? " is-expanded" : ""}`}
        >
          <button
            type="button"
            className="compliance-control-card__summary"
            aria-expanded={isExpanded}
            onClick={() => toggleGroup(groupKey)}
          >
            <div className="compliance-control-card__main">
              <span
                className={`compliance-control-card__chevron${isExpanded ? " is-open" : ""}`}
                aria-hidden
              >
                ›
              </span>
              <div className="compliance-control-card__title">
                <h3>{playbook.label}</h3>
                <p>{playbook.question}</p>
              </div>
            </div>
            <div className="compliance-control-card__state">
              <ChecklistGroupChip
                tone={unmetCount > 0 ? "amber" : "green"}
                label={unmetCount > 0 ? `${unmetCount} unmet` : "Complete"}
              />
            </div>
          </button>

          {isExpanded ? (
            <div className="compliance-checklist__group-rows">
              {items.map((item) => {
                const state = stateForTechnicalItem(item.status);
                const title =
                  state === "action"
                    ? item.activation_label || item.label
                    : item.label;
                const openDetail = () => openTechnicalStep(item, state);

                return (
                  <div
                    key={item.key}
                    role="button"
                    tabIndex={0}
                    className="compliance-checklist__item-row"
                    onClick={openDetail}
                    onKeyDown={(event) => activateRow(event, openDetail)}
                  >
                    <span className={`compliance-checklist__state is-${state}`} aria-hidden />
                    <div className="compliance-checklist__item-main">
                      <div className="compliance-checklist__item-line">
                        <strong title={title}>{title}</strong>
                        <ChecklistCcChips ids={item.controls} />
                      </div>
                    </div>
                    {state === "action" ? (
                      item.action_kind === "activate" && item.action_url ? (
                        <a
                          className="compliance-checklist__item-action"
                          onClick={stopRowAction}
                          href={item.action_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Enable
                        </a>
                      ) : (
                        <Link
                          className="compliance-checklist__item-action"
                          onClick={stopRowAction}
                          to={findingsHref(item.check_ids, accountId)}
                        >
                          Review
                        </Link>
                      )
                    ) : phaseId === "completed" ? (
                      <span className="compliance-checklist__externally-covered-label">
                        Verified
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      );
    });

  const renderManualGroup = (phaseId: ChecklistPhaseId, visibleManualControls: ChecklistControl[]) => {
    if (visibleManualControls.length === 0) return null;

    const manualUnmetCount = manualControls.filter(
      (control) => !acceptedControlIds.has(control.id),
    ).length;
    const groupKey = `${phaseId}:manual-evidence`;
    const isExpanded = expandedGroups.has(groupKey);

    return (
      <div
        className={`compliance-control-card compliance-checklist__group compliance-checklist__group--manual${
          isExpanded ? " is-expanded" : ""
        }`}
      >
        <button
          type="button"
          className="compliance-control-card__summary"
          aria-expanded={isExpanded}
          onClick={() => toggleGroup(groupKey)}
        >
          <div className="compliance-control-card__main">
            <span
              className={`compliance-control-card__chevron${isExpanded ? " is-open" : ""}`}
              aria-hidden
            >
              ›
            </span>
            <div className="compliance-control-card__title">
              <h3>Policies and human processes</h3>
              <p>Do your policies, runbooks, exercises, and approvals have current evidence?</p>
            </div>
          </div>
          <div className="compliance-control-card__state">
            <ChecklistGroupChip
              tone={phaseId === "completed" ? "green" : manualUnmetCount > 0 ? "violet" : "green"}
              label={
                phaseId === "completed"
                  ? "Complete"
                  : manualUnmetCount > 0
                    ? `${manualUnmetCount} evidence required`
                    : "Complete"
              }
            />
          </div>
        </button>

        {isExpanded ? (
          <div className="compliance-checklist__group-rows">
            {visibleManualControls.map((control) => {
              const accepted = acceptedControlIds.has(control.id);
              const state: ChecklistState = accepted ? "verified" : "manual";
              const selected = selectedControlId === control.id;
              const openDetail = () => onSelectManualControl(control.id);
              const hint = manualEvidenceHint(framework, control.control_id);

              return (
                <div
                  key={control.id}
                  role="button"
                  tabIndex={0}
                  aria-current={selected ? "true" : undefined}
                  className={`compliance-checklist__item-row compliance-checklist__item-row--manual${
                    selected ? " is-selected" : ""
                  }`}
                  onClick={openDetail}
                  onKeyDown={(event) => activateRow(event, openDetail)}
                >
                  <span className={`compliance-checklist__state is-${state}`} aria-hidden />
                  <div className="compliance-checklist__item-main">
                    <div className="compliance-checklist__item-line">
                      <strong title={control.title}>{control.title}</strong>
                      <ChecklistCcChips ids={[control.control_id]} />
                    </div>
                    {!accepted && hint ? (
                      <small className="compliance-checklist__evidence-hint">
                        <b>Evidence:</b> {hint.expected}
                        {hint.integration ? (
                          <>
                            {" "}
                            <Link
                              to={hint.integration.href}
                              onClick={stopRowAction}
                              className="compliance-checklist__evidence-hint-link"
                            >
                              {hint.integration.label} <span aria-hidden>→</span>
                            </Link>
                          </>
                        ) : null}
                      </small>
                    ) : null}
                    {accepted ? (
                      <small className="compliance-checklist__externally-covered">
                        Externally covered — accepted evidence attached
                      </small>
                    ) : null}
                  </div>
                  <div className="compliance-checklist__item-actions">
                    {accepted && phaseId === "completed" ? (
                      <span className="compliance-checklist__externally-covered-label">
                        Externally covered
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="compliance-checklist__item-action"
                      onClick={(event) => {
                        stopRowAction(event);
                        openDetail();
                      }}
                    >
                      {accepted ? "View evidence" : "Attach evidence"}
                    </button>
                  </div>
                </div>
              );
            })}
            {phaseId === "evidence-required" ? (
              <p className="compliance-checklist__scope-note">
                Program-level criteria without automated coverage (CC1–CC5, CC9) belong to your
                GRC platform — Veritrail collects what it can't see.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
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
      <section className="compliance-checklist__intro">
        <div className="compliance-checklist__intro-copy">
          <p className="compliance-checklist__eyebrow">
            {frameworkLabel(framework)} checklist
          </p>
          <h1>{frameworkLabel(framework)} technical readiness</h1>
          <p>
            {remaining > 0
              ? `${remaining} requirement${remaining === 1 ? "" : "s"} still ${remaining === 1 ? "needs" : "need"} action or evidence before the mapped criteria are audit-ready.`
              : "All mapped requirements are verified."}
          </p>
          <p className="compliance-checklist__honesty">
            <span aria-hidden>ⓘ</span>
            Automated checks verify technical controls; policies and processes count only after evidence is accepted.
          </p>
        </div>
        <div className="compliance-checklist__intro-side">
          <div
            className="compliance-checklist__progress"
            aria-label={`${counts.verified} of ${total} requirements verified`}
          >
            <span className="compliance-checklist__progress-label">
              <strong>{counts.verified}</strong>
              <span> of {total || "—"} verified</span>
            </span>
            <div
              className="compliance-checklist__progress-bar"
              role="progressbar"
              aria-valuenow={counts.verified}
              aria-valuemin={0}
              aria-valuemax={total || 1}
            >
              <span style={{ width: `${verifiedPct}%` }} />
            </div>
          </div>
          {action ? <div className="compliance-checklist__export">{action}</div> : null}
        </div>
      </section>

      <div className="compliance-checklist__phases">
        {CHECKLIST_PHASES.map((phase) => {
          const playbooks = playbooksByPhase[phase.id];
          const manualRows = manualControlsByPhase[phase.id];
          const count = phaseCounts[phase.id];
          const isExpanded = expandedPhases.has(phase.id);
          const hasContent = playbooks.length > 0 || manualRows.length > 0;

          return (
            <section
              key={phase.id}
              className={`compliance-checklist__phase compliance-control-card${
                isExpanded ? " is-expanded" : ""
              }`}
            >
              <button
                type="button"
                className="compliance-checklist__phase-summary compliance-control-card__summary"
                aria-expanded={isExpanded}
                onClick={() => togglePhase(phase.id)}
              >
                <div className="compliance-control-card__main">
                  <span
                    className={`compliance-control-card__chevron${isExpanded ? " is-open" : ""}`}
                    aria-hidden
                  >
                    ›
                  </span>
                  <div className="compliance-control-card__title">
                    <h2>{phase.title}</h2>
                    <p>{phase.description}</p>
                  </div>
                </div>
                <div className="compliance-control-card__state">
                  <ChecklistGroupChip
                    tone={
                      phase.id === "completed"
                        ? "green"
                        : phase.id === "evidence-required"
                          ? count > 0
                            ? "violet"
                            : "green"
                          : count > 0
                            ? "amber"
                            : "green"
                    }
                    label={
                      phase.id === "completed"
                        ? count > 0
                          ? `${count} complete`
                          : "Complete"
                        : count > 0
                          ? `${count} remaining`
                          : "Complete"
                    }
                  />
                </div>
              </button>

              {isExpanded ? (
                <div className="compliance-checklist__phase-body">
                  {hasContent ? (
                    <div className="compliance-checklist__groups">
                      {renderPlaybookGroups(phase.id, playbooks)}
                      {renderManualGroup(phase.id, manualRows)}
                    </div>
                  ) : (
                    <p className="compliance-checklist__no-results">
                      {phase.id === "technical-gaps"
                        ? "No capabilities currently need to be enabled."
                        : phase.id === "evidence-required"
                          ? "No evidence is currently required."
                          : "No enabled capabilities or accepted evidence yet."}
                    </p>
                  )}
                </div>
              ) : null}
            </section>
          );
        })}
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
