import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CompliancePageHeader } from "../components/CompliancePageHeader";
import { AccountFilterDropdown } from "../components/AccountFilterDropdown";
import { HeaderSlot } from "../context/HeaderSlot";
import { FilterChipBar } from "../components/FilterChipBar";
import {
  BenchmarkFrameworkSelect,
  benchmarkSelectionLabel,
  parseFrameworkParam,
  serializeFrameworkParam,
} from "../components/BenchmarkFrameworkSelect";
import { FindingsStatusSelect } from "../components/FindingsStatusSelect";
import { api, token } from "../api";
import { accountListSchema } from "../lib/apiSchemas";
import ConnectAwsEmptyState from "../components/ConnectAwsEmptyState";
import { FindingDrawer, defaultFindingRemediationMode, type FindingDrawerTab, type FindingRemediationMode } from "../components/FindingDrawer";
import { checkLabels } from "../data/checkLabels";
import {
  findingDisplayGroupKey,
  findingGroupMeta,
  findingGroupSearchText,
  isActivityCheck,
} from "../data/findingGroups";
import { fetchAllFindings } from "../lib/fetchAllFindings";
import { CHECK_FRAMEWORK_MAP } from "../data/checkFrameworkMap";
import type { FrameworkId } from "../data/frameworks";
import { resourceDisplayName as shortArn } from "../lib/timelineDisplay";
import { assetTypeLabel } from "../lib/findingDisplay";
import { vcsResourceWebUrl } from "../lib/findingDisplay";
import { isAccountConnected } from "../lib/accountConnection";
import { useTriggeredScan } from "../hooks/useTriggeredScan";
import { useRecheckNotifications, type RecheckResponse } from "../context/RecheckNotificationsContext";
import { CloudProviderMark } from "../components/FindingResourceIcon";
import "../styles/findings-v2.css";

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
};

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

