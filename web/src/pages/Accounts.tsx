import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api, formatApiError, isSessionStaleError, logout } from "../api";
import {
  accountListSchema,
  cloudAccountListSchema,
  complianceTimelineSchema,
  controlListSchema,
  evidenceCoverageSchema,
  scanStatsSchema,
  settingsSchema,
} from "../lib/apiSchemas";
import { fetchAllFindings } from "../lib/fetchAllFindings";
import {
  delta7d,
  deltaImproved,
  daysAgoIso,
  formatPercentDelta,
  postureTrendSeries,
  type BetterWhen,
  valueAtOrBeforeDaysAgo,
} from "../lib/accountMetricDeltas";
import type { ComplianceHistoryResponse } from "../lib/complianceHistory";
import { controlPostureScore } from "../lib/controlPostureScore";
import type { EvidenceCoverage } from "../lib/evidenceCoverage";
import { DeploymentParametersCard } from "../components/accountOnboardingUI";
import {
  ADVANCED_POLICY_RAW_ACTIONS,
} from "../data/capabilityCopy";
import {
  parseCfnLaunchMeta,
  resolveDeployArtifacts,
  type CfnConnectionOptions,
} from "../lib/cfnDeployCommands";
import { isValidIamRoleArn, sanitizeIamRoleArnInput } from "../lib/awsArn";
import {
  DEFAULT_REMEDIATION_MODULES,
  REMEDIATION_MODULE_SPECS,
  allRemediationModulesEnabled,
  anyRemediationEnabled,
  countRemediationEnabled,
  type RemediationModuleId,
  type RemediationModules,
} from "../data/remediationModules";
import ConfirmDialog from "../components/ConfirmDialog";
import { ProductShell } from "../components/ProductShell";
import { MetricHelpTip } from "../components/MetricHelpTip";
import { ConnectorUpdateModal } from "../components/ConnectorUpdateModal";
import { ProviderMark, type CloudProvider } from "../components/AccountSelect";
import { Select } from "../components/Select";
import { AWS_LOGO_LIGHT } from "../lib/awsBrand";
import { INTEGRATION_BRAND } from "../lib/integrationBrands";
import { useAccountsPlanUsage } from "../hooks/useAccountsPlanUsage";
import { useDebouncedCallback } from "../hooks/useDebouncedCallback";
import { formatScanProgressDetailLabel, mapWorkerStepToUiPhase } from "../hooks/useScanProgress";
import { useTriggeredScan } from "../hooks/useTriggeredScan";
import { useTriggeredCloudScan, type ScanRunLatest } from "../hooks/useTriggeredCloudScan";
import { IconShield } from "../components/IntegrationsUi";
import { SeverityIndicator } from "../components/SeverityIndicator";
import { isAccountConnected } from "../lib/accountConnection";
import { classifyScanFailure, friendlyScanFailureMessage } from "../lib/scanFailureMessages";
import {
  CONNECTOR_STACK_NAME,
  SCANNER_ROLE_NAME,
  scannerRoleArnExample,
} from "../lib/connectionPosture";
import { checkLabels } from "../data/checkLabels";
import { findingDisplayGroupKey, findingGroupMeta } from "../data/findingGroups";
import "../styles/accounts-page.css";
import "../styles/findings-v2.css";

type ConnectionOptions = {
  enable_advanced_policy_generation: boolean;
  remediation_modules: RemediationModules;
};

type Account = {
  id: string;
  label: string;
  account_id: string | null;
  status: string;
  external_id: string;
  role_arn: string | null;
  enable_advanced_policy_generation: boolean;
  remediation_modules: RemediationModules;
  remediation_modules_deployed: RemediationModules;
  advanced_policy_generation_deployed: boolean;
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
  enable_advanced_policy_generation: false,
  remediation_modules: { ...DEFAULT_REMEDIATION_MODULES },
};

function defaultOnboardingConnectionOptions(): ConnectionOptions {
  return {
    enable_advanced_policy_generation: false,
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
    enable_advanced_policy_generation: acc.enable_advanced_policy_generation,
    remediation_modules: { ...DEFAULT_REMEDIATION_MODULES, ...acc.remediation_modules },
  };
}

function hasOptionalCapabilities(acc: Account): boolean {
  return (
    acc.enable_advanced_policy_generation ||
    anyRemediationEnabled(acc.remediation_modules ?? DEFAULT_REMEDIATION_MODULES)
  );
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
  "Checking SSM automation…",
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
  let enableAdvanced = options.enable_advanced_policy_generation;
  if (
    !enableAdvanced &&
    capabilityLockedInAws(
      capabilityVerify?.advanced_policy_generation,
      acc.advanced_policy_generation_deployed,
    )
  ) {
    enableAdvanced = true;
  }

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

  return {
    enable_advanced_policy_generation: enableAdvanced,
    remediation_modules,
  };
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

function RemediationModuleChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
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
};

const DETAIL_FINDINGS_GROUP_LIMIT = 8;
const sevWeight: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

type CloudAccountRow = {
  provider: string;
  id: string;
  external_id: string | null;
  label: string;
  status: string;
  last_scan_at: string | null;
  open_findings_count?: number;
};

type CloudAccountOverview = {
  provider: string;
  resource_id: string;
  resources_covered: number;
  regions_count: number;
  open_findings_count: number;
  soc2_controls_passed: number | null;
  soc2_controls_total: number | null;
  compliance_posture_pct: number | null;
  coverage: EvidenceCoverage;
  posture_trend: Array<{ timestamp: string; posture_score: number }>;
  open_findings_trend: Array<{ timestamp: string; open_findings_count: number }>;
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

type DetailTab = "overview" | "findings" | "scans" | "resources" | "settings";

function accountListRowKey(row: AccountListRow): string {
  if (row.kind === "aws") return `aws:${row.account.id}`;
  return `cloud:${row.cloud.provider}:${row.cloud.id}`;
}

function parseAccountListRowKey(key: string, rows: AccountListRow[]): AccountListRow | null {
  return rows.find((row) => accountListRowKey(row) === key) ?? null;
}

function isCloudAccountConnected(row: CloudAccountRow): boolean {
  return row.status === "connected";
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
            placeholder="Search by account name, ID, or provider…"
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
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {adding ? "Adding…" : "Add account"}
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
  const opts = accountConnectionOptions(acc);
  const tags = [
    "aws",
    "amazon",
    "core scanner",
    opts.enable_advanced_policy_generation ? "policy generation" : "",
    anyRemediationEnabled(opts.remediation_modules) ? "ssm remediation" : "",
  ];
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
  size = 64,
  stroke = 3.5,
}: {
  stats: FindingStats | undefined;
  hasScanned: boolean;
  size?: number;
  stroke?: number;
}) {
  const total = stats?.open ?? 0;
  const segments = getMixSegments(stats);
  const showChart = hasScanned && segments.length > 0;

  return (
    <div className="accounts-findings-donut">
      <div className="accounts-findings-donut__ring">
        {showChart ? (
          <FindingsMixDonutSvg segments={segments} size={size} stroke={stroke} premium gapPx={1.5} />
        ) : (
          <div className="accounts-findings-donut__empty" aria-hidden />
        )}
      </div>
      <div className="accounts-findings-donut__hub">
        <span className="accounts-findings-donut__count">{hasScanned ? total : "—"}</span>
        <span className="accounts-findings-donut__label">Open</span>
      </div>
    </div>
  );
}

