import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, formatApiError, token } from "../api";
import { roleAtLeast, useMe } from "../hooks/useMe";
import { labelForCheck } from "../data/checkLabels";
import { FRAMEWORKS } from "../data/frameworks";
import { ComplianceFrameworkSelect } from "../components/ComplianceFrameworkSelect";
import { FilterChipBar } from "../components/FilterChipBar";
import ConnectAwsEmptyState from "../components/ConnectAwsEmptyState";
import { EvidencePackExportPanel } from "../components/EvidencePackExportPanel";
import type { ComplianceHistoryResponse } from "../lib/complianceHistory";
import type { EvidenceCoverage } from "../lib/evidenceCoverage";
import { controlPostureScore } from "../lib/controlPostureScore";
import {
  controlEvidenceSectionTitle,
  controlEvidenceUsesType2Bar,
  frameworkEvidenceUi,
  showControlEvidenceSection,
} from "../lib/frameworkEvidenceCoverage";
import {
  findingsScopeParams,
  useConnectedAccountOptions,
} from "../hooks/useConnectedAccountOptions";
import { fetchAllFindings } from "../lib/fetchAllFindings";
import { openFindingFailsControl } from "../lib/evidenceClass";
import { AccountFilterDropdown } from "../components/AccountFilterDropdown";
import { ExternalEvidencePanel } from "../components/ExternalEvidencePanel";
import { CoverageOverridePanel } from "../components/CoverageOverridePanel";
import { ScanCollectorSummary } from "../components/ScanCollectorSummary";
import {
  compositeRecommendedAction,
  isPermissionGapError,
  type ComplianceDisplayStatus,
  type RecommendedAction,
} from "../lib/compositeRecommendedAction";
import type { ExternalEvidenceArtifact } from "../lib/externalEvidence";
import { evidenceIsStale } from "../lib/externalEvidence";
import {
  absenceGapEnableItems,
  findingsHrefForAbsenceGaps,
  openAbsenceGapChecks,
  openCrossAccountCoverableChecks,
} from "../lib/evidenceGap";
import { ControlEvidenceDrawerTrigger } from "../components/ControlEvidenceDrawer";
import { ControlEvidenceSlideOver } from "../components/ControlEvidenceSlideOver";
import { HeaderSlot } from "../context/HeaderSlot";
import { FrameworkMark } from "../components/FrameworkMark";
import "../styles/findings-v2.css";

const BASE =
  (import.meta.env.VITE_API_URL as string) || "http://localhost:8000";

type Account = {
  id: string;
  label: string;
  account_id: string | null;
  status: string;
  last_scan_at: string | null;
};

type CompositeControlRow = {
  id: string;
  control_id: string;
  title: string;
  description: string;
  guidance: string | null;
  soc2_criteria: string[];
  check_ids: string[];
  check_evidence_classes?: Record<string, string>;
  coverage_tier?: "core" | "extended" | "mixed" | "no_data";
  check_tiers?: Record<string, string>;
  status: "pass" | "fail" | "at_risk" | "no_data";
  finding_count: number;
  severity_counts?: { critical: number; high: number; medium: number; low: number };
  open_finding_ids: string[];
  scan_errors?: {
    check_id: string;
    error_type?: string | null;
    error?: string | null;
  }[];
  coverage_override?: "out_of_scope" | "not_applicable" | null;
  coverage_override_detail?: {
    status: "out_of_scope" | "not_applicable";
    reason: string | null;
    set_by: string | null;
    set_at: string | null;
  } | null;
  cross_account_coverage_detail?: {
    account_id: string;
    reason: string | null;
    expires_at: string | null;
    set_by: string | null;
    set_at: string | null;
    verified: boolean;
  } | null;
  sdlc_insights?: {
    repos_total: number;
    repos_with_branch_protection: number;
    repos_without_branch_protection: number;
    dependabot_enabled_repos: number;
    code_scanning_enabled_repos: number;
    secret_scanning_enabled_repos: number;
    repos_with_security_gaps: number;
  } | null;
};

type ControlRow = {
  id: string;
  framework: string;
  control_id: string;
  title: string;
  description: string;
  guidance: string | null;
  narrative: string | null;
  short_answer: string | null;
  long_answer: string | null;
  evidence_refs: string[];
  known_gaps: string[];
  check_ids: string[];
  coverage_tier?: "core" | "extended" | "mixed" | "no_data";
  coverage_label?: string | null;
  extended_check_ids?: string[];
  check_tiers?: Record<string, string>;
  check_evidence_classes?: Record<string, string>;
  status: "pass" | "fail" | "at_risk" | "no_data";
  finding_count: number;
  open_finding_ids: string[];
  kind?: "auto" | "manual";
  attestation_status?: "met" | "not_met" | "not_applicable" | "pending" | null;
};

type ControlHistory = {
  current_status: string;
  failing_since: string | null;
  days_failing: number | null;
  open_finding_count: number;
  segments: {
    status: string;
    from: string;
    to: string;
    duration_seconds: number;
  }[];
  events: { timestamp: string; type: string; detail: string }[];
};

const AUDIT_WINDOWS = [
  { value: "last_scan", label: "Last scan (point-in-time)" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
  { value: 180, label: "Last 180 days" },
  { value: 365, label: "Last 365 days" },
] as const;

type StatusFilter =
  | "all"
  | "pass"
  | "fail"
  | "no_data"
  | "needs_evidence"
  | "externally_covered"
  | "pending_review"
  | "stale"
  | "expired";

type ComplianceView = "composite" | "detailed";

const statusExpandedBg: Record<string, string> = {
  pass: "bg-zinc-50/40",
  fail: "bg-zinc-50/50",
  no_data: "bg-zinc-50/40",
};

const COMPLIANCE_CARD_SHELL =
  "overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-md shadow-zinc-950/[0.04] ring-1 ring-zinc-950/[0.03]";

type OpenFindingMeta = {
  id: string;
  check_id: string;
  severity: string;
  resource_arn: string;
};

const SEV_WEIGHT: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function ComplianceExpandChevron({
  expanded,
  className = "",
}: {
  expanded: boolean;
  className?: string;
}) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${expanded ? "rotate-0" : "-rotate-90"} ${className}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 9l-7 7-7-7"
      />
    </svg>
  );
}

function compositeDisplayStatus(
  ctrl: CompositeControlRow,
  findingCountByCheck: Map<string, number>,
  hasAcceptedExternalEvidence = false,
  hasExpiredEvidence = false,
): ComplianceDisplayStatus {
  if (ctrl.coverage_override === "out_of_scope") return "out_of_scope";
  if (ctrl.coverage_override === "not_applicable") return "not_applicable";
  // Verified coverage in another connected account closes the gap. Attested
  // (not yet verified) cross-account coverage stays a gap until confirmed.
  if (ctrl.cross_account_coverage_detail?.verified) return "externally_covered";
  if (ctrl.status === "pass") return "passing";
  // Control present, only sub-threshold (medium) findings open — tracked, not a gap.
  if (ctrl.status === "at_risk") return "at_risk";
  if (ctrl.status === "no_data") return "unevaluated";
  if (hasExpiredEvidence && !hasAcceptedExternalEvidence) return "expired";
  if (ctrl.status === "fail" && hasAcceptedExternalEvidence)
    return "externally_covered";
  if (
    ctrl.status === "fail" &&
    !hasAcceptedExternalEvidence &&
    openAbsenceGapChecks(ctrl.check_ids, findingCountByCheck).length > 0
  ) {
    return "needs_evidence";
  }
  const failingChecks = ctrl.check_ids.filter(
    (id) => (findingCountByCheck.get(id) ?? 0) > 0,
  );
  if (failingChecks.length === 0) return "failing";
  const hasCoreFailure = failingChecks.some(
    (id) => (ctrl.check_tiers?.[id] ?? "core") === "core",
  );
  return hasCoreFailure ? "failing" : "at_risk";
}

function compositeMatchesStatusFilter(
  ctrl: CompositeControlRow,
  filter: StatusFilter,
  findingCountByCheck: Map<string, number>,
  acceptedCompositeIds: Set<string>,
  submittedCount = 0,
  hasStaleEvidence = false,
  hasExpiredEvidence = false,
): boolean {
  if (filter === "all") return true;
  const display = compositeDisplayStatus(
    ctrl,
    findingCountByCheck,
    acceptedCompositeIds.has(ctrl.id),
    hasExpiredEvidence,
  );
  if (filter === "pass") return ctrl.status === "pass";
  if (filter === "no_data") return ctrl.status === "no_data";
  if (filter === "needs_evidence") return display === "needs_evidence";
  if (filter === "externally_covered") return display === "externally_covered";
  if (filter === "pending_review") return submittedCount > 0;
  if (filter === "stale") return hasStaleEvidence;
  if (filter === "expired") return hasExpiredEvidence;
  if (filter === "fail")
    return (
      ctrl.status === "fail" && (display === "failing" || display === "at_risk")
    );
  return true;
}

function controlDisplayStatus(
  ctrl: ControlRow,
  findingCountByCheck: Map<string, number>,
): ComplianceDisplayStatus {
  if (ctrl.status === "pass") return "passing";
  if (ctrl.status === "no_data") return "unevaluated";
  const failingChecks = ctrl.check_ids.filter(
    (id) => (findingCountByCheck.get(id) ?? 0) > 0,
  );
  if (failingChecks.length === 0) return "failing";
  const hasCoreFailure = failingChecks.some(
    (id) => (ctrl.check_tiers?.[id] ?? "core") === "core",
  );
  return hasCoreFailure ? "failing" : "at_risk";
}

