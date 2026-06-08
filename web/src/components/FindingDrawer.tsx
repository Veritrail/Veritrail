import { useState, useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useAppScrollLock } from "../lib/useAppScrollLock";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, formatApiError } from "../api";
import AwsServiceIcon from "./AwsServiceIcon";
import { IaCRemediationSection } from "./IaCRemediationSection";
import { useRemediationExecution } from "../hooks/useRemediationExecution";
import { DrawerDateField } from "./DrawerDateField";
import { todayIso } from "../lib/isoDate";
import {
  drawerBody,
  drawerFieldLabel,
  drawerPanel,
  drawerSectionBody,
  drawerSectionHead,
  drawerSectionTitle,
  drawerSummaryLabel,
  drawerSummaryValue,
  drawerSummaryValueStrong,
} from "./drawerStyles";
import {
  credentialUnusedFrameworkImpact,
  type CredentialFrameworkImpactItem,
} from "../data/credentialFrameworkImpact";
import { frameworkLabel } from "../data/frameworks";
import { showWhatIfTab, whatIfUnavailableReason } from "../data/blastRadiusChecks";
import { checkLabels } from "../data/checkLabels";
import { documentationForCheck } from "../data/checkDocumentation";
import { DEFAULT_EVIDENCE_GUIDANCE } from "../data/checkComplianceCopy";
import { policyGenerationReasonLabel } from "../data/policyGenerationCopy";
import {
  formatCloudTrailStartFeedback,
  friendlyPolicyGenerationError,
} from "../lib/policyGenerationErrors";
import { useRecheckNotifications } from "../context/RecheckNotificationsContext";
import { remediationSummaryForFinding } from "../data/remediationSummaries";
import {
  formatFindingSeenAt,
  awsRegionFromArn,
  regionsFromFindingEvidence,
  filterRedundantResourceDetailRows,
  resourceDetailRowsFromFinding,
  resourceDisplayName,
  resourceIdentifierLabel,
  resourceIdentifierValue,
  resourceRegionForFinding,
  isAwsRootFinding,
  isVcsResourceIdentifier,
  severityLabel,
  severityPillClassName,
  formatIamServiceDisplayName,
} from "../lib/findingDisplay";
import {
  applyCliPlaceholders,
  buildCliPlaceholders,
  fetchClientIpForRemediation,
  formatCliStepSpacing,
  injectEc2RegionFlags,
} from "../lib/cliRemediation";
import {
  BlastRadiusConsiderations,
  RolePoliciesAnalysis,
  RoleServiceUsageAnalysis,
  RoleTrustPrincipals,
} from "./BlastRadiusPanel";
import {
  ImpactAnalysisEmpty,
  ImpactAnalysisShell,
  ImpactReportEmpty,
  ImpactReportTabs,
  ImpactUsageStats,
  ImpactVerdictCard,
  type ImpactReportTab,
} from "./ImpactAnalysisPanel";
import { bucketServicesByUsage } from "../lib/blastRadiusDisplay";
import {
  impactConfidencePill,
  impactVerdictCopy,
  impactVisualTone,
} from "../lib/impactAnalysisDisplay";
import "../styles/impact-analysis.css";
import "../styles/policy-review.css";
import {
  DrawerFlowLabel,
  ExceptionFlowPanel,
  FlowBadge,
  FlowCallout,
  PostureMetricCell,
  PostureMetricsRow,
  ResourceFieldRow,
  ResourceGroup,
  SemanticNarrativeBlock,
} from "./FindingDrawerSemantic";

const DRAWER_MAX_W = "max-w-[640px]";
const DRAWER_WIDE_MAX_W = "max-w-[min(96vw,1180px)]";
const DRAWER_POLICY_TRIPLE_MAX_W = "max-w-[min(98vw,1620px)]";
/** Left rail · analysis · review — keep the remediation picker readable. */
const DRAWER_POLICY_TRIPLE_GRID =
  "grid min-h-0 flex-1 grid-cols-[minmax(300px,30%)_minmax(320px,0.68fr)_minmax(400px,0.75fr)] overflow-hidden border-t border-zinc-200/80";

/** Resource label in drawer header (matches drawerFieldLabel). */
const drawerFieldLabelBlock = drawerFieldLabel;
const drawerFooterCardBase =
  "relative flex min-h-[4.25rem] min-w-0 flex-1 items-center justify-between gap-3 rounded-lg border bg-white px-4 py-3 transition hover:shadow-sm active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50";
const drawerFooterReopen = `${drawerFooterCardBase} w-full justify-center border-zinc-200 bg-zinc-50/80 text-[13px] font-semibold text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50`;
const drawerFooterActionBase =
  "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-[13px] font-semibold transition-all duration-150 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60";
const drawerFooterVerifyPrimary = `${drawerFooterActionBase} flex-[1.2] bg-[#059669] text-white shadow-[0_6px_16px_rgba(5,150,105,0.16)] hover:bg-[#047857] hover:shadow-[0_8px_18px_rgba(4,120,87,0.18)]`;
const drawerFooterVerifySoft = `${drawerFooterActionBase} flex-1 border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100/70`;
const drawerFooterExceptionGhost = `${drawerFooterActionBase} flex-[0.8] border border-zinc-200 bg-white text-zinc-600 shadow-sm shadow-zinc-900/[0.02] hover:border-amber-200 hover:bg-amber-50/60 hover:text-amber-700`;

