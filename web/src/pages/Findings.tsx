import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AccountFilterDropdown } from "../components/AccountFilterDropdown";
import { HeaderFilterBar } from "../components/HeaderFilterBar";
import { HeaderSlot } from "../context/HeaderSlot";
import { FilterChipBar } from "../components/FilterChipBar";
import {
  BenchmarkFrameworkSelect,
  benchmarkSelectionLabel,
  parseFrameworkParam,
  serializeFrameworkParam,
} from "../components/BenchmarkFrameworkSelect";
import { FindingsStatusSelect } from "../components/FindingsStatusSelect";
import { FindingsChecksFilter, FindingsChecksFilterSummary } from "../components/FindingsChecksFilter";
import { api, formatApiError, token } from "../api";
import { checkFrameworksSchema, compositeControlListSchema, integrationStatusNullableSchema } from "../lib/apiSchemas";
import { fetchAllFindings } from "../lib/fetchAllFindings";
import ConnectAwsEmptyState from "../components/ConnectAwsEmptyState";
import {
  ALL_CLOUD_SCOPE_ID,
  buildFindingsScopeGroups,
  findingsScopeDropdownValue,
  findingsScopeParams,
  flattenScopeGroups,
  parseFindingsProviderScope,
  SCOPE_SENTINEL_PREFIX,
  SOURCE_CONTROL_SCOPE_ID,
  useConnectedAccountOptions,
  type FindingsProviderScope,
  type FindingsScopeParams,
} from "../hooks/useConnectedAccountOptions";
import { readStoredSelectedAccountId, writeStoredSelectedAccountId } from "../lib/selectedAccountStorage";
import { useSelectedAccountId } from "../hooks/useSelectedAccountId";
import { useTriggeredScan } from "../hooks/useTriggeredScan";
import { prefetchJiraIntegration, useJiraIntegration } from "../hooks/useJiraIntegration";
import { FindingDrawer, defaultFindingRemediationMode, type FindingDrawerTab, type FindingRemediationMode } from "../components/FindingDrawer";
import { checkLabels } from "../data/checkLabels";
import {
  findingDisplayGroupKey,
  findingGroupMeta,
  findingGroupSearchText,
  isActivityCheck,
} from "../data/findingGroups";
import { SeverityIndicator } from "../components/SeverityIndicator";
import { VirtualizedFindingsGroups } from "../components/VirtualizedFindingsGroups";
import { CHECK_FRAMEWORK_MAP } from "../data/checkFrameworkMap";
import type { FrameworkId } from "../data/frameworks";
import { resourceDisplayName as shortArn } from "../lib/timelineDisplay";
import { assetTypeLabel, findingScopeProvider } from "../lib/findingDisplay";
import { vcsResourceWebUrl } from "../lib/findingDisplay";
import { useRecheckNotifications, type RecheckResponse } from "../context/RecheckNotificationsContext";
import { CloudProviderMark } from "../components/FindingResourceIcon";
import { FrameworkMark } from "../components/FrameworkMark";
import { remediationSummaries } from "../data/remediationSummaries";
import { scanDescriptionForCheck } from "../data/checkComplianceCopy";
import { ToolbarSearchInput } from "../components/ToolbarSearchInput";
import "../styles/findings-v2.css";

/** CloudTrail activity detections are informational only; hidden from Findings UI for now. */
const SHOW_ACTIVITY_DETECTIONS_SECTION = false;

type Finding = {
  id: string;
  account_id?: string;
  account_label?: string | null;
  account_name?: string | null;
  account_provider?: string | null;
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
  remediation_ticket_key?: string | null;
  remediation_ticket_url?: string | null;
};

function findingDrawerSyncChanged(a: Finding, b: Finding): boolean {
  return (
    a.status !== b.status ||
    a.last_seen !== b.last_seen ||
    a.risk_score !== b.risk_score ||
    a.remediation_ticket_key !== b.remediation_ticket_key ||
    a.remediation_ticket_url !== b.remediation_ticket_url
  );
}

function findingBelongsToAccount(finding: Finding, account: { id: string; account_id?: string | null; provider?: string | null } | undefined): boolean {
  if (!account) return true;
  const accountProvider = (account.provider ?? "aws").toLowerCase();
  const findingProvider = findingScopeProvider(finding);
  if (findingProvider !== accountProvider) return false;

  const accountIds = new Set([account.id, account.account_id].filter((v): v is string => !!v));
  if (accountIds.size === 0) return true;
  return !finding.account_id || accountIds.has(finding.account_id);
}


function parseProviderScope(value: string | null) {
  return parseFindingsProviderScope(value);
}

function scopeSentinelToProvider(scope: string): string | null {
  if (scope === "all_cloud") return "all_cloud";
  if (scope === "source_control") return "source_control";
  return null;
}

type Account = {
  id: string;
  label?: string | null;
  status: string;
  account_id: string | null;
  last_scan_at?: string | null;
  cfn_launch_url?: string;
};
type StatusTab = "open" | "excepted" | "resolved" | "all";
type SeverityFilter = "all" | "critical" | "high" | "medium" | "low" | "info";

const severityTabs: { id: SeverityFilter; label: string; urgent?: boolean }[] = [
  { id: "all", label: "All" },
  { id: "critical", label: "Critical", urgent: true },
  { id: "high", label: "High", urgent: true },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
  { id: "info", label: "Info" },
];
type SortKey = "severity" | "score" | "first_seen";

const sevWeight: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "severity", label: "Severity" },
  { id: "score", label: "Risk" },
  { id: "first_seen", label: "Age" },
];


function emptyFindingsLabel(status: StatusTab): string {
  if (status === "all") return "No findings";
  if (status === "excepted") return "No exceptions";
  return `No ${status} findings`;
}

function FindingsScanButton({
  connectedId,
  isRunning,
  scanTriggered,
  onScan,
}: {
  connectedId: string;
  isRunning: boolean;
  scanTriggered: boolean;
  onScan: (accountId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onScan(connectedId)}
      disabled={scanTriggered || isRunning}
      className="findings-v2-toolbar-btn findings-v2-toolbar-btn--scan"
    >
      {isRunning ? "Scanning…" : scanTriggered ? "Starting…" : "Scan"}
    </button>
  );
}

function matchesSeverityFilter(f: Finding, filter: SeverityFilter): boolean {
  if (filter === "all") return true;
  return f.severity === filter;
}

function frameworksForCheck(checkId: string, apiMap: Record<string, string[]> | undefined): string[] {
  return apiMap?.[checkId] ?? CHECK_FRAMEWORK_MAP[checkId] ?? [];
}

function matchesBenchmarkFilter(
  f: Finding,
  selected: FrameworkId[],
  apiMap: Record<string, string[]> | undefined,
): boolean {
  if (selected.length === 0) return true;
  const fws = frameworksForCheck(f.check_id, apiMap);
  return selected.some((id) => fws.includes(id));
}

