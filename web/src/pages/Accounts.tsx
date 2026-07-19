import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, formatApiError, isSessionStaleError, logout } from "../api";
import {
  accountListSchema,
  cloudAccountListSchema,
  cloudAccountOverviewSchema,
  complianceTimelineSchema,
  controlListSchema,
  evidenceCoverageSchema,
  scanStatsSchema,
  settingsSchema,
} from "../lib/apiSchemas";
import { fetchAllFindings } from "../lib/fetchAllFindings";
import { findingScopeProvider } from "../lib/findingDisplay";
import { serviceForCheck } from "../data/awsServiceMeta";
import {
  delta7d,
  deltaImproved,
  daysAgoIso,
  formatPercentDelta,
  postureTrendSeries,
  type BetterWhen,
  valueAtOrBeforeDaysAgo,
} from "../lib/accountMetricDeltas";
import type { ComplianceHistoryResponse, HistoryEvent } from "../lib/complianceHistory";
import { historyDetailLine, historyTypeDisplay } from "../lib/historyEvidence";
import { controlPostureScore } from "../lib/controlPostureScore";
import { DeploymentParametersCard } from "../components/accountOnboardingUI";
import {
  parseCfnLaunchMeta,
  resolveDeployArtifacts,
  type CfnConnectionOptions,
} from "../lib/cfnDeployCommands";
import { isValidIamRoleArn, sanitizeIamRoleArnInput } from "../lib/awsArn";
import {
  DEFAULT_REMEDIATION_MODULES,
  REMEDIATION_MODULE_SPECS,
  type RemediationModules,
} from "../data/remediationModules";
import ConfirmDialog from "../components/ConfirmDialog";
import { OrgReadinessHome } from "../components/OrgReadinessHome";
import { AccountReadinessOverview, scanRowToTimelineText } from "../components/AccountReadinessOverview";
import { ProductShell } from "../components/ProductShell";
import { HeaderSlot } from "../context/HeaderSlot";
import { MetricHelpTip } from "../components/MetricHelpTip";
import { SecurityScoreGauge } from "../components/SecurityScoreGauge";
import { ConnectorUpdateModal } from "../components/ConnectorUpdateModal";
import { ProviderMark, type CloudProvider } from "../components/AccountSelect";
import { Select } from "../components/Select";
import { AWS_LOGO_LIGHT } from "../lib/awsBrand";
import { INTEGRATION_BRAND } from "../lib/integrationBrands";
import { useAccountsPlanUsage } from "../hooks/useAccountsPlanUsage";
import {
  useConnectedAccountOptions,
  isCloudAccountConnected,
} from "../hooks/useConnectedAccountOptions";
import { useSelectedAccountId } from "../hooks/useSelectedAccountId";
import { useDebouncedCallback } from "../hooks/useDebouncedCallback";
import { formatScanProgressDetailLabel, mapWorkerStepToUiPhase } from "../hooks/useScanProgress";
import { useTriggeredScan } from "../hooks/useTriggeredScan";
import { useTriggeredCloudScan, type ScanRunLatest } from "../hooks/useTriggeredCloudScan";
import { IconShield } from "../components/IntegrationsUi";
import { AwsConnectFlow } from "../components/cloudConnect/AwsConnectFlow";
import { AzureConnectFlow } from "../components/cloudConnect/AzureConnectFlow";
import { CloudConnectOverlay } from "../components/cloudConnect/CloudConnectShell";
import { GcpConnectFlow } from "../components/cloudConnect/GcpConnectFlow";
import { isAccountConnected } from "../lib/accountConnection";
import { buildRecommendedActions } from "../lib/accountPosture";
import { classifyScanFailure, friendlyScanFailureMessage } from "../lib/scanFailureMessages";
import {
  CONNECTOR_STACK_NAME,
  SCANNER_ROLE_NAME,
  scannerRoleArnExample,
} from "../lib/connectionPosture";
import "../styles/accounts-page.css";
import "../styles/findings-v2.css";

type ConnectionOptions = {
  remediation_modules: RemediationModules;
};

type Account = {
  id: string;
  label: string;
  account_id: string | null;
  status: string;
  external_id: string;
  role_arn: string | null;
  remediation_modules: RemediationModules;
  remediation_modules_deployed: RemediationModules;
  cfn_stack_name: string;
  cfn_launch_url: string;
  cfn_update_launch_url: string;
  cfn_template_url: string;
  cfn_cli_command: string;
  cfn_update_cli_command: string;
  remediation_cfn_launch_url: string | null;
  remediation_cfn_template_url: string | null;
  remediation_cfn_cli_command: string | null;
  cfn_template_version: string | null;
  last_scan_at: string | null;
  last_error: string | null;
};

const DEFAULT_CONNECTION_OPTIONS: ConnectionOptions = {
  remediation_modules: { ...DEFAULT_REMEDIATION_MODULES },
};

function defaultOnboardingConnectionOptions(): ConnectionOptions {
  return {
    remediation_modules: { ...DEFAULT_REMEDIATION_MODULES },
  };
}

function roleArnFieldValidation(
  roleArn: string,
  verify: { isPending: boolean; isError: boolean; isSuccess: boolean },
): "idle" | "pending" | "success" | "error" | "invalid-format" {
  if (verify.isPending) return "pending";
  if (verify.isSuccess) return "success";
  if (verify.isError) return "error";
  const trimmed = roleArn.trim();
  if (trimmed && !isValidIamRoleArn(trimmed)) return "invalid-format";
  return "idle";
}

function accountConnectionOptions(acc: Account): ConnectionOptions {
  return {
    remediation_modules: { ...DEFAULT_REMEDIATION_MODULES, ...acc.remediation_modules },
  };
}

type PermissionVerifyRow = { action: string; granted: boolean };

type ModuleVerifyStatus = "not_requested" | "ready" | "missing_permissions" | "not_assumable";

type ModuleVerifyResult = {
  deployed: boolean;
  error: string | null;
  requested: boolean;
  status?: ModuleVerifyStatus;
  assumable?: boolean | null;
  role_arn?: string | null;
  permissions?: PermissionVerifyRow[];
  granted_count?: number;
  required_count?: number;
  policy_found?: boolean;
  runner_ready?: boolean | null;
};

type CapabilityVerifyResults = {
  advanced_policy_generation?: ModuleVerifyResult;
  ssm_remediation?: {
    requested?: boolean;
    deployed?: boolean;
    ready?: boolean;
    status?: ModuleVerifyStatus;
    error?: string | null;
    blockers?: string[];
  };
  remediation_modules?: Record<string, ModuleVerifyResult>;
};

type VerificationMeta = {
  method: string;
  description: string;
  safe: string;
  scanner_role_arn?: string | null;
};

type VerifyCapabilitiesResponse = {
  account: Account;
  capabilities: CapabilityVerifyResults;
  verification?: VerificationMeta;
};

const PERMISSION_VERIFY_DESCRIPTION = "Verified from deployed IAM role policy.";

const workflowInlineBtn =
  "inline-flex shrink-0 items-center justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50";

const neutralToolbarBtn = "veritrail-toolbar-btn veritrail-toolbar-btn--neutral shrink-0";

const neutralToolbarBtnLg =
  "veritrail-toolbar-btn veritrail-toolbar-btn--neutral veritrail-toolbar-btn--lg w-full sm:w-auto sm:min-w-[12rem]";

function WorkflowCheckIcon() {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
      </svg>
    </span>
  );
}

function WorkflowStepCard({
  variant,
  statusLabel,
  description,
  children,
}: {
  variant: "success" | "action";
  statusLabel: string;
  description?: string;
  children?: ReactNode;
}) {
  const success = variant === "success";
  return (
    <div
      className={
        success
          ? "rounded-lg border border-emerald-200/70 bg-emerald-50/50 px-4 py-3.5"
          : "rounded-lg border border-zinc-200/80 bg-zinc-50/60 px-4 py-3.5"
      }
    >
      <p
        className={`flex items-center gap-2 text-sm font-medium ${
          success ? "text-emerald-800" : "text-zinc-900"
        }`}
      >
        {success && <WorkflowCheckIcon />}
        {statusLabel}
      </p>
      {description && (
        <p
          className={`mt-1 text-xs leading-relaxed ${
            success ? "text-emerald-900/75" : "text-zinc-600"
          }`}
        >
          {description}
        </p>
      )}
      {children && <div className="mt-4 w-full">{children}</div>}
    </div>
  );
}

type ModuleStatusDisplay = {
  icon: string;
  label: string;
  tone: "success" | "warning" | "danger";
};

function moduleStatusDisplay(
  result: ModuleVerifyResult | undefined,
  deployedFallback: boolean,
): ModuleStatusDisplay | null {
  if (result?.requested) {
    if (result.status === "ready" || result.deployed) {
      const granted = result.granted_count ?? 0;
      const required = result.required_count ?? 0;
      const suffix = required > 0 ? ` · ${granted}/${required} permissions` : "";
      return { icon: "✓", label: `Ready${suffix}`, tone: "success" };
    }
    return null;
  }
  if (deployedFallback) {
    return { icon: "✓", label: "Ready", tone: "success" };
  }
  return null;
}

function ModuleStatusBadge({
  result,
  deployedFallback,
}: {
  result?: ModuleVerifyResult;
  deployedFallback: boolean;
}) {
  const status = moduleStatusDisplay(result, deployedFallback);
  if (!status) return null;
  const toneClass =
    status.tone === "success"
      ? "text-emerald-700"
      : status.tone === "danger"
        ? "text-red-700"
        : "text-amber-800";
  return (
    <span className={`mt-1.5 inline-flex items-center gap-1 text-xs font-medium ${toneClass}`}>
      <span aria-hidden>{status.icon}</span>
      <span>{status.label}</span>
    </span>
  );
}

const VERIFY_PROGRESS_STEPS = [
  "Assuming connector role…",
  "Reading IAM policies…",
] as const;

function PermissionVerificationPanel({
  onVerify,
  verifying,
  feedback,
  verificationMeta,
  showButton,
}: {
  onVerify: () => void;
  verifying: boolean;
  feedback: CapabilityVerifyFeedback | null;
  verificationMeta: VerificationMeta | null;
  showButton: boolean;
}) {
  const [progressStep, setProgressStep] = useState(0);

  useEffect(() => {
    if (!verifying) {
      setProgressStep(0);
      return;
    }
    const tick = window.setInterval(() => {
      setProgressStep((s) => (s + 1) % VERIFY_PROGRESS_STEPS.length);
    }, 1200);
    return () => window.clearInterval(tick);
  }, [verifying]);

  if (!showButton && !verificationMeta && !feedback) return null;

  const verified =
    feedback?.tone === "success" || Boolean(verificationMeta && feedback?.tone !== "error");

  if (verified) {
    return (
      <WorkflowStepCard
        variant="success"
        statusLabel="Permissions verified"
        description={verificationMeta?.description ?? PERMISSION_VERIFY_DESCRIPTION}
      />
    );
  }

  return (
    <WorkflowStepCard
      variant="action"
      statusLabel="Verify your stack"
      description="After updating CloudFormation, confirm IAM permissions match your selection."
    >
      {showButton && (
        <button
          type="button"
          onClick={onVerify}
          disabled={verifying}
          className={neutralToolbarBtn}
        >
          {verifying ? VERIFY_PROGRESS_STEPS[progressStep] : "Verify permissions"}
        </button>
      )}
      {verifying && (
        <p className="mt-2 text-[11px] text-zinc-500">One round-trip — usually a few seconds.</p>
      )}
      {feedback?.tone === "error" && (
        <p className="mt-2 text-xs leading-relaxed text-red-600">{feedback.message}</p>
      )}
    </WorkflowStepCard>
  );
}

function remediationModuleVerified(
  verify: ModuleVerifyResult | undefined,
  deployedFallback: boolean,
): boolean {
  if (verify?.requested && (verify.status === "ready" || verify.deployed)) return true;
  return Boolean(deployedFallback && !verify?.requested);
}

/** IAM still has this capability — cannot turn off in Veritrail until stack is updated in AWS. */
function capabilityLockedInAws(
  verify: ModuleVerifyResult | undefined,
  deployedFallback: boolean,
): boolean {
  return remediationModuleVerified(verify, deployedFallback);
}

function enforceDeployedCapabilityLocks(
  acc: Account,
  capabilityVerify: CapabilityVerifyResults | null,
  options: ConnectionOptions,
): ConnectionOptions {
  const remediation_modules = { ...options.remediation_modules };
  for (const spec of REMEDIATION_MODULE_SPECS) {
    if (
      !remediation_modules[spec.id] &&
      capabilityLockedInAws(
        capabilityVerify?.remediation_modules?.[spec.id],
        Boolean(acc.remediation_modules_deployed[spec.id]),
      )
    ) {
      remediation_modules[spec.id] = true;
    }
  }

  return { remediation_modules };
}