function SeverityIndicator({ severity }: { severity: string }) {
  const badgeClass =
    "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium";
  if (severity === "critical") {
    return (
      <span className={`${badgeClass} bg-red-50 text-red-800 ring-1 ring-red-300/70`}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-600" aria-hidden />
        Critical
      </span>
    );
  }
  if (severity === "high") {
    return (
      <span className={`${badgeClass} bg-red-50/85 text-red-700 ring-1 ring-red-200/65`}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500/80" aria-hidden />
        High
      </span>
    );
  }
  if (severity === "medium") {
    return (
      <span className={`${badgeClass} bg-amber-50/90 text-amber-800 ring-1 ring-amber-200/70`}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/85" aria-hidden />
        Medium
      </span>
    );
  }
  return (
    <span className={`${badgeClass} bg-zinc-100/90 text-zinc-500 ring-1 ring-zinc-200/70`}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400/70" aria-hidden />
      Low
    </span>
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

const FINDINGS_ROW_GRID =
  "grid w-full grid-cols-[auto_1fr_auto] gap-x-3 gap-y-0 py-3.5 pl-4 pr-4 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:gap-4 sm:items-center";

const RESOURCE_CHILD_PREVIEW = 3;

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
      className="flex cursor-pointer items-center gap-4 rounded-xl border border-zinc-200/80 bg-white px-4 py-3.5 transition hover:border-zinc-300 hover:shadow-sm hover:shadow-zinc-950/[0.04]"
    >
      <ResourceProviderTile finding={finding} />
      <div className="flex min-w-0 flex-[1.6] items-center gap-3">
        {showSeverityDot ? <SeverityDot severity={finding.severity} /> : null}
        <span className="truncate text-[14px] font-semibold text-zinc-900">{name}</span>
        <span className="shrink-0 rounded-full bg-sky-50 px-2.5 py-1 text-[12px] font-semibold text-sky-700">{assetType}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="veritrail-kicker">Account</p>
        <p className="mt-1 flex items-center gap-2 text-[13px] font-semibold text-zinc-800">
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
      <div className="min-w-0 flex-1">
        <p className="veritrail-kicker">Last seen</p>
        <p className="mt-1 flex items-center gap-2 whitespace-nowrap text-[13px] font-medium tabular-nums text-zinc-800">
          {formatResourceDate(finding.last_seen)}
          <svg className="h-4 w-4 shrink-0 text-zinc-300" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
        </p>
      </div>
      <div className="min-w-0 flex-1">
        <p className="veritrail-kicker">First seen</p>
        <p className="mt-1 whitespace-nowrap text-[13px] font-medium tabular-nums text-zinc-800">{formatResourceDate(finding.first_seen)}</p>
      </div>
      {externalUrl ? (
        <a
          href={externalUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
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
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm shadow-zinc-950/[0.03]">
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
        className={`findings-v2-row finding-row ${railClass} group ${FINDINGS_ROW_GRID} cursor-pointer ${expanded ? "is-expanded sm:items-start" : "sm:items-center"}`}
        onClick={handleParentRowClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleParentRowClick();
          }
        }}
      >
        <div className="flex w-5 shrink-0 items-center justify-center self-center sm:col-auto sm:self-start sm:pt-2">
          <RowChevron expanded={expanded && canExpand} muted={!canExpand} />
        </div>

        <div className="hidden shrink-0 self-start pt-2 sm:col-auto sm:block sm:w-[5.5rem]">
          <SeverityIndicator severity={sev} />
        </div>

        <div className="finding-title-cell finding-cell min-w-0 sm:col-auto">
          <div className="flex min-w-0 items-baseline gap-1">
            <span className="finding-title min-w-0 truncate">{title}</span>
            {canExpand && !expanded ? (
              <span className="finding-resource-count">
                · {resources.length} {resources.length === 1 ? "resource" : "resources"}
              </span>
            ) : null}
          </div>
          <div className="mt-1 sm:hidden">
            <SeverityIndicator severity={sev} />
          </div>
        </div>

        <div
          className="flex shrink-0 items-center justify-end self-center sm:col-auto sm:w-16 sm:justify-center sm:self-start sm:pt-2"
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
            <div className="border-t border-zinc-100 sm:grid sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:gap-4">
              <span className="hidden sm:block" aria-hidden />
              <span className="hidden w-[5.5rem] sm:block" aria-hidden />
              <div className="py-4 pl-4 pr-5 sm:pl-0">
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
              <span className="hidden sm:block" aria-hidden />
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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedCheckIds, setExpandedCheckIds] = useState<Set<string>>(() => new Set());
  const [selectedAccountId, setSelectedAccountId] = useState(searchParams.get("account") ?? "");
  const { pendingRecheck, recheckOutcome, startRecheck, applyRecheckResult, failRecheck, clearDrawerVerifyFlash } =
    useRecheckNotifications();

  const frameworkMapQ = useQuery({
    queryKey: ["check-frameworks"],
    queryFn: () => api<{ checks: Record<string, string[]> }>("/v1/controls/check-frameworks"),
    staleTime: 300_000,
  });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api("/v1/accounts", { schema: accountListSchema }) });
  const connectedAccounts = useMemo(
    () => accounts.data?.filter((a) => isAccountConnected(a)) ?? [],
    [accounts.data],
  );
  const effectiveAccountId =
    (selectedAccountId && connectedAccounts.some((a) => a.id === selectedAccountId)
      ? selectedAccountId
      : connectedAccounts[0]?.id) || "";
  const connectedId = effectiveAccountId || undefined;

  const q = useQuery({
    queryKey: ["findings", status, effectiveAccountId],
    queryFn: () =>
      fetchAllFindings<Finding>({
        status,
        account_id: effectiveAccountId || undefined,
      }),
    refetchInterval: pendingRecheck ? 3000 : false,
  });
  const { scanRun, scanStatus, isRunning, scanTriggered, triggerScan } = useTriggeredScan(
    connectedId,
    { onScanComplete: () => qc.invalidateQueries({ queryKey: ["findings"] }) },
  );

  useEffect(() => {
    if (isRefreshing && !q.isFetching) {
      const t = setTimeout(() => setIsRefreshing(false), 600);
      return () => clearTimeout(t);
    }
  }, [q.isFetching, isRefreshing]);

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

  const findings = q.data?.items ?? [];
  const findingsTruncated = q.data?.truncated ?? false;
  const findingsTotal = q.data?.total ?? findings.length;
  const hasActiveFilters =
    searchTags.length > 0 ||
    !!searchText.trim() ||
    severityFilter !== "all" ||
    selectedFrameworks.length > 0;
  const checkFrameworksApi = frameworkMapQ.data?.checks;

  // Keep drawer + resource list in sync when findings refetch (e.g. after Resources refresh).
  useEffect(() => {
    if (!selected) return;
    const byId = new Map(findings.map((f) => [f.id, f]));

    const nextGroup =
      selectedGroup.length > 0
        ? selectedGroup
            .map((g) => byId.get(g.id))
            .filter((f): f is Finding => f !== undefined)
        : selectedGroup;

    const groupChanged =
      selectedGroup.length > 0 &&
      (nextGroup.length !== selectedGroup.length ||
        nextGroup.some(
          (f, i) =>
            f.id !== selectedGroup[i]?.id ||
            f.status !== selectedGroup[i]?.status ||
            f.last_seen !== selectedGroup[i]?.last_seen ||
            f.risk_score !== selectedGroup[i]?.risk_score,
        ));

    let nextSelected = selected;
    const freshSelected = byId.get(selected.id);
    if (freshSelected) {
      if (
        freshSelected.status !== selected.status ||
        freshSelected.last_seen !== selected.last_seen ||
        freshSelected.risk_score !== selected.risk_score
      ) {
        nextSelected = freshSelected;
      }
    } else if (selected.status === "open") {
      const sibling = nextGroup.find((f) => f.id !== selected.id);
      nextSelected = sibling ?? { ...selected, status: "resolved" };
    }

    if (groupChanged) setSelectedGroup(nextGroup);
    if (nextSelected !== selected) setSelected(nextSelected);
  }, [findings, selected, selectedGroup]);
  const verifying = !!(selected && pendingRecheck?.findingId === selected.id);
  const verified = !!(selected && recheckOutcome?.findingId === selected.id && recheckOutcome.status === "verified");
  const verifyUnchanged = !!(selected && recheckOutcome?.findingId === selected.id && recheckOutcome.status === "unchanged");

  const benchmarkScopedFindings = useMemo(
    () => findings.filter((f) => matchesBenchmarkFilter(f, selectedFrameworks, checkFrameworksApi)),
    [findings, selectedFrameworks, checkFrameworksApi],
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
  const isPositiveEmpty = status === "open" && !hasActiveFilters && rows.length === 0;

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
    setSelectedAccountId(id);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set("account", id);
        else next.delete("account");
        return next;
      },
      { replace: true },
    );
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
      setSortDir(k === "severity" ? "asc" : "desc");
    }
  }

  const downloadCsv = useCallback(async () => {
    const BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:8000";
    const t = token();
    const res = await fetch(`${BASE}/v1/exports/findings.csv?status=${status}`, {
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
  }, [status]);

  if (!accounts.isLoading && accounts.data && !connectedId) return <ConnectAwsEmptyState />;

  return (
    <div className="findings-v2-page findings-v2-shell min-h-full w-full">
        {connectedAccounts.length > 0 && (
          <HeaderSlot>
            <AccountFilterDropdown accounts={connectedAccounts} value={effectiveAccountId} onChange={handleAccountChange} />
          </HeaderSlot>
        )}

        <CompliancePageHeader
          kicker="Compliance"
          title="Findings"
          subtitle="Open issues mapped to automated checks. Remediate in AWS or document external coverage from Compliance groups."
        />

        {searchTags.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-zinc-500">Check filter</span>
            {searchTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 shadow-sm"
              >
                <span className="truncate">{checkLabels[tag] ?? tag}</span>
                <button
                  type="button"
                  className="text-zinc-400 hover:text-zinc-700"
                  aria-label={`Remove ${checkLabels[tag] ?? tag} filter`}
                  onClick={() => handleTagsChange(searchTags.filter((t) => t !== tag))}
                >
                  ×
                </button>
              </span>
            ))}
            <button type="button" onClick={() => handleTagsChange([])} className="text-xs font-semibold text-zinc-500 hover:text-indigo-700">
              Clear all
            </button>
          </div>
        )}

        {q.isLoading && <div className="py-16 text-center text-sm text-zinc-500">Loading…</div>}

        {!q.isLoading && (
          <section className="min-w-0">
            <div className="rounded-2xl border border-[#e6ebf2] bg-white shadow-sm shadow-zinc-950/[0.04]">
              <div className="findings-v2-table-toolbar">
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

                  <BenchmarkFrameworkSelect selected={selectedFrameworks} onChange={handleBenchmarkChange} />
                  <FindingsStatusSelect
                    value={status}
                    onChange={setStatus}
                  />
                </div>

                <div className="findings-v2-control-cluster">
                  <input
                    value={searchText}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder="Search finding, ARN, resource…"
                    className="findings-v2-search h-8 rounded-[10px] border border-[#dce3ec] bg-white px-3 text-sm text-[#111827] outline-none placeholder:text-[#98a2b3] focus-visible:border-[#94a3b8] focus-visible:ring-2 focus-visible:ring-[#1f4e79]/15"
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
                  <div className="findings-v2-toolbar-group" role="group" aria-label="Sort findings">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => toggleSort(opt.id)}
                        className="findings-v2-toolbar-btn"
                      >
                        {opt.label}
                        {sortKey === opt.id ? (
                          <span className="text-[13px] leading-none text-zinc-500">{sortDir === "asc" ? "↑" : "↓"}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                  <div className="findings-v2-toolbar-group findings-v2-actions-group" role="group" aria-label="Export and scan">
                    <button type="button" onClick={downloadCsv} className="findings-v2-toolbar-btn">
                      Export
                    </button>
                    {connectedId ? (
                      <FindingsScanButton
                        connectedId={connectedId}
                        isRunning={isRunning}
                        scanTriggered={scanTriggered}
                        onScan={triggerScan}
                      />
                    ) : null}
                  </div>
                </div>
              </div>

              {findingsTruncated && (
                <div className="flex items-center gap-2 border-b border-amber-200/70 bg-amber-50/60 px-6 py-2.5 text-[12px] text-amber-800">
                  <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <span>
                    Showing the {findings.length.toLocaleString()} highest-risk of {findingsTotal.toLocaleString()} findings.
                    Filter by check, severity, or account to see the rest.
                  </span>
                </div>
              )}
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
                <>
                  <div
                    className="findings-v2-col-head hidden sm:grid sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
                    role="row"
                  >
                    <span className="w-5" aria-hidden />
                    <span className="w-[5.5rem]">Severity</span>
                    <span>Finding</span>
                    <span className="w-16 text-center">Risk</span>
                  </div>

                  {postureDisplayGroups.length > 0 ? (
                    <div>
                      {postureDisplayGroups.map(([groupKey, items]) => (
                        <FindingRow
                          key={groupKey}
                          groupKey={groupKey}
                          items={items}
                          expanded={expandedCheckIds.has(groupKey)}
                          onToggleExpanded={() => toggleExpandedCheck(groupKey)}
                          onReview={openReview}
                        />
                      ))}
                    </div>
                  ) : null}

                  {activityDisplayGroups.length > 0 ? (
                    <div className={postureDisplayGroups.length > 0 ? "mt-8 border-t border-zinc-100 pt-6" : ""}>
                      <div className="mb-3 px-1">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-500">Activity detections</p>
                        <p className="mt-0.5 text-xs text-zinc-500">CloudTrail events — informational; they do not fail compliance controls.</p>
                      </div>
                      {activityDisplayGroups.map(([groupKey, items]) => (
                        <FindingRow
                          key={`activity-${groupKey}`}
                          groupKey={groupKey}
                          items={items}
                          expanded={expandedCheckIds.has(`activity:${groupKey}`)}
                          onToggleExpanded={() => toggleExpandedCheck(`activity:${groupKey}`)}
                          onReview={openReview}
                        />
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </section>
        )}

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
      />
    </div>
  );
}