function SeverityDot({ severity }: { severity: string }) {
  const tone: Record<string, string> = {
    critical: "bg-red-600",
    high: "bg-red-500",
    medium: "bg-amber-500",
    low: "bg-zinc-400",
    info: "bg-sky-500",
  };
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${tone[severity] ?? tone.low}`}
      title={`${severity} severity`}
      aria-hidden
    />
  );
}

function RiskScoreDisplay({ score, severity }: { score: number; severity: string }) {
  const tone =
    severity === "critical" || severity === "high"
      ? "findings-v2-risk-pill--high"
      : severity === "medium"
        ? "findings-v2-risk-pill--medium"
        : "findings-v2-risk-pill--low";

  return (
    <span aria-label={`Risk score ${score}`} className={`findings-v2-risk-pill ${tone}`}>
      <span className="findings-v2-risk-pill__inner">{score}</span>
    </span>
  );
}

/** arn:...:role/Foo -> Foo, arn:aws:s3:::my-bucket -> my-bucket (last path/colon segment). */
function shortResourceName(label: string): string {
  const afterSlash = label.split("/").pop() ?? label;
  const afterColon = afterSlash.split(":").pop() ?? afterSlash;
  return afterColon || label;
}

type ResourceOption = {
  key: string;
  label: string;
  finding: Finding;
};

/* Metadata tracks are fr-weighted (not auto), so leftover width distributes
   across every column proportionally — like the reference design — instead of
   piling up in the title column and pinning the metadata against the right
   edge. fr resolution depends only on container width, so the independent
   header/row/accordion grids stay pixel-aligned by construction. */
/** Row + column-header grid tracks live in findings-overrides.css so we can
    drop columns (benchmark → category → risk) before squeezing finding title. */

const RESOURCE_CHILD_PREVIEW = 3;

/** Per-check description + framework badges + category label — data that
    doesn't fit in FindingRow's own props (it's a module-scope component
    reused by the virtualized list, so this rides in via context instead of
    a prop-drilling change to the shared VirtualizedFindingsGroups). */
const FindingMetaContext = createContext<{
  categoryByCheckId: Record<string, { id: string; title: string }>;
  checkFrameworksApi: Record<string, string[]> | undefined;
}>({ categoryByCheckId: {}, checkFrameworksApi: undefined });

/** Row multi-select for bulk actions — rides in via context for the same
    reason as FindingMetaContext (FindingRow's props are fixed by the shared
    virtualized list). Keys are display-group keys, not finding ids. */
const FindingSelectionContext = createContext<{
  selected: Set<string>;
  toggle: (groupKey: string) => void;
}>({ selected: new Set(), toggle: () => {} });

/** Composite id -> row-list control name. Same composite taxonomy the
    Compliance page uses; longest titles trimmed to fit the column, full
    title stays in the tooltip. Every registered check maps to a composite
    (verified against composite_controls.json — the only unmapped CHECK_IDs
    are dormant legacy modules absent from the check registry). */
const CATEGORY_SHORT_LABEL: Record<string, string> = {
  identity_governance: "Identity Governance",
  asset_inventory: "Access Inventory",
  secure_sdlc: "Secure SDLC",
  change_management: "Change Management",
  data_protection: "Data Protection",
  network_boundary: "Network Boundary",
  vulnerability_management: "Vulnerability Management",
  container_vulnerability_monitoring: "Container Vulnerability",
  logging_monitoring: "Logging & Monitoring",
  incident_response: "Incident Response",
  backup_resilience: "Backup & Resilience",
  endpoint_security: "Endpoint Security",
  mdm_endpoint: "Device Management",
  hr_training: "Security Awareness",
  vendor_risk: "Vendor Risk",
};

/** "2 IAM users" / "79 EBS volumes" when every resource in the row shares one
    asset type; plain "N resources" for mixed rows. Acronym-ish words (IAM,
    S3, EBS, DynamoDB…) keep their casing, the rest lowercase. */
function resourceCountLabel(count: number, typeLabel: string | null): string {
  if (!typeLabel) return `${count} ${count === 1 ? "resource" : "resources"}`;
  const words = typeLabel.split(" ").map((w) => (/[A-Z].*[A-Z0-9]/.test(w) ? w : w.toLowerCase()));
  let noun = words[words.length - 1];
  if (count !== 1) noun = /[^aeiou]y$/i.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`;
  words[words.length - 1] = noun;
  return `${count} ${words.join(" ")}`;
}

/** Short scanner description for the row list; null when we have no static
    copy for this check rather than guessing from the raw title. */
function findingRowDescription(checkId: string): string | null {
  const summary = remediationSummaries[checkId];
  if (!summary) return null;
  return scanDescriptionForCheck(checkId, summary);
}

/** Stacked-layers resource glyph (Lucide `layers`, ISC) — matches the
    reference design's resources icon. */
function ResourcesStackIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </svg>
  );
}

function RowChevron({ expanded, muted }: { expanded: boolean; muted?: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "rotate-90" : ""} ${muted ? "text-[var(--chevron)] opacity-35" : "text-[var(--chevron)] group-hover:text-[var(--chevron-hover)]"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function formatResourceDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  return `${date} ${time}`;
}

function ResourceProviderTile({ finding }: { finding: Finding }) {
  return <CloudProviderMark finding={finding} />;
}

function awsConsoleUrl(arn: string): string | null {
  if (!arn.startsWith("arn:aws:")) return null;
  const segs = arn.split(":");
  const service = segs[2];
  const region = segs[3] || "us-east-1";
  const resource = segs.slice(5).join(":");
  switch (service) {
    case "iam":
      if (resource === "root") return "https://console.aws.amazon.com/iam/home#/security_credentials";
      if (resource.startsWith("user/"))
        return `https://console.aws.amazon.com/iam/home#/users/details/${encodeURIComponent(resource.slice(5))}`;
      if (resource.startsWith("role/"))
        return `https://console.aws.amazon.com/iam/home#/roles/details/${encodeURIComponent(resource.slice(5))}`;
      return "https://console.aws.amazon.com/iam/home";
    case "s3":
      return `https://s3.console.aws.amazon.com/s3/buckets/${encodeURIComponent(resource)}`;
    case "ec2":
    case "eks":
    case "kms":
    case "rds":
      return `https://${region}.console.aws.amazon.com/${service}/home?region=${region}`;
    default:
      return "https://console.aws.amazon.com/";
  }
}

function AffectedResourceRow({
  finding,
  resourceLabel,
  assetType,
  showSeverityDot,
  onSelect,
}: {
  finding: Finding;
  resourceLabel: string;
  assetType: string;
  showSeverityDot?: boolean;
  onSelect: () => void;
}) {
  const name = shortResourceName(resourceLabel);
  const account = finding.account_label || finding.account_name || finding.account_id || "—";
  const consoleUrl = awsConsoleUrl(finding.resource_arn);
  const repoUrl = consoleUrl ? null : vcsResourceWebUrl(finding);
  const externalUrl = consoleUrl ?? repoUrl;
  const externalLabel = consoleUrl ? "View in AWS" : "View repo";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onSelect();
        }
      }}
      className="findings-affected-resource-row cursor-pointer rounded-xl border border-zinc-200/80 bg-white px-4 py-3.5 transition hover:border-zinc-300 hover:shadow-sm hover:shadow-zinc-950/[0.04]"
    >
      <ResourceProviderTile finding={finding} />
      <div className="findings-affected-resource-row__identity">
        {showSeverityDot ? <SeverityDot severity={finding.severity} /> : null}
        <span className="findings-affected-resource-row__name">{name}</span>
        <span className="findings-affected-resource-row__type">{assetType}</span>
      </div>
      <div className="findings-affected-resource-row__meta-grid">
        <div className="findings-affected-resource-row__meta findings-affected-resource-row__meta--account">
          <p className="veritrail-kicker">Account</p>
          <p className="mt-1 flex min-w-0 items-center gap-2 text-[13px] font-semibold text-zinc-800">
            <span className="truncate">{account}</span>
            <button
              type="button"
              aria-label="Copy account"
              onClick={(event) => {
                event.stopPropagation();
                void navigator.clipboard.writeText(account);
              }}
              className="shrink-0 text-zinc-300 transition hover:text-zinc-500"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3M6 9h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
              </svg>
            </button>
          </p>
        </div>
        <div className="findings-affected-resource-row__meta findings-affected-resource-row__meta--last-seen">
          <p className="veritrail-kicker">Last seen</p>
          <p className="mt-1 flex min-w-0 items-center gap-2 text-[13px] font-medium tabular-nums text-zinc-800">
            <span className="truncate">{formatResourceDate(finding.last_seen)}</span>
            <svg className="h-4 w-4 shrink-0 text-zinc-300" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          </p>
        </div>
        <div className="findings-affected-resource-row__meta findings-affected-resource-row__meta--first-seen">
          <p className="veritrail-kicker">First seen</p>
          <p className="mt-1 truncate text-[13px] font-medium tabular-nums text-zinc-800">{formatResourceDate(finding.first_seen)}</p>
        </div>
      </div>
      {externalUrl ? (
        <a
          href={externalUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="findings-affected-resource-row__action inline-flex shrink-0 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
        >
          {externalLabel}
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
        </a>
      ) : null}
    </div>
  );
}