function RemediationPermissionsBlock({
  permissions,
  verifyRows,
  variant = "code",
}: {
  permissions: readonly string[];
  verifyRows?: PermissionVerifyRow[];
  variant?: "code" | "bullets";
}) {
  const items = verifyRows?.length
    ? verifyRows
    : permissions.map((action) => ({ action, granted: undefined as boolean | undefined }));

  if (variant === "bullets") {
    return (
      <div className="rounded-md border border-zinc-200/90 bg-zinc-50/90 px-3 py-2.5">
        <ul className="space-y-1">
          {items.map((row) => (
            <li key={row.action} className="flex items-start gap-2 font-mono text-[11px] leading-snug text-zinc-700">
              {row.granted === true && (
                <span className="text-emerald-600" aria-hidden>
                  ✓
                </span>
              )}
              {row.granted === false && (
                <span className="text-amber-600" aria-hidden>
                  ○
                </span>
              )}
              {row.granted === undefined && (
                <span className="mt-0.5 text-zinc-400" aria-hidden>
                  •
                </span>
              )}
              <span>{row.action}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const lines = items.map((row) => {
    const mark = row.granted === true ? "✓" : row.granted === false ? "○" : "·";
    return `${mark} ${row.action}`;
  });

  return (
    <pre className="overflow-x-auto rounded-md border border-zinc-200/90 bg-zinc-50/90 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-zinc-700">
      {lines.join("\n")}
    </pre>
  );
}

function CapabilityAccessBadge({
  kind,
}: {
  kind: "included" | "read-only" | "read-analysis" | "scoped-write" | "automation";
}) {
  const styles =
    kind === "included"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200/60"
      : kind === "scoped-write" || kind === "automation"
        ? "bg-amber-50 text-amber-900 ring-amber-200/60"
        : kind === "read-analysis"
          ? "bg-violet-50 text-violet-900 ring-violet-200/60"
          : "bg-sky-50 text-sky-800 ring-sky-200/60";
  const label =
    kind === "included"
      ? "Included"
      : kind === "automation"
        ? "Automation"
        : kind === "scoped-write"
          ? "Write"
          : kind === "read-analysis"
            ? "Analysis"
            : "Read-only";
  return (
    <span
      className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1 ring-inset ${styles}`}
    >
      {label}
    </span>
  );
}

/** Green check — same visual as Core Scanner when a capability is verified and locked. */
function CapabilityVerifiedMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-emerald-600 ${className}`}
      aria-hidden
    >
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
      </svg>
    </span>
  );
}

function ConnectorTemplateBadge({ version }: { version: string | null }) {
  if (!version) return null;
  return (
    <span
      className="inline-flex items-center rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-800 ring-1 ring-sky-200/70"
      title="Latest Veritrail connector CloudFormation template version"
    >
      CFN v{version}
    </span>
  );
}

function PermissionCheckList({
  rows,
  fallback,
}: {
  rows?: PermissionVerifyRow[];
  fallback: readonly string[];
}) {
  const items = rows?.length
    ? rows
    : fallback.map((action) => ({ action, granted: false as boolean | undefined }));

  const verified = Boolean(rows?.length);

  return (
    <ul className="mt-1.5 space-y-1">
      {items.map((row) => (
        <li key={row.action} className="flex items-start gap-1.5 font-mono text-[11px] leading-relaxed">
          {verified && row.granted === true && (
            <span className="text-emerald-600" aria-hidden>
              ✓
            </span>
          )}
          {verified && row.granted === false && (
            <span className="text-amber-600" aria-hidden>
              ⚠
            </span>
          )}
          {!verified && (
            <span className="text-zinc-400" aria-hidden>
              •
            </span>
          )}
          <span className={row.granted === false ? "text-amber-900" : "text-zinc-600"}>{row.action}</span>
        </li>
      ))}
    </ul>
  );
}

type CapabilityVerifyFeedback = { tone: "success" | "error"; message: string };

function capabilityVerifyFeedback(
  data: VerifyCapabilitiesResponse,
): CapabilityVerifyFeedback | null {
  const errors: string[] = [];
  const adv = data.capabilities.advanced_policy_generation;
  if (adv?.requested && adv.status !== "ready" && adv.error) {
    errors.push(`Policy generation: ${adv.error}`);
  } else if (adv?.requested && adv.status === "not_assumable") {
    errors.push("Policy generation: Not assumable");
  }

  const ssm = data.capabilities.ssm_remediation;
  const mods = data.capabilities.remediation_modules ?? {};
  const anyRemediationRequested = REMEDIATION_MODULE_SPECS.some((m) => mods[m.id]?.requested);

  if (anyRemediationRequested || ssm?.requested) {
    if (ssm?.status === "not_assumable" && ssm.error) {
      errors.push(ssm.error);
    } else if (ssm?.error && ssm.status !== "ready") {
      errors.push(ssm.error);
    } else if (!ssm) {
      for (const spec of REMEDIATION_MODULE_SPECS) {
        const row = mods[spec.id];
        if (!row?.requested || row.status === "ready" || !row.error) continue;
        errors.push(`${spec.label}: ${row.error}`);
      }
    }
  }

  if (errors.length) {
    return { tone: "error", message: errors.join(" · ") };
  }

  const anyRequested =
    Boolean(adv?.requested) ||
    REMEDIATION_MODULE_SPECS.some((m) => mods[m.id]?.requested);
  if (anyRequested) {
    return {
      tone: "success",
      message: "All selected capabilities match deployed IAM role policies.",
    };
  }
  return null;
}

type Finding = {
  id: string;
  account_id?: string | null;
  account_label?: string | null;
  account_provider?: string | null;
  check_id: string;
  resource_arn?: string | null;
  title: string;
  risk_score: number;
  evidence?: Record<string, unknown>;
  severity: string;
  status: string;
  first_seen?: string;
  last_seen?: string;
};


type CloudAccountRow = {
  provider: string;
  id: string;
  external_id: string | null;
  label: string;
  status: string;
  last_scan_at: string | null;
  open_findings_count?: number;
};

type FindingStats = { critHigh: number; medium: number; low: number; info: number; open: number };

const EMPTY_FINDING_STATS: FindingStats = {
  critHigh: 0,
  medium: 0,
  low: 0,
  info: 0,
  open: 0,
};

type AccountListRow =
  | { kind: "aws"; account: Account }
  | { kind: "cloud"; cloud: CloudAccountRow };

function accountListRowKey(row: AccountListRow): string {
  if (row.kind === "aws") return `aws:${row.account.id}`;
  return `cloud:${row.cloud.provider}:${row.cloud.id}`;
}

function parseAccountListRowKey(key: string, rows: AccountListRow[]): AccountListRow | null {
  return rows.find((row) => accountListRowKey(row) === key) ?? null;
}

function accountListRowFromId(id: string, rows: AccountListRow[]): AccountListRow | null {
  if (!id) return null;
  return (
    rows.find((row) => (row.kind === "aws" ? row.account.id : row.cloud.id) === id) ?? null
  );
}

function accountIdFromListRow(row: AccountListRow): string {
  return row.kind === "aws" ? row.account.id : row.cloud.id;
}

function formatActivityAgo(iso: string): string {
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

function activityEventLabel(event: HistoryEvent): string {
  const detail = historyDetailLine(event);
  if (detail) return detail;
  return historyTypeDisplay(event).label;
}

function cloudProviderLabel(provider: string): string {
  if (provider === "gcp") return "Google Cloud";
  if (provider === "azure") return "Microsoft Azure";
  return provider.toUpperCase();
}

function cloudIntegrationPath(provider: string): string {
  if (provider === "gcp") return "/integrations/gcp";
  if (provider === "azure") return "/integrations/azure";
  return "/integrations";
}

function cloudScanPath(cloud: CloudAccountRow): string {
  if (cloud.provider === "gcp") return `/v1/integrations/gcp/projects/${cloud.id}/scan`;
  if (cloud.provider === "azure") return `/v1/integrations/azure/subscriptions/${cloud.id}/scan`;
  return "";
}

function formatShortScanDate(iso: string | null | undefined, opts?: { utc?: boolean }): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: opts?.utc ? "UTC" : undefined,
  });
}

function formatRelativeScanAgo(lastScanAt: string | null | undefined): string {
  if (!lastScanAt) return "Never";
  const t = new Date(lastScanAt).getTime();
  if (Number.isNaN(t)) return "Never";
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 45) return "Just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatLastScanTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type AccountListSort = "last_scan" | "name";

function lastScanMsForRow(row: AccountListRow): number {
  const iso = row.kind === "aws" ? row.account.last_scan_at : row.cloud.last_scan_at;
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function rowDisplayName(row: AccountListRow): string {
  return row.kind === "aws" ? row.account.label : row.cloud.label;
}

function sortAccountListRows(rows: AccountListRow[], sort: AccountListSort): AccountListRow[] {
  const copy = [...rows];
  if (sort === "name") {
    copy.sort((a, b) => rowDisplayName(a).localeCompare(rowDisplayName(b)));
    return copy;
  }
  copy.sort((a, b) => lastScanMsForRow(b) - lastScanMsForRow(a));
  return copy;
}

function matchesAccountStatusFilter(acc: Account, filter: string): boolean {
  if (filter === "all") return true;
  const connected = isAccountConnected(acc);
  if (filter === "connected") return connected;
  if (filter === "setup") return !connected;
  if (filter === "action") return connected && acc.status === "error";
  return true;
}

function matchesAccountProviderFilter(_acc: Account, filter: string): boolean {
  if (filter === "all") return true;
  return filter === "aws";
}

function matchesCloudProviderFilter(cloud: CloudAccountRow, filter: string): boolean {
  if (filter === "all") return true;
  return cloud.provider === filter;
}

function matchesCloudAccountStatusFilter(cloud: CloudAccountRow, filter: string): boolean {
  if (filter === "all") return true;
  const connected = isCloudAccountConnected(cloud);
  if (filter === "connected") return connected;
  if (filter === "setup") return !connected;
  if (filter === "action") return connected && cloud.status === "error";
  return true;
}

type AccountsToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  providerFilter: string;
  onProviderFilterChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  onAddAccount: () => void;
  addDisabled: boolean;
  addTitle?: string;
  adding: boolean;
};

const ACCOUNTS_FILTER_ACTIVE = (providerFilter: string, statusFilter: string) =>
  providerFilter !== "all" || statusFilter !== "all";

/** Search input, an anchored filter popover, and the add-account button —
    right-aligned so the toolbar isn't all bunched against the search box. */
function AccountsToolbar({
  search,
  onSearchChange,
  providerFilter,
  onProviderFilterChange,
  statusFilter,
  onStatusFilterChange,
  onAddAccount,
  addDisabled,
  addTitle,
  adding,
}: AccountsToolbarProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const filterActive = ACCOUNTS_FILTER_ACTIVE(providerFilter, statusFilter);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="accounts-toolbar">
      <div className="accounts-toolbar__start">
        <label className="accounts-toolbar__search">
          <span className="sr-only">Search accounts</span>
          <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" />
          </svg>
          <input
            id="accounts-search"
            name="accounts-search"
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by account name, ID, or provider..."
          />
        </label>
      </div>
      <div className="accounts-toolbar__end">
        <div className="accounts-toolbar__filter-wrap">
          <button
            ref={btnRef}
            type="button"
            className={`accounts-toolbar__icon-btn accounts-toolbar__filter-btn${filterActive ? " has-filters" : ""}`}
            aria-label="Filter accounts"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5l-6.25 7.2v5.05l-4 1.75v-6.8l-6.25-7.2Z" />
            </svg>
            {filterActive && <span className="accounts-toolbar__filter-dot" aria-hidden />}
          </button>
          {open && (
            <div ref={popoverRef} className="accounts-toolbar__filter-popover" role="dialog" aria-label="Filter accounts">
              <div className="accounts-toolbar__filter-field">
                <span className="accounts-toolbar__filter-label">Provider</span>
                <Select
                  className="accounts-toolbar__select"
                  value={providerFilter}
                  onChange={onProviderFilterChange}
                  options={[
                    { value: "all", label: "All providers" },
                    { value: "aws", label: "AWS" },
                    { value: "gcp", label: "Google Cloud" },
                    { value: "azure", label: "Microsoft Azure" },
                  ]}
                />
              </div>
              <div className="accounts-toolbar__filter-field">
                <span className="accounts-toolbar__filter-label">Status</span>
                <Select
                  className="accounts-toolbar__select"
                  value={statusFilter}
                  onChange={onStatusFilterChange}
                  options={[
                    { value: "all", label: "All statuses" },
                    { value: "connected", label: "Connected" },
                    { value: "setup", label: "Setup required" },
                    { value: "action", label: "Action required" },
                  ]}
                />
              </div>
              {filterActive && (
                <button
                  type="button"
                  className="accounts-toolbar__filter-clear"
                  onClick={() => {
                    onProviderFilterChange("all");
                    onStatusFilterChange("all");
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onAddAccount}
          disabled={addDisabled}
          title={addTitle}
          className="accounts-toolbar__add"
        >
          {adding ? "Adding…" : "+ Add account"}
        </button>
      </div>
    </div>
  );
}

function matchesCloudAccountSearch(cloud: CloudAccountRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    cloud.label,
    cloud.external_id ?? "",
    cloud.status,
    cloud.provider,
    cloudProviderLabel(cloud.provider),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function matchesAccountSearch(acc: Account, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const tags = ["aws", "amazon", "core scanner"];
  const haystack = [acc.label, acc.account_id ?? "", acc.status, ...tags].join(" ").toLowerCase();
  return haystack.includes(needle);
}

const SEV_MIX_COLORS = { critHigh: "#f87171", medium: "#fbbf24", low: "#4ade80", info: "#cbd5e1" } as const;

type MixSegment = { key: string; value: number; color: string };

function getMixSegments(stats: FindingStats | undefined): MixSegment[] {
  const open = stats?.open ?? 0;
  const critHigh = stats?.critHigh ?? 0;
  const medium = stats?.medium ?? 0;
  const low = stats?.low ?? 0;
  const info = stats?.info ?? 0;
  const segments: MixSegment[] = [];
  if (critHigh > 0) segments.push({ key: "ch", value: critHigh, color: SEV_MIX_COLORS.critHigh });
  if (medium > 0) segments.push({ key: "m", value: medium, color: SEV_MIX_COLORS.medium });
  if (low > 0) segments.push({ key: "l", value: low, color: SEV_MIX_COLORS.low });
  if (info > 0) segments.push({ key: "info", value: info, color: SEV_MIX_COLORS.info });
  const other = open - critHigh - medium - low - info;
  if (other > 0) segments.push({ key: "other", value: other, color: SEV_MIX_COLORS.info });
  return segments;
}

function mixSegmentTotal(segments: MixSegment[]): number {
  return segments.reduce((sum, seg) => sum + seg.value, 0);
}

function FindingsMixDonutSvg({
  segments,
  size = 72,
  stroke = 11,
  premium = false,
  gapPx = 3,
}: {
  segments: MixSegment[];
  size?: number;
  stroke?: number;
  premium?: boolean;
  gapPx?: number;
}) {
  const total = mixSegmentTotal(segments);
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circum = 2 * Math.PI * r;
  let cumulative = 0;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="100%" className="shrink-0" aria-hidden>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={premium ? "#e8eaee" : "#f0f1f3"} strokeWidth={stroke} />
      {segments.map((seg) => {
        const fraction = seg.value / total;
        const dash = fraction * circum;
        const visibleDash = premium ? Math.max(1, dash - gapPx) : dash;
        const rotation = cumulative * 360 - 90;
        cumulative += fraction;
        return (
          <circle
            key={seg.key}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={stroke}
            strokeDasharray={`${visibleDash} ${circum - visibleDash}`}
            strokeLinecap={premium ? "round" : "butt"}
            transform={`rotate(${rotation} ${cx} ${cy})`}
          />
        );
      })}
    </svg>
  );
}

function FindingsMixDonutCompact({
  stats,
  hasScanned,
  loading = false,
  size = 64,
  stroke = 3.5,
}: {
  stats: FindingStats | undefined;
  hasScanned: boolean;
  loading?: boolean;
  size?: number;
  stroke?: number;
}) {
  const total = stats?.open ?? 0;
  const segments = getMixSegments(stats);
  const showChart = hasScanned && !loading && segments.length > 0;

  return (
    <div className="accounts-findings-donut">
      <div className="accounts-findings-donut__ring">
        {loading ? (
          <div className="accounts-findings-donut__empty animate-pulse bg-zinc-100" aria-hidden />
        ) : showChart ? (
          <FindingsMixDonutSvg segments={segments} size={size} stroke={stroke} premium gapPx={1.5} />
        ) : (
          <div className="accounts-findings-donut__empty" aria-hidden />
        )}
      </div>
      <div className="accounts-findings-donut__hub">
        <span className="accounts-findings-donut__count">
          {loading ? "…" : hasScanned ? total : "—"}
        </span>
        <span className="accounts-findings-donut__label">Open</span>
      </div>
    </div>
  );
}

function FindingsSeverityLegend({
  stats,
  hasScanned,
  loading = false,
}: {
  stats: FindingStats | undefined;
  hasScanned: boolean;
  loading?: boolean;
}) {
  const critHigh = stats?.critHigh ?? 0;
  const medium = stats?.medium ?? 0;
  const low = stats?.low ?? 0;

  const rows = [
    { label: "High", count: critHigh, color: SEV_MIX_COLORS.critHigh },
    { label: "Medium", count: medium, color: SEV_MIX_COLORS.medium },
    { label: "Low", count: low, color: SEV_MIX_COLORS.low },
  ];

  return (
    <div className="accounts-findings-legend">
      {rows.map((row) => (
        <div className="accounts-findings-legend__row" key={row.label}>
          <span className="accounts-findings-legend__dot" style={{ background: row.color }} aria-hidden />
          <span className="accounts-findings-legend__count">
            {loading ? "…" : hasScanned ? row.count : "—"}
          </span>
          <span className="accounts-findings-legend__label">{row.label}</span>
        </div>
      ))}
    </div>
  );
}

function scanDayLabel(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function scanSucceeded(evt: { type?: string; controls_failed_before?: number | null; controls_failed_after?: number }) {
  if (evt.type === "compliance_regressed") return false;
  if (
    evt.controls_failed_before != null &&
    evt.controls_failed_after != null &&
    evt.controls_failed_after > evt.controls_failed_before
  ) return false;
  return true;
}

type RecentScanDisplayRow = {
  key: string;
  timestamp: string;
  succeeded: boolean;
  resourcesScanned?: number | null;
};

function scanResourcesLabel(resources: number | null | undefined, hasScanned: boolean): string {
  if (!hasScanned) return "— resources";
  const count = resources ?? 0;
  return `${count.toLocaleString()} resource${count === 1 ? "" : "s"}`;
}

function buildRecentScanRows(
  isAws: boolean,
  hasScanned: boolean,
  lastScanAt: string | null,
  awsEvents: ComplianceHistoryResponse["events"],
  cloudRuns: ScanRunLatest[] | undefined,
  fallbackResources?: number | null,
): RecentScanDisplayRow[] {
  if (isAws) {
    const rows: RecentScanDisplayRow[] =
      awsEvents.length > 0
        ? awsEvents.slice(0, 3).map((evt) => ({
            key: evt.scan_run_id + evt.timestamp,
            timestamp: evt.timestamp,
            succeeded: scanSucceeded(evt),
            resourcesScanned: fallbackResources ?? null,
          }))
        : [];
    if (hasScanned && lastScanAt) {
      const newestEventMs = rows[0] ? new Date(rows[0].timestamp).getTime() : 0;
      const lastScanMs = new Date(lastScanAt).getTime();
      if (lastScanMs > newestEventMs + 1000) {
        rows.unshift({
          key: `latest-${lastScanAt}`,
          timestamp: lastScanAt,
          succeeded: true,
          resourcesScanned: fallbackResources ?? null,
        });
      } else if (rows.length === 0) {
        rows.push({
          key: "fallback",
          timestamp: lastScanAt,
          succeeded: true,
          resourcesScanned: fallbackResources ?? null,
        });
      }
    }
    return rows.slice(0, 3);
  }
  const completed = (cloudRuns ?? []).filter(
    (run) => run.status !== "running" && (run.finished_at ?? run.started_at),
  );
  if (completed.length > 0) {
    return completed.map((run) => ({
      key: run.id,
      timestamp: run.finished_at ?? run.started_at,
      succeeded: run.status === "ok",
      resourcesScanned: run.resources_collected ?? fallbackResources ?? null,
    }));
  }
  if (hasScanned && lastScanAt) {
    return [{
      key: "fallback",
      timestamp: lastScanAt,
      succeeded: true,
      resourcesScanned: fallbackResources ?? null,
    }];
  }
  return [];
}

function FindingsMixDonut({ stats, hasScanned }: { stats: FindingStats | undefined; hasScanned: boolean }) {
  const total = stats?.open ?? 0;
  const critHigh = stats?.critHigh ?? 0;
  const medium = stats?.medium ?? 0;
  const low = stats?.low ?? 0;
  const info = stats?.info ?? 0;
  const other = Math.max(0, total - critHigh - medium - low - info);
  const segments = getMixSegments(stats);
  const showChart = hasScanned && segments.length > 0;

  return (
    <div className="flex shrink-0 items-center gap-4">
      <div className="relative h-[4.5rem] w-[4.5rem] shrink-0">
        {showChart ? (
          <FindingsMixDonutSvg segments={segments} size={72} stroke={11} />
        ) : (
          <div className="absolute inset-0 rounded-full border-[11px] border-zinc-100" aria-hidden />
        )}
        <div className="pointer-events-none absolute inset-[13%] flex flex-col items-center justify-center rounded-full bg-white text-center leading-none">
          <span className="text-[15px] font-bold tabular-nums text-zinc-900">{hasScanned ? total : "—"}</span>
          <span className="mt-px text-[8px] font-semibold uppercase tracking-wide text-zinc-400">Open</span>
        </div>
      </div>
      <div>
        <p className="text-center text-sm font-bold text-zinc-900">Severity breakdown</p>
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden />
            <span className="font-semibold tabular-nums text-zinc-800">{hasScanned ? critHigh : "—"}</span> C/H
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
            <span className="font-semibold tabular-nums text-zinc-800">{hasScanned ? medium : "—"}</span> M
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
            <span className="font-semibold tabular-nums text-zinc-800">{hasScanned ? low : "—"}</span> L
          </span>
          {hasScanned && other > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-zinc-400" aria-hidden />
              <span className="font-semibold tabular-nums text-zinc-800">{other}</span> Other
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AwsIcon({ className = "h-full w-full object-contain" }: { className?: string }) {
  return (
    <img
      src={AWS_LOGO_LIGHT}
      alt=""
      aria-hidden
      className={className}
      decoding="async"
    />
  );
}

function AwsIconTile({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-white shadow-sm shadow-zinc-950/[0.03] ${
        compact ? "h-[4.25rem] w-[4.25rem] p-3" : "h-[4.5rem] w-[4.5rem] p-3"
      } ${className ?? ""}`}
    >
      <AwsIcon className="h-full w-full" />
    </div>
  );
}

function CopyInputField({
  label,
  value,
  readOnly = true,
  placeholder,
  onChange,
  validation,
  accountId,
  helper,
  formatHint,
  variant = "default",
}: {
  label: string;
  value: string;
  readOnly?: boolean;
  placeholder?: string;
  onChange?: (v: string) => void;
  validation?: "idle" | "pending" | "success" | "error" | "invalid-format";
  accountId?: string | null;
  helper?: string;
  formatHint?: string;
  variant?: "default" | "connect";
}) {
  const [copied, setCopied] = useState(false);
  const roleArnExample = scannerRoleArnExample(accountId, value);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  const ring =
    validation === "success"
      ? "ring-emerald-500/30 focus-within:ring-emerald-500/40"
      : validation === "error" || validation === "invalid-format"
        ? "ring-red-500/30 focus-within:ring-red-500/40"
        : validation === "pending"
          ? "ring-teal-500/30 focus-within:ring-teal-500/40"
          : "ring-zinc-200/80 focus-within:ring-teal-500/30";

  const validationState =
    validation === "success"
      ? "is-success"
      : validation === "error" || validation === "invalid-format"
        ? "is-error"
        : validation === "pending"
          ? "is-pending"
          : "";

  if (variant === "connect") {
    return (
      <div className="accounts-connect-field">
        <label className="accounts-connect-field__label">{label}</label>
        {helper ? <p className="accounts-connect-field__helper">{helper}</p> : null}
        <div
          className={`accounts-connect-field__input${!readOnly ? " accounts-connect-field__input--editable" : ""}${validationState ? ` ${validationState}` : ""}`}
        >
          <input
            type="text"
            readOnly={readOnly}
            value={value}
            placeholder={placeholder ?? roleArnExample}
            onChange={
              readOnly
                ? undefined
                : (e) => onChange?.(sanitizeIamRoleArnInput(e.target.value))
            }
            onPaste={
              readOnly || !onChange
                ? undefined
                : (e) => {
                    e.preventDefault();
                    onChange(sanitizeIamRoleArnInput(e.clipboardData.getData("text/plain")));
                  }
            }
          />
          {readOnly ? (
            <button type="button" onClick={() => void copy()} className={copied ? "is-copied" : ""}>
              {copied ? "Copied" : "Copy"}
            </button>
          ) : null}
        </div>
        {formatHint ? <p className="accounts-connect-field__format">{formatHint}</p> : null}
        {validation === "success" && (
          <p className="accounts-connect-field__status accounts-connect-field__status--success">Verified</p>
        )}
        {validation === "invalid-format" && (
          <p className="accounts-connect-field__status accounts-connect-field__status--error">
            Enter a valid IAM role ARN (e.g. {roleArnExample})
          </p>
        )}
        {validation === "error" && (
          <p className="accounts-connect-field__status accounts-connect-field__status--error">
            Could not assume role — check stack Outputs and try again
          </p>
        )}
        {validation === "pending" && (
          <p className="accounts-connect-field__status accounts-connect-field__status--pending">Verifying connection…</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-zinc-600">{label}</label>
      <div
        className={`flex items-center gap-2 rounded-lg bg-zinc-50/80 px-3 py-2.5 ring-1 ring-inset transition ${ring}`}
      >
        <input
          type="text"
          readOnly={readOnly}
          value={value}
          placeholder={placeholder ?? roleArnExample}
          onChange={
            readOnly
              ? undefined
              : (e) => onChange?.(sanitizeIamRoleArnInput(e.target.value))
          }
          onPaste={
            readOnly || !onChange
              ? undefined
              : (e) => {
                  e.preventDefault();
                  onChange(sanitizeIamRoleArnInput(e.clipboardData.getData("text/plain")));
                }
          }
          className={`min-w-0 flex-1 bg-transparent font-mono text-sm text-zinc-900 outline-none placeholder:text-zinc-400 ${
            readOnly ? "cursor-default" : ""
          }`}
        />
        {readOnly && (
          <button
            type="button"
            onClick={copy}
            className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold transition ${
              copied
                ? "bg-emerald-50 text-emerald-700"
                : "bg-white text-zinc-600 shadow-sm ring-1 ring-zinc-200/80 hover:text-zinc-900"
            }`}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      {validation === "success" && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-emerald-600">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Verified
        </p>
      )}
      {validation === "invalid-format" && (
        <p className="mt-1.5 text-xs text-red-600">
          Enter a valid IAM role ARN (e.g. {roleArnExample})
        </p>
      )}
      {validation === "error" && (
        <p className="mt-1.5 text-xs text-red-600">Could not assume role — check stack Outputs and try again</p>
      )}
      {validation === "pending" && (
        <p className="mt-1.5 text-xs text-teal-600">Verifying connection…</p>
      )}
    </div>
  );
}

const metadataFieldShell =
  "inline-flex w-full items-center gap-1.5 rounded-md bg-white px-2 py-1.5 ring-1 ring-zinc-200/80";

function CompactTokenField({ value, maxWidth = "max-w-xs" }: { value: string; maxWidth?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={`${metadataFieldShell} ${maxWidth}`}>
      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-800">{value}</code>
      <button
        type="button"
        onClick={copy}
        title={copied ? "Copied" : "Copy"}
        className={`shrink-0 rounded p-1 transition ${
          copied ? "text-emerald-600" : "text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700"
        }`}
      >
        {copied ? (
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        )}
      </button>
    </div>
  );
}

function postureScoreTone(score: number): { bar: string; text: string } {
  if (score >= 80) return { bar: "bg-emerald-500", text: "text-emerald-700" };
  if (score >= 40) return { bar: "bg-amber-500", text: "text-amber-700" };
  return { bar: "bg-orange-500", text: "text-orange-600" };
}

function frameworkScoreTextClass(score: number | null | undefined): string {
  if (score == null) return "text-zinc-400";
  if (score >= 80) return "text-emerald-700";
  if (score >= 40) return "text-amber-700";
  return "text-orange-600";
}

function SecurityPostureModule({
  score,
  soc2,
  cis,
  iso,
  loading,
}: {
  score: number | null;
  soc2: number | null | undefined;
  cis: number | null | undefined;
  iso: number | null | undefined;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="w-full min-w-[200px] max-w-sm" aria-hidden>
        <div className="h-3.5 w-28 animate-pulse rounded bg-zinc-200/70" />
        <div className="mt-2.5 flex items-center gap-3">
          <div className="h-2 flex-1 animate-pulse rounded-full bg-zinc-100" />
          <div className="h-6 w-10 animate-pulse rounded bg-zinc-100" />
        </div>
        <div className="mt-2 h-3 w-48 animate-pulse rounded bg-zinc-100" />
      </div>
    );
  }

  if (score == null) {
    return (
      <div className="w-full min-w-[200px] max-w-sm">
        <p className="text-xs font-medium text-zinc-600">Security posture</p>
        <p className="mt-2 text-sm text-zinc-400">Awaiting control mapping data</p>
      </div>
    );
  }

  const tone = postureScoreTone(score);
  const benchmarks = [
    { label: "SOC2", score: soc2 },
    { label: "CIS", score: cis },
    { label: "ISO", score: iso },
  ];

  return (
    <div className="w-full min-w-[200px] max-w-sm">
      <p className="text-xs font-medium text-zinc-600">Security posture</p>
      <div className="mt-2 flex items-center gap-3">
        <div
          className="h-2 min-w-[5rem] flex-1 overflow-hidden rounded-full bg-zinc-100"
          role="progressbar"
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${score}% controls passing`}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${tone.bar}`}
            style={{ width: `${score}%` }}
          />
        </div>
        <span className={`shrink-0 text-xl font-semibold tabular-nums leading-none ${tone.text}`}>
          {score}%
        </span>
      </div>
      <p className="mt-2 text-xs tabular-nums text-zinc-500">
        {benchmarks.map((b, i) => (
          <span key={b.label}>
            {i > 0 && <span className="text-zinc-300"> · </span>}
            <span className="text-zinc-500">{b.label} </span>
            <span className={`font-medium ${frameworkScoreTextClass(b.score)}`}>
              {b.score != null ? `${b.score}%` : "—"}
            </span>
          </span>
        ))}
      </p>
    </div>
  );
}

function DetailCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="w-fit max-w-full min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider leading-none text-zinc-400">{label}</p>
      <div className="mt-1.5 flex min-h-[34px] items-center">{children}</div>
    </div>
  );
}

const ghostBtn =
  "inline-flex items-center gap-1.5 rounded-lg border border-transparent px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-200 hover:bg-white hover:text-zinc-900 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50";

const deployBtnRow = "flex w-full gap-2";
const deployPrimaryBtn =
  "flex flex-1 items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800";
const deploySecondaryBtn =
  "flex flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50";
const dangerGhostBtn =
  "inline-flex items-center gap-1.5 rounded-lg border border-transparent px-3 py-1.5 text-xs font-medium text-red-600 transition hover:border-red-200 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

function CapabilityBadges({
  acc: _acc,
  connectionOptions: _connectionOptions,
  capabilityVerify: _capabilityVerify,
  variant = "default",
}: {
  acc: Account;
  /** During pending setup, derive posture from local selection (avoids badge flicker on save). */
  connectionOptions?: ConnectionOptions;
  capabilityVerify?: CapabilityVerifyResults | null;
  variant?: "default" | "table";
}) {
  const wrapClass =
    variant === "table"
      ? "accounts-capability-badges"
      : "mt-1.5 flex min-w-0 flex-nowrap items-center gap-x-1.5";

  return (
    <div className={wrapClass}>
      <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200/60">
        Core scanner
      </span>
    </div>
  );
}

function ManageCapabilitiesPanel({
  acc,
  draft,
  onDraftChange,
  onClose,
  saveError,
  onVerifyCapabilities,
  verifyingCapabilities,
  verifyFeedback,
  capabilityVerify,
  verificationMeta,
}: {
  acc: Account;
  draft: ConnectionOptions;
  onDraftChange: (next: ConnectionOptions) => void;
  onClose: () => void;
  saveError: string | null;
  onVerifyCapabilities: () => void;
  verifyingCapabilities: boolean;
  verifyFeedback: CapabilityVerifyFeedback | null;
  capabilityVerify: CapabilityVerifyResults | null;
  verificationMeta: VerificationMeta | null;
}) {
  const [deployTab, setDeployTab] = useState<DeployTab>("cli");
  const [cliExpanded, setCliExpanded] = useState(false);
  return (
    <div className="border-t border-zinc-200/60 bg-zinc-50/40 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900">Connector</p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
            The Veritrail connector is a single read-only role. Update your{" "}
            <span className="font-mono text-zinc-600">{acc.cfn_stack_name || CONNECTOR_STACK_NAME}</span>{" "}
            stack in AWS to the latest template. It never modifies your resources.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <ConnectorTemplateBadge version={acc.cfn_template_version} />
            <span className="text-[11px] text-zinc-500">After deploy:</span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200/60">
              Core Scanner
            </span>
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-xs font-medium text-zinc-500 hover:text-zinc-800">
          Close
        </button>
      </div>

      <div className="mt-4 space-y-3">
        <div className="rounded-lg border border-l-4 border-l-emerald-500 border-emerald-200/60 bg-emerald-50/30 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <CapabilityVerifiedMark className="mt-0" />
            <p className="text-sm font-medium text-zinc-900">Core Scanner</p>
            <CapabilityAccessBadge kind="read-only" />
          </div>
          <p className="mt-1 text-xs leading-relaxed text-zinc-600">
            Read-only cloud evidence for SOC 2 / CIS / ISO mappings. Cannot modify your resources.
          </p>
        </div>
      </div>

      {saveError && (
        <p className="mt-3 text-xs text-red-600">{saveError}</p>
      )}

      <div className="mt-4 space-y-3 border-t border-zinc-200/60 pt-4">
        <DeployMethodTabs
          key="deploy-method-tabs"
          acc={acc}
          variant="update"
          activeTab={deployTab}
          onActiveTabChange={setDeployTab}
          cliExpanded={cliExpanded}
          onCliExpandedChange={setCliExpanded}
          deployOptions={draft}
        />
      </div>
    </div>
  );
}

function ConnectionCapabilitiesPicker({
  value,
  onChange,
  disabled,
  acc,
  capabilityVerify,
}: {
  value: ConnectionOptions;
  onChange: (next: ConnectionOptions) => void;
  disabled?: boolean;
  acc?: Account;
  capabilityVerify?: CapabilityVerifyResults | null;
}) {
  void value;
  void onChange;
  void disabled;
  void acc;
  void capabilityVerify;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-zinc-900">Connection mode</p>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
          The Veritrail connector is read-only — it collects evidence and never modifies your resources.
        </p>
      </div>

      <div className="rounded-lg border border-l-4 border-l-emerald-500 border-emerald-200/60 bg-emerald-50/30 px-3 py-2.5">
        <div className="flex items-start gap-2.5">
          <CapabilityVerifiedMark className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium leading-snug text-zinc-900">Core Scanner</p>
              <CapabilityAccessBadge kind="read-only" />
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
              Read-only cloud evidence · cannot modify your resources
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountDetailsPanel({
  acc,
  showManageCapabilities,
  showUpdateArn,
  roleArn,
  setRoleArn,
  verify,
  onCancelUpdate,
  manageCapabilitiesPanel,
}: {
  acc: Account;
  showManageCapabilities: boolean;
  showUpdateArn: boolean;
  roleArn: string;
  setRoleArn: (v: string) => void;
  verify: {
    mutate: () => void;
    isPending: boolean;
    isError: boolean;
    isSuccess: boolean;
    reset: () => void;
  };
  onCancelUpdate: () => void;
  manageCapabilitiesPanel: ReactNode;
}) {
  const roleDisplay =
    acc.role_arn ?? (acc.account_id ? `arn:aws:iam::${acc.account_id}:role/${SCANNER_ROLE_NAME}` : null);
  const roleArnValid = isValidIamRoleArn(roleArn);
  const roleArnValidation = roleArnFieldValidation(roleArn, verify);

  if (showUpdateArn) {
    return (
      <div className="space-y-3 px-4 py-3">
        <p className="text-sm font-medium text-zinc-900">Update IAM role</p>
        <p className="text-xs text-zinc-500">Paste the new Role ARN from your CloudFormation stack Outputs.</p>
        <CopyInputField label="External ID" value={acc.external_id} />
        <CopyInputField
          label="Role ARN"
          value={roleArn}
          readOnly={false}
          accountId={acc.account_id}
          onChange={setRoleArn}
          validation={roleArnValidation}
        />
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={() => verify.mutate()}
            disabled={verify.isPending || !roleArnValid}
            className={workflowInlineBtn}
          >
            {verify.isPending ? "Verifying…" : "Save & verify"}
          </button>
          <button onClick={onCancelUpdate} className={ghostBtn}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="divide-y divide-zinc-200/60">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-start sm:gap-x-6 sm:gap-y-3">
        <DetailCell label="External ID">
          <CompactTokenField value={acc.external_id} maxWidth="max-w-[18rem]" />
        </DetailCell>
        <DetailCell label="Role ARN">
          {roleDisplay ? (
            <CompactTokenField value={roleDisplay} maxWidth="max-w-[28rem]" />
          ) : (
            <div className={metadataFieldShell}>
              <span className="text-[11px] text-zinc-400">—</span>
            </div>
          )}
        </DetailCell>
      </div>

      {showManageCapabilities && manageCapabilitiesPanel}
    </div>
  );
}

function DeployRailCopyIconButton({
  text,
  ariaLabel = "Copy",
}: {
  text: string;
  ariaLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      className="accounts-deploy-rail__copy"
      onClick={(event) => void handleCopy(event)}
      aria-label={copied ? "Copied" : ariaLabel}
    >
      {copied ? (
        <svg fill="none" stroke="currentColor" strokeWidth={2.3} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2m-6 12h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2Z"
          />
        </svg>
      )}
    </button>
  );
}

function CliCodeBlock({
  command,
  expanded: expandedProp,
  onExpandedChange,
  defaultExpanded = false,
  compact = false,
}: {
  command: string;
  expanded?: boolean;
  onExpandedChange?: (open: boolean) => void;
  defaultExpanded?: boolean;
  compact?: boolean;
}) {
  const [expandedInternal, setExpandedInternal] = useState(defaultExpanded);
  const expanded = expandedProp ?? expandedInternal;
  const setExpanded = onExpandedChange ?? setExpandedInternal;
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  if (!expanded) {
    return (
      <div className="accounts-deploy-rail__expand-row">
        <button type="button" onClick={() => setExpanded(true)} className="accounts-deploy-rail__expand">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          Show CLI command
        </button>
        <DeployRailCopyIconButton text={command} ariaLabel="Copy CLI command" />
      </div>
    );
  }

  return (
    <div className={`accounts-cli-code${compact ? " accounts-cli-code--compact" : ""}`}>
      <div className="accounts-cli-code__head">
        <span className="accounts-cli-code__label">bash</span>
        <div className="accounts-cli-code__actions">
          {!compact ? (
            <button type="button" onClick={() => setExpanded(false)} className="accounts-cli-code__action">
              Collapse
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void copy()}
            className={`accounts-terraform-code__btn${copied ? " is-copied" : ""}`}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre className="accounts-code-scroll accounts-cli-code__body" onWheel={containCodeBlockWheel}>
        <code>{command}</code>
      </pre>
    </div>
  );
}

function hclString(value: string): string {
  return JSON.stringify(value);
}

function terraformList(values: readonly string[], indent = "    "): string {
  if (values.length === 0) return "[]";
  return `[\n${values.map((value) => `${indent}${hclString(value)},`).join("\n")}\n${indent.slice(0, -2)}]`;
}

function terraformPolicyDocumentForStatements(
  statements: readonly PolicyStatementSummary[],
  resourceOverrides: Partial<Record<string, string>> = {},
): string {
  return statements
    .map((statement) => {
      const resource =
        resourceOverrides[statement.sid] ??
        (statement.resource === "Veritrail-hosted SSM handler scripts"
          ? "var.veritrail_ssm_handler_scripts_arn"
          : hclString(statement.resource));
      const condition =
        statement.sid === "PassRemediationAutomationRole"
          ? `\n\n  condition {\n    test     = "StringEquals"\n    variable = "iam:PassedToService"\n    values   = ["ssm.amazonaws.com"]\n  }`
          : statement.sid === "PassAccessAnalyzerMonitorRole"
            ? `\n\n  condition {\n    test     = "StringEquals"\n    variable = "iam:PassedToService"\n    values   = ["access-analyzer.amazonaws.com"]\n  }`
            : "";
      return `  statement {\n    sid       = ${hclString(statement.sid)}\n    effect    = "Allow"\n    actions   = ${terraformList(statement.actions, "      ")}\n    resources = [${resource}]${condition}\n  }`;
    })
    .join("\n\n");
}

function terraformForConnection(acc: Account, connectionOptions: ConnectionOptions): string {
  const trustPrincipalArn = parseCfnLaunchMeta(acc.cfn_launch_url).trustPrincipalArn;
  const veritrailPrincipalArnVar = trustPrincipalArn
    ? `variable "veritrail_principal_arn" {\n  description = "AWS principal ARN that Veritrail uses to assume the connector role. Confirm this in your Veritrail deployment settings before applying."\n  type        = string\n  default     = ${hclString(trustPrincipalArn)}\n}`
    : `variable "veritrail_principal_arn" {\n  description = "AWS principal ARN that Veritrail uses to assume the connector role. Confirm this in your Veritrail deployment settings before applying."\n  type        = string\n}`;
  void connectionOptions;
  const scannerStatements = [...CORE_SCANNER_STATEMENTS];
  const roleBlocks = `data "aws_iam_policy_document" "veritrail_core_scanner_role_trust" {\n  statement {\n    sid     = "AllowVeritrailAssumeRole"\n    effect  = "Allow"\n    actions = ["sts:AssumeRole"]\n\n    principals {\n      type        = "AWS"\n      identifiers = [var.veritrail_principal_arn]\n    }\n\n    condition {\n      test     = "StringEquals"\n      variable = "sts:ExternalId"\n      values   = [var.external_id]\n    }\n  }\n\n  statement {\n    sid     = "AllowVeritrailRoleChainingContext"\n    effect  = "Allow"\n    actions = ["sts:SetSourceIdentity", "sts:TagSession"]\n\n    principals {\n      type        = "AWS"\n      identifiers = [var.veritrail_principal_arn]\n    }\n  }\n}\n\ndata "aws_iam_policy_document" "veritrail_core_scanner_role_policy" {\n${terraformPolicyDocumentForStatements(scannerStatements, {
      PassAccessAnalyzerMonitorRole: "aws_iam_role.veritrail_core_scanner_role.arn",
    })}\n}\n\nresource "aws_iam_role" "veritrail_core_scanner_role" {\n  name = var.veritrail_core_scanner_role_name\n\n  assume_role_policy = data.aws_iam_policy_document.veritrail_core_scanner_role_trust.json\n\n  tags = merge(var.tags, {\n    Name        = var.veritrail_core_scanner_role_name\n    ManagedBy   = "Terraform"\n    Application = "Veritrail"\n  })\n}\n\nresource "aws_iam_role_policy" "veritrail_core_scanner_role" {\n  name   = "VeritrailScannerAccess"\n  role   = aws_iam_role.veritrail_core_scanner_role.id\n  policy = data.aws_iam_policy_document.veritrail_core_scanner_role_policy.json\n}`;
  const outputs = `output "veritrail_core_scanner_role_arn" {\n  description = "ARN of the Veritrail core scanner role. Paste this back into Veritrail during verification."\n  value       = aws_iam_role.veritrail_core_scanner_role.arn\n}`;

  return `terraform {\n  required_version = ">= 1.5.0"\n\n  required_providers {\n    aws = {\n      source  = "hashicorp/aws"\n      version = ">= 5.0"\n    }\n  }\n}\n\nprovider "aws" {\n  region = var.aws_region\n}\n\nvariable "aws_region" {\n  description = "AWS region used by the AWS provider. IAM roles are global, but the provider still requires a region."\n  type        = string\n  default     = "us-east-1"\n}\n\nvariable "external_id" {\n  description = "External ID generated by Veritrail for this account connection."\n  type        = string\n  default     = ${hclString(acc.external_id)}\n}\n\n${veritrailPrincipalArnVar}\n\nvariable "veritrail_core_scanner_role_name" {\n  description = "Name of the Veritrail read-only scanner role."\n  type        = string\n  default     = ${hclString(SCANNER_ROLE_NAME)}\n}\n\nvariable "tags" {\n  description = "Tags applied to IAM roles."\n  type        = map(string)\n  default = {\n    ManagedBy = "Terraform"\n    Vendor    = "Veritrail"\n  }\n}\n\n${roleBlocks}\n\n${outputs}\n`;
}

function downloadTerraformModule(code: string, filename = "veritrail-connector.tf") {
  const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function TerraformCodeBlock({
  code,
  compact = false,
  expanded: expandedProp,
  onExpandedChange,
  defaultExpanded = false,
}: {
  code: string;
  compact?: boolean;
  expanded?: boolean;
  onExpandedChange?: (open: boolean) => void;
  defaultExpanded?: boolean;
}) {
  const [expandedInternal, setExpandedInternal] = useState(defaultExpanded);
  const expanded = expandedProp ?? expandedInternal;
  const setExpanded = onExpandedChange ?? setExpandedInternal;
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  if (compact && !expanded) {
    return (
      <div className="accounts-deploy-rail__expand-row">
        <button type="button" onClick={() => setExpanded(true)} className="accounts-deploy-rail__expand">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          Show full template
        </button>
        <DeployRailCopyIconButton text={code} ariaLabel="Copy Terraform module" />
      </div>
    );
  }

  return (
    <div className={`accounts-terraform-code${compact ? " accounts-terraform-code--compact" : ""}`}>
      <div className="accounts-terraform-code__head">
        <div>
          <span>main.tf</span>
        </div>
        <div className="accounts-terraform-code__actions">
          <button
            type="button"
            onClick={() => void copy()}
            className={`accounts-terraform-code__btn${copied ? " is-copied" : ""}`}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre className="accounts-code-scroll" onWheel={containCodeBlockWheel}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

type DeployTab = "console" | "cli" | "terraform";

type PolicyStatementSummary = {
  sid: string;
  actions: readonly string[];
  resource: string;
  grantedOn?: string;
};

const CORE_SCANNER_STATEMENTS: readonly PolicyStatementSummary[] = [
  { sid: "IamUserAndKeyEnumeration", actions: ["iam:ListUsers", "iam:ListMFADevices", "iam:GetLoginProfile", "iam:ListAccessKeys", "iam:GetAccessKeyLastUsed", "iam:GetAccountSummary", "iam:ListAccountAliases", "iam:GetAccountPasswordPolicy"], resource: "*" },
  { sid: "IamRoleEnumeration", actions: ["iam:ListRoles", "iam:ListRolePolicies", "iam:GetRolePolicy", "iam:ListAttachedRolePolicies", "iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListPolicies"], resource: "*" },
  { sid: "IamServiceLastAccessedRead", actions: ["iam:GetServiceLastAccessedDetails"], resource: "*" },
  { sid: "IamServerCertificates", actions: ["iam:ListServerCertificates", "iam:GetServerCertificate"], resource: "*" },
  { sid: "AccountContacts", actions: ["account:GetContactInformation", "account:GetAlternateContact", "account:GetAccountInformation"], resource: "*" },
  { sid: "S3BucketConfiguration", actions: ["s3:ListAllMyBuckets", "s3:GetAccountPublicAccessBlock", "s3:GetBucketLogging", "s3:GetEncryptionConfiguration", "s3:GetBucketVersioning", "s3:GetBucketPublicAccessBlock", "s3:GetBucketPolicy", "s3:GetBucketAcl"], resource: "*" },
  { sid: "KmsKeyConfiguration", actions: ["kms:ListKeys", "kms:DescribeKey", "kms:GetKeyRotationStatus", "kms:GetKeyPolicy", "kms:ListAliases"], resource: "*" },
  { sid: "CloudTrailConfiguration", actions: ["cloudtrail:DescribeTrails", "cloudtrail:GetTrailStatus", "cloudtrail:LookupEvents"], resource: "*" },
  { sid: "AwsBackupConfiguration", actions: ["backup:ListBackupPlans", "backup:ListBackupVaults"], resource: "*" },
  { sid: "GuardDutyConfiguration", actions: ["guardduty:ListDetectors", "guardduty:GetDetector", "guardduty:ListFindings", "guardduty:GetFindings"], resource: "*" },
  { sid: "SecurityHubConfiguration", actions: ["securityhub:DescribeHub"], resource: "*" },
  { sid: "VpcAndSecurityGroupEnumeration", actions: ["ec2:DescribeRegions", "ec2:DescribeVpcs", "ec2:DescribeFlowLogs", "ec2:DescribeSecurityGroups"], resource: "*" },
  { sid: "Ec2InstanceEnumeration", actions: ["ec2:DescribeInstances", "ec2:DescribeVolumes", "ec2:DescribeSnapshots", "ec2:DescribeSnapshotAttribute", "ec2:DescribeImages", "ec2:GetEbsEncryptionByDefault"], resource: "*" },
  { sid: "AccessAnalyzerEnumeration", actions: ["access-analyzer:ListAnalyzers"], resource: "*" },
  { sid: "ConfigServiceConfiguration", actions: ["config:DescribeConfigurationRecorders", "config:DescribeConfigurationRecorderStatus", "config:DescribeDeliveryChannels", "config:DescribeComplianceByConfigRule"], resource: "*" },
  { sid: "IdentityCenterDirectory", actions: ["sso:ListInstances", "sso:DescribeInstance", "sso:ListPermissionSets", "sso:DescribePermissionSet", "sso:ListAccountsForProvisionedPermissionSet", "sso:ListAccountAssignments", "identitystore:ListUsers", "identitystore:DescribeUser", "identitystore:DescribeGroup"], resource: "*" },
  { sid: "RdsConfiguration", actions: ["rds:DescribeDBInstances", "rds:DescribeDBSnapshots", "rds:DescribeDBSnapshotAttributes"], resource: "*" },
  { sid: "AcmCertificates", actions: ["acm:ListCertificates", "acm:DescribeCertificate"], resource: "*" },
  { sid: "LambdaConfiguration", actions: ["lambda:ListFunctions", "lambda:GetFunctionEventInvokeConfig"], resource: "*" },
  { sid: "SecretsManagerConfiguration", actions: ["secretsmanager:ListSecrets"], resource: "*" },
  { sid: "SsmParameters", actions: ["ssm:DescribeParameters"], resource: "*" },
  { sid: "ElbConfiguration", actions: ["elasticloadbalancing:DescribeLoadBalancers", "elasticloadbalancing:DescribeLoadBalancerAttributes", "elasticloadbalancing:DescribeListeners"], resource: "*" },
  { sid: "DynamoDbConfiguration", actions: ["dynamodb:ListTables", "dynamodb:DescribeTable", "dynamodb:DescribeContinuousBackups"], resource: "*" },
  { sid: "SnsConfiguration", actions: ["sns:ListTopics", "sns:GetTopicAttributes"], resource: "*" },
  { sid: "SqsConfiguration", actions: ["sqs:ListQueues", "sqs:GetQueueAttributes"], resource: "*" },
  { sid: "EcrConfiguration", actions: ["ecr:DescribeRepositories", "ecr:GetRegistryScanningConfiguration"], resource: "*" },
  { sid: "EksConfiguration", actions: ["eks:ListClusters", "eks:DescribeCluster"], resource: "*" },
  { sid: "EcsConfiguration", actions: ["ecs:ListClusters", "ecs:DescribeClusters", "ecs:ListServices", "ecs:DescribeServices", "ecs:DescribeTaskDefinition"], resource: "*" },
  { sid: "InspectorConfiguration", actions: ["inspector2:BatchGetAccountStatus", "inspector2:ListCoverage", "inspector2:ListFindings", "inspector2:BatchGetFindingDetails"], resource: "*" },
  { sid: "OrganizationsAccountLabel", actions: ["organizations:DescribeAccount"], resource: "*" },
] as const;

function containCodeBlockWheel(event: WheelEvent<HTMLElement>) {
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
    event.stopPropagation();
  }
}

function DeployMethodTabs({
  acc,
  variant = "create",
  deployOptions,
  activeTab,
  onActiveTabChange,
  cliExpanded,
  onCliExpandedChange,
}: {
  acc: Account;
  variant?: "create" | "update";
  deployOptions?: CfnConnectionOptions;
  activeTab?: DeployTab;
  onActiveTabChange?: (tab: DeployTab) => void;
  cliExpanded?: boolean;
  onCliExpandedChange?: (open: boolean) => void;
}) {
  const [internalTab, setInternalTab] = useState<DeployTab>("console");
  const [templateCopied, setTemplateCopied] = useState(false);
  const tab = activeTab ?? internalTab;
  const setTab = onActiveTabChange ?? setInternalTab;
  const isUpdate = variant === "update";
  const { consoleUrl, cliCommand, stackName } = resolveDeployArtifacts(
    acc,
    deployOptions,
    isUpdate ? "update" : "create",
  );
  const trustPrincipalArn = parseCfnLaunchMeta(acc.cfn_launch_url).trustPrincipalArn;
  const terraformCode = terraformForConnection(acc, deployOptions ?? accountConnectionOptions(acc));
  const consoleLabel = isUpdate ? "Open stack in console" : "Launch CloudFormation";

  async function copyTemplateUrl() {
    await navigator.clipboard.writeText(acc.cfn_template_url);
    setTemplateCopied(true);
    window.setTimeout(() => setTemplateCopied(false), 2000);
  }

  const tabs: { id: DeployTab; label: string }[] = [
    { id: "console", label: "Console" },
    { id: "cli", label: "CLI" },
    { id: "terraform", label: "Terraform" },
  ];

  return (
    <div>
      <div className="flex gap-1 rounded-lg bg-zinc-100/80 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              tab === t.id
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {tab === "console" && (
          <div className="space-y-2.5">
            {isUpdate ? (
              <>
                <p className="text-[11px] leading-relaxed text-zinc-600">
                  AWS does not support a reliable one-click update URL. Open{" "}
                  <span className="font-mono font-medium text-zinc-800">{stackName}</span>, choose{" "}
                  <span className="font-medium text-zinc-700">Update</span> →{" "}
                  <span className="font-medium text-zinc-700">Replace existing template</span>, paste
                  the template URL, then set parameters. Or use the{" "}
                  <span className="font-medium text-zinc-700">CLI</span> tab (recommended).
                </p>
                <ol className="list-decimal space-y-0.5 pl-4 text-[11px] leading-relaxed text-zinc-600">
                  <li>Open the stack below and click Update.</li>
                  <li>Replace existing template → Amazon S3 URL → paste copied template URL.</li>
                  <li>Next through parameters (match your capability toggles) → Submit.</li>
                </ol>
              </>
            ) : (
              <p className="text-[11px] leading-relaxed text-zinc-600">
                Launches stack{" "}
                <span className="font-mono font-medium text-zinc-800">{stackName}</span> with your
                selected capabilities pre-filled.
              </p>
            )}
            <div className={deployBtnRow}>
              <a href={consoleUrl} target="_blank" rel="noreferrer" className={deployPrimaryBtn}>
                {consoleLabel}
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </a>
              {isUpdate ? (
                <button type="button" onClick={() => void copyTemplateUrl()} className={deploySecondaryBtn}>
                  {templateCopied ? "Copied" : "Copy template URL"}
                </button>
              ) : (
                <a
                  href={acc.cfn_template_url}
                  target="_blank"
                  rel="noreferrer"
                  className={deploySecondaryBtn}
                >
                  View template YAML
                </a>
              )}
            </div>
          </div>
        )}
        {tab === "cli" && (
          <CliCodeBlock
            command={cliCommand}
            expanded={cliExpanded}
            onExpandedChange={onCliExpandedChange}
          />
        )}
        {tab === "terraform" && (
          <div className="space-y-3">
            <p className="text-[11px] leading-relaxed text-zinc-600">
              {trustPrincipalArn
                ? "Copy this into a Terraform module and apply. veritrail_principal_arn is pre-filled from your Veritrail deployment. Use the scanner role ARN output when verifying the account."
                : "Copy this into a Terraform module, set veritrail_principal_arn, then apply. Use the scanner role ARN output when verifying the account."}
            </p>
            <TerraformCodeBlock code={terraformCode} compact />
          </div>
        )}
      </div>
    </div>
  );
}


function resolveScanFreshness(lastScanAt: string | null | undefined): {
  freshness: "fresh" | "stale" | "none";
  detail: string;
} {
  if (!lastScanAt) return { freshness: "none", detail: "No scans yet" };
  const t = new Date(lastScanAt).getTime();
  if (Number.isNaN(t)) return { freshness: "none", detail: "No scans yet" };
  const hoursSince = (Date.now() - t) / 3_600_000;
  const freshness = hoursSince <= 26 ? "fresh" : "stale";
  const detail =
    hoursSince < 24
      ? "Last scan today"
      : hoursSince < 48
        ? "Last scan yesterday"
        : `Last scan ${Math.floor(hoursSince / 24)}d ago`;
  return { freshness, detail };
}

const cardClass =
  "rounded-xl border border-zinc-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06),0_4px_12px_rgba(0,0,0,0.04)] transition-[box-shadow,border-color] duration-200 hover:border-zinc-300 hover:shadow-[0_2px_8px_rgba(0,0,0,0.07),0_8px_20px_rgba(0,0,0,0.05)]";

function bumpFindingStats(map: Map<string, FindingStats>, key: string, severity: string) {
  const cur = map.get(key) ?? { critHigh: 0, medium: 0, low: 0, info: 0, open: 0 };
  cur.open += 1;
  const sev = (severity || "").toLowerCase();
  if (sev === "critical" || sev === "high") cur.critHigh += 1;
  else if (sev === "medium") cur.medium += 1;
  else if (sev === "low") cur.low += 1;
  else if (sev === "info") cur.info += 1;
  map.set(key, cur);
}

function buildStatsMap(items: Finding[] | undefined): Map<string, FindingStats> {
  const map = new Map<string, FindingStats>();
  for (const f of items ?? []) {
    if (!f.account_id) continue;
    bumpFindingStats(map, f.account_id, f.severity);
  }
  return map;
}

function buildIntegrationStatsMap(
  items: Finding[] | undefined,
  cloudAccounts: CloudAccountRow[],
): Map<string, FindingStats> {
  const byExternal = new Map<string, string>();
  const byLabel = new Map<string, string>();
  for (const cloud of cloudAccounts) {
    if (cloud.provider === "aws") continue;
    if (cloud.external_id) byExternal.set(`${cloud.provider}:${cloud.external_id}`, cloud.id);
    byLabel.set(`${cloud.provider}:${cloud.label.toLowerCase()}`, cloud.id);
  }

  const map = new Map<string, FindingStats>();
  for (const f of items ?? []) {
    const provider = f.account_provider;
    if (provider !== "gcp" && provider !== "azure") continue;
    const evidence = f.evidence ?? {};
    const externalId =
      typeof evidence.project_id === "string"
        ? evidence.project_id
        : typeof evidence.subscription_id === "string"
          ? evidence.subscription_id
          : null;
    let scopeId = externalId ? byExternal.get(`${provider}:${externalId}`) : undefined;
    if (!scopeId && f.account_label) {
      scopeId = byLabel.get(`${provider}:${f.account_label.toLowerCase()}`);
    }
    if (!scopeId) continue;
    bumpFindingStats(map, scopeId, f.severity);
  }
  return map;
}

type ScanScheduleData = {
  scanning: { enabled: boolean; interval: "daily" | "weekly" | "custom" | "manual"; custom_hours: number | null };
  scan_status: { next_scan_at: string | null };
};

function scanScheduleText(s?: ScanScheduleData): string {
  if (!s || !s.scanning.enabled || s.scanning.interval === "manual") return "Manual only";
  if (s.scanning.interval === "weekly") return "Weekly";
  if (s.scanning.interval === "custom") {
    return s.scanning.custom_hours ? `Every ${s.scanning.custom_hours} hours` : "Custom";
  }
  const next = s.scan_status.next_scan_at;
  if (next) {
    const t = new Date(next);
    if (!Number.isNaN(t.getTime())) {
      const at = t.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
        hour12: false,
      });
      return `Daily at ${at} UTC`;
    }
  }
  return "Daily";
}

/** Account card footer — quiet dates like the design mock (no local TZ suffix on last scan). */
function formatFooterScanDate(iso: string | null | undefined, opts?: { utc?: boolean }): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const locale = opts?.utc ? "en-US" : undefined;
  const timeZone = opts?.utc ? "UTC" : undefined;
  const date = d.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric", timeZone });
  const time = d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", hour12: true, timeZone });
  return opts?.utc ? `${date} ${time} UTC` : `${date} ${time}`;
}

function formatElapsed(ms: number | null | undefined): string | null {
  if (ms == null || ms < 0) return null;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const r = total % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

const SCAN_PHASES = [
  "Initializing",
  "Collecting assets",
  "Analyzing resources",
  "Policy evaluation",
  "Risk assessment",
  "Reporting",
] as const;

function CopyIdButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — no-op */
        }
      }}
      title="Copy account ID"
      className="inline-flex h-5 w-5 items-center justify-center rounded text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
    >
      {copied ? (
        <svg className="h-3.5 w-3.5 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.75}
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
      )}
    </button>
  );
}

type AccountMenuProps = {
  onUpdateConnector: () => void;
  onManageCapabilities: () => void;
  onUpdateRole: () => void;
  onDisconnect: () => void;
  scanDisabled?: boolean;
  disconnectPending?: boolean;
};

function AccountMenu({
  onUpdateConnector,
  onManageCapabilities,
  onUpdateRole,
  onDisconnect,
  scanDisabled = false,
  disconnectPending = false,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const itemClass =
    "block w-full px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50";

  useLayoutEffect(() => {
    if (!open) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setCoords({ top: r.bottom + 6, right: window.innerWidth - r.right });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScrollResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-800"
      >
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="2.25" />
          <circle cx="12" cy="12" r="2.25" />
          <circle cx="19" cy="12" r="2.25" />
        </svg>
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: coords.top, right: coords.right }}
            className="z-[60] w-52 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg shadow-zinc-900/10"
          >
            <button
              role="menuitem"
              disabled={scanDisabled}
              onClick={() => {
                setOpen(false);
                onUpdateConnector();
              }}
              className={itemClass}
            >
              Update connector
            </button>
            <button
              role="menuitem"
              disabled={scanDisabled}
              onClick={() => {
                setOpen(false);
                onManageCapabilities();
              }}
              className={itemClass}
            >
              Manage capabilities
            </button>
            <button
              role="menuitem"
              disabled={scanDisabled}
              onClick={() => {
                setOpen(false);
                onUpdateRole();
              }}
              className={itemClass}
            >
              Update role ARN
            </button>
            <button
              role="menuitem"
              disabled={disconnectPending}
              onClick={() => {
                setOpen(false);
                onDisconnect();
              }}
              className="block w-full px-3 py-2 text-left text-sm text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Disconnect account
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

function CloudAccountMenu({
  provider,
  onOpenIntegration,
}: {
  provider: string;
  onOpenIntegration: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const itemClass =
    "block w-full px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-50";

  useLayoutEffect(() => {
    if (!open) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setCoords({ top: r.bottom + 6, right: window.innerWidth - r.right });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScrollResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-800"
      >
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="2.25" />
          <circle cx="12" cy="12" r="2.25" />
          <circle cx="19" cy="12" r="2.25" />
        </svg>
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: coords.top, right: coords.right }}
            className="z-[60] w-52 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg shadow-zinc-900/10"
          >
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenIntegration();
              }}
              className={itemClass}
            >
              {cloudProviderLabel(provider)} integration
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

function AccountDetailOverflowMenu({
  onViewFindings,
  onManageConnection,
  onEditAccount,
}: {
  onViewFindings: () => void;
  onManageConnection: () => void;
  onEditAccount: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setCoords({ top: r.bottom + 6, right: window.innerWidth - r.right });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScrollResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        title="More actions"
        className={`accounts-detail-header__menu-btn${open ? " is-open" : ""}`}
      >
        <svg fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="2.25" />
          <circle cx="12" cy="12" r="2.25" />
          <circle cx="19" cy="12" r="2.25" />
        </svg>
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ top: coords.top, right: coords.right }}
            className="accounts-detail-header__menu-panel"
          >
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onViewFindings();
              }}
              className="accounts-detail-header__menu-item"
            >
              View findings
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onManageConnection();
              }}
              className="accounts-detail-header__menu-item"
            >
              Manage connection
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onEditAccount();
              }}
              className="accounts-detail-header__menu-item"
            >
              Edit account
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