function FindingsSeverityLegend({ stats, hasScanned }: { stats: FindingStats | undefined; hasScanned: boolean }) {
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
          <span className="accounts-findings-legend__count">{hasScanned ? row.count : "—"}</span>
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
  if (!hasScanned) return "— resources scanned";
  const count = resources ?? 0;
  return `${count.toLocaleString()} resource${count === 1 ? "" : "s"} scanned`;
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

const ssmRemediationBadgeClass =
  "rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200/60";

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

function remediationBadgesCollapsed(
  acc: Account,
  modules: RemediationModules,
  capabilityVerify?: CapabilityVerifyResults | null,
): boolean {
  if (!anyRemediationEnabled(modules)) return false;
  if (allRemediationModulesEnabled(modules)) return true;
  if (capabilityVerify?.ssm_remediation?.ready || capabilityVerify?.ssm_remediation?.deployed) {
    return true;
  }
  const enabled = REMEDIATION_MODULE_SPECS.filter((m) => modules[m.id]);
  const deployed = acc.remediation_modules_deployed ?? DEFAULT_REMEDIATION_MODULES;
  return enabled.every((m) => deployed[m.id]);
}

function CapabilityBadges({
  acc,
  connectionOptions,
  capabilityVerify,
  variant = "default",
}: {
  acc: Account;
  /** During pending setup, derive posture from local selection (avoids badge flicker on save). */
  connectionOptions?: ConnectionOptions;
  capabilityVerify?: CapabilityVerifyResults | null;
  variant?: "default" | "table";
}) {
  const connected = isAccountConnected(acc);
  const opts = connectionOptions ?? accountConnectionOptions(acc);
  const policyGenDeployed = acc.advanced_policy_generation_deployed ?? false;
  const policyGenSelected =
    (connected && acc.enable_advanced_policy_generation) ||
    (!connected && opts.enable_advanced_policy_generation);
  const remediationModules =
    (connected ? acc.remediation_modules : opts.remediation_modules) ?? DEFAULT_REMEDIATION_MODULES;
  const modulesDeployed = acc.remediation_modules_deployed ?? DEFAULT_REMEDIATION_MODULES;
  const remediationEnabled = REMEDIATION_MODULE_SPECS.filter((m) => remediationModules[m.id]);
  const ssmCollapsed = remediationBadgesCollapsed(acc, remediationModules, capabilityVerify);
  const wrapClass =
    variant === "table"
      ? "accounts-capability-badges"
      : "mt-1.5 flex min-w-0 flex-nowrap items-center gap-x-1.5";

  return (
    <div className={wrapClass}>
      <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200/60">
        Core scanner
      </span>
      {(policyGenDeployed || policyGenSelected) && (
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${
            policyGenDeployed
              ? "bg-sky-50 text-sky-800 ring-sky-200/60"
              : "bg-sky-50/50 text-sky-700 ring-sky-200/40"
          }`}
        >
          Policy gen
        </span>
      )}
      {ssmCollapsed ? (
        <span
          className={`${ssmRemediationBadgeClass} shrink-0`}
          title={remediationEnabled.map((m) => m.label).join(" · ")}
        >
          SSM remediation
        </span>
      ) : (
        remediationEnabled.map((m) => {
          const deployed = connected && modulesDeployed[m.id];
          return (
            <span
              key={m.id}
              className={`shrink-0 ${
                deployed || !connected
                  ? ssmRemediationBadgeClass
                  : "rounded-full bg-amber-50/40 px-2.5 py-1 text-[11px] font-medium text-amber-800/70 ring-1 ring-amber-200/40"
              }`}
            >
              {m.badgeLabel}
            </span>
          );
        })
      )}
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
  const optionalCapabilities = hasOptionalCapabilities(acc);
  const [deployTab, setDeployTab] = useState<DeployTab>("cli");
  const [cliExpanded, setCliExpanded] = useState(false);
  return (
    <div className="border-t border-zinc-200/60 bg-zinc-50/40 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900">Manage capabilities</p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
            Choose optional features, then update your{" "}
            <span className="font-mono text-zinc-600">{acc.cfn_stack_name || CONNECTOR_STACK_NAME}</span>{" "}
            stack in AWS. Core is read only; policy generation reads CloudTrail and starts
            IAM policy-generation jobs (no resource changes); remediation adds scoped write.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <ConnectorTemplateBadge version={acc.cfn_template_version} />
            <span className="text-[11px] text-zinc-500">After deploy:</span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200/60">
              Core Scanner
            </span>
            {draft.enable_advanced_policy_generation && (
              <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-800 ring-1 ring-sky-200/60">
                Policy Generation
              </span>
            )}
            {allRemediationModulesEnabled(draft.remediation_modules) ? (
              <span className={ssmRemediationBadgeClass}>SSM remediation</span>
            ) : (
              REMEDIATION_MODULE_SPECS.filter((m) => draft.remediation_modules[m.id]).map((m) => (
                <span
                  key={m.id}
                  className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900 ring-1 ring-amber-200/60"
                >
                  {m.badgeLabel}
                </span>
              ))
            )}
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

        <AdvancedPolicyGenerationCard
          enabled={draft.enable_advanced_policy_generation}
          onChange={(v) => onDraftChange({ ...draft, enable_advanced_policy_generation: v })}
          verify={capabilityVerify?.advanced_policy_generation}
          deployedFallback={acc.advanced_policy_generation_deployed}
        />

        <RemediationAutomationSection
          modules={draft.remediation_modules}
          onChange={(remediation_modules) => onDraftChange({ ...draft, remediation_modules })}
          modulesDeployed={acc.remediation_modules_deployed}
          moduleVerify={capabilityVerify?.remediation_modules}
        />
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
        {acc.status === "connected" && optionalCapabilities && (
          <PermissionVerificationPanel
            onVerify={onVerifyCapabilities}
            verifying={verifyingCapabilities}
            feedback={verifyFeedback}
            verificationMeta={verificationMeta}
            showButton
          />
        )}
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
  const modulesDeployed = acc?.remediation_modules_deployed ?? DEFAULT_REMEDIATION_MODULES;
  const advancedDeployed = acc?.advanced_policy_generation_deployed ?? false;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-zinc-900">Connection mode</p>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
          Start read-only. Enable optional capabilities only when you need them.
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

      <AdvancedPolicyGenerationCard
        enabled={value.enable_advanced_policy_generation}
        onChange={(v) => onChange({ ...value, enable_advanced_policy_generation: v })}
        disabled={disabled}
        verify={capabilityVerify?.advanced_policy_generation}
        deployedFallback={advancedDeployed}
      />

      <RemediationAutomationSection
        modules={value.remediation_modules}
        onChange={(remediation_modules) => onChange({ ...value, remediation_modules })}
        disabled={disabled}
        modulesDeployed={modulesDeployed}
        moduleVerify={capabilityVerify?.remediation_modules}
      />
    </div>
  );
}

function AdvancedPolicyGenerationCard({
  enabled,
  onChange,
  disabled,
  verify,
  deployedFallback,
  compact = false,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  verify?: ModuleVerifyResult;
  deployedFallback?: boolean;
  compact?: boolean;
}) {
  const locked = capabilityLockedInAws(verify, Boolean(deployedFallback));
  const checked = locked ? true : enabled;
  const inputDisabled = disabled || locked;

  const body = (
    <>
      {locked ? (
        <CapabilityVerifiedMark />
      ) : (
        <input
          type="checkbox"
          className="mt-0.5 shrink-0 rounded border-zinc-300 text-teal-600 focus:ring-teal-500/30"
          checked={checked}
          disabled={inputDisabled}
          aria-label="Enable Advanced IAM policy generation"
          onChange={(e) => onChange(e.target.checked)}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium leading-snug text-zinc-900">Advanced IAM policy generation</p>
          <CapabilityAccessBadge kind="read-analysis" />
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
          Uses IAM Access Analyzer to generate least-privilege policy recommendations from CloudTrail and IAM
          last-accessed data.
        </p>
        {!compact && (
          <>
            {checked && (
              <div className="mt-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Required permissions
                </p>
                <div className="mt-2">
                  <RemediationPermissionsBlock
                    permissions={ADVANCED_POLICY_RAW_ACTIONS}
                    verifyRows={verify?.permissions}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );

  if (compact) {
    return (
      <label
        className={`flex items-start gap-2.5 py-4 ${
          inputDisabled && !locked ? "cursor-not-allowed opacity-60" : locked ? "cursor-default" : "cursor-pointer"
        }`}
      >
        {body}
      </label>
    );
  }

  return (
    <div
      className={`overflow-hidden rounded-lg border border-l-4 transition-colors ${
        locked
          ? "border-l-emerald-500 border-emerald-200/60 bg-emerald-50/30 shadow-sm shadow-zinc-950/[0.02]"
          : checked
            ? "border-l-teal-500 border-teal-200/60 bg-teal-50/30 shadow-sm shadow-zinc-950/[0.03]"
            : "border-l-transparent border-zinc-200/60 bg-zinc-50/30"
      } ${inputDisabled && !locked ? "opacity-60" : ""}`}
    >
      <div className="px-2.5 py-2.5">
        <div className="flex items-start gap-2.5">{body}</div>
      </div>
    </div>
  );
}

function RemediationAutomationSection({
  modules,
  onChange,
  disabled,
  modulesDeployed,
  moduleVerify,
  compact = false,
}: {
  modules: RemediationModules;
  onChange: (next: RemediationModules) => void;
  disabled?: boolean;
  modulesDeployed: RemediationModules;
  moduleVerify?: Record<string, ModuleVerifyResult>;
  compact?: boolean;
}) {
  const anyEnabled = anyRemediationEnabled(modules);
  const [sectionOpen, setSectionOpen] = useState(anyEnabled);
  const [openModuleId, setOpenModuleId] = useState<string | null>(null);

  useEffect(() => {
    if (anyEnabled) setSectionOpen(true);
  }, [anyEnabled]);

  const handleMasterToggle = (checked: boolean) => {
    if (!checked) {
      const next = { ...DEFAULT_REMEDIATION_MODULES };
      for (const spec of REMEDIATION_MODULE_SPECS) {
        const modVerify = moduleVerify?.[spec.id];
        const deployed = Boolean(modulesDeployed[spec.id]);
        if (capabilityLockedInAws(modVerify, deployed)) {
          next[spec.id] = true;
        }
      }
      onChange(next);
      if (!anyRemediationEnabled(next)) {
        setSectionOpen(false);
        setOpenModuleId(null);
      }
      return;
    }
    setSectionOpen(true);
  };

  const toggleModuleDetails = (moduleId: string) => {
    setOpenModuleId((current) => (current === moduleId ? null : moduleId));
  };

  if (compact) {
    return (
      <div className={`py-4 ${disabled ? "opacity-60" : ""}`}>
        <label className={`flex items-start gap-3 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
          <input
            type="checkbox"
            className="mt-0.5 rounded border-zinc-300 text-teal-600 focus:ring-teal-500/30"
            checked={sectionOpen}
            disabled={disabled}
            onChange={(e) => handleMasterToggle(e.target.checked)}
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-zinc-900">SSM remediation</span>
              {anyEnabled && <CapabilityAccessBadge kind="scoped-write" />}
            </span>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
              Run approved fixes through scoped automation. Enable only the modules you need.
            </p>
          </span>
        </label>
        {sectionOpen && (
          <ul className="mt-3 ml-7 space-y-2">
            {REMEDIATION_MODULE_SPECS.map((spec) => (
              <li key={spec.id}>
                {(() => {
                  const analysisOnly = !spec.runnerSupported;
                  const checked = analysisOnly ? false : modules[spec.id];
                  return (
                <label
                  className={`flex items-center gap-2 text-sm ${
                    disabled || analysisOnly ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="rounded border-zinc-300 text-teal-600 focus:ring-teal-500/30"
                    checked={checked}
                    disabled={disabled || analysisOnly}
                    onChange={(e) => onChange({ ...modules, [spec.id]: e.target.checked })}
                  />
                  <span className="text-zinc-800">{spec.label}</span>
                  {analysisOnly && (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">
                      Analysis only
                    </span>
                  )}
                </label>
                  );
                })()}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 transition-colors ${
        sectionOpen ? "border-zinc-200/80 bg-zinc-50/40" : "border-zinc-200/60 bg-white"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <label className={`flex items-start gap-3 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
        <input
          type="checkbox"
          className="mt-0.5 rounded border-zinc-300 text-teal-600 focus:ring-teal-500/30"
          checked={sectionOpen}
          disabled={disabled}
          onChange={(e) => handleMasterToggle(e.target.checked)}
        />
        <span className="min-w-0 flex-1">
          <span className="text-sm font-medium text-zinc-900">SSM remediation</span>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            Approved fixes run via SSM Automation under your VeritrailRemediationRole. Each module adds scoped
            permissions only.
          </p>
        </span>
      </label>

      {sectionOpen && (
        <div className="mt-3 ml-7 space-y-2">
          {REMEDIATION_MODULE_SPECS.map((spec) => {
            const selected = modules[spec.id];
            const detailsOpen = openModuleId === spec.id;
            const verify = moduleVerify?.[spec.id];
            const deployed = Boolean(modulesDeployed[spec.id]);
            const locked = capabilityLockedInAws(verify, deployed);
            const analysisOnly = !spec.runnerSupported;
            const moduleChecked = locked ? true : analysisOnly ? false : selected;
            const moduleDisabled = disabled || locked || analysisOnly;

            return (
              <div
                key={spec.id}
                className={`overflow-hidden rounded-lg border border-l-4 transition-colors ${
                  locked
                    ? "border-l-emerald-500 border-emerald-200/60 bg-emerald-50/30 shadow-sm shadow-zinc-950/[0.02]"
                    : moduleChecked
                      ? "border-l-teal-500 border-teal-200/60 bg-teal-50/30 shadow-sm shadow-zinc-950/[0.04]"
                      : "border-l-transparent border-zinc-200/50 bg-zinc-50/25 opacity-80"
                }`}
              >
                <div className="flex items-start gap-2.5 px-2.5 py-2.5">
                  {locked ? (
                    <CapabilityVerifiedMark />
                  ) : (
                    <input
                      type="checkbox"
                      className="mt-0.5 shrink-0 rounded border-zinc-300 text-teal-600 focus:ring-teal-500/30"
                      checked={moduleChecked}
                      disabled={moduleDisabled}
                      aria-label={`Enable ${spec.label}`}
                      onChange={(e) =>
                        onChange({ ...modules, [spec.id]: e.target.checked })
                      }
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium leading-snug text-zinc-900">{spec.label}</p>
                          {analysisOnly ? (
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">
                              Analysis only
                            </span>
                          ) : (
                            <CapabilityAccessBadge kind="scoped-write" />
                          )}
                        </div>
                        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{spec.summary}</p>
                      </div>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => toggleModuleDetails(spec.id)}
                        className="-mr-0.5 shrink-0 rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-50"
                        aria-expanded={detailsOpen}
                        aria-label={detailsOpen ? `Hide ${spec.label} details` : `Show ${spec.label} details`}
                      >
                        <RemediationModuleChevron open={detailsOpen} />
                      </button>
                    </div>
                  </div>
                </div>

                {detailsOpen && (
                  <div className="space-y-4 border-t border-zinc-100 bg-zinc-50/50 px-3 py-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        What Veritrail can do
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {spec.bullets.map((b) => (
                          <li key={b} className="flex gap-1.5 text-xs leading-snug text-zinc-600">
                            <span className="text-zinc-400" aria-hidden>
                              •
                            </span>
                            {b}
                          </li>
                        ))}
                      </ul>
                      {spec.runnerSupported && verify?.runner_ready === false && (
                        <p className="mt-2 text-[11px] leading-relaxed font-medium text-amber-800">
                          SSM document not ready. Use{" "}
                          <span className="font-semibold">Manage capabilities → Update CloudFormation</span>{" "}
                          on stack{" "}
                          <span className="font-mono">{CONNECTOR_STACK_NAME}</span> with this module
                          enabled — not a blank stack update with only the SSM YAML.
                        </p>
                      )}
                    </div>

                    {!analysisOnly && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                          Permissions added to VeritrailRemediationRole
                        </p>
                        <div className="mt-2">
                          <RemediationPermissionsBlock
                            permissions={spec.permissions}
                            verifyRows={verify?.permissions}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
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
  const remediationSelected = anyRemediationEnabled(connectionOptions.remediation_modules);
  const selectedRemediationStatements = REMEDIATION_MODULE_SPECS.filter(
    (spec) => connectionOptions.remediation_modules[spec.id],
  ).map((spec) => REMEDIATION_MODULE_STATEMENTS[spec.id]);
  const scannerStatements = [
    ...CORE_SCANNER_STATEMENTS,
    ...(connectionOptions.enable_advanced_policy_generation ? ADVANCED_POLICY_STATEMENTS : []),
    ...(remediationSelected ? REMEDIATION_START_STATEMENTS : []),
  ];
  const roleBlocks = [
    `data "aws_iam_policy_document" "veritrail_core_scanner_role_trust" {\n  statement {\n    sid     = "AllowVeritrailAssumeRole"\n    effect  = "Allow"\n    actions = ["sts:AssumeRole"]\n\n    principals {\n      type        = "AWS"\n      identifiers = [var.veritrail_principal_arn]\n    }\n\n    condition {\n      test     = "StringEquals"\n      variable = "sts:ExternalId"\n      values   = [var.external_id]\n    }\n  }\n\n  statement {\n    sid     = "AllowVeritrailRoleChainingContext"\n    effect  = "Allow"\n    actions = ["sts:SetSourceIdentity", "sts:TagSession"]\n\n    principals {\n      type        = "AWS"\n      identifiers = [var.veritrail_principal_arn]\n    }\n  }\n}\n\ndata "aws_iam_policy_document" "veritrail_core_scanner_role_policy" {\n${terraformPolicyDocumentForStatements(scannerStatements, {
      PassAccessAnalyzerMonitorRole: "aws_iam_role.veritrail_core_scanner_role.arn",
      PassRemediationAutomationRole: "aws_iam_role.veritrail_remediation_automation_role.arn",
    })}\n}\n\nresource "aws_iam_role" "veritrail_core_scanner_role" {\n  name = var.veritrail_core_scanner_role_name\n\n  assume_role_policy = data.aws_iam_policy_document.veritrail_core_scanner_role_trust.json\n\n  tags = merge(var.tags, {\n    Name        = var.veritrail_core_scanner_role_name\n    ManagedBy   = "Terraform"\n    Application = "Veritrail"\n  })\n}\n\nresource "aws_iam_role_policy" "veritrail_core_scanner_role" {\n  name   = "VeritrailScannerAccess"\n  role   = aws_iam_role.veritrail_core_scanner_role.id\n  policy = data.aws_iam_policy_document.veritrail_core_scanner_role_policy.json\n}`,
    ...(remediationSelected
      ? [
          `data "aws_iam_policy_document" "veritrail_remediation_automation_role_trust" {\n  statement {\n    sid     = "AllowSsmAutomationAssumeRole"\n    effect  = "Allow"\n    actions = ["sts:AssumeRole"]\n\n    principals {\n      type        = "Service"\n      identifiers = ["ssm.amazonaws.com"]\n    }\n  }\n}\n\ndata "aws_iam_policy_document" "veritrail_remediation_automation_role_policy" {\n${terraformPolicyDocumentForStatements([
            { sid: "SsmHandlerScriptsFromS3", actions: ["s3:GetObject"], resource: "Veritrail-hosted SSM handler scripts" },
            ...selectedRemediationStatements,
          ])}\n}\n\nresource "aws_iam_role" "veritrail_remediation_automation_role" {\n  name = var.veritrail_remediation_automation_role_name\n\n  assume_role_policy = data.aws_iam_policy_document.veritrail_remediation_automation_role_trust.json\n\n  tags = merge(var.tags, {\n    Name        = var.veritrail_remediation_automation_role_name\n    ManagedBy   = "Terraform"\n    Application = "Veritrail"\n  })\n}\n\nresource "aws_iam_role_policy" "veritrail_remediation_automation_role" {\n  name   = "VeritrailRemediationAutomation"\n  role   = aws_iam_role.veritrail_remediation_automation_role.id\n  policy = data.aws_iam_policy_document.veritrail_remediation_automation_role_policy.json\n}`,
        ]
      : []),
  ].join("\n\n");
  const outputs = [
    `output "veritrail_core_scanner_role_arn" {\n  description = "ARN of the Veritrail core scanner role. Paste this back into Veritrail during verification."\n  value       = aws_iam_role.veritrail_core_scanner_role.arn\n}`,
    ...(remediationSelected
      ? [
          `output "veritrail_remediation_automation_role_arn" {\n  description = "ARN of the optional Veritrail remediation automation role."\n  value       = aws_iam_role.veritrail_remediation_automation_role.arn\n}`,
        ]
      : []),
  ].join("\n\n");

  return `terraform {\n  required_version = ">= 1.5.0"\n\n  required_providers {\n    aws = {\n      source  = "hashicorp/aws"\n      version = ">= 5.0"\n    }\n  }\n}\n\nprovider "aws" {\n  region = var.aws_region\n}\n\nvariable "aws_region" {\n  description = "AWS region used by the AWS provider. IAM roles are global, but the provider still requires a region."\n  type        = string\n  default     = "us-east-1"\n}\n\nvariable "external_id" {\n  description = "External ID generated by Veritrail for this account connection."\n  type        = string\n  default     = ${hclString(acc.external_id)}\n}\n\n${veritrailPrincipalArnVar}\n\nvariable "veritrail_core_scanner_role_name" {\n  description = "Name of the Veritrail read-only scanner role."\n  type        = string\n  default     = ${hclString(SCANNER_ROLE_NAME)}\n}\n${
    remediationSelected
      ? `\nvariable "veritrail_remediation_automation_role_name" {\n  description = "Name of the optional Veritrail remediation automation role."\n  type        = string\n  default     = "VeritrailRemediationAutomationRole"\n}\n\nvariable "veritrail_ssm_handler_scripts_arn" {\n  description = "S3 object ARN pattern for Veritrail-hosted SSM automation handler scripts."\n  type        = string\n  default     = "arn:aws:s3:::veritrail-automation-*/*"\n}\n`
      : ""
  }\nvariable "tags" {\n  description = "Tags applied to IAM roles."\n  type        = map(string)\n  default = {\n    ManagedBy = "Terraform"\n    Vendor    = "Veritrail"\n  }\n}\n\n${roleBlocks}\n\n${outputs}\n`;
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

const DEPLOY_METHOD_ICON: Record<DeployTab, string> = {
  console: "/deploy-methods/console.png",
  cli: "/deploy-methods/cli.png",
  terraform: "/deploy-methods/terraform.png",
};

const DEPLOY_METHOD_COPY: Record<
  DeployTab,
  {
    deployDescription: string;
    whatHappensNext: readonly [string, string, string];
    consoleLaunchLabel: string;
  }
> = {
  console: {
    deployDescription: "Launch the CloudFormation stack with the selected roles in the AWS Console.",
    whatHappensNext: [
      "CloudFormation stack is created in your AWS account",
      "IAM roles are provisioned with the selected permissions",
      "Continue with the RoleArn output to connect Veritrail",
    ],
    consoleLaunchLabel: "Launch CloudFormation",
  },
  cli: {
    deployDescription: "Deploy the connector using the AWS CLI and the template parameters below.",
    whatHappensNext: [
      "CLI creates or updates the CloudFormation stack",
      "IAM roles are provisioned with the selected permissions",
      "Continue with the RoleArn output to connect Veritrail",
    ],
    consoleLaunchLabel: "Launch CloudFormation",
  },
  terraform: {
    deployDescription: "Apply the Terraform module to provision IAM roles in your AWS account.",
    whatHappensNext: [
      "Terraform creates IAM roles with external ID trust",
      "Role outputs include the scanner RoleArn for verification",
      "Continue with the RoleArn output to connect Veritrail",
    ],
    consoleLaunchLabel: "Launch CloudFormation",
  },
};

const ONBOARDING_FLOW_STEPS = [
  { n: 1, label: "Choose capabilities" },
  { n: 2, label: "Review access" },
  { n: 3, label: "Connect account" },
] as const;

/** Map in-card wizard step → top stepper (Choose capabilities / Deploy / Verify). */
function wizardStepToFlowProgress(
  wizardStep: number,
  capabilitiesChosenExternally: boolean,
): 1 | 2 | 3 {
  if (capabilitiesChosenExternally) {
    // Capabilities picked on the empty-state page; wizard starts at deploy.
    if (wizardStep <= 1) return 2;
    return 3;
  }
  // Add-account flow: capabilities → deploy → verify inside the card.
  if (wizardStep <= 1) return 1;
  if (wizardStep === 2) return 2;
  return 3;
}

function DisclosureLink({
  open,
  onToggle,
  openLabel,
  closeLabel,
  disabled,
  className = "ml-7 mt-1.5",
  children,
}: {
  open: boolean;
  onToggle: () => void;
  openLabel: string;
  closeLabel: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className="text-xs font-semibold text-teal-700 hover:text-teal-800 disabled:opacity-50"
        aria-expanded={open}
      >
        {open ? closeLabel : openLabel}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

function OnboardingFlowProgress({
  activeStep,
  onStepClick,
}: {
  activeStep: 1 | 2 | 3;
  onStepClick?: (step: 1 | 2 | 3) => void;
}) {
  return (
    <ol className="flex items-center gap-3">
      {ONBOARDING_FLOW_STEPS.map((step, i) => {
        const active = activeStep === step.n;
        const done = activeStep > step.n;
        const content = (
          <>
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                active
                  ? "bg-teal-600 text-white"
                  : done
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-zinc-100 text-zinc-400"
              }`}
            >
              {done ? (
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                step.n
              )}
            </span>
            <span
              className={`hidden text-sm font-medium sm:inline ${
                active ? "text-zinc-900" : done ? "text-zinc-600" : "text-zinc-400"
              }`}
            >
              {step.label}
            </span>
          </>
        );
        return (
          <li key={step.n} className="flex flex-1 items-center gap-3 last:flex-none">
            {onStepClick ? (
              <button
                type="button"
                onClick={() => onStepClick(step.n)}
                className="accounts-flow-step"
                aria-current={active ? "step" : undefined}
              >
                {content}
              </button>
            ) : (
              <div className="accounts-flow-step">{content}</div>
            )}
            {i < ONBOARDING_FLOW_STEPS.length - 1 && <span className="h-px flex-1 bg-zinc-200" />}
          </li>
        );
      })}
    </ol>
  );
}

const ONBOARDING_CAPS = [
  {
    id: "core" as const,
    title: "Core scan",
    blurb: "Continuously scan for security and compliance issues.",
    icon: "M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607Z",
    tone: "teal" as const,
    badge: { label: "Required", tone: "teal" as const },
    required: true,
    roleName: "VeritrailCoreScanRole",
    drawerLabel: "ReadOnly",
    accessType: "Read-only" as const,
  },
  {
    id: "iam" as const,
    title: "IAM analysis",
    blurb: "Analyze IAM permissions and generate least-privilege recommendations.",
    icon: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125Z",
    tone: "blue" as const,
    badge: { label: "Optional", tone: "slate" as const },
    required: false,
    roleName: "VeritrailIamAnalysisRole",
    drawerLabel: "IAMAnalysis",
    accessType: "Analysis" as const,
  },
  {
    id: "ssm" as const,
    title: "Remediation",
    blurb: "Automate fixes with scoped permissions and approvals.",
    icon: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z",
    tone: "amber" as const,
    badge: { label: "Scoped write", tone: "amber" as const },
    required: false,
    roleName: "VeritrailRemediationRole",
    drawerLabel: "Remediation",
    accessType: "Scoped write" as const,
  },
] as const;

const ONBOARDING_CAP_BY_ID = Object.fromEntries(ONBOARDING_CAPS.map((c) => [c.id, c])) as Record<
  (typeof ONBOARDING_CAPS)[number]["id"],
  (typeof ONBOARDING_CAPS)[number]
>;

function OnboardingCapIcon({
  cap,
  className,
  strokeWidth = 1.6,
  title,
}: {
  cap: (typeof ONBOARDING_CAPS)[number];
  className?: string;
  strokeWidth?: number;
  title?: string;
}) {
  return (
    <span className={className} title={title} aria-hidden={title ? undefined : true}>
      <svg fill="none" stroke="currentColor" strokeWidth={strokeWidth} viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d={cap.icon} />
      </svg>
    </span>
  );
}

const ONBOARDING_ROLE_PERMISSIONS: Record<(typeof ONBOARDING_CAPS)[number]["id"], string[]> = {
  core: [
    "Read AWS resource configuration",
    "Collect cloud posture evidence",
    "Run compliance and security checks",
  ],
  iam: [
    "iam:GenerateServiceLastAccessedDetails",
    "access-analyzer:StartPolicyGeneration",
    "access-analyzer:GetGeneratedPolicy",
  ],
  ssm: [
    "Run approved SSM Automation documents",
    "Apply selected remediation modules only",
    "Write scoped fixes after approval",
  ],
};

function onboardingCapIsOn(value: ConnectionOptions, id: (typeof ONBOARDING_CAPS)[number]["id"]) {
  const ssmOn = anyRemediationEnabled(value.remediation_modules);
  return id === "core" ? true : id === "iam" ? value.enable_advanced_policy_generation : ssmOn;
}

function selectedOnboardingCaps(value: ConnectionOptions) {
  return ONBOARDING_CAPS.filter((c) => onboardingCapIsOn(value, c.id));
}

type PolicyStatementSummary = {
  sid: string;
  actions: readonly string[];
  resource: string;
  grantedOn?: string;
};

type OnboardingPermissionSummary = {
  id: (typeof ONBOARDING_CAPS)[number]["id"];
  cap: (typeof ONBOARDING_CAPS)[number];
  roleName: string;
  policyName: string;
  statements: readonly PolicyStatementSummary[];
  scope: string;
  description: string;
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

const ADVANCED_POLICY_STATEMENTS: readonly PolicyStatementSummary[] = [
  {
    sid: "AccessAnalyzerPolicyGeneration",
    actions: ADVANCED_POLICY_RAW_ACTIONS.filter((action) => action !== "iam:PassRole"),
    resource: "*",
  },
  {
    sid: "PassAccessAnalyzerMonitorRole",
    actions: ["iam:PassRole"],
    resource: "Access Analyzer monitor role ARN",
  },
] as const;

const REMEDIATION_START_STATEMENTS: readonly PolicyStatementSummary[] = [
  {
    sid: "DescribeApprovedSsmDocuments",
    actions: ["ssm:DescribeDocument", "ssm:GetDocument"],
    resource: "Veritrail and AWS remediation documents",
    grantedOn: SCANNER_ROLE_NAME,
  },
  {
    sid: "StartApprovedSsmAutomation",
    actions: ["ssm:StartAutomationExecution", "ssm:GetAutomationExecution", "ssm:DescribeAutomationExecutions"],
    resource: "Approved SSM automation documents and executions",
    grantedOn: SCANNER_ROLE_NAME,
  },
  {
    sid: "PassRemediationAutomationRole",
    actions: ["iam:PassRole"],
    resource: "VeritrailRemediationAutomationRole, passed only to ssm.amazonaws.com",
    grantedOn: SCANNER_ROLE_NAME,
  },
] as const;

const REMEDIATION_MODULE_STATEMENTS: Record<RemediationModuleId, PolicyStatementSummary> = {
  security_groups: {
    sid: "Ec2SecurityGroupIngress",
    actions: ["ec2:DescribeSecurityGroups", "ec2:DescribeSecurityGroupRules", "ec2:RevokeSecurityGroupIngress"],
    resource: "*",
  },
  s3_public_access: {
    sid: "S3BucketPublicAccessBlock",
    actions: ["s3:GetBucketPublicAccessBlock", "s3:PutBucketPublicAccessBlock"],
    resource: "arn:aws:s3:::*",
  },
  iam_access_keys: {
    sid: "IamAccessKeyRemediation",
    actions: ["iam:UpdateAccessKey", "iam:GetAccessKeyLastUsed"],
    resource: "*",
  },
  iam_policies: {
    sid: "IamPolicyRemediation",
    actions: ["iam:GetRole", "iam:GetRolePolicy", "iam:PutRolePolicy", "iam:ListAttachedRolePolicies", "iam:DetachRolePolicy", "iam:GetPolicy"],
    resource: "*",
  },
  ssm_parameters: {
    sid: "SsmParameterSecureStringMigration",
    actions: ["ssm:GetParameter", "ssm:PutParameter"],
    resource: "*",
  },
  cloudtrail_logging: {
    sid: "CloudTrailRunbook",
    actions: ["cloudtrail:UpdateTrail", "cloudtrail:StartLogging"],
    resource: "*",
  },
  kms_rotation: {
    sid: "KmsKeyRotation",
    actions: ["kms:EnableKeyRotation", "kms:GetKeyRotationStatus", "kms:DescribeKey"],
    resource: "*",
  },
};

function uniqueActionCount(statements: readonly PolicyStatementSummary[]): number {
  return new Set(statements.flatMap((statement) => statement.actions)).size;
}

function reviewRoleTitle(summary: OnboardingPermissionSummary): string {
  if (summary.id === "core") return "Core Scanner Role";
  if (summary.id === "iam") return "IAM Analysis Role";
  return "Remediation Automation Role";
}

function policyJsonForSummary(summary: OnboardingPermissionSummary): string {
  return JSON.stringify(
    {
      Version: "2012-10-17",
      Statement: summary.statements.map((statement) => ({
        Sid: statement.sid,
        Effect: "Allow",
        Action: statement.actions.length === 1 ? statement.actions[0] : statement.actions,
        Resource: statement.resource,
        ...(statement.sid === "PassRemediationAutomationRole"
          ? { Condition: { StringEquals: { "iam:PassedToService": "ssm.amazonaws.com" } } }
          : {}),
        ...(statement.sid === "PassAccessAnalyzerMonitorRole"
          ? { Condition: { StringEquals: { "iam:PassedToService": "access-analyzer.amazonaws.com" } } }
          : {}),
      })),
    },
    null,
    2,
  );
}

function buildPermissionSummaries(value: ConnectionOptions): OnboardingPermissionSummary[] {
  const caps = Object.fromEntries(ONBOARDING_CAPS.map((cap) => [cap.id, cap])) as Record<
    (typeof ONBOARDING_CAPS)[number]["id"],
    (typeof ONBOARDING_CAPS)[number]
  >;
  const summaries: OnboardingPermissionSummary[] = [
    {
      id: "core",
      cap: caps.core,
      roleName: SCANNER_ROLE_NAME,
      policyName: "VeritrailMinimalReadOnly",
      statements: CORE_SCANNER_STATEMENTS,
      scope: "Account-wide read-only",
      description: "Core scanner role created by veritrail-core-scanner.yaml.",
    },
  ];

  if (value.enable_advanced_policy_generation) {
    summaries.push({
      id: "iam",
      cap: caps.iam,
      roleName: SCANNER_ROLE_NAME,
      policyName: "VeritrailAdvancedPolicyGeneration",
      statements: ADVANCED_POLICY_STATEMENTS,
      scope: "IAM and Access Analyzer analysis",
      description: "Optional inline policy on the scanner role; it does not modify customer resources.",
    });
  }

  if (anyRemediationEnabled(value.remediation_modules)) {
    const selectedModuleStatements = REMEDIATION_MODULE_SPECS.filter(
      (spec) => value.remediation_modules[spec.id],
    ).map((spec) => REMEDIATION_MODULE_STATEMENTS[spec.id]);
    summaries.push({
      id: "ssm",
      cap: caps.ssm,
      roleName: "VeritrailRemediationAutomationRole",
      policyName: "VeritrailRemediationAutomation",
      statements: [
        ...REMEDIATION_START_STATEMENTS,
        { sid: "SsmHandlerScriptsFromS3", actions: ["s3:GetObject"], resource: "Veritrail-hosted SSM handler scripts" },
        ...selectedModuleStatements,
      ],
      scope: "Selected remediation modules",
      description: "Remediation includes scanner-role permissions to start approved SSM automation plus automation-role permissions to run the selected fixes.",
    });
  }

  return summaries;
}

/** Onboarding step 1 — capability cards with role mapping (mock: choose capabilities). */
function OnboardingCapabilityCards({
  value,
  onChange,
  disabled,
}: {
  value: ConnectionOptions;
  onChange: (next: ConnectionOptions) => void;
  disabled?: boolean;
}) {
  const ssmOn = anyRemediationEnabled(value.remediation_modules);
  const allModulesOn = Object.fromEntries(
    Object.keys(DEFAULT_REMEDIATION_MODULES).map((k) => [k, true]),
  ) as RemediationModules;

  const toggle = (id: (typeof ONBOARDING_CAPS)[number]["id"]) => {
    if (id === "iam") {
      onChange({ ...value, enable_advanced_policy_generation: !value.enable_advanced_policy_generation });
    } else if (id === "ssm") {
      onChange({ ...value, remediation_modules: ssmOn ? { ...DEFAULT_REMEDIATION_MODULES } : allModulesOn });
    }
  };

  return (
    <div className="accounts-cap-grid">
      {ONBOARDING_CAPS.map((c) => {
        const on = onboardingCapIsOn(value, c.id);
        return (
          <button
            key={c.id}
            type="button"
            onClick={c.required ? undefined : () => toggle(c.id)}
            disabled={disabled || c.required}
            aria-pressed={on}
            className={`accounts-cap-card accounts-cap-card--${c.tone}${on ? " is-selected" : ""}${c.required ? " is-required" : ""}`}
          >
            <span
              className={`accounts-cap-card__check accounts-cap-card__check--${c.tone}${
                on ? " is-checked" : ""
              }`}
              aria-hidden
            >
              {on ? (
                <svg fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : null}
            </span>

            <span className={`accounts-cap-card__icon-ring accounts-cap-card__icon-ring--${c.tone}`}>
              <svg className="accounts-cap-card__icon" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d={c.icon} />
              </svg>
            </span>
            <span className="accounts-cap-card__title">{c.title}</span>
            <span className={`accounts-cap-card__badge accounts-cap-card__badge--${c.badge.tone}`}>
              {c.badge.label}
            </span>
            <p className="accounts-cap-card__blurb">{c.blurb}</p>
          </button>
        );
      })}
    </div>
  );
}

function useOnboardingEscapeDismiss(onDismiss: (() => void) | undefined) {
  useEffect(() => {
    if (!onDismiss) return;
    const dismiss = onDismiss;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);
}

function containCodeBlockWheel(event: WheelEvent<HTMLElement>) {
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
    event.stopPropagation();
  }
}

function ConnectShellHeader({
  title,
  subtitle,
  className,
}: {
  title: string;
  subtitle: string;
  className?: string;
}) {
  return (
    <div className={`accounts-connect-shell__header${className ? ` ${className}` : ""}`}>
      <h2 className="accounts-connect-shell__title">{title}</h2>
      <p className="accounts-connect-shell__subtitle">{subtitle}</p>
    </div>
  );
}

function AccountOnboardingOverlay({
  onDismiss,
  children,
  ariaLabelledBy,
}: {
  onDismiss: () => void;
  children: ReactNode;
  ariaLabelledBy?: string;
}) {
  useOnboardingEscapeDismiss(onDismiss);
  const backdropPressedRef = useRef(false);

  return createPortal(
    <div
      className="accounts-onboarding-modal"
      role="presentation"
      onMouseDown={(e) => {
        backdropPressedRef.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (backdropPressedRef.current && e.target === e.currentTarget) {
          onDismiss();
        }
        backdropPressedRef.current = false;
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        className="accounts-onboarding-modal__panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

function FirstAccountOnboarding({
  value,
  onChange,
  disabled,
  onContinue,
  continuing,
  onDismiss,
}: {
  value: ConnectionOptions;
  onChange: (next: ConnectionOptions) => void;
  disabled?: boolean;
  onContinue: () => void;
  continuing: boolean;
  onDismiss?: () => void;
}) {
  const selected = selectedOnboardingCaps(value);
  const accessTypes = [...new Set(selected.map((c) => c.accessType))];

  return (
    <div className="accounts-connect-shell">
      <div className="accounts-connect-shell__progress" aria-label="Setup progress">
        <OnboardingFlowProgress activeStep={1} />
      </div>

      <div className="accounts-connect-shell__layout">
        <div className="accounts-connect-shell__main">
          <ConnectShellHeader
            title="Connect a cloud account"
            subtitle="Choose the capabilities to enable for this connection."
          />

          <OnboardingCapabilityCards value={value} onChange={onChange} disabled={disabled} />

          <div className="accounts-connect-shell__footer">
            <div className="accounts-connect-shell__footer-stats">
              <div className="accounts-connect-shell__footer-stat">
                <p className="accounts-connect-shell__footer-label">Selected capabilities</p>
                <div className="accounts-connect-shell__cap-icons">
                  {selected.map((c) => (
                    <OnboardingCapIcon
                      key={c.id}
                      cap={c}
                      className={`accounts-connect-shell__cap-icon accounts-connect-shell__cap-icon--${c.tone}`}
                      title={c.title}
                    />
                  ))}
                </div>
              </div>
              <div className="accounts-connect-shell__footer-stat">
                <p className="accounts-connect-shell__footer-label">Roles to be created</p>
                <p className="accounts-connect-shell__footer-value">
                  {selected.length} IAM role{selected.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="accounts-connect-shell__footer-stat">
                <p className="accounts-connect-shell__footer-label">Access model</p>
                <div className="accounts-connect-shell__footer-badges">
                  {accessTypes.map((t) => (
                    <span
                      key={t}
                      className={`accounts-connect-shell__footer-badge${
                        t === "Scoped write"
                          ? " accounts-connect-shell__footer-badge--amber"
                          : t === "Analysis"
                            ? " accounts-connect-shell__footer-badge--blue"
                            : ""
                      }`}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="accounts-connect-shell__footer-cta">
              {onDismiss ? (
                <button
                  type="button"
                  onClick={onDismiss}
                  disabled={disabled || continuing}
                  className="accounts-connect-shell__cancel"
                >
                  Cancel
                </button>
              ) : null}
              <button
                type="button"
                onClick={onContinue}
                disabled={disabled || continuing}
                className="accounts-connect-shell__cta"
              >
                {continuing ? "Setting up…" : "Continue"}
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OnboardingRoleReview({
  acc,
  value,
}: {
  acc: Account;
  value: ConnectionOptions;
}) {
  const summaries = buildPermissionSummaries(value);
  const [activeRole, setActiveRole] = useState(summaries[0]?.id ?? "core");
  const [jsonCopied, setJsonCopied] = useState(false);
  const accountId = acc.account_id || "YOUR_AWS_ACCOUNT_ID";
  const activeSummary = summaries.find((summary) => summary.id === activeRole) ?? summaries[0];

  useEffect(() => {
    if (!summaries.some((summary) => summary.id === activeRole)) {
      setActiveRole(summaries[0]?.id ?? "core");
    }
  }, [activeRole, summaries]);

  async function copyPolicyJson() {
    if (!activeSummary) return;
    await navigator.clipboard.writeText(policyJsonForSummary(activeSummary));
    setJsonCopied(true);
    window.setTimeout(() => setJsonCopied(false), 1600);
  }

  if (!activeSummary) return null;

  return (
    <div className="accounts-review-clean">
      <div className="accounts-review-clean__roles">
        <div className="accounts-review-summary">
          <span className="accounts-review-summary__count">
            {summaries.length} role{summaries.length === 1 ? "" : "s"} will be created
          </span>
        </div>

        <div className="accounts-role-rows">
          {summaries.map((summary) => {
            const actionCount = uniqueActionCount(summary.statements);
            return (
              <button
                key={summary.id}
                type="button"
                onClick={() => setActiveRole(summary.id)}
                className={`accounts-role-row accounts-role-row--${summary.cap.tone}${activeSummary.id === summary.id ? " is-active" : ""}`}
              >
                <span className={`accounts-role-row__icon accounts-role-row__icon--${summary.cap.tone}`} aria-hidden>
                  <svg fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={summary.cap.icon} />
                  </svg>
                </span>
                <div className="accounts-role-row__identity">
                  <p className="accounts-role-row__name">{reviewRoleTitle(summary)}</p>
                  <span className="accounts-role-row__meta">
                    {summary.statements.length} statement{summary.statements.length === 1 ? "" : "s"} · {actionCount} action{actionCount === 1 ? "" : "s"} · {summary.scope}
                  </span>
                </div>
                <span className={`accounts-role-row__access accounts-connect-drawer__access accounts-connect-drawer__access--${summary.cap.tone}`}>
                  {summary.cap.accessType}
                </span>
                <span className="accounts-role-row__view" aria-hidden>
                  <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </span>
              </button>
            );
          })}
        </div>

      </div>

      <section className="accounts-policy-card">
        <div className="accounts-policy-card__head">
          <div>
            <div className="accounts-policy-card__title-row">
              <h3>Policy JSON</h3>
              <span className={`accounts-connect-drawer__access accounts-connect-drawer__access--${activeSummary.cap.tone}`}>
                {activeSummary.cap.accessType}
              </span>
            </div>
            <p>This is the policy document that will be provisioned for this role.</p>
          </div>
          <button type="button" className="accounts-policy-card__copy" onClick={() => void copyPolicyJson()}>
            <svg fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2m-6 12h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2Z" />
            </svg>
            {jsonCopied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="accounts-policy-json accounts-policy-json--inline">
          <code>{policyJsonForSummary(activeSummary)}</code>
        </pre>
        <div className="accounts-policy-card__foot">
          <span>
            {activeSummary.statements.length} statement{activeSummary.statements.length === 1 ? "" : "s"} · {uniqueActionCount(activeSummary.statements)} action{uniqueActionCount(activeSummary.statements) === 1 ? "" : "s"}
          </span>
        </div>
      </section>
    </div>
  );
}

function OnboardingDeployPanel({
  acc,
  connectionOptions,
  tab,
  onTabChange,
  layout = "rail",
}: {
  acc: Account;
  connectionOptions: ConnectionOptions;
  tab: DeployTab;
  onTabChange: (tab: DeployTab) => void;
  layout?: "rail" | "column";
}) {
  const column = layout === "column";
  const [cliExpanded, setCliExpanded] = useState(true);
  const [terraformExpanded, setTerraformExpanded] = useState(true);
  const { consoleUrl, cliCommand } = resolveDeployArtifacts(acc, connectionOptions, "create");
  const terraformCode = terraformForConnection(acc, connectionOptions);
  const copy = DEPLOY_METHOD_COPY[tab];

  function selectTab(next: DeployTab) {
    onTabChange(next);
    setCliExpanded(true);
    setTerraformExpanded(true);
  }

  return (
    <aside className={`accounts-deploy-rail${column ? " accounts-deploy-rail--column" : ""}`}>
      {column ? null : (
        <div className="accounts-deploy-rail__intro">
          <h3>Deploy</h3>
          <p>{copy.deployDescription}</p>
        </div>
      )}

      <div className="accounts-deploy-rail__method">
        <div className="accounts-deploy-tabs">
          {(["console", "cli", "terraform"] as DeployTab[]).map((t) => (
            <button key={t} type="button" className={tab === t ? "is-active" : ""} onClick={() => selectTab(t)}>
              <img
                src={DEPLOY_METHOD_ICON[t]}
                alt=""
                aria-hidden
                decoding="async"
                className={`accounts-deploy-tabs__icon accounts-deploy-tabs__icon--${t}`}
              />
              {t === "console" ? "Console" : t === "cli" ? "CLI" : "Terraform"}
            </button>
          ))}
        </div>
      </div>

      {column ? null : (
        <div className="accounts-deploy-rail__next">
          <p>What happens next?</p>
          <ul>
            {copy.whatHappensNext.map((item) => (
              <li key={item}>
                <svg fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="accounts-deploy-rail__action">
        <div className="accounts-deploy-rail__tab-body">
          {tab === "console" ? (
            <>
              <a href={consoleUrl} target="_blank" rel="noreferrer" className="accounts-deploy-rail__primary accounts-deploy-rail__launch">
                Launch CloudFormation
                <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H18m0 0v4.5M18 6l-7.5 7.5M6 18h12" />
                </svg>
              </a>
              {column ? (
                <p className="accounts-deploy-rail__lock-note">
                  <svg fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 0h10.5a2.25 2.25 0 0 1 2.25 2.25v6.75a2.25 2.25 0 0 1-2.25 2.25H6.75a2.25 2.25 0 0 1-2.25-2.25v-6.75a2.25 2.25 0 0 1 2.25-2.25Z" />
                  </svg>
                  Opens in a new tab. No credentials are shared with Veritrail.
                </p>
              ) : null}
            </>
          ) : tab === "cli" ? (
            <CliCodeBlock
              command={cliCommand}
              expanded={cliExpanded}
              onExpandedChange={setCliExpanded}
              compact={column}
            />
          ) : (
            <>
              <button
                type="button"
                onClick={() => downloadTerraformModule(terraformCode)}
                className="accounts-deploy-rail__primary accounts-deploy-rail__launch"
              >
                Download Terraform module
              </button>
              <TerraformCodeBlock
                code={terraformCode}
                compact={column}
                expanded={column ? true : terraformExpanded}
                onExpandedChange={setTerraformExpanded}
              />
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

/** Checklist shown in the Verify access column (step 3). Matches POST /v1/accounts/{id}/verify. */
const CONNECT_VALIDATE_ITEMS: readonly { title: string; desc: string }[] = [
  {
    title: "Trust relationship",
    desc: "Verifies Veritrail can assume the connector role.",
  },
  {
    title: "AWS account identity",
    desc: "Discovers the AWS account ID from the assumed role.",
  },
  {
    title: "Initial scan",
    desc: "Queues a scan after the account is saved.",
  },
];

type ConnectValidateItemState = "pending" | "running" | "success" | "error";

function connectValidateItemState(
  index: number,
  verify: { isPending: boolean; isSuccess: boolean; isError: boolean },
  activeIndex = 0,
): ConnectValidateItemState {
  if (verify.isPending) {
    if (index < activeIndex) return "success";
    if (index === activeIndex) return "running";
    return "pending";
  }
  if (verify.isSuccess) return "success";
  if (verify.isError) return index === 0 ? "error" : "pending";
  return "pending";
}

function PendingAccountOnboarding({
  acc,
  connectionOptions,
  roleArn,
  setRoleArn,
  verify,
  onVerifyConnection,
  onBackToCapabilities,
  onDismiss,
  embedded = false,
  initialStep = 2,
}: {
  acc: Account;
  connectionOptions: ConnectionOptions;
  roleArn: string;
  setRoleArn: (v: string) => void;
  verify: { mutate: () => void; isPending: boolean; isError: boolean; isSuccess: boolean; error: unknown };
  onVerifyConnection: () => void;
  onBackToCapabilities: () => void;
  onDismiss?: () => void;
  embedded?: boolean;
  initialStep?: number;
}) {
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(initialStep === 3 ? 3 : 2);
  const [deployTab, setDeployTab] = useState<DeployTab>("console");
  const [verifyActiveIndex, setVerifyActiveIndex] = useState(0);
  const [showVerifySuccess, setShowVerifySuccess] = useState(false);
  const roleArnValid = isValidIamRoleArn(roleArn);
  const roleArnValidation = roleArnFieldValidation(roleArn, verify);

  useEffect(() => {
    setActiveStep(initialStep === 3 ? 3 : 2);
  }, [initialStep, acc.id]);

  useEffect(() => {
    if (!verify.isPending) return;
    setShowVerifySuccess(false);
    setVerifyActiveIndex(0);
    const timers = [
      window.setTimeout(() => setVerifyActiveIndex(1), 650),
      window.setTimeout(() => setVerifyActiveIndex(2), 1350),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [verify.isPending]);

  useEffect(() => {
    if (verify.isSuccess) {
      setVerifyActiveIndex(CONNECT_VALIDATE_ITEMS.length);
      const timer = window.setTimeout(() => setShowVerifySuccess(true), 550);
      return () => window.clearTimeout(timer);
    }
    if (verify.isError) {
      setShowVerifySuccess(false);
      setVerifyActiveIndex(0);
    }
    return undefined;
  }, [verify.isSuccess, verify.isError]);

  return (
    <div className={`accounts-connect-shell${embedded ? " accounts-connect-shell--embedded" : ""}${activeStep === 2 || activeStep === 3 ? " accounts-connect-shell--deploy-review" : ""}`}>
      {showVerifySuccess && (
        <div
          className="accounts-connect-success"
          role="status"
          aria-live="polite"
        >
          <div className="accounts-connect-success__icon" aria-hidden>
            <span />
            <svg fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="accounts-connect-success__title">Connected</p>
          <p className="accounts-connect-success__copy">Initial scan started. Closing setup...</p>
        </div>
      )}
      <div className="accounts-connect-shell__progress" aria-label="Setup progress">
        <OnboardingFlowProgress
          activeStep={activeStep}
          onStepClick={(step) => {
            if (step === 1) onBackToCapabilities();
            else setActiveStep(step);
          }}
        />
      </div>

      <div className="accounts-connect-shell__layout">
        <div className="accounts-connect-shell__main">
          {activeStep === 2 ? (
            <>
              <ConnectShellHeader
                title="Review the access you're granting"
                subtitle="These are the IAM roles the connector will create in your account."
                className="accounts-connect-shell__header--verify"
              />

              <div className="accounts-review-stage accounts-review-stage--solo">
                <main className="accounts-review-stage__main">
                  <OnboardingRoleReview acc={acc} value={connectionOptions} />
                </main>
              </div>

              <div className="accounts-connect-shell__footer">
                <button type="button" onClick={onBackToCapabilities} className="accounts-connect-shell__back">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0 5-5m-5 5h12" />
                  </svg>
                  Back to capabilities
                </button>
                <div className="accounts-connect-shell__footer-cta">
                  {onDismiss ? (
                    <button type="button" onClick={onDismiss} className="accounts-connect-shell__cancel">
                      Cancel
                    </button>
                  ) : null}
                  <button type="button" onClick={() => setActiveStep(3)} className="accounts-connect-shell__cta">
                    Continue
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <ConnectShellHeader
                title="Deploy & connect"
                subtitle="Deploy the AWS connector, paste the RoleArn output, and Veritrail will verify the trust relationship before saving the account."
                className="accounts-connect-shell__header--verify"
              />

              <div className="accounts-connect-stage">
                <section className="accounts-connect-col accounts-connect-col--scroll">
                  <header className="accounts-connect-col__head">
                    <span className="accounts-connect-col__num">1</span>
                    <h3 className="accounts-connect-col__title">Deploy connector</h3>
                  </header>
                  <p className="accounts-connect-col__lede">
                    Create the IAM role in your AWS account using one of the methods below.
                  </p>
                  <OnboardingDeployPanel
                    acc={acc}
                    connectionOptions={connectionOptions}
                    tab={deployTab}
                    onTabChange={setDeployTab}
                    layout="column"
                  />
                </section>

                <section
                  className={`accounts-connect-col accounts-connect-col--trust${roleArnValid ? " accounts-connect-col--trust-ready" : ""}`}
                >
                  <header className="accounts-connect-col__head">
                    <span className="accounts-connect-col__num">2</span>
                    <h3 className="accounts-connect-col__title">Confirm trust role</h3>
                  </header>
                  <p className="accounts-connect-col__lede">
                    Use the External ID in your deployment, then paste the RoleArn from the stack output.
                  </p>
                  <div className="accounts-output-panel accounts-output-panel--trust">
                    <CopyInputField
                      variant="connect"
                      label="External ID"
                      value={acc.external_id}
                      helper="Use this value in the connector template to protect the trust relationship."
                    />
                    <CopyInputField
                      variant="connect"
                      label="RoleArn output"
                      value={roleArn}
                      readOnly={false}
                      placeholder="arn:aws:iam::123456789012:role/VeritrailConnector"
                      helper="Paste the RoleArn generated by your deployment."
                      accountId={acc.account_id}
                      onChange={setRoleArn}
                      validation={roleArnValidation}
                      formatHint="Find it in AWS: CloudFormation → Stacks → Veritrail connector → Outputs → RoleArn"
                    />
                    {verify.error ? (
                      <div className="accounts-output-panel__error" role="alert">
                        {formatApiError(verify.error)}
                      </div>
                    ) : null}
                  </div>
                </section>

                <section
                  className={`accounts-connect-col accounts-connect-col--verify${
                    !roleArnValid && !verify.isPending ? " accounts-connect-col--verify-idle" : ""
                  }${roleArnValid && !verify.isPending && !verify.isSuccess ? " accounts-connect-col--verify-ready" : ""}`}
                >
                  <header className="accounts-connect-col__head">
                    <span className="accounts-connect-col__num">3</span>
                    <h3 className="accounts-connect-col__title">Verify access</h3>
                    {verify.isSuccess || verify.isPending ? (
                      <span
                        className={`accounts-connect-col__pill${
                          verify.isSuccess
                            ? " accounts-connect-col__pill--verified"
                            : verify.isPending
                              ? " accounts-connect-col__pill--testing"
                              : ""
                        }`}
                      >
                        {verify.isSuccess ? "Verified" : "Testing..."}
                      </span>
                    ) : null}
                  </header>
                  <p className="accounts-connect-col__lede">
                    Before saving the account, Veritrail will validate:
                  </p>
                  <ul className="accounts-validate accounts-validate--timeline">
                    {CONNECT_VALIDATE_ITEMS.map((item, index) => {
                      const state = connectValidateItemState(index, verify, verifyActiveIndex);
                      return (
                        <li
                          key={item.title}
                          className={`accounts-validate__item accounts-validate__item--${state}${
                            index < CONNECT_VALIDATE_ITEMS.length - 1 ? " accounts-validate__item--has-line" : ""
                          }`}
                        >
                          <span className="accounts-validate__marker" aria-hidden>
                            {state === "running" ? (
                              <span className="accounts-validate__spinner" />
                            ) : state === "success" ? (
                              <svg fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            ) : state === "error" ? (
                              <svg fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            ) : null}
                          </span>
                          <div>
                            <p className="accounts-validate__title">{item.title}</p>
                            <p className="accounts-validate__desc">{item.desc}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </div>


              <div className="accounts-connect-shell__footer accounts-connect-shell__footer--verify">
                <button type="button" onClick={() => setActiveStep(2)} className="accounts-connect-shell__back">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0 5-5m-5 5h12" />
                  </svg>
                  Back to review access
                </button>
                <div className="accounts-connect-shell__footer-cta">
                  {onDismiss ? (
                    <button
                      type="button"
                      onClick={onDismiss}
                      disabled={verify.isPending}
                      className="accounts-connect-shell__cancel"
                    >
                      Cancel
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={onVerifyConnection}
                    disabled={verify.isPending || !roleArnValid}
                    className="accounts-connect-shell__cta"
                  >
                    {verify.isPending
                      ? "Testing connection..."
                      : roleArnValid
                        ? "Verify →"
                        : "Verify"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
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


const ONBOARDING_STEPS = [
  { n: 1, title: "Deploy AWS connector", short: "Launch CloudFormation in your AWS account" },
  { n: 2, title: "Copy Role ARN", short: "From the stack Outputs tab after deploy completes" },
  { n: 3, title: "Verify Connection", short: "Paste the Role ARN to connect Veritrail" },
] as const;

function OnboardingProgress({
  activeStep,
  onStepChange,
}: {
  activeStep: number;
  onStepChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-0">
      {ONBOARDING_STEPS.map((step, i) => {
        const isActive = activeStep === step.n;
        const isPast = activeStep > step.n;
        return (
          <div key={step.n} className="flex items-center">
            <button
              type="button"
              onClick={() => onStepChange(step.n)}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition sm:px-3 ${
                isActive
                  ? "bg-white shadow-sm ring-1 ring-zinc-200/80"
                  : isPast
                    ? "opacity-70 hover:opacity-100"
                    : "opacity-45 hover:opacity-70"
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  isActive
                    ? "bg-zinc-900 text-white"
                    : isPast
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-zinc-200 text-zinc-500"
                }`}
              >
                {isPast ? (
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  step.n
                )}
              </span>
              <span
                className={`hidden text-sm font-semibold sm:inline ${
                  isActive ? "text-zinc-900" : "text-zinc-500"
                }`}
              >
                {step.title}
              </span>
            </button>
            {i < ONBOARDING_STEPS.length - 1 && (
              <svg
                className="mx-1 hidden h-4 w-4 shrink-0 text-zinc-300 sm:block"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Stop step buttons from stealing focus (and scrolling the page) on click. */
function onboardingStepPointerDown(e: React.PointerEvent) {
  e.preventDefault();
}

function InCardAccountSetupWizard({
  acc,
  connectionOptions,
  onConnectionOptionsChange,
  connectionOptionsSaving,
  roleArn,
  setRoleArn,
  verify,
  onVerifyConnection,
  initialStep = 1,
}: {
  acc: Account;
  connectionOptions: ConnectionOptions;
  onConnectionOptionsChange: (next: ConnectionOptions) => void;
  connectionOptionsSaving?: boolean;
  roleArn: string;
  setRoleArn: (v: string) => void;
  verify: { mutate: () => void; isPending: boolean; isError: boolean; isSuccess: boolean; error: unknown };
  onVerifyConnection: () => void;
  initialStep?: number;
}) {
  const [activeStep, setActiveStep] = useState(initialStep);
  const roleArnValid = isValidIamRoleArn(roleArn);
  const roleArnValidation = roleArnFieldValidation(roleArn, verify);

  return (
    <div className="bg-zinc-50/60 px-5 py-5 sm:px-6">
      <div className="mb-5">
        <h3 className="text-base font-semibold tracking-tight text-zinc-900">Cloud account setup</h3>
        <p className="mt-0.5 text-sm text-zinc-500">
          Choose capabilities, deploy the connector, then verify the scanner role.
        </p>
      </div>

      <OnboardingProgress activeStep={activeStep} onStepChange={setActiveStep} />

      <div className="mt-5 min-w-0">
        {activeStep === 1 && (
          <div className="space-y-5">
            <div>
              <p className="text-sm font-medium text-zinc-900">Deploy the scanner role</p>
              <p className="mt-0.5 text-sm text-zinc-500">{ONBOARDING_STEPS[0].short}</p>
            </div>
            <ConnectionCapabilitiesPicker
              value={connectionOptions}
              onChange={onConnectionOptionsChange}
              disabled={connectionOptionsSaving}
              acc={acc}
            />
            <DeployMethodTabs acc={acc} deployOptions={connectionOptions} />
            <DeploymentParametersCard externalId={acc.external_id} />
            <button
              type="button"
              onClick={() => setActiveStep(2)}
              className="text-sm font-semibold text-teal-700 hover:text-teal-800"
            >
              I&apos;ve deployed the stack →
            </button>
          </div>
        )}

        {activeStep === 2 && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-zinc-900">Role ARN</p>
              <p className="mt-0.5 text-sm text-zinc-500">
                CloudFormation stack → Outputs → RoleArn
              </p>
            </div>
            <CopyInputField
              label="Role ARN"
              value={roleArn}
              readOnly={false}
              accountId={acc.account_id}
              onChange={setRoleArn}
              validation={roleArnValidation}
            />
            <button
              type="button"
              onClick={() => setActiveStep(3)}
              disabled={!roleArnValid}
              className="text-sm font-semibold text-teal-700 hover:text-teal-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue →
            </button>
          </div>
        )}

        {activeStep === 3 && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-zinc-900">Verify connection</p>
              <p className="mt-0.5 text-sm text-zinc-500">{ONBOARDING_STEPS[2].short}</p>
            </div>
            <CopyInputField label="External ID" value={acc.external_id} />
            <CopyInputField
              label="Role ARN"
              value={roleArn}
              readOnly={false}
              accountId={acc.account_id}
              onChange={setRoleArn}
              validation={roleArnValidation}
            />
            <button
              type="button"
              onClick={onVerifyConnection}
              disabled={verify.isPending || !roleArnValid}
              className={workflowInlineBtn}
            >
              {verify.isPending ? "Verifying…" : "Verify connection"}
            </button>
            {verify.error ? (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {formatApiError(verify.error)}
              </div>
            ) : null}
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
  setupInitialStep = 1,
}: {
  acc: Account;
  stats: FindingStats | undefined;
  expanded: boolean;
  onToggle: () => void;
  setupInitialStep?: number;
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
    acc.enable_advanced_policy_generation,
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

  const applyConnectionOptions = (next: ConnectionOptions) => {
    const locked = enforceDeployedCapabilityLocks(acc, capabilityVerify, next);
    setSetupConnectionOptions(locked);
    setDraftCapabilities(locked);
    debouncedPatchConnection(locked);
  };

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

  const connectionOptionsDirty = () => {
    const saved = accountConnectionOptions(acc);
    return (
      setupConnectionOptions.enable_advanced_policy_generation !==
        saved.enable_advanced_policy_generation ||
      REMEDIATION_MODULE_SPECS.some(
        (m) =>
          setupConnectionOptions.remediation_modules[m.id] !== saved.remediation_modules[m.id],
      )
    );
  };

  const handleVerifyConnection = () => {
    const runVerify = () => verify.mutate();
    if (connectionOptionsDirty()) {
      patchConnection.mutate(setupConnectionOptions, { onSuccess: runVerify });
      return;
    }
    runVerify();
  };

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

      {showSetup && (
        <InCardAccountSetupWizard
          acc={acc}
          connectionOptions={setupConnectionOptions}
          onConnectionOptionsChange={applyConnectionOptions}
          connectionOptionsSaving={patchConnection.isPending}
          roleArn={roleArn}
          setRoleArn={setRoleArn}
          verify={verify}
          onVerifyConnection={handleVerifyConnection}
          initialStep={setupInitialStep}
        />
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
  if (scanStatus === "error" && lastError) return { label: "Action required", tone: "rose" };
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
}: {
  delta: number | null;
  betterWhen: BetterWhen;
}) {
  if (delta == null || delta === 0) return null;
  const improved = deltaImproved(delta, betterWhen);
  return (
    <span
      className={`accounts-detail-metric-card__change${
        improved
          ? " accounts-detail-metric-card__change--good"
          : " accounts-detail-metric-card__change--bad"
      }`}
    >
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

function SecurityScoreGaugeSvg({
  score,
  size = 96,
  stroke = 8,
}: {
  score: number;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circum = 2 * Math.PI * r;
  const fraction = Math.max(0, Math.min(100, score)) / 100;
  const dash = fraction * circum;
  const tone = securityScoreTone(score);
  const gradientId = `security-score-arc-${tone}`;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="shrink-0" aria-hidden>
      <defs>
        <linearGradient id="security-score-arc-good" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#b8e6c8" />
          <stop offset="52%" stopColor="#7ecba0" />
          <stop offset="100%" stopColor="#4f9f73" />
        </linearGradient>
        <linearGradient id="security-score-arc-fair" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#e8a86a" />
          <stop offset="48%" stopColor="#efc27a" />
          <stop offset="100%" stopColor="#fde8b0" />
        </linearGradient>
        <linearGradient id="security-score-arc-poor" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#e39a72" />
          <stop offset="50%" stopColor="#e8b07e" />
          <stop offset="100%" stopColor="#f5d9b0" />
        </linearGradient>
        <linearGradient id="security-score-arc-critical" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#efb4b4" />
          <stop offset="52%" stopColor="#df8f8f" />
          <stop offset="100%" stopColor="#c96a6a" />
        </linearGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e4e8ed" strokeWidth={stroke} />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${circum - dash}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
    </svg>
  );
}

function SecurityScoreGauge({
  score,
  hasScanned,
}: {
  score: number | null;
  hasScanned: boolean;
}) {
  const showScore = hasScanned && score != null;
  const label = showScore ? securityScoreLabel(score) : null;
  const tone = showScore ? securityScoreTone(score) : null;

  return (
    <div className="accounts-security-gauge">
      <div className="accounts-security-gauge__ring">
        {showScore ? (
          <SecurityScoreGaugeSvg score={score} />
        ) : (
          <div className="accounts-security-gauge__empty" aria-hidden />
        )}
      </div>
      <div className="accounts-security-gauge__hub">
        <span className="accounts-security-gauge__score">{showScore ? score : "—"}</span>
        {showScore && label && tone ? (
          <span className={`accounts-security-gauge__badge accounts-security-gauge__badge--${tone}`}>
            {label}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function findingsForAccountScope(
  items: Finding[] | undefined,
  accountId: string,
  isAws: boolean,
  cloud: CloudAccountRow | null,
): Finding[] {
  if (isAws) {
    return (items ?? []).filter((finding) => finding.account_id === accountId);
  }
  const externalId = cloud?.external_id ?? cloud?.id ?? accountId;
  return (items ?? []).filter((finding) => {
    if (finding.account_provider !== cloud?.provider) return false;
    if (finding.account_id === externalId || finding.account_id === accountId) return true;
    if (finding.account_label && cloud && finding.account_label.toLowerCase() === cloud.label.toLowerCase()) {
      return true;
    }
    const evidence = finding.evidence ?? {};
    if (typeof evidence.project_id === "string" && evidence.project_id === externalId) return true;
    if (typeof evidence.subscription_id === "string" && evidence.subscription_id === externalId) return true;
    return false;
  });
}

function filterOpenFindingsForAccount(
  items: Finding[] | undefined,
  accountId: string,
  isAws: boolean,
  cloud: CloudAccountRow | null,
): Finding[] {
  return findingsForAccountScope(items, accountId, isAws, cloud).filter(
    (finding) => finding.status === "open",
  );
}

function worstFindingSeverity(items: Finding[]): string {
  return items.reduce(
    (worst, f) => ((sevWeight[f.severity] ?? 9) < (sevWeight[worst] ?? 9) ? f.severity : worst),
    items[0]?.severity ?? "low",
  );
}

function uniqueFindingResourceCount(items: Finding[]): number {
  return new Set(items.map((f) => f.resource_arn).filter(Boolean)).size;
}

function buildAccountFindingGroups(items: Finding[]): Array<{ key: string; items: Finding[] }> {
  const map = new Map<string, Finding[]>();
  for (const f of items) {
    const key = findingDisplayGroupKey(f.check_id);
    map.set(key, [...(map.get(key) ?? []), f]);
  }
  return [...map.entries()]
    .sort(([, a], [, b]) => {
      const wa = worstFindingSeverity(a);
      const wb = worstFindingSeverity(b);
      return (
        (sevWeight[wa] ?? 9) - (sevWeight[wb] ?? 9) ||
        Math.max(...b.map((f) => f.risk_score)) - Math.max(...a.map((f) => f.risk_score))
      );
    })
    .map(([key, groupItems]) => ({ key, items: groupItems }));
}

function findingGroupTitle(groupKey: string, items: Finding[]): string {
  return (
    findingGroupMeta(groupKey)?.title ??
    checkLabels[groupKey] ??
    checkLabels[items[0]?.check_id ?? ""] ??
    items[0]?.title ??
    groupKey
  );
}

function riskScorePillTone(severity: string): string {
  return severity === "critical" || severity === "high"
    ? "findings-v2-risk-pill--high"
    : severity === "medium"
      ? "findings-v2-risk-pill--medium"
      : "findings-v2-risk-pill--low";
}

function RiskScorePill({ score, severity }: { score: number; severity: string }) {
  return (
    <span aria-label={`Risk score ${score}`} className={`findings-v2-risk-pill ${riskScorePillTone(severity)}`}>
      <span className="findings-v2-risk-pill__inner">{score}</span>
    </span>
  );
}

function AccountDetailFindingsTab({
  accountId,
  hasScanned,
  openCount,
  findings,
  onOpenWorkspace,
  onOpenGroup,
}: {
  accountId: string;
  hasScanned: boolean;
  openCount: number;
  findings: Finding[];
  onOpenWorkspace: () => void;
  onOpenGroup: (groupKey: string) => void;
}) {
  const groups = useMemo(() => buildAccountFindingGroups(findings), [findings]);
  const previewGroups = groups.slice(0, DETAIL_FINDINGS_GROUP_LIMIT);
  const hiddenGroupCount = Math.max(0, groups.length - previewGroups.length);

  if (!hasScanned) {
    return (
      <div className="accounts-detail-findings accounts-detail-findings--empty">
        <p className="accounts-detail-findings__empty-title">No findings yet</p>
        <p className="accounts-detail-findings__empty-body">Run a scan to populate findings for this account.</p>
      </div>
    );
  }

  if (openCount === 0) {
    return (
      <div className="accounts-detail-findings accounts-detail-findings--empty">
        <p className="accounts-detail-findings__empty-title">No open findings</p>
        <p className="accounts-detail-findings__empty-body">
          This account has a clean bill of health from the latest scan.
        </p>
        <button type="button" className="accounts-detail-findings__workspace-link" onClick={onOpenWorkspace}>
          Open Findings workspace
        </button>
      </div>
    );
  }

  return (
    <div className="accounts-detail-findings">
      <div className="accounts-detail-findings__head">
        <div
          className="findings-v2-col-head accounts-detail-findings__col-head"
          role="row"
          aria-label="Findings columns"
        >
          <span>Severity</span>
          <span>Finding</span>
          <span className="accounts-detail-findings__col-head-risk">Risk</span>
        </div>
      </div>
      <div className="accounts-detail-findings__list">
        {previewGroups.map(({ key, items }) => {
          const sev = worstFindingSeverity(items);
          const railClass =
            sev === "critical" || sev === "high" || sev === "medium" || sev === "low"
              ? `accounts-detail-finding-row--${sev}`
              : "accounts-detail-finding-row--low";
          const title = findingGroupTitle(key, items);
          const resourceCount = uniqueFindingResourceCount(items);
          const topRisk = Math.max(...items.map((f) => f.risk_score));
          return (
            <button
              key={key}
              type="button"
              className={`accounts-detail-finding-row ${railClass}`}
              onClick={() => onOpenGroup(key)}
            >
              <span className="accounts-detail-finding-row__severity-cell">
                <SeverityIndicator severity={sev} />
              </span>
              <span className="accounts-detail-finding-row__main">
                <span className="accounts-detail-finding-row__title">{title}</span>
                {resourceCount > 0 ? (
                  <span className="accounts-detail-finding-row__resources">
                    · {resourceCount} {resourceCount === 1 ? "resource" : "resources"}
                  </span>
                ) : null}
              </span>
              <RiskScorePill score={topRisk} severity={sev} />
            </button>
          );
        })}
      </div>
      {hiddenGroupCount > 0 ? (
        <div className="accounts-detail-recent-scans__footer">
          <button type="button" onClick={onOpenWorkspace}>
            View all in Findings workspace →
          </button>
        </div>
      ) : null}
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

const DETAIL_TABS: { id: DetailTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "findings", label: "Findings" },
  { id: "scans", label: "Scans" },
  { id: "resources", label: "Resources" },
  { id: "settings", label: "Settings" },
];

function DetailTabStub({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="accounts-detail-tab-stub">
      <p className="accounts-detail-tab-stub__title">{title}</p>
      <p className="accounts-detail-tab-stub__body">{body}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

const ACCOUNT_SCORE_HELP =
  "Composite score based on open findings severity, evidence coverage over the last 7 days, and how recently this account was scanned.";

const SOC2_READINESS_HELP =
  "Share of mapped SOC 2 controls currently passing for this account. Higher means closer to audit readiness.";

const COVERAGE_METRIC_HELP =
  "Share of days in the last 7 days with scan or snapshot evidence. Higher means more continuous monitoring for audit readiness—not how many cloud resources were scanned.";

function AccountSplitDetailPane({
  row,
  stats,
  findingsItems,
  setupInitialStep,
  onManageSetup,
  onDismissSetup,
}: {
  row: AccountListRow;
  stats: FindingStats | undefined;
  findingsItems: Finding[] | undefined;
  setupInitialStep?: number;
  onManageSetup?: () => void;
  onDismissSetup?: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<DetailTab>("overview");

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
    acc?.enable_advanced_policy_generation,
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
      api<CloudAccountOverview>(
        `/v1/integrations/cloud-accounts/${cloud!.provider}/${accountId}/overview?period=7`,
      ),
    enabled: !isAws && connected && hasScanned,
  });

  const cloudOverviewPrevQ = useQuery({
    queryKey: ["cloud-account-overview", cloud?.provider, accountId, 7, "prev"],
    queryFn: () =>
      api<CloudAccountOverview>(
        `/v1/integrations/cloud-accounts/${cloud!.provider}/${accountId}/overview?period=7&as_of=${daysAgoIso(7)}`,
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

  const displayStats = stats ?? EMPTY_FINDING_STATS;

  const accountFindings = useMemo(
    () => filterOpenFindingsForAccount(findingsItems, accountId, isAws, cloud),
    [findingsItems, accountId, isAws, cloud],
  );

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
      ? Math.round(coverageQ.data.coverage_ratio * 100)
      : null
    : cloudOverviewQ.data != null
      ? Math.round(cloudOverviewQ.data.coverage.coverage_ratio * 100)
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
    if (!hasScanned) return null;
    return computeSecurityScore(displayStats, coveragePct, lastScanAt);
  }, [hasScanned, displayStats, coveragePct, lastScanAt]);
  const recentScans = (historyQ.data?.events ?? []).slice(0, 3);
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
  const cloudScanTabRows = useMemo(
    () =>
      buildRecentScanRows(
        false,
        hasScanned,
        lastScanAt,
        [],
        cloudScanHistoryQ.data,
        hasScanned ? resourceCount : null,
      ),
    [hasScanned, lastScanAt, cloudScanHistoryQ.data, resourceCount],
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
      const current = Math.round(coverageQ.data.coverage_ratio * 100);
      const prior = Math.round(coveragePrevQ.data.coverage_ratio * 100);
      delta = delta7d(current, prior);
    } else {
      if (cloudOverviewQ.data == null || cloudOverviewPrevQ.data == null) return null;
      const current = Math.round(cloudOverviewQ.data.coverage.coverage_ratio * 100);
      const prior = Math.round(cloudOverviewPrevQ.data.coverage.coverage_ratio * 100);
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

  const capabilityRows: {
    id: "core" | "iam" | "ssm";
    name: string;
    desc: string;
    status: "enabled" | "disabled" | "coming-soon";
  }[] = isAws
    ? [
        {
          id: "core",
          name: "Core scanner",
          desc: "Continuous security and compliance scanning",
          status: connected ? "enabled" : "disabled",
        },
        {
          id: "iam",
          name: "Policy generation",
          desc: "IAM least-privilege recommendations",
          status: acc!.enable_advanced_policy_generation ? "enabled" : "disabled",
        },
        {
          id: "ssm",
          name: "SSM remediation",
          desc: "Scoped automated fixes with approvals",
          status: anyRemediationEnabled(acc!.remediation_modules ?? DEFAULT_REMEDIATION_MODULES)
            ? "enabled"
            : "disabled",
        },
      ]
    : [
        {
          id: "core",
          name: "Core scanner",
          desc: "Continuous security and compliance scanning",
          status: connected ? "enabled" : "disabled",
        },
        {
          id: "iam",
          name: "Policy generation",
          desc: "IAM least-privilege recommendations",
          status: "coming-soon",
        },
        {
          id: "ssm",
          name: "Automated remediation",
          desc: "Scoped automated fixes with approvals",
          status: "coming-soon",
        },
      ];

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
              </div>
            ) : null}
          </div>
        </div>
        <div className="accounts-detail-pane__actions">
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
            onViewFindings={() => setTab("findings")}
            onManageConnection={() =>
              isAws
                ? setShowConnectorUpdate(true)
                : navigate(cloudIntegrationPath(cloud!.provider))
            }
            onEditAccount={() => {
              setTab("settings");
              if (isAws) setShowManageCapabilities(true);
            }}
          />
        </div>
      </div>

      <div className="accounts-detail-pane__tabs" role="tablist">
        {DETAIL_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`accounts-detail-pane__tab${tab === t.id ? " is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="accounts-detail-pane__body">
        {tab === "overview" && (
          <>
            <div className="accounts-detail-overview__metrics" aria-label="Account overview metrics">
              <div className="accounts-detail-overview__metric accounts-detail-overview__metric--security">
                <p className="accounts-detail-overview__metric-label">
                  Account score
                  <MetricHelpTip metric="Account score" text={ACCOUNT_SCORE_HELP} />
                </p>
                <div className="accounts-detail-overview__metric-body accounts-detail-overview__metric-body--gauge">
                  <SecurityScoreGauge score={securityScore} hasScanned={hasScanned} />
                </div>
                <p className="accounts-detail-overview__metric-detail">
                  {hasScanned
                    ? "Based on findings, evidence coverage, and scan recency."
                    : "Run a scan first"}
                </p>
              </div>
              <div className="accounts-detail-overview__metric">
                <p className="accounts-detail-overview__metric-label">
                  SOC 2 readiness
                  <MetricHelpTip metric="SOC 2 readiness" text={SOC2_READINESS_HELP} />
                </p>
                <div className="accounts-detail-overview__metric-value-row">
                  <p className="accounts-detail-overview__metric-value">
                    {hasScanned && compliancePct != null ? `${compliancePct}%` : "—"}
                  </p>
                  {hasScanned && compliancePct != null ? (
                    <MetricCardDelta delta={complianceDelta} betterWhen="up" />
                  ) : null}
                </div>
                {hasScanned && soc2PhaseLabel ? (
                  <p className="accounts-detail-overview__metric-phase">{soc2PhaseLabel}</p>
                ) : !hasScanned ? (
                  <p className="accounts-detail-overview__metric-detail">Run a scan first</p>
                ) : null}
                {hasScanned ? (
                  <p className="accounts-detail-overview__metric-detail">
                    {soc2CheckSummary
                      ? `${soc2CheckSummary.passed.toLocaleString()} passing · ${soc2CheckSummary.pending.toLocaleString()} pending`
                      : "Awaiting control mapping"}
                  </p>
                ) : null}
              </div>
              <div className="accounts-detail-overview__metric">
                <p className="accounts-detail-overview__metric-label">
                  Evidence coverage
                  <MetricHelpTip metric="Evidence coverage" text={COVERAGE_METRIC_HELP} />
                </p>
                <div className="accounts-detail-overview__metric-value-row">
                  <p className="accounts-detail-overview__metric-value">
                    {coveragePct != null ? `${coveragePct}%` : "—"}
                  </p>
                  {hasScanned && coveragePct != null ? (
                    <MetricCardDelta delta={coverageDelta} betterWhen="up" />
                  ) : null}
                </div>
                {hasScanned && coveragePct != null ? (
                  <div
                    className="accounts-detail-overview__progress"
                    role="progressbar"
                    aria-valuenow={coveragePct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Evidence coverage"
                  >
                    <div
                      className="accounts-detail-overview__progress-fill"
                      style={{ width: `${coveragePct}%` }}
                    />
                  </div>
                ) : null}
                <p className="accounts-detail-overview__metric-detail">
                  {hasScanned ? "Evidence window · last 7 days" : "Run a scan first"}
                </p>
              </div>
            </div>

            <div className="accounts-detail-overview__lower">
              <div className="accounts-detail-capabilities">
                <h3 className="accounts-detail-capabilities__title">Connected capabilities</h3>
                {capabilityRows.map((cap) => {
                  const onboardingCap = ONBOARDING_CAP_BY_ID[cap.id] ?? ONBOARDING_CAPS[0];
                  return (
                    <div className="accounts-detail-capability-row" key={cap.name}>
                      <OnboardingCapIcon
                        cap={onboardingCap}
                        className="accounts-detail-capability-row__icon accounts-detail-capability-row__icon--neutral"
                        title={onboardingCap.title}
                      />
                      <div className="min-w-0">
                        <p className="accounts-detail-capability-row__name">{cap.name}</p>
                        <p className="accounts-detail-capability-row__desc">{cap.desc}</p>
                      </div>
                      <span
                        className={`accounts-detail-capability-row__status accounts-detail-capability-row__status--${cap.status}`}
                      >
                        <span className="accounts-detail-capability-row__status-dot" aria-hidden />
                        {cap.status === "enabled"
                          ? "Enabled"
                          : cap.status === "coming-soon"
                            ? "Coming soon"
                            : "Off"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {recentScanRows.length > 0 ? (
              <div className="accounts-detail-recent-scans">
                <div className="accounts-detail-recent-scans__head">
                  <h3 className="accounts-detail-recent-scans__title">Recent scans</h3>
                </div>
                {recentScanRows.map((row) => (
                  <div className="accounts-detail-scan-row" key={row.key}>
                    <span className={`accounts-detail-scan-row__mark ${row.succeeded ? "is-success" : "is-failed"}`} aria-hidden>
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
                    <div>
                      <p className="accounts-detail-scan-row__when">{scanDayLabel(row.timestamp)}</p>
                      <p className="accounts-detail-scan-row__ago">{formatRelativeScanAgo(row.timestamp)}</p>
                    </div>
                    <p className="accounts-detail-scan-row__resources">
                      {scanResourcesLabel(row.resourcesScanned, hasScanned)}
                    </p>
                    {hasScanned ? (
                      <div className="accounts-detail-scan-row__findings">
                        <span className="accounts-detail-scan-row__finding accounts-detail-scan-row__finding--high">
                          <i aria-hidden />
                          <span className="accounts-detail-scan-row__finding-count">{displayStats.critHigh}</span>
                        </span>
                        <span className="accounts-detail-scan-row__finding accounts-detail-scan-row__finding--medium">
                          <i aria-hidden />
                          <span className="accounts-detail-scan-row__finding-count">{displayStats.medium}</span>
                        </span>
                        <span className="accounts-detail-scan-row__finding accounts-detail-scan-row__finding--low">
                          <i aria-hidden />
                          <span className="accounts-detail-scan-row__finding-count">{displayStats.low}</span>
                        </span>
                      </div>
                    ) : (
                      <div className="accounts-detail-scan-row__findings accounts-detail-scan-row__findings--placeholder" aria-hidden />
                    )}
                    <button
                      type="button"
                      className="accounts-detail-scan-row__view"
                      onClick={() =>
                        isAws
                          ? navigate(`/history?account_id=${accountId}`)
                          : setTab("scans")
                      }
                    >
                      View
                    </button>
                  </div>
                ))}
                {isAws ? (
                  <div className="accounts-detail-recent-scans__footer">
                    <button type="button" onClick={() => navigate(`/history?account_id=${accountId}`)}>
                      View all scans →
                    </button>
                  </div>
                ) : recentScanRows.length > 1 ? (
                  <div className="accounts-detail-recent-scans__footer">
                    <button type="button" onClick={() => setTab("scans")}>
                      View all scans →
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}

        {tab === "findings" && (
          <AccountDetailFindingsTab
            accountId={accountId}
            hasScanned={hasScanned}
            openCount={displayStats.open}
            findings={accountFindings}
            onOpenWorkspace={() => navigate(`/findings?account=${accountId}`)}
            onOpenGroup={(groupKey) =>
              navigate(`/findings?account=${accountId}&checks=${encodeURIComponent(groupKey)}`)
            }
          />
        )}

        {tab === "scans" && (
          isAws ? (
            <DetailTabStub
              title="Scan history"
              body={
                recentScans.length > 0
                  ? `${recentScans.length} recent scan${recentScans.length === 1 ? "" : "s"} in the last 30 days.`
                  : "Scan history appears after your first completed scan."
              }
              action={
                <button
                  type="button"
                  className="accounts-detail-quick-actions__primary"
                  onClick={() => navigate(`/history?account_id=${accountId}`)}
                >
                  View scan history
                </button>
              }
            />
          ) : cloudScanTabRows.length > 0 ? (
            <div className="accounts-detail-recent-scans">
              <div className="accounts-detail-recent-scans__head">
                <h3 className="accounts-detail-recent-scans__title">Scan history</h3>
              </div>
              {cloudScanTabRows.map((row) => (
                <div className="accounts-detail-scan-row" key={row.key}>
                  <span className={`accounts-detail-scan-row__mark ${row.succeeded ? "is-success" : "is-failed"}`} aria-hidden>
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
                  <div>
                    <p className="accounts-detail-scan-row__when">{scanDayLabel(row.timestamp)}</p>
                    <p className="accounts-detail-scan-row__ago">{formatRelativeScanAgo(row.timestamp)}</p>
                  </div>
                  <p className="accounts-detail-scan-row__resources">
                    {scanResourcesLabel(row.resourcesScanned, hasScanned)}
                  </p>
                  {hasScanned ? (
                    <div className="accounts-detail-scan-row__findings">
                      <span className="accounts-detail-scan-row__finding accounts-detail-scan-row__finding--high">
                        <i aria-hidden />
                        <span className="accounts-detail-scan-row__finding-count">{displayStats.critHigh}</span>
                      </span>
                      <span className="accounts-detail-scan-row__finding accounts-detail-scan-row__finding--medium">
                        <i aria-hidden />
                        <span className="accounts-detail-scan-row__finding-count">{displayStats.medium}</span>
                      </span>
                      <span className="accounts-detail-scan-row__finding accounts-detail-scan-row__finding--low">
                        <i aria-hidden />
                        <span className="accounts-detail-scan-row__finding-count">{displayStats.low}</span>
                      </span>
                    </div>
                  ) : (
                    <div className="accounts-detail-scan-row__findings accounts-detail-scan-row__findings--placeholder" aria-hidden />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <DetailTabStub
              title="On-demand scans"
              body={
                hasScanned
                  ? "Scan history appears after your first completed scan."
                  : "GCP and Azure accounts run scans on demand from this page or the integration settings."
              }
            />
          )
        )}

        {tab === "resources" && (
          <DetailTabStub
            title={`${resourceStats.resources.toLocaleString()} resources in findings`}
            body="Full resource inventory browsing is coming soon. Counts reflect resources with open findings from the latest scan."
          />
        )}

        {tab === "settings" && isAws && acc && (
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
                  {isAws && nextScanShort !== "—" ? (
                    <p className="mt-3 text-xs text-zinc-500">
                      Next scheduled scan: <span className="font-medium text-zinc-700">{nextScanShort}</span>
                    </p>
                  ) : null}
                </div>
              )
            }
          />
        )}

        {tab === "settings" && !isAws && (
          <DetailTabStub
            title="Integration settings"
            body="Manage connector credentials and scan settings in the integration page."
            action={
              <button
                type="button"
                className="accounts-detail-quick-actions__primary"
                onClick={() => navigate(cloudIntegrationPath(cloud!.provider))}
              >
                Open integration
              </button>
            }
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
  selected = false,
  splitLayout = false,
  suppressSelectionStyle = false,
  onSelect,
}: {
  cloud: CloudAccountRow;
  stats: FindingStats | undefined;
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

  const rowStatus = resolveAccountRowStatus(
    connected,
    isScanActive,
    scanStatus,
    null,
    cloud.status,
  );
  const scanError = scan.isError ? formatApiError(scan.error) : null;

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
              <FindingsMixDonutCompact stats={stats} hasScanned={hasScanned} />
              <FindingsSeverityLegend stats={stats} hasScanned={hasScanned} />
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

function AccountPremiumCard({
  acc,
  stats,
  expanded,
  onToggle,
  setupInitialStep = 1,
  selected = false,
  splitLayout = false,
  suppressSelectionStyle = false,
  onSelect,
  onContinueSetup,
}: {
  acc: Account;
  stats: FindingStats | undefined;
  expanded: boolean;
  onToggle: () => void;
  setupInitialStep?: number;
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
    acc.enable_advanced_policy_generation,
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

  const applyConnectionOptions = (next: ConnectionOptions) => {
    const locked = enforceDeployedCapabilityLocks(acc, capabilityVerify, next);
    setSetupConnectionOptions(locked);
    setDraftCapabilities(locked);
    debouncedPatchConnection(locked);
  };

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

  const connectionOptionsDirty = () => {
    const saved = accountConnectionOptions(acc);
    return (
      setupConnectionOptions.enable_advanced_policy_generation !==
        saved.enable_advanced_policy_generation ||
      REMEDIATION_MODULE_SPECS.some(
        (m) =>
          setupConnectionOptions.remediation_modules[m.id] !== saved.remediation_modules[m.id],
      )
    );
  };

  const handleVerifyConnection = () => {
    const runVerify = () => verify.mutate();
    if (connectionOptionsDirty()) {
      patchConnection.mutate(setupConnectionOptions, { onSuccess: runVerify });
      return;
    }
    runVerify();
  };

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
                <FindingsMixDonutCompact stats={stats} hasScanned={hasScanned} />
                <FindingsSeverityLegend stats={stats} hasScanned={hasScanned} />
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

            {showSetup && (
              <PendingAccountOnboarding
                acc={acc}
                connectionOptions={setupConnectionOptions}
                roleArn={roleArn}
                setRoleArn={setRoleArn}
                verify={verify}
                onVerifyConnection={handleVerifyConnection}
                onBackToCapabilities={onToggle}
                embedded
                initialStep={setupInitialStep}
              />
            )}
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

function PendingAccountSetupSurface({
  acc,
  initialStep,
  onBackToCapabilities,
  onDismiss,
  onCompleteSetup,
}: {
  acc: Account;
  initialStep: number;
  onBackToCapabilities: () => void;
  onDismiss?: () => void;
  onCompleteSetup?: () => void;
}) {
  const qc = useQueryClient();
  const [roleArn, setRoleArn] = useState("");
  const [setupConnectionOptions, setSetupConnectionOptions] = useState(() => accountConnectionOptions(acc));

  useEffect(() => {
    setSetupConnectionOptions(accountConnectionOptions(acc));
  }, [
    acc.id,
    acc.enable_advanced_policy_generation,
    acc.remediation_modules,
    acc.status,
  ]);

  const patchConnection = useMutation({
    mutationFn: (opts: ConnectionOptions) =>
      api<Account>(`/v1/accounts/${acc.id}/connection-options`, {
        method: "PATCH",
        body: JSON.stringify(opts),
      }),
    onSuccess: (updated) => {
      qc.setQueryData<Account[]>(["accounts"], (rows) =>
        rows ? rows.map((row) => (row.id === updated.id ? updated : row)) : [updated],
      );
      setSetupConnectionOptions(accountConnectionOptions(updated));
    },
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
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["accounts-plan-usage"] });
      setRoleArn("");
      if (isAccountConnected(updated)) {
        // Hold the final check state and success overlay briefly, then close the modal.
        window.setTimeout(() => onCompleteSetup?.(), 2800);
      }
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const connectionOptionsDirty = () => {
    const saved = accountConnectionOptions(acc);
    return (
      setupConnectionOptions.enable_advanced_policy_generation !==
        saved.enable_advanced_policy_generation ||
      REMEDIATION_MODULE_SPECS.some(
        (m) =>
          setupConnectionOptions.remediation_modules[m.id] !== saved.remediation_modules[m.id],
      )
    );
  };

  const handleVerifyConnection = () => {
    const runVerify = () => verify.mutate();
    if (connectionOptionsDirty()) {
      patchConnection.mutate(setupConnectionOptions, { onSuccess: runVerify });
      return;
    }
    runVerify();
  };

  return (
    <PendingAccountOnboarding
      acc={acc}
      connectionOptions={setupConnectionOptions}
      roleArn={roleArn}
      setRoleArn={setRoleArn}
      verify={verify}
      onVerifyConnection={handleVerifyConnection}
      onBackToCapabilities={onBackToCapabilities}
      onDismiss={onDismiss}
      initialStep={initialStep}
    />
  );
}

function useMatchMedia(query: string) {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export default function Accounts() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const stackedAccountsLayout = useMatchMedia("(max-width: 1439px)");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [setupInitialStep, setSetupInitialStep] = useState(1);
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [addingAwsAccount, setAddingAwsAccount] = useState(false);
  const [onboardingAccount, setOnboardingAccount] = useState<Account | null>(null);
  const [discardOnboardingAccountId, setDiscardOnboardingAccountId] = useState<string | null>(null);
  const [accountSearch, setAccountSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pendingConnectionOptions, setPendingConnectionOptions] = useState<ConnectionOptions>(
    defaultOnboardingConnectionOptions,
  );
  const [page, setPage] = useState(1);
  const pageSize = 10;

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
          enable_advanced_policy_generation: opts.enable_advanced_policy_generation,
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
      setSetupInitialStep(2);
      setExpandedId(null);
      setPendingConnectionOptions(accountConnectionOptions(acc));
    },
  });

  const patchConnection = useMutation({
    mutationFn: ({ accountId, opts }: { accountId: string; opts: ConnectionOptions }) =>
      api<Account>(`/v1/accounts/${accountId}/connection-options`, {
        method: "PATCH",
        body: JSON.stringify(opts),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
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

  const effectivePageSize = pageSize;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / effectivePageSize));
  const paginatedRows = filteredRows.slice((page - 1) * effectivePageSize, page * effectivePageSize);
  const pageStart = filteredRows.length === 0 ? 0 : (page - 1) * effectivePageSize + 1;
  const pageEnd = Math.min(page * effectivePageSize, filteredRows.length);

  const selectedRow = useMemo(
    () => (selectedRowKey ? parseAccountListRowKey(selectedRowKey, filteredRows) : null),
    [selectedRowKey, filteredRows],
  );

  useEffect(() => {
    if (filteredRows.length === 0) {
      setSelectedRowKey(null);
      return;
    }
    if (selectedRowKey && parseAccountListRowKey(selectedRowKey, filteredRows)) return;
    const preferred =
      filteredRows.find((row) =>
        row.kind === "aws" ? isAccountConnected(row.account) : isCloudAccountConnected(row.cloud),
      ) ?? filteredRows[0];
    setSelectedRowKey(accountListRowKey(preferred));
  }, [filteredRows, selectedRowKey]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

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

  const handleOnboardingContinue = () => {
    if (activeOnboardingAccount) {
      patchConnection.mutate(
        { accountId: activeOnboardingAccount.id, opts: pendingConnectionOptions },
        {
          onSuccess: (updated) => {
            setOnboardingAccount(updated);
            setSetupInitialStep(2);
            setExpandedId(null);
          },
        },
      );
      return;
    }
    if (pendingAcc && !addingAwsAccount) {
      patchConnection.mutate(
        { accountId: pendingAcc.id, opts: pendingConnectionOptions },
        {
          onSuccess: () => {
            setSetupInitialStep(2);
            setExpandedId(pendingAcc.id);
            setSelectedRowKey(accountListRowKey({ kind: "aws", account: pendingAcc }));
          },
        },
      );
      return;
    }
    create.mutate(pendingConnectionOptions);
  };

  const resetAddAccountFlow = () => {
    setAddingAwsAccount(false);
    setOnboardingAccount(null);
    setDiscardOnboardingAccountId(null);
    setSetupInitialStep(1);
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
    setSetupInitialStep(1);
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
      navigate("/integrations/gcp");
      return;
    }
    if (provider === "azure") {
      navigate("/integrations/azure");
      return;
    }
    setPendingConnectionOptions(defaultOnboardingConnectionOptions());
    setOnboardingAccount(null);
    setDiscardOnboardingAccountId(null);
    setSetupInitialStep(1);
    setAddingAwsAccount(true);
  };

  const continuingOnboarding = create.isPending || patchConnection.isPending;

  useEffect(() => {
    if (pendingAcc && expandedId === null) {
      setPendingConnectionOptions(accountConnectionOptions(pendingAcc));
    }
  }, [
    pendingAcc?.id,
    pendingAcc?.enable_advanced_policy_generation,
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

      {showFirstTimeCapabilityOnboarding && (
        <FirstAccountOnboarding
          value={pendingConnectionOptions}
          onChange={setPendingConnectionOptions}
          disabled={continuingOnboarding}
          continuing={continuingOnboarding}
          onContinue={handleOnboardingContinue}
        />
      )}

      {addingAwsAccount && (
        <AccountOnboardingOverlay onDismiss={handleDismissAddAccount}>
          {activeOnboardingAccount && setupInitialStep !== 1 ? (
            <PendingAccountSetupSurface
              acc={activeOnboardingAccount}
              initialStep={setupInitialStep}
              onBackToCapabilities={() => setSetupInitialStep(1)}
              onDismiss={handleDismissAddAccount}
              onCompleteSetup={resetAddAccountFlow}
            />
          ) : (
            <FirstAccountOnboarding
              value={pendingConnectionOptions}
              onChange={setPendingConnectionOptions}
              disabled={continuingOnboarding}
              continuing={continuingOnboarding}
              onContinue={handleOnboardingContinue}
              onDismiss={handleDismissAddAccount}
            />
          )}
        </AccountOnboardingOverlay>
      )}

      <AddAccountProviderPicker
        open={showProviderPicker}
        onClose={() => setShowProviderPicker(false)}
        onSelect={handleProviderSelect}
      />

      {showAccountList && (
        <>
          {filteredRows.length === 0 ? (
            <div className="accounts-list-shell">
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
              <p className="accounts-list-empty">No accounts match your filters</p>
            </div>
          ) : (
            <div className="accounts-split">
              <div className="accounts-split__list">
                <div className="accounts-list-shell">
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
                  <div className="accounts-list-table-scroll">
                    <div className="accounts-list-head" aria-hidden>
                      <span className="accounts-col accounts-col--account">Account</span>
                      <span className="accounts-col accounts-col--coverage">Coverage</span>
                      <span className="accounts-col accounts-col--findings">Open findings</span>
                      <span className="accounts-col accounts-col--status">Status</span>
                    </div>
                    <div className="accounts-list-body">
                    {paginatedRows.map((row) => {
                      const key = accountListRowKey(row);
                      const isSelected = selectedRowKey === key;
                      const onSelect = () => setSelectedRowKey(key);
                      return row.kind === "aws" ? (
                        <AccountPremiumCard
                          key={`aws-${row.account.id}`}
                          acc={row.account}
                          stats={statsMap.get(row.account.id)}
                          expanded={expandedId === row.account.id}
                          setupInitialStep={expandedId === row.account.id ? setupInitialStep : 1}
                          selected={isSelected}
                          splitLayout
                          suppressSelectionStyle={stackedAccountsLayout}
                          onSelect={onSelect}
                          onContinueSetup={() => {
                            setOnboardingAccount(row.account);
                            setDiscardOnboardingAccountId(null);
                            setPendingConnectionOptions(accountConnectionOptions(row.account));
                            setSetupInitialStep(2);
                            setAddingAwsAccount(true);
                            setExpandedId(null);
                          }}
                          onToggle={() => {
                            setSelectedRowKey(key);
                            setExpandedId((id) => {
                              if (id === row.account.id) return null;
                              if (!isAccountConnected(row.account)) setSetupInitialStep(2);
                              return row.account.id;
                            });
                          }}
                        />
                      ) : (
                        <IntegrationCloudAccountCard
                          key={`${row.cloud.provider}-${row.cloud.id}`}
                          cloud={row.cloud}
                          stats={integrationStatsMap.get(row.cloud.id)}
                          selected={isSelected}
                          splitLayout
                          suppressSelectionStyle={stackedAccountsLayout}
                          onSelect={onSelect}
                        />
                      );
                    })}
                    </div>
                  </div>

                  <div className="accounts-list-pagination">
                    <p className="accounts-list-pagination__meta">
                      {pageStart}-{pageEnd} of {filteredRows.length} account{filteredRows.length === 1 ? "" : "s"}
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
                </div>
              </div>

              <div className="accounts-split__detail">
                {selectedRow ? (
                  <AccountSplitDetailPane
                    row={selectedRow}
                    stats={
                      selectedRow.kind === "aws"
                        ? statsMap.get(selectedRow.account.id)
                        : integrationStatsMap.get(selectedRow.cloud.id)
                    }
                    findingsItems={allFindings.data?.items}
                    setupInitialStep={setupInitialStep}
                    onManageSetup={() => {
                      if (selectedRow.kind === "aws" && !isAccountConnected(selectedRow.account)) {
                        setOnboardingAccount(selectedRow.account);
                        setDiscardOnboardingAccountId(null);
                        setPendingConnectionOptions(accountConnectionOptions(selectedRow.account));
                        setSetupInitialStep(2);
                        setAddingAwsAccount(true);
                        setExpandedId(null);
                        return;
                      }
                      setExpandedId(null);
                      setSetupInitialStep(1);
                    }}
                    onDismissSetup={handleDismissEmbeddedSetup}
                  />
                ) : (
                  <div className="accounts-detail-empty">
                    <p className="accounts-detail-empty__title">Select an account</p>
                    <p className="accounts-detail-empty__body">
                      Choose an account from the list to view coverage, findings, and quick actions.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

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