function AffectedResourcesCard({
  resources,
  totalCount,
  hiddenCount,
  showMore,
  showSeverityDots,
  onShowMore,
  onSelect,
  onViewAll,
}: {
  resources: ResourceOption[];
  totalCount: number;
  hiddenCount: number;
  showMore: boolean;
  showSeverityDots?: boolean;
  onShowMore: () => void;
  onSelect: (finding: Finding) => void;
  onViewAll: () => void;
}) {
  return (
    <div className="findings-affected-resources-card rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm shadow-zinc-950/[0.03]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h4 className="text-base font-semibold text-zinc-900">Affected resources</h4>
            <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-zinc-600">
              {totalCount}
            </span>
          </div>
          <p className="mt-1.5 text-[13px] text-zinc-500">Resources and identities impacted by this finding.</p>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onViewAll();
          }}
          className="inline-flex shrink-0 items-center gap-2 text-[13px] font-semibold text-indigo-600 transition hover:text-indigo-800"
        >
          View finding
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>
        </button>
      </div>
      <div className="mt-4 flex flex-col gap-3">
        {resources.map((resource) => (
          <AffectedResourceRow
            key={resource.key}
            finding={resource.finding}
            resourceLabel={resource.label}
            assetType={assetTypeLabel(resource.finding.check_id)}
            showSeverityDot={showSeverityDots}
            onSelect={() => onSelect(resource.finding)}
          />
        ))}
        {showMore ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onShowMore();
            }}
            className="self-start rounded-lg px-2.5 py-2 text-[13px] font-semibold text-indigo-600 transition hover:text-indigo-800"
          >
            Show {hiddenCount} more
          </button>
        ) : null}
      </div>
    </div>
  );
}