function ScanPhaseBlock({
  progress,
  elapsedMs,
  progressStep,
  progressTotal,
  progressPhase,
  progressStepName,
  progressCollectorIndex,
  progressCollectorTotal,
  indeterminate,
  compact = false,
}: {
  progress: number;
  elapsedMs: number | null;
  progressStep: number | null;
  progressTotal: number | null;
  progressPhase: number | null;
  progressStepName: string | null;
  progressCollectorIndex: number | null;
  progressCollectorTotal: number | null;
  indeterminate: boolean;
  compact?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progress ?? 0)));
  const elapsed = formatElapsed(elapsedMs);
  const activeIdx = indeterminate
    ? 0
    : progressPhase != null
      ? Math.min(SCAN_PHASES.length - 1, progressPhase)
      : progressStep != null && progressTotal
        ? mapWorkerStepToUiPhase(progressStep, progressTotal)
        : Math.min(SCAN_PHASES.length - 1, Math.floor((pct / 100) * SCAN_PHASES.length));
  const activePhaseLabel = SCAN_PHASES[activeIdx] ?? SCAN_PHASES[0];
  const detailLabel = formatScanProgressDetailLabel(
    activePhaseLabel,
    activeIdx,
    progressStepName,
    progressCollectorIndex,
    progressCollectorTotal,
  );
  const showWorkerStepCount =
    !compact &&
    progressStep != null &&
    progressTotal != null &&
  !(progressCollectorIndex != null && progressCollectorTotal != null);

  return (
    <div className="accounts-scan-module accounts-scan-module--steps">
      <div className="accounts-scan-module__head">
        <div className="flex min-w-0 items-center gap-2.5">
          <svg className="h-5 w-5 shrink-0 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-20" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-90" d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <p className="accounts-scan-module__title">
            Scan in progress
            {!compact ? (
              <span className="ml-1.5 font-normal text-zinc-500">— {detailLabel}</span>
            ) : null}
            {!compact && showWorkerStepCount ? (
              <span className="ml-1.5 font-normal text-zinc-400">
                ({progressStep}/{progressTotal})
              </span>
            ) : null}
            {elapsed ? <span className="ml-1.5 font-normal text-zinc-500">· {elapsed}</span> : null}
          </p>
        </div>
        {!indeterminate ? (
          <p className="accounts-scan-module__pct">{pct}%</p>
        ) : (
          <p className="accounts-scan-module__pct">Starting…</p>
        )}
      </div>
      <div className="accounts-scan-module__bar">
        {indeterminate ? (
          <div className="accounts-scan-module__fill is-indeterminate" />
        ) : (
          <div className="accounts-scan-module__fill" style={{ width: `${pct}%` }} />
        )}
      </div>
      <div className={`accounts-scan-steps ${compact ? "accounts-scan-steps--compact" : ""}`}>
        {SCAN_PHASES.map((label, i) => {
          const done = i < activeIdx;
          const active = i === activeIdx;
          const last = i === SCAN_PHASES.length - 1;
          return (
            <div key={label} className="accounts-scan-steps__item">
              <div className="accounts-scan-steps__rail">
                <div
                  className={`accounts-scan-steps__line accounts-scan-steps__line--left ${
                    i === 0 ? "is-hidden" : done || active ? "is-done" : ""
                  }`}
                  aria-hidden
                />
                <span
                  className={`accounts-scan-steps__badge ${
                    done ? "is-done" : active ? "is-active" : ""
                  }`}
                >
                  {done ? (
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <div
                  className={`accounts-scan-steps__line accounts-scan-steps__line--right ${
                    last ? "is-hidden" : i < activeIdx ? "is-done" : ""
                  }`}
                  aria-hidden
                />
              </div>
              <span className={`accounts-scan-steps__label ${active ? "is-active" : done ? "is-done" : ""}`}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AccountCardActionBar({
  expanded,
  onToggleDetails,
  onViewFindings,
  onRescan,
  scanDisabled,
  scanRunning,
  inline,
}: {
  expanded: boolean;
  onToggleDetails: () => void;
  onViewFindings: () => void;
  onRescan: () => void;
  scanDisabled: boolean;
  scanRunning: boolean;
  inline?: boolean;
}) {
  const shell = inline
    ? "flex shrink-0 flex-wrap items-center justify-end gap-2"
    : "flex flex-wrap items-center justify-end gap-2 border-t border-zinc-100 px-4 py-3 sm:px-5";
  return (
    <div className={shell}>
      <button
        type="button"
        onClick={onToggleDetails}
        aria-expanded={expanded}
        className={neutralToolbarBtn}
      >
        Details
      </button>
      <button type="button" onClick={onViewFindings} className={neutralToolbarBtn}>
        Findings
      </button>
      <button type="button" onClick={onRescan} disabled={scanDisabled} className={`${neutralToolbarBtn} account-scan-btn`}>
        {scanRunning ? "Scanning…" : "Scan"}
      </button>
    </div>
  );
}

function AccountsStatsCards({
  accs,
  integrationCount = 0,
  statsMap,
  integrationStatsMap,
  scanStats,
  planUsage,
}: {
  accs: Account[];
  integrationCount?: number;
  statsMap: Map<string, FindingStats>;
  integrationStatsMap?: Map<string, FindingStats>;
  scanStats?: { scans_last_7_days: number; scans_prev_7_days: number };
  planUsage?: { plan_label: string; max_accounts: number | null; used: number };
}) {
  const connected = accs.filter((a) => isAccountConnected(a)).length + integrationCount;
  const scansLast7Days = scanStats?.scans_last_7_days ?? 0;
  const scansPrev7Days = scanStats?.scans_prev_7_days ?? 0;
  let openFindings = 0;
  let highSeverity = 0;
  for (const [, stats] of statsMap) {
    openFindings += stats.open;
    highSeverity += stats.critHigh;
  }
  for (const [, stats] of integrationStatsMap ?? []) {
    openFindings += stats.open;
    highSeverity += stats.critHigh;
  }

  const maxAccounts = planUsage?.max_accounts ?? null;
  const planLabel = planUsage?.plan_label ?? "Plan";
  const planPct = maxAccounts ? Math.min(100, Math.round((connected / maxAccounts) * 100)) : 0;
  let scanTrendPct: number | null = null;
  if (scansPrev7Days > 0) {
    scanTrendPct = Math.round(((scansLast7Days - scansPrev7Days) / scansPrev7Days) * 100);
  }

  const cards: Array<{
    label: string;
    value: string;
    sub: string;
    icon: "cloud" | "scan" | "flag" | "warning";
    tone: "violet" | "teal" | "amber" | "rose";
    progress?: number;
    trend?: { text: string; tone: "up" | "down" };
  }> = [
    {
      label: "Connected accounts",
      value: maxAccounts != null ? `${connected} of ${maxAccounts}` : String(connected),
      sub: maxAccounts != null ? `${planPct}% of ${planLabel} plan` : `${planLabel} · unlimited`,
      icon: "cloud",
      tone: "violet",
      progress: maxAccounts != null ? planPct : undefined,
    },
    {
      label: "Scans (last 7 days)",
      value: String(scansLast7Days),
      sub: "vs previous 7 days",
      icon: "scan",
      tone: "teal",
      trend:
        scanTrendPct != null && scanTrendPct !== 0
          ? {
              text: `${scanTrendPct > 0 ? "+" : ""}${scanTrendPct}%`,
              tone: scanTrendPct > 0 ? "up" : "down",
            }
          : undefined,
    },
    {
      label: "Open findings",
      value: String(openFindings),
      sub: "total active",
      icon: "flag",
      tone: "amber",
    },
    {
      label: "High severity",
      value: String(highSeverity),
      sub: "critical + high",
      icon: "warning",
      tone: "rose",
    },
  ];

  return (
    <div className="accounts-page__stats">
      {cards.map((card) => (
        <div className="accounts-stat-card" key={card.label}>
          <span className="accounts-stat-card__icon">
            {card.icon === "cloud" && (
                <svg fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" />
                </svg>
              )}
              {card.icon === "scan" && (
                <svg fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              )}
              {card.icon === "flag" && (
                <svg fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5" />
                </svg>
              )}
              {card.icon === "warning" && (
                <svg fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
              )}
          </span>
          <div className="accounts-stat-card__content">
            <p className="accounts-stat-card__label">{card.label}</p>
            <p className={`accounts-stat-card__value${card.tone === "rose" ? " accounts-stat-card__value--rose" : ""}`}>
              {card.value}
            </p>
            {card.trend ? (
              <p className="accounts-stat-card__sub">
                <span className={`accounts-stat-card__trend--${card.trend.tone}`}>{card.trend.text}</span>{" "}
                {card.sub}
              </p>
            ) : (
              <p className="accounts-stat-card__sub">{card.sub}</p>
            )}
            {card.progress != null ? (
              <div className="accounts-stat-card__progress" aria-hidden>
                <span className="accounts-stat-card__progress-fill" style={{ width: `${card.progress}%` }} />
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function AccountCard({
  acc,
  stats,
  expanded,
  onToggle,
}: {
  acc: Account;
  stats: FindingStats | undefined;
  expanded: boolean;
  onToggle: () => void;
}) {
  const qc = useQueryClient();
  const [roleArn, setRoleArn] = useState("");
  const [showUpdateArn, setShowUpdateArn] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [showManageCapabilities, setShowManageCapabilities] = useState(false);
  const [showConnectorUpdate, setShowConnectorUpdate] = useState(false);
  const [setupConnectionOptions, setSetupConnectionOptions] = useState(() =>
    accountConnectionOptions(acc),
  );
  const [draftCapabilities, setDraftCapabilities] = useState(() => accountConnectionOptions(acc));
  const [capabilityVerify, setCapabilityVerify] = useState<CapabilityVerifyResults | null>(null);
  const [verifyFeedback, setVerifyFeedback] = useState<CapabilityVerifyFeedback | null>(null);
  const [verificationMeta, setVerificationMeta] = useState<VerificationMeta | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);

  useEffect(() => {
    setSetupConnectionOptions(accountConnectionOptions(acc));
    setDraftCapabilities(accountConnectionOptions(acc));
  }, [
    acc.id,
    acc.remediation_modules,
    acc.status,
  ]);

  const connected = isAccountConnected(acc);
  const hasScanned = connected && !!acc.last_scan_at;
  const showSetup = !connected && expanded;

  const {
    scanRun,
    scanStatus,
    isScanActive,
    scanProgress,
    triggerScan,
  } = useTriggeredScan(connected ? acc.id : undefined, {
    backgroundPollMs: 5000,
    onScanComplete: () => {
      qc.invalidateQueries({ queryKey: ["findings-snapshot-all"] });
      qc.invalidateQueries({ queryKey: ["controls"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["accounts-scan-stats"] });
    },
  });

  const navigate = useNavigate();
  const settings = useQuery<ScanScheduleData>({
    queryKey: ["settings"],
    queryFn: () => api("/v1/settings", { schema: settingsSchema }),
    enabled: connected,
  });
  const nextScanShort = settings.data
    ? formatShortScanDate(settings.data.scan_status.next_scan_at, { utc: true })
    : "—";
  const { freshness, detail: freshnessDetail } = resolveScanFreshness(acc.last_scan_at);
  const freshnessScanLabel =
    freshness === "fresh" ? "Fresh scan" : freshness === "stale" ? "Stale scan" : "No scans yet";
  const freshnessScanClass =
    freshness === "fresh" ? "text-emerald-700" : freshness === "stale" ? "text-amber-700" : "text-zinc-500";

  const patchConnection = useMutation({
    mutationFn: (opts: ConnectionOptions) =>
      api<Account>(`/v1/accounts/${acc.id}/connection-options`, {
        method: "PATCH",
        body: JSON.stringify(opts),
      }),
    onSuccess: (updated) => {
      setPatchError(null);
      qc.setQueryData<Account[]>(["accounts"], (rows) =>
        rows ? rows.map((row) => (row.id === updated.id ? updated : row)) : [updated],
      );
    },
    onError: (e) => setPatchError(formatApiError(e)),
  });

  const debouncedPatchConnection = useDebouncedCallback((opts: ConnectionOptions) => {
    patchConnection.mutate(opts);
  }, 450);

  const verifyCapabilities = useMutation({
    mutationFn: () =>
      api<VerifyCapabilitiesResponse>(`/v1/accounts/${acc.id}/verify-capabilities`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      setCapabilityVerify(data.capabilities);
      setVerificationMeta(data.verification ?? null);
      setVerifyFeedback(capabilityVerifyFeedback(data));
      qc.setQueryData<Account[]>(["accounts"], (rows) =>
        rows ? rows.map((row) => (row.id === data.account.id ? data.account : row)) : [data.account],
      );
      const opts = accountConnectionOptions(data.account);
      setDraftCapabilities(opts);
      setSetupConnectionOptions(opts);
    },
    onError: (e) => setVerifyFeedback({ tone: "error", message: formatApiError(e) }),
  });

  const verify = useMutation({
    mutationFn: () =>
      api<Account>(`/v1/accounts/${acc.id}/verify`, {
        method: "POST",
        body: JSON.stringify({ role_arn: sanitizeIamRoleArnInput(roleArn) }),
      }),
    onSuccess: (updated) => {
      qc.setQueryData<Account[]>(["accounts"], (rows) =>
        rows ? rows.map((row) => (row.id === updated.id ? updated : row)) : [updated],
      );
      const opts = accountConnectionOptions(updated);
      setSetupConnectionOptions(opts);
      setDraftCapabilities(opts);
      setShowUpdateArn(false);
      setRoleArn("");
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/v1/accounts/${acc.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setShowRemoveConfirm(false);
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["accounts-plan-usage"] });
    },
  });

  const requestRemove = () => {
    if (!connected) {
      remove.mutate();
      return;
    }
    setShowRemoveConfirm(true);
  };

  const ensureExpanded = () => {
    if (!expanded) onToggle();
  };

  const accountMenu: AccountMenuProps = {
    onUpdateConnector: () => {
      ensureExpanded();
      setShowConnectorUpdate(true);
    },
    onManageCapabilities: () => {
      ensureExpanded();
      setShowManageCapabilities((v) => !v);
    },
    onUpdateRole: () => {
      ensureExpanded();
      setShowUpdateArn(true);
    },
    onDisconnect: requestRemove,
    scanDisabled: isScanActive,
    disconnectPending: remove.isPending,
  };

  return (
    <div className={`group ${cardClass} ${!connected ? "border-l-[3px] border-l-amber-400" : ""}`}>
      {connected ? (
        <div className="flex flex-col gap-4 p-4 xl:flex-row xl:items-center xl:justify-between xl:gap-x-6 xl:px-5 xl:py-4">
          <div className="flex min-w-0 items-start gap-3">
            <AwsIconTile compact />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-base font-bold leading-tight text-zinc-900">{acc.label}</h2>
              </div>
              {acc.account_id ? (
                <div className="mt-0.5 flex items-center gap-1">
                  <p className="font-mono text-xs tabular-nums text-zinc-500">{acc.account_id}</p>
                  <CopyIdButton text={acc.account_id} />
                </div>
              ) : null}
              <CapabilityBadges acc={acc} capabilityVerify={capabilityVerify} />
            </div>
          </div>

          <div className="shrink-0 text-sm xl:border-l xl:border-zinc-100 xl:pl-5">
            <p className={`font-semibold ${freshnessScanClass}`}>{hasScanned ? freshnessScanLabel : "Not scanned"}</p>
            <p className="mt-0.5 text-zinc-500">{hasScanned ? freshnessDetail : "Run first scan"}</p>
            <p className="mt-0.5 text-zinc-500">
              Next scan <span className="font-medium text-zinc-700">{nextScanShort}</span>
            </p>
          </div>

          <div className="xl:border-l xl:border-zinc-100 xl:pl-5">
            <FindingsMixDonut stats={stats} hasScanned={hasScanned} />
          </div>

          <div className="flex shrink-0 items-center gap-2 xl:pl-2">
            <AccountCardActionBar
              expanded={expanded}
              onToggleDetails={onToggle}
              onViewFindings={() => navigate("/findings")}
              onRescan={() => triggerScan(acc.id)}
              scanDisabled={isScanActive}
              scanRunning={isScanActive}
              inline
            />
            <AccountMenu {...accountMenu} />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-4 px-5 py-4">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <AwsIconTile />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2.5">
                <h2 className="truncate text-lg font-bold leading-tight text-zinc-900">{acc.label}</h2>
              </div>
              <p className="mt-0.5 text-xs text-zinc-500">Setup required</p>
              <CapabilityBadges
                acc={acc}
                connectionOptions={setupConnectionOptions}
                capabilityVerify={capabilityVerify}
              />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={onToggle} className={ghostBtn}>
              {expanded ? "Hide setup" : "Continue setup"}
            </button>
            <button
              type="button"
              onClick={requestRemove}
              disabled={remove.isPending}
              className={dangerGhostBtn}
            >
              Remove account
            </button>
          </div>
        </div>
      )}

      {connected && isScanActive && (
        <ScanPhaseBlock
          progress={scanProgress.progress}
          elapsedMs={scanProgress.elapsedMs}
          progressStep={scanProgress.progressStep}
          progressTotal={scanProgress.progressTotal}
          progressPhase={scanProgress.progressPhase}
          progressStepName={scanProgress.progressStepName}
          progressCollectorIndex={scanProgress.progressCollectorIndex}
          progressCollectorTotal={scanProgress.progressCollectorTotal}
          indeterminate={scanProgress.indeterminate}
        />
      )}

      {connected && !isScanActive && scanStatus === "error" && scanRun.data?.error && (
        <div className="border-t border-red-100/80 bg-red-50/60 px-4 py-2.5 text-xs text-red-700">
          <span className="font-semibold">Scan could not complete</span>
          <div className="mt-1 line-clamp-3 break-words leading-relaxed text-red-700/90">
            {friendlyScanFailureMessage(scanRun.data.error)}
          </div>
        </div>
      )}

      {connected && !hasScanned && !isScanActive && (
        <div className="border-t border-zinc-100/80 bg-zinc-50/40 px-4 py-2 text-center text-xs text-zinc-500">
          Run a scan to populate findings.
        </div>
      )}

      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          connected && expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          {connected && expanded && (
            <div className="border-t border-zinc-200/60 bg-zinc-50/50">
              <AccountDetailsPanel
                acc={acc}
                showManageCapabilities={showManageCapabilities}
                showUpdateArn={showUpdateArn}
                roleArn={roleArn}
                setRoleArn={setRoleArn}
                verify={verify}
                onCancelUpdate={() => {
                  setShowUpdateArn(false);
                  setRoleArn("");
                  verify.reset();
                }}
                manageCapabilitiesPanel={
                  showManageCapabilities ? (
                    <ManageCapabilitiesPanel
                      acc={acc}
                      draft={draftCapabilities}
                      onDraftChange={(next) => {
                        const locked = enforceDeployedCapabilityLocks(acc, capabilityVerify, next);
                        setDraftCapabilities(locked);
                        debouncedPatchConnection(locked);
                      }}
                      onClose={() => setShowManageCapabilities(false)}
                      saveError={patchError}
                      onVerifyCapabilities={() => verifyCapabilities.mutate()}
                      verifyingCapabilities={verifyCapabilities.isPending}
                      verifyFeedback={verifyFeedback}
                      capabilityVerify={capabilityVerify}
                      verificationMeta={verificationMeta}
                    />
                  ) : null
                }
              />
            </div>
          )}
        </div>
      </div>

      {showSetup ? <AwsConnectFlow acc={acc} embedded /> : null}

      <ConnectorUpdateModal
        acc={acc}
        open={showConnectorUpdate}
        onClose={() => setShowConnectorUpdate(false)}
      />

      <ConfirmDialog
        open={showRemoveConfirm}
        title="Remove this account?"
        description={
          connected
            ? hasScanned
              ? `${acc.label} and all associated findings, scan history, and evidence will be permanently deleted. This cannot be undone.`
              : `${acc.label} will be disconnected and removed. No findings or evidence have been collected yet. This cannot be undone.`
            : `${acc.label} setup will be discarded. This account was never connected — no findings, scans, or evidence exist. This cannot be undone.`
        }
        confirmLabel="Disconnect account"
        variant="danger"
        loading={remove.isPending}
        onCancel={() => !remove.isPending && setShowRemoveConfirm(false)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

function resolveAccountRowStatus(
  connected: boolean,
  isScanActive: boolean,
  scanStatus: string | null | undefined,
  lastError: string | null | undefined,
  accountStatus?: string,
): { label: string; tone: "rose" | "amber" | "emerald" | "blue" } {
  if (!connected) return { label: "Setup required", tone: "rose" };
  if (isScanActive) return { label: "Scanning", tone: "blue" };
  if (accountStatus === "error") return { label: "Connection error", tone: "rose" };
  if (scanStatus === "error") {
    return { label: lastError ? "Action required" : "Scan failed", tone: "rose" };
  }
  return { label: "Connected", tone: "emerald" };
}

function AccountStatusIndicator({
  label,
  tone,
}: {
  label: string;
  tone: "rose" | "amber" | "emerald" | "blue";
}) {
  const showCheck = tone === "emerald";
  return (
    <span className={`accounts-status accounts-status--${tone}`} role="status">
      {showCheck ? (
        <svg className="accounts-status__icon" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.25" />
          <path
            d="M5.25 8.1 7 9.85 10.85 6"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <span className="accounts-status__dot" aria-hidden />
      )}
      <span>{label}</span>
    </span>
  );
}

function VerifiedBadgeIcon() {
  return (
    <span className="accounts-account-cell__verified" title="Connected">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="10" fill="#2563eb" />
        <path d="m8.5 12.2 2.2 2.2L15.8 9.4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function AccountRowProviderMark({ provider }: { provider: CloudProvider }) {
  return (
    <ProviderMark
      provider={provider}
      className={`accounts-account-cell__provider accounts-account-cell__provider--${provider}`}
    />
  );
}

function MetricCardDelta({
  delta,
  betterWhen,
  muted = false,
}: {
  delta: number | null;
  betterWhen: BetterWhen;
  /** Neutral grey — for metrics (e.g. coverage) that shouldn't celebrate next to a poor posture. */
  muted?: boolean;
}) {
  if (delta == null || delta === 0) return null;
  const improved = deltaImproved(delta, betterWhen);
  const toneClass = muted
    ? " accounts-detail-metric-card__change--muted"
    : improved
      ? " accounts-detail-metric-card__change--good"
      : " accounts-detail-metric-card__change--bad";
  return (
    <span className={`accounts-detail-metric-card__change${toneClass}`}>
      {formatPercentDelta(delta)}
    </span>
  );
}

type Soc2ControlStats = {
  passRate: number | null;
  passed: number;
  pending: number;
  total: number;
};

function summarizeSoc2Controls(rows: Array<{ status: string }>): Soc2ControlStats {
  const total = rows.length;
  const passed = rows.filter((row) => row.status === "pass").length;
  return {
    passRate: controlPostureScore(rows),
    passed,
    pending: total - passed,
    total,
  };
}

function soc2ReadinessPhaseLabel(pct: number | null): string | null {
  if (pct == null) return null;
  if (pct < 20) return "Early setup";
  if (pct < 50) return "Building coverage";
  if (pct < 75) return "Maturing controls";
  if (pct < 90) return "Strong foundation";
  return "Audit-ready posture";
}

function computeFindingsHealthScore(stats: FindingStats): number {
  const { critHigh, medium, low } = stats;
  return Math.max(0, Math.min(100, Math.round(100 - critHigh * 10 - medium * 3 - low * 1)));
}

function computeScanRecencyScore(lastScanAt: string | null | undefined): number {
  if (!lastScanAt) return 0;
  const t = new Date(lastScanAt).getTime();
  if (Number.isNaN(t)) return 0;
  const hoursSince = (Date.now() - t) / 3_600_000;
  if (hoursSince <= 24) return 100;
  if (hoursSince <= 72) return 80;
  if (hoursSince <= 168) return 60;
  if (hoursSince <= 336) return 40;
  return 20;
}

function clampCoveragePct(ratio: number): number {
  return Math.min(100, Math.round(ratio * 100));
}

function computeSecurityScore(
  stats: FindingStats,
  coveragePct: number | null,
  lastScanAt: string | null | undefined,
): number {
  const findings = computeFindingsHealthScore(stats);
  const coverage = coveragePct ?? 0;
  const recency = computeScanRecencyScore(lastScanAt);
  return Math.round(findings * 0.5 + coverage * 0.3 + recency * 0.2);
}

type SecurityScoreTone = "critical" | "poor" | "fair" | "good";

function securityScoreLabel(score: number): string {
  if (score >= 80) return "Good";
  if (score >= 60) return "Fair";
  if (score >= 40) return "Poor";
  return "Critical";
}

function securityScoreTone(score: number): SecurityScoreTone {
  if (score >= 80) return "good";
  if (score >= 60) return "fair";
  if (score >= 40) return "poor";
  return "critical";
}

type SecurityScoreDriver = {
  driverValue: string;
  kind: "findings" | "coverage" | "recency" | "none";
};

const EVIDENCE_COVERAGE_GOOD_THRESHOLD = 80;
const EVIDENCE_COVERAGE_FAIR_THRESHOLD = 60;
const LOW_EVIDENCE_COVERAGE_DRIVER_THRESHOLD = EVIDENCE_COVERAGE_FAIR_THRESHOLD;
/** Below this security score, the gauge hub shows the severity label instead of the numeric score. */
const SECURITY_SCORE_NUMERIC_THRESHOLD = EVIDENCE_COVERAGE_FAIR_THRESHOLD;

type EvidenceCoverageTier = "low" | "fair" | "good";

function evidenceCoverageTier(pct: number): EvidenceCoverageTier {
  if (pct >= EVIDENCE_COVERAGE_GOOD_THRESHOLD) return "good";
  if (pct >= EVIDENCE_COVERAGE_FAIR_THRESHOLD) return "fair";
  return "low";
}

function evidenceCoverageTierLabel(pct: number): string {
  const tier = evidenceCoverageTier(pct);
  if (tier === "good") return "Good";
  if (tier === "fair") return "Fair";
  return "Low";
}

function evidenceCoverageDriverLabel(pct: number): string {
  const tier = evidenceCoverageTier(pct);
  if (tier === "good") return "Good evidence coverage";
  if (tier === "fair") return "Fair evidence coverage";
  return "Low evidence coverage";
}

function computeSecurityScoreDrivers(
  stats: FindingStats,
  coveragePct: number | null,
  lastScanAt: string | null | undefined,
  score: number,
): SecurityScoreDriver[] {
  const findingsHealth = computeFindingsHealthScore(stats);
  const coverage = coveragePct ?? 0;
  const recency = computeScanRecencyScore(lastScanAt);
  const drivers: SecurityScoreDriver[] = [];
  const pushDriver = (driver: SecurityScoreDriver) => {
    if (!drivers.some((item) => item.kind === driver.kind && item.driverValue === driver.driverValue)) {
      drivers.push(driver);
    }
  };
  const impacts = [
    { kind: "findings" as const, impact: (100 - findingsHealth) * 0.5 },
    { kind: "coverage" as const, impact: (100 - coverage) * 0.3 },
    { kind: "recency" as const, impact: (100 - recency) * 0.2 },
  ].sort((a, b) => b.impact - a.impact);
  const top = impacts[0]?.kind ?? "findings";

  if (score >= 80 && stats.critHigh === 0) {
    return [{ driverValue: "No major issues", kind: "none" }];
  }

  if (top === "findings" && stats.critHigh > 0) {
    pushDriver({
      driverValue: `${stats.critHigh.toLocaleString()} high finding${stats.critHigh === 1 ? "" : "s"}`,
      kind: "findings",
    });
  } else if (top === "findings" && stats.open > 0) {
    pushDriver({
      driverValue: `${stats.open.toLocaleString()} open finding${stats.open === 1 ? "" : "s"}`,
      kind: "findings",
    });
  } else if (top === "coverage" && coveragePct != null) {
    pushDriver({ driverValue: evidenceCoverageDriverLabel(coveragePct), kind: "coverage" });
  } else if (top === "recency") {
    pushDriver({ driverValue: "Stale scan data", kind: "recency" });
  }

  if (stats.critHigh > 0) {
    pushDriver({
      driverValue: `${stats.critHigh.toLocaleString()} high finding${stats.critHigh === 1 ? "" : "s"}`,
      kind: "findings",
    });
  } else if (stats.open > 0 && drivers.length === 0) {
    pushDriver({
      driverValue: `${stats.open.toLocaleString()} open finding${stats.open === 1 ? "" : "s"}`,
      kind: "findings",
    });
  }

  if (
    coveragePct != null &&
    coveragePct < LOW_EVIDENCE_COVERAGE_DRIVER_THRESHOLD
  ) {
    pushDriver({
      driverValue: evidenceCoverageDriverLabel(coveragePct),
      kind: "coverage",
    });
  }

  if (score >= 80) {
    return drivers.length > 0 ? drivers : [{ driverValue: "No major issues", kind: "none" }];
  }

  if (drivers.length === 0 && coveragePct != null) {
    pushDriver({ driverValue: evidenceCoverageDriverLabel(coveragePct), kind: "coverage" });
  }

  return drivers;
}

function OverviewMetricLoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-2" aria-hidden>
      <div className="h-8 w-16 rounded bg-zinc-100" />
      <div className="h-3 w-28 rounded bg-zinc-100" />
    </div>
  );
}

type PriorityFindingRow = {
  id: string;
  title: string;
  severity: string;
  risk_score: number;
  check_id?: string;
  last_seen?: string;
  event_time?: string;
  is_event: boolean;
};

function isEventDerivedFinding(checkId: string | undefined): boolean {
  return !!checkId?.startsWith("cloudtrail.event.");
}

function eventTimeFromEvidence(evidence: Record<string, unknown> | undefined): string | undefined {
  const raw = evidence?.event_time;
  return typeof raw === "string" && raw.trim() ? raw : undefined;
}

function priorityFindingWhenLabel(finding: PriorityFindingRow): string {
  if (finding.is_event && finding.event_time) {
    return `Event · ${new Date(finding.event_time).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })}`;
  }
  if (finding.last_seen) return formatRelativeScanAgo(finding.last_seen);
  return "";
}

function findingMatchesAccountRow(
  f: Finding,
  accountId: string,
  isAws: boolean,
  cloud: CloudAccountRow | null,
): boolean {
  const accountProvider = (isAws ? "aws" : cloud?.provider ?? "aws").toLowerCase();
  if (findingScopeProvider(f) !== accountProvider) return false;
  const accountKey = isAws ? accountId : (cloud?.external_id ?? cloud?.id ?? accountId);
  return isAws
    ? f.account_id === accountId
    : f.account_id === accountKey || f.account_label === accountKey;
}

function buildAccountPriorityFindings(
  items: Finding[] | undefined,
  accountId: string,
  isAws: boolean,
  cloud: CloudAccountRow | null,
): PriorityFindingRow[] {
  return (items ?? [])
    .filter((f) => {
      if (!findingMatchesAccountRow(f, accountId, isAws, cloud)) return false;
      if (isEventDerivedFinding(f.check_id)) return false;
      const sev = (f.severity || "").toLowerCase();
      return sev === "critical" || sev === "high";
    })
    .sort((a, b) => {
      const risk = b.risk_score - a.risk_score;
      if (risk !== 0) return risk;
      const aMs = a.last_seen ? new Date(a.last_seen).getTime() : 0;
      const bMs = b.last_seen ? new Date(b.last_seen).getTime() : 0;
      return bMs - aMs;
    })
    .slice(0, 5)
    .map((f) => ({
      id: f.id,
      title: f.title,
      severity: f.severity,
      risk_score: f.risk_score,
      check_id: f.check_id,
      last_seen: f.last_seen,
      event_time: eventTimeFromEvidence(f.evidence as Record<string, unknown> | undefined),
      is_event: isEventDerivedFinding(f.check_id),
    }));
}

function priorityFindingServiceLabel(checkId: string | undefined): string | null {
  if (!checkId) return null;
  if (checkId.startsWith("cloudtrail.event.")) {
    const topic = checkId.split(".")[2] ?? "";
    if (topic.startsWith("kms")) return "KMS";
  }
  return serviceForCheck(checkId)?.label ?? null;
}

function OverviewInsightsGrid({
  accountId,
  stats,
  hasScanned,
  loading = false,
  priorityFindings,
  recentScanRows,
  recentActivity,
  onViewScans,
  onViewScanRow,
}: {
  accountId: string;
  stats: FindingStats;
  hasScanned: boolean;
  loading?: boolean;
  priorityFindings: PriorityFindingRow[];
  recentScanRows: RecentScanDisplayRow[];
  recentActivity: HistoryEvent[];
  onViewScans: () => void;
  onViewScanRow?: (row: RecentScanDisplayRow) => void;
}) {
  const navigate = useNavigate();
  const actions = useMemo(() => buildRecommendedActions(stats).slice(0, 3), [stats]);

  const viewHighFindings = () => {
    navigate(`/findings?account_id=${encodeURIComponent(accountId)}`);
  };

  const openFinding = (finding: PriorityFindingRow) => {
    navigate(`/findings?account_id=${encodeURIComponent(accountId)}&finding=${encodeURIComponent(finding.id)}`);
  };

  if (loading) {
    return (
      <div className="accounts-detail-overview__grid" aria-hidden>
        <div className="accounts-detail-overview__card accounts-detail-overview__card--skeleton animate-pulse" />
        <div className="accounts-detail-overview__card accounts-detail-overview__card--skeleton animate-pulse" />
        <div className="accounts-detail-overview__card accounts-detail-overview__card--skeleton animate-pulse" />
        <div className="accounts-detail-overview__card accounts-detail-overview__card--skeleton animate-pulse" />
      </div>
    );
  }

  return (
    <div className="accounts-detail-overview__grid" aria-label="Account insights">
      <section className="accounts-detail-overview__card accounts-detail-overview__card--findings">
        <div className="accounts-detail-overview__card-header">
          <h3 className="accounts-detail-overview__card-title">Priority findings</h3>
          {priorityFindings.length > 0 ? (
            <span className="accounts-detail-overview__card-badge" aria-label={`${priorityFindings.length} findings`}>
              {priorityFindings.length}
            </span>
          ) : null}
        </div>
        {priorityFindings.length > 0 ? (
          <>
            <div className="accounts-detail-overview__card-body">
              <ul className="accounts-detail-overview__list accounts-detail-overview__list--findings">
                {priorityFindings.map((finding) => {
                  const serviceLabel = priorityFindingServiceLabel(finding.check_id);
                  const whenLabel = priorityFindingWhenLabel(finding);
                  const severityKey = (finding.severity || "").toLowerCase();
                  return (
                    <li key={finding.id}>
                      <button
                        type="button"
                        className="accounts-detail-overview__list-row accounts-detail-overview__list-row--findings"
                        onClick={() => openFinding(finding)}
                      >
                        <span className="accounts-detail-overview__severity-cell">
                          <span
                            className={`accounts-detail-overview__severity-dot accounts-detail-overview__severity-dot--${severityKey}`}
                            title={finding.severity}
                            aria-hidden
                          />
                          <span className="sr-only">{finding.severity} severity</span>
                        </span>
                        <span className="accounts-detail-overview__service-cell">
                          {serviceLabel ? (
                            <span className="accounts-detail-overview__service-tag">{serviceLabel}</span>
                          ) : (
                            <span className="accounts-detail-overview__service-empty">—</span>
                          )}
                        </span>
                        <span className="accounts-detail-overview__list-label">{finding.title}</span>
                        {whenLabel ? (
                          <span className="accounts-detail-overview__list-meta">{whenLabel}</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="accounts-detail-overview__footer-link" onClick={viewHighFindings}>
                View all findings →
              </button>
            </div>
          </>
        ) : (
          <div className="accounts-detail-overview__card-body">
            <p className="accounts-detail-overview__card-empty">
              {hasScanned ? "No high-severity findings right now." : "Run a scan to surface priority findings."}
            </p>
          </div>
        )}
      </section>

      <section className="accounts-detail-overview__card accounts-detail-overview__card--actions">
        <div className="accounts-detail-overview__card-header">
          <h3 className="accounts-detail-overview__card-title">Recommended next actions</h3>
          {hasScanned && actions.length > 0 ? (
            <span className="accounts-detail-overview__card-badge" aria-label={`${actions.length} actions`}>
              {actions.length}
            </span>
          ) : null}
        </div>
        <div className="accounts-detail-overview__card-body">
          {!hasScanned ? (
            <p className="accounts-detail-overview__card-empty">Run a scan first</p>
          ) : actions.length > 0 ? (
            <>
              <ul className="accounts-detail-overview__list accounts-detail-overview__list--actions">
                {actions.map((action, index) => (
                  <li key={action.id} className="accounts-detail-overview__action-row">
                    <span className="accounts-detail-overview__action-label">{action.label}</span>
                    {index === 0 ? (
                      <span className="accounts-detail-overview__action-detail">{action.detail}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {stats.critHigh > 0 ? (
                <button type="button" className="accounts-detail-overview__footer-link" onClick={viewHighFindings}>
                  View high findings →
                </button>
              ) : null}
            </>
          ) : (
            <p className="accounts-detail-overview__card-empty">No recommended actions — posture looks clean.</p>
          )}
        </div>
      </section>

      <section className="accounts-detail-overview__card accounts-detail-overview__card--scans">
        <div className="accounts-detail-overview__card-header">
          <h3 className="accounts-detail-overview__card-title">Recent scans</h3>
        </div>
        <div className="accounts-detail-overview__card-body">
          {recentScanRows.length > 0 ? (
            <>
              <ul className="accounts-detail-overview__scans">
                {recentScanRows.map((row) => (
                  <li key={row.key}>
                    <div className="accounts-detail-overview__scan-row">
                      <span
                        className={`accounts-detail-overview__scan-mark${row.succeeded ? "" : " accounts-detail-overview__scan-mark--failed"}`}
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
                      <div className="accounts-detail-overview__scan-when">
                        <span className="accounts-detail-overview__scan-date">{scanDayLabel(row.timestamp)}</span>
                        <span className="accounts-detail-overview__scan-ago">{formatRelativeScanAgo(row.timestamp)}</span>
                      </div>
                      <span className="accounts-detail-overview__scan-resources">
                        {scanResourcesLabel(row.resourcesScanned, hasScanned)}
                      </span>
                      <div className="accounts-detail-overview__scan-findings">
                        <span className="accounts-detail-overview__scan-finding accounts-detail-overview__scan-finding--high">
                          <i aria-hidden />
                          {hasScanned ? stats.critHigh : "—"}
                        </span>
                        <span className="accounts-detail-overview__scan-finding accounts-detail-overview__scan-finding--medium">
                          <i aria-hidden />
                          {hasScanned ? stats.medium : "—"}
                        </span>
                        <span className="accounts-detail-overview__scan-finding accounts-detail-overview__scan-finding--low">
                          <i aria-hidden />
                          {hasScanned ? stats.low : "—"}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="accounts-detail-overview__scan-view"
                        onClick={() => (onViewScanRow ? onViewScanRow(row) : onViewScans())}
                      >
                        View
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <button type="button" className="accounts-detail-overview__footer-link" onClick={onViewScans}>
                View all scans →
              </button>
            </>
          ) : (
            <p className="accounts-detail-overview__card-empty">
              {hasScanned ? "No recent scans recorded." : "Run a scan to populate scan history."}
            </p>
          )}
        </div>
      </section>

      <section className="accounts-detail-overview__card accounts-detail-overview__card--activity">
        <div className="accounts-detail-overview__card-header">
          <h3 className="accounts-detail-overview__card-title">Recent activity</h3>
        </div>
        <div className="accounts-detail-overview__card-body">
          {recentActivity.length > 0 ? (
            <>
              <ul className="accounts-detail-overview__list">
                {recentActivity.slice(0, 4).map((event) => (
                  <li key={`${event.scan_run_id}-${event.timestamp}`} className="accounts-detail-overview__list-row">
                    <span className="accounts-detail-overview__list-label">{activityEventLabel(event)}</span>
                    <span className="accounts-detail-overview__list-meta">{formatActivityAgo(event.timestamp)}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="accounts-detail-overview__footer-link"
                onClick={() => navigate(`/history?account_id=${encodeURIComponent(accountId)}`)}
              >
                View all activity →
              </button>
            </>
          ) : (
            <p className="accounts-detail-overview__card-empty">
              {hasScanned ? "No recent change events." : "Activity appears after your first scan."}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function SecurityScoreCard({
  score,
  stats,
  coveragePct,
  lastScanAt,
  hasScanned,
  loading = false,
}: {
  score: number | null;
  stats: FindingStats | undefined;
  coveragePct: number | null;
  lastScanAt: string | null | undefined;
  hasScanned: boolean;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="accounts-security-score__body animate-pulse" aria-hidden>
        <div className="accounts-security-score__gauge-col">
          <div className="mx-auto h-[76px] w-[76px] rounded-full bg-zinc-100" />
          <div className="mx-auto mt-2 h-5 w-16 rounded-full bg-zinc-100" />
        </div>
        <div className="accounts-security-score__drivers">
          <div className="h-3 w-20 rounded bg-zinc-100" />
          <div className="mt-2 h-3 w-32 rounded bg-zinc-100" />
        </div>
      </div>
    );
  }

  const showScore = hasScanned && score != null && stats != null;
  const label = showScore ? securityScoreLabel(score) : null;
  const tone = showScore ? securityScoreTone(score) : null;
  const drivers = showScore ? computeSecurityScoreDrivers(stats, coveragePct, lastScanAt, score) : null;
  const showNumericHub = showScore && score >= SECURITY_SCORE_NUMERIC_THRESHOLD;
  const hubDisplay = showScore ? (showNumericHub ? String(score) : (label ?? String(score))) : "";
  const hubKind: "numeric" | "label" = showNumericHub ? "numeric" : "label";

  if (!showScore || !label || !tone || !drivers) {
    return <p className="accounts-detail-overview__metric-detail">Run a scan first</p>;
  }

  return (
    <div className="accounts-security-score__body">
      <div className="accounts-security-score__gauge-col">
        <SecurityScoreGauge score={score} tone={tone} hubDisplay={hubDisplay} hubKind={hubKind} />
        {showNumericHub ? (
          <span className={`accounts-detail-overview__score-pill accounts-detail-overview__score-pill--${tone}`}>
            {label}
          </span>
        ) : null}
      </div>
      <div className="accounts-security-score__drivers">
        <p className="accounts-security-score__driver-label">
          Main driver{drivers.length === 1 ? "" : "s"}
        </p>
        <div className="accounts-security-score__driver-list">
          {drivers.map((driver) => (
            <p className="accounts-detail-overview__metric-detail" key={`${driver.kind}:${driver.driverValue}`}>
              {driver.driverValue}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function countAccountResources(
  items: Finding[] | undefined,
  accountKey: string,
  kind: "aws" | "cloud",
): { resources: number; regions: number } {
  const resources = new Set<string>();
  const regions = new Set<string>();
  for (const f of items ?? []) {
    const matches =
      kind === "aws"
        ? f.account_id === accountKey
        : f.account_id === accountKey || f.account_label === accountKey;
    if (!matches) continue;
    if (f.resource_arn) resources.add(f.resource_arn);
    const parts = f.resource_arn?.split(":");
    if (parts?.[3] && parts[3] !== "") regions.add(parts[3]);
  }
  return { resources: resources.size, regions: regions.size };
}

function formatDetailDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function DetailTabStub({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="accounts-detail-tab-stub">
      <p className="accounts-detail-tab-stub__title">{title}</p>
      <p className="accounts-detail-tab-stub__body">{body}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

const SECURITY_SCORE_HELP =
  "Composite score based on open findings severity, evidence coverage over the last 7 days, and how recently this account was scanned.";

const SOC2_READINESS_HELP =
  "Share of mapped SOC 2 controls currently passing for this account. Higher means closer to audit readiness.";

const COVERAGE_METRIC_HELP =
  "Days with scan evidence in the last 7 days. Measures monitoring continuity, not resource count.";

function AccountSplitDetailPane({
  row,
  stats,
  findingsItems,
  findingsLoading = false,
  setupInitialStep,
  onManageSetup,
  onDismissSetup,
}: {
  row: AccountListRow;
  stats: FindingStats | undefined;
  findingsItems: Finding[] | undefined;
  findingsLoading?: boolean;
  setupInitialStep?: number;
  onManageSetup?: () => void;
  onDismissSetup?: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showAccountSettings, setShowAccountSettings] = useState(false);

  const isAws = row.kind === "aws";
  const acc = isAws ? row.account : null;
  const cloud = !isAws ? row.cloud : null;
  const connected = isAws ? isAccountConnected(acc!) : isCloudAccountConnected(cloud!);
  const hasScanned = connected && !!(isAws ? acc!.last_scan_at : cloud!.last_scan_at);
  const lastScanAt = isAws ? acc!.last_scan_at : cloud!.last_scan_at;
  const accountId = isAws ? acc!.id : cloud!.id;
  const displayName = isAws ? acc!.label : cloud!.label;
  const displayId = isAws ? acc!.account_id : cloud!.external_id;
  const provider = (isAws ? "aws" : cloud!.provider) as "aws" | "gcp" | "azure";

  const [roleArn, setRoleArn] = useState("");
  const [showUpdateArn, setShowUpdateArn] = useState(false);
  const [showManageCapabilities, setShowManageCapabilities] = useState(false);
  const [showConnectorUpdate, setShowConnectorUpdate] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [setupConnectionOptions, setSetupConnectionOptions] = useState(() =>
    isAws ? accountConnectionOptions(acc!) : DEFAULT_CONNECTION_OPTIONS,
  );
  const [draftCapabilities, setDraftCapabilities] = useState(() =>
    isAws ? accountConnectionOptions(acc!) : DEFAULT_CONNECTION_OPTIONS,
  );
  const [capabilityVerify, setCapabilityVerify] = useState<CapabilityVerifyResults | null>(null);
  const [verifyFeedback, setVerifyFeedback] = useState<CapabilityVerifyFeedback | null>(null);
  const [verificationMeta, setVerificationMeta] = useState<VerificationMeta | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAws || !acc) return;
    setSetupConnectionOptions(accountConnectionOptions(acc));
    setDraftCapabilities(accountConnectionOptions(acc));
  }, [
    isAws,
    acc?.id,
    acc?.remediation_modules,
    acc?.status,
  ]);

  const {
    scanRun,
    scanStatus,
    isScanActive,
    triggerScan,
  } = useTriggeredScan(isAws && connected ? acc!.id : undefined, {
    backgroundPollMs: 5000,
    onScanComplete: () => {
      qc.invalidateQueries({ queryKey: ["findings-snapshot-all"] });
      qc.invalidateQueries({ queryKey: ["findings"] });
      qc.invalidateQueries({ queryKey: ["controls"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["accounts-scan-stats"] });
      qc.invalidateQueries({ queryKey: ["accounts-detail-history", accountId] });
      qc.invalidateQueries({ queryKey: ["evidence-coverage", accountId] });
    },
  });

  const cloudScan = useTriggeredCloudScan(
    !isAws && connected ? cloud!.provider : undefined,
    !isAws && connected ? cloud!.id : undefined,
    {
      backgroundPollMs: 5000,
      onScanComplete: () => {
        qc.invalidateQueries({ queryKey: ["cloud-accounts"] });
        qc.invalidateQueries({ queryKey: ["findings-snapshot-all"] });
        qc.invalidateQueries({ queryKey: ["findings"] });
        qc.invalidateQueries({ queryKey: ["cloud-scan-runs", cloud!.provider, accountId] });
        qc.invalidateQueries({ queryKey: ["cloud-scan-run-latest", cloud!.provider, accountId] });
        qc.invalidateQueries({ queryKey: ["cloud-account-overview", cloud!.provider, accountId] });
      },
    },
  );

  const settings = useQuery<ScanScheduleData>({
    queryKey: ["settings"],
    queryFn: () => api("/v1/settings", { schema: settingsSchema }),
    enabled: isAws && connected,
  });
  const nextScanShort = settings.data
    ? formatShortScanDate(settings.data.scan_status.next_scan_at, { utc: true })
    : "—";

  const controlsQ = useQuery({
    queryKey: ["controls", "soc2", accountId],
    queryFn: () =>
      api(`/v1/controls?framework=soc2&account_id=${accountId}`, { schema: controlListSchema }),
    enabled: isAws && connected && hasScanned,
    select: summarizeSoc2Controls,
  });

  const coverageQ = useQuery({
    queryKey: ["evidence-coverage", accountId, 7],
    queryFn: () =>
      api(`/v1/accounts/${accountId}/evidence-coverage?period=7`, { schema: evidenceCoverageSchema }),
    enabled: isAws && connected && hasScanned,
  });

  const coveragePrevQ = useQuery({
    queryKey: ["evidence-coverage", accountId, 7, "prev"],
    queryFn: () =>
      api(
        `/v1/accounts/${accountId}/evidence-coverage?period=7&as_of=${daysAgoIso(7)}`,
        { schema: evidenceCoverageSchema },
      ),
    enabled: isAws && connected && hasScanned,
  });

  const cloudOverviewQ = useQuery({
    queryKey: ["cloud-account-overview", cloud?.provider, accountId, 7],
    queryFn: () =>
      api(
        `/v1/integrations/cloud-accounts/${cloud!.provider}/${accountId}/overview?period=7`,
        { schema: cloudAccountOverviewSchema },
      ),
    enabled: !isAws && connected && hasScanned,
  });

  const cloudOverviewPrevQ = useQuery({
    queryKey: ["cloud-account-overview", cloud?.provider, accountId, 7, "prev"],
    queryFn: () =>
      api(
        `/v1/integrations/cloud-accounts/${cloud!.provider}/${accountId}/overview?period=7&as_of=${daysAgoIso(7)}`,
        { schema: cloudAccountOverviewSchema },
      ),
    enabled: !isAws && connected && hasScanned,
  });

  const historyQ = useQuery({
    queryKey: ["accounts-detail-history", accountId],
    queryFn: () =>
      api<ComplianceHistoryResponse>(
        `/v1/accounts/${accountId}/compliance-timeline?framework=soc2&days=14&limit=40`,
        { schema: complianceTimelineSchema },
      ),
    enabled: isAws && connected && hasScanned,
    staleTime: 60_000,
  });

  const cloudScanHistoryQ = useQuery({
    queryKey: ["cloud-scan-runs", cloud?.provider, accountId],
    queryFn: () =>
      api<ScanRunLatest[]>(
        `/v1/integrations/cloud-accounts/${cloud!.provider}/${accountId}/scan-runs?limit=10`,
      ),
    enabled: !isAws && connected && hasScanned,
    staleTime: 60_000,
  });

  const resourceStats = useMemo(() => {
    if (!isAws && cloudOverviewQ.data) {
      return {
        resources: cloudOverviewQ.data.resources_covered,
        regions: cloudOverviewQ.data.regions_count,
      };
    }
    return countAccountResources(
      findingsItems,
      isAws ? accountId : (cloud!.external_id ?? cloud!.id),
      isAws ? "aws" : "cloud",
    );
  }, [findingsItems, accountId, cloud, isAws, cloudOverviewQ.data]);

  const overviewMetricsLoading =
    findingsLoading ||
    (hasScanned &&
      isAws &&
      (coverageQ.isPending || controlsQ.isPending || historyQ.isPending)) ||
    (hasScanned &&
      !isAws &&
      (cloudOverviewQ.isPending || cloudOverviewPrevQ.isPending || cloudScanHistoryQ.isPending));

  const displayStats = overviewMetricsLoading ? undefined : (stats ?? EMPTY_FINDING_STATS);

  const patchConnection = useMutation({
    mutationFn: (opts: ConnectionOptions) =>
      api<Account>(`/v1/accounts/${acc!.id}/connection-options`, {
        method: "PATCH",
        body: JSON.stringify(opts),
      }),
    onSuccess: (updated) => {
      setPatchError(null);
      qc.setQueryData<Account[]>(["accounts"], (rows) =>
        rows ? rows.map((row) => (row.id === updated.id ? updated : row)) : [updated],
      );
    },
    onError: (e) => setPatchError(formatApiError(e)),
  });

  const debouncedPatchConnection = useDebouncedCallback((opts: ConnectionOptions) => {
    patchConnection.mutate(opts);
  }, 450);

  const verifyCapabilities = useMutation({
    mutationFn: () =>
      api<VerifyCapabilitiesResponse>(`/v1/accounts/${acc!.id}/verify-capabilities`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      setCapabilityVerify(data.capabilities);
      setVerificationMeta(data.verification ?? null);
      setVerifyFeedback(capabilityVerifyFeedback(data));
      qc.setQueryData<Account[]>(["accounts"], (rows) =>
        rows ? rows.map((row) => (row.id === data.account.id ? data.account : row)) : [data.account],
      );
      const opts = accountConnectionOptions(data.account);
      setDraftCapabilities(opts);
      setSetupConnectionOptions(opts);
    },
    onError: (e) => setVerifyFeedback({ tone: "error", message: formatApiError(e) }),
  });

  const verify = useMutation({
    mutationFn: () =>
      api<Account>(`/v1/accounts/${acc!.id}/verify`, {
        method: "POST",
        body: JSON.stringify({ role_arn: sanitizeIamRoleArnInput(roleArn) }),
      }),
    onSuccess: (updated) => {
      qc.setQueryData<Account[]>(["accounts"], (rows) =>
        rows ? rows.map((row) => (row.id === updated.id ? updated : row)) : [updated],
      );
      const opts = accountConnectionOptions(updated);
      setSetupConnectionOptions(opts);
      setDraftCapabilities(opts);
      setShowUpdateArn(false);
      setRoleArn("");
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/v1/accounts/${acc!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setShowRemoveConfirm(false);
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["accounts-plan-usage"] });
    },
  });

  const handleScan = () => {
    if (isAws) triggerScan(acc!.id);
    else if (cloud) cloudScan.triggerScan(cloudScanPath(cloud));
  };

  const scanBusy = isAws ? isScanActive : cloudScan.isScanActive;
  const coveragePct = isAws
    ? coverageQ.data != null
      ? clampCoveragePct(coverageQ.data.coverage_ratio)
      : null
    : cloudOverviewQ.data != null
      ? clampCoveragePct(cloudOverviewQ.data.coverage.coverage_ratio)
      : null;
  const compliancePct = isAws
    ? controlsQ.data?.passRate ?? historyQ.data?.current_posture_score ?? null
    : cloudOverviewQ.data?.compliance_posture_pct ?? null;
  const resourceCount = isAws
    ? resourceStats.resources
    : cloudOverviewQ.data?.resources_covered ?? resourceStats.resources;
  const soc2CheckSummary = useMemo((): { passed: number; pending: number; total: number } | null => {
    if (!hasScanned) return null;
    if (!isAws) {
      const total = cloudOverviewQ.data?.soc2_controls_total;
      if (total == null || total <= 0) return null;
      const passed = cloudOverviewQ.data?.soc2_controls_passed ?? 0;
      return { passed, pending: total - passed, total };
    }
    if (controlsQ.data && controlsQ.data.total > 0) {
      return {
        passed: controlsQ.data.passed,
        pending: controlsQ.data.pending,
        total: controlsQ.data.total,
      };
    }
    const summary = historyQ.data?.current_summary;
    if (!summary) return null;
    const total = summary.controls_passed + summary.controls_failed + summary.controls_no_data;
    if (total <= 0) return null;
    return {
      passed: summary.controls_passed,
      pending: total - summary.controls_passed,
      total,
    };
  }, [hasScanned, isAws, controlsQ.data, historyQ.data?.current_summary, cloudOverviewQ.data]);

  const soc2PhaseLabel = soc2ReadinessPhaseLabel(compliancePct);
  const securityScore = useMemo(() => {
    if (!hasScanned || !displayStats || overviewMetricsLoading) return null;
    return computeSecurityScore(displayStats, coveragePct, lastScanAt);
  }, [hasScanned, displayStats, coveragePct, lastScanAt, overviewMetricsLoading]);
  const recentScanRows = useMemo(
    () =>
      buildRecentScanRows(
        isAws,
        hasScanned,
        lastScanAt,
        historyQ.data?.events ?? [],
        cloudScanHistoryQ.data,
        hasScanned ? resourceCount : null,
      ).slice(0, 3),
    [isAws, hasScanned, lastScanAt, historyQ.data?.events, cloudScanHistoryQ.data, resourceCount],
  );
  const recentActivity = useMemo(
    () =>
      (historyQ.data?.events ?? [])
        .filter((event) => event.type !== "baseline_established")
        .slice(0, 5),
    [historyQ.data?.events],
  );
  const priorityFindings = useMemo(
    () => buildAccountPriorityFindings(findingsItems, accountId, isAws, cloud),
    [findingsItems, accountId, isAws, cloud],
  );
  const accountBlockerFindings = useMemo(
    () =>
      (findingsItems ?? [])
        .filter(
          (f) =>
            findingMatchesAccountRow(f, accountId, isAws, cloud) &&
            (f.status ?? "open") === "open",
        )
        .map((f) => ({
          id: f.id,
          check_id: f.check_id,
          severity: f.severity,
          status: f.status ?? "open",
        })),
    [findingsItems, accountId, isAws, cloud],
  );
  const scanTimelineRows = useMemo(
    () =>
      recentScanRows.map((row) => ({
        key: row.key,
        timestamp: row.timestamp,
        text: scanRowToTimelineText(row.succeeded, row.resourcesScanned),
        dotGreen: row.succeeded,
      })),
    [recentScanRows],
  );
  const complianceTrendPoints = useMemo(() => {
    if (isAws) return postureTrendSeries(historyQ.data);
    return (cloudOverviewQ.data?.posture_trend ?? []).map((p) => ({
      timestamp: p.timestamp,
      value: p.posture_score,
    }));
  }, [isAws, historyQ.data, cloudOverviewQ.data?.posture_trend]);

  const complianceDelta = useMemo(() => {
    if (!hasScanned) return null;
    if (isAws) {
      const trend = postureTrendSeries(historyQ.data);
      const current =
        compliancePct ??
        historyQ.data?.current_posture_score ??
        (trend.length > 0 ? trend[trend.length - 1].value : null);
      const prior = valueAtOrBeforeDaysAgo(trend, 7);
      const delta = delta7d(current, prior);
      return delta != null && delta !== 0 ? delta : null;
    }
    if (
      cloudOverviewQ.data?.compliance_posture_pct != null &&
      cloudOverviewPrevQ.data?.compliance_posture_pct != null
    ) {
      const delta = delta7d(
        cloudOverviewQ.data.compliance_posture_pct,
        cloudOverviewPrevQ.data.compliance_posture_pct,
      );
      return delta != null && delta !== 0 ? delta : null;
    }
    const trend = complianceTrendPoints;
    const current =
      compliancePct ?? (trend.length > 0 ? trend[trend.length - 1].value : null);
    const prior = valueAtOrBeforeDaysAgo(trend, 7);
    const delta = delta7d(current, prior);
    return delta != null && delta !== 0 ? delta : null;
  }, [
    isAws,
    hasScanned,
    compliancePct,
    historyQ.data,
    cloudOverviewQ.data,
    cloudOverviewPrevQ.data,
    complianceTrendPoints,
  ]);

  const coverageDelta = useMemo(() => {
    if (!hasScanned) return null;
    let delta: number | null = null;
    if (isAws) {
      if (coverageQ.data == null || coveragePrevQ.data == null) return null;
      const current = clampCoveragePct(coverageQ.data.coverage_ratio);
      const prior = clampCoveragePct(coveragePrevQ.data.coverage_ratio);
      delta = delta7d(current, prior);
    } else {
      if (cloudOverviewQ.data == null || cloudOverviewPrevQ.data == null) return null;
      const current = clampCoveragePct(cloudOverviewQ.data.coverage.coverage_ratio);
      const prior = clampCoveragePct(cloudOverviewPrevQ.data.coverage.coverage_ratio);
      delta = delta7d(current, prior);
    }
    return delta != null && delta !== 0 ? delta : null;
  }, [
    isAws,
    hasScanned,
    coverageQ.data,
    coveragePrevQ.data,
    cloudOverviewQ.data,
    cloudOverviewPrevQ.data,
  ]);

  if (!connected) {
    return (
      <div className="accounts-detail-pane">
        <div className="accounts-detail-pane__header">
          <div className="accounts-detail-pane__identity">
            <div className="accounts-account-cell__logo">
              <AccountRowProviderMark provider={provider} />
            </div>
            <div className="min-w-0">
              <h2 className="accounts-detail-pane__title">{displayName}</h2>
              <p className="accounts-detail-pane__meta">Setup required</p>
            </div>
          </div>
        </div>
        <div className="accounts-detail-pane__body">
          {isAws && acc ? (
            <DetailTabStub
              title="Finish account setup"
              body="Resume the onboarding window to review access, deploy the stack, and connect this AWS account."
              action={
                <button
                  type="button"
                  className="accounts-detail-quick-actions__primary"
                  onClick={onManageSetup}
                >
                  Continue setup
                </button>
              }
            />
          ) : (
            <DetailTabStub
              title="Finish connector setup"
              body="Complete the integration wizard to connect this cloud account."
              action={
                <button
                  type="button"
                  className="accounts-detail-quick-actions__primary"
                  onClick={() => navigate(cloudIntegrationPath(cloud!.provider))}
                >
                  Continue setup
                </button>
              }
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="accounts-detail-pane">
      <div className="accounts-detail-pane__header">
        <div className="accounts-detail-pane__identity">
          <div className="accounts-account-cell__logo">
            <AccountRowProviderMark provider={provider} />
          </div>
          <div className="min-w-0">
            <div className="accounts-account-cell__name-row">
              <h2 className="accounts-detail-pane__title">{displayName}</h2>
              <VerifiedBadgeIcon />
            </div>
            {displayId ? (
              <div className="accounts-detail-pane__meta">
                <span>{displayId}</span>
                <CopyIdButton text={displayId} />
                {connected ? (
                  <span className="accounts-detail-pane__status">
                    <span className="accounts-detail-pane__status-dot" aria-hidden />
                    Connected
                  </span>
                ) : null}
              </div>
            ) : connected ? (
              <div className="accounts-detail-pane__meta">
                <span className="accounts-detail-pane__status">
                  <span className="accounts-detail-pane__status-dot" aria-hidden />
                  Connected
                </span>
              </div>
            ) : null}
          </div>
        </div>
        <div className="accounts-detail-pane__actions">
          <div className="accounts-detail-pane__actions-row">
            <button
              type="button"
              className="accounts-detail-header__scan-btn"
              onClick={handleScan}
              disabled={scanBusy}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.1} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 5.25v13.5L18 12 7.5 5.25Z" />
              </svg>
              {scanBusy ? "Scanning…" : "Scan now"}
            </button>
            <AccountDetailOverflowMenu
              onViewFindings={() =>
                navigate(`/findings?account_id=${encodeURIComponent(accountId)}`)
              }
              onManageConnection={() =>
                isAws
                  ? setShowConnectorUpdate(true)
                  : navigate(cloudIntegrationPath(cloud!.provider))
              }
              onEditAccount={() => {
                if (isAws) {
                  setShowAccountSettings(true);
                  setShowManageCapabilities(true);
                } else {
                  navigate(cloudIntegrationPath(cloud!.provider));
                }
              }}
            />
          </div>
          {hasScanned && lastScanAt ? (
            <p className="accounts-detail-pane__last-scan" title={formatLastScanTimestamp(lastScanAt)}>
              Last scan · {formatRelativeScanAgo(lastScanAt)}
            </p>
          ) : null}
        </div>
      </div>

      <div className="accounts-detail-pane__body">
        {showAccountSettings && isAws && acc ? (
          <>
            <div className="accounts-detail-settings-panel__head">
              <button
                type="button"
                className="accounts-detail-settings-panel__back"
                onClick={() => {
                  setShowAccountSettings(false);
                  setShowManageCapabilities(false);
                  setShowUpdateArn(false);
                  setRoleArn("");
                  verify.reset();
                }}
              >
                ‹ Back to overview
              </button>
            </div>
            <AccountDetailsPanel
              acc={acc}
              showManageCapabilities={showManageCapabilities}
              showUpdateArn={showUpdateArn}
              roleArn={roleArn}
              setRoleArn={setRoleArn}
              verify={verify}
              onCancelUpdate={() => {
                setShowUpdateArn(false);
                setRoleArn("");
                verify.reset();
              }}
              manageCapabilitiesPanel={
                showManageCapabilities ? (
                  <ManageCapabilitiesPanel
                    acc={acc}
                    draft={draftCapabilities}
                    onDraftChange={(next) => {
                      const locked = enforceDeployedCapabilityLocks(acc, capabilityVerify, next);
                      setDraftCapabilities(locked);
                      debouncedPatchConnection(locked);
                    }}
                    onClose={() => setShowManageCapabilities(false)}
                    saveError={patchError}
                    onVerifyCapabilities={() => verifyCapabilities.mutate()}
                    verifyingCapabilities={verifyCapabilities.isPending}
                    verifyFeedback={verifyFeedback}
                    capabilityVerify={capabilityVerify}
                    verificationMeta={verificationMeta}
                  />
                ) : (
                  <div className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="accounts-outline-btn"
                        onClick={() => setShowManageCapabilities(true)}
                      >
                        Manage capabilities
                      </button>
                      <button
                        type="button"
                        className="accounts-outline-btn"
                        onClick={() => setShowUpdateArn(true)}
                      >
                        Update IAM role
                      </button>
                      <button
                        type="button"
                        className="accounts-outline-btn"
                        onClick={() => setShowConnectorUpdate(true)}
                      >
                        Update connector
                      </button>
                      <button
                        type="button"
                        className="accounts-outline-btn"
                        onClick={() => setShowRemoveConfirm(true)}
                        disabled={remove.isPending}
                      >
                        Disconnect account
                      </button>
                    </div>
                    {nextScanShort !== "—" ? (
                      <p className="mt-3 text-xs text-zinc-500">
                        Next scheduled scan: <span className="font-medium text-zinc-700">{nextScanShort}</span>
                      </p>
                    ) : null}
                  </div>
                )
              }
            />
          </>
        ) : (
          <AccountReadinessOverview
            accountId={accountId}
            provider={provider}
            findings={accountBlockerFindings}
            findingsLoading={findingsLoading}
            hasScanned={hasScanned}
            historyEvents={historyQ.data?.events ?? []}
            scanTimelineRows={scanTimelineRows}
          />
        )}
      </div>

      {isAws && acc ? (
        <>
          <ConnectorUpdateModal
            acc={acc}
            open={showConnectorUpdate}
            onClose={() => setShowConnectorUpdate(false)}
          />
          <ConfirmDialog
            open={showRemoveConfirm}
            title="Remove this account?"
            description={`${acc.label} and associated data will be permanently deleted. This cannot be undone.`}
            confirmLabel="Disconnect account"
            variant="danger"
            loading={remove.isPending}
            onCancel={() => !remove.isPending && setShowRemoveConfirm(false)}
            onConfirm={() => remove.mutate()}
          />
        </>
      ) : null}

      {isAws && connected && isScanActive && scanRun.data?.error ? (
        <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
          {friendlyScanFailureMessage(scanRun.data.error)}
        </div>
      ) : null}
    </div>
  );
}

function CredentialAlert({
  title,
  fix,
  onRecheck,
  recheckPending,
  onReconnect,
  onViewInstructions,
  onDismiss,
}: {
  title: string;
  fix: string;
  onRecheck: () => void;
  recheckPending: boolean;
  onReconnect: () => void;
  onViewInstructions: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="accounts-credential-alert">
      <div className="accounts-credential-alert__copy">
        <span className="accounts-credential-alert__icon" aria-hidden>
          <svg fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </span>
        <div className="accounts-credential-alert__text">
          <div className="accounts-credential-alert__heading">
            <p className="accounts-credential-alert__title">{title}</p>
            <span className="accounts-credential-alert__tag">Credentials</span>
          </div>
          <p className="accounts-credential-alert__body">{fix}</p>
        </div>
      </div>
      <div className="accounts-credential-alert__actions">
        <button
          type="button"
          className="accounts-credential-alert__primary"
          onClick={onRecheck}
          disabled={recheckPending}
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
          </svg>
          {recheckPending ? "Re-checking…" : "Re-check"}
        </button>
        <button type="button" className="accounts-outline-btn" onClick={onReconnect}>
          Reconnect
        </button>
        <button type="button" className="accounts-outline-btn" onClick={onViewInstructions}>
          Instructions
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H18m0 0v4.5M18 6l-7.5 7.5M6 18h12" />
          </svg>
        </button>
      </div>
      {onDismiss ? (
        <button type="button" className="accounts-credential-alert__collapse" onClick={onDismiss} aria-label="Dismiss alert">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="m5 15 7-7 7 7" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

function IntegrationCloudAccountCard({
  cloud,
  stats,
  findingsLoading = false,
  selected = false,
  splitLayout = false,
  suppressSelectionStyle = false,
  onSelect,
}: {
  cloud: CloudAccountRow;
  stats: FindingStats | undefined;
  findingsLoading?: boolean;
  selected?: boolean;
  splitLayout?: boolean;
  suppressSelectionStyle?: boolean;
  onSelect?: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const connected = isCloudAccountConnected(cloud);
  const hasScanned = connected && !!cloud.last_scan_at;
  const scanAgo = hasScanned ? formatRelativeScanAgo(cloud.last_scan_at) : "Never";

  const {
    scanRun,
    scanStatus,
    isScanActive,
    scanProgress,
    triggerScan,
    scan,
  } = useTriggeredCloudScan(connected ? cloud.provider : undefined, connected ? cloud.id : undefined, {
    backgroundPollMs: 5000,
      onScanComplete: () => {
      qc.invalidateQueries({ queryKey: ["cloud-accounts"] });
      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
      qc.invalidateQueries({ queryKey: ["azure-subscriptions"] });
      qc.invalidateQueries({ queryKey: ["findings-snapshot-all"] });
    },
  });

  const scanRunError = scanStatus === "error" ? scanRun.data?.error ?? null : null;
  const rowStatus = resolveAccountRowStatus(
    connected,
    isScanActive,
    scanStatus,
    scanRunError,
    cloud.status,
  );
  const scanError = scan.isError ? formatApiError(scan.error) : scanRunError;

  const handleRowClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("a") || target.closest("[role='menu']")) return;
    onSelect?.();
  };

  const showSelectionStyle = selected && !suppressSelectionStyle;

  return (
    <div className={`accounts-list-item ${!connected ? "is-pending" : ""} ${showSelectionStyle ? " is-selected" : ""}`}>
      <div
        className="accounts-list-item__main"
        onClick={splitLayout ? handleRowClick : undefined}
      >
        <div className="accounts-account-cell">
          <div className="accounts-account-cell__logo">
            <AccountRowProviderMark provider={cloud.provider as CloudProvider} />
          </div>
          <div className="min-w-0">
            <div className="accounts-account-cell__name-row">
              <p className="accounts-account-cell__name">{cloud.label}</p>
              {connected ? <VerifiedBadgeIcon /> : null}
            </div>
            {cloud.external_id ? (
              <div className="accounts-account-cell__id">
                <span>{cloud.external_id}</span>
                <CopyIdButton text={cloud.external_id} />
              </div>
            ) : null}
          </div>
        </div>

        {connected ? (
          <>
            <div className="accounts-coverage">
              <p className="accounts-coverage__ago">
                <span
                  className={`accounts-coverage__dot ${!hasScanned ? "is-none" : ""}`}
                  aria-hidden
                />
                {hasScanned ? scanAgo : "Not scanned"}
              </p>
              <p className="accounts-coverage__next">On-demand scan</p>
            </div>
            <div className="accounts-findings-cell">
              <FindingsMixDonutCompact stats={stats} hasScanned={hasScanned} loading={findingsLoading} />
              <FindingsSeverityLegend stats={stats} hasScanned={hasScanned} loading={findingsLoading} />
            </div>
            <AccountStatusIndicator label={rowStatus.label} tone={rowStatus.tone} />
            {!splitLayout ? (
              <div className="accounts-row-actions">
                <button
                  type="button"
                  onClick={() => triggerScan(cloudScanPath(cloud))}
                  disabled={isScanActive || !connected}
                  className="accounts-scan-now-btn"
                >
                  {isScanActive ? "Scanning…" : "Scan now"}
                </button>
                <CloudAccountMenu
                  provider={cloud.provider}
                  onOpenIntegration={() => navigate(cloudIntegrationPath(cloud.provider))}
                />
              </div>
            ) : null}
          </>
        ) : (
          <div className="accounts-row-actions accounts-row-actions--pending">
            <button
              type="button"
              className="accounts-scan-now-btn"
              onClick={() => navigate(cloudIntegrationPath(cloud.provider))}
            >
              Continue setup
            </button>
          </div>
        )}
      </div>

      {connected && isScanActive && (
        <ScanPhaseBlock
          progress={scanProgress.progress}
          elapsedMs={scanProgress.elapsedMs}
          progressStep={scanProgress.progressStep}
          progressTotal={scanProgress.progressTotal}
          progressPhase={scanProgress.progressPhase}
          progressStepName={scanProgress.progressStepName}
          progressCollectorIndex={scanProgress.progressCollectorIndex}
          progressCollectorTotal={scanProgress.progressCollectorTotal}
          indeterminate={scanProgress.indeterminate}
          compact
        />
      )}

      {scanError ? (
        <div className="border-t border-red-100/80 bg-red-50/60 px-4 py-2.5 text-xs text-red-700">
          {scanError}
        </div>
      ) : null}
    </div>
  );
}

function CompactSeverityCounts({
  stats,
  hasScanned,
  loading,
}: {
  stats: FindingStats | undefined;
  hasScanned: boolean;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="accounts-compact-card__severity accounts-compact-card__severity--loading" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    );
  }
  const high = hasScanned ? (stats?.critHigh ?? 0) : 0;
  const medium = hasScanned ? (stats?.medium ?? 0) : 0;
  const low = hasScanned ? (stats?.low ?? 0) : 0;
  return (
    <div className="accounts-compact-card__severity">
      <span className="accounts-compact-card__severity-item accounts-compact-card__severity-item--high">
        <i aria-hidden />
        {hasScanned ? high.toLocaleString() : "—"} High
      </span>
      <span className="accounts-compact-card__severity-item accounts-compact-card__severity-item--medium">
        <i aria-hidden />
        {hasScanned ? medium.toLocaleString() : "—"} Medium
      </span>
      <span className="accounts-compact-card__severity-item accounts-compact-card__severity-item--low">
        <i aria-hidden />
        {hasScanned ? low.toLocaleString() : "—"} Low
      </span>
    </div>
  );
}

function CompactSplitAccountCard({
  row,
  stats,
  findingsLoading,
  selected,
  onSelect,
  manageLayout = false,
}: {
  row: AccountListRow;
  stats: FindingStats | undefined;
  findingsLoading?: boolean;
  selected: boolean;
  onSelect: () => void;
  manageLayout?: boolean;
}) {
  const connected =
    row.kind === "aws" ? isAccountConnected(row.account) : isCloudAccountConnected(row.cloud);
  const hasScanned =
    connected &&
    !!(row.kind === "aws" ? row.account.last_scan_at : row.cloud.last_scan_at);
  const lastScanAt = row.kind === "aws" ? row.account.last_scan_at : row.cloud.last_scan_at;
  const displayName = row.kind === "aws" ? row.account.label : row.cloud.label;
  const displayId =
    row.kind === "aws" ? row.account.account_id : row.cloud.external_id;
  const provider = (row.kind === "aws" ? "aws" : row.cloud.provider) as "aws" | "gcp" | "azure";
  const scanAgo = hasScanned ? formatRelativeScanAgo(lastScanAt) : null;

  return (
    <button
      type="button"
      className={`accounts-compact-card${manageLayout ? " accounts-compact-card--manage" : ""}${selected ? " is-selected" : ""}${!connected ? " is-pending" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className="accounts-compact-card__top">
        <div className="accounts-compact-card__identity">
          <div className="accounts-compact-card__logo">
            <AccountRowProviderMark provider={provider} />
          </div>
          <div className="accounts-compact-card__meta">
            <span className="accounts-compact-card__name-row">
              <span className="accounts-compact-card__name">{displayName}</span>
              {connected ? <VerifiedBadgeIcon /> : null}
            </span>
            {displayId ? <span className="accounts-compact-card__id">{displayId}</span> : null}
          </div>
        </div>
        {connected ? (
          <span className="accounts-compact-card__connection">
            <span className="accounts-compact-card__status-dot" aria-hidden />
            <span className="accounts-compact-card__connected-label">Connected</span>
            {scanAgo ? (
              <>
                <span className="accounts-compact-card__connection-divider" aria-hidden />
                <span className="accounts-compact-card__scan-ago">{scanAgo}</span>
              </>
            ) : null}
          </span>
        ) : (
          <span className="accounts-compact-card__status accounts-compact-card__status--pending">
            Setup required
          </span>
        )}
      </div>
      <div className="accounts-compact-card__bottom">
        {manageLayout ? (
          <p className="accounts-compact-card__findings-label">Open findings</p>
        ) : null}
        <CompactSeverityCounts stats={stats} hasScanned={hasScanned} loading={findingsLoading} />
      </div>
      {selected ? (
        <svg
          className="accounts-compact-card__chevron"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
        </svg>
      ) : null}
    </button>
  );
}

function AccountPremiumCard({
  acc,
  stats,
  findingsLoading = false,
  expanded,
  onToggle,
  selected = false,
  splitLayout = false,
  suppressSelectionStyle = false,
  onSelect,
  onContinueSetup,
}: {
  acc: Account;
  stats: FindingStats | undefined;
  findingsLoading?: boolean;
  expanded: boolean;
  onToggle: () => void;
  selected?: boolean;
  splitLayout?: boolean;
  suppressSelectionStyle?: boolean;
  onSelect?: () => void;
  onContinueSetup?: () => void;
}) {
  const qc = useQueryClient();
  const [roleArn, setRoleArn] = useState("");
  const [showUpdateArn, setShowUpdateArn] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [showManageCapabilities, setShowManageCapabilities] = useState(false);
  const [showConnectorUpdate, setShowConnectorUpdate] = useState(false);
  const [setupConnectionOptions, setSetupConnectionOptions] = useState(() =>
    accountConnectionOptions(acc),
  );
  const [draftCapabilities, setDraftCapabilities] = useState(() => accountConnectionOptions(acc));
  const [capabilityVerify, setCapabilityVerify] = useState<CapabilityVerifyResults | null>(null);
  const [verifyFeedback, setVerifyFeedback] = useState<CapabilityVerifyFeedback | null>(null);
  const [verificationMeta, setVerificationMeta] = useState<VerificationMeta | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [dismissedAlert, setDismissedAlert] = useState(false);

  useEffect(() => {
    setSetupConnectionOptions(accountConnectionOptions(acc));
    setDraftCapabilities(accountConnectionOptions(acc));
  }, [
    acc.id,
    acc.remediation_modules,
    acc.status,
  ]);

  const connected = isAccountConnected(acc);
  const hasScanned = connected && !!acc.last_scan_at;
  const showSetup = !connected && expanded;

  const {
    scanRun,
    scanStatus,
    isScanActive,
    scanProgress,
    triggerScan,
  } = useTriggeredScan(connected ? acc.id : undefined, {
    backgroundPollMs: 5000,
    onScanComplete: () => {
      qc.invalidateQueries({ queryKey: ["findings-snapshot-all"] });
      qc.invalidateQueries({ queryKey: ["controls"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["accounts-scan-stats"] });
    },
  });

  useEffect(() => {
    setDismissedAlert(false);
  }, [acc.id, scanRun.data?.error]);

  const settings = useQuery<ScanScheduleData>({
    queryKey: ["settings"],
    queryFn: () => api("/v1/settings", { schema: settingsSchema }),
    enabled: connected,
  });
  const nextScanShort = settings.data
    ? formatShortScanDate(settings.data.scan_status.next_scan_at, { utc: true })
    : "—";
  const { freshness } = resolveScanFreshness(acc.last_scan_at);

  const patchConnection = useMutation({
    mutationFn: (opts: ConnectionOptions) =>
      api<Account>(`/v1/accounts/${acc.id}/connection-options`, {
        method: "PATCH",
        body: JSON.stringify(opts),
      }),
    onSuccess: (updated) => {
      setPatchError(null);
      qc.setQueryData<Account[]>(["accounts"], (rows) =>
        rows ? rows.map((row) => (row.id === updated.id ? updated : row)) : [updated],
      );
    },
    onError: (e) => setPatchError(formatApiError(e)),
  });

  const debouncedPatchConnection = useDebouncedCallback((opts: ConnectionOptions) => {
    patchConnection.mutate(opts);
  }, 450);

  const verifyCapabilities = useMutation({
    mutationFn: () =>
      api<VerifyCapabilitiesResponse>(`/v1/accounts/${acc.id}/verify-capabilities`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      setCapabilityVerify(data.capabilities);
      setVerificationMeta(data.verification ?? null);
      setVerifyFeedback(capabilityVerifyFeedback(data));
      qc.setQueryData<Account[]>(["accounts"], (rows) =>
        rows ? rows.map((row) => (row.id === data.account.id ? data.account : row)) : [data.account],
      );
      const opts = accountConnectionOptions(data.account);
      setDraftCapabilities(opts);
      setSetupConnectionOptions(opts);
    },
    onError: (e) => setVerifyFeedback({ tone: "error", message: formatApiError(e) }),
  });

  const verify = useMutation({
    mutationFn: () =>
      api<Account>(`/v1/accounts/${acc.id}/verify`, {
        method: "POST",
        body: JSON.stringify({ role_arn: sanitizeIamRoleArnInput(roleArn) }),
      }),
    onSuccess: (updated) => {
      qc.setQueryData<Account[]>(["accounts"], (rows) =>
        rows ? rows.map((row) => (row.id === updated.id ? updated : row)) : [updated],
      );
      const opts = accountConnectionOptions(updated);
      setSetupConnectionOptions(opts);
      setDraftCapabilities(opts);
      setShowUpdateArn(false);
      setRoleArn("");
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api(`/v1/accounts/${acc.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setShowRemoveConfirm(false);
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["accounts-plan-usage"] });
    },
  });

  const requestRemove = () => {
    if (!connected) {
      remove.mutate();
      return;
    }
    setShowRemoveConfirm(true);
  };

  const ensureExpanded = () => {
    if (!expanded) onToggle();
  };

  const accountMenu: AccountMenuProps = {
    onUpdateConnector: () => {
      ensureExpanded();
      setShowConnectorUpdate(true);
    },
    onManageCapabilities: () => {
      ensureExpanded();
      setShowManageCapabilities((v) => !v);
    },
    onUpdateRole: () => {
      ensureExpanded();
      setShowUpdateArn(true);
    },
    onDisconnect: requestRemove,
    scanDisabled: isScanActive,
    disconnectPending: remove.isPending,
  };

  const scanError = scanStatus === "error" ? scanRun.data?.error ?? null : null;
  const rowStatus = resolveAccountRowStatus(
    connected,
    isScanActive,
    scanStatus,
    scanError,
    acc.status,
  );
  const scanAgo = hasScanned ? formatRelativeScanAgo(acc.last_scan_at) : "Never";
  const showCredentialAlert =
    connected && !isScanActive && scanStatus === "error" && !!scanRun.data?.error;
  const credentialFailure = showCredentialAlert ? classifyScanFailure(scanRun.data!.error!) : null;

  const handleRowClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("a") || target.closest("[role='menu']")) return;
    if (splitLayout) {
      onSelect?.();
      return;
    }
    onToggle();
  };

  const showSelectionStyle = selected && !suppressSelectionStyle;

  return (
    <>
      <div className={`accounts-list-item ${!connected ? "is-pending" : ""} ${expanded && !splitLayout ? "is-expanded" : ""} ${showSelectionStyle ? " is-selected" : ""}`}>
        <div className="accounts-list-item__main" onClick={handleRowClick}>
          <div className="accounts-account-cell">
            <div className="accounts-account-cell__logo">
              <AccountRowProviderMark provider="aws" />
            </div>
            <div className="min-w-0">
              <div className="accounts-account-cell__name-row">
                <p className="accounts-account-cell__name">{acc.label}</p>
                {connected ? <VerifiedBadgeIcon /> : null}
              </div>
              {acc.account_id ? (
                <div className="accounts-account-cell__id">
                  <span>{acc.account_id}</span>
                  <CopyIdButton text={acc.account_id} />
                </div>
              ) : null}
            </div>
          </div>

          {connected ? (
            <>
              <div className="accounts-coverage">
                <p className="accounts-coverage__ago">
                  <span
                    className={`accounts-coverage__dot ${
                      !hasScanned ? "is-none" : freshness === "fresh" ? "" : "is-stale"
                    }`}
                    aria-hidden
                  />
                  {hasScanned ? scanAgo : "Not scanned"}
                </p>
                <p className="accounts-coverage__next">
                  Next scan: <span className="font-semibold text-slate-700">{nextScanShort}</span>
                </p>
              </div>
              <div className="accounts-findings-cell">
                <FindingsMixDonutCompact stats={stats} hasScanned={hasScanned} loading={findingsLoading} />
                <FindingsSeverityLegend stats={stats} hasScanned={hasScanned} loading={findingsLoading} />
              </div>
              <AccountStatusIndicator label={rowStatus.label} tone={rowStatus.tone} />
              {!splitLayout ? (
                <div className="accounts-row-actions">
                  <button
                    type="button"
                    onClick={() => triggerScan(acc.id)}
                    disabled={isScanActive || !connected}
                    className="accounts-scan-now-btn"
                  >
                    {isScanActive ? "Scanning…" : "Scan now"}
                  </button>
                  <AccountMenu {...accountMenu} />
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="accounts-row-actions accounts-row-actions--pending">
                <button
                  type="button"
                  className="accounts-scan-now-btn"
                  onClick={onContinueSetup ?? onToggle}
                >
                  Continue setup
                </button>
                <button
                  type="button"
                  className="accounts-scan-now-btn"
                  onClick={requestRemove}
                  disabled={remove.isPending}
                >
                  Remove
                </button>
              </div>
            </>
          )}
        </div>

        {connected && isScanActive && (
          <ScanPhaseBlock
            progress={scanProgress.progress}
            elapsedMs={scanProgress.elapsedMs}
            progressStep={scanProgress.progressStep}
            progressTotal={scanProgress.progressTotal}
            progressPhase={scanProgress.progressPhase}
            progressStepName={scanProgress.progressStepName}
            progressCollectorIndex={scanProgress.progressCollectorIndex}
            progressCollectorTotal={scanProgress.progressCollectorTotal}
            indeterminate={scanProgress.indeterminate}
            compact
          />
        )}

        {showCredentialAlert && !dismissedAlert && (
          <CredentialAlert
            title={credentialFailure!.title}
            fix={credentialFailure!.fix}
            onRecheck={() => triggerScan(acc.id)}
            recheckPending={isScanActive}
            onReconnect={() => {
              ensureExpanded();
              setShowUpdateArn(true);
            }}
            onViewInstructions={() => {
              ensureExpanded();
              setShowManageCapabilities(false);
              setShowUpdateArn(true);
            }}
            onDismiss={() => setDismissedAlert(true)}
          />
        )}

        {expanded && !splitLayout && (
          <div className="accounts-list-item__expand">
            {connected && !hasScanned && !isScanActive && (
              <div className="border-b border-zinc-100/80 bg-zinc-50/40 px-6 py-3 text-center text-sm text-zinc-500">
                Run a scan to populate findings.
              </div>
            )}

            {connected && (
              <div className="bg-zinc-50/50">
                <AccountDetailsPanel
                  acc={acc}
                  showManageCapabilities={showManageCapabilities}
                  showUpdateArn={showUpdateArn}
                  roleArn={roleArn}
                  setRoleArn={setRoleArn}
                  verify={verify}
                  onCancelUpdate={() => {
                    setShowUpdateArn(false);
                    setRoleArn("");
                    verify.reset();
                  }}
                  manageCapabilitiesPanel={
                    showManageCapabilities ? (
                      <ManageCapabilitiesPanel
                        acc={acc}
                        draft={draftCapabilities}
                        onDraftChange={(next) => {
                          const locked = enforceDeployedCapabilityLocks(acc, capabilityVerify, next);
                          setDraftCapabilities(locked);
                          debouncedPatchConnection(locked);
                        }}
                        onClose={() => setShowManageCapabilities(false)}
                        saveError={patchError}
                        onVerifyCapabilities={() => verifyCapabilities.mutate()}
                        verifyingCapabilities={verifyCapabilities.isPending}
                        verifyFeedback={verifyFeedback}
                        capabilityVerify={capabilityVerify}
                        verificationMeta={verificationMeta}
                      />
                    ) : null
                  }
                />
              </div>
            )}

            {showSetup ? <AwsConnectFlow acc={acc} embedded /> : null}
          </div>
        )}

        <ConnectorUpdateModal
          acc={acc}
          open={showConnectorUpdate}
          onClose={() => setShowConnectorUpdate(false)}
        />

        <ConfirmDialog
          open={showRemoveConfirm}
          title="Remove this account?"
          description={
            connected
              ? hasScanned
                ? `${acc.label} and all associated findings, scan history, and evidence will be permanently deleted. This cannot be undone.`
                : `${acc.label} will be disconnected and removed. No findings or evidence have been collected yet. This cannot be undone.`
              : `${acc.label} setup will be discarded. This account was never connected — no findings, scans, or evidence exist. This cannot be undone.`
          }
          confirmLabel="Disconnect account"
          variant="danger"
          loading={remove.isPending}
          onCancel={() => !remove.isPending && setShowRemoveConfirm(false)}
          onConfirm={() => remove.mutate()}
        />
      </div>
    </>
  );
}

type CloudProviderChoice = "aws" | "gcp" | "azure";

const ADD_ACCOUNT_PROVIDERS: {
  id: CloudProviderChoice;
  name: string;
  ariaLabel: string;
}[] = [
  {
    id: "aws",
    name: "Amazon Web Services",
    ariaLabel: "Amazon Web Services",
  },
  {
    id: "gcp",
    name: "Google Cloud",
    ariaLabel: "Google Cloud",
  },
  {
    id: "azure",
    name: "Microsoft Azure",
    ariaLabel: "Microsoft Azure",
  },
];

function AddAccountProviderPicker({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (provider: CloudProviderChoice) => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="accounts-provider-modal"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="accounts-provider-modal-title"
        className="accounts-provider-modal__panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="accounts-provider-modal__head">
          <div>
            <h2 id="accounts-provider-modal-title" className="accounts-provider-modal__title">
              Choose cloud provider
            </h2>
            <p className="accounts-provider-modal__subtitle">
              Connect an account to start the connection flow.
            </p>
          </div>
          <button
            type="button"
            className="accounts-provider-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="accounts-provider-modal__grid">
          {ADD_ACCOUNT_PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className={`accounts-provider-modal__card accounts-provider-modal__card--${provider.id}`}
              aria-label={`Connect ${provider.ariaLabel}`}
              onClick={() => onSelect(provider.id)}
            >
              <span
                className={`accounts-provider-modal__icon accounts-provider-modal__icon--${provider.id}`}
                aria-hidden
              >
                <img src={INTEGRATION_BRAND[provider.id].src} alt="" decoding="async" />
              </span>
              <span className="accounts-provider-modal__name">{provider.name}</span>
            </button>
          ))}
        </div>
        <hr className="accounts-provider-modal__divider" aria-hidden />
        <p className="accounts-provider-modal__footnote">
          <IconShield className="accounts-provider-modal__footnote-icon" aria-hidden />
          Read-only by default. Veritrail won't act on your cloud unless you explicitly allow it.
        </p>
      </div>
    </div>,
    document.body,
  );
}

export default function Accounts() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Route fork (docs/org-readiness-home.md §1):
  // `/accounts` (no params) = org readiness home; `/accounts?account_id=X` = the
  // per-account detail pane; `/accounts?view=all` = the management list.
  const viewAll = searchParams.get("view") === "all";
  const hasAccountParam = !!(searchParams.get("account_id") || searchParams.get("account"));
  // Org home is unscoped by definition — never auto-select a persisted account here.
  const orgHome = !viewAll && !hasAccountParam;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [addingAwsAccount, setAddingAwsAccount] = useState(false);
  const [addingCloudProvider, setAddingCloudProvider] = useState<Exclude<CloudProviderChoice, "aws"> | null>(
    null,
  );
  const [onboardingAccount, setOnboardingAccount] = useState<Account | null>(null);
  const [discardOnboardingAccountId, setDiscardOnboardingAccountId] = useState<string | null>(null);
  const [accountSearch, setAccountSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [listSort, setListSort] = useState<AccountListSort>("last_scan");
  const [pendingConnectionOptions, setPendingConnectionOptions] = useState<ConnectionOptions>(
    defaultOnboardingConnectionOptions,
  );
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const rows = await api("/v1/accounts", { schema: accountListSchema });
      return rows as Account[];
    },
    refetchOnMount: "always",
  });

  const cloudAccounts = useQuery({
    queryKey: ["cloud-accounts"],
    queryFn: () => api("/v1/integrations/cloud-accounts", { schema: cloudAccountListSchema }),
    refetchOnMount: "always",
  });

  const create = useMutation({
    mutationFn: (opts: ConnectionOptions) =>
      api<Account>("/v1/accounts", {
        method: "POST",
        body: JSON.stringify({
          remediation_modules: opts.remediation_modules,
        }),
      }),
    onSuccess: (acc) => {
      qc.setQueryData<Account[]>(["accounts"], (rows) =>
        rows ? [...rows.filter((row) => row.id !== acc.id), acc] : [acc],
      );
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["accounts-plan-usage"] });
      setAddingAwsAccount(true);
      setOnboardingAccount(acc);
      setDiscardOnboardingAccountId(acc.id);
      setExpandedId(null);
      setPendingConnectionOptions(accountConnectionOptions(acc));
    },
  });

  const allFindings = useQuery({
    queryKey: ["findings-snapshot-all"],
    queryFn: () => fetchAllFindings<Finding>({ status: "open" }),
    enabled: (accounts.data?.length ?? 0) > 0 || (cloudAccounts.data?.length ?? 0) > 0,
  });

  const scanStats = useQuery({
    queryKey: ["accounts-scan-stats"],
    queryFn: () =>
      api("/v1/accounts/scan-stats", { schema: scanStatsSchema }),
    enabled: (accounts.data?.length ?? 0) > 0 || (cloudAccounts.data?.length ?? 0) > 0,
    staleTime: 60_000,
  });

  const planUsage = useAccountsPlanUsage();

  const statsMap = useMemo(() => buildStatsMap(allFindings.data?.items), [allFindings.data?.items]);

  const findingsSnapshotEnabled =
    (accounts.data?.length ?? 0) > 0 || (cloudAccounts.data?.length ?? 0) > 0;
  const findingsSnapshotLoading =
    findingsSnapshotEnabled && !allFindings.isSuccess && !allFindings.isError;

  const integrationAccounts = useMemo(
    () =>
      (cloudAccounts.data ?? []).filter(
        (row) =>
          (row.provider === "gcp" || row.provider === "azure") &&
          isCloudAccountConnected(row),
      ),
    [cloudAccounts.data],
  );

  const integrationStatsMap = useMemo(
    () => buildIntegrationStatsMap(allFindings.data?.items, integrationAccounts),
    [allFindings.data?.items, integrationAccounts],
  );

  const allAccs = useMemo(() => accounts.data ?? [], [accounts.data]);
  const accs = useMemo(
    () => allAccs.filter((row) => isAccountConnected(row)),
    [allAccs],
  );
  const hasConnectedAws = accs.length > 0;
  const hasConnectedIntegration = integrationAccounts.length > 0;
  const hasAnyConnectedCloud = hasConnectedAws || hasConnectedIntegration;
  const hasAnyAccounts = accs.length > 0 || integrationAccounts.length > 0;
  const connectedAccountCount =
    accs.filter((a) => isAccountConnected(a)).length +
    integrationAccounts.filter((row) => isCloudAccountConnected(row)).length;
  const atPlanCap = planUsage.data ? !planUsage.data.can_add : false;
  const planCapMsg = planUsage.data
    ? `Your ${planUsage.data.plan_label} plan includes ${planUsage.data.max_accounts} account${planUsage.data.max_accounts === 1 ? "" : "s"}. Upgrade to connect more.`
    : "";
  const filteredAccs = useMemo(
    () =>
      accs.filter(
        (acc) =>
          matchesAccountSearch(acc, accountSearch) &&
          matchesAccountProviderFilter(acc, providerFilter) &&
          matchesAccountStatusFilter(acc, statusFilter),
      ),
    [accs, accountSearch, providerFilter, statusFilter],
  );

  const filteredIntegrationAccs = useMemo(
    () =>
      integrationAccounts.filter(
        (cloud) =>
          matchesCloudAccountSearch(cloud, accountSearch) &&
          matchesCloudProviderFilter(cloud, providerFilter) &&
          matchesCloudAccountStatusFilter(cloud, statusFilter),
      ),
    [integrationAccounts, accountSearch, providerFilter, statusFilter],
  );

  const filteredRows = useMemo<AccountListRow[]>(
    () => [
      ...filteredAccs.map((account) => ({ kind: "aws" as const, account })),
      ...filteredIntegrationAccs.map((cloud) => ({ kind: "cloud" as const, cloud })),
    ],
    [filteredAccs, filteredIntegrationAccs],
  );

  const sortedFilteredRows = useMemo(
    () => sortAccountListRows(filteredRows, listSort),
    [filteredRows, listSort],
  );

  const effectivePageSize = pageSize;
  const totalPages = Math.max(1, Math.ceil(sortedFilteredRows.length / effectivePageSize));
  const paginatedRows = sortedFilteredRows.slice((page - 1) * effectivePageSize, page * effectivePageSize);
  const pageStart = sortedFilteredRows.length === 0 ? 0 : (page - 1) * effectivePageSize + 1;
  const pageEnd = Math.min(page * effectivePageSize, sortedFilteredRows.length);

  const connectedOptionsQ = useConnectedAccountOptions();
  const { accountId: urlAccountId } = useSelectedAccountId(
    connectedOptionsQ.options,
    connectedOptionsQ.isSuccess,
    { disableUrlSync: orgHome },
  );

  const selectedRow = useMemo(
    () => (selectedRowKey ? parseAccountListRowKey(selectedRowKey, filteredRows) : null),
    [selectedRowKey, filteredRows],
  );

  useEffect(() => {
    if (filteredRows.length === 0) {
      setSelectedRowKey(null);
      return;
    }
    const fromUrl = accountListRowFromId(urlAccountId, filteredRows);
    if (fromUrl) {
      const key = accountListRowKey(fromUrl);
      if (selectedRowKey !== key) setSelectedRowKey(key);
      return;
    }
    if (selectedRowKey && parseAccountListRowKey(selectedRowKey, filteredRows)) return;
    const preferred =
      filteredRows.find((row) =>
        row.kind === "aws" ? isAccountConnected(row.account) : isCloudAccountConnected(row.cloud),
      ) ?? filteredRows[0];
    setSelectedRowKey(accountListRowKey(preferred));
  }, [filteredRows, selectedRowKey, urlAccountId]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // Filters belong to the management list. Clear them when returning to the
  // dashboard so a stale search can't hide the selected account.
  useEffect(() => {
    if (viewAll) return;
    setAccountSearch("");
    setProviderFilter("all");
    setStatusFilter("all");
    setPage(1);
  }, [viewAll]);

  const openAccountDashboard = (row: AccountListRow) => {
    if (row.kind === "aws" && !isAccountConnected(row.account)) {
      setOnboardingAccount(row.account);
      setDiscardOnboardingAccountId(null);
      setPendingConnectionOptions(accountConnectionOptions(row.account));
      setAddingAwsAccount(true);
      return;
    }
    if (row.kind === "cloud" && !isCloudAccountConnected(row.cloud)) {
      navigate(cloudIntegrationPath(row.cloud.provider));
      return;
    }
    const id = accountIdFromListRow(row);
    setSelectedRowKey(accountListRowKey(row));
    navigate(`/accounts?account_id=${encodeURIComponent(id)}`);
  };

  const pendingAcc = allAccs.find((a) => !isAccountConnected(a));
  const activeOnboardingAccount = onboardingAccount
    ? allAccs.find((a) => a.id === onboardingAccount.id) ?? onboardingAccount
    : null;
  const showCapabilityOnboarding =
    !accounts.isLoading &&
    !cloudAccounts.isLoading &&
    !accounts.isError &&
    !cloudAccounts.isError &&
    (addingAwsAccount || (!hasAnyAccounts && (!pendingAcc || expandedId === null)));

  const autoCreatePendingAccountRef = useRef(false);

  const resetAddAccountFlow = () => {
    setAddingAwsAccount(false);
    setOnboardingAccount(null);
    setDiscardOnboardingAccountId(null);
    setPendingConnectionOptions(defaultOnboardingConnectionOptions());
  };

  const handleDismissAddAccount = () => {
    if (
      activeOnboardingAccount &&
      discardOnboardingAccountId === activeOnboardingAccount.id &&
      !isAccountConnected(activeOnboardingAccount)
    ) {
      const discardId = activeOnboardingAccount.id;
      qc.setQueryData<Account[]>(["accounts"], (rows) =>
        rows ? rows.filter((row) => row.id !== discardId) : rows,
      );
      void api(`/v1/accounts/${discardId}`, { method: "DELETE" }).finally(() => {
        qc.invalidateQueries({ queryKey: ["accounts"] });
        qc.invalidateQueries({ queryKey: ["accounts-plan-usage"] });
      });
    }
    resetAddAccountFlow();
  };

  const handleDismissEmbeddedSetup = () => {
    setExpandedId(null);
    if (pendingAcc) {
      setPendingConnectionOptions(accountConnectionOptions(pendingAcc));
      const pendingKey = accountListRowKey({ kind: "aws", account: pendingAcc });
      if (selectedRowKey === pendingKey) {
        const other =
          filteredRows.find(
            (row) =>
              accountListRowKey(row) !== pendingKey &&
              (row.kind === "aws"
                ? isAccountConnected(row.account)
                : isCloudAccountConnected(row.cloud)),
          ) ?? filteredRows.find((row) => accountListRowKey(row) !== pendingKey);
        setSelectedRowKey(other ? accountListRowKey(other) : null);
      }
    }
  };

  const showFirstTimeCapabilityOnboarding = showCapabilityOnboarding && !addingAwsAccount;
  const showAccountList =
    !accounts.isLoading &&
    !cloudAccounts.isLoading &&
    !accounts.isError &&
    !cloudAccounts.isError &&
    hasAnyAccounts &&
    !showFirstTimeCapabilityOnboarding;

  const handleAddAccountClick = () => {
    setShowProviderPicker(true);
  };

  const handleProviderSelect = (provider: CloudProviderChoice) => {
    setShowProviderPicker(false);
    if (provider === "gcp") {
      setAddingCloudProvider("gcp");
      return;
    }
    if (provider === "azure") {
      setAddingCloudProvider("azure");
      return;
    }
    setPendingConnectionOptions(defaultOnboardingConnectionOptions());
    setOnboardingAccount(null);
    setDiscardOnboardingAccountId(null);
    setAddingAwsAccount(true);
    if (pendingAcc) {
      setOnboardingAccount(pendingAcc);
      setDiscardOnboardingAccountId(pendingAcc.id);
      setPendingConnectionOptions(accountConnectionOptions(pendingAcc));
      return;
    }
    if (!create.isPending) {
      create.mutate(defaultOnboardingConnectionOptions());
    }
  };

  useEffect(() => {
    if (
      showFirstTimeCapabilityOnboarding &&
      !pendingAcc &&
      !addingAwsAccount &&
      !create.isPending &&
      !autoCreatePendingAccountRef.current
    ) {
      autoCreatePendingAccountRef.current = true;
      create.mutate(defaultOnboardingConnectionOptions());
    }
  }, [showFirstTimeCapabilityOnboarding, pendingAcc, addingAwsAccount, create.isPending]);

  useEffect(() => {
    if (pendingAcc && expandedId === null) {
      setPendingConnectionOptions(accountConnectionOptions(pendingAcc));
    }
  }, [
    pendingAcc?.id,
    pendingAcc?.remediation_modules,
    expandedId,
  ]);

  return (
    <ProductShell className="flex flex-1 flex-col">
    <div className="accounts-page">
      {accounts.isLoading && cloudAccounts.isLoading && accs.length === 0 && integrationAccounts.length === 0 && (
        <p className="text-sm text-zinc-500">Loading accounts…</p>
      )}

      {(accounts.isError || cloudAccounts.isError) && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-medium">Could not load accounts</p>
          <p className="mt-1 text-red-700">
            {isSessionStaleError(accounts.error ?? cloudAccounts.error)
              ? "Your sign-in session no longer matches this workspace (common after a database restore). Sign out and sign in again."
              : formatApiError(accounts.error ?? cloudAccounts.error)}
          </p>
          {isSessionStaleError(accounts.error ?? cloudAccounts.error) ? (
            <button
              type="button"
              onClick={() => {
                void logout().finally(() => {
                  window.location.href = "/login";
                });
              }}
              className="mt-3 text-sm font-semibold text-red-900 underline hover:no-underline"
            >
              Sign out and sign in again
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (accounts.isError) accounts.refetch();
                if (cloudAccounts.isError) cloudAccounts.refetch();
              }}
              className="mt-3 text-sm font-semibold text-red-900 underline hover:no-underline"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {showFirstTimeCapabilityOnboarding && pendingAcc ? (
        <AwsConnectFlow
          acc={pendingAcc}
          embedded
          onComplete={() => {
            setExpandedId(pendingAcc.id);
            setSelectedRowKey(accountListRowKey({ kind: "aws", account: pendingAcc }));
          }}
        />
      ) : null}

      {addingAwsAccount ? (
        <CloudConnectOverlay onDismiss={handleDismissAddAccount} ariaLabelledBy="cloud-connect-title">
          {activeOnboardingAccount ? (
            <AwsConnectFlow
              acc={activeOnboardingAccount}
              embedded
              onDismiss={handleDismissAddAccount}
              onComplete={resetAddAccountFlow}
            />
          ) : (
            <div className="accounts-connect-shell accounts-connect-shell--creating">
              <p className="accounts-connect-shell__creating">Creating account…</p>
            </div>
          )}
        </CloudConnectOverlay>
      ) : null}

      {addingCloudProvider ? (
        <CloudConnectOverlay
          onDismiss={() => setAddingCloudProvider(null)}
          ariaLabelledBy="cloud-connect-title"
        >
          {addingCloudProvider === "gcp" ? (
            <GcpConnectFlow
              embedded
              onDismiss={() => setAddingCloudProvider(null)}
              onComplete={() => {
                setAddingCloudProvider(null);
                qc.invalidateQueries({ queryKey: ["cloud-accounts"] });
                qc.invalidateQueries({ queryKey: ["gcp-projects"] });
              }}
            />
          ) : (
            <AzureConnectFlow
              embedded
              onDismiss={() => setAddingCloudProvider(null)}
              onComplete={() => {
                setAddingCloudProvider(null);
                qc.invalidateQueries({ queryKey: ["cloud-accounts"] });
                qc.invalidateQueries({ queryKey: ["azure-subscriptions"] });
              }}
            />
          )}
        </CloudConnectOverlay>
      ) : null}

      <AddAccountProviderPicker
        open={showProviderPicker}
        onClose={() => setShowProviderPicker(false)}
        onSelect={handleProviderSelect}
      />

      {showAccountList && viewAll && (
        <div className="accounts-list-shell accounts-list-shell--compact accounts-list-shell--manage">
          <div className="accounts-list-shell__header">
            <AccountsToolbar
              search={accountSearch}
              onSearchChange={(v) => {
                setAccountSearch(v);
                setPage(1);
              }}
              providerFilter={providerFilter}
              onProviderFilterChange={(v) => {
                setProviderFilter(v);
                setPage(1);
              }}
              statusFilter={statusFilter}
              onStatusFilterChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              onAddAccount={handleAddAccountClick}
              addDisabled={create.isPending || atPlanCap || addingAwsAccount}
              addTitle={atPlanCap ? planCapMsg : undefined}
              adding={create.isPending}
            />
          </div>
          {filteredRows.length === 0 ? (
            <p className="accounts-list-empty">No accounts match your filters</p>
          ) : (
            <>
              <div className="accounts-compact-list__head">
                <p className="accounts-compact-list__title">
                  {sortedFilteredRows.length} account{sortedFilteredRows.length === 1 ? "" : "s"}
                </p>
                <div className="accounts-compact-list__sort">
                  <label className="sr-only" htmlFor="accounts-list-sort">
                    Sort accounts
                  </label>
                  <select
                    id="accounts-list-sort"
                    value={listSort}
                    onChange={(e) => {
                      setListSort(e.target.value as AccountListSort);
                      setPage(1);
                    }}
                  >
                    <option value="last_scan">Last scan ↓</option>
                    <option value="name">Name</option>
                  </select>
                </div>
              </div>
              <div className="accounts-compact-list__scroll">
                {paginatedRows.map((row) => {
                  const key = accountListRowKey(row);
                  const stats =
                    row.kind === "aws"
                      ? statsMap.get(row.account.id)
                      : integrationStatsMap.get(row.cloud.id);
                  return (
                    <CompactSplitAccountCard
                      key={key}
                      row={row}
                      stats={stats}
                      findingsLoading={findingsSnapshotLoading}
                      selected={false}
                      manageLayout
                      onSelect={() => openAccountDashboard(row)}
                    />
                  );
                })}
              </div>

              <div className="accounts-list-pagination">
                <p className="accounts-list-pagination__meta">
                  {pageStart}-{pageEnd} of {sortedFilteredRows.length} account
                  {sortedFilteredRows.length === 1 ? "" : "s"}
                </p>
                {totalPages > 1 ? (
                  <div className="accounts-list-pagination__controls">
                    <button
                      type="button"
                      className="accounts-list-pagination__btn"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      aria-label="Previous page"
                    >
                      ‹
                    </button>
                    <button type="button" className="accounts-list-pagination__btn is-current" aria-current="page">
                      {page}
                    </button>
                    <button
                      type="button"
                      className="accounts-list-pagination__btn"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      aria-label="Next page"
                    >
                      ›
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      )}

      {showAccountList && orgHome && (
        <HeaderSlot>
          <div className="header-filter-bar accounts-dashboard__header-bar">
            <Link to="/accounts?view=all" className="accounts-dashboard__all-link">
              <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" />
              </svg>
              All accounts
              {sortedFilteredRows.length > 0 ? ` (${sortedFilteredRows.length})` : ""}
            </Link>
          </div>
        </HeaderSlot>
      )}

      {showAccountList && !viewAll && (
        <>
          {!orgHome && (
            <HeaderSlot>
              <div className="header-filter-bar accounts-dashboard__header-bar">
                <Link to="/accounts?view=all" className="accounts-dashboard__all-link">
                  <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" />
                  </svg>
                  All accounts
                  {sortedFilteredRows.length > 0 ? ` (${sortedFilteredRows.length})` : ""}
                </Link>
              </div>
            </HeaderSlot>
          )}
          <div className="accounts-dashboard">
          {orgHome ? (
            <OrgReadinessHome />
          ) : selectedRow ? (
            <AccountSplitDetailPane
              row={selectedRow}
              stats={
                selectedRow.kind === "aws"
                  ? statsMap.get(selectedRow.account.id)
                  : integrationStatsMap.get(selectedRow.cloud.id)
              }
              findingsItems={allFindings.data?.items}
              findingsLoading={findingsSnapshotLoading}
              onManageSetup={() => {
                if (selectedRow.kind === "aws" && !isAccountConnected(selectedRow.account)) {
                  setOnboardingAccount(selectedRow.account);
                  setDiscardOnboardingAccountId(null);
                  setPendingConnectionOptions(accountConnectionOptions(selectedRow.account));
                  setAddingAwsAccount(true);
                  setExpandedId(null);
                  return;
                }
                setExpandedId(null);
              }}
              onDismissSetup={handleDismissEmbeddedSetup}
            />
          ) : (
            <div className="accounts-detail-empty">
              <p className="accounts-detail-empty__title">Select an account</p>
              <p className="accounts-detail-empty__body">
                Open{" "}
                <Link to="/accounts?view=all" className="accounts-detail-empty__link">
                  all accounts
                </Link>{" "}
                to browse and manage them.
              </p>
            </div>
          )}
          </div>
        </>
      )}

      {create.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {formatApiError(create.error)}
        </div>
      )}
    </div>
    </ProductShell>
  );
}