function ComplianceRowSummary({
  displayStatus,
  href,
  onNavigate,
}: {
  displayStatus: ComplianceDisplayStatus;
  href: string | null;
  onNavigate: (href: string) => void;
}) {
  const label: Record<ComplianceDisplayStatus, string> = {
    passing: "Passing",
    failing: "Failing",
    at_risk: "At risk",
    unevaluated: "Not evaluated",
    externally_covered: "Externally covered",
    needs_evidence: "Evidence needed",
    expired: "Expired evidence",
    out_of_scope: "Out of scope",
    not_applicable: "Not applicable",
  };

  const dotClass: Record<ComplianceDisplayStatus, string> = {
    passing: "bg-emerald-500",
    failing: "bg-rose-500",
    at_risk: "bg-amber-500",
    unevaluated: "bg-zinc-400",
    externally_covered: "bg-indigo-500",
    needs_evidence: "bg-orange-500",
    expired: "bg-zinc-500",
    out_of_scope: "bg-sky-500",
    not_applicable: "bg-sky-400",
  };

  const textClass: Record<ComplianceDisplayStatus, string> = {
    passing: "text-emerald-700",
    failing: "text-rose-700",
    at_risk: "text-amber-700",
    unevaluated: "text-zinc-500",
    externally_covered: "text-indigo-700",
    needs_evidence: "text-orange-700",
    expired: "text-zinc-600",
    out_of_scope: "text-sky-700",
    not_applicable: "text-sky-700",
  };
  const summaryClass = `compliance-status-text ${textClass[displayStatus]}`;
  const content = (
    <>
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass[displayStatus]}`}
        aria-hidden
      />
      {label[displayStatus]}
    </>
  );

  if (href) {
    return (
      <button
        type="button"
        title="View open findings"
        onClick={(e) => {
          e.stopPropagation();
          onNavigate(href);
        }}
        className={`${summaryClass} transition hover:opacity-80`}
      >
        {content}
      </button>
    );
  }

  return <span className={summaryClass}>{content}</span>;
}

function CompliancePanelShell({
  title,
  subtitle,
  toolbar,
  section,
  children,
}: {
  title: string;
  subtitle: string;
  toolbar?: ReactNode;
  section?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`mb-4 ${COMPLIANCE_CARD_SHELL}`}>
      <div className="border-b border-zinc-100 bg-zinc-50/60 px-5 py-4">
        <h2 className="text-body font-semibold text-zinc-900">{title}</h2>
        <p className="mt-1 text-meta leading-relaxed text-zinc-500">
          {subtitle}
        </p>
        {toolbar}
      </div>
      {section && (
        <div className="border-b border-zinc-100 px-5 py-2.5">{section}</div>
      )}
      <div className="divide-y divide-zinc-100">{children}</div>
    </section>
  );
}

function shortFamilyLabel(label: string) {
  const parts = label.split(" ");
  if (parts.length >= 2 && /^(CC\d|CIS|A\.\d)/.test(parts[0])) {
    return parts.slice(0, 2).join(" ");
  }
  return label;
}

function passRateColor(pct: number) {
  if (pct >= 80) return "text-emerald-600";
  if (pct >= 50) return "text-amber-600";
  return "text-red-600";
}

function passRateBarColor(pct: number) {
  if (pct >= 80) return "bg-emerald-500";
  if (pct >= 50) return "bg-amber-500";
  return "bg-red-500";
}

type ControlGroup = {
  key: string;
  label: string;
  rows: ControlRow[];
  passed: number;
  failed: number;
  noData: number;
};

const MANUAL_STATUS = [
  { value: "pending", label: "Pending" },
  { value: "met", label: "Met" },
  { value: "not_met", label: "Not met" },
  { value: "not_applicable", label: "N/A" },
];

function ManualAttestation({
  status,
  canEdit,
  saving,
  onChange,
}: {
  status: string;
  canEdit: boolean;
  saving: boolean;
  onChange: (status: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-zinc-200 bg-zinc-50/60 px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-zinc-800">Manual control</p>
        <p className="text-meta leading-relaxed text-zinc-500">
          No automated check maps here — attest its status with your own
          evidence.
        </p>
      </div>
      {canEdit ? (
        <select
          value={status}
          disabled={saving}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 shrink-0 cursor-pointer rounded-lg border border-zinc-200 bg-white px-2.5 text-sm font-semibold text-zinc-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        >
          {MANUAL_STATUS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      ) : (
        <span className="shrink-0 text-sm font-semibold text-zinc-600">
          {MANUAL_STATUS.find((s) => s.value === status)?.label ?? status}
        </span>
      )}
    </div>
  );
}

function controlFamily(framework: string, controlId: string) {
  if (framework === "soc2") {
    if (controlId.startsWith("CC6"))
      return { key: "cc6", label: "CC6 Cloud Access" };
    if (controlId.startsWith("CC7"))
      return { key: "cc7", label: "CC7 Cloud Operations" };
    if (controlId.startsWith("CC8"))
      return { key: "cc8", label: "CC8 Change Evidence" };
    return { key: "manual-evidence", label: "Manual Evidence" };
  }

  if (framework === "cis_aws_l1") {
    const section = controlId.split(".")[0];
    if (section === "1")
      return { key: "cis-1", label: "CIS 1 Identity and Access" };
    if (section === "2")
      return { key: "cis-2", label: "CIS 2 Storage and Logging" };
    if (section === "3") return { key: "cis-3", label: "CIS 3 Networking" };
    if (section === "4") return { key: "cis-4", label: "CIS 4 Monitoring" };
  }

  if (framework === "iso27001") {
    if (controlId.startsWith("A.9"))
      return { key: "iso-a9", label: "A.9 Access Control" };
    if (controlId.startsWith("A.10"))
      return { key: "iso-a10", label: "A.10 Cryptography" };
    if (controlId.startsWith("A.12"))
      return { key: "iso-a12", label: "A.12 Operations Security" };
    if (controlId.startsWith("A.13"))
      return { key: "iso-a13", label: "A.13 Communications Security" };
  }

  return { key: "other", label: "Other" };
}

function controlIdSortKey(controlId: string): (string | number)[] {
  const parts: (string | number)[] = [];
  const re = /(\d+)|(\D+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(controlId)) !== null) {
    parts.push(match[1] ? Number.parseInt(match[1], 10) : match[2]);
  }
  return parts;
}

function compareControlIds(a: string, b: string): number {
  const pa = controlIdSortKey(a);
  const pb = controlIdSortKey(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const va = pa[i];
    const vb = pb[i];
    if (va === undefined) return -1;
    if (vb === undefined) return 1;
    if (typeof va === "number" && typeof vb === "number") {
      if (va !== vb) return va - vb;
    } else {
      const cmp = String(va).localeCompare(String(vb));
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

function groupControls(rows: ControlRow[], framework: string): ControlGroup[] {
  const groups = new Map<string, ControlGroup>();

  for (const row of rows) {
    const family = controlFamily(framework, row.control_id);
    const existing = groups.get(family.key);
    const group = existing ?? {
      key: family.key,
      label: family.label,
      rows: [],
      passed: 0,
      failed: 0,
      noData: 0,
    };

    group.rows.push(row);
    if (row.status === "pass") group.passed += 1;
    if (row.status === "fail") group.failed += 1;
    if (row.status === "no_data") group.noData += 1;
    groups.set(family.key, group);
  }

  for (const group of groups.values()) {
    group.rows.sort((a, b) => {
      const idCmp = compareControlIds(a.control_id, b.control_id);
      if (idCmp !== 0) return idCmp;
      return b.finding_count - a.finding_count;
    });
  }

  // Keep named families in their natural order, but always park manual/catch-all
  // evidence on the far right (stable sort preserves the rest).
  return Array.from(groups.values()).sort(
    (a, b) =>
      (a.key === "manual-evidence" || a.key === "other" ? 1 : 0) -
      (b.key === "manual-evidence" || b.key === "other" ? 1 : 0),
  );
}

function shortControlTitle(title: string) {
  const parts = title.split("—");
  return parts.length > 1 ? parts.slice(1).join("—").trim() : title;
}

function findingLabel(count: number) {
  return `${count} finding${count === 1 ? "" : "s"}`;
}

function controlTheme(control: ControlRow) {
  const ids = control.check_ids.join(" ");
  if (/iam|github\.org|gitlab\.org/.test(ids)) return "identity-related";
  if (/github\.repo|gitlab\.repo/.test(ids)) return "change-management";
  if (/cloudtrail|guardduty|securityhub|aws\.config|vpc/.test(ids))
    return "monitoring and logging";
  if (/s3|kms|rds|ec2\.ebs/.test(ids)) return "data-protection";
  if (/ec2\.security_group|rds\.instance\.publicly_accessible/.test(ids))
    return "network-exposure";
  return "mapped";
}

function controlSummary(control: ControlRow): string {
  if (control.check_ids.length === 0) {
    return "Not automated in Veritrail yet — CIS expects this control; map manually or wait for a future check.";
  }
  if (control.status === "pass") {
    return "Passing — no open findings. Keep in the evidence pack for audit review.";
  }
  if (control.status === "no_data") {
    return "Not evaluated yet — run a scan or connect the required evidence source.";
  }
  const theme = controlTheme(control);
  const action =
    theme === "identity-related"
      ? "Remediate stale or over-permissive identities."
      : theme === "change-management"
        ? "Restore branch protection and review requirements."
        : theme === "monitoring and logging"
          ? "Enable the missing monitoring or audit-log controls."
          : theme === "data-protection"
            ? "Fix encryption, retention, or storage protection gaps."
            : theme === "network-exposure"
              ? "Remove public or unrestricted network exposure."
              : "Remediate the mapped checks blocking this control.";
  return `${control.finding_count} open ${theme} ${control.finding_count === 1 ? "finding" : "findings"}. ${action}`;
}

function formatEvidenceDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function lastScanLabel(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const COMPOSITE_DISPLAY_ORDER = [
  "identity_governance",
  "asset_inventory",
  "secure_sdlc",
  "change_management",
  "data_protection",
  "vulnerability_management",
  "logging_monitoring",
  "backup_resilience",
  "endpoint_security",
] as const;

const NESTED_COMPOSITE_IDS: Record<string, string> = {
  vulnerability_management: "container_vulnerability_monitoring",
};

const NESTED_COMPOSITE_DISPLAY: Record<
  string,
  { title: string; hint: string }
> = {
  container_vulnerability_monitoring: {
    title: "Container image coverage",
    hint: "Applies when ECR, ECS, or EKS container evidence exists",
  },
};

type CompositeGroupVisual = {
  bg?: string;
  text?: string;
  ring?: string;
  Icon: ({ className }: { className?: string }) => JSX.Element;
};

function IdentityGovernanceIcon({
  className = "h-4 w-4",
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
      />
    </svg>
  );
}

function AssetInventoryIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path d="M12 4.5 18.5 7.75 12 11 5.5 7.75 12 4.5Z" />
      <path d="M5.5 7.75v9.75l6.5 3.25" />
      <path d="M18.5 7.75v9.75l-6.5 3.25" />
      <path d="M12 11v9.75" />
      <path strokeLinecap="round" d="M12 6.75 15 8.25" />
    </svg>
  );
}

function SecureSdlcIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
      />
    </svg>
  );
}

function ChangeManagementIcon({
  className = "h-4 w-4",
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
      />
    </svg>
  );
}

function DataProtectionIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <rect x="5" y="10" width="14" height="9.5" rx="2" />
      <path d="M7.5 10V7a4.5 4.5 0 0 1 9 0v3" />
    </svg>
  );
}

function VulnerabilityManagementIcon({
  className = "h-4 w-4",
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
      />
    </svg>
  );
}

function LoggingMonitoringIcon({
  className = "h-4 w-4",
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <rect x="4" y="5" width="16" height="12" rx="2" />
      <path d="M8 13v-3" />
      <path d="M12 13V8" />
      <path d="M16 13v-2" />
      <path d="M9 20h6" />
      <path d="M12 17v3" />
    </svg>
  );
}

function BackupResilienceIcon({
  className = "h-4 w-4",
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2"
      />
      <circle cx="7.5" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="7.5" cy="16" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CompositeGroupFallbackIcon({
  className = "h-4 w-4",
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function EndpointSecurityIcon({
  className = "h-4 w-4",
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path d="M12 3.5 19 6v5.25c0 4.1-2.76 7.92-7 9.25-4.24-1.33-7-5.15-7-9.25V6l7-2.5Z" />
      <path d="M9.5 12.25 11.25 14 15 10" />
    </svg>
  );
}

function DeviceManagementIcon({
  className = "h-4 w-4",
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <rect x="8" y="3.5" width="8" height="17" rx="2" />
      <path d="M11 17.5h2" />
      <path d="M10.25 7h3.5" />
      <path d="M18 9.5a5.5 5.5 0 0 1 0 5" />
      <path d="M6 9.5a5.5 5.5 0 0 0 0 5" />
    </svg>
  );
}

const COMPOSITE_GROUP_VISUALS: Record<string, CompositeGroupVisual> = {
  identity_governance: {
    bg: "bg-violet-50",
    text: "text-violet-600",
    ring: "ring-violet-200/80",
    Icon: IdentityGovernanceIcon,
  },
  asset_inventory: {
    bg: "bg-sky-50",
    text: "text-sky-600",
    ring: "ring-sky-200/80",
    Icon: AssetInventoryIcon,
  },
  secure_sdlc: {
    bg: "bg-indigo-50",
    text: "text-indigo-600",
    ring: "ring-indigo-200/80",
    Icon: SecureSdlcIcon,
  },
  change_management: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    ring: "ring-amber-200/80",
    Icon: ChangeManagementIcon,
  },
  data_protection: {
    bg: "bg-emerald-50",
    text: "text-emerald-600",
    ring: "ring-emerald-200/80",
    Icon: DataProtectionIcon,
  },
  vulnerability_management: {
    bg: "bg-rose-50",
    text: "text-rose-600",
    ring: "ring-rose-200/80",
    Icon: VulnerabilityManagementIcon,
  },
  logging_monitoring: {
    bg: "bg-blue-50",
    text: "text-blue-600",
    ring: "ring-blue-200/80",
    Icon: LoggingMonitoringIcon,
  },
  backup_resilience: {
    bg: "bg-teal-50",
    text: "text-teal-600",
    ring: "ring-teal-200/80",
    Icon: BackupResilienceIcon,
  },
  container_vulnerability_monitoring: {
    bg: "bg-orange-50",
    text: "text-orange-600",
    ring: "ring-orange-200/80",
    Icon: VulnerabilityManagementIcon,
  },
  endpoint_security: {
    bg: "bg-zinc-50",
    text: "text-slate-600",
    ring: "ring-slate-200/80",
    Icon: EndpointSecurityIcon,
  },
  mdm_endpoint: {
    bg: "bg-zinc-50",
    text: "text-slate-600",
    ring: "ring-slate-200/80",
    Icon: DeviceManagementIcon,
  },
};

function CompositeGroupIcon({ id }: { id: string }) {
  const visual = COMPOSITE_GROUP_VISUALS[id] ?? {
    Icon: CompositeGroupFallbackIcon,
  };
  const { Icon } = visual;

  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#dbe3ee] bg-white text-[#526179] shadow-sm shadow-slate-950/[0.03]"
      aria-hidden
    >
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

function CompositeCategoryDetailIcon({ id }: { id: string }) {
  const visual = COMPOSITE_GROUP_VISUALS[id] ?? {
    bg: "bg-violet-50",
    text: "text-violet-600",
    Icon: CompositeGroupFallbackIcon,
  };
  const { Icon, bg = "bg-violet-50", text = "text-violet-600" } = visual;

  return (
    <span
      className={`compliance-category-detail__icon ${bg} ${text}`}
      aria-hidden
    >
      <Icon className="h-5 w-5" />
    </span>
  );
}

function severityDisplayLabel(severity: string): "High" | "Medium" | "Low" {
  if (severity === "critical" || severity === "high") return "High";
  if (severity === "medium") return "Medium";
  return "Low";
}

function compositeCoveragePercent(
  ctrl: CompositeControlRow,
  findingCountByCheck: Map<string, number>,
  acceptedCompositeIds: Set<string>,
): number {
  if (ctrl.status === "pass" || acceptedCompositeIds.has(ctrl.id)) return 100;
  const totalChecks = ctrl.check_ids.length;
  if (totalChecks === 0) return 0;
  const clearChecks = ctrl.check_ids.filter(
    (id) => (findingCountByCheck.get(id) ?? 0) === 0,
  ).length;
  return Math.round((clearChecks / totalChecks) * 100);
}

type CompositeTreeRow = {
  row: CompositeControlRow;
  child?: CompositeControlRow;
};

function prepareCompositeTreeRows(
  rows: CompositeControlRow[],
): CompositeTreeRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const nestedChildIds = new Set(Object.values(NESTED_COMPOSITE_IDS));
  const out: CompositeTreeRow[] = [];

  for (const id of COMPOSITE_DISPLAY_ORDER) {
    const row = byId.get(id);
    if (!row) continue;
    const childId = NESTED_COMPOSITE_IDS[id];
    const child = childId ? byId.get(childId) : undefined;
    out.push({ row, child });
  }

  for (const row of rows) {
    if (
      !COMPOSITE_DISPLAY_ORDER.includes(
        row.id as (typeof COMPOSITE_DISPLAY_ORDER)[number],
      ) &&
      !nestedChildIds.has(row.id)
    ) {
      out.push({ row });
    }
  }
  return out;
}

function compositeAppliesToFramework(
  composite: CompositeControlRow,
  frameworkRows: ControlRow[],
): boolean {
  if (frameworkRows.length === 0) return true;
  const checks = new Set(composite.check_ids);
  return frameworkRows.some((row) =>
    row.check_ids.some((id) => checks.has(id)),
  );
}

function frameworkControlLabel(framework: string, controlId: string): string {
  if (framework === "soc2") return `SOC 2 ${controlId}`;
  if (framework === "cis_aws_l1") return `CIS AWS ${controlId}`;
  if (framework === "iso27001") return `ISO 27001 ${controlId}`;
  return controlId;
}

function underlyingCriteriaForComposite(
  composite: CompositeControlRow,
  frameworkRows: ControlRow[],
): ControlRow[] {
  const checkSet = new Set(composite.check_ids);
  return frameworkRows
    .filter((row) => row.check_ids.some((id) => checkSet.has(id)))
    .sort(
      (a, b) =>
        b.finding_count - a.finding_count ||
        compareControlIds(a.control_id, b.control_id),
    );
}

function ComplianceStatusFilterBar({
  total,
  passed,
  failed,
  noData,
  needsEvidence,
  externallyCovered,
  pendingReview,
  staleEvidence,
  expiredEvidence,
  statusFilter,
  onChange,
  compositeMode = false,
}: {
  total: number;
  passed: number;
  failed: number;
  noData: number;
  needsEvidence?: number;
  externallyCovered?: number;
  pendingReview?: number;
  staleEvidence?: number;
  expiredEvidence?: number;
  statusFilter: StatusFilter;
  onChange: (filter: StatusFilter) => void;
  compositeMode?: boolean;
}) {
  const chips = [
    { id: "all", label: "All", count: total },
    { id: "fail", label: "Failing", count: failed, urgent: true },
    { id: "pass", label: "Passing", count: passed },
    { id: "no_data", label: "No data", count: noData },
  ];
  return (
    <FilterChipBar
      ariaLabel="Control status"
      selected={statusFilter}
      onChange={(id) => onChange(id as StatusFilter)}
      chips={chips}
    />
  );
}

function ComplianceFamilyNav({
  groups,
  selectedKey,
  onSelect,
}: {
  groups: ControlGroup[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  if (groups.length <= 1) return null;

  return (
    <nav
      className="findings-v2-filter-chip-bar"
      role="tablist"
      aria-label="Control domains"
    >
      {groups.map((group) => {
        const isSelected = selectedKey === group.key;
        return (
          <button
            key={group.key}
            type="button"
            role="tab"
            aria-selected={isSelected}
            title={group.label}
            onClick={() => onSelect(group.key)}
            className={`findings-v2-filter-chip ${isSelected ? "is-selected" : ""}`}
          >
            {shortFamilyLabel(group.label)}
            <span className={isSelected ? "text-zinc-500" : "text-zinc-400"}>
              {" "}
              · {group.rows.length}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function ComplianceDetailBreadcrumb({
  framework,
  controlId,
  compositeTitle,
  onBack,
}: {
  framework: string;
  controlId: string | null;
  compositeTitle?: string | null;
  onBack: () => void;
}) {
  if (!controlId) return null;

  return (
    <div className="compliance-detail-breadcrumb">
      <button
        type="button"
        onClick={onBack}
        className="compliance-detail-breadcrumb__back"
      >
        <span aria-hidden="true">&larr;</span>
        Back to categories
      </button>
      <div className="compliance-detail-breadcrumb__trail" aria-label="Breadcrumb">
        <span>Compliance</span>
        <span aria-hidden="true">/</span>
        <span className="truncate">{compositeTitle ?? "All controls"}</span>
        <span aria-hidden="true">/</span>
        <strong>{frameworkControlLabel(framework, controlId)}</strong>
      </div>
    </div>
  );
}

function ComplianceUnifiedToolbar({
  framework,
  frameworkStatsById,
  onFrameworkChange,
  statusFilter,
  onStatusFilterChange,
  statusCounts,
  compositeStatusFilter = false,
  showStatusFilter,
  auditExport,
  showAuditExport,
}: {
  framework: string;
  frameworkStatsById: Record<string, FrameworkStats | undefined>;
  onFrameworkChange: (id: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (filter: StatusFilter) => void;
  statusCounts: {
    total: number;
    passed: number;
    failed: number;
    noData: number;
    needsEvidence?: number;
    externallyCovered?: number;
    pendingReview?: number;
    staleEvidence?: number;
    expiredEvidence?: number;
  };
  compositeStatusFilter?: boolean;
  showStatusFilter: boolean;
  auditExport: ReactNode;
  showAuditExport: boolean;
}) {
  return (
    <div className="findings-v2-table-toolbar">
      <div className="findings-v2-filter-cluster !flex-wrap">
        {showStatusFilter && (
          <ComplianceStatusFilterBar
            total={statusCounts.total}
            passed={statusCounts.passed}
            failed={statusCounts.failed}
            noData={statusCounts.noData}
            needsEvidence={statusCounts.needsEvidence}
            externallyCovered={statusCounts.externallyCovered}
            pendingReview={statusCounts.pendingReview}
            staleEvidence={statusCounts.staleEvidence}
            expiredEvidence={statusCounts.expiredEvidence}
            statusFilter={statusFilter}
            onChange={onStatusFilterChange}
            compositeMode={compositeStatusFilter}
          />
        )}
        <ComplianceFrameworkSelect
          selectedId={framework}
          statsById={frameworkStatsById}
          onSelect={onFrameworkChange}
        />
      </div>
      <div className="findings-v2-control-cluster">
        {showAuditExport && (
          <div
            className="findings-v2-toolbar-group findings-v2-actions-group"
            role="group"
            aria-label="Export"
          >
            {auditExport}
          </div>
        )}
      </div>
    </div>
  );
}

function ComplianceContentShell({
  toolbar,
  section,
  children,
}: {
  toolbar?: ReactNode;
  section?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="compliance-list-card mb-4 min-w-0">
      {toolbar}
      {section && (
        <div className="border-b border-zinc-100 px-5 py-2.5">{section}</div>
      )}
      <div className="divide-y divide-zinc-100 overflow-hidden rounded-b-2xl">
        {children}
      </div>
    </section>
  );
}

function ComplianceProgressBadge({ label }: { label: string }) {
  return (
    <span className="ml-2 inline-flex shrink-0 items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200/80">
      {label}
    </span>
  );
}

function findingsHrefForChecks(
  checkIds: string[],
  findingCountByCheck: Map<string, number>,
) {
  const active = checkIds.filter(
    (id) => (findingCountByCheck.get(id) ?? 0) > 0,
  );
  if (active.length === 0) return null;
  return `/findings?checks=${encodeURIComponent(active.join(","))}`;
}

function sortedTopFailingChecks(
  checkIds: string[],
  findingCountByCheck: Map<string, number>,
  max = 6,
): string[] {
  return [...checkIds]
    .filter((id) => (findingCountByCheck.get(id) ?? 0) > 0)
    .sort(
      (a, b) =>
        (findingCountByCheck.get(b) ?? 0) - (findingCountByCheck.get(a) ?? 0),
    )
    .slice(0, max);
}

const COMPOSITE_RISK_SUMMARY: Record<string, string> = {
  identity_governance: "High impact from over-provisioned access",
  asset_inventory: "Untracked or dormant assets weaken access reviews",
  secure_sdlc: "Missing CI security controls increase supply-chain risk",
  change_management: "Unprotected branches allow unaudited production changes",
  data_protection: "Encryption gaps expose data at rest and in transit",
  vulnerability_management:
    "Unpatched or unscanned workloads increase breach risk",
  logging_monitoring: "Monitoring blind spots hide unauthorized activity",
  backup_resilience: "Missing backups threaten recovery objectives",
  container_vulnerability_monitoring:
    "Container images may ship without vulnerability coverage",
};

function compositeRiskSummary(ctrl: CompositeControlRow): string {
  return (
    COMPOSITE_RISK_SUMMARY[ctrl.id] ??
    ctrl.guidance ??
    "Review mapped checks and remediate open findings."
  );
}

function TopFailingChecksTable({
  checkIds,
  findingCountByCheck,
  max = 6,
}: {
  checkIds: string[];
  findingCountByCheck: Map<string, number>;
  max?: number;
}) {
  const navigate = useNavigate();
  const top = useMemo(
    () => sortedTopFailingChecks(checkIds, findingCountByCheck, max),
    [checkIds, findingCountByCheck, max],
  );

  if (top.length === 0) return null;

  const maxCount = findingCountByCheck.get(top[0]) ?? 1;

  return (
    <ul className="compliance-top-checks-table">
      {top.map((checkId, index) => {
        const count = findingCountByCheck.get(checkId) ?? 0;
        const pct =
          maxCount > 0 ? Math.max(4, Math.round((count / maxCount) * 100)) : 0;
        return (
          <li
            key={checkId}
            className="border-b border-zinc-100 last:border-b-0"
          >
            <button
              type="button"
              onClick={() =>
                navigate(`/findings?checks=${encodeURIComponent(checkId)}`)
              }
              className="compliance-top-checks-table__row group grid w-full grid-cols-[auto_minmax(0,1fr)_4.5rem_6.5rem] items-center gap-3 py-3 text-left transition hover:bg-zinc-50/80"
            >
              <span className="w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-zinc-400">
                {index + 1}
              </span>
              <span className="truncate text-sm font-medium text-zinc-900">
                {labelForCheck(checkId)}
              </span>
              <span className="text-right text-sm font-semibold tabular-nums text-zinc-900">
                {count}
              </span>
              <span className="flex justify-end" aria-hidden>
                <span className="compliance-density-bar">
                  <span
                    className={`compliance-density-bar__fill${count <= 1 ? " compliance-density-bar__fill--muted" : ""}`}
                    style={{ width: `${pct}%` }}
                  />
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function InsightIcon({
  tone,
  children,
}: {
  tone: "emerald" | "sky" | "rose";
  children: ReactNode;
}) {
  return (
    <span
      className={`compliance-group-insight__icon compliance-group-insight__icon--${tone}`}
      aria-hidden
    >
      {children}
    </span>
  );
}

function CompositeRecommendedActionBanner({
  action,
}: {
  action: RecommendedAction;
}) {
  return (
    <div
      className={`compliance-group-action compliance-group-action--${action.tone}`}
    >
      <p className="compliance-group-action__title">{action.title}</p>
      <p className="compliance-group-action__detail">{action.detail}</p>
    </div>
  );
}

function CompositeSdlcInsights({
  insights,
}: {
  insights: NonNullable<CompositeControlRow["sdlc_insights"]>;
}) {
  if (!insights.repos_total) return null;
  return (
    <div className="compliance-group-permission-gaps">
      <p className="compliance-group-card-title">SDLC repository coverage</p>
      <ul className="compliance-group-permission-gaps__list">
        <li>
          Branch protection: {insights.repos_with_branch_protection}/
          {insights.repos_total} repos
          {insights.repos_without_branch_protection > 0 && (
            <span className="compliance-group-permission-gaps__error">
              {" "}
              ({insights.repos_without_branch_protection} without protection)
            </span>
          )}
        </li>
        <li>Dependabot enabled: {insights.dependabot_enabled_repos} repos</li>
        <li>
          Code scanning enabled: {insights.code_scanning_enabled_repos} repos
        </li>
        <li>
          Secret scanning enabled: {insights.secret_scanning_enabled_repos}{" "}
          repos
        </li>
        {insights.repos_with_security_gaps > 0 && (
          <li className="compliance-group-permission-gaps__error">
            {insights.repos_with_security_gaps} repos with security feature gaps
          </li>
        )}
      </ul>
    </div>
  );
}

function CompositePermissionGaps({
  errors,
}: {
  errors: NonNullable<CompositeControlRow["scan_errors"]>;
}) {
  const gaps = errors.filter((e) =>
    isPermissionGapError(e.error_type, e.error),
  );
  if (gaps.length === 0) return null;

  return (
    <div className="compliance-group-permission-gaps">
      <p className="compliance-group-card-title">Permission gaps</p>
      <p className="compliance-group-permission-gaps__hint">
        These checks did not run on the last scan — usually missing IAM
        permissions on the Veritrail connector role.
      </p>
      <ul className="compliance-group-permission-gaps__list">
        {gaps.map((gap) => (
          <li key={gap.check_id}>
            <span className="compliance-group-permission-gaps__check">
              {labelForCheck(gap.check_id)}
            </span>
            {gap.error && (
              <span className="compliance-group-permission-gaps__error">
                {gap.error}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CompositeGroupInsights({
  ctrl,
  findingCountByCheck,
}: {
  ctrl: CompositeControlRow;
  findingCountByCheck: Map<string, number>;
}) {
  const topCheckId = sortedTopFailingChecks(
    ctrl.check_ids,
    findingCountByCheck,
    1,
  )[0];
  const topIssueCount = topCheckId
    ? (findingCountByCheck.get(topCheckId) ?? 0)
    : 0;

  return (
    <div className="compliance-group-insights-card">
      <p className="compliance-group-card-title">Group insights</p>
      <ul className="compliance-group-insight-rows">
        <li className="compliance-group-insight-row">
          <div className="compliance-group-insight-row__lead">
            <InsightIcon tone="emerald">
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                />
              </svg>
            </InsightIcon>
            <span className="compliance-group-insight-row__label">
              Total findings
            </span>
          </div>
          <span className="compliance-group-insight-row__value tabular-nums">
            {ctrl.finding_count}
          </span>
        </li>
        {topCheckId ? (
          <li className="compliance-group-insight-row">
            <div className="compliance-group-insight-row__lead">
              <InsightIcon tone="sky">
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                  />
                </svg>
              </InsightIcon>
              <span className="compliance-group-insight-row__label">
                Top issue
              </span>
            </div>
            <span className="compliance-group-insight-row__value compliance-group-insight-row__value--wrap">
              {labelForCheck(topCheckId)}{" "}
              <span className="tabular-nums text-rose-700">
                ({topIssueCount} findings)
              </span>
            </span>
          </li>
        ) : null}
        <li className="compliance-group-insight-row">
          <div className="compliance-group-insight-row__lead">
            <InsightIcon tone="rose">
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                />
              </svg>
            </InsightIcon>
            <span className="compliance-group-insight-row__label">
              Risk summary
            </span>
          </div>
          <span className="compliance-group-insight-row__value compliance-group-insight-row__value--wrap">
            {compositeRiskSummary(ctrl)}
            {ctrl.finding_count > 0 ? (
              <span className="compliance-group-insight-row__dot" aria-hidden />
            ) : null}
          </span>
        </li>
      </ul>
    </div>
  );
}

function CompositeGroupExplore({
  groupId,
  findingsHref,
  framework,
  accountId,
}: {
  groupId: string;
  findingsHref: string | null;
  framework: string;
  accountId?: string | null;
}) {
  const navigate = useNavigate();
  const historyParams = new URLSearchParams({ framework, composite: groupId });
  if (accountId) historyParams.set("account_id", accountId);

  return (
    <div className="compliance-group-explore-card">
      <div className="compliance-group-explore-card__copy">
        <p className="compliance-group-card-title">Explore this group</p>
        <p className="compliance-group-explore-card__hint">
          Dive deeper into findings and historical activity.
        </p>
      </div>
      <div className="compliance-group-explore-card__actions">
        {findingsHref ? (
          <button
            type="button"
            onClick={() => navigate(findingsHref)}
            className="compliance-group-explore-btn compliance-group-explore-btn--primary"
          >
            View findings
          </button>
        ) : (
          <span className="text-sm text-zinc-500">No open findings</span>
        )}
        <Link
          to={`/history?${historyParams.toString()}`}
          className="compliance-group-explore-btn"
          onClick={(e) => e.stopPropagation()}
        >
          View history
        </Link>
      </div>
    </div>
  );
}

function TopFailingChecksList({
  checkIds,
  findingCountByCheck,
  max = 6,
  variant = "default",
}: {
  checkIds: string[];
  findingCountByCheck: Map<string, number>;
  max?: number;
  variant?: "default" | "compact";
}) {
  const navigate = useNavigate();
  const top = useMemo(
    () => sortedTopFailingChecks(checkIds, findingCountByCheck, max),
    [checkIds, findingCountByCheck, max],
  );

  if (top.length === 0) return null;

  if (variant === "compact") {
    return (
      <ul className="mt-2 space-y-2">
        {top.map((checkId) => {
          const count = findingCountByCheck.get(checkId) ?? 0;
          return (
            <li key={checkId}>
              <button
                type="button"
                onClick={() =>
                  navigate(`/findings?checks=${encodeURIComponent(checkId)}`)
                }
                className="flex w-full items-center justify-between gap-3 text-left transition hover:opacity-80"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500"
                    aria-hidden
                  />
                  <span className="truncate text-sm text-zinc-800">
                    {labelForCheck(checkId)}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-sm font-medium text-zinc-700">
                  {count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  const maxCount = findingCountByCheck.get(top[0]) ?? 1;

  return (
    <ul className="flex flex-col gap-0.5 rounded-xl border border-zinc-200 bg-white p-1.5">
      {top.map((checkId, i) => {
        const count = findingCountByCheck.get(checkId) ?? 0;
        // Proportional bar — floor at 4% so the smallest offenders stay visible.
        const pct =
          maxCount > 0 ? Math.max(4, Math.round((count / maxCount) * 100)) : 0;
        return (
          <li key={checkId}>
            <button
              type="button"
              onClick={() =>
                navigate(`/findings?checks=${encodeURIComponent(checkId)}`)
              }
              className="group relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-left transition hover:bg-zinc-50"
            >
              <span
                className="absolute inset-y-0 left-0 bg-rose-50 transition-colors group-hover:bg-rose-100/70"
                style={{ width: `${pct}%` }}
                aria-hidden
              />
              <span className="relative z-10 flex min-w-0 items-center gap-2.5">
                <span className="w-3.5 shrink-0 text-center text-xs font-semibold tabular-nums text-zinc-400">
                  {i + 1}
                </span>
                <span className="truncate text-sm font-medium text-zinc-900">
                  {labelForCheck(checkId)}
                </span>
              </span>
              <span className="relative z-10 shrink-0 tabular-nums text-sm font-semibold text-rose-700">
                {count}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function CompositeExpandedDetails({
  ctrl,
  findingCountByCheck,
  variant = "default",
  framework = "soc2",
  frameworkRows = [],
  accountId,
  acceptedCompositeIds,
  submittedCount = 0,
  expiredCompositeIds,
}: {
  ctrl: CompositeControlRow;
  findingCountByCheck: Map<string, number>;
  variant?: "default" | "card";
  framework?: string;
  frameworkRows?: ControlRow[];
  accountId?: string | null;
  acceptedCompositeIds: Set<string>;
  submittedCount?: number;
  expiredCompositeIds?: Set<string>;
}) {
  const navigate = useNavigate();
  const findingsHref = findingsHrefForChecks(
    ctrl.check_ids,
    findingCountByCheck,
  );
  const displayStatus = compositeDisplayStatus(
    ctrl,
    findingCountByCheck,
    acceptedCompositeIds.has(ctrl.id),
    expiredCompositeIds?.has(ctrl.id),
  );
  const scanErrors = ctrl.scan_errors ?? [];
  const recommended = compositeRecommendedAction(displayStatus, {
    submittedCount,
    hasPermissionGaps: scanErrors.some((e) =>
      isPermissionGapError(e.error_type, e.error),
    ),
  });

  if (variant === "card") {
    return (
      <div className="compliance-group-expanded">
        {recommended && (
          <CompositeRecommendedActionBanner action={recommended} />
        )}
        <CoverageOverridePanel
          compositeId={ctrl.id}
          compositeTitle={ctrl.title}
          coverageOverride={ctrl.coverage_override}
        />
        {scanErrors.length > 0 && (
          <CompositePermissionGaps errors={scanErrors} />
        )}
        {ctrl.id === "secure_sdlc" && ctrl.sdlc_insights && (
          <CompositeSdlcInsights insights={ctrl.sdlc_insights} />
        )}
        <ScanCollectorSummary accountId={accountId} />
        <div className="compliance-group-checks-card">
          {ctrl.finding_count > 0 ? (
            <div className="compliance-top-checks__header grid grid-cols-[auto_minmax(0,1fr)_4.5rem_6.5rem] items-end gap-3">
              <p className="col-span-2 compliance-group-card-title">
                Top failing checks
              </p>
              <span className="compliance-top-checks__col-head">Findings</span>
              <span className="compliance-top-checks__col-head">Density</span>
            </div>
          ) : (
            <p className="compliance-group-card-title">Top failing checks</p>
          )}
          {ctrl.finding_count > 0 ? (
            <TopFailingChecksTable
              checkIds={ctrl.check_ids}
              findingCountByCheck={findingCountByCheck}
            />
          ) : (
            <p className="mt-2 text-sm text-zinc-500">
              No open findings on mapped checks.
            </p>
          )}
        </div>
        <div className="compliance-group-expanded__side">
          <CompositeGroupInsights
            ctrl={ctrl}
            findingCountByCheck={findingCountByCheck}
          />
          <ExternalEvidencePanel
            compositeId={ctrl.id}
            compositeTitle={ctrl.title}
            framework={framework}
            groupStatus={ctrl.status}
            checkIds={ctrl.check_ids}
            findingCountByCheck={findingCountByCheck}
            underlyingCriteria={underlyingCriteriaForComposite(
              ctrl,
              frameworkRows,
            )}
            frameworkControlLabel={(controlId) =>
              frameworkControlLabel(framework, controlId)
            }
          />
          <CompositeGroupExplore
            groupId={ctrl.id}
            findingsHref={findingsHref}
            framework={framework}
            accountId={accountId}
          />
        </div>
      </div>
    );
  }

  const underlying = underlyingCriteriaForComposite(ctrl, frameworkRows);

  return (
    <div
      className={`veritrail-expand-in space-y-4 border-t border-zinc-100 px-5 pb-5 pt-4 sm:pl-12 ${statusExpandedBg[ctrl.status]}`}
    >
      {recommended && <CompositeRecommendedActionBanner action={recommended} />}
      <CoverageOverridePanel
        compositeId={ctrl.id}
        compositeTitle={ctrl.title}
        coverageOverride={ctrl.coverage_override}
      />
      {scanErrors.length > 0 && <CompositePermissionGaps errors={scanErrors} />}
      {underlying.length > 0 && (
        <div>
          <p className="veritrail-kicker">Underlying criteria</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {underlying.slice(0, 10).map((c) => {
              const params = new URLSearchParams({
                framework,
                control: c.control_id,
              });
              if (accountId) params.set("account_id", accountId);
              return (
                <Link
                  key={c.id}
                  to={`/controls?${params}`}
                  className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700 transition hover:border-indigo-200 hover:text-indigo-800"
                >
                  {frameworkControlLabel(framework, c.control_id)}
                  {c.finding_count > 0 && (
                    <span className="ml-1.5 tabular-nums text-rose-600/90">
                      ({c.finding_count})
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="veritrail-kicker">Top failing checks</p>
          {findingsHref && (
            <button
              type="button"
              onClick={() => navigate(findingsHref)}
              className="text-xs font-semibold text-indigo-700 hover:text-indigo-900"
            >
              View all findings →
            </button>
          )}
        </div>
        <div className="mt-2">
          <TopFailingChecksList
            checkIds={ctrl.check_ids}
            findingCountByCheck={findingCountByCheck}
          />
        </div>
      </div>
    </div>
  );
}

function compositeAutomatedSummary(
  ctrl: CompositeControlRow,
  displayStatus: ComplianceDisplayStatus,
) {
  if (displayStatus === "passing") return "Verified";
  if (displayStatus === "needs_evidence" || ctrl.status === "no_data")
    return "Not connected";
  if (displayStatus === "out_of_scope") return "Out of scope";
  if (displayStatus === "not_applicable") return "Not applicable";
  return "Gap detected";
}

function compositeExternalSummary(
  ctrl: CompositeControlRow,
  acceptedCompositeIds: Set<string>,
  submittedCountByComposite: Map<string, number>,
) {
  if (acceptedCompositeIds.has(ctrl.id)) return "Accepted evidence";
  const submittedCount = submittedCountByComposite.get(ctrl.id) ?? 0;
  if (submittedCount > 0) return `${submittedCount} pending review`;
  return "None";
}

function TopFailingChecksSeverityTable({
  checkIds,
  findingCountByCheck,
  severityByCheck,
  max = 5,
}: {
  checkIds: string[];
  findingCountByCheck: Map<string, number>;
  severityByCheck: Map<string, string>;
  max?: number;
}) {
  const navigate = useNavigate();
  const top = useMemo(
    () => sortedTopFailingChecks(checkIds, findingCountByCheck, max),
    [checkIds, findingCountByCheck, max],
  );

  if (top.length === 0) {
    return (
      <p className="compliance-category-detail__empty-checks">
        No open findings on mapped checks.
      </p>
    );
  }

  return (
    <div className="compliance-category-detail__checks">
      <div className="compliance-category-detail__checks-cols" aria-hidden>
        <span>Check</span>
        <span>Findings</span>
        <span>Severity</span>
      </div>
      <ul className="compliance-category-detail__checks-table">
        {top.map((checkId, index) => {
          const count = findingCountByCheck.get(checkId) ?? 0;
          const severity = severityByCheck.get(checkId) ?? "low";
          const severityLabel = severityDisplayLabel(severity);
          return (
            <li key={checkId}>
              <button
                type="button"
                onClick={() =>
                  navigate(`/findings?checks=${encodeURIComponent(checkId)}`)
                }
                className="compliance-category-detail__checks-row"
              >
                <span className="compliance-category-detail__checks-index">
                  {index + 1}
                </span>
                <span className="compliance-category-detail__checks-name">
                  {labelForCheck(checkId)}
                </span>
                <span className="compliance-category-detail__checks-count">
                  {count}
                </span>
                <span
                  className={`compliance-category-detail__severity compliance-category-detail__severity--${severityLabel.toLowerCase()}`}
                >
                  <span aria-hidden />
                  {severityLabel}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type CoverageOverrideDetail = {
  status: "out_of_scope" | "not_applicable";
  reason: string | null;
  set_by: string | null;
  set_at: string | null;
};

/** Quiet "this doesn't apply to us" affordance inside the gap section. Out of
 *  scope = outside the audit boundary; not applicable = control can't apply to
 *  this stack. Both record a justification for the audit trail. Distinct from
 *  "managed externally", which is the upload-external-evidence path. */
function GapScopeControl({
  compositeId,
  compositeTitle,
  detail,
}: {
  compositeId: string;
  compositeTitle: string;
  detail?: CoverageOverrideDetail | null;
}) {
  const meQ = useMe();
  const qc = useQueryClient();
  const canEdit = roleAtLeast(meQ.data?.role, "admin");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"out_of_scope" | "not_applicable">("out_of_scope");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(next: "out_of_scope" | "not_applicable" | null, why?: string) {
    setSaving(true);
    setError("");
    try {
      await api("/v1/settings", {
        method: "PATCH",
        body: JSON.stringify({
          coverage_overrides: {
            entries: { [compositeId]: { status: next, reason: why ?? null } },
          },
        }),
      });
      await qc.invalidateQueries({ queryKey: ["controls", "composites"] });
      setOpen(false);
      setReason("");
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  }

  if (detail) {
    const label = detail.status === "out_of_scope" ? "Out of scope" : "Not applicable";
    const when = detail.set_at ? new Date(detail.set_at).toLocaleDateString() : null;
    return (
      <div className="compliance-category-detail__scope is-set">
        <div className="compliance-category-detail__scope-head">
          <span className="compliance-category-detail__scope-badge">{label}</span>
          {canEdit ? (
            <button
              type="button"
              className="compliance-category-detail__scope-restore"
              disabled={saving}
              onClick={() => void submit(null)}
            >
              Restore to scope
            </button>
          ) : null}
        </div>
        {detail.reason ? (
          <p className="compliance-category-detail__scope-reason">“{detail.reason}”</p>
        ) : null}
        {detail.set_by || when ? (
          <p className="compliance-category-detail__scope-meta">
            Marked{detail.set_by ? ` by ${detail.set_by}` : ""}
            {when ? ` · ${when}` : ""}
          </p>
        ) : null}
        {error ? <p className="compliance-category-detail__scope-error">{error}</p> : null}
      </div>
    );
  }

  if (!canEdit) return null;

  if (!open) {
    return (
      <div className="compliance-category-detail__scope">
        <span className="compliance-category-detail__scope-prompt">
          Doesn’t apply to your environment?
        </span>
        <button
          type="button"
          className="compliance-category-detail__scope-link"
          onClick={() => setOpen(true)}
        >
          Mark out of scope
        </button>
      </div>
    );
  }

  return (
    <div className="compliance-category-detail__scope is-editing">
      <p className="compliance-category-detail__scope-title">
        Exclude {compositeTitle} from this audit
      </p>
      <div className="compliance-category-detail__scope-options" role="radiogroup">
        <button
          type="button"
          role="radio"
          aria-checked={status === "out_of_scope"}
          className={status === "out_of_scope" ? "is-active" : ""}
          onClick={() => setStatus("out_of_scope")}
        >
          <strong>Out of scope</strong>
          <span>Outside this audit’s boundary</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={status === "not_applicable"}
          className={status === "not_applicable" ? "is-active" : ""}
          onClick={() => setStatus("not_applicable")}
        >
          <strong>Not applicable</strong>
          <span>Control can’t apply to your stack</span>
        </button>
      </div>
      <textarea
        className="compliance-category-detail__scope-reason-input"
        placeholder="Reason (recorded for your auditor) — e.g. handled by an external vulnerability scanner"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
      />
      {error ? <p className="compliance-category-detail__scope-error">{error}</p> : null}
      <div className="compliance-category-detail__scope-actions">
        <button
          type="button"
          className="compliance-category-detail__scope-cancel"
          disabled={saving}
          onClick={() => {
            setOpen(false);
            setError("");
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="compliance-category-detail__scope-confirm"
          disabled={saving || reason.trim() === ""}
          onClick={() => void submit(status, reason.trim())}
        >
          {saving ? "Saving…" : "Mark out of scope"}
        </button>
      </div>
    </div>
  );
}

/** Open-finding counts by severity — shows *why* a category is graded the way
 *  it is (crit/high fail, medium = at risk, low = noted). */
function SeverityBreakdownChip({
  counts,
}: {
  counts?: { critical: number; high: number; medium: number; low: number };
}) {
  if (!counts) return null;
  const items = (
    [
      ["critical", counts.critical],
      ["high", counts.high],
      ["medium", counts.medium],
      ["low", counts.low],
    ] as const
  ).filter(([, n]) => n > 0);
  if (items.length === 0) return null;
  return (
    <div className="compliance-category-detail__sevbar" aria-label="Open findings by severity">
      {items.map(([sev, n]) => (
        <span key={sev} className={`compliance-category-detail__sevbar-item is-${sev}`}>
          <span className="compliance-category-detail__sevbar-dot" aria-hidden />
          {n} {sev}
        </span>
      ))}
    </div>
  );
}

type CrossAccountCoverageDetail = {
  account_id: string;
  reason: string | null;
  expires_at: string | null;
  set_by: string | null;
  set_at: string | null;
  verified: boolean;
};

/** "Covered in another AWS account" — leads with connect-and-verify (we scan
 *  that account and confirm automatically); attest is the fallback when the
 *  account can't be connected yet. Writes the cross_account_coverage rail. */
function CrossAccountCoverageControl({
  compositeId,
  detail,
  open,
  onClose,
  onConnect,
}: {
  compositeId: string;
  detail?: CrossAccountCoverageDetail | null;
  open: boolean;
  onClose: () => void;
  onConnect: () => void;
}) {
  const meQ = useMe();
  const qc = useQueryClient();
  const canEdit = roleAtLeast(meQ.data?.role, "admin");
  const [accountId, setAccountId] = useState("");
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const validId = /^\d{12}$/.test(accountId.trim());

  async function save(opts: { withExpiry: boolean; thenConnect: boolean }) {
    setSaving(true);
    setError("");
    try {
      await api("/v1/settings", {
        method: "PATCH",
        body: JSON.stringify({
          cross_account_coverage: {
            entries: {
              [compositeId]: {
                account_id: accountId.trim(),
                reason: reason.trim() || null,
                expires_at: opts.withExpiry ? expires || null : null,
              },
            },
          },
        }),
      });
      await qc.invalidateQueries({ queryKey: ["controls", "composites"] });
      onClose();
      if (opts.thenConnect) onConnect();
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError("");
    try {
      await api("/v1/settings", {
        method: "PATCH",
        body: JSON.stringify({
          cross_account_coverage: { entries: { [compositeId]: null } },
        }),
      });
      await qc.invalidateQueries({ queryKey: ["controls", "composites"] });
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  }

  if (detail) {
    const when = detail.set_at ? new Date(detail.set_at).toLocaleDateString() : null;
    const expDate = detail.expires_at
      ? new Date(detail.expires_at).toLocaleDateString()
      : null;
    return (
      <div className="compliance-category-detail__scope is-set">
        <div className="compliance-category-detail__scope-head">
          <span
            className={`compliance-category-detail__scope-badge ${detail.verified ? "is-ok" : "is-pending"}`}
          >
            {detail.verified ? "Verified" : "Pending verification"}
          </span>
          {canEdit ? (
            <button
              type="button"
              className="compliance-category-detail__scope-restore"
              disabled={saving}
              onClick={() => void remove()}
            >
              Remove
            </button>
          ) : null}
        </div>
        <p className="compliance-category-detail__account-id">
          AWS account <strong>{detail.account_id}</strong>
        </p>
        {detail.reason ? (
          <p className="compliance-category-detail__scope-reason">“{detail.reason}”</p>
        ) : null}
        {!detail.verified && expDate ? (
          <p className="compliance-category-detail__scope-meta">Attested · expires {expDate}</p>
        ) : null}
        {detail.set_by || when ? (
          <p className="compliance-category-detail__scope-meta">
            Added{detail.set_by ? ` by ${detail.set_by}` : ""}
            {when ? ` · ${when}` : ""}
          </p>
        ) : null}
        {!detail.verified && canEdit ? (
          <div className="compliance-category-detail__scope-actions compliance-category-detail__scope-actions--start">
            <button
              type="button"
              className="compliance-category-detail__scope-confirm"
              onClick={onConnect}
            >
              Connect &amp; verify →
            </button>
          </div>
        ) : null}
        {error ? <p className="compliance-category-detail__scope-error">{error}</p> : null}
      </div>
    );
  }

  if (!open || !canEdit) return null;

  return (
    <div className="compliance-category-detail__scope is-editing">
      <p className="compliance-category-detail__scope-title">Covered in another AWS account</p>
      <p className="compliance-category-detail__account-hint">
        Connect that account and we’ll verify this control automatically on the next scan. Attest in
        the meantime if you can’t connect it yet.
      </p>
      <input
        className="compliance-category-detail__account-input"
        inputMode="numeric"
        placeholder="AWS account ID (12 digits)"
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
      />
      <textarea
        className="compliance-category-detail__scope-reason-input"
        placeholder="How is it covered there? e.g. GuardDuty via delegated admin in the security account"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
      />
      <label className="compliance-category-detail__account-expiry">
        Attestation expiry (optional)
        <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
      </label>
      {error ? <p className="compliance-category-detail__scope-error">{error}</p> : null}
      <div className="compliance-category-detail__scope-actions">
        <button
          type="button"
          className="compliance-category-detail__scope-cancel"
          disabled={saving}
          onClick={() => {
            onClose();
            setError("");
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="compliance-category-detail__scope-cancel"
          disabled={saving || !validId}
          onClick={() => void save({ withExpiry: true, thenConnect: false })}
        >
          Attest for now
        </button>
        <button
          type="button"
          className="compliance-category-detail__scope-confirm"
          disabled={saving || !validId}
          onClick={() => void save({ withExpiry: false, thenConnect: true })}
        >
          {saving ? "Saving…" : "Connect & verify →"}
        </button>
      </div>
    </div>
  );
}

function CompositeCategoryDetailPanel({
  ctrl,
  findingCountByCheck,
  severityByCheck,
  framework,
  frameworkRows,
  accountId,
  acceptedCompositeIds,
  submittedCount = 0,
  expiredCompositeIds,
}: {
  ctrl: CompositeControlRow;
  findingCountByCheck: Map<string, number>;
  severityByCheck: Map<string, string>;
  framework: string;
  frameworkRows: ControlRow[];
  accountId?: string | null;
  acceptedCompositeIds: Set<string>;
  submittedCount?: number;
  expiredCompositeIds?: Set<string>;
}) {
  const navigate = useNavigate();
  const evidenceRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const [showEvidencePanel, setShowEvidencePanel] = useState(false);
  const [accountFormOpen, setAccountFormOpen] = useState(false);
  const displayStatus = compositeDisplayStatus(
    ctrl,
    findingCountByCheck,
    acceptedCompositeIds.has(ctrl.id),
    expiredCompositeIds?.has(ctrl.id),
  );
  const findingsHref = findingsHrefForChecks(
    ctrl.check_ids,
    findingCountByCheck,
  );
  const awsFixHref =
    findingsHrefForAbsenceGaps(ctrl.check_ids, findingCountByCheck) ??
    findingsHref;
  const overrideDetail = ctrl.coverage_override_detail ?? null;
  const crossAccountDetail = ctrl.cross_account_coverage_detail ?? null;
  const failingCheckCount = ctrl.check_ids.filter(
    (c) => (findingCountByCheck.get(c) ?? 0) > 0,
  ).length;
  const underlyingCriteria = underlyingCriteriaForComposite(ctrl, frameworkRows);
  const criteriaCount = underlyingCriteria.length;
  // Absence gaps = an AWS service is simply off (…not_enabled/.not_detected/.missing).
  // Those can be closed by enabling the service, by central coverage in another
  // account, or by external evidence. Everything else is a real failing check
  // that must be remediated in AWS — no evidence shortcut.
  const absenceChecks = openAbsenceGapChecks(ctrl.check_ids, findingCountByCheck);
  const hasAbsenceGaps = absenceChecks.length > 0;
  const enableItems = absenceGapEnableItems(ctrl.check_ids, findingCountByCheck);
  // "Covered in another AWS account" only applies to gaps a different account
  // can satisfy that we can't auto-detect from this member (IAM Access Analyzer).
  const crossAccountEligible =
    openCrossAccountCoverableChecks(ctrl.check_ids, findingCountByCheck).length > 0;
  const regularFailing = Math.max(0, failingCheckCount - absenceChecks.length);
  const isExternalOnly = ctrl.check_ids.length === 0;
  const isVerified = displayStatus === "passing";
  const isAtRisk = ctrl.status === "at_risk";
  // Step columns present (Fix in AWS + each absence-gap "enable" card); the
  // "Other ways" column is always rendered. Drives the grid template so it never
  // leaves empty columns when there's nothing beyond step 1.
  const workflowCols = (isExternalOnly ? 0 : 1) + (enableItems.length > 0 ? 1 : 0) + 1;
  const detailCoveragePct =
    isVerified || acceptedCompositeIds.has(ctrl.id) || overrideDetail ? 100 : 0;

  return (
    <aside className="compliance-category-detail" aria-label={ctrl.title}>
      <div className="compliance-category-detail__severity-row">
        <SeverityBreakdownChip counts={ctrl.severity_counts} />
      </div>

      <section className="compliance-category-detail__checks-section">
        <div className="compliance-category-detail__checks-heading">
          <div>
            <h4>Blocking gaps</h4>
            <p>Highest-impact checks blocking this category.</p>
          </div>
          {findingsHref ? (
            <button
              type="button"
              onClick={() => navigate(findingsHref)}
              className="compliance-top-checks__view-all"
            >
              View all
            </button>
          ) : null}
        </div>
        <TopFailingChecksSeverityTable
          checkIds={ctrl.check_ids}
          findingCountByCheck={findingCountByCheck}
          severityByCheck={severityByCheck}
        />
      </section>

      {underlyingCriteria.length > 0 ? (
        <section className="compliance-category-detail__criteria">
          <div className="compliance-category-detail__checks-heading">
            <div>
              <h4>Controls</h4>
              <p>Framework criteria mapped to this category.</p>
            </div>
          </div>
          <div className="compliance-category-detail__criteria-list">
            {underlyingCriteria.slice(0, 10).map((criterion) => {
              const params = new URLSearchParams({
                framework,
                control: criterion.control_id,
                composite: ctrl.id,
                view: "detailed",
              });
              if (accountId) params.set("account_id", accountId);
              const openFindings = criterion.check_ids.reduce(
                (sum, checkId) => sum + (findingCountByCheck.get(checkId) ?? 0),
                0,
              );
              return (
                <Link
                  key={criterion.id}
                  to={`/controls?${params}`}
                  className="compliance-category-detail__criteria-link"
                >
                  <FrameworkMark
                    framework={framework}
                    className="compliance-category-detail__criteria-mark"
                  />
                  <span className="compliance-category-detail__criteria-code">
                    {frameworkControlLabel(framework, criterion.control_id)}
                  </span>
                  <span className="compliance-category-detail__criteria-title">
                    {shortControlTitle(criterion.title)}
                  </span>
                  {openFindings > 0 ? (
                    <span className="compliance-category-detail__criteria-count">
                      {openFindings}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {overrideDetail ? (
        <section className="compliance-category-detail__nextsteps">
          <div className="compliance-category-detail__nextsteps-head">
            <div>
              <h4>Audit scope</h4>
              <p>Excluded from your compliance score — won’t count as a gap.</p>
            </div>
          </div>
          <GapScopeControl
            compositeId={ctrl.id}
            compositeTitle={ctrl.title}
            detail={overrideDetail}
          />
        </section>
      ) : crossAccountDetail ? (
        <section className="compliance-category-detail__nextsteps">
          <div className="compliance-category-detail__nextsteps-head">
            <div>
              <h4>Covered in another AWS account</h4>
              <p>
                {crossAccountDetail.verified
                  ? "Verified from a connected account on the latest scan."
                  : "Pending — connect that account and we’ll confirm it automatically."}
              </p>
            </div>
          </div>
          <CrossAccountCoverageControl
            compositeId={ctrl.id}
            detail={crossAccountDetail}
            open={false}
            onClose={() => setAccountFormOpen(false)}
            onConnect={() => navigate("/accounts")}
          />
        </section>
      ) : isVerified ? (
        <section className="compliance-category-detail__nextsteps compliance-category-detail__nextsteps--ok">
          <div className="compliance-category-detail__nextsteps-head">
            <div>
              <h4>All automated checks pass</h4>
              <p>Veritrail verifies this category directly from your AWS account. Nothing to do.</p>
            </div>
          </div>
        </section>
      ) : (
        <section className="compliance-category-detail__nextsteps">
          <div className="compliance-category-detail__nextsteps-head">
            <div>
              <h4>Next steps</h4>
              <p>
                {isAtRisk
                  ? "Only medium-severity findings are open. Remediate them to clear the category."
                  : isExternalOnly
                    ? "AWS can’t check this — add your own proof."
                  : hasAbsenceGaps
                      ? "A required AWS service isn’t active. Choose the cleanest path to satisfy it."
                      : "Fix the failing checks in your AWS environment."}
              </p>
            </div>
          </div>
          <div
            className={`compliance-category-detail__workflow compliance-category-detail__workflow--cols-${workflowCols}`}
          >
            {!isExternalOnly ? (
              <div className="compliance-category-detail__workflow-card compliance-category-detail__workflow-card--fix">
                <span className="compliance-category-detail__step-index">1</span>
                <button
                  type="button"
                  className="compliance-category-detail__resolve-main"
                  onClick={() => {
                    if (findingsHref) navigate(findingsHref);
                  }}
                  disabled={!findingsHref}
                >
                  <span className="compliance-category-detail__action-icon compliance-category-detail__action-icon--aws">
                    <svg
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.75}
                      viewBox="0 0 24 24"
                      aria-hidden
                    >
                      <path d="M14.7 6.3a4.3 4.3 0 0 0-6.08 5.55L4 16.48V20h3.52l4.63-4.62A4.3 4.3 0 1 0 14.7 6.3Z" />
                      <path d="m14.5 8.5 1 1" />
                    </svg>
                  </span>
                  <span className="compliance-category-detail__action-copy">
                    <strong>
                      {hasAbsenceGaps && regularFailing === 0
                        ? "Enable in AWS"
                        : "Fix in AWS"}
                    </strong>
                    <span>Address the failing checks directly in your AWS environment.</span>
                    {regularFailing > 0 ? (
                      <span className="compliance-category-detail__action-badge compliance-category-detail__action-badge--warn">
                        {regularFailing} failing check{regularFailing === 1 ? "" : "s"}
                      </span>
                    ) : !hasAbsenceGaps ? (
                      <span className="compliance-category-detail__action-badge compliance-category-detail__action-badge--neutral">
                        Re-scan needed
                      </span>
                    ) : null}
                  </span>
                </button>
              </div>
            ) : null}

            {enableItems.length > 0 ? (
              <div className="compliance-category-detail__workflow-card compliance-category-detail__workflow-card--enable">
                <span className="compliance-category-detail__step-index">2</span>
                <p className="compliance-category-detail__services-label">
                  Turn these on — we re-check automatically
                </p>
                {enableItems.map((item) => (
                  <div key={item.checkId} className="compliance-category-detail__service-row">
                    <span className="compliance-category-detail__service-name">
                      {item.capability}
                    </span>
                    <button
                      type="button"
                      className="compliance-category-detail__service-cta"
                      onClick={() => {
                        if (item.consoleUrl) {
                          window.open(item.consoleUrl, "_blank", "noopener,noreferrer");
                          return;
                        }
                        navigate(`/findings?checks=${encodeURIComponent(item.checkId)}`);
                      }}
                    >
                      Enable & Re-check
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="compliance-category-detail__workflow-other">
              <p className="compliance-category-detail__other-label">Other ways to satisfy</p>
              {crossAccountEligible ? (
                <button
                  type="button"
                  className="compliance-category-detail__alt-row"
                  onClick={() => {
                    setAccountFormOpen(true);
                    requestAnimationFrame(() =>
                      accountRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
                    );
                  }}
                >
                  <span className="compliance-category-detail__alt-icon" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M5 21V8l7-4 7 4v13M9.5 21v-4h5v4M9 11h.01M15 11h.01" />
                    </svg>
                  </span>
                  <span className="compliance-category-detail__alt-text">
                    <strong>Covered in another AWS account</strong>
                    <span>Managed centrally in an account we don’t scan yet — auto-verified.</span>
                  </span>
                  <span className="compliance-category-detail__alt-chevron" aria-hidden>›</span>
                </button>
              ) : null}
              {hasAbsenceGaps || isExternalOnly ? (
                <button
                  type="button"
                  className="compliance-category-detail__alt-row"
                  onClick={() => {
                    setShowEvidencePanel(true);
                    requestAnimationFrame(() =>
                      evidenceRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
                    );
                  }}
                >
                  <span className="compliance-category-detail__alt-icon" aria-hidden>
                    <svg fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16.5a4 4 0 0 1-.8-7.92 5 5 0 0 1 9.6-1.4A3.5 3.5 0 0 1 17 16.5" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 12v7m0-7-2.25 2.25M12 12l2.25 2.25" />
                    </svg>
                  </span>
                  <span className="compliance-category-detail__alt-text">
                    <strong>Upload external evidence</strong>
                    <span>Proof for checks managed outside of AWS{criteriaCount > 0 ? ` · ${criteriaCount} criteria` : ""}.</span>
                  </span>
                  <span className="compliance-category-detail__alt-chevron" aria-hidden>›</span>
                </button>
              ) : null}
              <GapScopeControl
                compositeId={ctrl.id}
                compositeTitle={ctrl.title}
                detail={overrideDetail}
              />
            </div>
          </div>
          {accountFormOpen ? (
            <div ref={accountRef} className="compliance-category-detail__inline-form">
              <CrossAccountCoverageControl
                compositeId={ctrl.id}
                detail={null}
                open
                onClose={() => setAccountFormOpen(false)}
                onConnect={() => navigate("/accounts")}
              />
            </div>
          ) : null}
          <div className="compliance-category-detail__help">
            <span className="compliance-category-detail__help-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.7.25-1.2.9-1.2 1.6v.5M12 17h.01" />
              </svg>
            </span>
            <span className="compliance-category-detail__help-copy">
              <strong>Need help with this control?</strong>
              <span>Review our guidance and remediation best practices.</span>
            </span>
            <span className="compliance-category-detail__help-cta" aria-disabled="true">
              View guidance
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 17 17 7M7 7h10v10" />
              </svg>
            </span>
          </div>
        </section>
      )}

      {showEvidencePanel ? (
        <div ref={evidenceRef} className="compliance-category-detail__evidence">
          <ExternalEvidencePanel
            compositeId={ctrl.id}
            compositeTitle={ctrl.title}
            framework={framework}
            groupStatus={ctrl.status}
            checkIds={ctrl.check_ids}
            findingCountByCheck={findingCountByCheck}
            underlyingCriteria={underlyingCriteria}
            frameworkControlLabel={(controlId) =>
              frameworkControlLabel(framework, controlId)
            }
          />
        </div>
      ) : null}
    </aside>
  );
}

const EXTERNAL_ONLY_COMPLIANCE_ROWS = [
  {
    id: "endpoint_security",
    title: "Endpoint security",
    description: "Requires external endpoint security or EDR evidence.",
  },
  {
    id: "mdm_endpoint",
    title: "Device management (MDM)",
    description: "Requires external mobile-device management evidence.",
  },
];

function externalOnlyCompositeRow(
  row: (typeof EXTERNAL_ONLY_COMPLIANCE_ROWS)[number],
): CompositeControlRow {
  return {
    id: row.id,
    control_id: row.id,
    title: row.title,
    description: row.description,
    guidance: null,
    soc2_criteria: [],
    check_ids: [],
    status: "no_data",
    finding_count: 0,
    open_finding_ids: [],
  };
}

function CompositeControlsPanel({
  rows,
  findingCountByCheck,
  severityByCheck,
  expandedId,
  onToggle,
  framework,
  frameworkRows,
  accountId,
  acceptedCompositeIds,
  submittedCountByComposite,
  expiredCompositeIds,
  statusFilter,
}: {
  rows: CompositeControlRow[];
  findingCountByCheck: Map<string, number>;
  severityByCheck: Map<string, string>;
  expandedId: string | null;
  onToggle: (id: string | null) => void;
  framework: string;
  frameworkRows: ControlRow[];
  accountId?: string | null;
  acceptedCompositeIds: Set<string>;
  submittedCountByComposite: Map<string, number>;
  expiredCompositeIds: Set<string>;
  statusFilter: StatusFilter;
}) {
  const navigate = useNavigate();
  const treeRows = useMemo(() => prepareCompositeTreeRows(rows), [rows]);
  const externalOnlyRows = useMemo(() => {
    if (statusFilter !== "all" && statusFilter !== "needs_evidence") return [];
    const visibleIds = new Set(rows.map((row) => row.id));
    return EXTERNAL_ONLY_COMPLIANCE_ROWS.filter(
      (row) => !visibleIds.has(row.id),
    );
  }, [rows, statusFilter]);
  const visibleTreeRows = treeRows;
  const visibleExternalRows = externalOnlyRows;

  const selectedCtrl = useMemo(() => {
    if (!expandedId) return null;
    const fromTree = rows.find((row) => row.id === expandedId);
    if (fromTree) return fromTree;
    const external = EXTERNAL_ONLY_COMPLIANCE_ROWS.find(
      (row) => row.id === expandedId,
    );
    if (!external) return null;
    return externalOnlyCompositeRow(external);
  }, [expandedId, rows]);

  useEffect(() => {
    const visibleIds = new Set([
      ...visibleTreeRows.map(({ row }) => row.id),
      ...visibleTreeRows.flatMap(({ child }) => (child ? [child.id] : [])),
      ...visibleExternalRows.map((row) => row.id),
    ]);
    if (expandedId && visibleIds.has(expandedId)) return;
    if (expandedId) onToggle(null);
  }, [expandedId, onToggle, visibleTreeRows, visibleExternalRows]);

  if (treeRows.length === 0 && externalOnlyRows.length === 0) return null;

  return (
    <div className="compliance-category-board">
      <div className="compliance-category-board__list">
        {visibleTreeRows.map(({ row: ctrl, child }) => {
          const isSelected = expandedId === ctrl.id;
          const displayStatus = compositeDisplayStatus(
            ctrl,
            findingCountByCheck,
            acceptedCompositeIds.has(ctrl.id),
            expiredCompositeIds.has(ctrl.id),
          );
          const findingsHref = findingsHrefForChecks(
            ctrl.check_ids,
            findingCountByCheck,
          );
          const failingChecks = ctrl.check_ids.filter(
            (checkId) => (findingCountByCheck.get(checkId) ?? 0) > 0,
          ).length;

          return (
            <div
              key={ctrl.id}
              className={`compliance-control-card${isSelected ? " is-expanded" : ""}`}
            >
              <button
                type="button"
                onClick={() => onToggle(isSelected ? null : ctrl.id)}
                aria-expanded={isSelected}
                className="compliance-control-card__summary"
              >
                <div className="compliance-control-card__main">
                  <span
                    className={`compliance-control-card__chevron${isSelected ? " is-open" : ""}`}
                    aria-hidden
                  >
                    ›
                  </span>
                  <CompositeGroupIcon id={ctrl.id} />
                  <div className="compliance-control-card__title">
                    <h3>{ctrl.title}</h3>
                    <p>{ctrl.description}</p>
                  </div>
                </div>

                <div className="compliance-control-card__facts" aria-label="Category summary">
                  <span>
                    <small>Automated</small>
                    <strong>{compositeAutomatedSummary(ctrl, displayStatus)}</strong>
                  </span>
                  <span>
                    <small>External</small>
                    <strong>
                      {compositeExternalSummary(
                        ctrl,
                        acceptedCompositeIds,
                        submittedCountByComposite,
                      )}
                    </strong>
                  </span>
                  <span>
                    <small>Blocking</small>
                    <strong>{failingChecks}</strong>
                  </span>
                </div>

                <div className="compliance-control-card__state">
                  <ComplianceRowSummary
                    displayStatus={displayStatus}
                    href={findingsHref}
                    onNavigate={(href) => navigate(href)}
                  />
                </div>
              </button>

              {isSelected && selectedCtrl ? (
                <div className="compliance-control-card__detail">
                  <CompositeCategoryDetailPanel
                    key={selectedCtrl.id}
                    ctrl={selectedCtrl}
                    findingCountByCheck={findingCountByCheck}
                    severityByCheck={severityByCheck}
                    framework={framework}
                    frameworkRows={frameworkRows}
                    accountId={accountId}
                    acceptedCompositeIds={acceptedCompositeIds}
                    submittedCount={submittedCountByComposite.get(selectedCtrl.id) ?? 0}
                    expiredCompositeIds={expiredCompositeIds}
                  />
                </div>
              ) : null}

              {child && compositeAppliesToFramework(child, frameworkRows) ? (
                <div className="compliance-control-card__child-wrap">
                  {(() => {
                    const childSelected = expandedId === child.id;
                    const childDisplayStatus = compositeDisplayStatus(
                      child,
                      findingCountByCheck,
                      acceptedCompositeIds.has(child.id),
                      expiredCompositeIds.has(child.id),
                    );
                    const childFindingsHref = findingsHrefForChecks(
                      child.check_ids,
                      findingCountByCheck,
                    );
                    const childDisplay = NESTED_COMPOSITE_DISPLAY[child.id];
                    const childFailingChecks = child.check_ids.filter(
                      (checkId) => (findingCountByCheck.get(checkId) ?? 0) > 0,
                    ).length;

                    return (
                      <div className={`compliance-control-card compliance-control-card--child${childSelected ? " is-expanded" : ""}`}>
                        <button
                          type="button"
                          onClick={() => onToggle(childSelected ? null : child.id)}
                          aria-expanded={childSelected}
                          className="compliance-control-card__summary"
                        >
                          <div className="compliance-control-card__main">
                            <span
                              className={`compliance-control-card__chevron${childSelected ? " is-open" : ""}`}
                              aria-hidden
                            >
                              ›
                            </span>
                            <CompositeGroupIcon id={child.id} />
                            <div className="compliance-control-card__title">
                              <h3>{childDisplay?.title ?? child.title}</h3>
                              <p>{childDisplay?.hint ?? child.description}</p>
                            </div>
                          </div>
                          <div className="compliance-control-card__facts" aria-label="Category summary">
                            <span>
                              <small>Automated</small>
                              <strong>{compositeAutomatedSummary(child, childDisplayStatus)}</strong>
                            </span>
                            <span>
                              <small>External</small>
                              <strong>
                                {compositeExternalSummary(
                                  child,
                                  acceptedCompositeIds,
                                  submittedCountByComposite,
                                )}
                              </strong>
                            </span>
                            <span>
                              <small>Blocking</small>
                              <strong>{childFailingChecks}</strong>
                            </span>
                          </div>
                          <div className="compliance-control-card__state">
                            <ComplianceRowSummary
                              displayStatus={childDisplayStatus}
                              href={childFindingsHref}
                              onNavigate={(href) => navigate(href)}
                            />
                          </div>
                        </button>
                        {childSelected && selectedCtrl ? (
                          <div className="compliance-control-card__detail">
                            <CompositeCategoryDetailPanel
                              key={selectedCtrl.id}
                              ctrl={selectedCtrl}
                              findingCountByCheck={findingCountByCheck}
                              severityByCheck={severityByCheck}
                              framework={framework}
                              frameworkRows={frameworkRows}
                              accountId={accountId}
                              acceptedCompositeIds={acceptedCompositeIds}
                              submittedCount={submittedCountByComposite.get(selectedCtrl.id) ?? 0}
                              expiredCompositeIds={expiredCompositeIds}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}
                </div>
              ) : null}
            </div>
          );
        })}

        {visibleExternalRows.map((row) => {
          const isSelected = expandedId === row.id;
          const selectedExternalCtrl =
            isSelected && selectedCtrl ? selectedCtrl : externalOnlyCompositeRow(row);

          return (
            <div
              key={row.id}
              className={`compliance-control-card${isSelected ? " is-expanded" : ""}`}
            >
              <button
                type="button"
                onClick={() => onToggle(isSelected ? null : row.id)}
                aria-expanded={isSelected}
                className="compliance-control-card__summary"
              >
                <div className="compliance-control-card__main">
                  <span
                    className={`compliance-control-card__chevron${isSelected ? " is-open" : ""}`}
                    aria-hidden
                  >
                    ›
                  </span>
                  <CompositeGroupIcon id={row.id} />
                  <div className="compliance-control-card__title">
                    <h3>{row.title}</h3>
                    <p>{row.description}</p>
                  </div>
                </div>
                <div className="compliance-control-card__facts" aria-label="Category summary">
                  <span>
                    <small>Automated</small>
                    <strong>Not available from AWS</strong>
                  </span>
                  <span>
                    <small>External</small>
                    <strong>None</strong>
                  </span>
                  <span>
                    <small>Blocking</small>
                    <strong>0</strong>
                  </span>
                </div>
                <div className="compliance-control-card__state">
                  <ComplianceRowSummary
                    displayStatus="needs_evidence"
                    href={null}
                    onNavigate={(href) => navigate(href)}
                  />
                </div>
              </button>
              {isSelected ? (
                <div className="compliance-control-card__detail">
                  <CompositeCategoryDetailPanel
                    key={selectedExternalCtrl.id}
                    ctrl={selectedExternalCtrl}
                    findingCountByCheck={findingCountByCheck}
                    severityByCheck={severityByCheck}
                    framework={framework}
                    frameworkRows={frameworkRows}
                    accountId={accountId}
                    acceptedCompositeIds={acceptedCompositeIds}
                    submittedCount={submittedCountByComposite.get(selectedExternalCtrl.id) ?? 0}
                    expiredCompositeIds={expiredCompositeIds}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-10 rounded-xl border border-zinc-200 bg-zinc-50" />
      <div className="h-96 rounded-2xl border border-zinc-200 bg-zinc-50" />
    </div>
  );
}

function checkGroupLabel(id: string): string {
  if (id.startsWith("github.")) return "GitHub";
  if (id.startsWith("gitlab.")) return "GitLab";
  if (id.startsWith("entra.")) return "Entra";
  if (id.startsWith("google_workspace.")) return "Google_workspace";
  if (id.startsWith("identity_center.")) return "Identity_center";
  if (id.startsWith("iam.")) return "IAM";
  if (id.startsWith("s3.")) return "S3";
  if (id.startsWith("kms.")) return "KMS";
  if (id.startsWith("cloudtrail.")) return "CloudTrail";
  if (id.startsWith("ec2.")) return "EC2";
  if (id.startsWith("rds.")) return "RDS";
  if (id.startsWith("guardduty.")) return "GuardDuty";
  if (id.startsWith("aws.")) return "AWS";
  if (id.startsWith("vpc.")) return "VPC";
  if (id.startsWith("lambda.")) return "Lambda";
  if (id.startsWith("dynamodb.")) return "DynamoDB";
  if (id.startsWith("ecr.")) return "ECR";
  if (id.startsWith("eks.")) return "EKS";
  if (id.startsWith("ecs.")) return "ECS";
  if (id.startsWith("acm.")) return "ACM";
  if (id.startsWith("elb.")) return "ELB";
  if (id.startsWith("secretsmanager.")) return "Secrets";
  if (id.startsWith("ssm.")) return "SSM";
  if (id.startsWith("sns.")) return "SNS";
  if (id.startsWith("sqs.")) return "SQS";
  const prefix = id.split(".")[0] ?? id;
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

const CHECK_GROUP_ORDER = [
  "IAM",
  "GitHub",
  "GitLab",
  "Entra",
  "Google_workspace",
  "Identity_center",
  "S3",
  "KMS",
  "CloudTrail",
  "EC2",
  "RDS",
  "Lambda",
  "DynamoDB",
  "ECR",
  "EKS",
  "ECS",
  "ACM",
  "ELB",
  "Secrets",
  "SSM",
  "SNS",
  "SQS",
  "GuardDuty",
  "AWS",
  "VPC",
];

function groupCheckIds(checkIds: string[]) {
  const groups = new Map<string, string[]>();
  for (const id of checkIds) {
    const label = checkGroupLabel(id);
    const list = groups.get(label) ?? [];
    list.push(id);
    groups.set(label, list);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => {
    const ai = CHECK_GROUP_ORDER.indexOf(a);
    const bi = CHECK_GROUP_ORDER.indexOf(b);
    if (ai !== -1 || bi !== -1)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.localeCompare(b);
  });
}

const EVIDENCE_CLASS_LABELS: Record<string, string> = {
  benchmark: "Benchmark",
  supporting: "Supporting",
  hygiene: "Hygiene",
};

function EvidenceClassBadge({ evidenceClass }: { evidenceClass?: string }) {
  if (!evidenceClass || evidenceClass === "benchmark") return null;
  const label = EVIDENCE_CLASS_LABELS[evidenceClass] ?? evidenceClass;
  const styles =
    evidenceClass === "supporting"
      ? "bg-sky-50 text-sky-800 ring-sky-200/70"
      : "bg-zinc-100 text-zinc-600 ring-zinc-200/80";
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${styles}`}
    >
      {label}
    </span>
  );
}