function FindingRow({
  groupKey,
  items,
  expanded,
  onToggleExpanded,
  onReview,
}: {
  groupKey: string;
  items: Finding[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onReview: (items: Finding[], focus?: Finding, tab?: FindingDrawerTab) => void;
}) {
  const sev =
    items.reduce<string | null>((worst, f) => {
      if (!worst) return f.severity;
      return (sevWeight[f.severity] ?? 9) < (sevWeight[worst] ?? 9) ? f.severity : worst;
    }, null) ?? "low";
  const groupMeta = findingGroupMeta(groupKey);
  const title =
    groupMeta?.title ??
    checkLabels[groupKey] ??
    checkLabels[items[0]?.check_id ?? ""] ??
    items[0]?.title ??
    groupKey;
  const topRisk = Math.max(...items.map((f) => f.risk_score));
  const checkId = items[0]?.check_id ?? groupKey;
  const { categoryByCheckId, checkFrameworksApi } = useContext(FindingMetaContext);
  const { selected: selectedGroups, toggle: toggleGroupSelected } = useContext(FindingSelectionContext);
  const isChecked = selectedGroups.has(groupKey);
  const description = findingRowDescription(checkId);
  const rowFrameworks = frameworksForCheck(checkId, checkFrameworksApi);
  const categoryMeta = categoryByCheckId[checkId];
  const category = categoryMeta ? CATEGORY_SHORT_LABEL[categoryMeta.id] ?? categoryMeta.title : undefined;
  // Single asset type across the row's items -> "79 EBS volumes"; mixed -> null.
  const uniformResourceType = useMemo(() => {
    const labels = new Set(items.map((f) => assetTypeLabel(f.check_id)));
    return labels.size === 1 ? [...labels][0] : null;
  }, [items]);
  const resources = useMemo<ResourceOption[]>(() => {
    const seen = new Set<string>();
    return items.flatMap((finding) => {
      const label = shortArn(finding.resource_arn);
      if (seen.has(label)) return [];
      seen.add(label);
      return [{ key: `${finding.id}:${label}`, label, finding }];
    });
  }, [items]);
  const railClass =
    sev === "critical" || sev === "high" || sev === "medium" || sev === "low"
      ? `findings-v2-row--${sev}`
      : "findings-v2-row--low";
  const [showAllResources, setShowAllResources] = useState(false);
  const canExpand = resources.length > 0;
  const hiddenResourceCount = Math.max(0, resources.length - RESOURCE_CHILD_PREVIEW);
  const visibleResources = showAllResources ? resources : resources.slice(0, RESOURCE_CHILD_PREVIEW);
  const showMoreRow = expanded && !showAllResources && hiddenResourceCount > 0;
  const hasMixedSeverity = new Set(items.map((f) => f.severity)).size > 1;

  useEffect(() => {
    if (!expanded) setShowAllResources(false);
  }, [expanded]);

  const handleParentRowClick = () => {
    if (canExpand) onToggleExpanded();
    else onReview(items);
  };

  return (
    <div className={`findings-v2-row-group ${railClass} ${expanded ? "is-expanded" : ""}`}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={canExpand ? expanded : undefined}
        aria-label={`${title}${canExpand ? `, ${resources.length} resources` : ""}`}
        className={`findings-v2-row finding-row findings-v2-row-grid ${railClass} group cursor-pointer ${expanded ? "is-expanded lg:items-start" : "lg:items-center"}`}
        onClick={handleParentRowClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleParentRowClick();
          }
        }}
      >
        <div className="findings-v2-col-chevron flex w-5 shrink-0 items-center justify-center gap-1.5 self-center lg:col-auto lg:justify-start lg:self-start lg:pt-2">
          <input
            type="checkbox"
            className="findings-v2-row-check hidden lg:block"
            checked={isChecked}
            onChange={() => toggleGroupSelected(groupKey)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            aria-label={`Select ${title}`}
          />
          <RowChevron expanded={expanded && canExpand} muted={!canExpand} />
        </div>

        <div className="findings-v2-col-severity hidden shrink-0 self-start pt-2 lg:col-auto lg:block">
          <SeverityIndicator severity={sev} />
        </div>

        <div className="finding-title-cell findings-v2-col-finding finding-cell min-w-0 lg:col-auto">
          <div className="finding-title-row">
            <span className="finding-title-mobile-severity shrink-0 lg:hidden">
              <SeverityIndicator severity={sev} />
            </span>
            <span className="finding-title min-w-0 truncate">{title}</span>
            {description ? (
              <span className="finding-title-description hidden min-w-0 flex-1 truncate text-[13px] font-normal text-zinc-400 lg:inline">
                {description}
              </span>
            ) : null}
            {canExpand && !expanded ? (
              <span className="finding-resource-count shrink-0 lg:hidden">
                · {resources.length} {resources.length === 1 ? "resource" : "resources"}
              </span>
            ) : null}
          </div>
        </div>

        <div className="findings-v2-col-resources hidden min-w-0 items-center gap-1.5 self-center lg:col-auto lg:flex lg:self-start lg:pt-2">
          <ResourcesStackIcon className="h-4 w-4 shrink-0 text-zinc-400" />
          <span
            className="truncate text-[13px] font-medium text-zinc-500"
            title={resourceCountLabel(resources.length, uniformResourceType)}
          >
            {resourceCountLabel(resources.length, uniformResourceType)}
          </span>
        </div>

        <div className="findings-v2-col-benchmark hidden min-w-0 items-center gap-1 self-center lg:col-auto lg:flex lg:self-start lg:pt-2">
          {rowFrameworks.slice(0, 3).map((fw) => (
            <FrameworkMark key={fw} framework={fw} className="h-4 w-4 shrink-0" />
          ))}
        </div>

        <div className="findings-v2-col-category hidden min-w-0 items-center self-center lg:col-auto lg:flex lg:self-start lg:pt-2">
          {category ? (
            <span className="truncate text-[12px] font-medium text-zinc-700" title={categoryMeta?.title}>
              {category}
            </span>
          ) : null}
        </div>

        <div
          className="findings-v2-col-risk flex shrink-0 items-center justify-end self-center lg:col-auto lg:justify-center lg:self-start lg:pt-2"
          onClick={(event) => {
            event.stopPropagation();
            onReview(items);
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <RiskScoreDisplay score={topRisk} severity={sev} />
        </div>
      </div>
      {canExpand ? (
        <div className={`veritrail-accordion-panel ${expanded ? "is-open" : ""}`}>
          <div className="veritrail-accordion-panel__inner">
            <div className="findings-v2-accordion-grid findings-v2-row-grid border-t border-zinc-100 lg:grid lg:gap-4">
              <span className="hidden lg:block" aria-hidden />
              <span className="hidden lg:block" aria-hidden />
              <div className="py-4 pl-4 pr-5 lg:pl-0">
                <AffectedResourcesCard
                  resources={visibleResources}
                  totalCount={resources.length}
                  hiddenCount={hiddenResourceCount}
                  showMore={showMoreRow}
                  showSeverityDots={hasMixedSeverity}
                  onShowMore={() => setShowAllResources(true)}
                  onSelect={(finding) => onReview(items, finding, "resources")}
                  onViewAll={() => onReview(items, undefined, "resources")}
                />
              </div>
              <span className="hidden lg:block" aria-hidden />
              <span className="hidden lg:block" aria-hidden />
              <span className="hidden lg:block" aria-hidden />
              <span className="hidden lg:block" aria-hidden />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function Findings() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusTab>("open");
  const [selected, setSelected] = useState<Finding | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<Finding[]>([]);
  const [drawerTab, setDrawerTab] = useState<FindingDrawerTab>("resources");
  const [remTab, setRemTab] = useState<FindingRemediationMode>("console");
  const [sortKey, setSortKey] = useState<SortKey>("severity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [searchText, setSearchText] = useState(searchParams.get("q") ?? "");
  const [searchTags, setSearchTags] = useState<string[]>(() => {
    const raw = searchParams.get("checks");
    return raw ? raw.split(",").filter(Boolean) : [];
  });
  const [selectedFrameworks, setSelectedFrameworks] = useState<FrameworkId[]>(() =>
    parseFrameworkParam(searchParams.get("framework")),
  );
  const providerScope = parseProviderScope(searchParams.get("provider"));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedCheckIds, setExpandedCheckIds] = useState<Set<string>>(() => new Set());
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<Set<string>>(() => new Set());
  const [bulkMode, setBulkMode] = useState<"actions" | "except" | "resolve">("actions");
  const [bulkReason, setBulkReason] = useState("");
  const [bulkApprover, setBulkApprover] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const { pendingRecheck, recheckOutcome, startRecheck, applyRecheckResult, failRecheck, clearDrawerVerifyFlash } =
    useRecheckNotifications();

  // Warm Jira integration cache before the finding drawer opens.
  useJiraIntegration();
  useEffect(() => {
    void prefetchJiraIntegration(qc);
  }, [qc]);

  const frameworkMapQ = useQuery({
    queryKey: ["check-frameworks"],
    queryFn: () => api("/v1/controls/check-frameworks", { schema: checkFrameworksSchema }),
    staleTime: 300_000,
  });
  // Category label for the row list — same composite taxonomy as the
  // Compliance page (id, not a display string), so the row list can show a
  // column-width-appropriate short label while staying the same underlying
  // grouping — not a second taxonomy invented for this table.
  const compositesQ = useQuery({
    queryKey: ["controls", "composites", "findings-categories"],
    queryFn: () => api("/v1/controls/composites", { schema: compositeControlListSchema }),
    staleTime: 300_000,
  });
  const categoryByCheckId = useMemo(() => {
    const map: Record<string, { id: string; title: string }> = {};
    for (const composite of compositesQ.data ?? []) {
      for (const checkId of composite.check_ids) {
        if (!map[checkId]) map[checkId] = { id: composite.id, title: composite.title };
      }
    }
    return map;
  }, [compositesQ.data]);
  const { options: cloudAccounts, isLoading: accountsLoading, isSuccess: accountsReady } =
    useConnectedAccountOptions();
  const githubProviderQ = useQuery({
    queryKey: ["github-provider"],
    queryFn: () => api("/v1/integrations/github", { schema: integrationStatusNullableSchema }),
    staleTime: 300_000,
  });
  const gitlabProviderQ = useQuery({
    queryKey: ["gitlab-provider"],
    queryFn: () => api("/v1/integrations/gitlab", { schema: integrationStatusNullableSchema }),
    staleTime: 300_000,
  });
  const hasGithub = !!githubProviderQ.data;
  const hasGitlab = !!gitlabProviderQ.data;
  const scopeGroups = useMemo(
    () => buildFindingsScopeGroups(cloudAccounts, { hasGithub, hasGitlab }),
    [cloudAccounts, hasGithub, hasGitlab],
  );
  const connectedScopeOptions = useMemo(() => flattenScopeGroups(scopeGroups), [scopeGroups]);
  const {
    accountId: selectedAccountId,
    activeAccount: selectedActiveAccount,
    setAccountId: setSelectedAccountId,
  } = useSelectedAccountId(cloudAccounts, accountsReady, {
    holdUrlSyncWhenParams: ["provider"],
    scopeDefaults: {
      cloudAccountCount: cloudAccounts.length,
      hasSourceControl: hasGithub || hasGitlab,
    },
  });
  const effectiveAccountId = providerScope ? "" : selectedAccountId;
  const activeAccount = providerScope ? undefined : selectedActiveAccount;
  const scopeParams: FindingsScopeParams = providerScope
    ? { provider: providerScope }
    : findingsScopeParams(activeAccount);
  const connectedId = effectiveAccountId || undefined;
  const awsScanAccountId =
    activeAccount?.provider === "aws" || !activeAccount?.provider ? effectiveAccountId || undefined : undefined;

  const findingsQueryEnabled =
    !accountsLoading &&
    (!!providerScope || !!effectiveAccountId || connectedScopeOptions.length > 0);

  useEffect(() => {
    if (!accountsReady || accountsLoading) return;
    if (searchParams.has("provider") || searchParams.has("account_id")) return;

    const stored = readStoredSelectedAccountId();
    if (stored === ALL_CLOUD_SCOPE_ID && cloudAccounts.length >= 1) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("provider", "all_cloud");
          next.delete("account_id");
          return next;
        },
        { replace: true },
      );
      return;
    }
    if (stored === SOURCE_CONTROL_SCOPE_ID && (hasGithub || hasGitlab)) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("provider", "source_control");
          next.delete("account_id");
          return next;
        },
        { replace: true },
      );
      return;
    }
    if (stored && cloudAccounts.some((account) => account.id === stored)) return;

    if (cloudAccounts.length >= 1) {
      writeStoredSelectedAccountId(ALL_CLOUD_SCOPE_ID);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("provider", "all_cloud");
          next.delete("account_id");
          return next;
        },
        { replace: true },
      );
      return;
    }
    if (hasGithub || hasGitlab) {
      writeStoredSelectedAccountId(SOURCE_CONTROL_SCOPE_ID);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("provider", "source_control");
          next.delete("account_id");
          return next;
        },
        { replace: true },
      );
    }
  }, [
    accountsLoading,
    accountsReady,
    cloudAccounts,
    hasGithub,
    hasGitlab,
    searchParams,
    setSearchParams,
  ]);

  const findingsQuery = useQuery({
    queryKey: ["findings", status, effectiveAccountId, scopeParams, providerScope],
    queryFn: () =>
      fetchAllFindings<Finding>({
        status,
        ...scopeParams,
      }),
    enabled: findingsQueryEnabled,
    refetchInterval: pendingRecheck ? 3000 : false,
  });
  const showFindingsLoading =
    accountsLoading ||
    (findingsQueryEnabled && !findingsQuery.isSuccess && !findingsQuery.isError);
  const { scanRun, scanStatus, isRunning, scanTriggered, triggerScan } = useTriggeredScan(
    awsScanAccountId,
    { onScanComplete: () => qc.invalidateQueries({ queryKey: ["findings"] }) },
  );

  useEffect(() => {
    if (isRefreshing && !findingsQuery.isFetching) {
      const t = setTimeout(() => setIsRefreshing(false), 600);
      return () => clearTimeout(t);
    }
  }, [findingsQuery.isFetching, isRefreshing]);

  useEffect(() => {
    const raw = searchParams.get("checks");
    const next = raw ? raw.split(",").filter(Boolean) : [];
    setSearchTags(next);
    if (next.length > 0) setStatus("open");
  }, [searchParams]);

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "recheck" | "reopen" }) =>
      api(`/v1/findings/${id}/${action}`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: (data, { id, action }) => {
      if (action === "recheck") {
        const result = data as RecheckResponse;
        const checkId = selected?.check_id ?? result.check_id ?? "";
        if (!applyRecheckResult(id, checkId, result)) setTimeout(() => qc.invalidateQueries({ queryKey: ["findings"] }), 6000);
      } else {
        qc.invalidateQueries({ queryKey: ["findings"] });
        if (selected) setSelected(data as Finding);
        if (action === "reopen") {
          clearDrawerVerifyFlash();
          setStatus("open");
        }
      }
    },
    onError: (_err, { id, action }) => {
      if (action === "recheck" && selected) failRecheck(id, selected.check_id);
    },
  });

  const findings = findingsQuery.data?.items ?? [];
  const scopedFindings = useMemo(
    () =>
      providerScope
        ? findings
        : findings.filter((finding) => findingBelongsToAccount(finding, activeAccount)),
    [activeAccount, findings, providerScope],
  );
  const hasActiveFilters =
    searchTags.length > 0 ||
    !!searchText.trim() ||
    severityFilter !== "all" ||
    selectedFrameworks.length > 0;
  const checkFrameworksApi = frameworkMapQ.data?.checks;

  // Keep drawer + resource list in sync when findings refetch (e.g. after Resources refresh).
  useEffect(() => {
    if (!selected) return;
    const byId = new Map(scopedFindings.map((f) => [f.id, f]));

    const nextGroup =
      selectedGroup.length > 0
        ? selectedGroup
            .map((g) => byId.get(g.id))
            .filter((f): f is Finding => f !== undefined)
        : selectedGroup;

    const groupChanged =
      selectedGroup.length > 0 &&
      (nextGroup.length !== selectedGroup.length ||
        nextGroup.some((f, i) => {
          const prev = selectedGroup[i];
          return !prev || f.id !== prev.id || findingDrawerSyncChanged(f, prev);
        }));

    let nextSelected = selected;
    const freshSelected = byId.get(selected.id);
    if (freshSelected) {
      if (findingDrawerSyncChanged(freshSelected, selected)) {
        nextSelected = freshSelected;
      }
    } else if (selected.status === "open") {
      const sibling = nextGroup.find((f) => f.id !== selected.id);
      nextSelected = sibling ?? { ...selected, status: "resolved" };
    }

    if (groupChanged) setSelectedGroup(nextGroup);
    if (nextSelected !== selected) setSelected(nextSelected);
  }, [scopedFindings, selected, selectedGroup]);
  const verifying = !!(selected && pendingRecheck?.findingId === selected.id);
  const verified = !!(selected && recheckOutcome?.findingId === selected.id && recheckOutcome.status === "verified");
  const verifyUnchanged = !!(selected && recheckOutcome?.findingId === selected.id && recheckOutcome.status === "unchanged");

  const benchmarkScopedFindings = useMemo(
    () => scopedFindings.filter((f) => matchesBenchmarkFilter(f, selectedFrameworks, checkFrameworksApi)),
    [scopedFindings, selectedFrameworks, checkFrameworksApi],
  );

  const rows = useMemo(() => {
    const qtext = searchText.trim().toLowerCase();
    const arr = benchmarkScopedFindings.filter((f) => {
      if (!matchesSeverityFilter(f, severityFilter)) return false;
      if (searchTags.length > 0) {
        const matchesCheck = searchTags.some((tag) => {
          if (f.check_id === tag) return true;
          const haystack = [
            f.title,
            f.check_id,
            f.resource_arn,
            checkLabels[f.check_id] ?? "",
            findingGroupSearchText(findingDisplayGroupKey(f.check_id)),
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(tag.toLowerCase());
        });
        if (!matchesCheck) return false;
      }
      if (!qtext) return true;
      return [
        f.title,
        f.check_id,
        f.resource_arn,
        checkLabels[f.check_id] ?? "",
        findingGroupSearchText(findingDisplayGroupKey(f.check_id)),
      ]
        .join(" ")
        .toLowerCase()
        .includes(qtext);
    });
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "severity") cmp = (sevWeight[a.severity] ?? 9) - (sevWeight[b.severity] ?? 9) || b.risk_score - a.risk_score;
      else if (sortKey === "score") cmp = b.risk_score - a.risk_score;
      else cmp = new Date(b.first_seen).getTime() - new Date(a.first_seen).getTime();
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [benchmarkScopedFindings, searchText, searchTags, severityFilter, sortKey, sortDir, status]);

  const buildDisplayGroups = useCallback(
    (source: Finding[]) => {
      const map = new Map<string, Finding[]>();
      for (const f of source) {
        const key = findingDisplayGroupKey(f.check_id);
        map.set(key, [...(map.get(key) ?? []), f]);
      }
      const entries = [...map.entries()];
      entries.sort(([, a], [, b]) => {
        let cmp = 0;
        if (sortKey === "severity")
          cmp =
            (sevWeight[a[0].severity] ?? 9) - (sevWeight[b[0].severity] ?? 9) ||
            Math.max(...b.map((f) => f.risk_score)) - Math.max(...a.map((f) => f.risk_score));
        else if (sortKey === "score") cmp = Math.max(...b.map((f) => f.risk_score)) - Math.max(...a.map((f) => f.risk_score));
        else
          cmp =
            Math.min(...b.map((f) => new Date(f.first_seen).getTime())) -
            Math.min(...a.map((f) => new Date(f.first_seen).getTime()));
        return sortDir === "asc" ? cmp : -cmp;
      });
      return entries;
    },
    [sortDir, sortKey],
  );

  const postureRows = useMemo(() => rows.filter((f) => !isActivityCheck(f.check_id)), [rows]);
  const activityRows = useMemo(() => rows.filter((f) => isActivityCheck(f.check_id)), [rows]);
  const postureDisplayGroups = useMemo(() => buildDisplayGroups(postureRows), [buildDisplayGroups, postureRows]);
  const activityDisplayGroups = useMemo(() => buildDisplayGroups(activityRows), [activityRows, buildDisplayGroups]);

  const toggleGroupSelected = useCallback((groupKey: string) => {
    setSelectedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }, []);
  const selectionCtx = useMemo(
    () => ({ selected: selectedGroupKeys, toggle: toggleGroupSelected }),
    [selectedGroupKeys, toggleGroupSelected],
  );
  // Ids resolve through the *current* display groups, so selections made
  // before a filter change simply stop matching instead of acting on hidden
  // rows.
  const selectedFindings = useMemo(() => {
    const out: Finding[] = [];
    const all = SHOW_ACTIVITY_DETECTIONS_SECTION
      ? [...postureDisplayGroups, ...activityDisplayGroups]
      : postureDisplayGroups;
    for (const [key, items] of all) {
      if (selectedGroupKeys.has(key)) out.push(...items);
    }
    return out;
  }, [postureDisplayGroups, activityDisplayGroups, selectedGroupKeys]);

  const clearBulkSelection = useCallback(() => {
    setSelectedGroupKeys(new Set());
    setBulkMode("actions");
    setBulkReason("");
    setBulkApprover("");
    setBulkMsg(null);
  }, []);

  const runBulk = useCallback(
    async (mutate: (id: string) => Promise<unknown>) => {
      setBulkBusy(true);
      setBulkMsg(null);
      const results = await Promise.allSettled(selectedFindings.map((f) => mutate(f.id)));
      const failed = results.filter((r) => r.status === "rejected").length;
      setBulkBusy(false);
      qc.invalidateQueries({ queryKey: ["findings"] });
      if (failed > 0) {
        setBulkMsg(`${results.length - failed} updated · ${failed} failed`);
      } else {
        clearBulkSelection();
      }
    },
    [selectedFindings, qc, clearBulkSelection],
  );

  const runBulkExcept = useCallback(() => {
    const reason = bulkReason.trim();
    const approver = bulkApprover.trim();
    if (!reason || !approver) return;
    void runBulk((id) =>
      api(`/v1/findings/${id}/exception`, {
        method: "POST",
        body: JSON.stringify({ reason, approved_by: approver, expires_at: null }),
      }),
    );
  }, [bulkApprover, bulkReason, runBulk]);

  const runBulkResolve = useCallback(() => {
    void runBulk((id) =>
      api(`/v1/findings/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ verified: true, note: "Bulk resolve from findings list" }),
      }),
    );
  }, [runBulk]);

  const exportSelectedCsv = useCallback(() => {
    const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const lines = [
      ["id", "check_id", "title", "severity", "risk_score", "status", "resource_arn", "first_seen", "last_seen"].join(","),
      ...selectedFindings.map((f) =>
        [f.id, f.check_id, f.title, f.severity, f.risk_score, f.status, f.resource_arn, f.first_seen, f.last_seen]
          .map(esc)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `veritrail-findings-selection-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [selectedFindings]);
  const isPositiveEmpty =
    findingsQuery.isSuccess && status === "open" && !hasActiveFilters && rows.length === 0;

  const severityCounts = useMemo(() => {
    const counts = { all: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of benchmarkScopedFindings) {
      counts.all += 1;
      if (f.severity === "critical") counts.critical += 1;
      else if (f.severity === "high") counts.high += 1;
      else if (f.severity === "medium") counts.medium += 1;
      else if (f.severity === "low") counts.low += 1;
      else if (f.severity === "info") counts.info += 1;
    }
    return counts;
  }, [benchmarkScopedFindings]);

  function openReview(items: Finding[], focus?: Finding, tab: FindingDrawerTab = "resources") {
    if (items.length === 0) return;
    const top =
      focus ??
      items.reduce((best, f) => (f.risk_score > best.risk_score ? f : best), items[0]);
    setSelected(top);
    setSelectedGroup(items);
    setDrawerTab(tab);
    setRemTab(defaultFindingRemediationMode(top.check_id));
    clearDrawerVerifyFlash();
  }

  function focusFinding(finding: Finding) {
    setSelected(finding);
    setRemTab(defaultFindingRemediationMode(finding.check_id));
  }

  const toggleExpandedCheck = useCallback((checkId: string) => {
    setExpandedCheckIds((prev) => {
      const next = new Set(prev);
      if (next.has(checkId)) next.delete(checkId);
      else next.add(checkId);
      return next;
    });
  }, []);

  function handleBenchmarkChange(next: FrameworkId[]) {
    setSelectedFrameworks(next);
    const serialized = serializeFrameworkParam(next);
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (serialized) params.set("framework", serialized);
        else params.delete("framework");
        return params;
      },
      { replace: true },
    );
  }

  function handleAccountChange(id: string) {
    if (id.startsWith(SCOPE_SENTINEL_PREFIX)) {
      const scope = id.slice(SCOPE_SENTINEL_PREFIX.length);
      const provider = scopeSentinelToProvider(scope);
      if (!provider) return;
      writeStoredSelectedAccountId(id);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("provider", provider);
          next.delete("account_id");
          return next;
        },
        { replace: true },
      );
      return;
    }
    writeStoredSelectedAccountId(id);
    setSelectedAccountId(id, { removeParams: ["provider"] });
  }

  function handleSearch(value: string) {
    setSearchText(value);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value.trim()) next.set("q", value.trim());
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  }

  function handleTagsChange(tags: string[]) {
    setSearchTags(tags);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tags.length > 0) next.set("checks", tags.join(","));
        else next.delete("checks");
        return next;
      },
      { replace: true },
    );
  }

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      // score's comparator is high-first under "asc" — first click on Risk
      // should surface the highest risk, not the lowest.
      setSortDir(k === "first_seen" ? "desc" : "asc");
    }
  }

  // j/k row navigation (Enter/Space already handled by each row's own key
  // handler once focused). Skips text inputs and modifier combos.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "j" && e.key !== "k") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const rowEls = Array.from(document.querySelectorAll<HTMLElement>(".findings-v2-row"));
      if (rowEls.length === 0) return;
      e.preventDefault();
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? rowEls.indexOf(active) : -1;
      const next =
        e.key === "j" ? Math.min(rowEls.length - 1, idx + 1) : idx <= 0 ? 0 : idx - 1;
      const el = rowEls[next];
      el.focus();
      el.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const downloadCsv = useCallback(async () => {
    const BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:8000";
    const t = token();
    const qs = new URLSearchParams({ status });
    if (scopeParams.account_id) qs.set("account_id", scopeParams.account_id);
    if (scopeParams.gcp_project_id) qs.set("gcp_project_id", scopeParams.gcp_project_id);
    if (scopeParams.azure_subscription_id) qs.set("azure_subscription_id", scopeParams.azure_subscription_id);
    if (scopeParams.provider) qs.set("provider", scopeParams.provider);
    const res = await fetch(`${BASE}/v1/exports/findings.csv?${qs.toString()}`, {
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "veritrail-findings.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [scopeParams.account_id, scopeParams.azure_subscription_id, scopeParams.gcp_project_id, scopeParams.provider, status]);

  if (accountsReady && !accountsLoading && connectedScopeOptions.length === 0) return <ConnectAwsEmptyState />;

  return (
    <div className="findings-v2-page findings-v2-shell min-h-full w-full">
        {connectedScopeOptions.length > 0 && (
          <HeaderSlot>
          <HeaderFilterBar>
            <AccountFilterDropdown
              accounts={connectedScopeOptions}
              groups={scopeGroups.map((group) => ({ heading: group.heading, accounts: group.options }))}
              value={findingsScopeDropdownValue(providerScope, effectiveAccountId)}
              onChange={handleAccountChange}
            />
          </HeaderFilterBar>
          </HeaderSlot>
        )}

        {showFindingsLoading && (
          <div className="findings-v2-content min-w-0">
            <div className="findings-v2-card animate-pulse rounded-2xl border border-[#e6ebf2] bg-white p-6 shadow-sm shadow-zinc-950/[0.04]">
              <div className="h-10 rounded-xl bg-zinc-100" />
              <div className="mt-6 space-y-3">
                <div className="h-14 rounded-xl bg-zinc-50" />
                <div className="h-14 rounded-xl bg-zinc-50" />
                <div className="h-14 rounded-xl bg-zinc-50" />
              </div>
            </div>
          </div>
        )}

        {findingsQuery.isError && (
          <div className="py-16 text-center">
            <p className="text-sm font-semibold text-red-700">Could not load findings</p>
            <p className="mt-1 text-xs text-red-600/80">{formatApiError(findingsQuery.error)}</p>
            <button
              type="button"
              onClick={() => findingsQuery.refetch()}
              className="mt-4 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 transition hover:bg-red-50"
            >
              Retry
            </button>
          </div>
        )}

        {!showFindingsLoading && !findingsQuery.isError && (
          <section className="findings-v2-content min-w-0">
            <div className="findings-v2-card rounded-2xl border border-[#e6ebf2] bg-white shadow-sm shadow-zinc-950/[0.04]">
              <div className="findings-v2-table-toolbar">
                <div className="findings-v2-toolbar-scroll">
                  <div className="findings-v2-filter-cluster">
                    <FilterChipBar
                      chips={severityTabs.map((tab) => ({
                        id: tab.id,
                        label: tab.label,
                        count: severityCounts[tab.id],
                        urgent: tab.urgent,
                      }))}
                      selected={severityFilter}
                      onChange={(id) => setSeverityFilter(id as SeverityFilter)}
                      ariaLabel="Severity"
                    />

                    <FindingsChecksFilter tags={searchTags} checkLabels={checkLabels} onChange={handleTagsChange} />
                    <BenchmarkFrameworkSelect selected={selectedFrameworks} onChange={handleBenchmarkChange} />
                    <FindingsStatusSelect
                      value={status}
                      onChange={setStatus}
                    />
                  </div>

                  <div className="findings-v2-control-cluster">
                    <ToolbarSearchInput
                      id="findings-search"
                      name="findings-search"
                      className="findings-v2-search"
                      placeholder="Search finding"
                      aria-label="Search findings"
                      value={searchText}
                      onChange={handleSearch}
                    />
                    <div className="findings-v2-toolbar-group findings-v2-toolbar-group--divider" role="group" aria-label="Finding actions">
                      <button
                        type="button"
                        onClick={() => {
                          qc.invalidateQueries({ queryKey: ["findings"] });
                          setIsRefreshing(true);
                        }}
                        disabled={isRefreshing}
                        className="findings-v2-toolbar-btn findings-v2-toolbar-icon-btn"
                        aria-label={isRefreshing ? "Refreshing findings" : "Refresh findings"}
                        title={isRefreshing ? "Refreshing" : "Refresh"}
                      >
                        <svg className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4m-4 4a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" />
                        </svg>
                      </button>
                    </div>
                    <div className="findings-v2-toolbar-group findings-v2-actions-group" role="group" aria-label="Export and scan">
                      <button type="button" onClick={downloadCsv} className="findings-v2-toolbar-btn findings-v2-toolbar-btn--ghost">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                        Export
                      </button>
                      {awsScanAccountId ? (
                        <FindingsScanButton
                          connectedId={awsScanAccountId}
                          isRunning={isRunning}
                          scanTriggered={scanTriggered}
                          onScan={triggerScan}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <FindingsChecksFilterSummary
                tags={searchTags}
                checkLabels={checkLabels}
                displayGroupCount={
                  searchTags.length > 0
                    ? postureDisplayGroups.length +
                      (SHOW_ACTIVITY_DETECTIONS_SECTION ? activityDisplayGroups.length : 0)
                    : undefined
                }
                onClear={() => handleTagsChange([])}
              />

              {rows.length === 0 ? (
                <div className={`px-6 py-16 text-center ${isPositiveEmpty ? "bg-emerald-50/40" : ""}`}>
                  {isPositiveEmpty ? (
                    <>
                      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-200/80">
                        <svg className="h-6 w-6 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <p className="text-sm font-semibold text-emerald-800">All clear</p>
                      <p className="mt-1 text-xs text-emerald-700/80">No open findings. Run a scan to refresh posture.</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-zinc-700">
                        {searchTags.length > 0
                          ? "No findings match the selected checks"
                          : selectedFrameworks.length > 0
                            ? `No findings for ${benchmarkSelectionLabel(selectedFrameworks)}`
                            : emptyFindingsLabel(status)}
                      </p>
                      <p className="mt-1 text-xs text-zinc-400">
                        {status === "open" ? "Run a scan or adjust filters." : "Nothing to show here."}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <FindingMetaContext.Provider value={{ categoryByCheckId, checkFrameworksApi }}>
                <FindingSelectionContext.Provider value={selectionCtx}>
                  <div
                    className="findings-v2-col-head findings-v2-row-grid hidden lg:grid"
                    role="row"
                  >
                    <span className="findings-v2-col-chevron" aria-hidden />
                    <button
                      type="button"
                      className="findings-v2-col-head__sort findings-v2-col-severity text-left"
                      onClick={() => toggleSort("severity")}
                      aria-label={`Sort by severity${sortKey === "severity" ? ` (${sortDir}ending)` : ""}`}
                    >
                      Severity{sortKey === "severity" ? <span aria-hidden> {sortDir === "asc" ? "↑" : "↓"}</span> : null}
                    </button>
                    <span className="findings-v2-col-finding">Finding</span>
                    <span className="findings-v2-col-resources">Resources</span>
                    <span className="findings-v2-col-benchmark">Benchmark</span>
                    <span className="findings-v2-col-category">Category</span>
                    <button
                      type="button"
                      className="findings-v2-col-head__sort findings-v2-col-risk justify-center text-center"
                      onClick={() => toggleSort("score")}
                      aria-label={`Sort by risk${sortKey === "score" ? ` (${sortDir}ending)` : ""}`}
                    >
                      Risk{sortKey === "score" ? <span aria-hidden> {sortDir === "asc" ? "↑" : "↓"}</span> : null}
                    </button>
                  </div>

                  {postureDisplayGroups.length > 0 ? (
                      <VirtualizedFindingsGroups
                        className="findings-v2-table"
                        groups={postureDisplayGroups}
                        expandedCheckIds={expandedCheckIds}
                        toggleExpandedCheck={toggleExpandedCheck}
                        onReview={openReview}
                        FindingRow={FindingRow}
                      />
                  ) : null}

                  {SHOW_ACTIVITY_DETECTIONS_SECTION && activityDisplayGroups.length > 0 ? (
                    <div className={postureDisplayGroups.length > 0 ? "mt-8 border-t border-zinc-100 pt-6" : ""}>
                      <div className="mb-3 px-1">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-500">Activity detections</p>
                        <p className="mt-0.5 text-xs text-zinc-500">CloudTrail events — informational; they do not fail compliance controls.</p>
                      </div>
                      <VirtualizedFindingsGroups
                        className="findings-v2-table"
                        groups={activityDisplayGroups}
                        expandedCheckIds={expandedCheckIds}
                        toggleExpandedCheck={(key) => toggleExpandedCheck(`activity:${key}`)}
                        onReview={openReview}
                        FindingRow={FindingRow}
                        keyPrefix="activity:"
                      />
                    </div>
                  ) : null}

                  <p className="findings-v2-end-cap">
                    {rows.length.toLocaleString()} {rows.length === 1 ? "finding" : "findings"}
                  </p>
                </FindingSelectionContext.Provider>
                </FindingMetaContext.Provider>
              )}
            </div>
          </section>
        )}

      {selectedFindings.length > 0 ? (
        <div className="findings-bulk-bar" role="toolbar" aria-label="Bulk finding actions">
          <span className="findings-bulk-bar__count">
            {selectedFindings.length.toLocaleString()} {selectedFindings.length === 1 ? "finding" : "findings"}
          </span>
          {bulkMode === "except" ? (
            <>
              <input
                className="findings-bulk-bar__input"
                placeholder="Exception reason…"
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
                autoFocus
              />
              <input
                className="findings-bulk-bar__input findings-bulk-bar__input--narrow"
                placeholder="Approved by…"
                value={bulkApprover}
                onChange={(e) => setBulkApprover(e.target.value)}
              />
              <button
                type="button"
                className="findings-bulk-bar__btn findings-bulk-bar__btn--primary"
                disabled={bulkBusy || !bulkReason.trim() || !bulkApprover.trim()}
                onClick={runBulkExcept}
              >
                {bulkBusy ? "Applying…" : "Confirm exception"}
              </button>
              <button type="button" className="findings-bulk-bar__btn" onClick={() => setBulkMode("actions")}>
                Cancel
              </button>
            </>
          ) : bulkMode === "resolve" ? (
            <>
              <span className="findings-bulk-bar__hint">Confirms you re-checked these findings</span>
              <button
                type="button"
                className="findings-bulk-bar__btn findings-bulk-bar__btn--primary"
                disabled={bulkBusy}
                onClick={runBulkResolve}
              >
                {bulkBusy ? "Resolving…" : `Resolve ${selectedFindings.length.toLocaleString()}`}
              </button>
              <button type="button" className="findings-bulk-bar__btn" onClick={() => setBulkMode("actions")}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" className="findings-bulk-bar__btn" onClick={() => setBulkMode("except")}>
                Except…
              </button>
              <button type="button" className="findings-bulk-bar__btn" onClick={() => setBulkMode("resolve")}>
                Resolve…
              </button>
              <button type="button" className="findings-bulk-bar__btn" onClick={exportSelectedCsv}>
                Export CSV
              </button>
              <button type="button" className="findings-bulk-bar__btn" onClick={clearBulkSelection}>
                Clear
              </button>
            </>
          )}
          {bulkMsg ? <span className="findings-bulk-bar__msg">{bulkMsg}</span> : null}
        </div>
      ) : null}

      <FindingDrawer
        finding={selected}
        groupFindings={selectedGroup.length > 0 ? selectedGroup : selected ? [selected] : []}
        accountId={selected?.account_id ?? connectedId ?? null}
        tab={drawerTab}
        onTabChange={setDrawerTab}
        remTab={remTab}
        onRemTabChange={setRemTab}
        verified={verified}
        verifyUnchanged={verifyUnchanged}
        verifying={verifying}
        onDismissVerifyOutcome={clearDrawerVerifyFlash}
        onFocusFinding={focusFinding}
        onClose={() => {
          setSelected(null);
          setSelectedGroup([]);
          clearDrawerVerifyFlash();
        }}
        onAction={(id, action) => {
          if (action === "recheck") startRecheck(id, selected?.check_id ?? "");
          act.mutate({ id, action });
        }}
        onFindingPatched={(f) => {
          setSelected(f);
          setSelectedGroup((g) => g.map((x) => (x.id === f.id ? f : x)));
        }}
      />
    </div>
  );
}
