import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAppScrollLock } from "../lib/useAppScrollLock";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, formatApiError } from "../api";
import { IaCRemediationSection } from "./IaCRemediationSection";
import { drawerPanel } from "./drawerStyles";
import {
  credentialUnusedFrameworkImpact,
  type CredentialFrameworkImpactItem,
} from "../data/credentialFrameworkImpact";
import { frameworkLabel } from "../data/frameworks";
import { supportsBlastRadius } from "../data/blastRadiusChecks";
import { checkLabels } from "../data/checkLabels";
import { documentationForCheck } from "../data/checkDocumentation";
import { policyGenerationReasonLabel } from "../data/policyGenerationCopy";
import {
  formatCloudTrailStartFeedback,
  friendlyPolicyGenerationError,
} from "../lib/policyGenerationErrors";
import { useRecheckNotifications } from "../context/RecheckNotificationsContext";
import { remediationSummaryFor } from "../data/remediationSummaries";
import {
  daysAgo,
  awsRegionFromArn,
  regionsFromFindingEvidence,
  resourceDetailRowsFromFinding,
  resourceDisplayName,
  resourceIdentifierLabel,
  resourceIdentifierValue,
  resourceRegionForFinding,
  resourceShortName,
  resourceTypeLabel,
  isVcsResourceIdentifier,
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

/** Shared drawer inspection UI — aligned with Resources tab rhythm */
const drawerSectionHead = "border-b border-zinc-100 px-4 py-3";
const drawerSectionBody = "px-4 py-3.5";
const drawerSectionTitle = "text-sm font-semibold text-zinc-900";
const drawerFieldLabelBlock = "text-[11px] font-medium text-zinc-500";
const drawerBodyGap = "space-y-3";
const drawerFooterPrimary =
  "inline-flex flex-[1.08] items-center justify-center gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50 px-4 py-2.5 text-[13px] font-semibold text-emerald-800 shadow-sm shadow-emerald-900/[0.03] transition-all duration-200 hover:border-emerald-300 hover:bg-emerald-100/70 hover:text-emerald-900 active:scale-[0.995] disabled:cursor-not-allowed disabled:opacity-50";
const drawerFooterSecondary =
  "flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-200/60 bg-white px-3 py-2 text-[13px] font-medium text-zinc-600 transition-all duration-200 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-800 active:scale-[0.995] disabled:opacity-50";
const drawerFooterException =
  "inline-flex flex-[0.92] items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-zinc-600 shadow-sm shadow-zinc-950/[0.02] transition-all duration-200 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 active:scale-[0.995]";

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