const EMPTY_CHECK_COUNTS = new Map<string, number>();

function MappedChecksList({
  checkIds,
  checkEvidenceClasses = {},
  findingCountByCheck = EMPTY_CHECK_COUNTS,
  findingsOnly = false,
  hideHeader = false,
}: {
  checkIds: string[];
  checkEvidenceClasses?: Record<string, string>;
  findingCountByCheck?: Map<string, number>;
  findingsOnly?: boolean;
  hideHeader?: boolean;
}) {
  const navigate = useNavigate();
  const sortedCheckIds = useMemo(
    () =>
      [...checkIds].sort(
        (a, b) =>
          (findingCountByCheck.get(b) ?? 0) - (findingCountByCheck.get(a) ?? 0),
      ),
    [checkIds, findingCountByCheck],
  );
  const visibleIds = useMemo(
    () =>
      findingsOnly
        ? sortedCheckIds.filter((id) => (findingCountByCheck.get(id) ?? 0) > 0)
        : sortedCheckIds,
    [findingsOnly, sortedCheckIds, findingCountByCheck],
  );
  const grouped = useMemo(() => groupCheckIds(visibleIds), [visibleIds]);

  if (findingsOnly && visibleIds.length === 0) {
    return null;
  }

  const inner = (
    <div className={hideHeader ? "" : "mt-2.5 space-y-2.5"}>
      {grouped.map(([group, ids]) => (
        <div key={group}>
          <p className="mb-1.5 text-xs font-semibold text-zinc-700">{group}</p>
          <ul className="overflow-hidden rounded-lg border border-zinc-200 bg-white divide-y divide-zinc-100">
            {ids.map((cid) => {
              const openCount = findingCountByCheck.get(cid) ?? 0;
              return (
                <li key={cid}>
                  <button
                    type="button"
                    title={cid}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() =>
                      navigate(`/findings?checks=${encodeURIComponent(cid)}`)
                    }
                    className="group flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-zinc-50/80"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-snug text-zinc-900 group-hover:text-indigo-700">
                        {labelForCheck(cid)}
                        {openCount > 0 && (
                          <span className="ml-1.5 tabular-nums text-rose-600/80">
                            ({openCount})
                          </span>
                        )}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <EvidenceClassBadge
                          evidenceClass={checkEvidenceClasses[cid]}
                        />
                      </div>
                    </div>
                    <svg
                      className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition-colors group-hover:text-indigo-500"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M8.25 4.5l7.5 7.5-7.5 7.5"
                      />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );

  if (hideHeader) return inner;

  return (
    <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/40 p-3.5">
      <p className="veritrail-kicker">Findings</p>
      <p className="mt-0.5 text-xs text-zinc-500">
        Open findings by mapped check · click to filter in Findings
      </p>
      {inner}
    </div>
  );
}

function CoverageProgressBar({
  coverageDays,
  coverageTotal,
  coveragePct,
  barFillClass,
  className = "h-2.5",
}: {
  coverageDays: number;
  coverageTotal: number;
  coveragePct: number;
  barFillClass: string;
  className?: string;
}) {
  return (
    <div
      className={`${className} overflow-hidden rounded-full bg-zinc-200/70`}
      role="progressbar"
      aria-valuenow={coveragePct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${coverageDays} of ${coverageTotal} audit days with evidence (${coveragePct}%)`}
    >
      <div
        className={`h-full rounded-full bg-gradient-to-r ${barFillClass} transition-all`}
        style={{ width: `${Math.max(coveragePct, coveragePct > 0 ? 2 : 0)}%` }}
      />
    </div>
  );
}

function CalendarIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={`${className} shrink-0 text-zinc-400`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z"
      />
    </svg>
  );
}

function ControlStatusPill({
  status,
  compact = false,
}: {
  status: ControlRow["status"];
  compact?: boolean;
}) {
  const styles = {
    pass: {
      pill: compact
        ? "bg-emerald-50/80 text-emerald-800 ring-emerald-200/60"
        : "bg-emerald-50 text-emerald-800 ring-emerald-200/70",
      dot: "bg-emerald-500",
      icon: "text-emerald-600",
    },
    fail: {
      pill: compact
        ? "bg-amber-50/80 text-amber-900 ring-amber-200/60"
        : "bg-amber-50 text-amber-900 ring-amber-200/70",
      dot: "bg-amber-500",
      icon: "text-amber-600",
    },
    at_risk: {
      pill: compact
        ? "bg-amber-50/80 text-amber-800 ring-amber-200/60"
        : "bg-amber-50 text-amber-800 ring-amber-200/70",
      dot: "bg-amber-500",
      icon: "text-amber-600",
    },
    no_data: {
      pill: compact
        ? "bg-zinc-100 text-zinc-600 ring-zinc-200/70"
        : "bg-zinc-100 text-zinc-600 ring-zinc-200/80",
      dot: "bg-zinc-400",
      icon: "text-zinc-500",
    },
  }[status];

  const label =
    status === "pass"
      ? "Passing"
      : status === "fail"
        ? "Failing"
        : status === "at_risk"
          ? "At risk"
          : "Not evaluated";

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${styles.pill}`}
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${styles.dot}`}
          aria-hidden
        />
        {label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${styles.pill}`}
    >
      {status === "fail" ? (
        <svg
          className={`h-3.5 w-3.5 shrink-0 ${styles.icon}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M8 12h8M12 8v8" />
        </svg>
      ) : status === "pass" ? (
        <svg
          className={`h-3.5 w-3.5 shrink-0 ${styles.icon}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
          />
        </svg>
      ) : (
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${styles.dot}`}
          aria-hidden
        />
      )}
      {label}
    </span>
  );
}

function ControlDetailHeader({
  control,
  coverage,
  periodDays,
}: {
  control: ControlRow;
  coverage?: EvidenceCoverage;
  periodDays: number;
}) {
  const coveragePct = coverage
    ? Math.min(100, Math.round(coverage.coverage_ratio * 100))
    : null;
  const scans = coverage?.successful_scans_in_period ?? null;
  const findings =
    control.status === "fail"
      ? control.finding_count
      : control.status === "pass"
        ? 0
        : null;

  return (
    <div className="control-detail-header">
      <div className="control-detail-header__copy">
        <div className="control-detail-header__eyebrow">
          {control.control_id}
        </div>
        <h3>{shortControlTitle(control.title)}</h3>
        {control.description ? <p>{control.description}</p> : null}
      </div>
      <div className="control-detail-header__metrics">
        <ControlStatusPill status={control.status} compact />
        {findings != null ? (
          <span>
            <strong>{findings}</strong>
            {findings === 1 ? " finding" : " findings"}
          </span>
        ) : null}
        {scans != null ? (
          <span>
            <strong>{scans}</strong>
            {scans === 1 ? " scan" : " scans"}
          </span>
        ) : null}
        {coveragePct != null ? (
          <span>
            <strong>{coveragePct}%</strong>
            evidence
          </span>
        ) : (
          <span>
            <strong>{periodDays}</strong>
            day window
          </span>
        )}
      </div>
    </div>
  );
}

function ControlDetailSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="control-detail-section">
      <div className="control-detail-section__head">
        <h4>{title}</h4>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className="control-detail-section__body">{children}</div>
    </section>
  );
}

function ControlStatusBlock({
  control,
  periodDays,
  coverage,
  controlId,
  framework,
  accountId,
}: {
  control: ControlRow;
  periodDays: number;
  coverage?: EvidenceCoverage;
  controlId: string;
  framework: string;
  accountId: string;
}) {
  const history = useQuery({
    queryKey: ["control-history", controlId, framework, accountId, periodDays],
    queryFn: () =>
      api<ControlHistory>(
        `/v1/controls/${encodeURIComponent(controlId)}/history?framework=${framework}&account_id=${accountId}&days=${periodDays}`,
      ),
    enabled: !!accountId && control.check_ids.length > 0,
  });

  const h = history.data;

  const scans = coverage?.successful_scans_in_period;
  const coverageDays = coverage?.days_with_data ?? 0;
  const coverageTotal = coverage?.days_requested ?? periodDays;
  const coveragePct = coverage
    ? Math.min(100, Math.round(coverage.coverage_ratio * 100))
    : 0;
  const evidenceUi = frameworkEvidenceUi(framework, coverage, periodDays);
  const showEvidence = showControlEvidenceSection(framework);

  let statusSubline: string | null = null;
  if (h?.current_status === "fail") {
    if (h.failing_since)
      statusSubline = `Since ${formatEvidenceDate(h.failing_since)}`;
    else if (h.days_failing != null) {
      statusSubline = `Failing for ${h.days_failing} day${h.days_failing === 1 ? "" : "s"}`;
    }
  } else if (h?.current_status === "pass") {
    statusSubline = null;
  }

  const findingsCount =
    control.status === "fail"
      ? control.finding_count
      : control.status === "pass"
        ? 0
        : null;

  const barFillClass =
    coveragePct >= 80
      ? "from-emerald-500 to-emerald-600"
      : coveragePct >= 40
        ? "from-amber-400 to-amber-500"
        : "from-orange-400 to-orange-500";

  const coverageGuidance =
    evidenceUi.guidanceLine ??
    (controlEvidenceUsesType2Bar(framework) && coveragePct < 85
      ? "Collect more audit days to improve coverage and demonstrate compliance."
      : null);

  const evidenceTitle =
    framework === "soc2"
      ? "Evidence coverage"
      : controlEvidenceSectionTitle(framework);
  const compactStatus = framework !== "soc2";

  return (
    <div className="control-status-panel">
      <div
        className={`grid grid-cols-1 ${showEvidence ? "lg:grid-cols-2 lg:divide-x lg:divide-zinc-100" : ""}`}
      >
        <div className={compactStatus ? "px-4 py-3" : "p-4"}>
          <p className="text-sm font-semibold text-zinc-950">Control status</p>
          <div className={`${compactStatus ? "mt-2" : "mt-3"} w-fit`}>
            <ControlStatusPill
              status={control.status}
              compact={compactStatus}
            />
          </div>
          <div className={`space-y-1.5 ${compactStatus ? "mt-2" : "mt-3"}`}>
            {statusSubline ? (
              <div className="flex items-center gap-2 text-sm text-zinc-600">
                <CalendarIcon />
                <span>{statusSubline}</span>
              </div>
            ) : null}
            {(findingsCount != null || scans != null) && (
              <div className="flex items-center gap-2 text-sm text-zinc-600">
                <svg
                  className="h-4 w-4 shrink-0 text-zinc-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2m-9 4h10m-9 4h6m-7 6h8a2 2 0 002-2v-6H6v6a2 2 0 002 2z"
                  />
                </svg>
                <span>
                  {findingsCount != null ? (
                    <>
                      {findingsCount} Finding{findingsCount === 1 ? "" : "s"}
                    </>
                  ) : (
                    "— Findings"
                  )}
                  {scans != null ? (
                    <>
                      <span className="px-1.5 text-zinc-300">·</span>
                      <span className="font-semibold tabular-nums text-zinc-900">
                        {scans}
                      </span>{" "}
                      Scans
                    </>
                  ) : null}
                </span>
              </div>
            )}
          </div>
        </div>

        {showEvidence ? (
          <div className="border-t border-zinc-100 p-4 lg:border-t-0">
            <p className="text-sm font-semibold text-zinc-950">
              {evidenceTitle}
            </p>
            {coverage ? (
              controlEvidenceUsesType2Bar(framework) ? (
                <div className="mt-3 space-y-2.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm text-zinc-700">
                    <span>
                      <span className="font-semibold tabular-nums text-zinc-900">
                        {coverageDays}
                      </span>
                      <span className="tabular-nums text-zinc-500"> / </span>
                      <span className="font-semibold tabular-nums text-zinc-900">
                        {coverageTotal}
                      </span>
                      {" audit days collected"}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-zinc-900">
                      {coveragePct}%
                    </span>
                  </div>
                  <CoverageProgressBar
                    coverageDays={coverageDays}
                    coverageTotal={coverageTotal}
                    coveragePct={coveragePct}
                    barFillClass={barFillClass}
                    className="h-3"
                  />
                  {coverageGuidance ? (
                    <p className="text-sm leading-relaxed text-zinc-500">
                      {coverageGuidance}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="mt-3 space-y-1.5">
                  <p className="text-sm text-zinc-700">
                    {evidenceUi.headline ?? (
                      <>
                        <span className="font-semibold tabular-nums text-zinc-900">
                          {coverageDays}
                        </span>
                        {coverageDays === 1 ? " day" : " days"} collected in the
                        selected export period
                      </>
                    )}
                  </p>
                  {evidenceUi.detailLine ? (
                    <p className="text-sm leading-relaxed text-zinc-500">
                      {evidenceUi.detailLine}
                    </p>
                  ) : null}
                </div>
              )
            ) : (
              <p className="mt-3 text-sm text-zinc-600">
                {periodDays}-day export window
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ControlEvaluationBlock({ checkIds }: { checkIds: string[] }) {
  if (checkIds.length === 0) return null;

  const grouped = groupCheckIds(checkIds);

  return (
    <div className="control-integrations-list">
      <div className="control-integrations-list__head">
        <span>Source</span>
        <span>Checks</span>
      </div>
      <div className="control-integrations-list__rows">
        {grouped.map(([group, ids]) => (
          <details key={group} className="control-integrations-list__row">
            <summary>
              <span className="control-integrations-list__source">
                {group}
              </span>
              <span className="control-integrations-list__count">
                {ids.length}
              </span>
            </summary>
            <ul>
              {ids.map((cid) => (
                <li key={cid} title={cid}>
                  {labelForCheck(cid)}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}

type ControlFindingsSummary = Pick<ControlRow, "status" | "finding_count">;

function ControlFindingsBlock({
  control,
  checkIds,
  findingCountByCheck,
}: {
  control: ControlFindingsSummary;
  checkIds: string[];
  findingCountByCheck: Map<string, number>;
}) {
  const navigate = useNavigate();

  const openTotal = control.finding_count;
  const findingsHref =
    openTotal > 0
      ? `/findings?checks=${encodeURIComponent(checkIds.filter((id) => (findingCountByCheck.get(id) ?? 0) > 0).join(","))}`
      : null;

  if (control.status === "pass" && openTotal === 0) {
    return (
      <div className="control-findings-empty">
        <p>
          No open findings on mapped checks.
        </p>
      </div>
    );
  }

  return (
    <div className="control-findings-panel">
      <TopFailingChecksTable
        checkIds={checkIds}
        findingCountByCheck={findingCountByCheck}
        max={8}
      />
      {findingsHref ? (
        <button
          type="button"
          onClick={() => navigate(findingsHref)}
          className="mt-4 text-sm font-medium text-indigo-600 transition hover:text-indigo-800"
        >
          View all {openTotal} findings →
        </button>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">
          No open findings in mapped checks.
        </p>
      )}
    </div>
  );
}

type FrameworkStats = {
  passRate: number | null;
  failed: number;
  passed: number;
  total: number;
  openFindings: number;
};

function useFrameworkStats(
  framework: string,
  accountId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    // Share the ["controls", ...] cache key (same endpoint) so this is covered by every
    // existing ["controls"] invalidation. A dedicated key here was never invalidated after
    // scans/rechecks, so the tab percentages went stale until a hard refresh.
    queryKey: ["controls", framework, accountId],
    queryFn: () =>
      api<ControlRow[]>(
        `/v1/controls?framework=${framework}${accountId ? `&account_id=${accountId}` : ""}`,
      ),
    enabled: enabled && !!accountId,
    select: (rows): FrameworkStats => {
      const total = rows.length;
      const passed = rows.filter((r) => r.status === "pass").length;
      const failed = rows.filter((r) => r.status === "fail").length;
      const openFindings = rows.reduce((sum, r) => sum + r.finding_count, 0);
      return {
        passRate: controlPostureScore(rows),
        failed,
        passed,
        total,
        openFindings,
      };
    },
  });
}

export default function Controls() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlFramework = searchParams.get("framework");
  const urlControl = searchParams.get("control");
  const urlComposite = searchParams.get("composite");
  const urlAccountId = searchParams.get("account_id");
  const urlView = searchParams.get("view");
  const urlStatus = searchParams.get("status");
  const [framework, setFramework] = useState(() =>
    urlFramework && FRAMEWORKS.some((f) => f.id === urlFramework)
      ? urlFramework
      : "soc2",
  );
  const [selectedFamilyKey, setSelectedFamilyKey] = useState<string | null>(
    null,
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedComposite, setExpandedComposite] = useState<string | null>(
    null,
  );
  const [complianceView, setComplianceView] = useState<ComplianceView>(() =>
    urlView === "detailed" || urlControl ? "detailed" : "composite",
  );
  const [downloading, setDownloading] = useState(false);
  const [periodKey, setPeriodKey] = useState<string | number>(90);
  const [asOf, setAsOf] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [evidenceSlideOverControlId, setEvidenceSlideOverControlId] = useState<
    string | null
  >(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportAnchor, setExportAnchor] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const exportPanelRef = useRef<HTMLDivElement>(null);

  const {
    options: connectedAccounts,
    isLoading: accountsLoading,
    isSuccess: accountsReady,
  } = useConnectedAccountOptions();
  const activeAccount =
    (urlAccountId && connectedAccounts.find((a) => a.id === urlAccountId)) ||
    connectedAccounts[0];
  const isAwsAccount =
    !activeAccount?.provider || activeAccount.provider === "aws";
  const hasScanned = !!activeAccount?.last_scan_at;

  function handleAccountChange(id: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("account_id", id);
        return next;
      },
      { replace: true },
    );
  }
  const activeFramework = FRAMEWORKS.find((fw) => fw.id === framework)!;

  function setComplianceViewWithUrl(view: ComplianceView) {
    setComplianceView(view);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (view === "detailed") next.set("view", "detailed");
        else next.delete("view");
        return next;
      },
      { replace: true },
    );
  }

  const controls = useQuery({
    queryKey: ["controls", framework, activeAccount?.id],
    queryFn: () =>
      api<ControlRow[]>(
        `/v1/controls?framework=${framework}${isAwsAccount && activeAccount ? `&account_id=${activeAccount.id}` : ""}`,
      ),
    enabled: !accountsLoading,
  });

  const qc = useQueryClient();
  const meQ = useMe();
  const canAttest = roleAtLeast(meQ.data?.role, "admin");
  const canEditEvidence = roleAtLeast(meQ.data?.role, "editor");
  const attest = useMutation({
    mutationFn: (v: { id: string; status: string }) =>
      api(`/v1/controls/${v.id}/attestation`, {
        method: "PUT",
        body: JSON.stringify({ status: v.status }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["controls"] }),
  });

  const compositeControls = useQuery({
    queryKey: ["controls", "composites", activeAccount?.id],
    queryFn: () =>
      api<CompositeControlRow[]>(
        `/v1/controls/composites${isAwsAccount && activeAccount ? `?account_id=${activeAccount.id}` : ""}`,
      ),
    enabled: !accountsLoading && !!activeAccount && isAwsAccount,
  });

  const externalEvidence = useQuery({
    queryKey: ["external-evidence", framework],
    queryFn: () =>
      api<ExternalEvidenceArtifact[]>(
        `/v1/controls/evidence?framework=${encodeURIComponent(framework)}`,
      ),
    enabled: !accountsLoading,
  });

  const acceptedCompositeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of externalEvidence.data ?? []) {
      if (row.status === "accepted" && row.composite_control_id) {
        ids.add(row.composite_control_id);
      }
    }
    return ids;
  }, [externalEvidence.data]);

  const submittedCountByComposite = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of externalEvidence.data ?? []) {
      if (row.status === "submitted" && row.composite_control_id) {
        counts.set(
          row.composite_control_id,
          (counts.get(row.composite_control_id) ?? 0) + 1,
        );
      }
    }
    return counts;
  }, [externalEvidence.data]);

  const submittedCountByControl = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of externalEvidence.data ?? []) {
      if (row.status === "submitted" && row.control_id) {
        counts.set(row.control_id, (counts.get(row.control_id) ?? 0) + 1);
      }
    }
    return counts;
  }, [externalEvidence.data]);

  const staleCompositeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of externalEvidence.data ?? []) {
      if (
        row.status === "accepted" &&
        row.composite_control_id &&
        evidenceIsStale(row)
      ) {
        ids.add(row.composite_control_id);
      }
    }
    return ids;
  }, [externalEvidence.data]);

  const expiredCompositeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of externalEvidence.data ?? []) {
      if (row.status === "expired" && row.composite_control_id) {
        ids.add(row.composite_control_id);
      }
    }
    return ids;
  }, [externalEvidence.data]);

  const deepLinkDone = useRef(false);
  useEffect(() => {
    deepLinkDone.current = false;
  }, [framework, urlControl]);

  useEffect(() => {
    if (
      urlStatus === "pass" ||
      urlStatus === "fail" ||
      urlStatus === "no_data"
    ) {
      setStatusFilter(urlStatus);
    }
  }, [urlStatus]);

  useEffect(() => {
    if (!urlControl || !controls.data?.length || deepLinkDone.current) return;
    const match = controls.data.find((r) => r.control_id === urlControl);
    if (match) {
      deepLinkDone.current = true;
      setSelectedFamilyKey(controlFamily(framework, match.control_id).key);
      setExpanded(match.id);
      setComplianceView("detailed");
      if (
        urlStatus === "pass" ||
        urlStatus === "fail" ||
        urlStatus === "no_data"
      ) {
        setStatusFilter(urlStatus);
      }
    }
  }, [controls.data, urlControl, framework, urlStatus]);

  useEffect(() => {
    if (urlControl) return;
    setComplianceView("composite");
    setExpandedComposite(null);
    setStatusFilter("all");
  }, [framework, urlControl]);

  useEffect(() => {
    if (urlControl || !urlComposite || !compositeControls.data?.length) return;
    const match = compositeControls.data.find((r) => r.id === urlComposite);
    if (match) {
      setComplianceView("composite");
      setExpandedComposite(match.id);
    }
  }, [compositeControls.data, urlComposite, urlControl]);

  const checkFrameworksQ = useQuery({
    queryKey: ["check-frameworks"],
    queryFn: () =>
      api<{ evidence_classes: Record<string, string> }>(
        "/v1/controls/check-frameworks",
      ),
    staleTime: 300_000,
  });

  const openFindingsRaw = useQuery({
    queryKey: ["findings", "open", activeAccount?.id, "controls-meta"],
    queryFn: () =>
      fetchAllFindings<OpenFindingMeta>({
        status: "open",
        ...findingsScopeParams(activeAccount),
      }),
    enabled: !!activeAccount && hasScanned,
  });

  const openFindingsMeta = useMemo(() => {
    const evidenceClasses = checkFrameworksQ.data?.evidence_classes;
    const byId = new Map<string, OpenFindingMeta>();
    const countByCheck = new Map<string, number>();
    const severityByCheck = new Map<string, string>();
    for (const f of openFindingsRaw.data?.items ?? []) {
      if (!openFindingFailsControl(f.check_id, evidenceClasses)) continue;
      byId.set(f.id, f);
      countByCheck.set(f.check_id, (countByCheck.get(f.check_id) ?? 0) + 1);
      const prev = severityByCheck.get(f.check_id);
      if (
        !prev ||
        (SEV_WEIGHT[f.severity] ?? 9) < (SEV_WEIGHT[prev] ?? 9)
      ) {
        severityByCheck.set(f.check_id, f.severity);
      }
    }
    return { byId, countByCheck, severityByCheck };
  }, [checkFrameworksQ.data?.evidence_classes, openFindingsRaw.data?.items]);

  const findingCountByCheck = openFindingsMeta.countByCheck;
  const severityByCheck = openFindingsMeta.severityByCheck;

  const exportWindow = useMemo(() => {
    if (periodKey === "last_scan" && activeAccount?.last_scan_at) {
      return {
        period: 30,
        asOf: activeAccount.last_scan_at.slice(0, 10),
        label: "Last scan",
      };
    }
    const p = Number(periodKey);
    return {
      period: p,
      asOf: asOf.trim() || undefined,
      label: `Last ${p} days`,
    };
  }, [periodKey, asOf, activeAccount?.last_scan_at]);

  const evidenceCoverage = useQuery({
    queryKey: [
      "evidence-coverage",
      activeAccount?.id,
      exportWindow.period,
      exportWindow.asOf,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        period: String(exportWindow.period),
      });
      if (exportWindow.asOf) params.set("as_of", exportWindow.asOf);
      return api<EvidenceCoverage>(
        `/v1/accounts/${activeAccount!.id}/evidence-coverage?${params}`,
      );
    },
    enabled: !!activeAccount && hasScanned && isAwsAccount,
  });

  useEffect(() => {
    if (!exportOpen) {
      setExportAnchor(null);
      return;
    }
    function updateAnchor() {
      if (!exportRef.current) return;
      const rect = exportRef.current.getBoundingClientRect();
      setExportAnchor({
        top: rect.bottom + 8,
        right: Math.max(16, window.innerWidth - rect.right),
      });
    }
    updateAnchor();
    window.addEventListener("resize", updateAnchor);
    window.addEventListener("scroll", updateAnchor, true);
    return () => {
      window.removeEventListener("resize", updateAnchor);
      window.removeEventListener("scroll", updateAnchor, true);
    };
  }, [exportOpen]);

  useEffect(() => {
    if (!exportOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (exportRef.current?.contains(target)) return;
      if (exportPanelRef.current?.contains(target)) return;
      setExportOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [exportOpen]);

  const soc2Stats = useFrameworkStats(
    "soc2",
    isAwsAccount ? activeAccount?.id : undefined,
    hasScanned && isAwsAccount,
  );
  const cisStats = useFrameworkStats(
    "cis_aws_l1",
    isAwsAccount ? activeAccount?.id : undefined,
    hasScanned && isAwsAccount,
  );
  const isoStats = useFrameworkStats(
    "iso27001",
    isAwsAccount ? activeAccount?.id : undefined,
    hasScanned && isAwsAccount,
  );

  const frameworkStatsById: Record<string, FrameworkStats | undefined> = {
    soc2: soc2Stats.data,
    cis_aws_l1: cisStats.data,
    iso27001: isoStats.data,
  };

  const complianceTimeline = useQuery({
    queryKey: ["compliance-hero", activeAccount?.id, framework],
    queryFn: () =>
      api<ComplianceHistoryResponse>(
        `/v1/accounts/${activeAccount!.id}/compliance-timeline?framework=${framework}&days=7&limit=20`,
      ),
    enabled: !!activeAccount && hasScanned && isAwsAccount,
    staleTime: 60_000,
  });

  const recentlyImprovedControlIds = useMemo(() => {
    const ids = new Set<string>();
    for (const event of complianceTimeline.data?.events ?? []) {
      for (const passed of event.diff?.newly_passed ?? []) {
        if (passed.control_id) ids.add(passed.control_id);
      }
    }
    return ids;
  }, [complianceTimeline.data?.events]);

  const rows = controls.data ?? [];
  const compositeIdByControlId = useMemo(() => {
    const map = new Map<string, string>();
    for (const ctrl of rows) {
      for (const comp of compositeControls.data ?? []) {
        if (ctrl.check_ids.some((id) => comp.check_ids.includes(id))) {
          map.set(ctrl.id, comp.id);
          break;
        }
      }
    }
    return map;
  }, [rows, compositeControls.data]);
  const passed = rows.filter((r) => r.status === "pass").length;
  const failed = rows.filter((r) => r.status === "fail").length;
  const atRisk = rows.filter((r) => r.status === "at_risk").length;
  const noData = rows.filter((r) => r.status === "no_data").length;
  const total = rows.length;
  const filteredRows = useMemo(
    () =>
      statusFilter === "all"
        ? rows
        : rows.filter((r) => r.status === statusFilter),
    [rows, statusFilter],
  );

  const evidenceSlideOverControl = useMemo(
    () => rows.find((r) => r.id === evidenceSlideOverControlId) ?? null,
    [rows, evidenceSlideOverControlId],
  );

  const groupedRows = useMemo(
    () => groupControls(filteredRows, framework),
    [filteredRows, framework],
  );
  const selectedGroup =
    groupedRows.find((group) => group.key === selectedFamilyKey) ??
    groupedRows[0] ??
    null;
  function openControl(ctrl: ControlRow) {
    setSelectedFamilyKey(controlFamily(framework, ctrl.control_id).key);
    setExpanded(ctrl.id);
  }

  const compositePanelRows = useMemo(() => {
    const all = compositeControls.data ?? [];
    const nestedChildIds = new Set(Object.values(NESTED_COMPOSITE_IDS));
    return all.filter(
      (c) => nestedChildIds.has(c.id) || compositeAppliesToFramework(c, rows),
    );
  }, [compositeControls.data, rows]);

  const primaryComposites = useMemo(
    () =>
      compositePanelRows.filter(
        (c) => c.id !== "container_vulnerability_monitoring",
      ),
    [compositePanelRows],
  );

  const compositePassed = primaryComposites.filter(
    (c) => c.status === "pass",
  ).length;
  const compositeNoData = primaryComposites.filter(
    (c) => c.status === "no_data",
  ).length;
  const compositeTotal = primaryComposites.length;

  const compositeDisplayCounts = useMemo(() => {
    let needsEvidence = 0;
    let externallyCovered = 0;
    let failing = 0;
    let atRisk = 0;
    let pendingReview = 0;
    let staleEvidence = 0;
    let expiredEvidence = 0;
    for (const c of primaryComposites) {
      const display = compositeDisplayStatus(
        c,
        findingCountByCheck,
        acceptedCompositeIds.has(c.id),
        expiredCompositeIds.has(c.id),
      );
      if (display === "needs_evidence") needsEvidence++;
      if (display === "externally_covered") externallyCovered++;
      if (display === "failing") failing++;
      if (display === "at_risk") atRisk++;
      if ((submittedCountByComposite.get(c.id) ?? 0) > 0) pendingReview++;
      if (staleCompositeIds.has(c.id)) staleEvidence++;
      if (expiredCompositeIds.has(c.id)) expiredEvidence++;
    }
    return {
      needsEvidence,
      externallyCovered,
      failing,
      atRisk,
      pendingReview,
      staleEvidence,
      expiredEvidence,
    };
  }, [
    primaryComposites,
    findingCountByCheck,
    acceptedCompositeIds,
    submittedCountByComposite,
    staleCompositeIds,
    expiredCompositeIds,
  ]);

  const filteredCompositePanelRows = useMemo(
    () =>
      statusFilter === "all"
        ? compositePanelRows
        : compositePanelRows.filter((c) =>
            compositeMatchesStatusFilter(
              c,
              statusFilter,
              findingCountByCheck,
              acceptedCompositeIds,
              submittedCountByComposite.get(c.id) ?? 0,
              staleCompositeIds.has(c.id),
              expiredCompositeIds.has(c.id),
            ),
          ),
    [
      compositePanelRows,
      statusFilter,
      findingCountByCheck,
      acceptedCompositeIds,
      submittedCountByComposite,
      staleCompositeIds,
      expiredCompositeIds,
    ],
  );

  const breadcrumbCompositeTitle = useMemo(() => {
    if (!urlComposite) return null;
    return (
      compositeControls.data?.find((row) => row.id === urlComposite)?.title ??
      null
    );
  }, [compositeControls.data, urlComposite]);

  function handleStatusFilterChange(filter: StatusFilter) {
    setStatusFilter(filter);
    setExpanded(null);
    setExpandedComposite(null);
  }

  function handleBackToCategories() {
    setComplianceView("composite");
    setExpanded(null);
    setSelectedFamilyKey(null);
    setStatusFilter("all");
    if (urlComposite) setExpandedComposite(urlComposite);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("view");
        next.delete("control");
        next.delete("status");
        if (urlComposite) next.set("composite", urlComposite);
        return next;
      },
      { replace: true },
    );
  }

  async function downloadPack(opts?: {
    framework?: string;
    period?: number;
    asOf?: string;
  }) {
    if (!activeAccount) return;
    setDownloading(true);
    try {
      const tok = token();
      const params = new URLSearchParams({
        framework: opts?.framework ?? framework,
        account_id: activeAccount.id,
        period: String(opts?.period ?? exportWindow.period),
      });
      const asOfVal = opts?.asOf ?? exportWindow.asOf;
      if (asOfVal) params.set("as_of", asOfVal);
      const res = await fetch(`${BASE}/v1/exports/evidence-pack?${params}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `veritrail-evidence-${opts?.framework ?? framework}-${asOfVal ?? new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Download failed: " + String(e));
    } finally {
      setDownloading(false);
    }
  }

  if (accountsReady && !accountsLoading && connectedAccounts.length === 0) {
    return <ConnectAwsEmptyState />;
  }

  const showAuditExportAboveCard =
    !!activeAccount &&
    !controls.isLoading &&
    ((complianceView === "composite" &&
      !compositeControls.isLoading &&
      filteredCompositePanelRows.length > 0) ||
      (complianceView === "detailed" &&
        groupedRows.length > 0 &&
        !!selectedGroup));

  const auditPackageExport = (
    <>
      <div ref={exportRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setExportOpen((open) => !open)}
          aria-expanded={exportOpen}
          aria-haspopup="dialog"
          className="findings-v2-toolbar-btn findings-v2-toolbar-btn--scan"
        >
          <svg
            className="h-4 w-4 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          Generate Audit Package
        </button>
      </div>
      {exportOpen &&
        exportAnchor &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Close evidence pack menu"
              className="fixed inset-0 z-[200] cursor-default bg-zinc-950/15"
              onClick={() => setExportOpen(false)}
            />
            <div
              ref={exportPanelRef}
              role="dialog"
              aria-label="Generate Audit Package"
              className="fixed z-[201] overflow-visible rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-lg shadow-zinc-950/10"
              style={{ top: exportAnchor.top, right: exportAnchor.right }}
            >
              <EvidencePackExportPanel
                frameworkId={framework}
                frameworkLabel={activeFramework.label}
                periodKey={periodKey}
                onPeriodChange={setPeriodKey}
                asOf={asOf}
                onAsOfChange={setAsOf}
                coverage={evidenceCoverage.data}
                coverageLoading={evidenceCoverage.isFetching}
                controlsEvaluated={total}
                lastScanLabel={
                  activeAccount?.last_scan_at
                    ? lastScanLabel(activeAccount.last_scan_at)
                    : null
                }
                downloading={downloading}
                onDownload={() => void downloadPack()}
              />
            </div>
          </>,
          document.body,
        )}
    </>
  );


  return (
    <div className="findings-v2-page findings-v2-shell min-h-full w-full">
      {connectedAccounts.length > 0 && activeAccount && (
        <HeaderSlot>
          <AccountFilterDropdown
            accounts={connectedAccounts}
            value={activeAccount.id}
            onChange={handleAccountChange}
          />
        </HeaderSlot>
      )}

      {!hasScanned && activeAccount && !controls.isLoading && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/60 px-5 py-4 text-sm text-amber-900">
          <span className="font-semibold">Awaiting first scan.</span> Control
          pass/fail status appears after your account finishes scanning.
        </div>
      )}

      {controls.isLoading && <LoadingSkeleton />}

      {!controls.isLoading && activeAccount && (
        <>
          <ComplianceContentShell
            toolbar={
              <ComplianceUnifiedToolbar
                framework={framework}
                frameworkStatsById={frameworkStatsById}
                onFrameworkChange={(id) => {
                  setFramework(id);
                  setSelectedFamilyKey(null);
                  setExpanded(null);
                  setStatusFilter("all");
                }}
                statusFilter={statusFilter}
                onStatusFilterChange={handleStatusFilterChange}
                statusCounts={
                  complianceView === "composite"
                    ? {
                        total: compositeTotal,
                        passed: compositePassed,
                        failed: compositeDisplayCounts.failing,
                        noData: compositeNoData,
                        needsEvidence: compositeDisplayCounts.needsEvidence,
                        externallyCovered: compositeDisplayCounts.externallyCovered,
                        pendingReview: compositeDisplayCounts.pendingReview,
                        staleEvidence: compositeDisplayCounts.staleEvidence,
                        expiredEvidence: compositeDisplayCounts.expiredEvidence,
                      }
                    : { total, passed, failed, noData }
                }
                compositeStatusFilter={complianceView === "composite"}
                showStatusFilter={
                  (complianceView === "composite" &&
                    !compositeControls.isLoading &&
                    primaryComposites.length > 0) ||
                  (complianceView === "detailed" && total > 0)
                }
                auditExport={auditPackageExport}
                showAuditExport={showAuditExportAboveCard}
              />
            }
            section={
              complianceView === "detailed" ? (
                <div className="compliance-detail-shell-nav">
                  <ComplianceDetailBreadcrumb
                    framework={framework}
                    controlId={urlControl}
                    compositeTitle={breadcrumbCompositeTitle}
                    onBack={handleBackToCategories}
                  />
                  {groupedRows.length > 1 && selectedGroup ? (
                    <ComplianceFamilyNav
                      groups={groupedRows}
                      selectedKey={selectedGroup.key}
                      onSelect={(key) => {
                        setSelectedFamilyKey(key);
                        setExpanded(null);
                      }}
                    />
                  ) : null}
                </div>
              ) : undefined
            }
          >
            {complianceView === "composite" &&
              !compositeControls.isLoading &&
              primaryComposites.length > 0 &&
              filteredCompositePanelRows.length === 0 &&
              statusFilter !== "all" && (
                <div className="px-6 py-12 text-center text-sm text-zinc-400">
                  No control groups match this filter.
                </div>
              )}

            {complianceView === "composite" &&
              !compositeControls.isLoading &&
              filteredCompositePanelRows.length > 0 && (
                <CompositeControlsPanel
                  rows={filteredCompositePanelRows}
                  findingCountByCheck={findingCountByCheck}
                  severityByCheck={severityByCheck}
                  expandedId={expandedComposite}
                  onToggle={setExpandedComposite}
                  framework={framework}
                  frameworkRows={rows}
                  accountId={activeAccount?.id}
                  acceptedCompositeIds={acceptedCompositeIds}
                  submittedCountByComposite={submittedCountByComposite}
                  expiredCompositeIds={expiredCompositeIds}
                  statusFilter={statusFilter}
                />
              )}

            {complianceView === "composite" &&
              !compositeControls.isLoading &&
              primaryComposites.length === 0 &&
              total > 0 && (
                <div className="px-5 py-4 text-sm text-zinc-600">
                  No control groups map to this framework yet. Open{" "}
                  <button
                    type="button"
                    onClick={() => setComplianceViewWithUrl("detailed")}
                    className="font-semibold text-indigo-700 hover:text-indigo-900"
                  >
                    all controls
                  </button>{" "}
                  for the full framework list.
                </div>
              )}

            {complianceView === "detailed" && rows.length === 0 && (
              <div className="px-6 py-16 text-center text-sm text-zinc-400">
                No controls found for this framework.
              </div>
            )}

            {complianceView === "detailed" &&
              rows.length > 0 &&
              filteredRows.length === 0 &&
              statusFilter !== "all" && (
                <div className="px-6 py-12 text-center text-sm text-zinc-400">
                  No controls match this filter.
                </div>
              )}

            {complianceView === "detailed" &&
              groupedRows.length > 0 &&
              selectedGroup &&
              selectedGroup.rows.map((ctrl) => {
                const isExpanded = expanded === ctrl.id;
                const displayStatus = controlDisplayStatus(
                  ctrl,
                  findingCountByCheck,
                );
                const findingsHref = findingsHrefForChecks(
                  ctrl.check_ids,
                  findingCountByCheck,
                );

                return (
                  <div key={ctrl.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        const scrollY = window.scrollY;
                        setExpanded(isExpanded ? null : ctrl.id);
                        requestAnimationFrame(() =>
                          window.scrollTo(0, scrollY),
                        );
                      }}
                      aria-expanded={isExpanded}
                      className={`flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors ${
                        displayStatus === "passing" && !isExpanded
                          ? "bg-emerald-50/30 hover:bg-emerald-50/50"
                          : "hover:bg-zinc-50/60"
                      }`}
                    >
                      <div className="min-w-0 flex-1 py-0.5">
                        <p className="text-body font-semibold leading-snug text-zinc-900">
                          <span className="font-mono text-meta font-semibold text-zinc-500">
                            {ctrl.control_id}
                          </span>{" "}
                          {shortControlTitle(ctrl.title)}
                          {recentlyImprovedControlIds.has(ctrl.control_id) ? (
                            <ComplianceProgressBadge label="Improved" />
                          ) : null}
                        </p>
                        {ctrl.description ? (
                          <p
                            className={`mt-0.5 text-meta leading-relaxed text-zinc-500 ${isExpanded ? "" : "line-clamp-1"}`}
                          >
                            {ctrl.description}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2 self-center sm:flex-row sm:items-center">
                        <ControlEvidenceDrawerTrigger
                          control={ctrl}
                          artifacts={externalEvidence.data ?? []}
                          findingCountByCheck={findingCountByCheck}
                          displayStatus={displayStatus}
                          submittedCount={
                            submittedCountByControl.get(ctrl.id) ?? 0
                          }
                          onOpen={() => setEvidenceSlideOverControlId(ctrl.id)}
                        />
                        <ComplianceRowSummary
                          displayStatus={displayStatus}
                          href={findingsHref}
                          onNavigate={(href) => navigate(href)}
                        />
                        <ComplianceExpandChevron expanded={isExpanded} />
                      </div>
                    </button>

                    <div
                      className={`veritrail-accordion-panel ${isExpanded ? "is-open" : ""}`}
                    >
                      <div className="veritrail-accordion-panel__inner">
                        <div className="control-detail-content veritrail-expand-in">
                          <ControlDetailHeader
                            control={ctrl}
                            coverage={evidenceCoverage.data}
                            periodDays={exportWindow.period}
                          />

                          <ControlDetailSection
                            title="Status & evidence"
                            subtitle="Current posture and collected audit evidence."
                          >
                            <ControlStatusBlock
                              control={ctrl}
                              periodDays={exportWindow.period}
                              coverage={evidenceCoverage.data}
                              controlId={ctrl.control_id}
                              framework={framework}
                              accountId={activeAccount?.id ?? ""}
                            />
                          </ControlDetailSection>

                          {ctrl.kind === "manual" ? (
                            <ControlDetailSection
                              title="Manual attestation"
                              subtitle="Record your internal review result."
                            >
                              <ManualAttestation
                                status={ctrl.attestation_status ?? "pending"}
                                canEdit={canAttest}
                                saving={attest.isPending}
                                onChange={(status) =>
                                  attest.mutate({ id: ctrl.id, status })
                                }
                              />
                            </ControlDetailSection>
                          ) : ctrl.check_ids.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/60 px-3.5 py-2.5 text-sm leading-relaxed text-zinc-600">
                              No automated Veritrail checks map to this control
                              yet — attest manually (e.g. IAM users only inherit
                              access via groups or roles).
                            </p>
                          ) : (
                            <>
                              <ControlDetailSection
                                title="Mapped integrations"
                                subtitle="Sources and checks that evaluate this criterion."
                              >
                                <ControlEvaluationBlock
                                  checkIds={ctrl.check_ids}
                                />
                              </ControlDetailSection>
                              <ControlDetailSection
                                title="Blocking gaps"
                                subtitle="Highest-volume checks to resolve first."
                              >
                                <ControlFindingsBlock
                                  control={ctrl}
                                  checkIds={ctrl.check_ids}
                                  findingCountByCheck={findingCountByCheck}
                                />
                              </ControlDetailSection>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
          </ComplianceContentShell>
        </>
      )}

      <ControlEvidenceSlideOver
        open={!!evidenceSlideOverControl}
        control={evidenceSlideOverControl}
        artifacts={externalEvidence.data ?? []}
        findingCountByCheck={findingCountByCheck}
        displayStatus={
          evidenceSlideOverControl
            ? controlDisplayStatus(
                evidenceSlideOverControl,
                findingCountByCheck,
              )
            : "passing"
        }
        submittedCount={
          evidenceSlideOverControl
            ? (submittedCountByControl.get(evidenceSlideOverControl.id) ?? 0)
            : 0
        }
        framework={framework}
        compositeId={
          evidenceSlideOverControl
            ? (compositeIdByControlId.get(evidenceSlideOverControl.id) ?? null)
            : null
        }
        canEdit={canEditEvidence}
        onClose={() => setEvidenceSlideOverControlId(null)}
      />
    </div>
  );
}