function DrawerChevronButton({
  expanded,
  title,
  onClick,
}: {
  expanded: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-all duration-150 hover:bg-zinc-100 hover:text-zinc-700 active:scale-95"
      aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
      aria-expanded={expanded}
    >
      <svg
        className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

function DrawerSection({
  title,
  children,
  action,
  className = "",
  collapsible = false,
  defaultExpanded = true,
  expanded: expandedProp,
  onExpandedChange,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [expandedInternal, setExpandedInternal] = useState(defaultExpanded);
  const expanded = expandedProp ?? expandedInternal;
  const setExpanded = onExpandedChange ?? setExpandedInternal;
  const showBody = !collapsible || expanded;

  return (
    <div className={`${drawerPanel} ${className}`}>
      <div className={`${drawerSectionHead} flex items-center justify-between gap-2`}>
        <h3 className={drawerSectionTitle}>{title}</h3>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {collapsible && (
            <DrawerChevronButton
              expanded={expanded}
              title={title}
              onClick={() => setExpanded(!expanded)}
            />
          )}
        </div>
      </div>
      {showBody && children}
    </div>
  );
}

export type FindingRemediationMode =
  | "console"
  | "cli"
  | "terraform"
  | "automation"
  | "suggested_policy";

type RemediationMode = FindingRemediationMode;

const SG_AUTOMATION_ONLY_CHECKS = new Set([
  "ec2.security_group.unrestricted_ssh",
  "ec2.security_group.unrestricted_rdp",
]);

const NO_CLI_REMEDIATION_CHECKS = new Set(["iam.user.no_mfa"]);

export function defaultFindingRemediationMode(checkId: string): FindingRemediationMode {
  return SG_AUTOMATION_ONLY_CHECKS.has(checkId) ? "automation" : "console";
}

const REMEDIATION_MODE_LABELS: Record<RemediationMode, string> = {
  console: "Console",
  cli: "CLI",
  terraform: "Terraform",
  automation: "Automated fix",
  suggested_policy: "Suggested policy",
};

function RemediationModeIcon({ mode }: { mode: RemediationMode }) {
  const cls = "h-5 w-5 shrink-0";
  if (mode === "console") {
    return (
      <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    );
  }
  if (mode === "cli") {
    return (
      <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }
  if (mode === "terraform") {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 2 2 7v10l10 5 10-5V7L12 2zm0 2.2 7.5 3.75v7.5L12 19.3 4.5 15.45v-7.5L12 4.2z" opacity={0.35} />
        <path d="M12 6.5 6.5 9.25v5.5L12 17.5l5.5-2.75v-5.5L12 6.5z" />
      </svg>
    );
  }
  if (mode === "suggested_policy") {
    return (
      <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
    );
  }
  return (
    <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
    </svg>
  );
}

function RemediationModePicker({
  active,
  onSelect,
  hideTerraform,
  showSuggestedPolicy,
}: {
  active: RemediationMode | null;
  onSelect: (mode: RemediationMode) => void;
  hideTerraform?: boolean;
  showSuggestedPolicy?: boolean;
}) {
  const modes: RemediationMode[] = [
    "console",
    ...(showSuggestedPolicy ? (["suggested_policy"] as RemediationMode[]) : []),
    "cli",
    ...(hideTerraform ? [] : (["terraform"] as RemediationMode[])),
    "automation",
  ];
  return (
    <div className={`${drawerPanel} overflow-hidden`}>
      <div className={drawerSectionHead}>
        <h3 className={drawerSectionTitle}>Generate remediation steps for</h3>
      </div>
      <div className={`${drawerSectionBody} grid grid-cols-3 gap-2`}>
        {modes.map((mode) => {
          const selected = active === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onSelect(mode)}
              className={`flex min-h-[4.75rem] flex-col items-center justify-center gap-2 rounded-xl border px-2 py-3 text-center transition-all duration-150 ${
                selected
                  ? "border-indigo-300 bg-indigo-50/80 text-indigo-950 shadow-sm ring-2 ring-indigo-200/80"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50/80"
              }`}
            >
              <RemediationModeIcon mode={mode} />
              <span className="text-[13px] font-semibold leading-snug tracking-[-0.01em]">
                {REMEDIATION_MODE_LABELS[mode]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SuggestedRemediationSummary({
  rem,
  policyMode = false,
}: {
  rem: Remediation;
  policyMode?: boolean;
}) {
  const summary = policyMode
    ? "Replace full-admin access with a scoped least-privilege policy generated from observed usage."
    : rem.why;

  return (
    <div className={`${drawerPanel} overflow-hidden`}>
      <div className={drawerSectionHead}>
        <h3 className={drawerSectionTitle}>Suggested remediation</h3>
      </div>
      <div className={`${drawerSectionBody} space-y-2`}>
        <p className="text-[13px] leading-relaxed text-zinc-600">{summary}</p>
        {!policyMode && rem.risk ? <p className="text-[12px] leading-relaxed text-zinc-500">{rem.risk}</p> : null}
      </div>
    </div>
  );
}

function RemediationDetailCard({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`${drawerPanel} overflow-hidden ${className}`}>
      <div className={`${drawerSectionHead} flex items-center justify-between gap-3`}>
        <h4 className={drawerSectionTitle}>{title}</h4>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className={drawerSectionBody}>{children}</div>
    </div>
  );
}

function RemediationDetailPanel({
  mode,
  onClose,
  children,
}: {
  mode: RemediationMode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-zinc-200/90 bg-[#f7f9fc]">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[#e6ebf2] bg-white px-6 py-4 shadow-sm shadow-zinc-950/[0.03]">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-200/90 bg-indigo-50 text-indigo-700 shadow-sm shadow-indigo-900/[0.04]">
            <RemediationModeIcon mode={mode} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400">Remediation</p>
            <h3 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-zinc-900">
              {REMEDIATION_MODE_LABELS[mode]}
            </h3>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-zinc-200 bg-white p-2 text-zinc-400 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-700"
          aria-label="Close remediation details"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="space-y-5">{children}</div>
      </div>
    </div>
  );
}

function PolicyViewToggle<T extends string>({
  options,
  value,
  onChange,
  formatLabel,
  variant = "light",
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  formatLabel?: (v: T) => string;
  variant?: "light" | "dark";
}) {
  const shell = variant === "dark" ? "rounded-md bg-zinc-800/90 p-0.5" : "rounded-lg bg-zinc-100/90 p-0.5";
  const active =
    variant === "dark"
      ? "bg-zinc-600 text-white shadow-sm"
      : "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-900/5";
  const idle = variant === "dark" ? "text-zinc-400 hover:text-zinc-200" : "text-zinc-600 hover:text-zinc-800";

  return (
    <div className={`inline-flex shrink-0 gap-0.5 ${shell}`}>
      {options.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1 text-[12px] font-medium transition-all duration-150 ${
            value === v ? active : idle
          }`}
        >
          {formatLabel ? formatLabel(v) : v.charAt(0).toUpperCase() + v.slice(1)}
        </button>
      ))}
    </div>
  );
}

function awsAccountIdFromArn(arn: string): string | null {
  const m = arn.match(/^arn:aws:[^:]+::(\d{12}):/);
  return m ? m[1] : null;
}

function SelectedResourceInspector({ finding }: { finding: Finding }) {
  const accountId = awsAccountIdFromArn(finding.resource_arn);
  const ev = finding.evidence;
  const isUnusedRoleFinding = finding.check_id === "iam.role.unused_services_90d";
  const unusedCount = (ev.unused_services as string[] | undefined)?.length;
  const totalGranted = ev.total_granted_services as number | undefined;
  const thresholdDays = ev.threshold_days as number | undefined;
  const withRecordedUse =
    totalGranted != null && unusedCount != null ? Math.max(0, totalGranted - unusedCount) : null;
  const fieldDetailRows = filterRedundantResourceDetailRows(
    resourceDetailRowsFromFinding(finding),
    finding,
  );
  const exposingRules = Array.isArray(ev.exposing_rules) ? (ev.exposing_rules as Record<string, unknown>[]) : [];
  const affectedRegions = regionsFromFindingEvidence(ev);
  const affectedRegionsLabel =
    finding.check_id === "aws.access_analyzer.not_enabled"
      ? "Regions without Access Analyzer"
      : finding.check_id === "guardduty.detector.not_enabled"
        ? "Regions without GuardDuty"
        : finding.check_id === "aws.securityhub.not_enabled"
          ? "Regions without Security Hub"
          : finding.check_id === "aws.config.not_enabled"
            ? "Regions without full Config recording"
            : "Affected regions";

  const statusLabel = finding.status.replace(/_/g, " ");
  const riskTone =
    finding.severity === "critical" || finding.severity === "high"
      ? "text-red-700"
      : finding.severity === "medium"
        ? "text-amber-700"
        : "text-zinc-800";

  const showFieldList =
    fieldDetailRows.length > 0 ||
    accountId != null ||
    !isVcsResourceIdentifier(finding.resource_arn);

  const identifierValue = resourceIdentifierValue(finding);
  const identifierHref = isVcsResourceIdentifier(finding.resource_arn) ? identifierValue : null;
  const rootInspector = isAwsRootFinding(finding);

  const timelineBlock = (
    <div className="border-t border-zinc-100 bg-white px-4 pb-1.5 pt-3">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Finding timeline</p>
      <dl>
        <ResourceFieldRow label="Risk score">
          <span className={`font-semibold ${riskTone}`}>{finding.risk_score}</span>
        </ResourceFieldRow>
        <ResourceFieldRow label="Status">
          <span className="capitalize">{statusLabel}</span>
        </ResourceFieldRow>
        <ResourceFieldRow label="First seen">{formatFindingSeenAt(finding.first_seen)}</ResourceFieldRow>
        <ResourceFieldRow label="Last seen">{formatFindingSeenAt(finding.last_seen)}</ResourceFieldRow>
      </dl>
    </div>
  );

  if (rootInspector) {
    return (
      <div className={`${drawerPanel} overflow-hidden`}>
        <div className={drawerSectionHead}>
          <h3 className={drawerSectionTitle}>Resource details</h3>
        </div>
        <dl className="border-b border-zinc-100 bg-white px-4 py-0.5">
          {accountId ? (
            <ResourceFieldRow label="Account">{accountId}</ResourceFieldRow>
          ) : null}
          <ResourceFieldRow label="ARN" mono>
            {identifierValue}
          </ResourceFieldRow>
        </dl>
        {timelineBlock}
      </div>
    );
  }

  return (
    <div className={`${drawerPanel} overflow-hidden`}>
      <div className={drawerSectionHead}>
        <h3 className={drawerSectionTitle}>Resource details</h3>
      </div>

      {showFieldList && (
        <dl className="border-b border-zinc-100 bg-white px-4 py-1 pt-3">
          {fieldDetailRows.map((row) => (
            <ResourceFieldRow key={row.label} label={row.label} mono={row.mono}>
              {row.value}
            </ResourceFieldRow>
          ))}
          {accountId && <ResourceFieldRow label="Account">{accountId}</ResourceFieldRow>}
          <ResourceFieldRow label={resourceIdentifierLabel(finding.resource_arn)} mono>
            {identifierHref?.startsWith("http") ? (
              <a
                href={identifierHref}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#1f4e79] hover:underline"
              >
                {identifierHref}
              </a>
            ) : (
              identifierValue
            )}
          </ResourceFieldRow>
        </dl>
      )}

      {exposingRules.length > 0 && (
        <ResourceGroup title={`Public ingress (${exposingRules.length})`}>
          <ul className="space-y-1.5">
            {exposingRules.map((rule, i) => {
              const proto = String(rule.protocol ?? "tcp");
              const from = rule.from_port as number | null | undefined;
              const to = rule.to_port as number | null | undefined;
              const cidr = String(rule.cidr ?? "0.0.0.0/0");
              const portLabel =
                proto === "all" || from == null || to == null
                  ? "all ports"
                  : from === to
                    ? `${from}`
                    : `${from}–${to}`;
              return (
                <li
                  key={`${cidr}-${portLabel}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-red-100/80 bg-red-50/50 px-2.5 py-1.5 text-[11px]"
                >
                  <span className="font-mono text-zinc-800">
                    {proto.toUpperCase()} {portLabel}
                  </span>
                  <span className="shrink-0 font-mono text-red-800/90">{cidr}</span>
                </li>
              );
            })}
          </ul>
        </ResourceGroup>
      )}

      {affectedRegions.length > 0 && (
        <ResourceGroup title={`${affectedRegionsLabel} (${affectedRegions.length})`}>
          <RegionPills regions={affectedRegions} />
        </ResourceGroup>
      )}

      {isUnusedRoleFinding && totalGranted != null && (
        <ResourceGroup title="Permission usage">
          <PostureMetricsRow>
            <PostureMetricCell label="Granted" value={totalGranted} variant="compact" />
            <PostureMetricCell
              label="In use"
              value={withRecordedUse ?? "—"}
              valueClassName="text-emerald-700"
              variant="compact"
            />
            <PostureMetricCell
              label="Unused 90d+"
              value={unusedCount ?? "—"}
              valueClassName="text-zinc-700"
              variant="compact"
            />
            <PostureMetricCell
              label="Window"
              value={thresholdDays != null ? `${thresholdDays}d` : "—"}
              variant="compact"
            />
          </PostureMetricsRow>
        </ResourceGroup>
      )}

      {timelineBlock}
    </div>
  );
}

type Finding = {
  id: string;
  check_id: string;
  resource_arn: string;
  title: string;
  severity: string;
  risk_score: number;
  status: string;
  evidence: Record<string, unknown>;
  first_seen: string;
  last_seen: string;
  exception_reason?: string | null;
  exception_approved_by?: string | null;
  exception_expires_at?: string | null;
};

const sevHeaderBadge: Record<string, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  high: "bg-red-50 text-red-600 border-red-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-zinc-100 text-zinc-500 border-zinc-200",
};

const sevWash: Record<string, string> = {
  critical: "from-red-100 to-stone-50",
  high: "from-red-50 to-stone-50",
  medium: "from-amber-50 to-stone-50",
  low: "from-slate-50 to-stone-50",
};

const sevStep: Record<string, string> = {
  critical: "bg-stone-700 text-white",
  high: "bg-stone-700 text-white",
  medium: "bg-stone-700 text-white",
  low: "bg-stone-700 text-white",
};

type Remediation = {
  why: string;
  console: string[];
  cli?: string;
  risk: string;
};

function frameworkCompact(framework: string): string {
  if (framework === "soc2") return "SOC2";
  if (framework === "cis_aws_l1") return "CIS AWS";
  if (framework === "iso27001") return "ISO 27001";
  return frameworkLabel(framework);
}

function OverviewSummaryRow({
  label,
  children,
  emphasis = false,
  valueClassName,
}: {
  label: string;
  children: ReactNode;
  emphasis?: boolean;
  valueClassName?: string;
}) {
  const valueBase = emphasis ? drawerSummaryValueStrong : drawerSummaryValue;
  return (
    <div className="grid grid-cols-[6.75rem_1fr] gap-x-4 border-b border-[#eef2f6] px-4 py-3 last:border-b-0 sm:grid-cols-[7.25rem_1fr]">
      <dt className={drawerSummaryLabel}>{label}</dt>
      <dd className={valueClassName ? `${valueBase} ${valueClassName}` : valueBase}>{children}</dd>
    </div>
  );
}

function FrameworkThresholdCard({ item }: { item: CredentialFrameworkImpactItem }) {
  const isCis = item.isActive;
  return (
    <div
      className={`flex flex-col rounded-xl px-3 py-2.5 ring-1 ${
        isCis
          ? "bg-gradient-to-b from-amber-50/95 to-amber-50/40 ring-amber-200/80"
          : "bg-white ring-zinc-200/80"
      }`}
    >
      <p className={`text-[13px] font-semibold leading-tight ${isCis ? "text-amber-950" : "text-zinc-900"}`}>
        {item.framework}
        {item.control ? <span className="font-medium text-zinc-500"> {item.control}</span> : null}
      </p>
      <p className="mt-1.5 text-[12px] font-medium text-zinc-700">Fails at {item.thresholdDays}+ days</p>
      <p
        className={`mt-1 text-[10px] font-medium uppercase tracking-wide ${
          isCis ? "text-amber-800/90" : "text-zinc-400"
        }`}
      >
        {item.statusLabel}
      </p>
    </div>
  );
}

function FrameworkImpactCard({ items }: { items: readonly CredentialFrameworkImpactItem[] }) {
  return (
    <div className={drawerPanel}>
      <div className={drawerSectionHead}>
        <h3 className={drawerSectionTitle}>Framework impact</h3>
      </div>
      <div className={`${drawerSectionBody} grid grid-cols-1 gap-2 sm:grid-cols-2`}>
        {items.map((item) => (
          <FrameworkThresholdCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function OverviewTabContent({
  impact,
  risk,
  fix,
  finding,
  hasException,
  documentation,
  accountId,
}: {
  impact: string;
  risk: string;
  fix: string;
  finding: Finding;
  hasException: boolean;
  documentation?: ReturnType<typeof documentationForCheck>;
  accountId?: string | null;
}) {
  const riskLine = documentation?.overview?.context ?? impact;
  const businessImpact = documentation?.overview?.exposure ?? risk;
  const recommendedAction = documentation?.overview?.fix ?? fix;
  const frameworkImpact = credentialUnusedFrameworkImpact(finding.check_id);
  const severityDisplay = severityLabel(finding.severity);
  const severityPillClass = severityPillClassName(finding.severity);

  const { data: controlBundle, isLoading: controlsLoading } = useQuery({
    queryKey: ["controls-by-check", finding.check_id],
    queryFn: () =>
      api<CheckControlBundle>(`/v1/controls/by-check/${encodeURIComponent(finding.check_id)}`),
  });

  const mappings = controlBundle?.controls ?? [];
  const primaryComposite = controlBundle?.primary_composite ?? null;

  return (
    <div className="space-y-3.5">
      <div className={drawerPanel}>
        <div className={drawerSectionHead}>
          <h3 className={drawerSectionTitle}>Security summary</h3>
        </div>
        <dl className="bg-white">
          <OverviewSummaryRow label="Severity">
            <span className={severityPillClass}>{severityDisplay}</span>
          </OverviewSummaryRow>
          <OverviewSummaryRow label="Risk">{riskLine}</OverviewSummaryRow>
          <OverviewSummaryRow label="Business impact">{businessImpact}</OverviewSummaryRow>
          <OverviewSummaryRow label="Compliance mappings">
            {controlsLoading ? (
              <span className="text-[#98a2b3]">Loading…</span>
            ) : !primaryComposite && mappings.length === 0 ? (
              <span className="text-[#98a2b3]">Not mapped</span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {primaryComposite && (
                  <Link
                    to={compositeComplianceHref(primaryComposite.id, accountId)}
                    className="inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-800 transition hover:border-indigo-300 hover:bg-indigo-100"
                  >
                    {primaryComposite.title}
                  </Link>
                )}
                {mappings.map((c) => (
                  <Link
                    key={`${c.framework}:${c.control_id}`}
                    to={compliancePageHref(c, accountId)}
                    className="inline-flex items-center rounded-md border border-[#e6ebf2] bg-[#f8fafc] px-2 py-0.5 text-[11px] font-semibold text-[#344054] transition hover:border-[#dce3ec] hover:bg-white hover:text-[#1f4e79]"
                  >
                    {frameworkCompact(c.framework)} {c.control_id}
                  </Link>
                ))}
              </div>
            )}
          </OverviewSummaryRow>
          <OverviewSummaryRow label="Recommended action" emphasis>
            {recommendedAction}
          </OverviewSummaryRow>
        </dl>
      </div>

      {frameworkImpact && <FrameworkImpactCard items={frameworkImpact} />}

      {hasException && (
        <ExceptionFlowPanel
          reason={finding.exception_reason}
          approvedBy={finding.exception_approved_by}
          expiresAt={finding.exception_expires_at}
        />
      )}
    </div>
  );
}

const remediations: Record<string, Remediation> = {
  "iam.user.no_mfa": {
    why: "Users without MFA can be fully compromised with only a stolen password. A second factor an attacker must physically control is the single most effective control against credential phishing.",
    console: [
      "Open IAM → Users → select the user",
      'Open the "Security credentials" tab → "Multi-factor authentication" → "Assign MFA device"',
      "Complete the MFA enrollment wizard",
    ],
    risk: "Until MFA is enabled, a leaked password can be enough to sign in to the console.",
  },
  "iam.user.inactive_90d": {
    why: "Inactive accounts have no baseline of normal activity, making compromise invisible. Attackers who obtain credentials can operate undetected for months.",
    console: ["Open IAM → Users → select the user", 'Click "Security credentials" tab', 'Under "Console sign-in", click "Disable console access"', "Confirm with the team, then delete the user if no longer needed"],
    cli: `# Disable console access
aws iam delete-login-profile --user-name <user>

# Or delete the user entirely (remove keys + policies first)
aws iam delete-user --user-name <user>`,
    risk: "Stale console users should be disabled or removed after ownership is confirmed.",
  },
  "iam.user.credentials_unused_45d": {
    why: "Console credentials unused for 45+ days are often forgotten accounts. Inactive users have no baseline of normal activity, making compromise harder to spot.",
    console: ["Open IAM → Users → select the user", 'Click "Security credentials" tab', 'Under "Console sign-in", click "Disable console access"', "Confirm with the team, then delete the user if no longer needed"],
    cli: `# Disable console access
aws iam delete-login-profile --user-name <user>

# Or delete the user entirely (remove keys + policies first)
aws iam delete-user --user-name <user>`,
    risk: "Stale console users should be disabled or removed after ownership is confirmed.",
  },
  "iam.user.direct_policy_attachment": {
    why: "CIS expects permissions on IAM users to come from groups or roles — not policies attached directly to the user. Direct attachment is harder to audit, review, and revoke at scale.",
    console: [
      "Open IAM → Users → select the user",
      'Click "Permissions" tab',
      "Detach any managed policies attached directly to the user",
      "Delete any inline user policies",
      "Add the user to an IAM group or grant access via an assumable role instead",
    ],
    cli: `# List direct attachments
aws iam list-attached-user-policies --user-name <user>
aws iam list-user-policies --user-name <user>

# Detach managed policy
aws iam detach-user-policy --user-name <user> --policy-arn <policy-arn>

# Delete inline policy
aws iam delete-user-policy --user-name <user> --policy-name <policy-name>`,
    risk: "Detaching policies may break scripts or console workflows that depend on user-scoped grants — confirm usage before removing.",
  },
  "iam.access_key.unused_90d": {
    why: "Unused access keys are typically abandoned in scripts, CI config, or developer machines — often forgotten and never rotated. They're persistent credentials with no expiry.",
    console: ["Open IAM → Users → select the user", 'Click "Security credentials" tab', "Find the key under Access Keys", 'Click "Deactivate" first to verify nothing breaks, then "Delete"'],
    cli: `# Deactivate first, confirm nothing breaks, then delete
aws iam update-access-key --access-key-id <key-id> --status Inactive --user-name <user>

aws iam delete-access-key --access-key-id <key-id> --user-name <user>`,
    risk: "Forgotten keys are long-lived credentials. Deactivate first, then delete after confirming nothing still depends on them.",
  },
  "iam.access_key.unused_45d": {
    why: "Access keys unused for 45+ days are often abandoned in scripts, CI config, or developer machines and never rotated.",
    console: ["Open IAM → Users → select the user", 'Click "Security credentials" tab', "Find the key under Access Keys", 'Click "Deactivate" first to verify nothing breaks, then "Delete"'],
    cli: `# Deactivate first, confirm nothing breaks, then delete
aws iam update-access-key --access-key-id <key-id> --status Inactive --user-name <user>

aws iam delete-access-key --access-key-id <key-id> --user-name <user>`,
    risk: "Forgotten keys are long-lived credentials. Deactivate first, then delete after confirming nothing still depends on them.",
  },
  "iam.access_key.no_rotation_90d": {
    why: "This access key is older than the configured key-age threshold. Long-lived keys are harder to reason about because they may be stored in old scripts, CI secrets, or developer machines.",
    console: ["Open IAM → Users → select the user", 'Click "Security credentials" tab', "Create a replacement access key for the current workload", "Update the workload secret, then deactivate and delete the old key"],
    cli: `# Create a replacement key, update the workload, then retire the old one
aws iam create-access-key --user-name <user>

aws iam update-access-key --access-key-id <key-id> --status Inactive --user-name <user>

aws iam delete-access-key --access-key-id <key-id> --user-name <user>`,
    risk: "This is a key hygiene finding. Validate where the key is used before rotation or deletion.",
  },
  "iam.access_key.multiple_active": {
    why: "The user has more than one active access key. That can be valid during rotation, but persistent duplicate keys make ownership and cleanup harder.",
    console: ["Open IAM → Users → select the user", 'Click "Security credentials" tab', "Review both active access keys, including creation and last-used dates", "Deactivate and delete the key that is no longer needed"],
    cli: `# Review active keys for the user
aws iam list-access-keys --user-name <user>

# Deactivate the unused key first, then delete it
aws iam update-access-key --access-key-id <key-id> --status Inactive --user-name <user>
aws iam delete-access-key --access-key-id <key-id> --user-name <user>`,
    risk: "Treat this as a review item unless the extra key is clearly stale or unauthorized.",
  },
  "iam.role.unassumed_90d": {
    why: "Roles not assumed in 90+ days are often orphaned. They add attack surface and may carry policies that nobody actively owns.",
    console: ["Open IAM → Roles → select the role", "Review the trust policy and attached policies", "Confirm with the owning team whether the role is still needed", 'If not needed, click "Delete" at the top of the role page'],
    cli: `# Check last activity
aws iam get-role --role-name <role-name> --query 'Role.RoleLastUsed'

# Delete if confirmed unused
aws iam delete-role --role-name <role-name>`,
    risk: "Unused roles should be removed after ownership and service dependencies are confirmed.",
  },
  "iam.role.least_privilege_policy": {
    why: "Customer-managed policies with Action:* violate least privilege. Full admin (Resource:*) is the highest risk; Action:* on scoped resources is still broader than necessary for most workloads.",
    console: [
      'Use "Least-privilege proposal" above (Generate) to preview a scoped policy from recorded usage',
      "Open IAM → Roles → select the role → Permissions → edit or replace the policy",
      "Apply the generated policy document, then verify the workload",
    ],
    cli: `# Option A — use Least-privilege proposal (Generate) in this drawer, then:
aws iam put-role-policy --role-name <role-name> --policy-name <policy-name> --policy-document file://scoped-policy.json

# Option B — review policies manually
aws iam list-role-policies --role-name <role-name>
aws iam list-attached-role-policies --role-name <role-name>`,
    risk: "Broad permissions increase blast radius if the role is compromised or misused.",
  },
  "iam.perm.granted_vs_used": {
    why: "This role has write or mutating actions in its policies that have no recorded usage in the last 90 days (action-level data from IAM last-accessed). Removing unused write permissions reduces the blast radius if the role is compromised.",
    console: [
      "Open IAM → Roles → select the role → Permissions tab",
      "Review the actions listed in the finding evidence",
      "For each unused action, remove it from the role's inline or attached policies",
      'Use "Least-privilege proposal" above (Generate) to preview a least-privilege policy from recorded usage',
      "Test the workload after each change to confirm functionality",
    ],
    cli: `# View current role policy
aws iam get-role-policy --role-name <role-name> --policy-name <policy-name>

# Update with unused write actions removed
aws iam put-role-policy --role-name <role-name> --policy-name <policy-name> --policy-document file://scoped-policy.json`,
    risk: "Roles with unused write actions can modify or delete resources they have no business touching — removing them shrinks the attack surface with no operational impact.",
  },
  "iam.policy.unattached": {
    why: "Customer-managed policies that are not attached to any user, group, or role are dead weight. They may contain overly permissive statements written for a workload that no longer exists, and they clutter the policy namespace making access reviews harder.",
    console: [
      "Open IAM → Policies → filter to Customer managed",
      "Sort by Attached entities to find policies with 0 attachments",
      "Review each policy — confirm it is no longer needed",
      'Click the policy → "Delete" (IAM will block deletion if it has any attachments)',
    ],
    cli: `# List customer-managed policies with 0 attachments
aws iam list-policies --scope Local --query 'Policies[?AttachmentCount==\`0\`].[PolicyName,Arn]' --output table

# Delete a specific unattached policy (fails if still attached)
aws iam delete-policy --policy-arn <policy-arn>`,
    risk: "Stale policies are low-risk but add noise to access reviews and may be accidentally re-attached with broad permissions later.",
  },
  "iam.policy.wildcard_resource": {
    why: "This policy grants write or sensitive actions on Resource: \"*\" — they apply to every resource of that type in the account. CIS benchmarks only require fixing full admin (Action: '*' with Resource: '*'); this is optional least-privilege hygiene, not a scored compliance fail.",
    console: [
      "Open IAM → Roles → select the role → Permissions tab",
      "Find the policy listed in the finding evidence",
      "For each flagged statement, replace Resource: '*' with the specific ARN(s) the role actually needs",
      "If specific ARNs are unknown, use IAM Access Analyzer to generate a least-privilege policy from CloudTrail history",
      "Save the updated policy and verify the workload still functions",
    ],
    cli: `# Review the flagged policy
aws iam get-role-policy --role-name <role-name> --policy-name <policy-name>

# Replace with scoped version (Resource narrowed to specific ARNs)
aws iam put-role-policy --role-name <role-name> --policy-name <policy-name> --policy-document file://scoped-policy.json

# For customer-managed attached policies
aws iam get-policy-version --policy-arn <policy-arn> --version-id v1
aws iam create-policy-version --policy-arn <policy-arn> --policy-document file://scoped-policy.json --set-as-default`,
    risk: "Wildcard resources on write actions mean the role can modify or delete any resource of that type in the account — not just the ones it should own.",
  },
  "iam.role.unused_services_90d": {
    why: "This role has permissions to services it has not recently used according to IAM service-last-accessed data. Those permissions may be removable, but should be validated against workload behavior and data freshness.",
    console: ["Open IAM → Roles → select the role", 'Click "Permissions" tab → find inline policies under "Permissions policies"', "Review each inline policy and remove statements for the unused services listed below", "Save the updated policy (or delete it entirely if all its services are unused)"],
    cli: `# List inline policies on the role
aws iam list-role-policies --role-name <role-name>

# Get a specific inline policy
aws iam get-role-policy --role-name <role-name> --policy-name <policy-name>

# Replace with scoped version (unused service statements removed)
aws iam put-role-policy --role-name <role-name> --policy-name <policy-name> --policy-document file://scoped-policy.json

# Or delete entirely if all permissions are unused
aws iam delete-role-policy --role-name <role-name> --policy-name <policy-name>`,
    risk: "Unused service permissions increase blast radius. Removing them improves least privilege after validation.",
  },
  "iam.role.trust_wildcard": {
    why: 'This role trust policy allows any AWS principal. That is high risk unless strong conditions narrow who can assume the role.',
    console: ["Open IAM → Roles → select the role", 'Click "Trust relationships"', "Review the principal and any conditions", "Replace wildcard principals with specific AWS accounts, roles, services, or federated identities"],
    cli: `# Review the role trust policy
aws iam get-role --role-name <role-name> --query 'Role.AssumeRolePolicyDocument'

# Update the trust policy after scoping Principal and Conditions
aws iam update-assume-role-policy --role-name <role-name> --policy-document file://trust-policy.json`,
    risk: "Wildcard trust can expose a role to unintended principals, especially when conditions are missing or weak.",
  },
  "iam.role.external_account_trust": {
    why: "The role's trust policy allows an AWS principal in another account to call sts:AssumeRole. That is expected for some integrations but must be documented and scoped — unknown external accounts are a common path for lateral access.",
    console: [
      "Open IAM → Roles → select the role",
      'Open the "Trust relationships" tab',
      "Review Principal.AWS entries — note each external 12-digit account ID",
      "Confirm with the owning team that each account is still required",
      "Remove stale principals, or add ExternalId / aws:PrincipalArn conditions to narrow who can assume",
      "Save an approved exception in Vigil if the trust is intentional (vendor, security tool, shared services)",
    ],
    cli: `# Read trust policy
aws iam get-role --role-name <role-name> --query 'Role.AssumeRolePolicyDocument'

# After editing trust-policy.json locally
aws iam update-assume-role-policy --role-name <role-name> --policy-document file://trust-policy.json`,
    risk: "Anyone who can assume this role from the trusted account receives all permissions attached to the role in your account.",
  },

  "iam.root.has_access_keys": {
    why: "Root account access keys bypass all IAM policies and have unrestricted access to every service and resource. There is no legitimate use case for programmatic root credentials.",
    console: ["Sign in as root", "Open IAM → Security credentials (via account menu top-right)", 'Under "Access keys", delete all active keys', "Create an IAM admin user for any automation that previously used root credentials"],
    cli: `# List root access keys (requires root credentials or AWS Support)
aws iam list-access-keys

# Delete each active root key
aws iam delete-access-key --access-key-id <key-id>`,
    risk: "Root access keys cannot be scoped with policies. Anyone with these credentials has full, unrevokable control of the account.",
  },

  "iam.root.no_mfa": {
    why: "The root account has no IAM policy restrictions. If its password is compromised without MFA, an attacker has unrestricted access to the entire account.",
    console: ["Sign in as root", "Open IAM → Security credentials (via account menu top-right)", 'Under "Multi-factor authentication", click "Assign MFA device"', "Register a hardware MFA device — virtual MFA is acceptable but hardware is preferred for root"],
    cli: `# MFA for root must be configured via the console — the AWS CLI cannot enable root MFA directly.
# Sign in as root and use the Security credentials page.`,
    risk: "Root without MFA is the highest-severity finding possible. Prioritise this above everything else.",
  },

  "iam.root.usage": {
    why: "Root is the most privileged identity in AWS — all IAM policies and SCPs are bypassed. Any API call using root credentials is a red flag. Engineers should never use root for day-to-day work.",
    console: ["Sign in as root → open CloudTrail → Event history", "Identify the event(s) that triggered this finding — review the event name, source IP, and user agent", "Determine whether the action required root or could have been done with an IAM user/role", "Create an IAM admin user or role for those operations and use root only for tasks that explicitly require it (e.g. closing the account, managing root MFA, changing account plan)"],
    cli: `# View recent root-initiated CloudTrail events
aws cloudtrail lookup-events \\
  --lookup-attributes AttributeKey=Username,AttributeValue=root \\
  --start-time $(date -u -d "90 days ago" +%Y-%m-%dT%H:%M:%SZ) \\
  --query 'Events[*].{Time:EventTime,Event:EventName,IP:CloudTrailEvent}' \\
  --output table`,
    risk: "Root activity should be extremely rare. Recurring root use indicates a process gap — automate those tasks with scoped IAM roles instead.",
  },

  "s3.bucket.public_access_not_blocked": {
    why: "S3 Block Public Access is an account and bucket-level guard against accidentally making objects public via ACLs or bucket policies. One or more of the four settings is currently off.",
    console: ["Open S3 → select the bucket", 'Click "Permissions" tab', 'Under "Block public access", click "Edit"', "Enable all four settings and save"],
    cli: `# Enable all four Block Public Access settings
aws s3api put-public-access-block \\
  --bucket <bucket-name> \\
  --public-access-block-configuration '{
    "BlockPublicAcls": true,
    "IgnorePublicAcls": true,
    "BlockPublicPolicy": true,
    "RestrictPublicBuckets": true
  }'`,
    risk: "Without this, a misconfigured ACL or bucket policy can silently expose objects to the internet.",
  },

  "s3.account.public_access_not_blocked": {
    why: "Account-level S3 Block Public Access is the broad guardrail that prevents accidental public bucket ACLs or policies across the entire account.",
    console: ["Open S3 → Block Public Access settings for this account", 'Click "Edit"', "Enable all four Block Public Access settings", "Save changes"],
    cli: `aws s3control put-public-access-block \\
  --account-id <account-id> \\
  --public-access-block-configuration \\
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true`,
    risk: "Without the account-level guardrail, a single bucket policy or ACL mistake can expose data publicly.",
  },

  "s3.bucket.no_https_policy": {
    why: "A deny-HTTP bucket policy is defense in depth — it blocks the rare client that still uses http:// even though AWS SDKs, CLI, and Terraform default to HTTPS. Auditors often expect this as evidence of encryption in transit.",
    console: [
      "Remediation tab → Least-privilege proposal → Generate (reads live bucket policy from AWS)",
      "Open S3 → select the bucket → Permissions → Bucket policy",
      "Paste the merged policy from Generate → Save",
    ],
    cli: `# After Generate: apply the merged policy document
aws s3api put-bucket-policy --bucket <bucket-name> --policy file://merged-policy.json`,
    risk: "Low practical blast radius for modern apps. Main value is compliance (CIS/SOC2) and blocking misconfigured legacy scripts that hard-code http:// URLs.",
  },

  "s3.bucket.no_kms": {
    why: "Server-side encryption with KMS (SSE-KMS) uses a customer-managed key, giving you control over key rotation, access policies, and audit logs. SSE-S3 uses an AWS-managed key you cannot audit or revoke.",
    console: ["Open S3 → select the bucket", 'Click "Properties" tab', 'Under "Default encryption", click "Edit"', 'Select "SSE-KMS", choose an existing CMK or create a new one, and save'],
    cli: `# Enable SSE-KMS with an existing CMK
aws s3api put-bucket-encryption --bucket <bucket-name> \\
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms",
        "KMSMasterKeyID": "<kms-key-arn>"
      },
      "BucketKeyEnabled": true
    }]
  }'`,
    risk: "SSE-S3 protects data at rest but the key is fully managed by AWS — you cannot restrict, rotate, or audit it independently.",
  },

  "s3.bucket.no_logging": {
    why: "Server access logging records every request made to a bucket — who accessed what, when, and from where. Without it there is no audit trail for forensics or compliance.",
    console: [
      "Create a central logging bucket (e.g. my-access-logs-<account-id>) if one does not exist",
      "On the logging bucket, set ownership to 'Bucket owner preferred' under Object Ownership",
      "Open the source bucket → Properties tab",
      'Under "Server access logging", click Edit',
      "Enable logging and set the target bucket and a prefix (e.g. the source bucket name)",
    ],
    cli: `# 1. Create a dedicated logging bucket (skip if it already exists)
aws s3api create-bucket --bucket my-access-logs-<account-id> --region us-east-1

# 2. Set object ownership so the log delivery service can write
aws s3api put-bucket-ownership-controls \\
  --bucket my-access-logs-<account-id> \\
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerPreferred}]'

# 3. Enable access logging on the source bucket
aws s3api put-bucket-logging \\
  --bucket <bucket-name> \\
  --bucket-logging-status '{
    "LoggingEnabled": {
      "TargetBucket": "my-access-logs-<account-id>",
      "TargetPrefix": "<bucket-name>/"
    }
  }'`,
    risk: "Without access logs you cannot detect data exfiltration, unauthorized access, or misconfigured permissions after the fact.",
  },

  "kms.key.no_rotation": {
    why: "Automatic key rotation replaces the backing key material annually. If the key material is ever exposed, rotation limits the window of exposure.",
    console: ["Open KMS → Customer managed keys", "Select the key", 'Click "Key rotation" tab', 'Enable "Automatically rotate this KMS key every year"'],
    cli: `# Enable annual automatic rotation
aws kms enable-key-rotation --key-id <key-id>

# Confirm rotation is enabled
aws kms get-key-rotation-status --key-id <key-id>`,
    risk: "Keys that never rotate accumulate exposure over time. AWS retains old backing keys so existing ciphertexts remain decryptable after rotation.",
  },
  "cloudtrail.trail.not_enabled": {
    why: "Without CloudTrail, there is no record of API calls. Incidents cannot be investigated, compliance cannot be proven, and unauthorized access may go undetected.",
    console: ["Open CloudTrail → Trails → Create trail", "Set a name, enable logging in all regions (multi-region trail)", "Select or create an S3 bucket for log delivery", 'Enable "Log file validation" and save'],
    cli: `# Create a multi-region trail
aws cloudtrail create-trail \\
  --name vigil-audit \\
  --s3-bucket-name <your-log-bucket> \\
  --is-multi-region-trail \\
  --enable-log-file-validation

# Start logging
aws cloudtrail start-logging --name vigil-audit`,
    risk: "Without audit logs, compromise may go undetected and incident response is severely hampered.",
  },
  "cloudtrail.trail.no_log_validation": {
    why: "Without log file validation, CloudTrail logs can be silently modified or deleted. Attackers who compromise log storage can erase evidence of their activity.",
    console: ["Open CloudTrail → Trails → select the trail", 'Under "General details", click "Edit"', 'Enable "Log file validation"', "Save changes"],
    cli: `# Enable log file integrity validation on an existing trail
aws cloudtrail update-trail \\
  --name <trail-name> \\
  --enable-log-file-validation

# Verify
aws cloudtrail get-trail --name <trail-name>`,
    risk: "Tampered logs are indistinguishable from authentic ones without validation enabled.",
  },
  "cloudtrail.trail.no_kms": {
    why: "CloudTrail log files should be encrypted with a customer-managed KMS key so access to audit history can be controlled, monitored, and revoked independently from the S3 bucket.",
    console: [
      "Open CloudTrail → Trails → select the trail",
      'Under "General details", click "Edit"',
      "Enable SSE-KMS encryption",
      "Choose a customer-managed KMS key for log encryption",
      "Save changes",
    ],
    cli: `aws cloudtrail update-trail \\
  --name <trail-name> \\
  --kms-key-id <kms-key-arn>`,
    risk: "Unencrypted audit logs weaken evidence integrity and make it harder to prove tight access control over security history.",
  },
  "guardduty.detector.not_enabled": {
    why: "GuardDuty is AWS's threat detection service. Without it, there is no automated detection of port scans, credential abuse, crypto-mining, or data exfiltration.",
    console: ["Open GuardDuty in each affected region listed in Scan details", 'Click "Get Started" then "Enable GuardDuty"', "Alternatively, use AWS Organizations to enable GuardDuty in all regions centrally"],
    cli: `# Enable GuardDuty in each disabled region (repeat per region)
aws guardduty create-detector --enable --region <region>

# Or enable across all regions using a loop
for region in $(aws ec2 describe-regions --query 'Regions[].RegionName' --output text); do
  aws guardduty create-detector --enable --region $region
done`,
    risk: "Threats such as compromised credentials, unusual API calls, and lateral movement go undetected.",
  },
  "vpc.flow_logs.not_enabled": {
    why: "VPC flow logs capture accepted and rejected network traffic. Without them, lateral movement, port scans, and data exfiltration are invisible at the network layer.",
    console: ["Open VPC → Your VPCs → select the VPC", 'Click "Flow logs" tab → "Create flow log"', 'Set filter to "All", destination to CloudWatch Logs or S3', "Select or create an IAM role for delivery and save"],
    cli: `# Create a flow log to CloudWatch Logs
aws ec2 create-flow-logs \\
  --resource-type VPC \\
  --resource-ids <vpc-id> \\
  --traffic-type ALL \\
  --log-destination-type cloud-watch-logs \\
  --log-group-name /aws/vpc/flowlogs \\
  --deliver-logs-permission-arn <delivery-role-arn>`,
    risk: "Network-level attacks and lateral movement are invisible without flow logs.",
  },
  "ec2.security_group.unrestricted_ssh": {
    why: "SSH open to 0.0.0.0/0 exposes instances to brute-force and credential-stuffing attacks from the entire internet.",
    console: ["Open EC2 → Security Groups → select the group", 'Click "Inbound rules" tab → "Edit inbound rules"', "Find the rule for port 22 with source 0.0.0.0/0 or ::/0", "Replace with a specific IP range, or remove and use Systems Manager Session Manager instead"],
    cli: `# Remove the unrestricted SSH rule
aws ec2 revoke-security-group-ingress \\
  --group-id <sg-id> \\
  --protocol tcp \\
  --port 22 \\
  --cidr 0.0.0.0/0

# Optionally restrict to a known IP
aws ec2 authorize-security-group-ingress \\
  --group-id <sg-id> \\
  --protocol tcp \\
  --port 22 \\
  --cidr <your-ip>/32`,
    risk: "Open SSH is continuously probed. A single weak credential or leaked key is sufficient for full instance compromise.",
  },
  "ec2.security_group.unrestricted_rdp": {
    why: "RDP open to 0.0.0.0/0 is a primary attack vector for Windows instances and is actively exploited by ransomware operators.",
    console: ["Open EC2 → Security Groups → select the group", 'Click "Inbound rules" tab → "Edit inbound rules"', "Find the rule for port 3389 with source 0.0.0.0/0 or ::/0", "Replace with a specific IP range, or use AWS Fleet Manager for browser-based RDP"],
    cli: `# Remove the unrestricted RDP rule
aws ec2 revoke-security-group-ingress \\
  --group-id <sg-id> \\
  --protocol tcp \\
  --port 3389 \\
  --cidr 0.0.0.0/0

# Optionally restrict to a known IP
aws ec2 authorize-security-group-ingress \\
  --group-id <sg-id> \\
  --protocol tcp \\
  --port 3389 \\
  --cidr <your-ip>/32`,
    risk: "Exposed RDP is a leading cause of ransomware incidents. The port is constantly scanned by automated attackers.",
  },
  "rds.instance.publicly_accessible": {
    why: "A publicly accessible RDS instance can be reached directly from the internet. Combined with weak credentials or an unpatched vulnerability, this is a direct path to data exfiltration.",
    console: ["Open RDS → Databases → select the instance", 'Click "Modify"', 'Under "Connectivity", set "Publicly accessible" to No', 'Click "Continue" and apply immediately or during the next maintenance window'],
    cli: `# Disable public accessibility
aws rds modify-db-instance \\
  --db-instance-identifier <instance-id> \\
  --no-publicly-accessible \\
  --apply-immediately`,
    risk: "Direct internet exposure combines with database credentials — one exposure is enough for a full data breach.",
  },
  "rds.instance.no_encryption": {
    why: "RDS encryption cannot be enabled on a running instance. An unencrypted instance stores data as plaintext on disk — a snapshot or EBS volume leak exposes raw data.",
    console: [
      "Open RDS → Databases → select the instance",
      'Click "Actions" → "Take snapshot" to create a backup',
      "Open RDS → Snapshots → select the snapshot",
      'Click "Actions" → "Copy snapshot", enable encryption, choose a KMS key',
      'Restore the encrypted snapshot via "Actions" → "Restore snapshot"',
      "Validate the new instance, update application connection strings, then delete the old instance",
    ],
    cli: `# Step 1: snapshot the current instance
aws rds create-db-snapshot \\
  --db-instance-identifier <instance-id> \\
  --db-snapshot-identifier <snapshot-id>

# Step 2: copy with encryption enabled
aws rds copy-db-snapshot \\
  --source-db-snapshot-identifier <snapshot-id> \\
  --target-db-snapshot-identifier <encrypted-snapshot-id> \\
  --kms-key-id <kms-key-arn>

# Step 3: restore to a new encrypted instance
aws rds restore-db-instance-from-db-snapshot \\
  --db-instance-identifier <new-instance-id> \\
  --db-snapshot-identifier <encrypted-snapshot-id>`,
    risk: "Unencrypted storage means any physical disk access or snapshot leak exposes plaintext database contents.",
  },
  "rds.instance.no_automated_backup": {
    why: "Automated backups provide point-in-time recovery. Without them, accidental deletion, bad migrations, or data corruption can become permanent data loss.",
    console: [
      "Open RDS → Databases → select the instance",
      'Click "Modify"',
      "Set Backup retention period to at least 7 days",
      "Choose a backup window that avoids peak traffic",
      'Click "Continue" and apply during the next maintenance window unless urgent',
    ],
    cli: `aws rds modify-db-instance \\
  --db-instance-identifier <instance-id> \\
  --backup-retention-period 7 \\
  --preferred-backup-window 03:00-04:00`,
    risk: "No automated backups means no point-in-time recovery. Operational mistakes or corruption may require manual snapshot rollback, if any snapshot exists.",
  },
  "dynamodb.table.no_encryption": {
    why: "Tables without explicit encryption at rest rely on legacy defaults. Enabling SSE-KMS or AWS-owned encryption protects item data on disk and satisfies auditor expectations for data-at-rest controls.",
    console: [
      "Open DynamoDB → Tables → select the table",
      'Open the "Additional settings" tab',
      'Under "Encryption at rest", click "Manage encryption"',
      'Choose "Owned by Amazon DynamoDB" or "AWS managed key (aws/dynamodb)" for the simplest path',
      "For a customer-managed key, select your KMS key and confirm IAM roles can use it",
      "Save — the table stays online during the update",
    ],
    cli: `# Enable encryption in place (AWS managed DynamoDB key)
aws dynamodb update-table \\
  --table-name <table-name> \\
  --region <region> \\
  --sse-specification Enabled=true,SSEType=KMS,KMSMasterKeyId=alias/aws/dynamodb

# Or use AWS-owned encryption (AES256)
aws dynamodb update-table \\
  --table-name <table-name> \\
  --region <region> \\
  --sse-specification Enabled=true,SSEType=AES256`,
    risk: "Unencrypted tables store data without explicit at-rest protection. Encryption can be enabled in place, but customer-managed KMS keys require kms:Decrypt on consuming roles.",
  },
  "dynamodb.table.no_pitr": {
    why: "Point-in-time recovery (PITR) provides continuous backups and restore to any second within the last 35 days. Without it, accidental deletes or bad writes require manual on-demand backups — if any exist.",
    console: [
      "Open DynamoDB → Tables → select the table",
      'Open the "Backups" tab',
      'Under "Point-in-time recovery (PITR)", click "Edit"',
      "Enable PITR and save",
    ],
    cli: `aws dynamodb update-continuous-backups \\
  --table-name <table-name> \\
  --region <region> \\
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true`,
    risk: "Without PITR, table data loss from accidental deletes or application bugs may be irreversible.",
  },
  "s3.bucket.no_default_encryption": {
    why: "Without default encryption, objects uploaded without an explicit encryption header are stored unencrypted. Default bucket encryption applies SSE to every new object automatically.",
    console: [
      "Open S3 → select the bucket",
      'Open the "Properties" tab → "Default encryption" → Edit',
      "Enable SSE-S3 (AES-256) or SSE-KMS with your preferred key",
      "Save — only affects new uploads; existing objects are unchanged",
    ],
    cli: `aws s3api put-bucket-encryption \\
  --bucket <bucket-name> \\
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'`,
    risk: "Existing objects are not retroactively encrypted. Re-upload or use S3 Batch Operations if you need to encrypt historical data.",
  },
  "s3.bucket.no_mfa_delete": {
    why: "With versioning enabled but MFA Delete off, a compromised IAM principal can permanently delete all object versions without a second factor. MFA Delete requires root credentials to enable or disable.",
    console: [
      "Sign in as the root user (MFA Delete cannot be enabled by IAM users)",
      "Open S3 → select the bucket → Properties",
      'Under "Bucket Versioning", click Edit',
      "Enable MFA Delete and provide your root MFA device serial and two consecutive codes",
    ],
    cli: `# MFA Delete requires root credentials
aws s3api put-bucket-versioning \\
  --bucket <bucket-name> \\
  --versioning-configuration Status=Enabled,MFADelete=Enabled \\
  --mfa "<root-mfa-serial> <code1> <code2>"`,
    risk: "Disabling MFA Delete later also requires root MFA. Treat this as a permanent hardening step once enabled.",
  },
  "ec2.ebs.snapshot_public": {
    why: "Public EBS snapshots can be copied or mounted by any AWS account worldwide. They may contain full disk images with credentials, keys, or customer data.",
    console: [
      "Open EC2 → Snapshots → select the snapshot",
      'Click "Actions" → "Modify snapshot permissions"',
      'Remove any "Groups" entry (e.g. all) and confirm only your account ID is listed',
      "If the snapshot is no longer needed, delete it",
    ],
    cli: `# Remove public access — allow only this account
aws ec2 modify-snapshot-attribute \\
  --snapshot-id <snapshot-id> \\
  --region <region> \\
  --attribute createVolumePermission \\
  --operation-type remove \\
  --group-names all

# Verify permissions
aws ec2 describe-snapshot-attribute \\
  --snapshot-id <snapshot-id> \\
  --region <region> \\
  --attribute createVolumePermission`,
    risk: "Public snapshots may already have been copied by external accounts — removing access stops new copies but not existing ones.",
  },
  "ec2.ebs.snapshot_unencrypted": {
    why: "Unencrypted snapshots store block data in plaintext. Anyone with snapshot access (including after a cross-account share) can read the full disk contents.",
    console: [
      "Open EC2 → Snapshots → select the snapshot",
      'Click "Actions" → "Copy snapshot"',
      "Enable encryption and choose a KMS key",
      "After validating the encrypted copy, delete the original unencrypted snapshot",
    ],
    cli: `aws ec2 copy-snapshot \\
  --source-region <region> \\
  --source-snapshot-id <snapshot-id> \\
  --region <region> \\
  --description "Encrypted copy" \\
  --encrypted \\
  --kms-key-id alias/aws/ebs

# After validation, delete the original
aws ec2 delete-snapshot --snapshot-id <snapshot-id> --region <region>`,
    risk: "Copying large snapshots takes time and incurs storage cost for both copies until the original is deleted.",
  },
  "ec2.ami.public": {
    why: "A public AMI exposes your machine image to every AWS account. Images may contain hardcoded secrets, internal tooling, or proprietary code.",
    console: [
      "Open EC2 → AMIs → select the AMI",
      'Click "Actions" → "Modify image permissions"',
      'Set visibility to "Private" (remove all and add only your account if needed)',
      "Deregister the AMI if it was shared accidentally and is no longer needed",
    ],
    cli: `# Make AMI private (this account only)
aws ec2 modify-image-attribute \\
  --image-id <image-id> \\
  --region <region> \\
  --launch-permission '{"Remove":[{"Group":"all"}]}'

# Verify
aws ec2 describe-image-attribute \\
  --image-id <image-id> \\
  --region <region> \\
  --attribute launchPermission`,
    risk: "If the AMI was public, assume it may have been copied — rotate any secrets baked into the image.",
  },
  "cloudtrail.trail.s3_bucket_public": {
    why: "CloudTrail logs contain every API call in your account. A public S3 bucket receiving those logs exposes your full operational history to the internet.",
    console: [
      "Identify the S3 bucket receiving CloudTrail logs (CloudTrail → Trails → select trail → Storage location)",
      "Open S3 → select that bucket → Permissions",
      "Enable all four Block Public Access settings",
      "Review the bucket policy — remove any Principal: * grants",
      "Confirm the bucket is not listed as publicly accessible in S3 → Access Points or ACLs",
    ],
    cli: `# Block all public access on the CloudTrail log bucket
aws s3api put-public-access-block \\
  --bucket <bucket-name> \\
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true`,
    risk: "Audit logs may already have been downloaded if the bucket was public. Treat this as a potential data breach and rotate sensitive credentials.",
  },
  "cloudtrail.trail.no_cloudwatch_logs": {
    why: "CloudWatch Logs integration enables real-time alerting on suspicious API activity. S3-only delivery delays detection until logs are delivered and queried.",
    console: [
      "Open CloudTrail → Trails → select the trail",
      'Click "Edit" → expand "CloudWatch Logs"',
      "Create or select a CloudWatch Logs log group",
      "Attach the CloudTrail service role (or create one with logs:CreateLogStream and logs:PutLogEvents)",
      "Save and verify events appear in the log group within a few minutes",
    ],
    cli: `# Create log group and enable CloudWatch delivery (requires CloudTrail service role)
aws logs create-log-group --log-group-name CloudTrail/<trail-name> --region <region>

aws cloudtrail update-trail \\
  --name <trail-name> \\
  --cloud-watch-logs-log-group-arn arn:aws:logs:<region>:<account-id>:log-group:CloudTrail/<trail-name>:* \\
  --cloud-watch-logs-role-arn <cloudtrail-cloudwatch-role-arn> \\
  --region <region>`,
    risk: "CloudWatch Logs ingestion adds cost (~$0.50/GB). Set a retention period on the log group to control spend.",
  },
  "cloudtrail.trail.s3_bucket_no_logging": {
    why: "The S3 bucket storing CloudTrail logs should have server access logging enabled. Without it, access to your audit trail itself is not recorded.",
    console: [
      "Identify the S3 bucket receiving CloudTrail logs",
      "Create a separate logging target bucket (do not log the log bucket into itself)",
      "Open the CloudTrail bucket → Properties → Server access logging → Edit",
      "Enable logging to the target bucket with a clear prefix (e.g. cloudtrail-access-logs/)",
    ],
    cli: `aws s3api put-bucket-logging \\
  --bucket <bucket-name> \\
  --bucket-logging-status '{"LoggingEnabled":{"TargetBucket":"<logging-bucket>","TargetPrefix":"cloudtrail-access-logs/"}}'`,
    risk: "Low operational risk — logging adds a small storage cost to the target bucket.",
  },
  "acm.certificate.expiring": {
    why: "An expiring TLS certificate will break HTTPS for any service using it — load balancers, CloudFront, API Gateway. Browsers will show certificate errors and API clients will fail TLS handshakes.",
    console: [
      "Open ACM → Certificates → select the certificate",
      "Confirm the expiry date and associated services (ELB, CloudFront, etc.)",
      "If DNS-validated and auto-renewal eligible, verify the CNAME validation record still exists in Route 53",
      "If not auto-renewing, request a new certificate and update the listener/distribution before expiry",
    ],
    cli: `# Check certificate status and expiry
aws acm describe-certificate \\
  --certificate-arn <certificate-arn> \\
  --region <region>

# Request a replacement (DNS validation recommended)
aws acm request-certificate \\
  --domain-name <domain-name> \\
  --validation-method DNS \\
  --region <region>`,
    risk: "Replacing a certificate on a live listener requires updating the attachment — plan a brief maintenance window if auto-renewal cannot be restored.",
  },
  "lambda.function.deprecated_runtime": {
    why: "Deprecated Lambda runtimes no longer receive security patches. AWS will eventually block creates/updates and then disable invocation on unsupported runtimes.",
    console: [
      "Open Lambda → Functions → select the function",
      'Click "Configuration" → "General configuration" → Edit',
      "Select a supported runtime (e.g. python3.12, nodejs20.x, java21)",
      "Test thoroughly in a staging alias before updating production",
    ],
    cli: `# Update runtime
aws lambda update-function-configuration \\
  --function-name <function-name> \\
  --region <region> \\
  --runtime python3.12

# Test with a dry-run invocation
aws lambda invoke \\
  --function-name <function-name> \\
  --region <region> \\
  --payload '{}' /tmp/out.json`,
    risk: "Runtime upgrades can break dependencies — test in non-prod. Python 3.12 and Node 20 may require dependency updates.",
  },
  "lambda.function.no_dlq": {
    why: "Without a dead-letter queue (DLQ), failed async invocations are retried until they expire silently. You lose visibility into poison messages and cannot replay failures.",
    console: [
      "Create an SQS queue or SNS topic to use as the DLQ",
      "Open Lambda → Functions → select the function",
      'Click "Configuration" → "Asynchronous invocation" → Edit',
      "Set the dead-letter queue ARN and a maximum retry attempt count (e.g. 2)",
      "Save and trigger a test failure to confirm messages arrive in the DLQ",
    ],
    cli: `# Create DLQ queue
aws sqs create-queue --queue-name <function-name>-dlq --region <region>

# Attach DLQ to function
aws lambda update-function-configuration \\
  --function-name <function-name> \\
  --region <region> \\
  --dead-letter-config TargetArn=<dlq-arn>`,
    risk: "Low risk — adding a DLQ does not change successful invocation behaviour. Monitor DLQ depth after enabling.",
  },
  "lambda.function.public_url": {
    why: "A Lambda function URL with AuthType NONE can be invoked directly from the internet. That may be intended for public APIs, but it should be explicit and protected by app-layer controls.",
    console: [
      "Open Lambda → Functions → select the function",
      'Click "Configuration" → "Function URL"',
      "Change Auth type from NONE to AWS_IAM, or delete the function URL if it is not required",
      "If the endpoint must stay public, confirm application authentication, rate limits, and logging are in place",
    ],
    cli: `# Require IAM authentication on the function URL
aws lambda update-function-url-config \\
  --function-name <function-name> \\
  --region <region> \\
  --auth-type AWS_IAM

# Or remove the public URL entirely
aws lambda delete-function-url-config \\
  --function-name <function-name> \\
  --region <region>`,
    risk: "Changing function URL auth can break unauthenticated clients. Confirm callers before requiring IAM auth or deleting the URL.",
  },
  "ecr.repository.image_scan_disabled": {
    why: "Without scan-on-push, newly published container images may carry known vulnerabilities into ECS, EKS, Lambda container images, or CI artifacts before anyone notices.",
    console: [
      "Open Amazon ECR → Repositories → select the repository",
      'Open "Edit" or "Scanning configuration"',
      "Enable scan on push, or enable enhanced scanning at the registry level",
      "Run an explicit image scan for existing pushed tags",
    ],
    cli: `# Enable basic scan-on-push for the repository
aws ecr put-image-scanning-configuration \\
  --repository-name <repository-name> \\
  --region <region> \\
  --image-scanning-configuration scanOnPush=true

# Scan an existing image tag now
aws ecr start-image-scan \\
  --repository-name <repository-name> \\
  --image-id imageTag=<tag> \\
  --region <region>`,
    risk: "Low runtime risk — enabling scan-on-push does not block image pulls. Existing tags need an explicit scan or enhanced scanning to get coverage.",
  },
  "rds.instance.no_deletion_protection": {
    why: "Without deletion protection, a mistaken `delete-db-instance` call (human error, bad automation, or compromised credentials) permanently destroys the database.",
    console: [
      "Open RDS → Databases → select the instance",
      'Click "Modify"',
      "Enable Deletion protection",
      'Apply immediately or during the next maintenance window',
    ],
    cli: `aws rds modify-db-instance \\
  --db-instance-identifier <instance-id> \\
  --region <region> \\
  --deletion-protection \\
  --apply-immediately`,
    risk: "Deletion protection must be disabled before intentional deletion — this is the intended safety trade-off.",
  },
  "rds.instance.no_multi_az": {
    why: "Single-AZ RDS has no automatic failover during host failure or maintenance. Multi-AZ provides synchronous standby replication and automatic failover, typically within 60–120 seconds.",
    console: [
      "Open RDS → Databases → select the instance",
      'Click "Modify"',
      "Enable Multi-AZ deployment",
      "Review the maintenance window — conversion causes a brief failover (~60s downtime)",
      'Apply during a planned maintenance window',
    ],
    cli: `aws rds modify-db-instance \\
  --db-instance-identifier <instance-id> \\
  --region <region> \\
  --multi-az \\
  --apply-immediately`,
    risk: "Enabling Multi-AZ doubles instance cost and triggers a failover with brief downtime. Plan a maintenance window.",
  },
  "rds.snapshot.public": {
    why: "A public RDS snapshot can be restored by any AWS account. If it contains production data, assume it may already have been copied outside your account.",
    console: [
      "Open RDS → Snapshots → Manual snapshots",
      "Select the snapshot",
      'Open "Actions" → "Share snapshot"',
      "Remove public access / remove the `all` restore permission",
      "Rotate database credentials and review sensitive data exposure",
    ],
    cli: `aws rds modify-db-snapshot-attribute \\
  --db-snapshot-identifier <snapshot-id> \\
  --region <region> \\
  --attribute-name restore \\
  --values-to-remove all`,
    risk: "Remove public access immediately. The change is safe for the snapshot itself, but it cannot revoke copies already made by external accounts.",
  },
  "eks.cluster.public_endpoint": {
    why: "A public EKS API endpoint open to 0.0.0.0/0 allows anyone on the internet to reach Kubernetes authentication and authorization paths. AWS IAM and Kubernetes RBAC still apply, but exposure increases attack surface.",
    console: [
      "Open EKS → Clusters → select the cluster",
      'Open "Networking" → "Manage endpoint access"',
      "Restrict public access CIDRs to known office/VPN/CI ranges, or disable public access after private connectivity is ready",
      "Confirm kubectl access from admin and CI networks before saving",
    ],
    cli: `# Restrict public endpoint to known CIDRs
aws eks update-cluster-config \\
  --name <cluster-name> \\
  --region <region> \\
  --resources-vpc-config endpointPublicAccess=true,publicAccessCidrs=<cidr-1>,<cidr-2>

# Or move to private endpoint only after private connectivity is confirmed
aws eks update-cluster-config \\
  --name <cluster-name> \\
  --region <region> \\
  --resources-vpc-config endpointPublicAccess=false,endpointPrivateAccess=true`,
    risk: "Changing endpoint access can lock out admins or CI runners. Confirm private network or allowed CIDR access before applying.",
  },
  "eks.cluster.control_plane_logging_disabled": {
    why: "EKS control plane logs (API, audit, authenticator, controller manager, scheduler) are required for detective controls and incident response. Without them, Kubernetes API activity is invisible to CloudWatch and downstream SIEM pipelines.",
    console: [
      "Open EKS → Clusters → select the cluster",
      'Open "Observability" → "Control plane logging"',
      "Enable all log types: API, Audit, Authenticator, Controller manager, Scheduler",
      "Confirm logs appear in the configured CloudWatch log group after the next API activity",
    ],
    cli: `aws eks update-cluster-config \\
  --name <cluster-name> \\
  --region <region> \\
  --logging '{"clusterLogging":[{"types":["api","audit","authenticator","controllerManager","scheduler"],"enabled":true}]}'`,
    risk: "Enabling logging increases CloudWatch log ingestion cost. Ensure log retention and alerting are configured.",
  },
  "eks.cluster.secrets_encryption_disabled": {
    why: "Kubernetes secrets store credentials, tokens, and TLS material. Without envelope encryption using KMS, secrets at rest rely solely on etcd volume encryption defaults and are harder to audit or revoke centrally.",
    console: [
      "Open EKS → Clusters → select the cluster",
      'Open "Security" → "Secrets encryption"',
      "Enable encryption with a customer-managed or AWS-managed KMS key",
      "Note: encryption must be enabled at cluster creation for existing clusters — plan a replacement cluster if already running unencrypted",
    ],
    cli: `# Secrets encryption can only be enabled at cluster creation
aws eks create-cluster \\
  --name <cluster-name> \\
  --region <region> \\
  --encryption-config '[{"resources":["secrets"],"provider":{"keyArn":"<kms-key-arn>"}}]' \\
  ...`,
    risk: "Secrets encryption cannot be retrofitted on an existing cluster. Migration requires a new cluster and workload cutover.",
  },
  "secretsmanager.secret.no_rotation": {
    why: "Secrets without automatic rotation stay static indefinitely. Long-lived database passwords and API keys are harder to revoke and more valuable if leaked.",
    console: [
      "Open Secrets Manager → select the secret",
      'Click "Edit rotation"',
      "Enable automatic rotation and choose an interval (e.g. 30 days)",
      "Select or create a Lambda rotation function for the secret type",
      "Run a test rotation to confirm the secret updates and downstream apps reconnect",
    ],
    cli: `# Enable rotation (requires a rotation Lambda — use AWS-managed templates where available)
aws secretsmanager rotate-secret \\
  --secret-id <secret-name> \\
  --region <region> \\
  --rotation-lambda-arn <rotation-lambda-arn> \\
  --rotation-rules AutomaticallyAfterDays=30`,
    risk: "First rotation updates the live secret — verify applications read the latest version from Secrets Manager, not a cached copy.",
  },
  "ssm.parameter.plaintext_secret": {
    why: "This SSM parameter is stored as plaintext String type but its name suggests it holds a secret. Plaintext parameters appear in API responses, CloudTrail logs, and console views without decryption controls.",
    console: [
      "Open Systems Manager → Parameter Store → select the parameter",
      "Create a new SecureString parameter with the same value (KMS-encrypted)",
      "Update applications to read the SecureString parameter",
      "Delete the plaintext parameter after migration",
    ],
    cli: `# Read current value, write as SecureString, then delete original
VALUE=$(aws ssm get-parameter --name <parameter-name> --region <region> --query Parameter.Value --output text)

aws ssm put-parameter \\
  --name <parameter-name> \\
  --region <region> \\
  --type SecureString \\
  --value "$VALUE" \\
  --overwrite`,
    risk: "Rotating to SecureString changes the parameter type in place with --overwrite, but verify apps handle SecureString decryption (kms:Decrypt may be required).",
  },
  "elb.load_balancer.no_access_logs": {
    why: "Load balancer access logs record every request — source IP, path, response code, and TLS cipher. Without them, investigating abuse or debugging routing issues requires guesswork.",
    console: [
      "Create an S3 bucket to receive access logs (separate from application data)",
      "Open EC2 → Load Balancers → select the load balancer",
      'Click "Attributes" → Edit → Access logs',
      "Enable logging, specify the S3 bucket and prefix",
      "Ensure the bucket policy grants ELB log delivery permission for your region",
    ],
    cli: `aws elbv2 modify-load-balancer-attributes \\
  --load-balancer-arn <load-balancer-arn> \\
  --region <region> \\
  --attributes Key=access_logs.s3.enabled,Value=true Key=access_logs.s3.bucket,Value=<bucket-name> Key=access_logs.s3.prefix,Value=elb-logs/`,
    risk: "Low risk — logging adds S3 storage cost. Set a lifecycle policy on the log bucket to expire old logs.",
  },
  "elb.load_balancer.weak_tls_policy": {
    why: "The load balancer uses a legacy SSL/TLS policy that allows outdated cipher suites (TLS 1.0/1.1, weak ciphers). Modern clients and compliance frameworks require TLS 1.2+.",
    console: [
      "Open EC2 → Load Balancers → select the load balancer",
      'Open the "Listeners" tab → select the HTTPS/TLS listener → Edit',
      "Change the security policy to ELBSecurityPolicy-TLS13-1-2-2021-06 or TLS-1-2-2017-01 minimum",
      "Save and verify client connectivity from your oldest supported browsers/API clients",
    ],
    cli: `aws elbv2 modify-listener \\
  --listener-arn <listener-arn> \\
  --region <region> \\
  --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06`,
    risk: "Stricter TLS policies break legacy clients still on TLS 1.0/1.1 — test with your oldest production clients before applying.",
  },
  "sns.topic.no_encryption": {
    why: "SNS topics without KMS encryption deliver messages in plaintext at rest. Any principal with sns:Subscribe or CloudWatch log access can read message contents.",
    console: [
      "Open SNS → Topics → select the topic",
      'Click "Edit" → expand "Encryption"',
      "Enable encryption with the AWS managed key (alias/aws/sns) or a customer-managed KMS key",
      "Update publisher/subscriber IAM policies to include kms:Decrypt and kms:GenerateDataKey if using a CMK",
    ],
    cli: `aws sns set-topic-attributes \\
  --topic-arn <topic-arn> \\
  --region <region> \\
  --attribute-name KmsMasterKeyId \\
  --attribute-value alias/aws/sns`,
    risk: "Enabling encryption requires publishers and subscribers to have KMS permissions — test publish/subscribe after enabling.",
  },
  "sqs.queue.no_encryption": {
    why: "SQS queues without KMS encryption store messages in plaintext at rest. Queue contents may include PII, tokens, or job payloads visible to anyone with sqs:ReceiveMessage.",
    console: [
      "Open SQS → Queues → select the queue",
      'Click "Edit" → expand "Encryption"',
      "Enable server-side encryption with the AWS managed key (alias/aws/sqs) or a customer-managed KMS key",
      "Update producer/consumer IAM roles with kms:Decrypt and kms:GenerateDataKey if using a CMK",
    ],
    cli: `aws sqs set-queue-attributes \\
  --queue-url <queue-url> \\
  --region <region> \\
  --attributes KmsMasterKeyId=alias/aws/sqs`,
    risk: "Enabling encryption on a live queue requires KMS permissions on all producers and consumers — test end-to-end after enabling.",
  },
  "iam.account.no_support_role": {
    why: "CIS expects a dedicated path to open and manage AWS Support cases. Without a role that has AWSSupportAccess, teams often fall back to root or over-privileged users.",
    console: [
      "Open IAM → Roles → Create role",
      "Select AWS account as trusted entity",
      "Attach the AWS managed policy AWSSupportAccess",
      "Name the role (e.g. AWSSupportRole) and create it",
      "Grant assume-role only to break-glass users or your SSO permission set",
    ],
    cli: `aws iam create-role --role-name AWSSupportRole \\
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"arn:aws:iam::ACCOUNT_ID:root"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name AWSSupportRole \\
  --policy-arn arn:aws:iam::aws:policy/AWSSupportAccess`,
    risk: "Low severity — operational friction during incidents, not direct exposure.",
  },
  "iam.account.password_policy_weak": {
    why: "A weak account password policy means IAM users can set short, simple, or reused passwords. Attackers who obtain one password may rotate through accounts trivially.",
    console: [
      "Open IAM → Account settings",
      'Under "Password policy", click "Edit"',
      "Set minimum length to 14, enable uppercase, lowercase, numbers, and symbols",
      "Set password expiration to 90 days and password reuse prevention to 24",
      'Click "Save changes"',
    ],
    cli: `aws iam update-account-password-policy \\
  --minimum-password-length 14 \\
  --require-uppercase-characters \\
  --require-lowercase-characters \\
  --require-numbers \\
  --require-symbols \\
  --allow-users-to-change-password \\
  --max-password-age 90 \\
  --password-reuse-prevention 24`,
    risk: "Weak password policy increases the blast radius of credential-stuffing attacks on console users.",
  },
  "aws.access_analyzer.not_enabled": {
    why: "IAM Access Analyzer continuously monitors resource policies to identify when resources are shared with external principals. Without it, over-permissive cross-account access goes undetected.",
    console: [
      "Open IAM → Access Analyzer",
      'Click "Create analyzer"',
      'Set Zone of trust to "Current account", provide a name',
      'Click "Create analyzer"',
      "Repeat for each region where you have resources",
    ],
    cli: `# Enable in each region
for region in $(aws ec2 describe-regions --query 'Regions[].RegionName' --output text); do
  aws accessanalyzer create-analyzer \\
    --analyzer-name vigil-analyzer \\
    --type ACCOUNT \\
    --region $region 2>/dev/null || true
done`,
    risk: "Without Access Analyzer you have no automated detection when S3 buckets, KMS keys, or IAM roles are made accessible to external accounts.",
  },
  "aws.config.not_enabled": {
    why: "AWS Config records configuration changes to AWS resources over time. Without it there is no change history — auditors cannot verify that a control was in place before an incident, and you cannot roll back to a known-good state.",
    console: [
      "Open AWS Config → Get started",
      "Select 'Record all resources supported in this region'",
      "Create or select an S3 bucket for Config history storage",
      "Create an SNS topic for delivery notifications (optional)",
      'Click "Next" → "Confirm"',
      "Repeat for each active region",
    ],
    cli: `# Create S3 bucket for Config delivery
aws s3 mb s3://config-history-$(aws sts get-caller-identity --query Account --output text)

# Create a Config recorder and delivery channel
aws configservice put-configuration-recorder \\
  --configuration-recorder name=default,roleARN=<config-role-arn>

aws configservice put-delivery-channel \\
  --delivery-channel name=default,s3BucketName=<bucket>

aws configservice start-configuration-recorder --configuration-recorder-name default`,
    risk: "No Config means no configuration change history — a gap auditors will flag and a blocker for SOC 2 CC6.1.",
  },
  "guardduty.open_findings": {
    why: "GuardDuty is enabled but has active (non-archived) findings. Enablement alone does not mean threats are resolved — auditors expect triage and remediation evidence.",
    console: [
      "Open GuardDuty → Findings",
      "Review active findings by severity",
      "Archive false positives with justification; remediate confirmed threats",
      "Document owner and resolution in your incident tracker",
    ],
    cli: `aws guardduty list-findings --detector-id <detector-id> --finding-criteria '{"Criterion":{"archived":{"Eq":["false"]}}}'`,
    risk: "Unaddressed GuardDuty findings may indicate active compromise or misconfiguration.",
  },
  "aws.config.rules_non_compliant": {
    why: "AWS Config is recording but one or more managed rules report NON_COMPLIANT. Enablement without passing rules is insufficient for change-management evidence.",
    console: [
      "Open AWS Config → Rules",
      "Filter by Non-compliant",
      "Remediate each resource or document approved exception",
      "Re-evaluate until compliant or excepted",
    ],
    cli: `aws configservice describe-compliance-by-config-rule --config-rule-names <rule-name>`,
    risk: "Drift from your security baseline may go unnoticed until audit sampling.",
  },
  "ec2.ami.aged": {
    why: "The AMI backing an instance exceeds the age threshold (patch baseline proxy). Stale AMIs often lack current OS patches.",
    console: [
      "Identify instances launched from aged AMIs",
      "Build or adopt a newer hardened AMI",
      "Replace instances via rolling deploy or ASG refresh",
    ],
    cli: `aws ec2 describe-images --owners self --image-ids <ami-id>`,
    risk: "Known CVEs in the base image may affect every instance launched from this AMI.",
  },
  "cloudtrail.event.root_activity": {
    why: "Root credentials were used for an API call. Root bypasses all IAM policies — every root action should be investigated and moved to IAM admin roles.",
    console: [
      "Open CloudTrail → Event history → filter by Root user",
      "Identify the source IP, user agent, and API called",
      "Confirm whether the action was intentional break-glass",
      "Move recurring tasks to IAM admin roles with MFA",
    ],
    cli: `aws cloudtrail lookup-events --lookup-attributes AttributeKey=Username,AttributeValue=Root`,
    risk: "Repeated root use indicates processes still depend on root credentials.",
  },
  "cloudtrail.event.trail_tampering": {
    why: "CloudTrail logging was stopped, deleted, or modified. Gaps in audit logs hide subsequent API activity from investigators and auditors.",
    console: [
      "Open CloudTrail → Trails → verify logging is enabled",
      "Review recent UpdateTrail, StopLogging, or DeleteTrail events",
      "Restore multi-region logging with log file validation",
      "Investigate the IAM principal that made the change",
    ],
    cli: `aws cloudtrail describe-trails\naws cloudtrail get-trail-status --name <trail-name>`,
    risk: "Audit log gaps may violate SOC 2 CC7.2 evidence requirements.",
  },
  "cloudtrail.event.iam_user_policy_attachment": {
    why: "An IAM user policy was attached or detached. Direct user attachments bypass group-based access reviews.",
    console: [
      "Open IAM → Users → select the user → Permissions",
      "Review the attached or detached policy",
      "Move permissions to IAM groups or roles if appropriate",
    ],
    cli: `aws iam list-attached-user-policies --user-name <user>\naws iam list-user-policies --user-name <user>`,
    risk: "Unauthorized policy attachments can grant immediate elevated access.",
  },
  "cloudtrail.event.s3_bucket_policy_change": {
    why: "An S3 bucket policy was changed. Policy edits can expose objects publicly or weaken encryption requirements.",
    console: [
      "Open S3 → bucket → Permissions → Bucket policy",
      "Compare current policy to your approved baseline",
      "Revert unauthorized changes and enable Block Public Access",
    ],
    cli: `aws s3api get-bucket-policy --bucket <bucket-name>`,
    risk: "Public-read or permissive Principal entries can expose data immediately.",
  },
  "cloudtrail.event.iam_role_policy_mutation": {
    why: "An IAM role policy was attached, detached, or edited. Role changes affect every principal that can assume the role.",
    console: [
      "Open IAM → Roles → select the role → Permissions",
      "Review attached managed and inline policy changes",
      "Scope permissions to least privilege",
    ],
    cli: `aws iam list-attached-role-policies --role-name <role>\naws iam list-role-policies --role-name <role>`,
    risk: "Broad role policy changes can affect multiple workloads at once.",
  },
  "cloudtrail.event.security_group_open_to_world": {
    why: "A security group rule was added that opens a port to 0.0.0.0/0 or ::/0. This is often the fastest path to internet-wide exposure.",
    console: [
      "Open EC2 → Security Groups → select the group",
      "Remove or restrict the inbound rule to known CIDRs",
      "Check the Resources tab for affected running instances",
    ],
    cli: `aws ec2 describe-security-groups --group-ids <sg-id>`,
    risk: "Running instances using this group are immediately reachable from the internet.",
  },
  "cloudtrail.event.kms_key_disabled_or_deleted": {
    why: "A KMS key was disabled or scheduled for deletion. Encrypted data, secrets, and logs depending on the key may become unreadable.",
    console: [
      "Open KMS → Customer managed keys → select the key",
      "Cancel pending deletion or re-enable the key",
      "Review key policy and CloudTrail for the actor",
    ],
    cli: `aws kms describe-key --key-id <key-id>\naws kms cancel-key-deletion --key-id <key-id>`,
    risk: "Deleting a key can permanently lock encrypted data.",
  },
  "cloudtrail.event.guardduty_disabled": {
    why: "GuardDuty was disabled or a detector was deleted. Threat detection stops until GuardDuty is re-enabled.",
    console: [
      "Open GuardDuty → Settings → verify detector is enabled",
      "Re-enable in affected regions",
      "Review CloudTrail for who disabled GuardDuty",
    ],
    cli: `aws guardduty list-detectors --region <region>\naws guardduty create-detector --enable --region <region>`,
    risk: "Active threats may go undetected while GuardDuty is off.",
  },
  "cloudtrail.event.config_recorder_stopped": {
    why: "The AWS Config recorder was stopped. Configuration change history stops recording — a gap auditors will notice.",
    console: [
      "Open AWS Config → Settings → verify recorder status",
      "Start the configuration recorder",
      "Confirm delivery channel to S3 is healthy",
    ],
    cli: `aws configservice describe-configuration-recorder-status\naws configservice start-configuration-recorder --configuration-recorder-name default`,
    risk: "Config gaps hide drift from your security baseline.",
  },
  "cloudtrail.event.iam_access_key_created": {
    why: "A new IAM access key was created. Long-lived keys should be owned, rotated, and limited to one active key per user.",
    console: [
      "Open IAM → Users → select the user → Security credentials",
      "Confirm the key was requested by an authorized owner",
      "Delete the key if unauthorized",
    ],
    cli: `aws iam list-access-keys --user-name <user>`,
    risk: "Unauthorized keys grant persistent API access.",
  },
  "cloudtrail.event.s3_public_access_block_disabled": {
    why: "S3 Block Public Access was disabled at the account or bucket level. Buckets may become publicly accessible.",
    console: [
      "Open S3 → Block Public Access settings",
      "Re-enable all four block public access options",
      "Review bucket ACLs and policies for public grants",
    ],
    cli: `aws s3control get-public-access-block --account-id <account-id>`,
    risk: "Public buckets can expose data within minutes of misconfiguration.",
  },
  "cloudtrail.event.lambda_function_created_or_modified": {
    why: "A Lambda function was created or updated. Code, IAM role, or trigger changes can introduce new exposure paths.",
    console: [
      "Open Lambda → select the function → Configuration and Code tabs",
      "Review execution role permissions and environment variables",
      "Confirm triggers and function URLs match your baseline",
    ],
    cli: `aws lambda get-function --function-name <name>\naws lambda get-policy --function-name <name>`,
    risk: "Over-permissive execution roles or public URLs increase blast radius.",
  },
  "cloudtrail.event.ec2_instance_tampering": {
    why: "EC2 instance attributes were changed — user data, security groups, or metadata options may have been weakened.",
    console: [
      "Open EC2 → Instances → select the instance",
      "Review Recent activity and security group attachments",
      "Revert unauthorized changes; require IMDSv2 if metadata was loosened",
    ],
    cli: `aws ec2 describe-instances --instance-ids <instance-id>`,
    risk: "Metadata or SG changes can expose instance credentials or network paths.",
  },
  "cloudtrail.event.rds_instance_created_or_modified": {
    why: "An RDS instance was created or modified. Public accessibility, encryption, or backup settings may have changed.",
    console: [
      "Open RDS → Databases → select the instance",
      "Review Connectivity, Security, and Backup sections",
      "Confirm settings match your database baseline",
    ],
    cli: `aws rds describe-db-instances --db-instance-identifier <id>`,
    risk: "Public RDS endpoints or disabled backups increase data-loss and exfiltration risk.",
  },
  "cloudtrail.event.anomalous_api_volume": {
    why: "CloudTrail recorded an unusual spike in API calls from a principal. This may indicate runaway automation or unauthorized activity.",
    console: [
      "Open CloudTrail → Event history → filter by the flagged principal",
      "Identify the API calls and source IP",
      "Throttle or revoke credentials if activity is malicious",
    ],
    cli: `aws cloudtrail lookup-events --lookup-attributes AttributeKey=Username,AttributeValue=<principal>`,
    risk: "High-volume API activity can indicate credential compromise or destructive automation.",
  },
  "iam.access_inventory_gap": {
    why: "Vigil could not reconcile IAM users, roles, and access keys against a complete inventory (missing collectors or partial scan).",
    console: [
      "Confirm the scan role can list IAM (users, roles, keys)",
      "Re-run a full account scan from Vigil",
      "Compare IAM console user count to Vigil collected count",
    ],
    cli: `aws iam get-account-summary`,
    risk: "Access reviews and evidence packs may omit principals until inventory is complete.",
  },
  "github.repo.no_codeowners": {
    why: "Optional security check: no CODEOWNERS file in standard Git repo paths. SOC 2 change management typically relies on branch protection and required reviews, not CODEOWNERS.",
    console: [
      "Add CODEOWNERS under `/`, `.github/`, or `docs/` if your policy requires code-owner reviews",
      "Or disable under Detection coverage → Optional security checks (git.repo.no_codeowners)",
    ],
    cli: `# Create .github/CODEOWNERS with team ownership lines`,
    risk: "Without CODEOWNERS, code-owner review rules cannot be enforced for this repository.",
  },
  "gitlab.repo.no_codeowners": {
    why: "Optional security check: no CODEOWNERS file in standard Git project paths. SOC 2 change management typically relies on branch protection and required merge request approvals, not CODEOWNERS.",
    console: [
      "Add CODEOWNERS at repo root, `.gitlab/CODEOWNERS`, or `docs/CODEOWNERS` if your policy requires code-owner approvals",
      "Or disable under Detection coverage → Optional security checks (git.repo.no_codeowners)",
    ],
    cli: `# Create CODEOWNERS or .gitlab/CODEOWNERS with team ownership lines`,
    risk: "Without CODEOWNERS, code-owner approval rules cannot be enforced for this project.",
  },
  "aws.securityhub.not_enabled": {
    why: "Security Hub centralizes AWS security findings and posture checks across regions. Without it, security signals stay fragmented across services and are harder to evidence consistently.",
    console: [
      "Open Security Hub in each affected region listed in Scan details",
      'Click "Go to Security Hub" or "Enable Security Hub"',
      "Enable the AWS Foundational Security Best Practices standard",
      "Repeat for each active region, or enable centrally with AWS Organizations",
    ],
    cli: `# Enable Security Hub in each region
for region in $(aws ec2 describe-regions --query 'Regions[].RegionName' --output text); do
  aws securityhub enable-security-hub --region $region 2>/dev/null || true
done`,
    risk: "Without Security Hub, posture checks and service findings are not centralized, making investigation and audit evidence weaker.",
  },
  "ec2.security_group.default_allows_traffic": {
    why: "The default security group is automatically assigned to new instances and network interfaces if no explicit group is specified. If it has rules, any accidentally unconfigured resource inherits inbound or outbound access — often unintentionally.",
    console: [
      "Open EC2 → Security Groups, filter for 'default'",
      "Select the default security group for each VPC",
      'Under "Inbound rules", select all rules → "Delete"',
      'Under "Outbound rules", select all rules → "Delete"',
      "Assign traffic to named security groups on your existing instances",
    ],
    cli: `# List rules on the default SG
SG_ID=$(aws ec2 describe-security-groups \\
  --filters Name=group-name,Values=default Name=vpc-id,Values=<vpc-id> \\
  --query 'SecurityGroups[0].GroupId' --output text)

# Remove all inbound rules
aws ec2 revoke-security-group-ingress --group-id $SG_ID \\
  --ip-permissions "$(aws ec2 describe-security-groups --group-ids $SG_ID \\
    --query 'SecurityGroups[0].IpPermissions' --output json)"

# Remove all outbound rules
aws ec2 revoke-security-group-egress --group-id $SG_ID \\
  --ip-permissions "$(aws ec2 describe-security-groups --group-ids $SG_ID \\
    --query 'SecurityGroups[0].IpPermissionsEgress' --output json)"`,
    risk: "Removing rules from the default SG affects instances that rely on it — verify instance SG assignments before making changes.",
  },
  "ec2.instance.imdsv2_not_required": {
    why: "IMDSv1 is vulnerable to Server-Side Request Forgery (SSRF): an attacker who exploits a web app can request http://169.254.169.254/ and retrieve temporary IAM credentials. IMDSv2 requires a session token obtained via PUT, breaking this attack.",
    console: [
      "Open EC2 → Instances → select the instance",
      'Click "Actions" → "Instance settings" → "Modify instance metadata options"',
      'Set "IMDSv2" to "Required"',
      'Set "Metadata response hop limit" to 1',
      'Click "Save"',
    ],
    cli: `aws ec2 modify-instance-metadata-options \\
  --instance-id <instance-id> \\
  --http-tokens required \\
  --http-put-response-hop-limit 1 \\
  --http-endpoint enabled`,
    risk: "Requiring IMDSv2 only breaks applications that use the old IMDSv1 path without a session token — test in non-prod first.",
  },
  "ec2.ebs.encryption_not_default": {
    why: "Without the default encryption setting, any EBS volume created without an explicit KMS key is unencrypted. Developers and launch templates that omit the encryption flag silently create unencrypted volumes.",
    console: [
      "Open EC2 → Settings (under Account attributes)",
      'Under "EBS encryption", click "Manage"',
      'Check "Enable" and select a default KMS key',
      'Click "Update EBS encryption"',
      "Repeat for each region where you launch EC2 instances",
    ],
    cli: `# Enable default encryption in each region
for region in $(aws ec2 describe-regions --query 'Regions[].RegionName' --output text); do
  aws ec2 enable-ebs-encryption-by-default --region $region
  echo "Enabled in $region"
done`,
    risk: "This only affects new volumes — existing unencrypted volumes require a snapshot copy with encryption enabled to remediate.",
  },
  "ec2.ebs.volume_unencrypted": {
    why: "Existing unencrypted EBS volumes keep data at rest outside your encryption baseline. Enabling encryption by default does not retrofit current volumes.",
    console: [
      "Open EC2 → Volumes and select the affected volume",
      'Click "Actions" → "Create snapshot"',
      "Open Snapshots, select the new snapshot, then copy it with encryption enabled",
      "Create a new volume from the encrypted snapshot",
      "Detach the old volume and attach the encrypted replacement during a maintenance window",
    ],
    cli: `# Step 1: Snapshot the unencrypted volume
aws ec2 create-snapshot --volume-id <volume-id> --description "Encrypt <volume-id>"

# Step 2: Copy snapshot with encryption (use snapshot ID from step 1)
aws ec2 copy-snapshot \\
  --source-region <region> \\
  --source-snapshot-id <snapshot-id> \\
  --encrypted

# Step 3: Create encrypted volume (same AZ as the original)
aws ec2 create-volume \\
  --snapshot-id <encrypted-snapshot-id> \\
  --availability-zone <az>`,
    risk: "Replacing an attached volume can require downtime. Confirm the attachment, mount point, filesystem, and backup plan before cutover.",
  },
};

const identityRemediations: Record<string, Remediation> = {
  "github.org.mfa_not_enforced": {
    why: "Without MFA enforcement, any compromised GitHub account password gives an attacker full write access to your repositories. A single phished developer can push malicious code or delete branches with no second factor stopping them.",
    console: [
      "Go to your GitHub organization page",
      'Click "Settings" → "Authentication security"',
      'Enable "Require two-factor authentication for everyone in your organization"',
      "Members without MFA will be removed and must re-enroll to rejoin",
    ],
    cli: "",
    risk: "Without org-level MFA enforcement, individual members can disable their own MFA and retain full access.",
  },
  "github.org.dormant_members": {
    why: "Dormant members hold valid tokens and SSH keys even when they've left the project or company. Attackers who obtain stale credentials can act as a legitimate insider with no unusual login pattern to detect.",
    console: [
      "Go to your GitHub organization → People",
      'Filter by "Dormant members" or sort by last activity',
      "Review each member and confirm whether they still need access",
      'Remove members who are no longer active via "Remove from organization"',
    ],
    cli: "",
    risk: "Stale memberships are a common vector in insider-threat and ex-employee compromise scenarios.",
  },
  "github.org.outside_collaborators": {
    why: "Outside collaborators are non-organization members who have been granted direct repository access. Unlike org members, their activity is less visible to administrators — they don't appear in org-level member lists and may retain access after a project ends or after they change employers.",
    console: [
      "Go to your GitHub organization → People → Outside collaborators",
      "Review each collaborator — confirm they still need access and which repos they can access",
      "To remove a collaborator: click the three-dot menu → Remove from all repositories",
      "If they still need access, consider inviting them as an org member for better visibility",
    ],
    cli: "",
    risk: "Outside collaborators with stale access can push code, read sensitive repositories, and exfiltrate data without appearing in standard member audit reports.",
  },
  "github.repo.no_branch_protection": {
    why: "Without branch protection, any contributor can push directly to the default branch — bypassing code review, CI checks, and deployment gates. This makes it trivial to introduce unauthorized changes or backdoors.",
    console: [
      "Go to the repository → Settings → Branches",
      'Click "Add rule" under "Branch protection rules"',
      'Enter the default branch name (e.g. "main")',
      'Enable "Require a pull request before merging" and "Require approvals"',
      'Optionally enable "Require status checks" and "Restrict who can push"',
    ],
    cli: "",
    risk: "Unprotected branches allow unauthorized commits to reach production without review or audit trail.",
  },
  "github.repo.no_env_protection": {
    why: "GitHub deployment environments without required reviewers allow workflows to deploy to production without any human approval gate. This bypasses the change management control that ensures at least one person signs off before code reaches production.",
    console: [
      "Go to the repository → Settings → Environments",
      "Click on the environment (e.g. 'production', 'staging')",
      'Enable "Required reviewers" and add the team or individuals who must approve deployments',
      "Set a wait timer if appropriate to prevent immediate re-runs",
      "Save the protection rules",
    ],
    cli: "",
    risk: "Without required reviewers on deployment environments, any GitHub Actions workflow can ship to production without human sign-off — violating SOC2 CC8.1 change management controls.",
  },
  "github.repo.self_merge_allowed": {
    why: "Allowing authors to merge their own pull requests removes the peer review step that catches bugs, backdoors, and security regressions. It is the single most common change-management gap flagged in SOC2 CC8.1 audits.",
    console: [
      "Go to the repository → Settings → Branches",
      "Edit the branch protection rule for your default branch",
      'Enable "Require approvals" and set minimum reviewers to at least 1',
      'Enable "Dismiss stale pull request approvals when new commits are pushed"',
      "Confirm the PR author cannot satisfy the approval requirement",
    ],
    cli: "",
    risk: "Self-merged code bypasses the peer review control required by SOC2 CC8.1 and most change management policies.",
  },
  "github.repo.insufficient_reviews": {
    why: "Merging with fewer approvals than required means the review policy is either misconfigured or being bypassed. Each approval gap is a break in the change-management evidence chain auditors will sample.",
    console: [
      "Go to the repository → Settings → Branches",
      "Edit the branch protection rule for your default branch",
      'Increase "Required approving reviews" to at least 1 (ideally 2)',
      'Enable "Dismiss stale pull request approvals when new commits are pushed"',
      "Review recent merges that bypassed the policy and document exceptions",
    ],
    cli: "",
    risk: "Each under-reviewed merge is a gap in change-management evidence and an opportunity for unauthorized code to reach production.",
  },
  "gitlab.org.mfa_not_enforced": {
    why: "Without group-level MFA enforcement, any compromised GitLab account password gives full write access to your projects. A single phished developer can push malicious code or bypass protected branch rules.",
    console: [
      "Go to your GitLab group → Settings → General",
      'Expand "Permissions and group features"',
      'Enable "Require all users in this group to set up two-factor authentication"',
      "Set a grace period, then enforce — non-compliant members will be locked out until they enroll",
    ],
    cli: "",
    risk: "Without group-level MFA, individual members can remove their own 2FA and retain full repository access.",
  },
  "gitlab.org.dormant_members": {
    why: "Dormant group members retain valid tokens and SSH keys even after leaving the project. Stale access tokens have no expiry by default in GitLab and can be used by an attacker indefinitely.",
    console: [
      "Go to your GitLab group → Members",
      "Sort by 'Last activity' to identify inactive members",
      "Review each dormant member and confirm whether they still need access",
      'Remove inactive members via "Remove member"',
      "Consider enabling token expiration policies for personal access tokens",
    ],
    cli: "",
    risk: "Dormant accounts with persistent tokens are a high-value target for credential-stuffing and ex-employee access.",
  },
  "gitlab.repo.no_branch_protection": {
    why: "Without protected branches, any developer with Maintainer or Owner access can push directly to the default branch, bypassing code review and CI pipelines. This breaks the change-management control chain.",
    console: [
      "Go to the project → Settings → Repository → Protected branches",
      'Click "Protect a branch"',
      'Enter the default branch name (e.g. "main")',
      'Set "Allowed to merge" to "Maintainers" and "Allowed to push" to "No one"',
      'Enable "Code owner approval" if CODEOWNERS is configured',
    ],
    cli: "",
    risk: "Unprotected branches allow direct pushes to production branches without review or audit evidence.",
  },
  "gitlab.repo.self_merge_allowed": {
    why: "When MR authors can merge their own requests, the peer review step that catches bugs and unauthorized changes is eliminated. GitLab's approval rules must explicitly prevent author self-approval to satisfy SOC2 CC8.1.",
    console: [
      "Go to the project → Settings → Merge requests",
      'Enable "Merge request approvals" and set "Required approvals" to at least 1',
      'Enable "Prevent approval by the author" under approval settings',
      'Enable "Prevent approvals by users who add commits"',
      "Save the settings and re-review any pending MRs",
    ],
    cli: "",
    risk: "Author self-approval bypasses the segregation-of-duties control and will fail a SOC2 CC8.1 evidence review.",
  },
  "gitlab.repo.insufficient_reviews": {
    why: "MRs merged below the required approval threshold mean the policy is being bypassed or is misconfigured. Each under-approved merge is a gap in the change-management evidence chain.",
    console: [
      "Go to the project → Settings → Merge requests",
      'Set "Required approvals" to at least 1 (ideally 2 for critical branches)',
      'Enable "Reset approvals on push" to prevent stale approvals',
      "Review the approval rules to ensure they cannot be overridden by project members",
      "Audit recent MRs and document any approved exceptions",
    ],
    cli: "",
    risk: "Under-reviewed merges are evidence gaps that auditors will flag during SOC2 CC8.1 sampling.",
  },
};

function fallbackRemediationFor(checkId: string): Remediation {
  if (checkId.startsWith("iam.role.")) {
    return {
      why: "Review this IAM role's trust and permission policies against your access standards.",
      console: [
        "Open IAM → Roles → select the role",
        'Review "Trust relationships" and "Permissions"',
        "Confirm the configuration matches an approved integration or workload",
      ],
      cli: `aws iam get-role --role-name <role-name>
aws iam list-attached-role-policies --role-name <role-name>
aws iam list-role-policies --role-name <role-name>`,
      risk: "Over-permissive or broadly trusted roles expand blast radius if assumed by the wrong principal.",
    };
  }
  if (checkId.startsWith("iam.user.")) {
    return {
      why: "Review this IAM user's access (console, MFA, keys, and policies).",
      console: ["Open IAM → Users → select the user", 'Review "Security credentials" and "Permissions"'],
      cli: "aws iam get-user --user-name <user>\naws iam list-mfa-devices --user-name <user>\naws iam list-access-keys --user-name <user>",
      risk: "Unresolved identity findings increase risk of unauthorized console or API access.",
    };
  }
  if (checkId.startsWith("ec2.security_group.")) {
    return {
      why: "Review this security group's rules and which ENIs/instances reference it.",
      console: ["Open EC2 → Security Groups → select the group", "Review inbound and outbound rules and the Resources tab"],
      cli: "aws ec2 describe-security-groups --group-ids <sg-id>",
      risk: "Security group changes can immediately affect network reachability for attached resources.",
    };
  }
  return {
    why: "Review this finding and take corrective action based on your security policy.",
    console: ["Open the AWS Console", "Locate the affected resource", "Compare configuration to your baseline"],
    cli: "# Use the service CLI for this resource type — see AWS docs for the matching describe-* API",
    risk: "Unresolved findings increase your attack surface.",
  };
}

const SERVICE_PILL_COLLAPSED_LIMIT = 24;

function ServiceListExpandToggle({
  expanded,
  total,
  hiddenCount,
  onToggle,
}: {
  expanded: boolean;
  total: number;
  hiddenCount: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mb-2 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-800"
    >
      {expanded ? "Show less" : `Show all ${total} services (${hiddenCount} more)`}
    </button>
  );
}

type GrantedServicePill = {
  name: string;
  last_used: string | null;
  days_ago: number | null;
  active: boolean;
};

function GrantedServicePills({ services }: { services: GrantedServicePill[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {services.map((s) => (
        <span
          key={s.name}
          title={s.last_used ? `Last used ${s.days_ago}d ago` : "Never used"}
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${
            s.active ? "border-red-200 bg-red-50 text-red-700" : "border-zinc-200 bg-zinc-50 text-zinc-500"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${s.active ? "bg-red-400" : "bg-zinc-300"}`} />
          {s.name}
          {s.days_ago !== null && <span className="opacity-60">{s.days_ago}d</span>}
        </span>
      ))}
    </div>
  );
}

function CollapsibleGrantedServices({ services }: { services: GrantedServicePill[] }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = services.length > SERVICE_PILL_COLLAPSED_LIMIT;
  const visible = collapsible && !expanded ? services.slice(0, SERVICE_PILL_COLLAPSED_LIMIT) : services;
  const hiddenCount = services.length - SERVICE_PILL_COLLAPSED_LIMIT;

  return (
    <div>
      {collapsible && (
        <ServiceListExpandToggle
          expanded={expanded}
          total={services.length}
          hiddenCount={hiddenCount}
          onToggle={() => setExpanded((v) => !v)}
        />
      )}
      <GrantedServicePills services={visible} />
    </div>
  );
}

function generatePolicyIntro(cloudTrailLogging: boolean) {
  const build =
    "Build suggestion uses IAM last-accessed data and, when available, the latest completed AWS CloudTrail policy-generation job for this role. It does not start a new AWS analysis.";
  const resource = cloudTrailLogging
    ? "Use CloudTrail validation below when you need a fresher job; resource ARNs are only applied when AWS returns concrete (non-template) ARNs."
    : "Without CloudTrail logging, action scope comes from IAM last-accessed only; resources stay *.";
  return `${build} ${resource}`;
}

const SUGGESTED_POLICY_CONNECTOR_ERROR =
  "Could not build the suggested policy because Vigil could not verify the AWS connector permissions. Verify the connector role, then try again.";

function formatSuggestedPolicyError(error: unknown): string {
  const message = formatApiError(error);
  const lower = message.toLowerCase();
  if (
    lower.includes("missing token") ||
    lower.includes("missing credentials") ||
    lower.includes("session expired") ||
    lower.includes("access denied") ||
    lower.includes("accessdenied") ||
    lower.includes("not authorized") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("assume role") ||
    lower.includes("sts:")
  ) {
    return SUGGESTED_POLICY_CONNECTOR_ERROR;
  }
  return message;
}

function KeyActivityCard({ keyData }: { keyData: { key_id: string; last_used: string | null; days_ago: number | null; last_used_service: string | null; last_used_region: string | null; active: boolean } }) {
  const service = keyData.last_used_service ?? "unknown service";
  const region = keyData.last_used_region ?? "unknown region";
  const age = keyData.days_ago != null ? `${keyData.days_ago}d ago` : "recently";

  return (
    <div className={`rounded-lg border px-3 py-2.5 text-xs ${keyData.active ? "border-red-100 bg-red-50" : "border-zinc-200 bg-zinc-50"}`}>
      <div className="font-mono font-semibold text-zinc-700">{keyData.key_id}</div>
      {keyData.last_used ? (
        <>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Last API activity</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-zinc-600">{service}</span>
            <span className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-zinc-600">{region}</span>
            <span className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-zinc-600">{age}</span>
          </div>
        </>
      ) : (
        <div className="mt-1 text-zinc-500">No recorded API activity</div>
      )}
    </div>
  );
}

const AWS_REGION_LABELS: Record<string, string> = {
  "af-south-1": "Cape Town",
  "ap-east-1": "Hong Kong",
  "ap-northeast-1": "Tokyo",
  "ap-northeast-2": "Seoul",
  "ap-northeast-3": "Osaka",
  "ap-south-1": "Mumbai",
  "ap-south-2": "Hyderabad",
  "ap-southeast-1": "Singapore",
  "ap-southeast-2": "Sydney",
  "ap-southeast-3": "Jakarta",
  "ap-southeast-4": "Melbourne",
  "ca-central-1": "Canada",
  "ca-west-1": "Calgary",
  "eu-central-1": "Frankfurt",
  "eu-central-2": "Zurich",
  "eu-north-1": "Stockholm",
  "eu-south-1": "Milan",
  "eu-south-2": "Spain",
  "eu-west-1": "Ireland",
  "eu-west-2": "London",
  "eu-west-3": "Paris",
  "il-central-1": "Tel Aviv",
  "me-central-1": "UAE",
  "me-south-1": "Bahrain",
  "mx-central-1": "Mexico",
  "sa-east-1": "São Paulo",
  "us-east-1": "N. Virginia",
  "us-east-2": "Ohio",
  "us-west-1": "N. California",
  "us-west-2": "Oregon",
};

function RegionPills({ regions }: { regions: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const previewLimit = 8;
  const sorted = [...regions].sort((a, b) => (AWS_REGION_LABELS[a] ?? a).localeCompare(AWS_REGION_LABELS[b] ?? b));
  const hidden = sorted.length - previewLimit;
  const visible = expanded || hidden <= 0 ? sorted : sorted.slice(0, previewLimit);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {visible.map((code) => {
          const name = AWS_REGION_LABELS[code];
          return (
            <div
              key={code}
              title={code}
              className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50/80 px-2.5 py-2"
            >
              <span className="truncate text-xs font-medium text-zinc-800">{name ?? code}</span>
              {name && <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-400">{code}</span>}
            </div>
          );
        })}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
        >
          {expanded ? "Show fewer regions" : `Show all ${sorted.length} regions`}
        </button>
      )}
    </div>
  );
}

function resolvedCli(finding: Finding, clientIp?: string | null): string {
  const arn = finding.resource_arn;
  const roleMatch = arn.match(/:role\/(.+)$/);
  const roleName = roleMatch ? (roleMatch[1].split("/").pop() ?? "") : "";
  const removable = finding.evidence.removable_statements as unknown[] | undefined;
  const hasInline = Array.isArray(removable) && removable.length > 0;
  if (finding.check_id === "iam.role.unused_services_90d" && !hasInline && roleName) {
    return `# Permissions come from managed/attached policies — inline policies have no matching statements.

# 1. See what's attached
aws iam list-attached-role-policies --role-name ${roleName}

# 2. For each attached policy, review its document
aws iam get-policy-version --policy-arn <policy-arn> --version-id v1

# 3. Start CloudTrail policy generation for this role (IAM console: Permissions tab, or API)
aws accessanalyzer start-policy-generation \\
  --policy-generation-details '{"principalArn":"${arn}"}' \\
  --cloud-trail-details '{"trails":["<trail-arn>"]}'

# 4. Poll for the generated policy (takes ~30s)
aws accessanalyzer get-generated-policy --job-id <job-id>`;
  }
  const rem = remediations[finding.check_id] ?? fallbackRemediationFor(finding.check_id);
  const placeholders = buildCliPlaceholders(finding, clientIp);
  let cli = applyCliPlaceholders(rem.cli ?? "", placeholders);
  cli = injectEc2RegionFlags(cli, placeholders["<region>"]);
  return formatCliStepSpacing(cli);
}

function RemediationCliBlock({ finding }: { finding: Finding }) {
  const { data: clientIp } = useQuery({
    queryKey: ["remediation-client-ip"],
    queryFn: fetchClientIpForRemediation,
    staleTime: 300_000,
  });
  const code = useMemo(
    () => resolvedCli(finding, clientIp ?? null),
    [finding.id, finding.check_id, finding.resource_arn, finding.evidence, clientIp],
  );
  return <CliBlock code={code} />;
}

type AttachedPolicyAnalysis = {
  policy_arn: string;
  policy_name: string;
  policy_type: "aws_managed" | "customer_managed";
  granted_services: string[];
  unused_services: string[];
  active_services: string[];
  has_wildcard_action: boolean;
  action: "detach_and_replace" | "edit";
};

type UserAttachedPolicy = {
  policy_arn: string;
  policy_name: string;
  policy_type?: string;
};

function iamPolicyConsoleUrl(policyArn: string): string {
  return `https://console.aws.amazon.com/iam/home#/policies/details/${encodeURIComponent(policyArn)}`;
}

function iamRolePermissionsConsoleUrl(roleArn: string): string {
  const match = roleArn.match(/:role\/(.+)$/);
  const roleName = match ? match[1] : "";
  return `https://console.aws.amazon.com/iam/home#/roles/details/${encodeURIComponent(roleName)}?section=permissions`;
}

function ConsoleLink({ href, children, title }: { href: string; children: React.ReactNode; title: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className="inline-flex flex-shrink-0 items-center gap-1 text-xs font-medium text-sky-600 hover:text-sky-800 hover:underline"
    >
      {children}
      <svg className="h-3 w-3 opacity-70" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
    </a>
  );
}

type BlastRadiusData = {
  resource_type: string;
  confidence: "high" | "medium" | "low";
  // role fields
  days_since_last_assumed?: number | null;
  trust_principals?: string[];
  services?: { name: string; last_used: string | null; days_ago: number | null; active: boolean; in_policy: boolean }[];
  active_service_count?: number;
  unused_service_count?: number;
  has_inline_policies?: boolean;
  attached_policies?: (AttachedPolicyAnalysis | UserAttachedPolicy)[];
  // access key fields
  keys?: { key_id: string; last_used: string | null; days_ago: number | null; last_used_service: string | null; last_used_region: string | null; active: boolean }[];
  // user fields
  has_console_password?: boolean;
  days_inactive?: number | null;
  active_key_count?: number;
  inline_policy_names?: string[];
  // security group fields
  group_id?: string;
  group_name?: string;
  vpc_id?: string;
  region?: string;
  is_default?: boolean;
  affected_instances?: { instance_id: string; instance_type: string | null; state: string; vpc_id: string | null; name: string }[];
  running_count?: number;
  total_count?: number;
  // kms key fields
  key_id?: string;
  alias?: string | null;
  key_state?: string | null;
  rotation_enabled?: boolean;
  dependent_trails?: { name: string; arn: string; region: string; is_multi_region: boolean }[];
  dependent_trail_count?: number;
  // s3 bucket fields
  bucket_name?: string;
  encrypted?: boolean;
  kms_encrypted?: boolean;
  versioning_enabled?: boolean;
  public_access_blocked?: boolean;
  https_only?: boolean;
  logging_enabled?: boolean;
  // rds instance fields
  db_instance_id?: string;
  engine?: string | null;
  storage_encrypted?: boolean;
  publicly_accessible?: boolean;
  backup_retention_period?: number;
  // dynamodb table fields
  table_name?: string;
  pitr_enabled?: boolean;
  // ec2 instance fields
  instance_id?: string;
  instance_type?: string | null;
  state?: string;
  imdsv2_required?: boolean;
  // ebs volume fields
  volume_id?: string;
  size_gib?: number | null;
  volume_type?: string | null;
  attached_instances?: { instance_id: string; state: string; name: string; instance_type: string | null }[];
  // ebs encryption default fields
  existing_unencrypted_count?: number;
  // cloudtrail trail fields
  trail_name?: string;
  home_region?: string;
  is_multi_region?: boolean;
  is_logging?: boolean;
  log_validation_enabled?: boolean;
  kms_key_id?: string | null;
  trail_count?: number;
  existing_trails?: { name: string; home_region: string; is_multi_region: boolean; is_logging: boolean }[];
  // vpc fields (vpc_id and region reused from security_group fields above)
  instance_count?: number;
  // iam root / password policy fields
  min_length?: number | null;
  max_age?: number | null;
  password_reuse_prevention?: number | null;
  // s3 account block fields
  public_bucket_count?: number;
  public_bucket_names?: string[];
  // guardduty fields
  disabled_regions?: string[];
  // identity (GitHub/GitLab)
  provider_type?: string;
  org?: string;
  username?: string;
  source?: string;
  email?: string | null;
  mfa_enabled?: boolean | null;
  repo?: string;
  default_branch?: string;
  has_branch_protection?: boolean;
  required_reviews?: number;
  recent_merge_count?: number;
  active_member_count?: number;
  outside_collaborator_count?: number;
  // session-18 resource detail
  snapshot_id?: string;
  is_public?: boolean;
  image_id?: string;
  domain_name?: string;
  expires_at?: string | null;
  days_until_expiry?: number | null;
  function_name?: string;
  runtime?: string | null;
  has_dlq?: boolean;
  access_logs_enabled?: boolean;
  ssl_policy?: string | null;
  lb_type?: string | null;
  name?: string;
  warnings: string[];
};

const confidenceConfig = {
  high: { label: "Safe to remediate", color: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500", desc: "No active usage detected in the past 90 days." },
  medium: { label: "Review first", color: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-400", desc: "Some recent activity detected — verify before making changes." },
  low: { label: "Active — proceed with caution", color: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500", desc: "Resource was actively used in the last 30 days." },
};

function buildVerdict(data: BlastRadiusData, checkId?: string): { text: string; type: "safe" | "caution" | "warning" } {
  const { resource_type, confidence } = data;

  if (resource_type === "iam_role") {
    const active = data.active_service_count ?? 0;
    const scopePolicy =
      checkId === "iam.role.least_privilege_policy" ||
      checkId === "iam.perm.granted_vs_used";
    if (scopePolicy) {
      if (confidence === "high") {
        return {
          text: "Low recent usage — scoping admin or wildcard grants is unlikely to break active workloads. Validate in non-prod before applying.",
          type: "safe",
        };
      }
      if (confidence === "medium") {
        return {
          text: `Proceed with caution — ${active} service${active !== 1 ? "s" : ""} show recent API use. Review the service list before narrowing permissions.`,
          type: "caution",
        };
      }
      return {
        text: `Do not scope blindly — ${active} service${active !== 1 ? "s" : ""} were actively used in the last 30 days. Check used actions and trust principals first.`,
        type: "warning",
      };
    }
    if (confidence === "high") {
      const never = data.days_since_last_assumed == null;
      return never
        ? { text: "Safe to remove — role has never been assumed and no active service usage detected.", type: "safe" }
        : { text: `Safe to remove — unassumed for ${data.days_since_last_assumed} days with no active service usage.`, type: "safe" };
    }
    if (confidence === "medium") {
      return { text: `Review before removing — ${active} service${active !== 1 ? "s" : ""} show recent activity. Verify the workload before making changes.`, type: "caution" };
    }
    return { text: `Do not remove without verification — ${active} service${active !== 1 ? "s" : ""} were actively used in the last 30 days.`, type: "warning" };
  }

  if (resource_type === "iam_access_key") {
    const key = data.keys?.[0];
    if (confidence === "high") {
      return key?.days_ago != null
        ? { text: `Safe to delete — key unused for ${key.days_ago} days.`, type: "safe" }
        : { text: "Safe to delete — key has never been used.", type: "safe" };
    }
    if (key?.last_used_service && key?.days_ago != null) {
      return { text: `Active key — last used ${key.days_ago} days ago via ${key.last_used_service}. Rotate carefully.`, type: "warning" };
    }
    return { text: "Active key — verify usage before rotating or deleting.", type: "warning" };
  }

  if (resource_type === "iam_user") {
    if (checkId === "iam.user.direct_policy_attachment") {
      return {
        text: "Move permissions to a group or role before detaching — confirm nothing still depends on these user-scoped grants.",
        type: "caution",
      };
    }
    if (checkId === "iam.user.no_mfa") {
      return {
        text: "Safe to require — MFA applies to console sign-in only; IAM access keys and programmatic access are unchanged until keys are rotated separately.",
        type: "safe",
      };
    }
    if (confidence === "high") {
      return data.days_inactive != null
        ? { text: `Safe to disable — user inactive for ${data.days_inactive} days.`, type: "safe" }
        : { text: "Safe to disable — no recorded activity for this user.", type: "safe" };
    }
    if (confidence === "low") return { text: "Active user — verify ownership and dependencies before disabling.", type: "warning" };
    return { text: "Review before disabling — some recent activity detected.", type: "caution" };
  }

  if (resource_type === "security_group") {
    const running = data.running_count ?? 0;
    const total = data.total_count ?? 0;
    if (running > 0) {
      return {
        text: `Restrict with care — ${running} running instance${running !== 1 ? "s" : ""} use this group (${total} total).`,
        type: "warning",
      };
    }
    if (total > 0) {
      if (data.is_default) {
        return {
          text: `${total} instance${total !== 1 ? "s" : ""} attached to this default SG (none running) — confirm explicit SG assignments before clearing rules.`,
          type: "caution",
        };
      }
      return {
        text: `${total} instance${total !== 1 ? "s" : ""} attached, none running — safe to modify.`,
        type: "caution",
      };
    }
    if (data.is_default) {
      return {
        text: "Safe to clear rules — no instances use this VPC's default security group. An empty default SG is recommended so future launches without an explicit group stay locked down.",
        type: "safe",
      };
    }
    return { text: "No instances attached to this security group — safe to update.", type: "safe" };
  }

  if (resource_type === "kms_key") {
    const state = (data.key_state ?? "").toLowerCase();
    if (state === "pendingdeletion") return { text: "Key is pending deletion — cancel deletion before enabling rotation.", type: "caution" };
    if (state === "disabled") return { text: "Key is disabled — re-enable the key before enabling rotation.", type: "caution" };
    return { text: "Safe to enable — KMS key rotation is transparent to applications. AWS retains old key material; no application changes required.", type: "safe" };
  }

  if (resource_type === "s3_bucket") {
    if (checkId === "s3.bucket.no_https_policy") {
      return {
        text: "Safe to enable — AWS SDKs, CLI, and Terraform already use HTTPS. Only clients with explicit http:// URLs would be denied.",
        type: "safe",
      };
    }
    if (confidence === "high") return { text: "Safe to enable — enabling S3 access logging has no impact on bucket access or application behaviour.", type: "safe" };
    if (confidence === "low") return { text: "Review before applying — bucket may have public access patterns that depend on current settings.", type: "warning" };
    return { text: "Verify before applying — this change may affect applications accessing the bucket. See warnings below.", type: "caution" };
  }

  if (resource_type === "rds_instance") {
    if (checkId === "rds.instance.no_multi_az") {
      return { text: "Enabling Multi-AZ causes a brief failover (~60s) and doubles cost — plan a maintenance window.", type: "caution" };
    }
    if (checkId === "rds.instance.no_deletion_protection") {
      return { text: "Safe to enable — deletion protection only blocks accidental deletes; intentional deletion requires disabling it first.", type: "safe" };
    }
    if (confidence === "low") return { text: "High blast radius — encrypting an RDS instance requires creating a new instance from an encrypted snapshot. Plan a maintenance window.", type: "warning" };
    if (confidence === "high") return { text: "Safe to enable — automated backups have no impact on application availability and can be enabled at any time.", type: "safe" };
    return { text: "Verify connectivity before applying — disabling public access removes the external endpoint. Ensure your app connects via VPC.", type: "caution" };
  }

  if (resource_type === "rds_snapshot") {
    return { text: "Remove public restore access immediately — assume external accounts may already have copied the snapshot.", type: "warning" };
  }

  if (resource_type === "eks_cluster") {
    return { text: "Restrict carefully — changing EKS endpoint access can lock out admins and CI unless private access or allowed CIDRs are ready.", type: "caution" };
  }

  if (resource_type === "ecs_cluster") {
    return { text: "Safe to enable — Container Insights adds observability without changing task networking.", type: "safe" };
  }

  if (resource_type === "ecs_service") {
    return { text: "Disabling public IP may break outbound internet access unless NAT or VPC endpoints are configured.", type: "caution" };
  }

  if (resource_type === "ecs_task_definition") {
    return { text: "Removing privileged mode may break agents that require host-level access — test in staging first.", type: "caution" };
  }

  if (resource_type === "dynamodb_table") {
    if (checkId === "dynamodb.table.no_pitr") {
      return { text: "Safe to enable — point-in-time recovery is turned on in place with no downtime or application changes.", type: "safe" };
    }
    return { text: "Safe to enable — DynamoDB encryption at rest updates in place with no downtime. Reads and writes continue during the update.", type: "safe" };
  }

  if (resource_type === "ebs_snapshot") {
    if (checkId === "ec2.ebs.snapshot_public") {
      return { text: "Remove public access immediately — assume the snapshot may already have been copied externally.", type: "warning" };
    }
    return { text: "Safe to encrypt via snapshot copy — no running instances affected.", type: "safe" };
  }

  if (resource_type === "ec2_ami") {
    return { text: "Make private immediately — assume the image may have been copied. Rotate any secrets baked into the AMI.", type: "warning" };
  }

  if (resource_type === "acm_certificate") {
    if (confidence === "low") return { text: "Urgent — certificate expires within a week. Renew now to avoid HTTPS outages.", type: "warning" };
    return { text: "Plan renewal before expiry — update listeners/distributions after issuing a replacement certificate.", type: "caution" };
  }

  if (resource_type === "lambda_function") {
    if (checkId === "lambda.function.deprecated_runtime") {
      return { text: "Test runtime upgrade in a staging alias first — dependency incompatibilities are common.", type: "caution" };
    }
    if (checkId === "lambda.function.public_url") {
      return { text: "Confirm public callers before changing auth — AWS_IAM or URL removal can break unauthenticated integrations.", type: "caution" };
    }
    return { text: "Safe to add — DLQ only captures failed async invocations; successful calls are unaffected.", type: "safe" };
  }

  if (resource_type === "ecr_repository") {
    return { text: "Safe to enable — scan-on-push does not block pulls, but existing tags still need an explicit scan.", type: "safe" };
  }

  if (resource_type === "secrets_manager_secret") {
    return { text: "First rotation updates the live secret — verify applications fetch the latest version from Secrets Manager.", type: "caution" };
  }

  if (resource_type === "ssm_parameter") {
    return { text: "Converting to SecureString is low-risk if apps already use the SSM API — confirm kms:Decrypt on consuming roles.", type: "caution" };
  }

  if (resource_type === "elb_load_balancer") {
    if (checkId === "elb.load_balancer.weak_tls_policy") {
      return { text: "Test with your oldest TLS clients before tightening the listener policy.", type: "caution" };
    }
    return { text: "Safe to enable — access logs add S3 storage cost only; no impact on traffic.", type: "safe" };
  }

  if (resource_type === "sns_topic" || resource_type === "sqs_queue") {
    return { text: "Enable encryption, then verify producers and consumers can still publish and receive messages.", type: "safe" };
  }

  if (resource_type === "ec2_instance") {
    return { text: "Verify application compatibility first — apps using IMDSv1 without a session token will fail. Test in non-prod before applying.", type: "caution" };
  }

  if (resource_type === "ebs_volume") {
    const running = data.running_count ?? 0;
    if (running > 0) return { text: `High blast radius — ${running} running instance(s) attached. Replacing the volume requires downtime unless it is a non-root, remountable volume.`, type: "warning" };
    if (confidence === "high") return { text: "No instances attached — safe to encrypt via snapshot copy with no downtime risk.", type: "safe" };
    return { text: "Instances attached but not running — plan volume replacement during maintenance.", type: "caution" };
  }

  if (resource_type === "ebs_encryption_default") {
    return { text: "Safe to enable — only affects volumes created after this change.", type: "safe" };
  }

  if (resource_type === "cloudtrail_trail") {
    if (checkId === "cloudtrail.trail.s3_bucket_public") {
      return { text: "Remove public access immediately — assume audit logs may have been exposed while the bucket was public.", type: "warning" };
    }
    if (checkId === "cloudtrail.trail.s3_bucket_no_logging") {
      return { text: "Safe to enable — S3 access logging on the log bucket adds visibility with no impact on CloudTrail delivery.", type: "safe" };
    }
    if (checkId === "cloudtrail.trail.no_cloudwatch_logs") {
      return { text: "Safe to enable — real-time alerting only; does not change existing S3 log delivery.", type: "safe" };
    }
    if (confidence === "high") return { text: "Safe to enable — no application impact. Note: CloudTrail storage in S3 incurs a small ongoing cost.", type: "safe" };
    return { text: "Verify CloudTrail's delivery role has the required KMS permissions before applying.", type: "caution" };
  }

  if (resource_type === "cloudtrail_account") {
    if ((data.trail_count ?? 0) === 0) {
      return { text: "No CloudTrail trails found — safe to create a new multi-region trail. No existing logging to disrupt.", type: "safe" };
    }
    return { text: "Existing trails don't meet the multi-region + logging requirement — enable a compliant trail or fix the ones below.", type: "caution" };
  }

  if (resource_type === "vpc") {
    const count = data.instance_count ?? 0;
    return count > 0
      ? { text: "Safe to enable — flow logs add visibility without affecting network traffic.", type: "safe" }
      : { text: "Safe to enable — no instances in this VPC yet.", type: "safe" };
  }

  if (resource_type === "iam_root") {
    if (confidence === "low") return { text: "Check all automation for root credentials before deleting — any process using these keys will immediately break.", type: "warning" };
    return { text: "Safe to apply — no application impact. This change only affects the root identity itself.", type: "safe" };
  }

  if (resource_type === "iam_password_policy") {
    if (confidence === "medium") return { text: "Users with passwords older than the new maximum age will be forced to reset at next login.", type: "caution" };
    return { text: "Safe to update — no current max age policy set, so no forced password resets will occur.", type: "safe" };
  }

  if (resource_type === "s3_account_block") {
    const count = data.public_bucket_count ?? 0;
    if (count > 0) return { text: `${count} bucket(s) are not yet blocking public access at the bucket level — enabling the account block will override them and may break public-read buckets or static websites.`, type: "warning" };
    return { text: "Safe to enable — all buckets already block public access at the bucket level. Account-level block adds a belt-and-suspenders guard.", type: "safe" };
  }

  if (resource_type === "guardduty" || resource_type === "aws_config" || resource_type === "securityhub" || resource_type === "access_analyzer") {
    return { text: "Safe to enable — adds security visibility without impacting existing resources or applications.", type: "safe" };
  }

  if (resource_type === "iam_policy_wildcard_resource") {
    return { text: "Scoping down Resource: * requires knowing which specific ARNs each action needs — test in non-prod before applying to production roles.", type: "caution" };
  }

  if (resource_type === "iam_policy_unattached") {
    return { text: "Safe to delete — policy is not attached to any principal and grants no access.", type: "safe" };
  }

  if (resource_type === "iam_perm_granted_vs_used") {
    if (confidence === "high") return { text: "No service usage recorded in 90 days — high confidence unused permissions can be removed safely.", type: "safe" };
    return { text: "Some services were recently used — verify application behaviour before removing unused permission grants.", type: "caution" };
  }

  if (resource_type === "identity_org") {
    if (checkId?.endsWith("outside_collaborators")) {
      return { text: "Review each outside collaborator — revoking access may break contractors, auditors, or CI bots using personal accounts.", type: "caution" };
    }
    if (checkId?.endsWith("mfa_not_enforced")) {
      return { text: "Org-wide MFA enforcement blocks password-only logins — members must enroll before next sign-in.", type: "caution" };
    }
    return { text: "Removing dormant members revokes access to all org repositories — confirm with owners first.", type: "caution" };
  }

  if (resource_type === "identity_user") {
    if (checkId?.endsWith("mfa_not_enforced")) {
      return { text: "Safe to require MFA — affects console login only; personal access tokens and SSH keys keep working until rotated.", type: "safe" };
    }
    return { text: "Suspending this member immediately revokes repository access — verify they are not on-call or release owner.", type: "caution" };
  }

  if (resource_type === "identity_repo") {
    if (checkId?.endsWith("no_branch_protection")) {
      return { text: "Branch protection blocks direct pushes to the default branch — coordinate with teams using hotfix workflows.", type: "caution" };
    }
    if (checkId?.endsWith("no_env_protection")) {
      return { text: "Environment protection pauses production deploys until approved — align with release managers before enabling.", type: "caution" };
    }
    if (checkId?.endsWith("self_merge_allowed") || checkId?.endsWith("insufficient_reviews")) {
      return { text: "Tighter review rules slow merges but reduce unreviewed code reaching default branch.", type: "caution" };
    }
    return { text: "Low risk — adding CODEOWNERS or review rules does not rewrite history or block existing open PRs.", type: "safe" };
  }

  if (confidence === "high") return { text: "No active usage detected — safe to remediate.", type: "safe" };
  if (confidence === "medium") return { text: "Some recent activity detected — review before making changes.", type: "caution" };
  return { text: "Active resource — proceed with caution.", type: "warning" };
}

const verdictStyle = {
  safe: { card: "border-emerald-200/80 bg-emerald-50/60", text: "text-emerald-900", icon: "text-emerald-500" },
  caution: { card: "border-zinc-200 bg-zinc-50", text: "text-zinc-800", icon: "text-amber-500" },
  warning: { card: "border-red-200/80 bg-red-50/70", text: "text-red-900", icon: "text-red-500" },
};

function VerdictIcon({ type }: { type: "safe" | "caution" | "warning" }) {
  if (type === "safe") return (
    <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  );
  if (type === "caution") return (
    <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
  return (
    <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
    </svg>
  );
}

function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs leading-relaxed text-zinc-600">
      <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-zinc-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
      </svg>
      <span>{children}</span>
    </div>
  );
}

function WhatIfUnavailable({ reason }: { reason: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-700 space-y-2">
      <p className="font-medium text-zinc-900">Not applicable for automated analysis</p>
      <p>{reason}</p>
      <p className="text-xs text-zinc-500">Use Overview and Remediation to assess impact before fixing.</p>
    </div>
  );
}

function BlastRadiusSection({
  accountId,
  finding,
}: {
  accountId: string;
  finding: Finding;
}) {
  const [enabled, setEnabled] = useState(false);
  const [reportTab, setReportTab] = useState<ImpactReportTab>("usage");

  useEffect(() => {
    setEnabled(false);
    setReportTab("usage");
  }, [finding.id, finding.check_id, finding.resource_arn]);

  const { data, isLoading, error } = useQuery<BlastRadiusData>({
    queryKey: ["blast-radius", accountId, finding.resource_arn, finding.check_id, finding.last_seen],
    queryFn: () => api(`/v1/accounts/${accountId}/blast-radius?resource_arn=${encodeURIComponent(finding.resource_arn)}&check_id=${encodeURIComponent(finding.check_id)}`),
    enabled,
    staleTime: 0,
  });

  if (!enabled) {
    return <ImpactAnalysisEmpty onRun={() => setEnabled(true)} />;
  }

  if (isLoading) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 py-12"
        role="status"
        aria-busy="true"
        aria-live="polite"
      >
        <svg
          className="h-5 w-5 animate-spin text-zinc-400"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-xs text-zinc-500">Analyzing impact…</p>
      </div>
    );
  }
  if (error) {
    const message = formatApiError(error);
    const isNetwork =
      error instanceof TypeError ||
      (error instanceof Error && /failed to fetch|networkerror|load failed/i.test(error.message));
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-xs text-red-500 space-y-1">
        <p>{message}</p>
        {isNetwork && (
          <p className="text-red-400">
            Check that the API is running and <code className="font-mono">VITE_API_URL</code> matches your setup
            (e.g. <code className="font-mono">http://localhost:8000</code> locally, or{" "}
            <code className="font-mono">https://api.vigil.cclab.cloud-castles.com</code> on the remote host).
          </p>
        )}
      </div>
    );
  }
  if (!data) return null;

  const verdict = buildVerdict(data, finding.check_id);
  const effectiveConfidence: "high" | "medium" | "low" =
    finding.check_id === "s3.bucket.no_https_policy" || verdict.type === "safe"
      ? "high"
      : data.confidence;
  const visualTone = impactVisualTone(verdict);
  const verdictCopy = impactVerdictCopy(verdict, data, finding.check_id);
  const impactPill = impactConfidencePill(effectiveConfidence, visualTone);
  const normalizedVerdict = verdict.text.toLowerCase().replace(/\s+/g, " ").trim();
  function warningKey(text: string) {
    const n = text.toLowerCase().replace(/\s+/g, " ").trim();
    if ((n.includes("scoping down resource: *") || n.includes("scoping resource: *")) && (n.includes("specific arn") || n.includes("specific resource"))) {
      return "scope-resource-star";
    }
    if (n.includes("running instance") && (n.includes("downtime") || n.includes("replacing") || n.includes("detaching"))) {
      return "ebs-running-downtime";
    }
    if (n.includes("bucket") && n.includes("public access") && n.includes("account") && n.includes("block")) {
      return "s3-public-bucket-block";
    }
    return n;
  }
  const verdictKey = warningKey(normalizedVerdict);
  const seen = new Set<string>();
  const baseWarnings = (data.resource_type === "iam_access_key" ? [] : data.warnings).filter((warning) => {
    if (data.resource_type !== "iam_user") return true;
    const normalized = warning.toLowerCase();
    return !(normalized.startsWith("access key ") && normalized.includes(" used ") && normalized.includes(" deactivate keys before disabling user"));
  });
  const mfaOnlyUserCheck = finding.check_id === "iam.user.no_mfa";
  const keyUsageWarnings =
    !mfaOnlyUserCheck && data.resource_type === "iam_user" && data.keys
      ? data.keys
          .filter((k) => k.last_used && k.days_ago != null)
          .map(
            (k) =>
              `Access key ${k.key_id} shows API activity ${k.days_ago} days ago via ${k.last_used_service ?? "unknown service"}${k.last_used_region ? ` (${k.last_used_region})` : ""} — deactivate keys before disabling user`,
          )
      : [];
  const allNotices = mfaOnlyUserCheck ? [] : [...baseWarnings, ...keyUsageWarnings];
  const rootSafeMinimal = data.resource_type === "iam_root" && verdict.type === "safe";
  const infoRows = rootSafeMinimal ? [] : verdict.type === "safe" ? allNotices : [];
  const warningRows = rootSafeMinimal
    ? []
    : verdict.type === "safe"
      ? []
      : allNotices.filter((warning) => {
    const key = warningKey(warning);
    if (key === verdictKey) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const iamRoleReport = data.resource_type === "iam_role";
  const serviceStats =
    iamRoleReport && data.services && data.services.length > 0
      ? (() => {
          const { recentlyActive, historicallyUsed, likelySafe } = bucketServicesByUsage(data.services);
          return {
            granted: data.services.length,
            recent: recentlyActive.length,
            historical: historicallyUsed.length,
            safe: likelySafe.length,
          };
        })()
      : null;
  const hasTrust = Boolean(data.trust_principals && data.trust_principals.length > 0);
  const rolePolicies = data.attached_policies?.filter((pol): pol is AttachedPolicyAnalysis => "action" in pol) ?? [];
  const hasPolicies = rolePolicies.length > 0;

  return (
    <ImpactAnalysisShell>
      <ImpactVerdictCard
        tone={visualTone}
        title={verdictCopy.title}
        subtitle={verdictCopy.subtitle}
        detail={verdictCopy.detail}
        pill={visualTone === "safe" ? undefined : impactPill}
      />

      {iamRoleReport ? (
        <>
          {serviceStats ? <ImpactUsageStats {...serviceStats} /> : null}
          <ImpactReportTabs active={reportTab} onChange={setReportTab} />
          <div className="impact-report-panel">
            {reportTab === "usage" ? (
              data.services && data.services.length > 0 ? (
                <RoleServiceUsageAnalysis
                  services={data.services}
                  activeCount={data.active_service_count}
                  unusedCount={data.unused_service_count}
                  showStats={false}
                />
              ) : (
                <ImpactReportEmpty message="No service usage recorded for this role." />
              )
            ) : null}

            {reportTab === "dependencies" ? (
              hasTrust || hasPolicies ? (
                <>
                  {hasTrust ? <RoleTrustPrincipals principals={data.trust_principals!} /> : null}
                  {hasPolicies ? (
                    <RolePoliciesAnalysis
                      policies={rolePolicies}
                      renderConsoleLink={(pol) => (
                        <ConsoleLink
                          href={
                            pol.action === "detach_and_replace"
                              ? iamRolePermissionsConsoleUrl(finding.resource_arn)
                              : iamPolicyConsoleUrl(pol.policy_arn)
                          }
                          title={
                            pol.action === "detach_and_replace"
                              ? "Open role permissions in AWS Console to detach this managed policy"
                              : "Open policy in AWS Console to edit"
                          }
                        >
                          {pol.action === "detach_and_replace" ? "Detach + replace" : "Edit policy"}
                        </ConsoleLink>
                      )}
                    />
                  ) : null}
                </>
              ) : (
                <ImpactReportEmpty message="No trust principals or attached policies to review." />
              )
            ) : null}

            {reportTab === "blast" ? (
              <>
                {infoRows.length > 0 ? <BlastRadiusConsiderations items={infoRows} tone="info" /> : null}
                {warningRows.length > 0 ? <BlastRadiusConsiderations items={warningRows} tone="warning" /> : null}
                <p className="text-[11px] text-zinc-500 px-0.5">
                  {data.days_since_last_assumed !== null && data.days_since_last_assumed !== undefined
                    ? `Role last assumed ${data.days_since_last_assumed} days ago`
                    : "Role has never been assumed"}
                </p>
                {infoRows.length === 0 && warningRows.length === 0 ? (
                  <ImpactReportEmpty message="No breakage warnings identified for this remediation." />
                ) : null}
              </>
            ) : null}
          </div>
        </>
      ) : null}

      <div className="space-y-3">
        {data.resource_type === "vpc" && (
          <InfoNote>
            {(data.instance_count ?? 0) === 0
              ? "Log volume and cost are negligible until workloads are added."
              : `${data.instance_count} instance${data.instance_count !== 1 ? "s" : ""} in this VPC will be covered. Flow logs deliver to CloudWatch Logs or S3 — budget ~$0.50/GB for CloudWatch ingestion.`}
          </InfoNote>
        )}

        {infoRows.length > 0 && !iamRoleReport && <BlastRadiusConsiderations items={infoRows} tone="info" />}

        {warningRows.length > 0 && !iamRoleReport && <BlastRadiusConsiderations items={warningRows} tone="warning" />}

        {/* Access key: key list */}
        {data.resource_type === "iam_access_key" && data.keys && data.keys.length > 0 && (
          <div className="space-y-2">
            {data.keys.map((k) => (
              <KeyActivityCard key={k.key_id} keyData={k} />
            ))}
          </div>
        )}

        {/* User: summary (hidden for MFA-only — keys/password are not part of remediation) */}
        {data.resource_type === "iam_user" && !mfaOnlyUserCheck && (
          <div className="space-y-2">
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50">
              <div className="px-3 py-2 text-xs text-zinc-600">
                {data.active_key_count} active access key{data.active_key_count !== 1 ? "s" : ""}
              </div>
              {data.has_console_password && (
                <div className="border-t border-zinc-200 px-3 py-2 text-xs text-zinc-600">
                  Has console password
                </div>
              )}
            </div>
            {((data.attached_policies?.length ?? 0) > 0 || (data.inline_policy_names?.length ?? 0) > 0) && (
              <div>
                <div className="mb-2 text-sm font-semibold text-zinc-700">Direct policy attachments</div>
                <div className="space-y-1.5">
                  {(data.attached_policies ?? []).map((pol) => (
                    <div key={pol.policy_arn} className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-mono text-zinc-700">
                      {pol.policy_name}
                    </div>
                  ))}
                  {(data.inline_policy_names ?? []).map((name) => (
                    <div key={name} className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-mono text-violet-800">
                      {name} <span className="text-violet-600">(inline)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* RDS instance: metadata grid */}
        {data.resource_type === "rds_instance" && (
          <div className="grid grid-cols-3 gap-2 text-xs">
            {([
              ["Instance", data.db_instance_id ?? "—", null],
              ["Engine", data.engine ?? "—", null],
              ["Region", data.region ?? "—", null],
              ["Encrypted", data.storage_encrypted ? "Yes" : "No", data.storage_encrypted],
              ["Public access", data.publicly_accessible ? "Enabled" : "Disabled", !data.publicly_accessible],
              ["Backup retention", data.backup_retention_period != null ? `${data.backup_retention_period}d` : "—", (data.backup_retention_period ?? 0) > 0],
            ] as [string, string, boolean | null][]).map(([label, val, ok]) => (
              <div key={label} className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
                <div className="font-medium text-zinc-400 mb-0.5">{label}</div>
                <div className={`font-mono font-medium truncate ${ok === true ? "text-emerald-700" : ok === false ? "text-red-600" : "text-zinc-700"}`}>{val}</div>
              </div>
            ))}
          </div>
        )}

        {/* DynamoDB table: metadata grid */}
        {data.resource_type === "dynamodb_table" && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            {([
              ["Table", data.table_name ?? "—", null],
              ["Region", data.region ?? "—", null],
              ["Encrypted", data.kms_encrypted ? "Yes" : "No", data.kms_encrypted],
              ["PITR", data.pitr_enabled ? "Enabled" : "Disabled", data.pitr_enabled],
            ] as [string, string, boolean | null][]).map(([label, val, ok]) => (
              <div key={label} className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
                <div className="font-medium text-zinc-400 mb-0.5">{label}</div>
                <div className={`font-mono font-medium truncate ${ok === true ? "text-emerald-700" : ok === false ? "text-red-600" : "text-zinc-700"}`}>{val}</div>
              </div>
            ))}
          </div>
        )}

        {/* EC2 instance: metadata grid */}
        {data.resource_type === "ec2_instance" && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            {([
              ["Instance", data.instance_id ?? "—", null],
              ["Type", data.instance_type ?? "—", null],
              ["State", data.state ?? "—", data.state === "running"],
              ["Region", data.region ?? "—", null],
            ] as [string, string, boolean | null][]).map(([label, val, ok]) => (
              <div key={label} className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
                <div className="font-medium text-zinc-400 mb-0.5">{label}</div>
                <div className={`font-mono font-medium ${ok === true ? "text-emerald-700" : ok === false ? "text-zinc-500" : "text-zinc-700"}`}>{val}</div>
              </div>
            ))}
          </div>
        )}

        {/* EBS volume: metadata + attached instances */}
        {data.resource_type === "ebs_volume" && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-xs">
              {([
                ["Volume", data.volume_id ?? "—", null],
                ["Size", data.size_gib != null ? `${data.size_gib} GiB` : "—", null],
                ["Type", data.volume_type ?? "—", null],
                ["State", data.state ?? "—", null],
                ["Region", data.region ?? "—", null],
                ["Attached", `${(data.attached_instances ?? []).length}`, null],
              ] as [string, string, null][]).map(([label, val]) => (
                <div key={label} className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
                  <div className="font-medium text-zinc-400 mb-0.5">{label}</div>
                  <div className="font-mono font-medium text-zinc-700 truncate">{val}</div>
                </div>
              ))}
            </div>
            {data.attached_instances && data.attached_instances.length > 0 && (
              <div>
                <div className="text-sm font-semibold text-zinc-700 mb-2">
                  Attached instances
                  {(data.running_count ?? 0) > 0 && <span className="ml-2 text-xs font-medium text-red-500">{data.running_count} running</span>}
                </div>
                <div className="space-y-1.5">
                  {data.attached_instances.map((inst) => (
                    <div key={inst.instance_id} className={`flex items-center justify-between rounded-md border px-3 py-2 text-xs ${inst.state === "running" ? "border-red-100 bg-red-50" : "border-zinc-200 bg-zinc-50"}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${inst.state === "running" ? "bg-red-400" : "bg-zinc-300"}`} />
                        <span className="font-mono text-zinc-700 truncate">{inst.name !== inst.instance_id ? inst.name : inst.instance_id}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 pl-2">
                        {inst.instance_type && <span className="text-zinc-400">{inst.instance_type}</span>}
                        <span className={`font-medium ${inst.state === "running" ? "text-red-600" : "text-zinc-400"}`}>{inst.state}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* EBS encryption default: unencrypted volume count */}
        {data.resource_type === "ebs_encryption_default" && (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-3 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-zinc-500">Existing unencrypted volumes</div>
                <p className="mt-1.5 leading-relaxed text-zinc-600">
                  Default encryption applies to <span className="font-medium text-zinc-800">new</span> volumes only.
                  Migrate each existing volume with snapshot copy when ready.
                </p>
              </div>
              <div
                className={`shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-center tabular-nums ${
                  (data.existing_unencrypted_count ?? 0) > 0 ? "text-amber-700" : "text-emerald-700"
                }`}
              >
                <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Count</div>
                <div className="text-xl font-semibold leading-tight">{data.existing_unencrypted_count ?? 0}</div>
              </div>
            </div>
          </div>
        )}

        {/* CloudTrail account: existing non-compliant trails */}
        {data.resource_type === "cloudtrail_account" && (data.trail_count ?? 0) > 0 && (
          <div className="space-y-2">
            <div className="space-y-1.5">
              {(data.existing_trails ?? []).map((trail) => (
                <div key={trail.name} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs">
                  <div className="min-w-0">
                    <div className="truncate font-mono font-medium text-zinc-800">{trail.name}</div>
                    <div className="mt-0.5 text-zinc-400">{trail.home_region}</div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    <span className={`rounded border px-1.5 py-0.5 font-medium ${trail.is_logging ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-zinc-200 bg-white text-zinc-500"}`}>
                      {trail.is_logging ? "Logging" : "Stopped"}
                    </span>
                    <span className={`rounded border px-1.5 py-0.5 font-medium ${trail.is_multi_region ? "border-blue-200 bg-blue-50 text-blue-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                      {trail.is_multi_region ? "Multi-region" : "Single-region"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CloudTrail trail: metadata grid */}
        {data.resource_type === "cloudtrail_trail" && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            {([
              ["Trail", data.trail_name ?? "—", null],
              ["Region", data.home_region ?? "—", null],
              ["Logging", data.is_logging ? "Active" : "Stopped", data.is_logging],
              ["Multi-region", data.is_multi_region ? "Yes" : "No", data.is_multi_region],
              ["Log validation", data.log_validation_enabled ? "Enabled" : "Off", data.log_validation_enabled],
              ["KMS encrypted", data.kms_key_id ? "Yes" : "No", !!data.kms_key_id],
            ] as [string, string, boolean | null][]).map(([label, val, ok]) => (
              <div key={label} className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
                <div className="font-medium text-zinc-400 mb-0.5">{label}</div>
                <div className={`font-mono font-medium ${ok === true ? "text-emerald-700" : ok === false ? "text-zinc-500" : "text-zinc-700"}`}>{val}</div>
              </div>
            ))}
          </div>
        )}

        {/* VPC: metadata */}
        {data.resource_type === "vpc" && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
              <div className="font-medium text-zinc-400 mb-0.5">VPC</div>
              <div className="font-mono font-medium text-zinc-700">{data.vpc_id ?? "—"}</div>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
              <div className="font-medium text-zinc-400 mb-0.5">Region</div>
              <div className="font-mono font-medium text-zinc-700">{data.region ?? "—"}</div>
            </div>
            <div className="col-span-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
              <div className="font-medium text-zinc-400 mb-0.5">Instances in VPC</div>
              <div className="text-2xl font-bold tabular-nums text-zinc-700">{data.instance_count ?? 0}</div>
            </div>
          </div>
        )}

        {/* IAM password policy: current settings */}
        {data.resource_type === "iam_password_policy" && (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
              <div className="font-medium text-zinc-400 mb-0.5">Min length</div>
              <div className="font-mono font-medium text-zinc-700">{data.min_length ?? "none"}</div>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
              <div className="font-medium text-zinc-400 mb-0.5">Max age</div>
              <div className={`font-mono font-medium ${data.max_age ? "text-amber-700" : "text-zinc-400"}`}>{data.max_age ? `${data.max_age}d` : "none"}</div>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
              <div className="font-medium text-zinc-400 mb-0.5">Reuse prevention</div>
              <div className="font-mono font-medium text-zinc-700">{data.password_reuse_prevention ?? "none"}</div>
            </div>
          </div>
        )}

        {/* S3 account-level block: affected buckets */}
        {data.resource_type === "s3_account_block" && (data.public_bucket_count ?? 0) > 0 && (
          <div>
            <div className="mb-2.5 text-xs font-medium text-zinc-500">
              Affected buckets ({data.public_bucket_count})
            </div>
            <div className="flex flex-wrap gap-2">
              {(data.public_bucket_names ?? []).map((name) => (
                <span key={name} className="inline-flex max-w-full items-center rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-xs text-zinc-700">
                  <span className="truncate">{name}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* S3 bucket: posture grid */}
        {data.resource_type === "s3_bucket" && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-xs">
              {([
                ["Encryption", data.encrypted ? "Enabled" : "None", data.encrypted],
                ["KMS", data.kms_encrypted ? "Enabled" : "SSE-S3 / None", data.kms_encrypted],
                ["Public access", data.public_access_blocked ? "Blocked" : "Open", data.public_access_blocked],
                ["HTTPS-only", data.https_only ? "Enforced" : "Not enforced", data.https_only],
                ["Versioning", data.versioning_enabled ? "Enabled" : "Off", data.versioning_enabled],
                ["Logging", data.logging_enabled ? "Enabled" : "Off", data.logging_enabled],
              ] as [string, string, boolean | undefined][]).map(([label, val, ok]) => (
                <div key={label} className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
                  <div className="font-medium text-zinc-400 mb-0.5">{label}</div>
                  <div className={`font-mono font-medium ${ok ? "text-emerald-700" : "text-zinc-500"}`}>{val}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* KMS key: metadata + dependent trails */}
        {data.resource_type === "kms_key" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
                <div className="font-medium text-zinc-400 mb-0.5">Alias</div>
                <div className="font-mono text-zinc-700 truncate">{data.alias ?? "no alias"}</div>
              </div>
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
                <div className="font-medium text-zinc-400 mb-0.5">Key state</div>
                <div className={`font-mono font-medium ${data.key_state === "Enabled" ? "text-emerald-700" : "text-amber-700"}`}>
                  {data.key_state ?? "unknown"}
                </div>
              </div>
            </div>

            {data.dependent_trails && data.dependent_trails.length > 0 ? (
              <div>
                <div className="text-sm font-semibold text-zinc-700 mb-2">
                  Used by CloudTrail ({data.dependent_trail_count})
                </div>
                <div className="space-y-1.5">
                  {data.dependent_trails.map((trail) => (
                    <div key={trail.arn} className="flex items-center justify-between rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
                      <span className="font-mono text-zinc-700 truncate">{trail.name}</span>
                      <div className="flex items-center gap-2 flex-shrink-0 pl-2">
                        <span className="text-zinc-400">{trail.region}</span>
                        {trail.is_multi_region && <span className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">multi-region</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-400">No CloudTrail trails reference this key. Note: S3, RDS, and EBS key associations are not yet tracked per-key in Vigil.</p>
            )}
          </div>
        )}

        {/* Security group: metadata + affected instances */}
        {data.resource_type === "security_group" && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 min-w-0">
                <div className="font-medium text-zinc-400 mb-0.5">Security group</div>
                <div className="font-mono text-zinc-700 truncate" title={data.group_id}>{data.group_id}</div>
                {data.is_default && (
                  <div className="mt-1">
                    <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
                      Default
                    </span>
                  </div>
                )}
              </div>
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 min-w-0">
                <div className="font-medium text-zinc-400 mb-0.5">VPC</div>
                <div className="font-mono text-zinc-700 truncate" title={data.vpc_id ?? undefined}>{data.vpc_id ?? "—"}</div>
              </div>
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 min-w-0">
                <div className="font-medium text-zinc-400 mb-0.5">Region</div>
                <div className="text-zinc-700 truncate" title={data.region}>{AWS_REGION_LABELS[data.region ?? ""] ?? data.region}</div>
                {data.region && AWS_REGION_LABELS[data.region] && (
                  <div className="mt-0.5 font-mono text-[10px] text-zinc-400 truncate">{data.region}</div>
                )}
              </div>
            </div>

            {data.affected_instances && data.affected_instances.length > 0 ? (
              <div>
                <div className="text-sm font-semibold text-zinc-700 mb-2">
                  Exposed instances ({data.total_count})
                  {data.running_count !== undefined && data.running_count > 0 && (
                    <span className="ml-2 text-xs font-medium text-red-500">{data.running_count} running</span>
                  )}
                </div>
                <div className="space-y-1.5">
                  {data.affected_instances.map((inst) => (
                    <div
                      key={inst.instance_id}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-xs ${
                        inst.state === "running"
                          ? "border-red-100 bg-red-50"
                          : "border-zinc-200 bg-zinc-50"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${inst.state === "running" ? "bg-red-400" : "bg-zinc-300"}`} />
                        <span className="font-mono text-zinc-700 truncate">{inst.name !== inst.instance_id ? inst.name : inst.instance_id}</span>
                        {inst.name !== inst.instance_id && <span className="font-mono text-zinc-400 truncate">{inst.instance_id}</span>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 pl-2">
                        {inst.instance_type && <span className="text-zinc-400">{inst.instance_type}</span>}
                        <span className={`font-medium ${inst.state === "running" ? "text-red-600" : "text-zinc-400"}`}>{inst.state}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-xs text-zinc-400">
                {data.is_default
                  ? "No instances in this region are attached to this VPC's default security group."
                  : "No instances currently attached to this security group."}
              </div>
            )}
          </div>
        )}

        {data.resource_type === "ebs_snapshot" && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
              <div className="font-medium text-zinc-400 mb-0.5">Snapshot</div>
              <div className="font-mono font-medium text-zinc-700 truncate">{data.snapshot_id ?? "—"}</div>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
              <div className="font-medium text-zinc-400 mb-0.5">Encrypted</div>
              <div className={`font-mono font-medium ${data.encrypted ? "text-emerald-700" : "text-red-600"}`}>{data.encrypted ? "Yes" : "No"}</div>
            </div>
          </div>
        )}

        {data.resource_type === "ec2_ami" && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 col-span-2">
              <div className="font-medium text-zinc-400 mb-0.5">AMI</div>
              <div className="font-mono font-medium text-zinc-700 truncate">{data.image_id ?? data.name ?? "—"}</div>
            </div>
          </div>
        )}

        {data.resource_type === "acm_certificate" && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 col-span-2">
              <div className="font-medium text-zinc-400 mb-0.5">Domain</div>
              <div className="font-mono font-medium text-zinc-700 truncate">{data.domain_name ?? "—"}</div>
            </div>
            {data.days_until_expiry != null && (
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
                <div className="font-medium text-zinc-400 mb-0.5">Expires in</div>
                <div className={`font-mono font-medium ${data.days_until_expiry <= 7 ? "text-red-600" : "text-amber-700"}`}>{data.days_until_expiry}d</div>
              </div>
            )}
          </div>
        )}

        {data.resource_type === "lambda_function" && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 col-span-2">
              <div className="font-medium text-zinc-400 mb-0.5">Function</div>
              <div className="font-mono font-medium text-zinc-700 truncate">{data.function_name ?? "—"}</div>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
              <div className="font-medium text-zinc-400 mb-0.5">Runtime</div>
              <div className="font-mono font-medium text-zinc-700">{data.runtime ?? "—"}</div>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
              <div className="font-medium text-zinc-400 mb-0.5">DLQ</div>
              <div className={`font-mono font-medium ${data.has_dlq ? "text-emerald-700" : "text-zinc-500"}`}>{data.has_dlq ? "Yes" : "No"}</div>
            </div>
          </div>
        )}

        {data.resource_type === "elb_load_balancer" && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 col-span-2">
              <div className="font-medium text-zinc-400 mb-0.5">Load balancer</div>
              <div className="font-mono font-medium text-zinc-700 truncate">{data.name ?? "—"}</div>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
              <div className="font-medium text-zinc-400 mb-0.5">Access logs</div>
              <div className={`font-mono font-medium ${data.access_logs_enabled ? "text-emerald-700" : "text-zinc-500"}`}>{data.access_logs_enabled ? "On" : "Off"}</div>
            </div>
            {data.ssl_policy && (
              <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
                <div className="font-medium text-zinc-400 mb-0.5">TLS policy</div>
                <div className="font-mono text-[10px] text-zinc-700 truncate">{data.ssl_policy}</div>
              </div>
            )}
          </div>
        )}

        {(data.resource_type === "sns_topic" || data.resource_type === "sqs_queue") && (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs text-zinc-600">
            Region <span className="font-mono font-medium text-zinc-800">{data.region ?? "—"}</span>
            {" · "}
            KMS <span className={`font-mono font-medium ${data.kms_encrypted ? "text-emerald-700" : "text-zinc-500"}`}>{data.kms_encrypted ? "enabled" : "not enabled"}</span>
          </div>
        )}

        {data.resource_type === "identity_repo" && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 col-span-2">
              <div className="font-medium text-zinc-400 mb-0.5">Repository</div>
              <div className="font-mono font-medium text-zinc-700 truncate">{data.repo ?? "—"}</div>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
              <div className="font-medium text-zinc-400 mb-0.5">Default branch</div>
              <div className="font-mono font-medium text-zinc-700">{data.default_branch ?? "main"}</div>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2">
              <div className="font-medium text-zinc-400 mb-0.5">Protection</div>
              <div className={`font-mono font-medium ${data.has_branch_protection ? "text-emerald-700" : "text-zinc-500"}`}>
                {data.has_branch_protection ? `${data.required_reviews ?? 0} reviews` : "None"}
              </div>
            </div>
          </div>
        )}

        {data.resource_type === "identity_user" && (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs text-zinc-600">
            <span className="font-mono font-medium text-zinc-800">{data.username}</span>
            {data.source && <> @ {data.source}</>}
            {data.days_inactive != null && <> · inactive {data.days_inactive}d</>}
          </div>
        )}

        {data.resource_type === "identity_org" && (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs text-zinc-600">
            {data.provider_type === "github" ? "GitHub" : "GitLab"} org{" "}
            <span className="font-mono font-medium text-zinc-800">{data.org}</span>
            {(data.outside_collaborator_count ?? 0) > 0 && (
              <> · {data.outside_collaborator_count} outside collaborator(s)</>
            )}
          </div>
        )}

      </div>
    </ImpactAnalysisShell>
  );
}

export type FindingDrawerTab = "overview" | "resources" | "compliance" | "remediation" | "whatif";

type Tab = FindingDrawerTab;

type MappedControl = {
  framework: string;
  control_id: string;
  title: string;
  description: string;
  guidance: string | null;
  narrative: string | null;
  reference_url: string;
  reference_label: string;
  reference_note?: string | null;
};

type CompositeControlSummary = {
  id: string;
  control_id: string;
  title: string;
  description: string;
  guidance: string | null;
  soc2_criteria: string[];
};

type CheckControlBundle = {
  check_id: string;
  primary: MappedControl | null;
  controls: MappedControl[];
  composites?: CompositeControlSummary[];
  primary_composite?: CompositeControlSummary | null;
};

function compliancePageHref(ctrl: MappedControl, accountId?: string | null) {
  const params = new URLSearchParams({
    framework: ctrl.framework,
    control: ctrl.control_id,
  });
  if (accountId) params.set("account_id", accountId);
  return `/controls?${params}`;
}

function compositeComplianceHref(compositeId: string, accountId?: string | null) {
  const params = new URLSearchParams({ framework: "soc2", composite: compositeId });
  if (accountId) params.set("account_id", accountId);
  return `/controls?${params}`;
}

function mappedControlLabel(ctrl: MappedControl) {
  return `${frameworkLabel(ctrl.framework)} ${ctrl.control_id}`;
}

function ComplianceTabContent({
  checkId,
  accountId,
}: {
  checkId: string;
  accountId?: string | null;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["controls-by-check", checkId],
    queryFn: () => api<CheckControlBundle>(`/v1/controls/by-check/${encodeURIComponent(checkId)}`),
  });

  const primaryComposite = data?.primary_composite ?? null;
  const secondaryComposites = (data?.composites ?? []).filter(
    (c) => !primaryComposite || c.id !== primaryComposite.id,
  );
  const mappedControls = data?.controls ?? [];

  if (isLoading) {
    return (
      <div className={`${drawerPanel} px-4 py-3 text-[13px] text-zinc-500`}>Loading compliance mapping…</div>
    );
  }

  if (isError || !primaryComposite) {
    return (
      <FlowCallout tone="neutral" title="Framework mapping">
        {isError
          ? "Could not load compliance mapping for this check."
          : "This check is not yet mapped to a composite control in Vigil."}
      </FlowCallout>
    );
  }

  const checkDoc = documentationForCheck(checkId);
  const evidenceGuidance = checkDoc?.compliance?.evidenceGuidance ?? DEFAULT_EVIDENCE_GUIDANCE;
  const auditNarrative = checkDoc?.compliance?.auditNarrative ?? null;

  return (
    <div className="space-y-2.5">
      <div className={`${drawerPanel} px-4 py-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-800">
            Composite control
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50/80 px-2.5 py-1 text-[11px] font-medium text-red-700 ring-1 ring-red-200/45">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500/75" aria-hidden />
            Failing
          </span>
        </div>
        <h3 className="mt-2 text-[13px] font-semibold text-zinc-900">{primaryComposite.title}</h3>
        <p className="mt-2 text-[12px] leading-relaxed text-zinc-600">{primaryComposite.description}</p>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          <span className="font-medium text-zinc-600">Guidance: </span>
          {evidenceGuidance}
        </p>
        {mappedControls.length > 0 && (
          <div className="mt-3 border-t border-zinc-100 pt-3">
            <p className="text-[11px] font-medium text-zinc-500">Mapped controls</p>
            <ul className="mt-2 space-y-1">
              {mappedControls.map((c) => (
                <li
                  key={`${c.framework}:${c.control_id}`}
                  className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[12px]"
                >
                  <span className="text-zinc-700">{mappedControlLabel(c)}</span>
                  <Link
                    to={compliancePageHref(c, accountId)}
                    className="shrink-0 text-[11px] font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    View
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3 border-t border-zinc-100 pt-3">
          <Link
            to={compositeComplianceHref(primaryComposite.id, accountId)}
            className="text-[12px] font-medium text-indigo-600 hover:text-indigo-800"
          >
            View on Compliance page →
          </Link>
        </div>
      </div>

      {auditNarrative && (
        <SemanticNarrativeBlock tag="Detection Logic" tone="neutral">
          {auditNarrative}
        </SemanticNarrativeBlock>
      )}

      {secondaryComposites.length > 0 && (
        <div className={`${drawerPanel} px-4 py-3`}>
          <p className="text-[11px] font-medium text-zinc-500">Also contributes to</p>
          <ul className="mt-1.5 space-y-1">
            {secondaryComposites.map((c) => (
              <li key={c.id} className="text-[12px]">
                <Link
                  to={compositeComplianceHref(c.id, accountId)}
                  className="font-medium text-indigo-600 hover:text-indigo-800"
                >
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
type GeneratedPolicy = {
  has_inline_policies: boolean;
  unused_services: string[];
  used_services: string[];
  used_actions?: string[];
  granularity?: "action" | "service";
  statements_removed?: number;
  statements_modified?: number;
  original_policies?: Record<string, unknown>;
  cleaned_policies?: Record<string, unknown>;
  note?: string;
  coverage?: { actions: boolean; resources: boolean };
  source_label?: string;
  access_analyzer_enabled?: boolean;
  advanced_available?: boolean;
  advanced_requested?: boolean;
  advanced_effective?: boolean;
  advanced_note?: string | null;
  improve_via_cloudtrail?: boolean;
  cloudtrail_analysis?: {
    ready: boolean;
    status: "ready" | "no_trail" | "advanced_disabled" | "no_connector";
    message?: string | null;
    logging_trail_count?: number;
    trail_count?: number;
  };
  policy_warnings?: string[];
  used_services_service_only?: string[];
  preserved_service_wildcards?: string[];
  observed_action_count?: number;
  confidence?: "high" | "medium" | "low";
  confidence_note?: string;
  access_analyzer?: {
    available: boolean;
    reason?: string | null;
    region?: string | null;
    job_id?: string | null;
    generation_status?: string | null;
    completed_on?: string | null;
    has_concrete_resources?: boolean;
    placeholder_resources_ignored?: number;
    resource_statements?: { actions: string[]; resources: string[]; placeholder_resources?: string[] }[];
    placeholder_resources?: string[];
  };
};

const POLICY_CONFIDENCE_STYLE: Record<string, string> = {
  high: "border-emerald-200 bg-emerald-50 text-emerald-900",
  medium: "border-amber-200 bg-amber-50 text-amber-900",
  low: "border-zinc-300 bg-zinc-100 text-zinc-700",
};

function PolicyCoverageMeta({ data }: { data: GeneratedPolicy }) {
  const cov = data.coverage ?? { actions: (data.used_actions?.length ?? 0) > 0, resources: false };
  const preserved = data.preserved_service_wildcards ?? [];
  const observed =
    data.observed_action_count ??
    (data.used_actions?.filter((a) => !a.endsWith(":*") && a !== "*").length ?? 0);
  const aaStatements = (data.access_analyzer?.resource_statements ?? []).filter(
    (st) => st.resources.length > 0,
  );
  const hasConcreteResources = data.access_analyzer?.has_concrete_resources ?? cov.resources;
  const [techOpen, setTechOpen] = useState(false);
  const jobCompleted = Boolean(data.access_analyzer?.job_id);
  const showNoJobHint =
    data.access_analyzer && !data.access_analyzer.available && data.access_analyzer.reason;
  const whyCopy =
    preserved.length > 0
      ? "AWS reported recent usage for preserved services but did not return action or resource-level detail for them; Resource remains * where needed."
      : observed > 0 && !cov.resources
        ? "AWS reported recent usage for these services but did not return action or resource-level detail for this role."
        : observed > 0
          ? "AWS returned observed action usage and apply-ready resource detail for this role."
          : "Review the least-privilege proposal against your workload before applying.";

  const confidenceBadge = data.confidence ? (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold capitalize tracking-wide ${
        POLICY_CONFIDENCE_STYLE[data.confidence] ?? POLICY_CONFIDENCE_STYLE.low
      }`}
    >
      {data.confidence} confidence
    </span>
  ) : null;

  return (
    <RemediationDetailCard title="Generation summary" action={confidenceBadge}>
      <div className="flex flex-wrap gap-2">
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
            cov.actions
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {cov.actions ? "✓ Actions scoped" : "✗ Actions not scoped"}
        </span>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
            cov.resources
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-zinc-200 bg-zinc-50 text-zinc-600"
          }`}
        >
          {cov.resources ? "✓ Resource scope applied" : "✕ Resources unchanged"}
        </span>
      </div>
        <div className="mt-4 space-y-3.5 text-[13px] leading-relaxed text-zinc-700">
          <div>
            <div className="mt-1 space-y-1.5 text-zinc-600">
              {data.confidence_note && <p>{data.confidence_note}</p>}
              <p className="text-zinc-500">
                <span className="font-semibold text-zinc-600">Why — </span>
                {whyCopy}
              </p>
              {preserved.length > 0 && (
                <p className="font-mono text-[10px] text-zinc-700">
                  Preserved: {preserved.join(" · ")}
                </p>
              )}
            </div>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-zinc-500">Source</p>
            <p className="mt-1 text-[13px] font-medium leading-relaxed text-zinc-800">
              {data.source_label ?? "IAM last accessed"}
            </p>
          </div>
          {data.access_analyzer?.reason === "in_progress" && (
            <p className="mt-2 rounded-md border border-indigo-200/80 bg-indigo-50/80 px-2 py-1.5 text-indigo-950">
              {policyGenerationReasonLabel("in_progress")}
            </p>
          )}
          {observed > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-zinc-500">Result</p>
              <p className="mt-1 text-[13px] leading-relaxed text-zinc-600">
                {preserved.length > 0
                  ? `Action:* was replaced with ${observed} observed actions. Resource remains *.`
                  : cov.resources
                    ? `${observed} observed actions with resource ARNs where available.`
                    : `${observed} observed actions scoped. Resource remains *.`}
              </p>
            </div>
          )}
      {showNoJobHint && (
        <p className="mt-2 text-amber-900">
          {policyGenerationReasonLabel(data.access_analyzer!.reason) ?? data.access_analyzer!.reason}
        </p>
      )}
      {data.advanced_note && hasConcreteResources && (
        <p className="mt-2 rounded-md border border-emerald-100 bg-emerald-50/70 px-2 py-1.5 text-emerald-950">
          {data.advanced_note}
        </p>
      )}
      {hasConcreteResources && aaStatements.length > 0 && (
        <div className="mt-2 rounded-md border border-emerald-100 bg-emerald-50/70 px-2 py-1.5 text-emerald-950">
          <p className="font-semibold">Apply-ready resource ARNs ({aaStatements.length})</p>
          <ul className="mt-1 space-y-1">
            {aaStatements.slice(0, 4).map((st, i) => (
              <li key={i} className="font-mono text-[10px] leading-snug">
                {st.actions.slice(0, 2).join(", ")}
                {st.actions.length > 2 ? ` +${st.actions.length - 2}` : ""}
                {` → ${st.resources[0]}`}
                {st.resources.length > 1 ? ` +${st.resources.length - 1}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(data.policy_warnings?.length ?? 0) > 0 && (
        <p className="mt-2 rounded-md border border-amber-200/80 bg-amber-50/80 px-2 py-1.5 text-amber-950">
          {data.policy_warnings![0]}
        </p>
      )}
      {(jobCompleted || (data.access_analyzer?.placeholder_resources?.length ?? 0) > 0) && (
        <div className="border-t border-zinc-100 pt-3">
          <button
            type="button"
            onClick={() => setTechOpen((o) => !o)}
            className="text-[12px] font-medium text-zinc-500 hover:text-zinc-800"
          >
            {techOpen ? "Hide" : "Show"} technical details
          </button>
          {techOpen && (
            <div className="mt-2 space-y-1.5 text-[12px] text-zinc-500">
              <p>
                CloudTrail policy generation:{" "}
                {jobCompleted
                  ? "completed"
                  : data.access_analyzer?.reason === "in_progress"
                    ? "in progress"
                    : "none"}
              </p>
              <p>IAM last-accessed: available</p>
              {(data.access_analyzer?.placeholder_resources_ignored ?? 0) > 0 && (
                <p>
                  Resource templates ignored: {data.access_analyzer!.placeholder_resources_ignored} (
                  <span className="font-mono">${"{"}…{"}"}</span> placeholders are not apply-ready)
                </p>
              )}
              {jobCompleted && data.access_analyzer?.job_id && (
                <p className="font-mono">
                  job {data.access_analyzer.job_id}
                  {data.access_analyzer.completed_on ? ` · ${data.access_analyzer.completed_on}` : ""}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      </div>
    </RemediationDetailCard>
  );
}

type GeneratedS3HttpsPolicy = {
  bucket_name: string;
  had_policy: boolean;
  already_has_https_deny: boolean;
  original_policy: Record<string, unknown> | null;
  merged_policy: Record<string, unknown>;
  statement_added: boolean;
};

const ROLE_POLICY_GEN_CHECKS = new Set([
  "iam.role.unused_services_90d",
  "iam.role.least_privilege_policy",
  "iam.perm.granted_vs_used",
]);

const MISLEADING_INLINE_POLICY_NAMES = new Set([
  "AdministratorAccess",
  "PowerUserAccess",
  "ReadOnlyAccess",
  "IAMFullAccess",
  "IAMUserChangePassword",
  "SecurityAudit",
  "ViewOnlyAccess",
]);

function roleShortName(roleArn: string): string {
  const match = roleArn.match(/:role\/(.+)$/);
  return match ? (match[1].split("/").pop() ?? "role") : "role";
}

function suggestedInlinePolicyName(roleArn: string): string {
  const base = roleShortName(roleArn).replace(/[^a-zA-Z0-9+=,.@-]/g, "-");
  return `${base}-scoped`;
}

function policyRenameHint(policyName: string, roleArn: string, narrowed: boolean): string | null {
  if (!narrowed && !MISLEADING_INLINE_POLICY_NAMES.has(policyName)) return null;
  if (MISLEADING_INLINE_POLICY_NAMES.has(policyName)) {
    return `Inline policy name "${policyName}" no longer matches its scope. Consider renaming to ${suggestedInlinePolicyName(roleArn)} when you apply.`;
  }
  if (narrowed && /admin/i.test(policyName)) {
    return `Policy "${policyName}" was narrowed — rename on apply so the name reflects least privilege.`;
  }
  return null;
}

function policyChangeSummary(data: GeneratedPolicy) {
  const removed = data.statements_removed ?? 0;
  const modified = data.statements_modified ?? 0;
  const preserved = data.preserved_service_wildcards ?? [];
  const observed =
    data.observed_action_count ??
    (data.used_actions?.filter((a) => !a.endsWith(":*") && a !== "*").length ?? 0);
  const parts: string[] = [];
  if (removed) parts.push(`${removed} unused statement${removed !== 1 ? "s" : ""} removed`);
  if (modified && observed) {
    if (preserved.length) {
      parts.push(
        `Full admin narrowed to ${observed} observed action${observed !== 1 ? "s" : ""}, with ${preserved.length} service wildcard${preserved.length !== 1 ? "s" : ""} preserved`,
      );
    } else if (data.granularity === "action") {
      parts.push(`Action:* replaced with ${observed} observed action${observed !== 1 ? "s" : ""}`);
    } else {
      const usedServices = data.used_services?.length ?? 0;
      parts.push(`Scoped to ${usedServices} used service${usedServices !== 1 ? "s" : ""}`);
    }
  }
  return parts.length ? parts.join(" · ") : "No changes";
}

type PolicyStatement = { Sid?: string; Effect?: string; Action?: string | string[]; Resource?: string | string[]; [k: string]: unknown };

type PolicyDiffLine = { kind: "context" | "remove" | "add" | "header"; text: string };

function actionService(action: string): string | null {
  const i = action.indexOf(":");
  return i > 0 ? action.slice(0, i).toLowerCase() : null;
}

function isSubsumedByPreservedWildcard(action: string, preserved: Set<string>): boolean {
  if (preserved.has(action.toLowerCase())) return true;
  const svc = actionService(action);
  return svc != null && preserved.has(`${svc}:*`);
}

const POLICY_DIFF_PREVIEW = 14;

function asPolicyList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function diffPolicyField(
  label: string,
  orig: string[],
  clean: string[],
  mode: "removed" | "modified",
  opts?: { preservedServiceWildcards?: string[] },
): PolicyDiffLine[] {
  const lines: PolicyDiffLine[] = [];
  const origSet = new Set(orig);
  const cleanSet = new Set(clean);
  const wildcardNarrowed =
    mode === "modified" && orig.length === 1 && orig[0] === "*" && clean.length > 0 && !clean.includes("*");

  if (wildcardNarrowed && label === "Action") {
    const preservedSet = new Set((opts?.preservedServiceWildcards ?? []).map((a) => a.toLowerCase()));
    const preserved = [...clean].filter((a) => a.endsWith(":*") && preservedSet.has(a.toLowerCase())).sort();
    const observed = [...clean]
      .filter((a) => !isSubsumedByPreservedWildcard(a, preservedSet))
      .sort();
    lines.push({ kind: "header", text: "Removed" });
    lines.push({ kind: "remove", text: `${label}: *` });
    if (observed.length) {
      lines.push({ kind: "header", text: "Added observed actions" });
      for (const item of observed) {
        lines.push({ kind: "add", text: `  ${item}` });
      }
    }
    if (preserved.length) {
      lines.push({ kind: "header", text: "Preserved service wildcards" });
      for (const item of preserved) {
        lines.push({ kind: "add", text: `  ${item}` });
      }
    }
    return lines;
  }

  if (wildcardNarrowed) {
    lines.push({ kind: "remove", text: `${label}: "*"` });
    lines.push({ kind: "add", text: `${label}:` });
    for (const item of [...clean].sort()) {
      lines.push({ kind: "add", text: `  ${item}` });
    }
    return lines;
  }

  if (mode === "removed") {
    if (orig.length === 0) return lines;
    if (orig.length === 1) {
      lines.push({ kind: "remove", text: `${label}: ${orig[0]}` });
      return lines;
    }
    lines.push({ kind: "remove", text: `${label}:` });
    for (const item of orig) lines.push({ kind: "remove", text: `  ${item}` });
    return lines;
  }

  const removed = orig.filter((x) => !cleanSet.has(x));
  const added = clean.filter((x) => !origSet.has(x));
  if (removed.length === 0 && added.length === 0) {
    if (orig.length > 0) lines.push({ kind: "context", text: `${label}: ${orig.join(", ")}` });
    return lines;
  }
  if (removed.length === 1 && added.length === 0) {
    lines.push({ kind: "remove", text: `${label}: ${removed[0]}` });
  } else if (removed.length > 0) {
    lines.push({ kind: "remove", text: `${label}:` });
    for (const item of removed) lines.push({ kind: "remove", text: `  ${item}` });
  }
  if (added.length === 1 && removed.length === 0) {
    lines.push({ kind: "add", text: `${label}: ${added[0]}` });
  } else if (added.length > 0) {
    lines.push({ kind: "add", text: `${label}:` });
    for (const item of added) lines.push({ kind: "add", text: `  ${item}` });
  }
  return lines;
}

function buildNewStatementDiffLines(stmt: PolicyStatement): PolicyDiffLine[] {
  const lines: PolicyDiffLine[] = [];
  if (stmt.Sid) lines.push({ kind: "add", text: `Sid: ${stmt.Sid}` });
  if (stmt.Effect) lines.push({ kind: "add", text: `Effect: ${stmt.Effect}` });
  if (stmt.Principal) {
    const p = typeof stmt.Principal === "string" ? stmt.Principal : "*";
    lines.push({ kind: "add", text: `Principal: ${p}` });
  }
  lines.push(...diffPolicyField("Action", [], asPolicyList(stmt.Action), "modified"));
  lines.push(...diffPolicyField("Resource", [], asPolicyList(stmt.Resource), "modified"));
  return lines;
}

function buildStatementDiffLines(
  orig: PolicyStatement,
  clean: PolicyStatement | null,
  opts: { hideUnchangedResources?: boolean; preservedServiceWildcards?: string[] },
): PolicyDiffLine[] {
  if (!clean) {
    const lines: PolicyDiffLine[] = [];
    if (orig.Sid) lines.push({ kind: "remove", text: `Sid: ${orig.Sid}` });
    if (orig.Effect) lines.push({ kind: "remove", text: `Effect: ${orig.Effect}` });
    lines.push(...diffPolicyField("Action", asPolicyList(orig.Action), [], "removed"));
    lines.push(...diffPolicyField("Resource", asPolicyList(orig.Resource), [], "removed"));
    return lines;
  }

  const lines: PolicyDiffLine[] = [];
  if (orig.Sid) lines.push({ kind: "context", text: `Sid: ${orig.Sid}` });
  if (orig.Effect) lines.push({ kind: "context", text: `Effect: ${orig.Effect}` });
  lines.push(
    ...diffPolicyField("Action", asPolicyList(orig.Action), asPolicyList(clean.Action), "modified", {
      preservedServiceWildcards: opts.preservedServiceWildcards,
    }),
  );

  const origRes = asPolicyList(orig.Resource);
  const cleanRes = asPolicyList(clean.Resource);
  const hideResources =
    opts.hideUnchangedResources &&
    origRes.length === 1 &&
    origRes[0] === "*" &&
    cleanRes.length === 1 &&
    cleanRes[0] === "*";
  if (!hideResources) {
    lines.push(...diffPolicyField("Resource", origRes, cleanRes, "modified"));
  }
  return lines;
}

function PolicyDiffLineRow({ line }: { line: PolicyDiffLine }) {
  if (line.kind === "header") {
    return (
      <div className="border-t border-zinc-200/80 bg-zinc-100/90 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-zinc-500 first:border-t-0">
        {line.text}
      </div>
    );
  }
  const prefix = line.kind === "remove" ? "-" : line.kind === "add" ? "+" : " ";
  const rowClass =
    line.kind === "remove"
      ? "bg-red-50/90 text-red-900"
      : line.kind === "add"
        ? "bg-emerald-50/90 text-emerald-900"
        : "bg-zinc-50/80 text-zinc-600";
  const prefixClass =
    line.kind === "remove" ? "text-red-500" : line.kind === "add" ? "text-emerald-600" : "text-zinc-400";

  return (
    <div className={`flex min-w-0 gap-0 font-mono text-[11px] leading-[1.45] ${rowClass}`}>
      <span className={`w-7 shrink-0 select-none pl-2 text-center font-semibold tabular-nums ${prefixClass}`}>{prefix}</span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all py-px pr-2">{line.text}</span>
    </div>
  );
}

function PolicyStatementDiffBlock({
  title,
  lines,
}: {
  title?: string;
  lines: PolicyDiffLine[];
}) {
  const [expanded, setExpanded] = useState(false);
  const addDetailLines = lines.filter((l) => l.kind === "add" && l.text.startsWith("  "));
  const hiddenAddCount = Math.max(0, addDetailLines.length - POLICY_DIFF_PREVIEW);
  const showCollapse = hiddenAddCount > 0 && !expanded;

  let visible = lines;
  if (showCollapse) {
    let addSeen = 0;
    visible = [];
    for (const line of lines) {
      if (line.kind === "add" && line.text.startsWith("  ")) {
        if (addSeen >= POLICY_DIFF_PREVIEW) continue;
        addSeen += 1;
      }
      visible.push(line);
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200/90">
      {title ? (
        <div className="border-b border-zinc-200/80 bg-zinc-100/80 px-3 py-1.5">
          <span className="font-mono text-[10px] font-medium uppercase tracking-wide text-zinc-500">{title}</span>
        </div>
      ) : null}
      <div className="divide-y divide-zinc-100/60">
        {visible.map((line, i) => (
          <PolicyDiffLineRow key={i} line={line} />
        ))}
      </div>
      {showCollapse && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full border-t border-zinc-200/80 bg-zinc-50 px-3 py-2 text-left font-mono text-[11px] text-zinc-600 hover:bg-zinc-100"
        >
          + {hiddenAddCount} more…
        </button>
      )}
    </div>
  );
}

function PolicyDiffView({
  original,
  cleaned,
  hideUnchangedResources,
  preservedServiceWildcards,
}: {
  original: Record<string, unknown>;
  cleaned: Record<string, unknown>;
  granularity?: "action" | "service";
  hideUnchangedResources?: boolean;
  preservedServiceWildcards?: string[];
}) {
  const sections = Object.entries(original).map(([name, origDoc]) => {
    const origStmts: PolicyStatement[] = (origDoc as { Statement?: PolicyStatement[] })?.Statement ?? [];
    const cleanStmts: PolicyStatement[] = (cleaned as Record<string, { Statement?: PolicyStatement[] }>)?.[name]?.Statement ?? [];
    const changes = origStmts
      .map((stmt, i) => {
        const clean = cleanStmts[i];
        const origJson = JSON.stringify(stmt);
        const cleanJson = clean ? JSON.stringify(clean) : null;
        if (cleanJson && origJson === cleanJson) return null;
        const kind = !clean ? ("removed" as const) : ("modified" as const);
        const lines = buildStatementDiffLines(stmt, clean ?? null, {
          hideUnchangedResources,
          preservedServiceWildcards,
        });
        const title = kind === "removed" ? "Removed — no usage in 90 days" : undefined;
        return { index: i, lines, title };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null && x.lines.length > 0);
    return { name, changes };
  });

  const hasChanges = sections.some((s) => s.changes.length > 0);
  if (!hasChanges) {
    return <p className="text-[12px] text-zinc-500">No inline policy changes.</p>;
  }

  return (
    <div className="space-y-3">
      {sections.map(({ name, changes }) =>
        changes.length === 0 ? null : (
          <div key={name}>
            {sections.length > 1 && (
              <div className="mb-1.5 font-mono text-[11px] font-medium text-zinc-500">{name}</div>
            )}
            <div className="space-y-2">
              {changes.map((change) => (
                <PolicyStatementDiffBlock key={change.index} title={change.title} lines={change.lines} />
              ))}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

type PolicyActionDiff = { removed: string[]; added: string[]; unchanged: number };

function collectPolicyActions(policies: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  for (const doc of Object.values(policies)) {
    const stmts: PolicyStatement[] = (doc as { Statement?: PolicyStatement[] })?.Statement ?? [];
    for (const stmt of stmts) {
      for (const action of asPolicyList(stmt.Action)) {
        if (action !== "*") out.add(action);
      }
    }
  }
  return out;
}

function policyHadStarAction(policies: Record<string, unknown>): boolean {
  for (const doc of Object.values(policies)) {
    const stmts: PolicyStatement[] = (doc as { Statement?: PolicyStatement[] })?.Statement ?? [];
    for (const stmt of stmts) {
      if (asPolicyList(stmt.Action).includes("*")) return true;
    }
  }
  return false;
}

function computePolicyActionDiff(
  original: Record<string, unknown>,
  cleaned: Record<string, unknown>,
): PolicyActionDiff {
  const origSet = collectPolicyActions(original);
  const cleanSet = collectPolicyActions(cleaned);
  const removed: string[] = [];
  if (policyHadStarAction(original)) removed.push("*");
  for (const a of origSet) {
    if (!cleanSet.has(a)) removed.push(a);
  }
  const added: string[] = [];
  for (const a of cleanSet) {
    if (!origSet.has(a)) added.push(a);
  }
  added.sort((a, b) => a.localeCompare(b));
  return { removed, added, unchanged: 0 };
}

function hasGeneratedPolicyChange(
  data: GeneratedPolicy | undefined,
  actionDiff: PolicyActionDiff | null,
): boolean {
  if (!data?.has_inline_policies || !data.original_policies || !data.cleaned_policies || !actionDiff) {
    return false;
  }
  if ((data.statements_modified ?? 0) > 0 || (data.statements_removed ?? 0) > 0) return true;
  return actionDiff.removed.length > 0 || actionDiff.added.length > 0;
}

function groupActionsByService(actions: string[]): { service: string; actions: string[] }[] {
  const map = new Map<string, string[]>();
  for (const action of actions) {
    const svc = actionService(action) ?? "other";
    const label = svc.toUpperCase();
    const list = map.get(label) ?? [];
    list.push(action);
    map.set(label, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([service, acts]) => ({ service, actions: acts.sort((x, y) => x.localeCompare(y)) }));
}

function PolicyWorkspacePaneShell({
  title,
  subtitle,
  onClose,
  closeLabel = "Close panel",
  action,
  children,
  className = "",
  bodyVariant = "default",
  bodySpacing = "default",
  paneAnimated = true,
  bodyAnimated = true,
}: {
  title: string;
  subtitle?: string;
  onClose?: () => void;
  closeLabel?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyVariant?: "default" | "split";
  bodySpacing?: "default" | "relaxed" | "roomy";
  paneAnimated?: boolean;
  bodyAnimated?: boolean;
}) {
  const bodyPad =
    bodySpacing === "roomy" ? "px-7 py-6" : bodySpacing === "relaxed" ? "px-6 py-6" : "px-5 py-5";
  const bodyGap =
    bodySpacing === "roomy" ? "space-y-7" : bodySpacing === "relaxed" ? "space-y-6" : "space-y-5";
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const handleClose = () => {
    if (!onClose || isClosing) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      onClose();
    }, 160);
  };

  const paneAnimationClass = paneAnimated ? "" : "policy-workspace-pane--static";
  const bodyAnimationClass = bodyAnimated ? "policy-workspace-pane__body" : "policy-workspace-pane__body--static";

  return (
    <div className={`policy-workspace-pane ${paneAnimationClass} ${isClosing ? "policy-workspace-pane--exit" : ""} flex min-h-0 min-w-0 flex-col border-l border-zinc-200/90 bg-[#f7f9fc] ${className}`}>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e6ebf2] bg-white px-6 py-4 shadow-sm shadow-zinc-950/[0.02]">
        <div className="min-w-0">
          {subtitle ? (
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400">{subtitle}</p>
          ) : null}
          <h3 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-zinc-900">{title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {onClose ? (
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg border border-zinc-200 bg-white p-2 text-zinc-400 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-700"
              aria-label={closeLabel}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>
      {bodyVariant === "split" ? (
        <div className={`${bodyAnimationClass} flex min-h-0 flex-1 flex-col overflow-hidden`}>{children}</div>
      ) : (
        <div className={`${bodyAnimationClass} min-h-0 flex-1 overflow-y-auto ${bodyPad}`}>
          <div className={bodyGap}>{children}</div>
        </div>
      )}
    </div>
  );
}

function PolicyJsonEditor({
  code,
  downloadName = "suggested-policy.json",
  policySource,
  onPolicySourceChange,
  fillHeight = false,
  maxLines,
  showToolbar = true,
  expandFull = false,
}: {
  code: string;
  downloadName?: string;
  policySource?: "cleaned" | "original";
  onPolicySourceChange?: (source: "cleaned" | "original") => void;
  fillHeight?: boolean;
  maxLines?: number;
  showToolbar?: boolean;
  /** No max-height clip — parent pane scrolls; shows entire document. */
  expandFull?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const allLines = code.split("\n");
  const lines = maxLines ? allLines.slice(0, maxLines) : allLines;
  const truncated = maxLines != null && allLines.length > maxLines;
  const displayLines = lines;
  const hasCode = code.length > 0 && code !== "undefined";

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  const download = () => {
    const blob = new Blob([code], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className={`policy-json-editor--roomy flex flex-col overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-950 shadow-inner ring-1 ring-zinc-800/50 ${
        fillHeight ? "h-full min-h-0" : ""
      } ${expandFull ? "" : ""}`}
    >
      {showToolbar && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          {policySource && onPolicySourceChange ? (
            <PolicyViewToggle
              options={["cleaned", "original"] as const}
              value={policySource}
              onChange={onPolicySourceChange}
              formatLabel={(v) => (v === "cleaned" ? "Cleaned" : "Original")}
              variant="dark"
            />
          ) : (
            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">JSON</span>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={copy}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={download}
              aria-label="Download policy"
              className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1m-4-4-4 4m0 0-4-4m4 4V4"
                />
              </svg>
            </button>
          </div>
        </div>
      )}
      <div
        className={`font-mono text-[12px] leading-[1.7] ${
          expandFull
            ? "min-h-[min(42vh,360px)] overflow-auto"
            : fillHeight
              ? "min-h-0 flex-1 overflow-auto"
              : maxLines
                ? "max-h-[13rem] overflow-auto"
                : "max-h-[min(52vh,480px)] overflow-auto"
        }`}
      >
        {!hasCode ? (
          <div className="flex min-h-[12rem] items-center justify-center px-4 text-[13px] font-medium text-zinc-500">
            Loading policy…
          </div>
        ) : (
        <div className="min-w-max pb-2 pt-1">
          {displayLines.map((line, i) => (
            <div key={i} className="policy-json-row flex hover:bg-zinc-900/80">
              <span className="policy-json-line-num shrink-0 select-none border-r border-zinc-800/80 py-0.5 text-right tabular-nums text-zinc-600">
                {i + 1}
              </span>
              <code className="policy-json-line-code whitespace-pre text-emerald-200/95">{line || " "}</code>
            </div>
          ))}
          {truncated && (
            <div className="border-t border-zinc-800/80 px-4 py-2 text-[11px] text-zinc-500">
              … {allLines.length - maxLines!} more lines
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

const POLICY_DIFF_SERVICE_PREVIEW = 6;

function policyActionLabel(action: string): { verb: string; full: string } {
  const colon = action.indexOf(":");
  if (colon < 0) return { verb: action, full: action };
  return { verb: action.slice(colon + 1), full: action };
}

function PolicyScopedActionList({ actions, servicePrefix }: { actions: string[]; servicePrefix?: string }) {
  const prefix =
    servicePrefix && servicePrefix.length > 0
      ? `${servicePrefix.trim().toLowerCase()}:`
      : null;
  return (
    <ul className="policy-services__action-list">
      {actions.map((action) => {
        const { verb, full } = policyActionLabel(action);
        return (
          <li key={full} className="policy-services__action-item">
            <span className="policy-services__action-mark" aria-hidden>
              +
            </span>
            {prefix ? <span className="policy-services__action-prefix">{prefix}</span> : null}
            <span className="policy-services__action-name" title={full}>
              {verb}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

type PolicyReviewTab = "summary" | "services";

const POLICY_REVIEW_TAB_KEY = "vigil-policy-review-tab";

function loadPreferredPolicyReviewTab(): PolicyReviewTab {
  try {
    const stored = localStorage.getItem(POLICY_REVIEW_TAB_KEY);
    if (stored === "services" || stored === "summary") return stored;
  } catch {
    /* ignore */
  }
  return "summary";
}

function savePreferredPolicyReviewTab(tab: PolicyReviewTab) {
  try {
    localStorage.setItem(POLICY_REVIEW_TAB_KEY, tab);
  } catch {
    /* ignore */
  }
}

function PolicyDiffTabBar({
  tab,
  onChange,
}: {
  tab: PolicyReviewTab;
  onChange: (tab: PolicyReviewTab) => void;
}) {
  const tabs: { id: PolicyReviewTab; label: string }[] = [
    { id: "summary", label: "Summary" },
    { id: "services", label: "Services" },
  ];
  return (
    <div className="policy-review-tabs" role="tablist" aria-label="Policy review">
      {tabs.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          onClick={() => onChange(id)}
          className={`policy-review-tabs__tab ${tab === id ? "policy-review-tabs__tab--active" : ""}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

type PolicyDiffAnalysis = {
  removedWildcard: boolean;
  explicitActionCount: number;
  preservedWildcards: string[];
  groupedExplicit: { service: string; actions: string[] }[];
  resourceScoped: boolean;
  actionsScoped: boolean;
};

type PolicyServiceGroup = {
  service: string;
  actions: string[];
  preservedWildcard: boolean;
};

function buildPolicyDiffAnalysis(diff: PolicyActionDiff, data: GeneratedPolicy): PolicyDiffAnalysis {
  const preservedSet = new Set((data.preserved_service_wildcards ?? []).map((a) => a.toLowerCase()));
  const explicitAdded = diff.added.filter((a) => a !== "*" && !isSubsumedByPreservedWildcard(a, preservedSet));
  const preservedWildcards = [
    ...new Set([
      ...(data.preserved_service_wildcards ?? []),
      ...diff.added.filter((a) => a.endsWith(":*")),
    ]),
  ].sort((a, b) => a.localeCompare(b));
  const cov = data.coverage ?? { actions: explicitAdded.length > 0, resources: false };
  return {
    removedWildcard: diff.removed.includes("*"),
    explicitActionCount: explicitAdded.length,
    preservedWildcards,
    groupedExplicit: groupActionsByService(explicitAdded),
    resourceScoped: cov.resources,
    actionsScoped: cov.actions || explicitAdded.length > 0,
  };
}

function groupPreservedWildcards(actions: string[]): PolicyServiceGroup[] {
  return actions.map((action) => {
    const service = ((actionService(action) ?? action.replace(/:\*$/, "")) || "other").toUpperCase();
    return { service, actions: [action], preservedWildcard: true };
  });
}

function mergePolicyServiceGroups(explicit: { service: string; actions: string[] }[], preserved: string[]): PolicyServiceGroup[] {
  const groups = new Map<string, PolicyServiceGroup>();
  for (const group of explicit) {
    groups.set(group.service, {
      service: group.service,
      actions: [...group.actions],
      preservedWildcard: false,
    });
  }
  for (const group of groupPreservedWildcards(preserved)) {
    const existing = groups.get(group.service);
    if (existing) {
      existing.actions = [...new Set([...existing.actions, ...group.actions])].sort((a, b) => a.localeCompare(b));
      existing.preservedWildcard = true;
    } else {
      groups.set(group.service, group);
    }
  }
  return [...groups.values()].sort((a, b) => a.service.localeCompare(b.service));
}

function PolicyDiffServiceBreakdown({
  diff,
  analysis,
  variant,
  onShowAll,
}: {
  diff: PolicyActionDiff;
  analysis: PolicyDiffAnalysis;
  variant: "preview" | "full";
  onShowAll?: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const grouped = useMemo(
    () =>
      mergePolicyServiceGroups(analysis.groupedExplicit, analysis.preservedWildcards)
        .map((g) => ({
          ...g,
          actions: g.actions.filter(
            (a) => !q || a.toLowerCase().includes(q) || g.service.toLowerCase().includes(q),
          ),
        }))
        .filter((g) => g.actions.length > 0),
    [analysis.groupedExplicit, analysis.preservedWildcards, q],
  );
  const visible =
    variant === "preview" ? grouped.slice(0, POLICY_DIFF_SERVICE_PREVIEW) : grouped;
  const hiddenCount = Math.max(0, grouped.length - POLICY_DIFF_SERVICE_PREVIEW);
  const [expandedService, setExpandedService] = useState<string | null>(null);

  useEffect(() => {
    setExpandedService((prev) => {
      if (!prev) return null;
      return grouped.some((g) => g.service === prev) ? prev : null;
    });
  }, [grouped]);

  return (
    <div className="policy-services">
      <p className="policy-services__label">Service breakdown</p>
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search services…"
          className="policy-services__search"
        />
      </div>
      <div className="policy-services__list divide-y divide-zinc-100">
        {visible.length > 0 ? (
          visible.map(({ service, actions, preservedWildcard }) => {
            const open = expandedService === service;
            const displayName = formatIamServiceDisplayName(service);
            const servicePrefix = service.trim().toLowerCase();
            return (
              <div key={service}>
                <button
                  type="button"
                  onClick={() => setExpandedService(open ? null : service)}
                  className={`policy-services__row-btn ${open ? "policy-services__row-btn--open" : ""}`}
                  aria-expanded={open}
                >
                  <AwsServiceIcon service={service} size={28} className="h-7 w-7 shrink-0 rounded-md bg-white object-contain p-0.5 ring-1 ring-zinc-200/80" />
                  <span className="policy-services__service-name">{displayName}</span>
                  {preservedWildcard ? (
                    <span className="policy-services__preserved-badge">Wildcard preserved</span>
                  ) : (
                    <span className="policy-services__count">
                      <strong>{actions.length}</strong>
                      {actions.length === 1 ? " action" : " actions"}
                    </span>
                  )}
                  <svg
                    className="policy-services__chevron"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {open && (
                  <div className="policy-services__detail">
                    <p className="policy-services__detail-hint">
                      {preservedWildcard
                        ? "Preserved because AWS reported usage but did not return action or resource-level detail."
                        : "Kept in the suggested policy"}
                    </p>
                    <PolicyScopedActionList actions={actions} servicePrefix={servicePrefix} />
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <p className="policy-services__empty">
            {q ? `No services match “${query}”` : "No scoped actions to list."}
          </p>
        )}
        {variant === "preview" && hiddenCount > 0 && onShowAll && (
          <button
            type="button"
            onClick={onShowAll}
            className="policy-services__row-btn text-indigo-700 hover:bg-indigo-50/40"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-zinc-500">
              +
            </span>
            <span className="text-sm font-medium tracking-[-0.01em]">
              {hiddenCount} more service{hiddenCount !== 1 ? "s" : ""}
            </span>
            <svg className="policy-services__chevron ml-auto text-indigo-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        )}
      </div>
      {variant === "full" && diff.removed.includes("*") && (
        <p className="policy-services__footnote">
          Wildcard <code>Action:*</code> was removed from the original policy.
        </p>
      )}
    </div>
  );
}

function PolicyDiffSuggestedPreview({
  previewJson,
  policySource,
  onPolicySourceChange,
  downloadName,
  isRefreshing,
}: {
  previewJson: string;
  policySource: "cleaned" | "original";
  onPolicySourceChange: (source: "cleaned" | "original") => void;
  downloadName: string;
  isRefreshing?: boolean;
}) {
  return (
    <div className="relative">
      {isRefreshing && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-zinc-950/40 backdrop-blur-[1px]">
          <span className="rounded-full bg-zinc-900/90 px-3 py-1.5 text-[12px] font-medium text-zinc-300">
            Refreshing policy…
          </span>
        </div>
      )}
      <PolicyJsonEditor
        code={previewJson}
        downloadName={downloadName}
        policySource={policySource}
        onPolicySourceChange={onPolicySourceChange}
        expandFull
        showToolbar
      />
    </div>
  );
}

function PolicyVisualDiffExplorer({
  diff,
  data,
  previewJson,
  policySource,
  onPolicySourceChange,
  downloadName,
  isRefreshing,
}: {
  diff: PolicyActionDiff;
  data: GeneratedPolicy;
  previewJson: string;
  policySource: "cleaned" | "original";
  onPolicySourceChange: (source: "cleaned" | "original") => void;
  downloadName: string;
  isRefreshing?: boolean;
}) {
  const [tab, setTab] = useState<PolicyReviewTab>(() => loadPreferredPolicyReviewTab());
  const analysis = useMemo(() => buildPolicyDiffAnalysis(diff, data), [diff, data]);

  const setReviewTab = (next: PolicyReviewTab) => {
    setTab(next);
    savePreferredPolicyReviewTab(next);
  };

  return (
    <div className="space-y-6">
      <PolicyDiffTabBar tab={tab} onChange={setReviewTab} />

      {tab === "summary" && (
        <PolicyDiffSuggestedPreview
          previewJson={previewJson}
          policySource={policySource}
          onPolicySourceChange={onPolicySourceChange}
          downloadName={downloadName}
          isRefreshing={isRefreshing}
        />
      )}

      {tab === "services" && (
        <PolicyDiffServiceBreakdown diff={diff} analysis={analysis} variant="full" />
      )}
    </div>
  );
}

function SuggestedPolicyLoadingCard({
  title = "Building least-privilege proposal",
  description = "Reviewing IAM access data and recent usage for this role.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div
      className="policy-preparing-card flex min-h-[16rem] flex-col items-center justify-center gap-3 rounded-xl border border-zinc-200 bg-white px-6 py-12 text-center shadow-sm shadow-zinc-950/[0.03]"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-indigo-50" aria-hidden>
        <span className="policy-preparing-bar block h-full w-1/2 rounded-full bg-indigo-500/70" />
      </div>
      <div>
        <p className="text-[13px] font-semibold text-zinc-900">{title}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">{description}</p>
      </div>
    </div>
  );
}

function ReviewPolicyButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex shrink-0 items-center justify-center rounded-lg border border-[#d8e0ec] bg-white px-3.5 py-2 text-[11px] font-semibold text-[#111827] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-[#cbd5e1] hover:bg-[#f8fafc]"
    >
      Review policy
    </button>
  );
}

function SuggestedPolicyWorkspace({
  accountId,
  finding,
  cloudTrailLogging,
  showPolicyChangePane,
  onOpenPolicyChangePane,
  onClosePolicyChangePane,
  onCloseWorkspace,
}: {
  accountId: string;
  finding: Finding;
  cloudTrailLogging: boolean;
  showPolicyChangePane: boolean;
  onOpenPolicyChangePane: () => void;
  onClosePolicyChangePane: () => void;
  onCloseWorkspace: () => void;
}) {
  const [policySource, setPolicySource] = useState<"cleaned" | "original">("cleaned");
  const { data, isLoading, error, refetch, isFetching } = useQuery<GeneratedPolicy>({
    queryKey: ["generated-policy", accountId, finding.resource_arn, finding.last_seen],
    queryFn: () =>
      api(
        `/v1/accounts/${accountId}/roles/generated-policy?role_arn=${encodeURIComponent(finding.resource_arn)}&advanced=true`,
      ),
    enabled: true,
    staleTime: 0,
  });

  const cleanedDoc =
    data?.cleaned_policies && Object.keys(data.cleaned_policies).length === 1
      ? Object.values(data.cleaned_policies)[0]
      : data?.cleaned_policies;
  const originalDoc =
    data?.original_policies && Object.keys(data.original_policies).length === 1
      ? Object.values(data.original_policies)[0]
      : data?.original_policies;
  const previewJson = useMemo(() => {
    const doc = policySource === "cleaned" ? cleanedDoc : originalDoc;
    if (doc == null) return "";
    try {
      return JSON.stringify(doc, null, 2);
    } catch {
      return "";
    }
  }, [policySource, cleanedDoc, originalDoc]);

  const actionDiff =
    data?.original_policies && data?.cleaned_policies
      ? computePolicyActionDiff(data.original_policies, data.cleaned_policies)
      : null;
  const preparingPolicy = isLoading && !data;
  const showPolicyData = !!data && !error;
  const canReviewGeneratedPolicy = Boolean(
    showPolicyData &&
      data?.has_inline_policies &&
      data?.original_policies &&
      data?.cleaned_policies &&
      actionDiff,
  );

  return (
    <>
      <PolicyWorkspacePaneShell
        title="Least-privilege proposal"
        subtitle="Remediation"
        className="min-w-0 flex-[1.1]"
        onClose={onCloseWorkspace}
        closeLabel="Close least-privilege proposal"
        action={
          canReviewGeneratedPolicy && !showPolicyChangePane ? (
            <ReviewPolicyButton onOpen={onOpenPolicyChangePane} />
          ) : null
        }
      >
        {preparingPolicy && <SuggestedPolicyLoadingCard />}
        {error && !preparingPolicy && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-[13px] leading-relaxed text-red-700">
            <p className="font-semibold text-red-800">Could not build least-privilege proposal</p>
            <p className="mt-1">{formatSuggestedPolicyError(error)}</p>
          </div>
        )}
        {showPolicyData && (
          <div className="policy-reveal-stack space-y-5">
            <PolicyCoverageMeta data={data} />
            <PolicyCloudTrailStartAction
              findingId={finding.id}
              accountId={accountId}
              roleArn={finding.resource_arn}
              data={data}
              onRefresh={() => void refetch()}
            />
            {data.has_inline_policies && data.cleaned_policies && !canReviewGeneratedPolicy && !showPolicyChangePane && (
              <RemediationDetailCard title="Policy preview">
                <PolicyJsonEditor
                  code={previewJson}
                  downloadName={`${roleShortName(finding.resource_arn)}-${policySource}.json`}
                  policySource={policySource}
                  onPolicySourceChange={setPolicySource}
                />
              </RemediationDetailCard>
            )}
            {data.granularity === "service" && !data.access_analyzer?.job_id && (
              <p className="text-[12px] leading-relaxed text-zinc-500">
                Per-action usage not available yet — scoped to services with recorded activity. Run another scan to refresh.
              </p>
            )}
          </div>
        )}
      </PolicyWorkspacePaneShell>

      {showPolicyChangePane &&
        showPolicyData &&
        data.has_inline_policies &&
        data.original_policies &&
        data.cleaned_policies &&
        actionDiff && (
        <PolicyWorkspacePaneShell
          title="Generated policy"
          subtitle="Review policy"
          className="min-w-0 flex-[1]"
          bodySpacing="roomy"
          onClose={onClosePolicyChangePane}
          closeLabel="Close generated policy"
          paneAnimated={false}
          bodyAnimated={false}
        >
          <PolicyVisualDiffExplorer
            diff={actionDiff}
            data={data}
            previewJson={previewJson}
            policySource={policySource}
            onPolicySourceChange={setPolicySource}
            downloadName={`${roleShortName(finding.resource_arn)}-${policySource}.json`}
            isRefreshing={isFetching}
          />
        </PolicyWorkspacePaneShell>
      )}
    </>
  );
}

function PolicyCloudTrailStartAction({
  findingId,
  accountId,
  roleArn,
  data,
  onRefresh,
}: {
  findingId: string;
  accountId: string;
  roleArn: string;
  data: GeneratedPolicy;
  onRefresh: () => void;
}) {
  const { startCloudTrailAnalysis, failCloudTrailAnalysis } = useRecheckNotifications();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const inProgress = data.access_analyzer?.reason === "in_progress";
  const analysis = data.cloudtrail_analysis;
  const wantsAnalysis = Boolean(data.improve_via_cloudtrail && data.confidence !== "high");
  const needsTrailSetup = Boolean(wantsAnalysis && analysis?.status === "no_trail");
  const needsAdvanced = Boolean(wantsAnalysis && analysis?.status === "advanced_disabled");
  const canStart = Boolean(wantsAnalysis && analysis?.ready);

  if (!canStart && !inProgress && !needsTrailSetup && !needsAdvanced) return null;

  const feedbackDisplay = feedback ? formatCloudTrailStartFeedback(feedback) : null;

  const start = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await api<{ message: string }>(
        `/v1/accounts/${accountId}/roles/policy-generation/start?role_arn=${encodeURIComponent(roleArn)}`,
        { method: "POST" },
      );
      setFeedback(res.message);
      startCloudTrailAnalysis({ findingId, accountId, roleArn, message: res.message });
      onRefresh();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const msg = friendlyPolicyGenerationError(raw);
      setFeedback(msg);
      failCloudTrailAnalysis({ findingId, accountId, roleArn, message: msg });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${drawerPanel} overflow-hidden shadow-sm shadow-zinc-900/[0.03]`}>
      <div className={`${drawerSectionHead} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
        <div className="min-w-0">
          <h4 className={drawerSectionTitle}>CloudTrail validation</h4>
          <p className="mt-0.5 text-[12px] text-zinc-500">~15 min · checks resource ARNs · IAM unchanged until you apply</p>
        </div>
        {!inProgress && !needsTrailSetup && !needsAdvanced && (
          <button
            type="button"
            disabled={busy}
            onClick={start}
            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-[#d8e0ec] bg-white px-3.5 py-2 text-[11px] font-semibold text-[#111827] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-[#cbd5e1] hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Starting…" : "Run analysis"}
          </button>
        )}
        {needsTrailSetup && (
          <span className="inline-flex shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-[11px] font-semibold text-amber-900">
            Trail required
          </span>
        )}
        {needsAdvanced && (
          <span className="inline-flex shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-[11px] font-semibold text-amber-900">
            Advanced IAM required
          </span>
        )}
      </div>
      {needsTrailSetup && (
        <div className="space-y-2 border-b border-amber-100 bg-amber-50/60 px-4 py-3 text-[11px] leading-relaxed text-amber-950">
          <p>
            {analysis?.message ??
              "No active CloudTrail logging trail is available for this account. Create a multi-region trail with a dedicated S3 log bucket, run a scan so Vigil can detect it, then start analysis."}
          </p>
          <Link
            to="/accounts"
            className="inline-flex font-semibold text-amber-900 underline decoration-amber-400/70 underline-offset-2 hover:text-amber-950"
          >
            Set up CloudTrail on Accounts →
          </Link>
        </div>
      )}
      {needsAdvanced && (
        <div className="space-y-2 border-b border-amber-100 bg-amber-50/60 px-4 py-3 text-[11px] leading-relaxed text-amber-950">
          <p>
            {analysis?.message ??
              "Enable Advanced IAM policy generation on the AWS connector so Vigil can start CloudTrail-based analysis."}
          </p>
          <Link
            to="/accounts"
            className="inline-flex font-semibold text-amber-900 underline decoration-amber-400/70 underline-offset-2 hover:text-amber-950"
          >
            Update connector on Accounts →
          </Link>
        </div>
      )}
      {inProgress && (
        <div className="flex items-start gap-2.5 border-b border-indigo-100 bg-indigo-50/60 px-4 py-3">
          <svg
            className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-indigo-600"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-[11px] leading-relaxed text-indigo-950">
            {policyGenerationReasonLabel("in_progress")}
          </p>
        </div>
      )}
      {feedbackDisplay && (
        <div
          className={`px-4 py-3 text-[11px] leading-relaxed ${
            feedbackDisplay.tone === "error"
              ? "border-t border-red-100 bg-red-50 text-red-900"
              : feedbackDisplay.tone === "success"
                ? "border-t border-emerald-100 bg-emerald-50 text-emerald-950"
                : "border-t border-zinc-100 bg-zinc-50 text-zinc-700"
          }`}
        >
          {feedbackDisplay.message}
        </div>
      )}
    </div>
  );
}


function GeneratePolicySection({
  accountId,
  finding,
  cloudTrailLogging,
  embedded = false,
  autoLoad = false,
}: {
  accountId: string;
  finding: Finding;
  cloudTrailLogging: boolean;
  /** Render inside remediation detail pane (no collapsible section chrome). */
  embedded?: boolean;
  /** Fetch policy as soon as the pane opens. */
  autoLoad?: boolean;
}) {
  const [enabled, setEnabled] = useState(autoLoad);
  const [view, setView] = useState<"diff" | "cleaned" | "original">("diff");
  const { data, isLoading, error, refetch, isFetching } = useQuery<GeneratedPolicy>({
    queryKey: ["generated-policy", accountId, finding.resource_arn, finding.last_seen],
    queryFn: () =>
      api(
        `/v1/accounts/${accountId}/roles/generated-policy?role_arn=${encodeURIComponent(finding.resource_arn)}&advanced=true`,
      ),
    enabled,
    staleTime: 0,
  });

  useEffect(() => {
    if (autoLoad) setEnabled(true);
  }, [autoLoad, finding.id, finding.resource_arn]);

  const body = (
    <>
      {!enabled && (
        <p className="text-[13px] leading-snug text-zinc-600">{generatePolicyIntro(cloudTrailLogging)}</p>
      )}
      {enabled && isLoading && <div className="py-2 text-[13px] text-zinc-500">Building suggestion…</div>}
      {enabled && error && <div className="py-1 text-[13px] text-red-600">{formatSuggestedPolicyError(error)}</div>}
      {enabled && data && (
        <>
          <PolicyCoverageMeta data={data} />
          <PolicyCloudTrailStartAction
            findingId={finding.id}
            accountId={accountId}
            roleArn={finding.resource_arn}
            data={data}
            onRefresh={() => void refetch()}
          />
        </>
      )}
      {enabled && data && data.has_inline_policies && data.original_policies && data.cleaned_policies && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-zinc-700">{policyChangeSummary(data)}</span>
            <div className="flex gap-0.5 rounded-md bg-zinc-100 p-0.5">
              {(["diff", "cleaned", "original"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium capitalize transition-colors ${view === v ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-800"}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          {Object.keys(data.cleaned_policies).map((policyName) => {
            const hint = policyRenameHint(policyName, finding.resource_arn, (data.statements_modified ?? 0) > 0);
            if (!hint) return null;
            return (
              <div
                key={policyName}
                className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-[13px] leading-snug text-indigo-900"
              >
                {hint}
              </div>
            );
          })}
          {view === "diff" && (
            <PolicyDiffView
              original={data.original_policies}
              cleaned={data.cleaned_policies}
              granularity={data.granularity}
              hideUnchangedResources={finding.check_id === "iam.role.unused_services_90d"}
              preservedServiceWildcards={data.preserved_service_wildcards}
            />
          )}
          {view !== "diff" && (
            <CliBlock code={JSON.stringify(view === "cleaned" ? data.cleaned_policies : data.original_policies, null, 2)} />
          )}
          {data.granularity === "service" && !data.access_analyzer?.job_id && (
            <p className="text-[11px] leading-snug text-zinc-500">
              Per-action usage not available yet — scoped to services with recorded activity. Run another scan to refresh.
            </p>
          )}
        </div>
      )}
    </>
  );

  const rebuildAction = !enabled ? (
    <button
      type="button"
      onClick={() => setEnabled(true)}
      className="shrink-0 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
    >
      Build suggestion
    </button>
  ) : (
    <button
      type="button"
      onClick={() => void refetch()}
      disabled={isFetching}
      className="shrink-0 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-60"
    >
      {isFetching ? "Refreshing…" : "Rebuild"}
    </button>
  );

  if (embedded) {
    return (
      <div className="space-y-5">
        <RemediationDetailCard title="How this works" action={rebuildAction}>
          <p className="text-[13px] leading-relaxed text-zinc-700">{generatePolicyIntro(cloudTrailLogging)}</p>
        </RemediationDetailCard>
        {enabled && isLoading && (
          <p className="px-1 text-[13px] text-zinc-500">Building suggestion…</p>
        )}
        {enabled && error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
            {formatSuggestedPolicyError(error)}
          </p>
        )}
        {enabled && data && (
          <>
            <PolicyCoverageMeta data={data} />
            <PolicyCloudTrailStartAction
              findingId={finding.id}
              accountId={accountId}
              roleArn={finding.resource_arn}
              data={data}
              onRefresh={() => void refetch()}
            />
          </>
        )}
        {enabled && data && data.has_inline_policies && data.original_policies && data.cleaned_policies && (
          <RemediationDetailCard
            title="Policy diff"
            action={
              <PolicyViewToggle
                options={["diff", "cleaned", "original"] as const}
                value={view}
                onChange={setView}
              />
            }
          >
            {Object.keys(data.cleaned_policies).map((policyName) => {
              const hint = policyRenameHint(policyName, finding.resource_arn, (data.statements_modified ?? 0) > 0);
              if (!hint) return null;
              return (
                <div
                  key={policyName}
                  className="mb-4 flex gap-2.5 rounded-xl border border-indigo-200/90 bg-indigo-50/90 px-4 py-3 ring-1 ring-indigo-100"
                >
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-100 text-indigo-700">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
                    </svg>
                  </span>
                  <p className="policy-review-callout">{hint}</p>
                </div>
              );
            })}
            <div className="max-h-[min(52vh,520px)] overflow-auto rounded-xl border border-zinc-200/90 bg-zinc-50/50">
              {view === "diff" && (
                <PolicyDiffView
                  original={data.original_policies}
                  cleaned={data.cleaned_policies}
                  granularity={data.granularity}
                  hideUnchangedResources={finding.check_id === "iam.role.unused_services_90d"}
                  preservedServiceWildcards={data.preserved_service_wildcards}
                />
              )}
              {view !== "diff" && (
                <CliBlock
                  code={JSON.stringify(view === "cleaned" ? data.cleaned_policies : data.original_policies, null, 2)}
                />
              )}
            </div>
            {data.granularity === "service" && !data.access_analyzer?.job_id && (
              <p className="mt-3 text-[12px] leading-relaxed text-zinc-500">
                Per-action usage not available yet — scoped to services with recorded activity. Run another scan to
                refresh.
              </p>
            )}
          </RemediationDetailCard>
        )}
      </div>
    );
  }

  return (
    <DrawerSection
      title="Least-privilege proposal"
      action={
        !enabled ? (
          <button
            type="button"
            onClick={() => setEnabled(true)}
            className="shrink-0 rounded-md border border-zinc-300 bg-white px-2.5 py-0.5 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            Build suggestion
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="shrink-0 rounded-md border border-zinc-300 bg-white px-2.5 py-0.5 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-60"
          >
            {isFetching ? "Refreshing…" : "Rebuild"}
          </button>
        )
      }
    >
      <div className={drawerSectionBody}>{body}</div>
    </DrawerSection>
  );
}

function GenerateS3HttpsPolicySection({
  accountId,
  finding,
  embedded = false,
  autoLoad = false,
}: {
  accountId: string;
  finding: Finding;
  embedded?: boolean;
  autoLoad?: boolean;
}) {
  const [enabled, setEnabled] = useState(autoLoad);
  const [view, setView] = useState<"diff" | "merged" | "original">("diff");
  const { data, isLoading, error, refetch, isFetching } = useQuery<GeneratedS3HttpsPolicy>({
    queryKey: ["generated-s3-https-policy", accountId, finding.resource_arn, finding.last_seen],
    queryFn: () =>
      api(
        `/v1/accounts/${accountId}/s3/generated-https-policy?bucket_arn=${encodeURIComponent(finding.resource_arn)}`,
      ),
    enabled,
    staleTime: 0,
  });

  useEffect(() => {
    if (autoLoad) setEnabled(true);
  }, [autoLoad, finding.id, finding.resource_arn]);

  const originalPolicies = data
    ? {
        "Bucket policy": data.original_policy ?? { Version: "2012-10-17", Statement: [] },
      }
    : undefined;
  const mergedPolicies = data ? { "Bucket policy": data.merged_policy } : undefined;

  const body = (
    <>
      {!enabled && (
        <p className="text-[13px] leading-snug text-zinc-600">
          Preview a bucket policy statement that denies insecure HTTP transport.
        </p>
      )}
      {enabled && isLoading && <div className="py-2 text-[13px] text-zinc-500">Generating…</div>}
      {enabled && error && <div className="py-1 text-[13px] text-red-600">{formatSuggestedPolicyError(error)}</div>}
      {enabled && data?.already_has_https_deny && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] leading-snug text-amber-900">
          Live bucket policy already denies requests where{" "}
          <span className="font-mono text-[12px]">aws:SecureTransport</span> is false. Re-scan after any change if this
          finding still appears.
        </div>
      )}
      {enabled && data && !data.already_has_https_deny && originalPolicies && mergedPolicies && (
        <div className="space-y-2.5">
          <div className="flex justify-end">
            <div className="flex gap-0.5 rounded-md bg-zinc-100 p-0.5">
              {(["diff", "merged", "original"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium capitalize transition-colors ${view === v ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-800"}`}
                >
                  {v === "merged" ? "merged" : v}
                </button>
              ))}
            </div>
          </div>
          {view === "diff" &&
            (!data.had_policy ? (
              <div className="space-y-2">
                <p className="text-[12px] text-zinc-500">This bucket never had a policy.</p>
                <PolicyStatementDiffBlock
                  lines={buildNewStatementDiffLines(
                    ((data.merged_policy.Statement as PolicyStatement[]) ?? [])[0] ?? {},
                  )}
                />
              </div>
            ) : (
              <PolicyDiffView original={originalPolicies} cleaned={mergedPolicies} />
            ))}
          {view === "merged" && <CliBlock code={JSON.stringify(data.merged_policy, null, 2)} label="Policy" />}
          {view === "original" && (
            <CliBlock code={JSON.stringify(originalPolicies["Bucket policy"], null, 2)} label="Policy" />
          )}
        </div>
      )}
    </>
  );

  const rebuildAction = !enabled ? (
    <button
      type="button"
      onClick={() => setEnabled(true)}
      className="shrink-0 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
    >
      Generate
    </button>
  ) : (
    <button
      type="button"
      onClick={() => void refetch()}
      disabled={isFetching}
      className="shrink-0 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-60"
    >
      {isFetching ? "Refreshing…" : "Rebuild"}
    </button>
  );

  if (embedded) {
    return (
      <div className="space-y-5">
        <RemediationDetailCard title="How this works" action={rebuildAction}>
          <p className="text-[13px] leading-relaxed text-zinc-700">
            Merge an HTTPS-only deny into the live bucket policy.
          </p>
        </RemediationDetailCard>
        {enabled && isLoading && <p className="px-1 text-[13px] text-zinc-500">Generating…</p>}
        {enabled && error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
            {formatSuggestedPolicyError(error)}
          </p>
        )}
        {enabled && data?.already_has_https_deny && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900">
            Live bucket policy already denies requests where{" "}
            <span className="font-mono text-[12px]">aws:SecureTransport</span> is false. Re-scan after any change if this
            finding still appears.
          </div>
        )}
        {enabled && data && !data.already_has_https_deny && originalPolicies && mergedPolicies && (
          <RemediationDetailCard
            title="Policy changes"
            action={
              <PolicyViewToggle
                options={["diff", "merged", "original"] as const}
                value={view}
                onChange={setView}
              />
            }
          >
            {view === "diff" &&
              (!data.had_policy ? (
                <div className="space-y-3">
                  <p className="text-[13px] text-zinc-600">This bucket never had a policy.</p>
                  <PolicyStatementDiffBlock
                    lines={buildNewStatementDiffLines(
                      ((data.merged_policy.Statement as PolicyStatement[]) ?? [])[0] ?? {},
                    )}
                  />
                </div>
              ) : (
                <PolicyDiffView original={originalPolicies} cleaned={mergedPolicies} />
              ))}
            {view === "merged" && <CliBlock code={JSON.stringify(data.merged_policy, null, 2)} label="Policy" />}
            {view === "original" && (
              <CliBlock code={JSON.stringify(originalPolicies["Bucket policy"], null, 2)} label="Policy" />
            )}
          </RemediationDetailCard>
        )}
      </div>
    );
  }

  return (
    <DrawerSection
      title="Least-privilege proposal"
      action={
        !enabled ? (
          <button
            type="button"
            onClick={() => setEnabled(true)}
            className="rounded-md border border-zinc-300 bg-white px-2.5 py-0.5 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            Generate
          </button>
        ) : undefined
      }
    >
      <div className={drawerSectionBody}>{body}</div>
    </DrawerSection>
  );
}

function SuggestedPolicyRemediationContent({
  accountId,
  finding,
  cloudTrailLogging,
}: {
  accountId: string;
  finding: Finding;
  cloudTrailLogging: boolean;
}) {
  if (finding.check_id === "s3.bucket.no_https_policy") {
    return <GenerateS3HttpsPolicySection accountId={accountId} finding={finding} embedded autoLoad />;
  }
  return (
    <GeneratePolicySection
      accountId={accountId}
      finding={finding}
      cloudTrailLogging={cloudTrailLogging}
      embedded
      autoLoad
    />
  );
}

function CliBlock({ code, label = "Command" }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    const executable = code
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    navigator.clipboard.writeText(executable).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }
  return (
    <div className="rounded-lg bg-zinc-100/60 overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">{label}</span>
        <button
          onClick={copy}
          className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-all duration-150 ${
            copied
              ? "text-emerald-600"
              : "text-zinc-500 hover:bg-white/60 hover:text-zinc-800"
          }`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap px-4 pb-4 pt-0 font-mono text-[12px] leading-[1.7] text-zinc-700">{code}</pre>
    </div>
  );
}

function ExceptionDocIcon() {
  const [failed, setFailed] = useState(false);
  if (failed) {
    // Fallback when /exception-shield.png is not present — clean indigo doc tile.
    return (
	      <svg className="h-[72px] w-[72px] shrink-0" viewBox="0 0 48 48" fill="none" aria-hidden>
        <rect x="2" y="2" width="44" height="44" rx="13" fill="#E7E6FB" />
        <path d="M15 13h11l6 6v15a2 2 0 0 1-2 2H15a2 2 0 0 1-2-2V15a2 2 0 0 1 2-2Z" fill="#6E72E4" />
        <path d="M26 13l6 6h-4.5A1.5 1.5 0 0 1 26 17.5V13Z" fill="#ADAEF1" />
        <rect x="17" y="23" width="10" height="2.6" rx="1.3" fill="#AEB0F2" />
        <rect x="17" y="28" width="6.5" height="2.6" rx="1.3" fill="#AEB0F2" />
        <path
          d="M30.5 26.5l6.2 2.25v4.4c0 3.6-2.45 6.6-6.2 7.7-3.75-1.1-6.2-4.1-6.2-7.7v-4.4l6.2-2.25Z"
          fill="#6366F1"
          stroke="#ffffff"
          strokeWidth="2.3"
          strokeLinejoin="round"
        />
        <path d="m27.6 33 1.9 1.9 3.4-3.6" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <img
      src="/exception-shield.png"
      alt=""
      aria-hidden
      onError={() => setFailed(true)}
	      className="h-[72px] w-[72px] shrink-0 rounded-2xl object-contain"
    />
  );
}

function ExceptionButton({
  findingId,
  onDone,
  className,
  sheetContainerRef,
}: {
  findingId: string;
  onDone: () => void;
  className?: string;
  /** Drawer root — exception sheet is portaled here so it covers the panel only. */
  sheetContainerRef: RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [approvedBy, setApprovedBy] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [sheetDragY, setSheetDragY] = useState(0);
  const [sheetDragging, setSheetDragging] = useState(false);
  const dragStartY = useRef<number | null>(null);
  const sheetDragYRef = useRef(0);
  const exceptionSheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSheetDragY(0);
    sheetDragYRef.current = 0;
    setSheetDragging(false);
    dragStartY.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, submitting]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim() || !approvedBy.trim()) return;
    setSubmitting(true);
    try {
      await api(`/v1/findings/${findingId}/exception`, {
        method: "POST",
        body: JSON.stringify({
          reason: reason.trim(),
          approved_by: approvedBy.trim(),
          expires_at: expiresAt || null,
        }),
      });
      setDone(true);
      setTimeout(() => { setOpen(false); onDone(); }, 800);
    } finally {
      setSubmitting(false);
    }
  }

  function startSheetDrag(e: React.PointerEvent<HTMLButtonElement>) {
    if (submitting) return;
    dragStartY.current = e.clientY;
    setSheetDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function moveSheetDrag(e: React.PointerEvent<HTMLButtonElement>) {
    if (dragStartY.current == null || submitting) return;
    const nextDragY = Math.max(0, e.clientY - dragStartY.current);
    sheetDragYRef.current = nextDragY;
    setSheetDragY(nextDragY);
  }

  function endSheetDrag(e: React.PointerEvent<HTMLButtonElement>) {
    const sheetHeight = exceptionSheetRef.current?.getBoundingClientRect().height ?? 0;
    const shouldClose = sheetHeight > 0 && sheetDragYRef.current > sheetHeight * 0.5;
    dragStartY.current = null;
    setSheetDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (shouldClose) {
      setSheetDragY(sheetHeight);
      sheetDragYRef.current = sheetHeight;
      window.setTimeout(() => setOpen(false), 120);
    } else {
      setSheetDragY(0);
      sheetDragYRef.current = 0;
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={done ? "Exception recorded" : "Create exception"}
        className={`${className ?? drawerFooterExceptionGhost}${done ? " !text-emerald-700 hover:!bg-emerald-50" : ""}`}
      >
        {done ? (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
          </svg>
        ) : (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.9} viewBox="0 0 24 24" aria-hidden>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6" />
          </svg>
        )}
        {done ? "Exception recorded" : "Create exception"}
      </button>
      {open &&
        sheetContainerRef.current &&
        createPortal(
          <div className="absolute inset-0 z-[70] flex flex-col justify-end" role="presentation">
            <button
              type="button"
              className="absolute inset-0 bg-zinc-950/20"
              onClick={() => !submitting && setOpen(false)}
              aria-label="Dismiss exception form"
            />
            <div
              ref={exceptionSheetRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="exception-dialog-title"
		              className="relative flex max-h-[min(97%,52rem)] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-[0_-12px_40px_rgba(15,23,42,0.16)] ring-1 ring-zinc-200/70"
              style={{
                transform: `translate3d(0, ${sheetDragY}px, 0)`,
                transition: sheetDragging ? "none" : "transform 180ms ease-out",
              }}
		              onClick={(e) => e.stopPropagation()}
		            >
	              <button
	                type="button"
	                onPointerDown={startSheetDrag}
	                onPointerMove={moveSheetDrag}
	                onPointerUp={endSheetDrag}
	                onPointerCancel={endSheetDrag}
	                onClick={(e) => e.preventDefault()}
	                className="flex shrink-0 cursor-grab touch-none justify-center pt-3 active:cursor-grabbing"
	                aria-label="Drag down to close exception form"
	              >
	                <span className="h-1 w-10 rounded-full bg-zinc-200 transition-colors hover:bg-zinc-300" aria-hidden />
	              </button>
	              <div className="shrink-0 px-5 pb-4 pt-4">
	                <div className="flex items-start gap-2.5 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-amber-950">
	                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
	                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.96 11.96 0 0 1 3.6 6 12 12 0 0 0 3 9.75c0 5.59 3.82 10.29 9 11.62 5.18-1.33 9-6.03 9-11.62 0-1.31-.21-2.57-.6-3.75h-.15a11.96 11.96 0 0 1-8.25-3.29Z" />
	                  </svg>
	                  <div className="min-w-0 text-[12px] leading-snug">
	                    <p className="font-semibold">Included in evidence pack</p>
	                    <p className="text-amber-900/90">This exception, approver, and expiry will be included in your evidence pack.</p>
	                  </div>
	                </div>
	              </div>
	              <div className="min-h-0 overflow-y-auto px-6 pb-7 pt-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3.5">
                    <ExceptionDocIcon />
                    <div className="min-w-0">
                      <h3 id="exception-dialog-title" className="text-base font-semibold text-zinc-900">
                        Document exception
                      </h3>
                      <p className="mt-1 text-sm leading-relaxed text-zinc-500">
                        Exceptions are retained in the evidence pack. Auditors can review the reason, approver, and expiry.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={submitting}
                    className="shrink-0 rounded-lg border border-zinc-200 p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-50"
                    aria-label="Close"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
	                <form onSubmit={submit} className="mt-6 space-y-5">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-zinc-700">
                      Reason <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
	                      rows={5}
                      maxLength={500}
                      placeholder="e.g. Internal sandbox repo — no production code. Risk accepted by CTO."
                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm placeholder:text-zinc-400 focus:border-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                      required
                    />
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <p className="text-xs text-zinc-400">Provide a clear reason for this exception.</p>
                      <p className="shrink-0 text-xs tabular-nums text-zinc-400">{reason.length} / 500</p>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-zinc-700">
                      Approved by <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={approvedBy}
                      onChange={(e) => setApprovedBy(e.target.value)}
                      placeholder="e.g. Alice Smith (CTO)"
                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm placeholder:text-zinc-400 focus:border-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                      required
                    />
                    <p className="mt-1 text-xs text-zinc-400">Full name and role of the approver.</p>
                  </div>
                  <div>
                    <label htmlFor="exception-expires" className="mb-1.5 block text-xs font-medium text-zinc-700">
                      Expires <span className="font-normal text-zinc-400">(optional)</span>
                    </label>
                    <DrawerDateField
                      id="exception-expires"
                      value={expiresAt}
                      onChange={setExpiresAt}
                      minIso={todayIso()}
                      placeholder="Select expiry date"
                    />
                    <p className="mt-1 text-xs text-zinc-400">Set when this exception should be reviewed or expire.</p>
                  </div>
                  <div className="border-t border-zinc-100 pt-4">
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <button
                        type="button"
                        onClick={() => setOpen(false)}
                        disabled={submitting}
                        className="rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50 sm:min-w-[7rem]"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={submitting || !reason.trim() || !approvedBy.trim()}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-[9rem]"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 0h10.5a2.25 2.25 0 0 1 2.25 2.25v6a2.25 2.25 0 0 1-2.25 2.25H6.75a2.25 2.25 0 0 1-2.25-2.25v-6a2.25 2.25 0 0 1 2.25-2.25Z" />
                        </svg>
                        {submitting ? "Saving…" : "Save exception"}
                      </button>
                    </div>
                    {!submitting && (!reason.trim() || !approvedBy.trim()) && (
                      <p className="mt-2 text-right text-xs text-zinc-400">Complete required fields to save</p>
                    )}
                  </div>
                </form>
              </div>
            </div>
          </div>,
          sheetContainerRef.current,
        )}
    </>
  );
}


export function FindingDrawer({
  finding,
  accountId,
  onClose,
  onAction,
  tab,
  onTabChange,
  remTab,
  onRemTabChange,
  verified,
  verifyUnchanged,
  verifying,
  onDismissVerifyOutcome,
}: {
  finding: Finding | null;
  accountId: string | null;
  onClose: () => void;
  onAction: (id: string, action: "recheck" | "reopen") => void;
  tab: FindingDrawerTab;
  onTabChange: (tab: FindingDrawerTab) => void;
  remTab: FindingRemediationMode;
  onRemTabChange: (mode: FindingRemediationMode) => void;
  verified?: boolean;
  verifyUnchanged?: boolean;
  verifying?: boolean;
  onDismissVerifyOutcome?: () => void;
}) {
  const prevCheckId = useRef<string | null>(null);
  const drawerSheetRef = useRef<HTMLDivElement>(null);
  /** User closed the detail pane (X) — do not auto-reopen suggested policy. */
  const remediationDetailDismissedRef = useRef(false);
  const [remDetailMode, setRemDetailMode] = useState<FindingRemediationMode | null>(null);
  const [policyChangePaneVisible, setPolicyChangePaneVisible] = useState(false);

  const { data: accountMeta } = useQuery({
    queryKey: ["account-cloudtrail", accountId],
    queryFn: () =>
      api<{ meta: { cloudtrail_logging: boolean; has_logging_trail?: boolean } }>(
        `/v1/accounts/${accountId}/timeline?days=1&limit=1`,
      ),
    enabled: !!accountId && !!finding,
    staleTime: 300_000,
  });
  const cloudTrailLogging =
    accountMeta?.meta?.has_logging_trail ?? accountMeta?.meta?.cloudtrail_logging ?? false;

  const policyWorkspaceQueryEnabled =
    !!finding &&
    !!accountId &&
    tab === "remediation" &&
    remDetailMode === "suggested_policy" &&
    ROLE_POLICY_GEN_CHECKS.has(finding.check_id);

  const { data: policyGenData } = useQuery<GeneratedPolicy>({
    queryKey: ["generated-policy", accountId, finding?.resource_arn, finding?.last_seen],
    queryFn: () =>
      api(
        `/v1/accounts/${accountId}/roles/generated-policy?role_arn=${encodeURIComponent(finding!.resource_arn)}&advanced=true`,
      ),
    enabled: policyWorkspaceQueryEnabled,
    staleTime: 0,
  });

  const policyActionDiff = useMemo(() => {
    if (!policyGenData?.original_policies || !policyGenData?.cleaned_policies) return null;
    return computePolicyActionDiff(policyGenData.original_policies, policyGenData.cleaned_policies);
  }, [policyGenData]);

  const showPolicyChangePane = useMemo(
    () => hasGeneratedPolicyChange(policyGenData, policyActionDiff),
    [policyGenData, policyActionDiff],
  );

  useEffect(() => {
    setPolicyChangePaneVisible(false);
  }, [finding?.id, finding?.resource_arn, remDetailMode]);

  useEffect(() => {
    if (!policyWorkspaceQueryEnabled || !showPolicyChangePane) {
      setPolicyChangePaneVisible(false);
    }
  }, [policyWorkspaceQueryEnabled, showPolicyChangePane, finding?.id, finding?.resource_arn]);

  const { data: remediationExecution } = useRemediationExecution(finding?.id ?? "");

  useEffect(() => {
    if (!finding) {
      prevCheckId.current = null;
      remediationDetailDismissedRef.current = false;
      setRemDetailMode(null);
      return;
    }
    remediationDetailDismissedRef.current = false;
    setRemDetailMode(null);
    const differentCheck =
      prevCheckId.current !== null && prevCheckId.current !== finding.check_id;
    if (differentCheck) {
      onTabChange("overview");
      onRemTabChange(defaultFindingRemediationMode(finding.check_id));
    }
    prevCheckId.current = finding.check_id;
  }, [finding?.id, finding?.check_id, onTabChange, onRemTabChange]);

  useEffect(() => {
    if (tab !== "remediation") setRemDetailMode(null);
  }, [tab]);

  const closeRemediationDetail = () => {
    remediationDetailDismissedRef.current = true;
    setRemDetailMode(null);
  };

  const openRemediationDetail = (mode: FindingRemediationMode) => {
    remediationDetailDismissedRef.current = false;
    setRemDetailMode(mode);
  };

  useEffect(() => {
    if (finding && SG_AUTOMATION_ONLY_CHECKS.has(finding.check_id) && remTab === "terraform") {
      onRemTabChange("automation");
    }
  }, [finding?.check_id, finding?.id, remTab, onRemTabChange]);

  const showWhatIf = !!finding && showWhatIfTab(finding.check_id, accountId);
  const whatIfUnavailable = finding ? whatIfUnavailableReason(finding.check_id) : null;

  useEffect(() => {
    if (!finding) return;
    const available = new Set<Tab>([
      "overview",
      "compliance",
      "remediation",
      "resources",
      ...(showWhatIf ? (["whatif"] as Tab[]) : []),
    ]);
    if (!available.has(tab)) onTabChange("overview");
  }, [finding?.id, showWhatIf, tab, onTabChange]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!verified || !finding) return;
    const t = window.setTimeout(() => {
      onDismissVerifyOutcome?.();
      onClose();
    }, 3000);
    return () => window.clearTimeout(t);
  }, [verified, finding?.id, onClose, onDismissVerifyOutcome]);

  useAppScrollLock(!!finding);

  if (!finding) return null;

  const showReopenFooter =
    (finding.status === "resolved" || finding.status === "ignored") && !verified && !verifying;

  const ssmExecSuccess =
    remediationExecution?.status === "success" ||
    Boolean((remediationExecution?.result as { ok?: boolean } | undefined)?.ok);
  const savedRemediationMode =
    remTab === "suggested_policy" ? defaultFindingRemediationMode(finding.check_id) : remTab;
  const activeRemediationMode = remDetailMode ?? savedRemediationMode;
  const ssmAutomationRemTab = activeRemediationMode === "automation";
  const verifyFooterMuted =
    ssmAutomationRemTab && !ssmExecSuccess && !verified && !verifying && !showReopenFooter;

  const rem =
    identityRemediations[finding.check_id] ??
    remediations[finding.check_id] ??
    fallbackRemediationFor(finding.check_id);
  const ops = remediationSummaryForFinding(finding);
  const checkDoc = documentationForCheck(finding.check_id);
  const isIdentityCheck = finding.check_id.startsWith("github.") || finding.check_id.startsWith("gitlab.");
  const headerBadge = sevHeaderBadge[finding.severity] ?? sevHeaderBadge.low;
  const wash = sevWash[finding.severity] ?? sevWash.low;
  const step = sevStep[finding.severity] ?? sevStep.low;
  const categoryLabel: Record<string, string> = {
    "iam.root": "Root Account",
    "iam.user": "IAM User",
    "iam.access_key": "Access Key",
    "iam.role": "IAM Role",
    "s3.bucket": "S3 Bucket",
    "kms.key": "KMS Key",
    "dynamodb.table": "DynamoDB Table",
    "lambda.function": "Lambda Function",
    "acm.certificate": "ACM Certificate",
    "secretsmanager.secret": "Secrets Manager",
    "ssm.parameter": "SSM Parameter",
    "elb.load_balancer": "Load Balancer",
    "sns.topic": "SNS Topic",
    "sqs.queue": "SQS Queue",
    "ec2.ami": "EC2 AMI",
    "ec2.ebs.snapshot": "EBS Snapshot",
    "github.org": "GitHub Organization",
    "github.repo": "GitHub Repository",
    "gitlab.org": "GitLab Group",
    "gitlab.repo": "GitLab Project",
  };
  const category = Object.entries(categoryLabel).find(([prefix]) => finding.check_id.startsWith(prefix))?.[1] ?? "Finding";
  const isRootFinding = isAwsRootFinding(finding);
  const showPolicyGen = ROLE_POLICY_GEN_CHECKS.has(finding.check_id) && !!accountId;
  const showSuggestedPolicy =
    showPolicyGen || (finding.check_id === "s3.bucket.no_https_policy" && !!accountId);

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "resources", label: "Resources" },
    { id: "compliance", label: "Compliance" },
    { id: "remediation", label: "Remediation" },
    ...(showWhatIf ? [{ id: "whatif" as Tab, label: "What if" }] : []),
  ];
  const hasException =
    finding.status === "excepted" ||
    !!finding.exception_reason ||
    !!finding.exception_approved_by;

  const remediationSplit = tab === "remediation" && remDetailMode !== null;
  const policyWorkspaceSplit =
    remediationSplit && remDetailMode === "suggested_policy" && showPolicyGen && !!accountId;
  const policyTriplePane = policyWorkspaceSplit && policyChangePaneVisible;
  const drawerWideClass = policyTriplePane
    ? DRAWER_POLICY_TRIPLE_MAX_W
    : policyWorkspaceSplit || remediationSplit
      ? DRAWER_WIDE_MAX_W
      : DRAWER_MAX_W;
  const drawerWidthTransitionClass =
    remediationSplit || policyWorkspaceSplit ? "transition-none" : "transition-[max-width] duration-200 ease-out";

  const overlay = (
    <>
      <div
        className="fixed -inset-px z-[100] bg-zinc-950/35 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={drawerSheetRef}
        className={`fixed top-0 right-0 bottom-0 z-[110] flex w-full flex-col overflow-hidden bg-white shadow-2xl ${drawerWidthTransitionClass} ${drawerWideClass}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="finding-drawer-title"
      >
    {verified && (
      <div
        className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-gradient-to-b from-emerald-50 via-emerald-50/95 to-white px-8 text-center"
        role="status"
        aria-live="polite"
      >
        <div className="relative mb-6 flex h-24 w-24 items-center justify-center">
          <span
            className="absolute inset-0 rounded-full bg-emerald-400/30 animate-ping"
            style={{ animationDuration: "1.4s" }}
            aria-hidden
          />
          <span className="relative flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/35 ring-4 ring-emerald-100">
            <svg className="h-11 w-11" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
        </div>
        <p className="text-2xl font-bold tracking-tight text-emerald-950">Verified</p>
        <p className="mt-2 text-sm leading-relaxed text-emerald-900/75">Finding is resolved.</p>
      </div>
    )}
    <div className={`relative shrink-0 overflow-hidden bg-gradient-to-b ${wash} px-6 pt-5 pb-3`}>
      <button onClick={onClose} className="absolute right-4 top-4 rounded-md p-1 text-zinc-400 transition hover:bg-white/70 hover:text-zinc-600"><svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
      <div className="flex items-center gap-2 pr-10">
        <span className="text-[11px] font-medium text-zinc-600">{category}</span>
        <span className="text-zinc-300">·</span>
        <span
          className={`inline-flex items-center rounded border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${headerBadge}`}
        >
          {finding.severity}
        </span>
      </div>
      <h2 id="finding-drawer-title" className="mt-1.5 pr-8 text-base font-semibold leading-snug text-zinc-900">
        {checkLabels[finding.check_id] ?? finding.title}
      </h2>
      {/* Segmented tab control — w-fit keeps track background from stretching full width */}
      <div className="mt-3">
        <div className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-zinc-900/[0.06] p-0.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className={`flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium transition-all ${
              tab === t.id ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-900/5" : "text-zinc-600 hover:text-zinc-800"
            }`}
          >
            {t.id === "whatif" && (
              <svg
                className="h-3.5 w-3.5 shrink-0 text-amber-400"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
                />
              </svg>
            )}
            {t.label}
          </button>
        ))}
        </div>
      </div>
    </div>
    <div
      className={`${drawerBody}${remediationSplit ? " !flex !flex-col !space-y-0 !overflow-hidden !px-0 !pb-0 !pt-0" : ""}`}
    >
      {verifyUnchanged && !verified && (
        <div
          className="flex items-start gap-3 rounded-xl border border-amber-200/80 bg-amber-50/90 px-4 py-3.5 text-[12px] leading-relaxed text-amber-950"
          role="status"
        >
          <p className="min-w-0 flex-1">
            <span className="font-semibold">Still open</span> — verify finished but this finding did not resolve. Fix
            the issue in AWS, then try again.
          </p>
          {onDismissVerifyOutcome && (
            <button
              type="button"
              onClick={onDismissVerifyOutcome}
              className="shrink-0 text-[11px] font-medium text-amber-900/80 hover:text-amber-950"
            >
              Dismiss
            </button>
          )}
        </div>
      )}
      {tab === "overview" && (
        <>
          <OverviewTabContent
            impact={ops.impact}
            risk={ops.risk}
            fix={ops.fix}
            finding={finding}
            hasException={hasException}
            documentation={checkDoc}
            accountId={accountId}
          />
        </>
      )}
      {tab === "resources" && <SelectedResourceInspector finding={finding} />}
      {tab === "compliance" && (
        <ComplianceTabContent checkId={finding.check_id} accountId={accountId} />
      )}
      {tab === "remediation" && (
        <div
          className={
            remediationSplit
              ? "flex min-h-0 flex-1 flex-col overflow-hidden"
              : "space-y-2.5"
          }
        >
          <div
            className={
              policyTriplePane
                ? DRAWER_POLICY_TRIPLE_GRID
                : policyWorkspaceSplit
                  ? "grid min-h-0 flex-1 grid-cols-[minmax(280px,34%)_minmax(0,1fr)] overflow-hidden border-t border-zinc-200/80"
                  : remediationSplit
                    ? "grid min-h-0 flex-1 grid-cols-[minmax(400px,48%)_minmax(380px,1fr)] overflow-hidden border-t border-zinc-200/80"
                    : "space-y-2.5"
            }
          >
            <div
              className={
                remediationSplit
                  ? `min-h-0 space-y-3 overflow-y-auto border-r border-zinc-200/90 bg-[#f7f9fc] py-4 ${
                      policyTriplePane ? "px-5" : "px-4"
                    }`
                  : "space-y-2.5"
              }
            >
              <SuggestedRemediationSummary
                rem={rem}
                policyMode={remDetailMode === "suggested_policy" && showPolicyGen}
              />
              {isIdentityCheck ? (
                <div className={`${drawerPanel} overflow-hidden`}>
                  <div className={drawerSectionBody}>
                    <button
                      type="button"
                      onClick={() => openRemediationDetail("console")}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[12px] font-semibold text-zinc-800 transition hover:border-indigo-200 hover:bg-indigo-50/50"
                    >
                      <RemediationModeIcon mode="console" />
                      View console steps
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <RemediationModePicker
                    active={activeRemediationMode}
                    onSelect={openRemediationDetail}
                    hideTerraform={SG_AUTOMATION_ONLY_CHECKS.has(finding.check_id)}
                    showSuggestedPolicy={showSuggestedPolicy}
                  />
                  {!remDetailMode && (
                    <p className="px-1 text-[12px] leading-relaxed text-zinc-500">
                      {showSuggestedPolicy
                        ? "Pick a format — including Suggested policy for a scoped diff from recorded usage."
                        : "Pick a format to open step-by-step instructions alongside this summary."}
                    </p>
                  )}
                </>
              )}
            </div>
            {policyWorkspaceSplit && accountId && (
              <SuggestedPolicyWorkspace
                accountId={accountId}
                finding={finding}
                cloudTrailLogging={cloudTrailLogging}
                showPolicyChangePane={policyChangePaneVisible}
                onOpenPolicyChangePane={() => setPolicyChangePaneVisible(true)}
                onClosePolicyChangePane={() => setPolicyChangePaneVisible(false)}
                onCloseWorkspace={closeRemediationDetail}
              />
            )}
            {remDetailMode && !policyWorkspaceSplit && (
              <RemediationDetailPanel mode={remDetailMode} onClose={closeRemediationDetail}>
                {(isIdentityCheck || remDetailMode === "console") && (
                  <RemediationDetailCard title="Console steps">
                    <ol className="space-y-3.5">
                      {rem.console.map((item, i) => (
                        <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-zinc-800">
                          <span
                            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${step}`}
                          >
                            {i + 1}
                          </span>
                          <span className="min-w-0 pt-0.5">{item}</span>
                        </li>
                      ))}
                    </ol>
                  </RemediationDetailCard>
                )}
                {!isIdentityCheck && remDetailMode === "cli" && (
                  <RemediationDetailCard title="AWS CLI">
                    {NO_CLI_REMEDIATION_CHECKS.has(finding.check_id) ? (
                      <p className="text-[13px] leading-relaxed text-zinc-600">
                        CLI isn&apos;t available for this finding.
                      </p>
                    ) : (
                      <RemediationCliBlock finding={finding} />
                    )}
                  </RemediationDetailCard>
                )}
                {!isIdentityCheck && remDetailMode === "terraform" && (
                  <IaCRemediationSection
                    embedMode="terraform"
                    findingId={finding.id}
                    checkId={finding.check_id}
                  />
                )}
                {!isIdentityCheck && remDetailMode === "automation" && (
                  <IaCRemediationSection
                    embedMode="automation"
                    findingId={finding.id}
                    checkId={finding.check_id}
                    accountId={accountId}
                    resourceRegion={resourceRegionForFinding(finding)}
                    resourceLabel={resourceDisplayName(finding)}
                    severity={finding.severity}
                  />
                )}
                {!isIdentityCheck && remDetailMode === "suggested_policy" && accountId && (
                  <SuggestedPolicyRemediationContent
                    accountId={accountId}
                    finding={finding}
                    cloudTrailLogging={cloudTrailLogging}
                  />
                )}
              </RemediationDetailPanel>
            )}
          </div>
        </div>
      )}
      {tab === "whatif" && showWhatIf && (
        whatIfUnavailable ? (
          <WhatIfUnavailable reason={whatIfUnavailable} />
        ) : (
          <BlastRadiusSection accountId={accountId!} finding={finding} />
        )
      )}
    </div>
    <div className="shrink-0 border-t border-zinc-200 bg-white px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {showReopenFooter ? (
        <button type="button" onClick={() => onAction(finding.id, "reopen")} className={drawerFooterReopen}>
          Reopen finding
        </button>
      ) : (
        <div className="flex w-full items-center gap-3">
          <ExceptionButton
            findingId={finding.id}
            onDone={onClose}
            className={drawerFooterExceptionGhost}
            sheetContainerRef={drawerSheetRef}
          />
          <button
            type="button"
            disabled={verifying || verified}
            onClick={() => onAction(finding.id, "recheck")}
            aria-label={verified ? "Verified" : verifying ? "Verifying fix" : "Verify fix"}
            className={verified || verifyFooterMuted ? drawerFooterVerifySoft : drawerFooterVerifyPrimary}
          >
            {verifying ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Verifying…
              </>
            ) : verified ? (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
                </svg>
                Verified
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.9} viewBox="0 0 24 24" aria-hidden>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
                  />
                </svg>
                Verify fix
              </>
            )}
          </button>
        </div>
      )}
    </div>
      </div>
    </>
  );

  return createPortal(overlay, document.body);
}
