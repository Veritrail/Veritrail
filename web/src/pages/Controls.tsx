import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, formatApiError, token } from "../api";
import {
  checkFrameworksSchema,
  complianceTimelineSchema,
  compositeControlListSchema,
  controlListSchema,
  evidenceCoverageSchema,
  externalEvidenceListSchema,
} from "../lib/apiSchemas";
import { canUploadEvidence, roleAtLeast, useMe } from "../hooks/useMe";
import { labelForCheck } from "../data/checkLabels";
import { FRAMEWORKS, frameworkLabel } from "../data/frameworks";
import { ComplianceFrameworkSelect } from "../components/ComplianceFrameworkSelect";
import { FilterChipBar } from "../components/FilterChipBar";
import ConnectAwsEmptyState from "../components/ConnectAwsEmptyState";
import { EvidencePackExportPanel } from "../components/EvidencePackExportPanel";
import type { ComplianceHistoryResponse } from "../lib/complianceHistory";
import type { EvidenceCoverage } from "../lib/evidenceCoverage";
import { controlPostureScore } from "../lib/controlPostureScore";
import {
  findingsScopeParams,
  useConnectedAccountOptions,
} from "../hooks/useConnectedAccountOptions";
import { useSelectedAccountId } from "../hooks/useSelectedAccountId";
import { fetchAllFindings } from "../lib/fetchAllFindings";
import { openFindingAffectsControlStatus } from "../lib/evidenceClass";
import { AccountFilterDropdown } from "../components/AccountFilterDropdown";
import { CloudFeatureComingSoon } from "../components/CloudFeatureComingSoon";
import { isCloudFeatureComingSoon } from "../lib/cloudProviderFeatures";
import { HeaderFilterBar } from "../components/HeaderFilterBar";
import { ExternalEvidencePanel } from "../components/ExternalEvidencePanel";
import { CoverageOverridePanel } from "../components/CoverageOverridePanel";
import {
  isPermissionGapError,
  type ComplianceDisplayStatus,
  type RecommendedAction,
} from "../lib/compositeRecommendedAction";
import type { ExternalEvidenceArtifact } from "../lib/externalEvidence";
import { evidenceIsStale } from "../lib/externalEvidence";
import {
  EXTERNAL_ONLY_CONTROLS,
  externalOnlyBlockingGapSummary,
  externalOnlyGuidance,
  isExternalOnlyComposite,
} from "../lib/externalOnlyControls";
import { externalEvidenceCompositeDisplayStatus } from "../lib/externalEvidenceCompositeStatus";
import {
  absenceGapEnableItems,
  capabilityForAbsenceCheck,
  findingsHrefForAbsenceGaps,
  isAbsenceGapCheck,
  openAbsenceGapChecks,
  openCrossAccountCoverableChecks,
} from "../lib/evidenceGap";
import { ControlEvidenceDrawerTrigger } from "../components/ControlEvidenceDrawer";
import { VirtualizedCompositeControlsList } from "../components/VirtualizedCompositeControlsList";
import { DrawerDateField } from "../components/DrawerDateField";
import {
  ControlDetailPillCard,
  ControlEvidenceTabContent,
  ExternalEvidenceArtifactList,
} from "../components/ControlEvidenceSlideOver";
import { evidenceArtifactsForComposite } from "../lib/controlEvidence";
import {
  ControlDetailPanel,
  ControlReadinessBar,
  type ControlDetailTab,
  type ControlDetailTabId,
} from "../components/ControlDetailPanel";
import { controlReadinessMetrics, type ReadinessMetric } from "../lib/controlReadiness";
import { HeaderSlot } from "../context/HeaderSlot";
import { FrameworkMark } from "../components/FrameworkMark";
import { CHECK_CONTROL_IDS_MAP } from "../data/checkControlIdsMap";
import { controlReferenceUrl } from "../lib/controlReferenceUrls";
import "../styles/findings-v2.css";
import "../styles/compliance-page.css";

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
  cis_criteria?: string[];
  iso_criteria?: string[];
  check_ids: string[];
  check_evidence_classes?: Record<string, string>;
  coverage_tier?: "core" | "extended" | "mixed" | "no_data";
  check_tiers?: Record<string, string>;
  status: "pass" | "fail" | "at_risk" | "no_data";
  display_status?: ComplianceDisplayStatus;
  evidence_category_key?: string | null;
  registry_vendor?: string | null;
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
  scanning_attestation?: {
    declared: boolean;
    vendor: string | null;
    note: string | null;
    set_by: string | null;
    set_at: string | null;
  } | null;
  scanning_attestable_checks?: string[];
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
  // Framework-mapping metadata — set only for the matching framework's controls.
  soc2_scope_category?: string | null;
  cis_profile_level?: string | null;
  iso_applicability?: "applicable" | "excluded" | "partial" | null;
  iso_applicability_rationale?: string | null;
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
  if (hasExpiredEvidence && !hasAcceptedExternalEvidence) return "expired";

  let base: ComplianceDisplayStatus;
  if (ctrl.display_status) {
    base = ctrl.display_status;
  } else if (ctrl.status === "pass") {
    base = "passing";
  } else if (ctrl.status === "at_risk") {
    base = "at_risk";
  } else if (ctrl.status === "no_data") {
    base = "unevaluated";
  } else if (ctrl.status === "fail" && hasAcceptedExternalEvidence) {
    base = "externally_covered";
  } else if (
    ctrl.status === "fail" &&
    !hasAcceptedExternalEvidence &&
    openAbsenceGapChecks(ctrl.check_ids, findingCountByCheck).length > 0
  ) {
    base = "needs_evidence";
  } else {
    const failingChecks = ctrl.check_ids.filter(
      (id) => (findingCountByCheck.get(id) ?? 0) > 0,
    );
    if (failingChecks.length === 0) {
      base = "failing";
    } else {
      const hasCoreFailure = failingChecks.some(
        (id) => (ctrl.check_tiers?.[id] ?? "core") === "core",
      );
      base = hasCoreFailure ? "failing" : "at_risk";
    }
  }

  if (ctrl.display_status) {
    return base;
  }

  return externalEvidenceCompositeDisplayStatus(
    ctrl.id,
    base,
    hasAcceptedExternalEvidence,
    ctrl.registry_vendor,
  );
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
    // Absence gaps: a service Veritrail collects from is off (GuardDuty, Config,
    // CloudTrail, ...). Close by enabling it — or upload evidence of external
    // coverage. "Needs evidence" read as "must upload documents", which is wrong.
    needs_evidence: "Coverage gap",
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

  const chipToneClass: Record<ComplianceDisplayStatus, string> = {
    passing: "bg-emerald-50 text-emerald-800 ring-emerald-200/80",
    failing: "bg-rose-50 text-rose-800 ring-rose-200/70",
    at_risk: "bg-amber-50 text-amber-800 ring-amber-200/70",
    unevaluated: "bg-zinc-100 text-zinc-600 ring-zinc-200/80",
    externally_covered: "bg-indigo-50 text-indigo-800 ring-indigo-200/70",
    needs_evidence: "bg-orange-50 text-orange-800 ring-orange-200/70",
    expired: "bg-zinc-100 text-zinc-600 ring-zinc-200/80",
    out_of_scope: "bg-sky-50 text-sky-800 ring-sky-200/70",
    not_applicable: "bg-sky-50 text-sky-700 ring-sky-200/70",
  };
  const chipClass = `inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ring-1 ${chipToneClass[displayStatus]}`;
  const tooltip: Partial<Record<ComplianceDisplayStatus, string>> = {
    needs_evidence:
      "A service Veritrail collects from is not enabled in this account. Enable it — or upload external evidence — to close the gap. Open the control for details.",
    at_risk: "Supporting checks have open findings worth reviewing before audit.",
  };
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
      <span
        role="link"
        tabIndex={0}
        title={tooltip[displayStatus] ?? "View open findings"}
        onClick={(e) => {
          e.stopPropagation();
          onNavigate(href);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            onNavigate(href);
          }
        }}
        className={`${chipClass} cursor-pointer transition hover:opacity-90`}
      >
        {content}
      </span>
    );
  }

  return <span className={chipClass} title={tooltip[displayStatus]}>{content}</span>;
}

/** Matches api/app/services/check_controls.py — open findings may use legacy check_ids. */
const CHECK_CONTROL_ALIASES: Record<string, string> = {
  "iam.access_key.unused_90d": "iam.access_key.unused_45d",
  "iam.user.inactive_90d": "iam.user.credentials_unused_45d",
};

function resolveCheckIdForMappings(checkId: string): string {
  return CHECK_CONTROL_ALIASES[checkId] ?? checkId;
}

function isCoarseSoc2Category(controlId: string): boolean {
  return /^CC\d+$/i.test(controlId);
}

type GuidanceMappedControl = {
  framework: string;
  control_id: string;
  reference_url: string;
};

/** Resolve framework control IDs from composite checks (same source as Findings drawer). */
function compositeMappedControls(
  ctrl: CompositeControlRow,
  framework: string,
): GuidanceMappedControl[] {
  const controlIds = new Set<string>();

  for (const checkId of ctrl.check_ids) {
    const mappedCheckId = resolveCheckIdForMappings(checkId);
    for (const ref of CHECK_CONTROL_IDS_MAP[mappedCheckId] ?? []) {
      if (ref.framework === framework) {
        controlIds.add(ref.control_id);
      }
    }
  }

  if (controlIds.size === 0) {
    if (framework === "soc2") {
      for (const id of ctrl.soc2_criteria ?? []) {
        if (!isCoarseSoc2Category(id)) controlIds.add(id);
      }
    } else if (framework === "cis_aws_l1") {
      for (const id of ctrl.cis_criteria ?? []) controlIds.add(id);
    } else if (framework === "iso27001") {
      for (const id of ctrl.iso_criteria ?? []) controlIds.add(id);
    }
  }

  return [...controlIds]
    .sort(compareControlIds)
    .map((control_id) => ({
      framework,
      control_id,
      reference_url: controlReferenceUrl(framework, control_id),
    }));
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
      className="vt-toolbar-segmented findings-v2-filter-chip-bar"
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
            className={`vt-toolbar-segment findings-v2-filter-chip ${isSelected ? "vt-toolbar-segment--active is-selected" : ""}`}
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

function ComplianceToolbarLoadingSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-2 animate-pulse" aria-hidden>
      <div className="h-8 w-16 rounded-full bg-zinc-100" />
      <div className="h-8 w-20 rounded-full bg-zinc-100" />
      <div className="h-8 w-24 rounded-full bg-zinc-100" />
      <div className="h-8 w-20 rounded-full bg-zinc-100" />
      <div className="h-8 w-28 rounded-full bg-zinc-100" />
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
  toolbarLoading = false,
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
  toolbarLoading?: boolean;
  auditExport: ReactNode;
  showAuditExport: boolean;
}) {
  return (
    <div className="findings-v2-table-toolbar">
      <div className="findings-v2-filter-cluster !flex-wrap">
        {toolbarLoading ? (
          <ComplianceToolbarLoadingSkeleton />
        ) : (
          <>
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
          </>
        )}
      </div>
      <div className="findings-v2-control-cluster">
        {toolbarLoading ? (
          <div className="h-9 w-44 animate-pulse rounded-lg bg-zinc-100" aria-hidden />
        ) : (
          showAuditExport && (
            <div
              className="findings-v2-toolbar-group findings-v2-actions-group"
              role="group"
              aria-label="Export"
            >
              {auditExport}
            </div>
          )
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
  opts?: { excludeAbsenceGaps?: boolean },
) {
  const active = checkIds.filter((id) => {
    if ((findingCountByCheck.get(id) ?? 0) <= 0) return false;
    if (opts?.excludeAbsenceGaps && isAbsenceGapCheck(id)) return false;
    return true;
  });
  if (active.length === 0) return null;
  const params = new URLSearchParams({ checks: active.join(",") });
  const providerScope = providerScopeForChecks(active);
  if (providerScope) params.set("provider", providerScope);
  return `/findings?${params.toString()}`;
}

function providerScopeForChecks(checkIds: string[]): "source_control" | null {
  const hasScm = checkIds.some(
    (id) => id.startsWith("github.") || id.startsWith("gitlab."),
  );
  return hasScm ? "source_control" : null;
}

function remediationActionForChecks(
  checkIds: string[],
  findingCountByCheck: Map<string, number>,
  opts: { hasAbsenceGaps: boolean; regularFailing: number },
): { title: string; detail: string } {
  const active = checkIds.filter((id) => (findingCountByCheck.get(id) ?? 0) > 0);
  const providerScope = providerScopeForChecks(active);
  if (providerScope) {
    return {
      title: "Fix in source control",
      detail: "Review the affected repositories and update branch protection, reviews, or CI/CD safeguards.",
    };
  }
  return {
    title: opts.hasAbsenceGaps && opts.regularFailing === 0 ? "Enable in AWS" : "Fix in AWS",
    detail: "Address the failing checks directly in your AWS environment.",
  };
}

/** Plain-English answer to "why does the pill say Coverage gap?" — names the
    services that are off so the status is traceable to a concrete cause.
    Rendered first in the drawer as a quiet white card: amber left rail +
    small-caps eyebrow, a headline that carries the quantified fact, and a
    short body. No icons, no pills — the sentence is the signal. */
function CoverageGapExplainer({
  absenceChecks,
  compositeId,
}: {
  absenceChecks: string[];
  compositeId?: string;
}) {
  const hasAnalyzer = absenceChecks.includes("aws.access_analyzer.not_enabled");
  const others = absenceChecks.filter((id) => id !== "aws.access_analyzer.not_enabled");
  const names = others.map(capabilityForAbsenceCheck);
  const analyzerOnly = hasAnalyzer && others.length === 0;
  const identityGovernanceAnalyzer =
    compositeId === "identity_governance" && hasAnalyzer;
  const total = absenceChecks.length;
  const missingSignals = [
    ...names,
    ...(hasAnalyzer ? ["IAM Access Analyzer"] : []),
  ];
  const headline = identityGovernanceAnalyzer
    ? "Organization IAM Access Analyzer cannot be verified from this account"
    : analyzerOnly
      ? "IAM Access Analyzer is not visible from this account"
    : `This control has ${total} missing service${total === 1 ? "" : "s"}`;
  const body = analyzerOnly && identityGovernanceAnalyzer
    ? "This member-account scan cannot prove organization-level IAM Access Analyzer coverage. Veritrail must treat this control as unverified until the management or delegated administrator account is connected, or external evidence is uploaded."
    : analyzerOnly
      ? "Veritrail cannot verify this control automatically while IAM Access Analyzer is unavailable from this account."
      : "These services feed this control's automated evidence collection — while they are off, every scan returns nothing to verify against.";
  // The IG-analyzer step keeps its specific instruction (connect the management
  // account) — that action has no direct row below. The generic cases point at
  // the resolution path instead of restating its rows.
  const nextStep = identityGovernanceAnalyzer
    ? "Connect the AWS management or delegated administrator account to verify coverage automatically. If that is not possible, upload evidence that explicitly proves organization-level analyzer coverage."
    : hasAnalyzer
      ? "Use the resolution path below — enable what is missing in the right account and re-scan. The analyzer verifies only from the management account."
      : `Use the resolution path below — enabling the missing service${total === 1 ? "" : "s"} is the fastest close; external evidence works if another tool covers this control.`;

  return (
    <div className="coverage-gap-card" role="note">
      <div className="coverage-gap-card__head">
        <div className="coverage-gap-card__title-block">
          <p className="coverage-gap-card__eyebrow">Coverage gap</p>
          <h3 className="coverage-gap-card__headline">{headline}</h3>
        </div>
      </div>

      <p className="coverage-gap-card__body">{body}</p>

      {identityGovernanceAnalyzer ? (
        <div className="coverage-gap-card__note">
          <p className="coverage-gap-card__note-title">Why this cannot be verified here</p>
          <p className="coverage-gap-card__body">
            AWS exposes organization analyzers from the management or delegated administrator
            account, not from ordinary member accounts. Unlike CloudTrail organization trails,
            a member-account scan has no reliable signal that proves the analyzer exists.
          </p>
        </div>
      ) : null}

      {missingSignals.length > 0 ? (
        <div className="coverage-gap-card__signals" aria-label="Missing coverage signals">
          <span className="coverage-gap-card__signals-label">Missing coverage</span>
          <div className="coverage-gap-card__signal-list">
            {missingSignals.map((name) => (
              <span className="coverage-gap-card__signal" key={name}>
                {name}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="coverage-gap-card__next">
        <span className="coverage-gap-card__next-label">Next step</span>
        <p className="coverage-gap-card__next-copy">{nextStep}</p>
      </div>

      {!identityGovernanceAnalyzer && hasAnalyzer ? (
        <p className="coverage-gap-card__body coverage-gap-card__note">
          <strong>Organization-analyzer note:</strong> analyzers are deployed only in the
          management (or delegated administrator) account and leave{" "}
          <strong>no API trace</strong> in member accounts — scanning this account can never
          prove one exists. Connect the management account and re-scan to verify coverage
          automatically, or attest it below for now (marked unverified until that account is
          connected).
        </p>
      ) : null}
    </div>
  );
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

function TopFailingChecksSeverityTable({
  checkIds,
  findingCountByCheck,
  severityByCheck,
}: {
  checkIds: string[];
  findingCountByCheck: Map<string, number>;
  severityByCheck: Map<string, string>;
}) {
  const navigate = useNavigate();
  const failing = useMemo(
    () => sortedTopFailingChecks(checkIds, findingCountByCheck, checkIds.length),
    [checkIds, findingCountByCheck],
  );

  if (failing.length === 0) {
    return (
      <p className="compliance-category-detail__empty-checks">
        No open findings on mapped checks.
      </p>
    );
  }

  return (
    <div className="compliance-category-detail__checks">
      <div className="compliance-category-detail__checks-cols" aria-hidden>
        <span>#</span>
        <span>Check</span>
        <span>Findings</span>
        <span>Severity</span>
      </div>
      <div className="compliance-category-detail__checks-scroll">
        <ul className="compliance-category-detail__checks-table">
          {failing.map((checkId, index) => {
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
  embedInResolution = false,
  expanded = false,
  onExpandedChange,
}: {
  compositeId: string;
  compositeTitle: string;
  detail?: CoverageOverrideDetail | null;
  /** When true, parent renders the resolution-path row trigger. */
  embedInResolution?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const meQ = useMe();
  const qc = useQueryClient();
  const canEdit = roleAtLeast(meQ.data?.role, "admin");
  const [internalOpen, setInternalOpen] = useState(false);
  const open = embedInResolution ? expanded : internalOpen;
  const setOpen = embedInResolution
    ? (next: boolean) => onExpandedChange?.(next)
    : setInternalOpen;
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
    if (embedInResolution && !expanded) return null;
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
    if (embedInResolution) return null;
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

  if (embedInResolution) {
    return (
      <div className="control-resolve-path__panel">
        <div className="control-resolve-path__panel-segmented" role="radiogroup" aria-label="Scope type">
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
        <label className="control-resolve-path__panel-field">
          <span className="control-resolve-path__panel-label">Reason</span>
          <textarea
            className="control-resolve-path__panel-textarea"
            placeholder="Recorded for your auditor — e.g. handled by an external system"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
          />
        </label>
        {error ? <p className="control-resolve-path__panel-error">{error}</p> : null}
        <div className="control-resolve-path__panel-actions">
          <button
            type="button"
            className="control-resolve-path__panel-btn control-resolve-path__panel-btn--cancel"
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
            className="control-resolve-path__panel-btn control-resolve-path__panel-btn--primary"
            disabled={saving || reason.trim() === ""}
            onClick={() => void submit(status, reason.trim())}
          >
            {saving ? "Saving…" : "Mark out of scope"}
          </button>
        </div>
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
        placeholder="Reason (recorded for your auditor) — e.g. handled by an external system"
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

const CONTROL_DRAWER_STAT_ICON_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function ControlDrawerHeaderStats({
  openGaps,
  findings,
  highSeverity,
  checks,
}: {
  openGaps: number;
  findings: number;
  highSeverity: number;
  checks: number;
}) {
  const items = [
    {
      key: "gaps",
      icon: (
        <svg {...CONTROL_DRAWER_STAT_ICON_PROPS}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="9.75" cy="9.75" r="1" fill="currentColor" stroke="none" />
          <circle cx="14.25" cy="9.75" r="1" fill="currentColor" stroke="none" />
          <circle cx="9.75" cy="14.25" r="1" fill="currentColor" stroke="none" />
          <circle cx="14.25" cy="14.25" r="1" fill="currentColor" stroke="none" />
        </svg>
      ),
      label: `${openGaps} open gap${openGaps === 1 ? "" : "s"}`,
    },
    {
      key: "findings",
      icon: (
        <svg {...CONTROL_DRAWER_STAT_ICON_PROPS}>
          <path d="M7.5 4.5h7.5l3.5 3.5V20a.5.5 0 0 1-.5.5H7.5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5Z" />
          <path d="M15 4.5V8h3.5" />
        </svg>
      ),
      label: `${findings} finding${findings === 1 ? "" : "s"}`,
    },
    {
      key: "high",
      highSeverity: true,
      icon: (
        <svg {...CONTROL_DRAWER_STAT_ICON_PROPS}>
          <path d="M12 2.75 5 6.25v5c0 4.75 3.5 9.25 7 10.25 3.5-1 7-5.5 7-10.25v-5L12 2.75Z" />
          <path d="M12 8.25v4" />
          <circle cx="12" cy="16.25" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      ),
      label: `${highSeverity} high severity`,
    },
    {
      key: "checks",
      icon: (
        <svg {...CONTROL_DRAWER_STAT_ICON_PROPS}>
          <circle cx="12" cy="12" r="8" />
          <path d="m8.25 12.25 2.75 2.75L15.75 9" />
        </svg>
      ),
      label: `${checks} check${checks === 1 ? "" : "s"}`,
    },
  ];

  return (
    <div className="control-detail-panel__stats-row" aria-label="Control summary">
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 ? (
            <span className="control-detail-panel__stat-sep" aria-hidden>
              ·
            </span>
          ) : null}
          <span
            className={`control-detail-panel__stat${item.highSeverity ? " control-detail-panel__stat--high-severity" : ""}`}
          >
            <span className="control-detail-panel__stat-icon" aria-hidden>
              {item.icon}
            </span>
            {item.label}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function compositeHeaderStats(
  ctrl: CompositeControlRow,
  findingCountByCheck: Map<string, number>,
): { openGaps: number; findings: number; highSeverity: number; checks: number } {
  const openGaps = ctrl.check_ids.filter(
    (checkId) => (findingCountByCheck.get(checkId) ?? 0) > 0,
  ).length;
  const findings =
    ctrl.finding_count > 0
      ? ctrl.finding_count
      : ctrl.check_ids.reduce(
          (sum, checkId) => sum + (findingCountByCheck.get(checkId) ?? 0),
          0,
        );
  const highSeverity = ctrl.severity_counts
    ? ctrl.severity_counts.critical + ctrl.severity_counts.high
    : 0;
  return { openGaps, findings, highSeverity, checks: ctrl.check_ids.length };
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
  embedInResolution = false,
}: {
  compositeId: string;
  detail?: CrossAccountCoverageDetail | null;
  open: boolean;
  onClose: () => void;
  onConnect: () => void;
  /** When true, parent renders the resolution-path row trigger. */
  embedInResolution?: boolean;
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

  if (embedInResolution) {
    return (
      <div className="control-resolve-path__panel">
        <p className="control-resolve-path__panel-hint">
          Connect that account, then run a scan to verify this control. Attest in the meantime if
          you can’t connect it yet.
        </p>
        <label className="control-resolve-path__panel-field">
          <span className="control-resolve-path__panel-label">AWS account ID</span>
          <input
            className="control-resolve-path__panel-input"
            inputMode="numeric"
            placeholder="12 digits"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          />
        </label>
        <label className="control-resolve-path__panel-field">
          <span className="control-resolve-path__panel-label">How is it covered there?</span>
          <textarea
            className="control-resolve-path__panel-textarea"
            placeholder="e.g. GuardDuty via delegated admin in the security account"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
          />
        </label>
        <label className="control-resolve-path__panel-field">
          <span className="control-resolve-path__panel-label">Attestation expiry (optional)</span>
          <DrawerDateField
            value={expires}
            onChange={setExpires}
            placeholder="Select expiry date"
            triggerClassName="control-resolve-path__panel-input drawer-date-field__trigger"
            popoverPlacement="below"
          />
        </label>
        {error ? <p className="control-resolve-path__panel-error">{error}</p> : null}
        <div className="control-resolve-path__panel-actions">
          <button
            type="button"
            className="control-resolve-path__panel-btn control-resolve-path__panel-btn--cancel"
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
            className="control-resolve-path__panel-btn control-resolve-path__panel-btn--secondary"
            disabled={saving || !validId}
            onClick={() => void save({ withExpiry: true, thenConnect: false })}
          >
            Attest for now
          </button>
          <button
            type="button"
            className="control-resolve-path__panel-btn control-resolve-path__panel-btn--primary"
            disabled={saving || !validId}
            onClick={() => void save({ withExpiry: false, thenConnect: true })}
          >
            {saving ? "Saving…" : "Connect & verify →"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="compliance-category-detail__scope is-editing">
      <p className="compliance-category-detail__scope-title">Covered in another AWS account</p>
      <p className="compliance-category-detail__account-hint">
        Connect that account, then run a scan to verify this control. Attest in the meantime if you
        can’t connect it yet.
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
        <span className="compliance-category-detail__account-expiry-label">Attestation expiry (optional)</span>
        <DrawerDateField
          value={expires}
          onChange={setExpires}
          placeholder="Select expiry date"
          triggerClassName="compliance-category-detail__account-input drawer-date-field__trigger"
          popoverPlacement="below"
        />
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

/**
 * Reusable titled section for drawer content. Gives each block a consistent
 * eyebrow/title/action header so drawer sections read as a deliberate hierarchy.
 */
function ControlDetailSection({
  title,
  eyebrow,
  action,
  panel = false,
  children,
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
  /** Off-white panel shell for overview blocks. */
  panel?: boolean;
  children: ReactNode;
}) {
  const hasHead = title != null || eyebrow != null || action != null;
  return (
    <section
      className={`control-detail-section${panel ? " control-detail-section--panel" : ""}`}
    >
      {hasHead ? (
        <div className="control-detail-section__head">
          <div className="control-detail-section__heading">
            {eyebrow != null ? (
              <p className="control-detail-section__eyebrow">{eyebrow}</p>
            ) : null}
            {title != null ? (
              <h3 className="control-detail-section__title">{title}</h3>
            ) : null}
          </div>
          {action != null ? (
            <div className="control-detail-section__action">{action}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Readiness bar wrapped in a titled section with an N-of-M summary stat. */
function ControlReadinessSection({ metrics }: { metrics: ReadinessMetric[] }) {
  if (metrics.length === 0) return null;
  const primary = metrics[0];
  return (
    <ControlDetailSection
      panel
      title="Readiness"
      action={
        <span className="control-detail-section__stat">
          {primary.complete}
          <span className="control-detail-section__stat-sep">/</span>
          {primary.total}
        </span>
      }
    >
      <ControlReadinessBar metrics={metrics} />
      <p className="control-detail-hint">
        Concrete N-of-M counts — not a likelihood-to-pass score.
      </p>
    </ControlDetailSection>
  );
}

/**
 * Declare an external code/dependency/secret scanner (Snyk, Semgrep, etc.).
 * When declared, the scanning-family findings are cleared from Secure SDLC
 * grading while the intrinsic repo controls (branch protection, reviews,
 * self-merge) stay enforced live. Attests just the scanning capability, not
 * the whole control.
 */
function ScanningAttestationPanel({ ctrl, canEdit }: { ctrl: CompositeControlRow; canEdit: boolean }) {
  const qc = useQueryClient();
  const attested = ctrl.scanning_attestation ?? null;
  const [open, setOpen] = useState(false);
  const [vendor, setVendor] = useState(attested?.vendor ?? "");
  const [note, setNote] = useState(attested?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(declared: boolean) {
    setSaving(true);
    setError("");
    try {
      await api("/v1/settings", {
        method: "PATCH",
        body: JSON.stringify({
          sdlc_scanning_attestation: declared
            ? { declared: true, vendor: vendor.trim() || null, note: note.trim() || null }
            : { declared: false },
        }),
      });
      await qc.invalidateQueries({ queryKey: ["controls"] });
      setOpen(false);
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  }

  if (attested) {
    return (
      <div className="control-scan-attest control-scan-attest--on">
        <div className="control-scan-attest__body">
          <span className="control-scan-attest__badge">Attested</span>
          <div>
            <p className="control-scan-attest__title">
              Code &amp; dependency scanning covered externally
              {attested.vendor ? ` — ${attested.vendor}` : ""}
            </p>
            <p className="control-scan-attest__sub">
              Scanning findings are cleared from this control. Branch protection and review
              controls stay enforced from the live repo state.
            </p>
          </div>
        </div>
        {canEdit ? (
          <button
            type="button"
            className="control-scan-attest__link"
            disabled={saving}
            onClick={() => submit(false)}
          >
            {saving ? "Removing…" : "Remove attestation"}
          </button>
        ) : null}
        {error ? <p className="control-scan-attest__error">{error}</p> : null}
      </div>
    );
  }

  if (!canEdit) return null;

  return (
    <div className="control-scan-attest">
      {open ? (
        <div className="control-scan-attest__form">
          <p className="control-scan-attest__title">Declare an external scanner</p>
          <p className="control-scan-attest__sub">
            If code, dependency, or secret scanning runs outside GitHub/GitLab, declare the tool.
            Those findings clear from Secure SDLC; branch protection and reviews stay enforced.
          </p>
          <input
            className="control-scan-attest__input"
            placeholder="Scanner (e.g. Snyk, Semgrep, Trivy)"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            autoFocus
          />
          <input
            className="control-scan-attest__input"
            placeholder="Note (optional) — e.g. scope, evidence location"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="control-scan-attest__actions">
            <button
              type="button"
              className="control-scan-attest__btn control-scan-attest__btn--primary"
              disabled={saving}
              onClick={() => submit(true)}
            >
              {saving ? "Saving…" : "Declare"}
            </button>
            <button
              type="button"
              className="control-scan-attest__btn"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
          {error ? <p className="control-scan-attest__error">{error}</p> : null}
        </div>
      ) : (
        <button type="button" className="control-scan-attest__prompt" onClick={() => setOpen(true)}>
          Run code or dependency scanning outside GitHub? Declare it →
        </button>
      )}
    </div>
  );
}

/**
 * How to close the gaps on a composite control. "Fix in AWS" and "turn this on"
 * apply broadly; cross-account coverage only applies to the one or two checks
 * that can only be read from a management/root account (e.g. IAM Access
 * Analyzer) — so it and evidence upload sit behind a quiet toggle instead of
 * an always-open form, to avoid implying they cover the whole gap list.
 */
function CompositeGapResolution({
  ctrl,
  framework,
  findingCountByCheck,
  findingsHref,
  navigate,
  primaryAction,
  regularFailing,
  hasAbsenceGaps,
  absenceChecks,
  enableItems,
  crossAccountEligible,
  crossAccountDetail,
  isExternalOnly,
  underlyingCriteria,
  overrideDetail,
}: {
  ctrl: CompositeControlRow;
  framework: string;
  findingCountByCheck: Map<string, number>;
  findingsHref: string | null;
  navigate: (href: string) => void;
  primaryAction: { title: string; detail: string };
  regularFailing: number;
  hasAbsenceGaps: boolean;
  absenceChecks: string[];
  enableItems: { checkId: string; capability: string; consoleUrl?: string | null }[];
  crossAccountEligible: boolean;
  crossAccountDetail: CrossAccountCoverageDetail | null;
  isExternalOnly: boolean;
  underlyingCriteria: ControlRow[];
  overrideDetail?: CoverageOverrideDetail | null;
}) {
  const meQ = useMe();
  const canEditScope = roleAtLeast(meQ.data?.role, "admin");
  const [openPanel, setOpenPanel] = useState<"cross-account" | "scope" | null>(null);
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const showEvidenceAlternative = hasAbsenceGaps || isExternalOnly;
  const showFixColumn = !isExternalOnly;
  const showEnableColumn = enableItems.length > 0;
  const showScopeRow = canEditScope && !overrideDetail;

  function togglePanel(panel: "cross-account" | "scope") {
    setOpenPanel((current) => (current === panel ? null : panel));
  }

  function handleEnable() {
    const item = enableItems[0];
    if (!item) return;
    if (enableItems.length > 1) {
      navigate(`/findings?checks=${encodeURIComponent(absenceChecks.join(","))}`);
      return;
    }
    if (item.consoleUrl) {
      window.open(item.consoleUrl, "_blank", "noopener,noreferrer");
      return;
    }
    navigate(`/findings?checks=${encodeURIComponent(item.checkId)}`);
  }

  const enableCapabilityLabel =
    enableItems.length === 1
      ? enableItems[0]?.capability
      : enableItems.length > 1
        ? `${enableItems.length} services`
        : null;

  const showRescanTag =
    ctrl.status === "no_data" || (ctrl.scan_errors?.length ?? 0) > 0;

  return (
    <>
      <div className="control-resolve-path">
        <div className="control-resolve-path__head">
          <svg
            className="control-resolve-path__head-icon"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.8}
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.36 2.64L3 13" />
          </svg>
          <h4 className="control-resolve-path__title">Resolution path</h4>
        </div>

        {showFixColumn ? (
          <div className="control-resolve-path__row">
            <svg
              className="control-resolve-path__icon"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.8}
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
            <div className="control-resolve-path__body control-resolve-path__body--stacked">
              <strong>{primaryAction.title}</strong>
              <span className="control-resolve-path__desc">{primaryAction.detail}</span>
              {regularFailing > 0 ? (
                <span className="control-resolve-path__tag">
                  {regularFailing} failing check{regularFailing === 1 ? "" : "s"}
                </span>
              ) : showRescanTag ? (
                <span className="control-resolve-path__tag">Re-scan needed</span>
              ) : null}
            </div>
            <button
              type="button"
              className="control-resolve-path__outline"
              disabled={!findingsHref && ctrl.check_ids.length === 0}
              onClick={() => {
                if (findingsHref) {
                  navigate(findingsHref);
                  return;
                }
                if (ctrl.check_ids.length > 0) {
                  navigate(
                    `/findings?checks=${encodeURIComponent(ctrl.check_ids.join(","))}`,
                  );
                }
              }}
            >
              View
            </button>
          </div>
        ) : null}

        {showEnableColumn ? (
          <div className="control-resolve-path__row">
            <svg
              className="control-resolve-path__icon"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.8}
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
            <div className="control-resolve-path__body control-resolve-path__body--stacked">
              <div className="control-resolve-path__title-row">
                <strong>Enable automatic re-check</strong>
                {enableCapabilityLabel ? (
                  <span className="control-resolve-path__tag control-resolve-path__tag--capability">
                    {enableCapabilityLabel}
                  </span>
                ) : null}
              </div>
              <span className="control-resolve-path__desc">
                Turn on the missing AWS capability, then re-scan to verify.
              </span>
            </div>
            <button
              type="button"
              className="control-resolve-path__outline"
              onClick={handleEnable}
            >
              Enable
            </button>
          </div>
        ) : null}

        {showEvidenceAlternative ? (
          <div className="control-resolve-path__row">
            <svg
              className="control-resolve-path__icon"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"
              />
            </svg>
            <div className="control-resolve-path__body control-resolve-path__body--stacked">
              <strong>Upload external evidence</strong>
              <span className="control-resolve-path__desc">
                Policies, attestations, or exports auditors can review.
              </span>
            </div>
            <button
              type="button"
              className="control-resolve-path__outline"
              onClick={() => setEvidenceModalOpen(true)}
            >
              Upload
            </button>
          </div>
        ) : null}

        {crossAccountEligible ? (
          <>
            <button
              type="button"
              className="control-resolve-path__row control-resolve-path__row--expand"
              aria-expanded={openPanel === "cross-account"}
              onClick={() => togglePanel("cross-account")}
            >
              <svg
                className="control-resolve-path__icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"
                />
                <circle cx="9" cy="7" r="4" />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
                />
              </svg>
              <div className="control-resolve-path__body control-resolve-path__body--stacked">
                <strong>Covered in another AWS account</strong>
                <span className="control-resolve-path__desc">
                  Org-level coverage may satisfy this from your management account.
                </span>
              </div>
              <span
                className={`control-resolve-path__chevron${openPanel === "cross-account" ? " is-open" : ""}`}
                aria-hidden
              >
                ›
              </span>
            </button>
            {openPanel === "cross-account" ? (
              <div className="control-resolve-path__expand">
                <CrossAccountCoverageControl
                  compositeId={ctrl.id}
                  detail={crossAccountDetail}
                  open
                  embedInResolution
                  onClose={() => setOpenPanel(null)}
                  onConnect={() => navigate("/accounts")}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {showEvidenceAlternative ? (
        <ExternalEvidencePanel
          compositeId={ctrl.id}
          compositeTitle={ctrl.title}
          framework={framework}
          checkIds={ctrl.check_ids}
          findingCountByCheck={findingCountByCheck}
          underlyingCriteria={underlyingCriteria}
          frameworkControlLabel={(controlId) => frameworkControlLabel(framework, controlId)}
          open={evidenceModalOpen}
          onOpenChange={setEvidenceModalOpen}
        />
      ) : null}

      {(ctrl.scanning_attestable_checks?.length ?? 0) > 0 ? (
        <ScanningAttestationPanel ctrl={ctrl} canEdit={canEditScope} />
      ) : null}

      {showScopeRow ? (
        <div
          className={`control-resolve-path__scope-block${openPanel === "scope" ? " is-open" : ""}`}
        >
          <button
            type="button"
            className="control-resolve-path__scope-row"
            aria-expanded={openPanel === "scope"}
            onClick={() => togglePanel("scope")}
          >
            <svg
              className="control-resolve-path__icon"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              viewBox="0 0 24 24"
              aria-hidden
            >
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" d="M4.5 4.5l15 15" />
            </svg>
            <div className="control-resolve-path__body control-resolve-path__body--stacked">
              <strong>Mark out of scope</strong>
              <span className="control-resolve-path__desc">
                Exclude this control when it does not apply to your audit boundary.
              </span>
            </div>
            <span
              className={`control-resolve-path__chevron${openPanel === "scope" ? " is-open" : ""}`}
              aria-hidden
            >
              ›
            </span>
          </button>
          {openPanel === "scope" ? (
            <div className="control-resolve-path__scope-expand">
              <GapScopeControl
                compositeId={ctrl.id}
                compositeTitle={ctrl.title}
                embedInResolution
                expanded
                onExpandedChange={(next) => {
                  if (!next) setOpenPanel(null);
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

type GuidanceBlock =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] };

function parseGuidanceBlocks(text: string): GuidanceBlock[] {
  return text
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const bulletLines = lines.filter((line) => /^[-•]\s/.test(line));
      if (bulletLines.length >= 2 && bulletLines.length === lines.length) {
        return {
          type: "ul" as const,
          items: lines.map((line) => line.replace(/^[-•]\s+/, "")),
        };
      }
      return { type: "p" as const, text: block.replace(/\n/g, " ") };
    });
}

function ControlGuidanceContent({ text }: { text: string }) {
  const blocks = parseGuidanceBlocks(text);
  return (
    <div className="control-detail-guidance">
      {blocks.map((block, index) =>
        block.type === "ul" ? (
          <ul key={index} className="control-detail-guidance__list">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={index} className="control-detail-guidance__text">
            {block.text}
          </p>
        ),
      )}
    </div>
  );
}

function ControlGuidanceFooter({
  guidance,
  mappedControls,
}: {
  guidance: string | null;
  mappedControls: GuidanceMappedControl[];
}) {
  return (
    <ControlDetailSection>
      <ControlDetailPillCard label="Guidance">
        {guidance ? (
          <ControlGuidanceContent text={guidance} />
        ) : (
          <p className="control-detail-empty">No written guidance yet for this control.</p>
        )}
      </ControlDetailPillCard>
      {mappedControls.length > 0 ? (
        <div className="control-detail-guidance-footer">
          <p className="control-detail-mapped-controls__heading">Mapped controls</p>
          <ul className="control-detail-mapped-controls">
            {mappedControls.map((c) => (
              <li
                key={`${c.framework}:${c.control_id}`}
                className="control-detail-mapped-controls__card"
              >
                <FrameworkMark framework={c.framework} />
                <span className="control-detail-mapped-controls__label">
                  {frameworkLabel(c.framework)} {c.control_id}
                </span>
                <a
                  href={c.reference_url}
                  target="_blank"
                  rel="noreferrer"
                  className="control-detail-mapped-controls__docs"
                >
                  Docs
                  <svg
                    className="control-detail-mapped-controls__docs-icon"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                    />
                  </svg>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </ControlDetailSection>
  );
}

/** Single-page composite drawer — blocking gaps, resolution path, guidance. */
function buildCompositeTabs({
  ctrl,
  findingCountByCheck,
  severityByCheck,
  framework,
  frameworkRows,
  acceptedCompositeIds,
  expiredCompositeIds,
  externalEvidence,
  canEditEvidence,
  navigate,
}: {
  ctrl: CompositeControlRow;
  findingCountByCheck: Map<string, number>;
  severityByCheck: Map<string, string>;
  framework: string;
  frameworkRows: ControlRow[];
  acceptedCompositeIds: Set<string>;
  expiredCompositeIds?: Set<string>;
  externalEvidence: ExternalEvidenceArtifact[];
  canEditEvidence: boolean;
  navigate: (href: string) => void;
}): ControlDetailTab[] {
  const displayStatus = compositeDisplayStatus(
    ctrl,
    findingCountByCheck,
    acceptedCompositeIds.has(ctrl.id),
    expiredCompositeIds?.has(ctrl.id),
  );
  const findingsHref = findingsHrefForChecks(
    ctrl.check_ids,
    findingCountByCheck,
    { excludeAbsenceGaps: true },
  ) ?? findingsHrefForAbsenceGaps(ctrl.check_ids, findingCountByCheck);
  const overrideDetail = ctrl.coverage_override_detail ?? null;
  const crossAccountDetail = ctrl.cross_account_coverage_detail ?? null;
  const failingCheckCount = ctrl.check_ids.filter(
    (c) => (findingCountByCheck.get(c) ?? 0) > 0,
  ).length;
  const underlyingCriteria = underlyingCriteriaForComposite(ctrl, frameworkRows);
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
  const primaryAction = remediationActionForChecks(ctrl.check_ids, findingCountByCheck, {
    hasAbsenceGaps,
    regularFailing,
  });
  const isExternalOnly = isExternalOnlyComposite(ctrl.check_ids, ctrl.id);
  const isVerified = displayStatus === "passing";
  const mappedControls = compositeMappedControls(ctrl, framework);
  const linkedEvidence = evidenceArtifactsForComposite(externalEvidence, ctrl.id);

  return [
    {
      id: "gaps",
      label: "Gaps",
      content: (
        <div className="control-detail-stack control-detail-stack--composite">
          {displayStatus === "needs_evidence" && hasAbsenceGaps ? (
            <CoverageGapExplainer absenceChecks={absenceChecks} compositeId={ctrl.id} />
          ) : null}

          <ControlDetailSection title="Blocking gaps">
            {isExternalOnly ? (
              <p className="control-detail-empty">
                {externalOnlyBlockingGapSummary(ctrl.id)}
              </p>
            ) : (
              <TopFailingChecksSeverityTable
                checkIds={ctrl.check_ids}
                findingCountByCheck={findingCountByCheck}
                severityByCheck={severityByCheck}
              />
            )}
          </ControlDetailSection>

          {!isVerified && !overrideDetail ? (
            <CompositeGapResolution
              ctrl={ctrl}
              framework={framework}
              findingCountByCheck={findingCountByCheck}
              findingsHref={findingsHref}
              navigate={navigate}
              primaryAction={primaryAction}
              regularFailing={regularFailing}
              hasAbsenceGaps={hasAbsenceGaps}
              absenceChecks={absenceChecks}
              enableItems={enableItems}
              crossAccountEligible={crossAccountEligible}
              crossAccountDetail={crossAccountDetail}
              isExternalOnly={isExternalOnly}
              underlyingCriteria={underlyingCriteria}
              overrideDetail={overrideDetail}
            />
          ) : overrideDetail ? (
            <ControlDetailSection title="Scope">
              <GapScopeControl
                compositeId={ctrl.id}
                compositeTitle={ctrl.title}
                detail={overrideDetail}
              />
            </ControlDetailSection>
          ) : null}

          <ControlDetailSection>
            <ControlDetailPillCard label="External evidence">
              <ExternalEvidenceArtifactList
                artifacts={linkedEvidence}
                emptyMessage="No external evidence uploaded for this control group yet."
                canComment={canEditEvidence}
                framework={framework}
              />
            </ControlDetailPillCard>
          </ControlDetailSection>

          {!isVerified ? (
            <ControlGuidanceFooter
              guidance={externalOnlyGuidance(ctrl.id, ctrl.guidance)}
              mappedControls={mappedControls}
            />
          ) : null}
        </div>
      ),
    },
  ];
}

/** Assembles the detailed (per-framework-control) row's detail content into tabs. */
function buildDetailedTabs({
  ctrl,
  framework,
  findingCountByCheck,
  canAttest,
  attestPending,
  onAttest,
  externalEvidence,
  submittedCount,
  compositeId,
  canEditEvidence,
}: {
  ctrl: ControlRow;
  framework: string;
  findingCountByCheck: Map<string, number>;
  canAttest: boolean;
  attestPending: boolean;
  onAttest: (status: string) => void;
  externalEvidence: ExternalEvidenceArtifact[];
  submittedCount: number;
  compositeId: string | null;
  canEditEvidence: boolean;
}): ControlDetailTab[] {
  const displayStatus = controlDisplayStatus(ctrl, findingCountByCheck);
  const blockingCount = ctrl.check_ids.filter(
    (checkId) => (findingCountByCheck.get(checkId) ?? 0) > 0,
  ).length;
  const hasMappingMeta =
    !!ctrl.soc2_scope_category || !!ctrl.cis_profile_level || !!ctrl.iso_applicability;
  const isVerified = displayStatus === "passing";
  const readinessMetrics = controlReadinessMetrics(
    ctrl.check_ids,
    ctrl.check_tiers,
    findingCountByCheck,
  );

  const tabs: ControlDetailTab[] = [
    {
      id: "overview",
      label: "Overview",
      content: (
        <div className="control-detail-stack">
          <ControlReadinessSection metrics={readinessMetrics} />
        </div>
      ),
    },
    {
      id: "gaps",
      label: "Gaps",
      badge: blockingCount > 0 ? blockingCount : undefined,
      content: (
        <div className="control-detail-stack">
          <ControlDetailSection title="Blocking gaps">
            {ctrl.check_ids.length > 0 ? (
              <ControlFindingsBlock
                control={ctrl}
                checkIds={ctrl.check_ids}
                findingCountByCheck={findingCountByCheck}
              />
            ) : ctrl.kind !== "manual" ? (
              <p className="control-detail-empty">
                No automated checks map to this control yet.
              </p>
            ) : null}

            {ctrl.kind === "manual" ? (
              <div className="control-detail-subsection">
                <ManualAttestation
                  status={ctrl.attestation_status ?? "pending"}
                  canEdit={canAttest}
                  saving={attestPending}
                  onChange={onAttest}
                />
              </div>
            ) : null}

            {ctrl.check_ids.length > 0 ? (
              <div className="control-detail-subsection">
                <p className="control-detail-subsection__label">Evidence</p>
                <ControlEvidenceTabContent
                  control={ctrl}
                  artifacts={externalEvidence}
                  findingCountByCheck={findingCountByCheck}
                  displayStatus={displayStatus}
                  submittedCount={submittedCount}
                  framework={framework}
                  compositeId={compositeId}
                  canEdit={canEditEvidence}
                />
              </div>
            ) : null}
          </ControlDetailSection>

          {!isVerified ? (
            <ControlDetailSection>
              <ControlDetailPillCard label="Guidance">
                {ctrl.guidance ? (
                  <ControlGuidanceContent text={ctrl.guidance} />
                ) : !hasMappingMeta ? (
                  <p className="control-detail-empty">No written guidance yet for this control.</p>
                ) : null}
              </ControlDetailPillCard>
              {hasMappingMeta ? (
                <p className="control-detail-mapping-line">
                  {frameworkControlLabel(framework, ctrl.control_id)}
                  {ctrl.soc2_scope_category ? ` · SOC 2 scope: ${ctrl.soc2_scope_category}` : ""}
                  {ctrl.cis_profile_level ? ` · CIS profile: ${ctrl.cis_profile_level}` : ""}
                  {ctrl.iso_applicability ? ` · ISO 27001: ${ctrl.iso_applicability}` : ""}
                </p>
              ) : null}
            </ControlDetailSection>
          ) : null}
        </div>
      ),
    },
  ];

  return tabs;
}

const EXTERNAL_ONLY_COMPLIANCE_ROWS = EXTERNAL_ONLY_CONTROLS;

function externalOnlyCompositeRow(
  row: (typeof EXTERNAL_ONLY_COMPLIANCE_ROWS)[number],
): CompositeControlRow {
  return {
    id: row.id,
    control_id: row.id,
    title: row.title,
    description: row.description,
    guidance: row.guidance,
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
  selectedId,
  onSelect,
  frameworkRows,
  acceptedCompositeIds,
  expiredCompositeIds,
  statusFilter,
}: {
  rows: CompositeControlRow[];
  findingCountByCheck: Map<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  frameworkRows: ControlRow[];
  acceptedCompositeIds: Set<string>;
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

  if (treeRows.length === 0 && externalOnlyRows.length === 0) return null;

  type CompositeListItem =
    | { kind: "tree"; row: CompositeControlRow; child: CompositeControlRow | null | undefined }
    | { kind: "external"; row: (typeof EXTERNAL_ONLY_COMPLIANCE_ROWS)[number] };

  const listItems: CompositeListItem[] = useMemo(() => {
    const items: CompositeListItem[] = visibleTreeRows.map(({ row, child }) => ({
      kind: "tree",
      row,
      child,
    }));
    for (const row of visibleExternalRows) {
      items.push({ kind: "external", row });
    }
    return items;
  }, [visibleTreeRows, visibleExternalRows]);

  return (
    <div className="compliance-category-board">
      <VirtualizedCompositeControlsList
        className="compliance-category-board__list"
        items={listItems}
        getItemKey={(item) => item.row.id}
        renderItem={(item) => {
          if (item.kind === "tree") {
            const { row: ctrl, child } = item;
            const isSelected = selectedId === ctrl.id;
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
            return (
              <div
                className={`compliance-control-card${isSelected ? " is-expanded" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(ctrl.id)}
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

                  <div className="compliance-control-card__state">
                    <ComplianceRowSummary
                      displayStatus={displayStatus}
                      href={findingsHref}
                      onNavigate={(href) => navigate(href)}
                    />
                  </div>
                </button>

                {child && compositeAppliesToFramework(child, frameworkRows) ? (
                  <div className="compliance-control-card__child-wrap">
                    {(() => {
                      const childSelected = selectedId === child.id;
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
                      return (
                        <div className={`compliance-control-card compliance-control-card--child${childSelected ? " is-expanded" : ""}`}>
                          <button
                            type="button"
                            onClick={() => onSelect(child.id)}
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
                            <div className="compliance-control-card__state">
                              <ComplianceRowSummary
                                displayStatus={childDisplayStatus}
                                href={childFindingsHref}
                                onNavigate={(href) => navigate(href)}
                              />
                            </div>
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                ) : null}
              </div>
            );
          }

          const row = item.row;
          const isSelected = selectedId === row.id;
          return (
            <div
              className={`compliance-control-card${isSelected ? " is-expanded" : ""}`}
            >
              <button
                type="button"
                onClick={() => onSelect(row.id)}
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
                <div className="compliance-control-card__state">
                  <ComplianceRowSummary
                    displayStatus="needs_evidence"
                    href={null}
                    onNavigate={(href) => navigate(href)}
                  />
                </div>
              </button>
            </div>
          );
        }}
      />
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
      api(
        `/v1/controls?framework=${framework}${accountId ? `&account_id=${accountId}` : ""}`,
        { schema: controlListSchema },
      ) as Promise<ControlRow[]>,
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
  const urlView = searchParams.get("view");
  const urlStatus = searchParams.get("status");
  const urlTab = searchParams.get("tab");
  const [framework, setFramework] = useState(() =>
    urlFramework && FRAMEWORKS.some((f) => f.id === urlFramework)
      ? urlFramework
      : "soc2",
  );
  const [selectedFamilyKey, setSelectedFamilyKey] = useState<string | null>(
    null,
  );
  // Unified master-detail selection — replaces the old separate expand-in-place
  // state for the detailed view, the composite view, and the evidence slide-over.
  const [selectedControlId, setSelectedControlId] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<"detailed" | "composite" | null>(null);
  const [selectedTab, setSelectedTab] = useState<ControlDetailTabId>(() =>
    urlTab === "overview" ||
    urlTab === "gaps" ||
    urlTab === "evidence" ||
    urlTab === "mappings" ||
    urlTab === "guidance"
      ? urlTab
      : "overview",
  );
  const [complianceView, setComplianceView] = useState<ComplianceView>(() =>
    urlView === "detailed" || urlControl ? "detailed" : "composite",
  );

  /** Select a composite row — completes the existing one-way `?composite=` deep-link
   *  into a two-way sync, mirroring the `replace: true` pattern handleBackToCategories
   *  already uses. Clears `?control=` since a composite selection isn't a specific
   *  framework control. */
  function selectComposite(id: string) {
    setSelectedControlId(id);
    setSelectedKind("composite");
    setSelectedTab("gaps");
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("composite", id);
        next.delete("control");
        return next;
      },
      { replace: true },
    );
  }

  /** Select a framework control row — leaves `?composite=` untouched since it's the
   *  "came from" breadcrumb context for the detailed view's back-navigation. */
  function selectDetailedControl(id: string, tab: ControlDetailTabId = "overview") {
    setSelectedControlId(id);
    setSelectedKind("detailed");
    setSelectedTab(tab);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("control", id);
        return next;
      },
      { replace: true },
    );
  }

  const [downloading, setDownloading] = useState(false);
  const [periodKey, setPeriodKey] = useState<string | number>(90);
  const [asOf, setAsOf] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
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
  const { activeAccount, setAccountId: handleAccountChange } = useSelectedAccountId(
    connectedAccounts,
    accountsReady,
  );
  const isAwsAccount =
    !activeAccount?.provider || activeAccount.provider === "aws";
  const hasScanned = !!activeAccount?.last_scan_at;
  const prevScanAtRef = useRef<string | null>(null);
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
      api(
        `/v1/controls?framework=${framework}${isAwsAccount && activeAccount ? `&account_id=${activeAccount.id}` : ""}`,
        { schema: controlListSchema },
      ) as Promise<ControlRow[]>,
    enabled: !accountsLoading && isAwsAccount,
  });

  const qc = useQueryClient();

  useEffect(() => {
    const scanAt = activeAccount?.last_scan_at ?? null;
    if (prevScanAtRef.current && scanAt && scanAt !== prevScanAtRef.current) {
      void qc.invalidateQueries({ queryKey: ["findings"] });
      void qc.invalidateQueries({ queryKey: ["controls"] });
    }
    prevScanAtRef.current = scanAt;
  }, [activeAccount?.last_scan_at, qc]);

  const meQ = useMe();
  const canAttest = roleAtLeast(meQ.data?.role, "admin");
  const canEditEvidence = canUploadEvidence(meQ.data);
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
      api(
        `/v1/controls/composites${isAwsAccount && activeAccount ? `?account_id=${activeAccount.id}` : ""}`,
        { schema: compositeControlListSchema },
      ) as Promise<CompositeControlRow[]>,
    enabled: !accountsLoading && !!activeAccount && isAwsAccount,
  });

  const externalEvidence = useQuery({
    queryKey: ["external-evidence", framework],
    queryFn: () =>
      api(
        `/v1/controls/evidence?framework=${encodeURIComponent(framework)}`,
        { schema: externalEvidenceListSchema },
      ) as Promise<ExternalEvidenceArtifact[]>,
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
      setSelectedControlId(match.id);
      setSelectedKind("detailed");
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
    setSelectedControlId(null);
    setSelectedKind(null);
    setStatusFilter("all");
  }, [framework, urlControl]);

  useEffect(() => {
    if (urlControl || !urlComposite || !compositeControls.data?.length) return;
    const match = compositeControls.data.find((r) => r.id === urlComposite);
    if (match) {
      setComplianceView("composite");
      setSelectedControlId(match.id);
      setSelectedKind("composite");
    }
  }, [compositeControls.data, urlComposite, urlControl]);

  const checkFrameworksQ = useQuery({
    queryKey: ["check-frameworks"],
    queryFn: () => api("/v1/controls/check-frameworks", { schema: checkFrameworksSchema }),
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
      if (!openFindingAffectsControlStatus(f.check_id, evidenceClasses)) continue;
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
      return api(
        `/v1/accounts/${activeAccount!.id}/evidence-coverage?${params}`,
        { schema: evidenceCoverageSchema },
      ) as Promise<EvidenceCoverage>;
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
        { schema: complianceTimelineSchema },
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

  const selectedDetailedControl = useMemo(
    () =>
      selectedKind === "detailed"
        ? (rows.find((r) => r.id === selectedControlId) ?? null)
        : null,
    [rows, selectedControlId, selectedKind],
  );

  const groupedRows = useMemo(
    () => groupControls(filteredRows, framework),
    [filteredRows, framework],
  );
  const selectedGroup =
    groupedRows.find((group) => group.key === selectedFamilyKey) ??
    groupedRows[0] ??
    null;

  const compositePanelRows = useMemo(() => {
    const all = compositeControls.data ?? [];
    const nestedChildIds = new Set(Object.values(NESTED_COMPOSITE_IDS));
    return all.filter(
      (c) => nestedChildIds.has(c.id) || compositeAppliesToFramework(c, rows),
    );
  }, [compositeControls.data, rows]);

  const selectedCompositeRow = useMemo(() => {
    if (selectedKind !== "composite" || !selectedControlId) return null;
    const fromPanel = compositePanelRows.find((row) => row.id === selectedControlId);
    if (fromPanel) return fromPanel;
    const external = EXTERNAL_ONLY_COMPLIANCE_ROWS.find(
      (row) => row.id === selectedControlId,
    );
    return external ? externalOnlyCompositeRow(external) : null;
  }, [compositePanelRows, selectedControlId, selectedKind]);

  // Auto-clear a selection that no longer resolves to a real row (e.g. it was
  // unmapped or removed) — for both views. Status-filter-driven clearing is
  // handled separately by handleStatusFilterChange.
  useEffect(() => {
    if (!selectedControlId || !selectedKind) return;
    if (selectedKind === "composite" && !selectedCompositeRow) {
      setSelectedControlId(null);
      setSelectedKind(null);
    } else if (selectedKind === "detailed" && !selectedDetailedControl) {
      setSelectedControlId(null);
      setSelectedKind(null);
    }
  }, [selectedControlId, selectedKind, selectedCompositeRow, selectedDetailedControl]);

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
    setSelectedControlId(null);
    setSelectedKind(null);
  }

  function handleBackToCategories() {
    setComplianceView("composite");
    setSelectedFamilyKey(null);
    setStatusFilter("all");
    if (urlComposite) {
      setSelectedControlId(urlComposite);
      setSelectedKind("composite");
    } else {
      setSelectedControlId(null);
      setSelectedKind(null);
    }
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

  const controlsQueryEnabled = !accountsLoading;
  const controlsInitialLoading =
    controlsQueryEnabled && !controls.isSuccess && !controls.isError;
  const compositeQueryEnabled = !accountsLoading && !!activeAccount && isAwsAccount;
  const compositeInitialLoading =
    compositeQueryEnabled && !compositeControls.isSuccess && !compositeControls.isError;
  const compositeToolbarLoading =
    complianceView === "composite" && isAwsAccount && compositeInitialLoading;

  const showAuditExportAboveCard =
    !!activeAccount &&
    !controlsInitialLoading &&
    !compositeToolbarLoading &&
    ((complianceView === "composite" &&
      !compositeInitialLoading &&
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
    <div
      className={`compliance-page compliance-v2-shell min-h-full w-full${
        isCloudFeatureComingSoon(activeAccount?.provider) && activeAccount
          ? " compliance-v2-shell--fill"
          : ""
      }`}
    >
      {connectedAccounts.length > 0 && activeAccount && (
        <HeaderSlot>
          <HeaderFilterBar>
            <AccountFilterDropdown
              accounts={connectedAccounts}
              value={activeAccount.id}
              onChange={handleAccountChange}
            />
          </HeaderFilterBar>
        </HeaderSlot>
      )}

      {isCloudFeatureComingSoon(activeAccount?.provider) && activeAccount ? (
        <div className="cloud-feature-coming-soon-wrap">
          <CloudFeatureComingSoon
            page="compliance"
            provider={activeAccount.provider}
          />
        </div>
      ) : (
        <>
      {!hasScanned && activeAccount && !controlsInitialLoading && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/60 px-5 py-4 text-sm text-amber-900">
          <span className="font-semibold">Awaiting first scan.</span> Control
          pass/fail status appears after your account finishes scanning.
        </div>
      )}

      {controlsInitialLoading && <LoadingSkeleton />}

      {!controlsInitialLoading && activeAccount && (
        <div className="compliance-master-detail">
        <div className="compliance-master-detail__list">
          <ComplianceContentShell
            toolbar={
              <ComplianceUnifiedToolbar
                framework={framework}
                frameworkStatsById={frameworkStatsById}
                onFrameworkChange={(id) => {
                  setFramework(id);
                  setSelectedFamilyKey(null);
                  setSelectedControlId(null);
                  setSelectedKind(null);
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
                toolbarLoading={compositeToolbarLoading}
                showStatusFilter={
                  (complianceView === "composite" &&
                    !compositeInitialLoading &&
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
                        setSelectedControlId(null);
                        setSelectedKind(null);
                      }}
                    />
                  ) : null}
                </div>
              ) : undefined
            }
          >
            {complianceView === "composite" && compositeInitialLoading && (
              <div className="px-5 py-8">
                <LoadingSkeleton />
              </div>
            )}

            {complianceView === "composite" &&
              !compositeInitialLoading &&
              primaryComposites.length > 0 &&
              filteredCompositePanelRows.length === 0 &&
              statusFilter !== "all" && (
                <div className="px-6 py-12 text-center text-sm text-zinc-400">
                  No control groups match this filter.
                </div>
              )}

            {complianceView === "composite" &&
              !compositeInitialLoading &&
              filteredCompositePanelRows.length > 0 && (
                <CompositeControlsPanel
                  rows={filteredCompositePanelRows}
                  findingCountByCheck={findingCountByCheck}
                  selectedId={selectedKind === "composite" ? selectedControlId : null}
                  onSelect={selectComposite}
                  frameworkRows={rows}
                  acceptedCompositeIds={acceptedCompositeIds}
                  expiredCompositeIds={expiredCompositeIds}
                  statusFilter={statusFilter}
                />
              )}

            {complianceView === "composite" &&
              !compositeInitialLoading &&
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
                const isSelected =
                  selectedKind === "detailed" && selectedControlId === ctrl.id;
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
                      onClick={() => selectDetailedControl(ctrl.id)}
                      aria-expanded={isSelected}
                      className={`flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors ${
                        displayStatus === "passing" && !isSelected
                          ? "bg-emerald-50/30 hover:bg-emerald-50/50"
                          : "hover:bg-zinc-50/60"
                      } ${isSelected ? "is-expanded" : ""}`}
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
                          <p className="mt-0.5 text-meta leading-relaxed text-zinc-500 line-clamp-1">
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
                          onOpen={() => selectDetailedControl(ctrl.id, "evidence")}
                        />
                        <ComplianceRowSummary
                          displayStatus={displayStatus}
                          href={findingsHref}
                          onNavigate={(href) => navigate(href)}
                        />
                        <ComplianceExpandChevron expanded={isSelected} />
                      </div>
                    </button>
                  </div>
                );
              })}
          </ComplianceContentShell>
        </div>

        <>
          {selectedKind === "composite" && selectedCompositeRow ? (
            <ControlDetailPanel
              key={selectedCompositeRow.id}
              tabs={buildCompositeTabs({
                ctrl: selectedCompositeRow,
                findingCountByCheck,
                severityByCheck,
                framework,
                frameworkRows: rows,
                acceptedCompositeIds,
                expiredCompositeIds,
                externalEvidence: externalEvidence.data ?? [],
                canEditEvidence,
                navigate,
              })}
              activeTab={selectedTab}
              onTabChange={setSelectedTab}
              onClose={() => {
                setSelectedControlId(null);
                setSelectedKind(null);
              }}
              headerTitle={selectedCompositeRow.title}
              headerDescription={selectedCompositeRow.description}
              mode="overlay"
            />
          ) : selectedKind === "detailed" && selectedDetailedControl ? (
            <ControlDetailPanel
              key={selectedDetailedControl.id}
              tabs={buildDetailedTabs({
                ctrl: selectedDetailedControl,
                framework,
                findingCountByCheck,
                canAttest,
                attestPending: attest.isPending,
                onAttest: (status) => attest.mutate({ id: selectedDetailedControl.id, status }),
                externalEvidence: externalEvidence.data ?? [],
                submittedCount: submittedCountByControl.get(selectedDetailedControl.id) ?? 0,
                compositeId: compositeIdByControlId.get(selectedDetailedControl.id) ?? null,
                canEditEvidence,
              })}
              activeTab={selectedTab}
              onTabChange={setSelectedTab}
              onClose={() => {
                setSelectedControlId(null);
                setSelectedKind(null);
              }}
              headerTitle={shortControlTitle(selectedDetailedControl.title)}
              headerDescription={selectedDetailedControl.description}
              headerStatus={
                <ComplianceRowSummary
                  displayStatus={controlDisplayStatus(selectedDetailedControl, findingCountByCheck)}
                  href={null}
                  onNavigate={navigate}
                />
              }
              mode="overlay"
            />
          ) : null}
        </>
      </div>
      )}
        </>
      )}
    </div>
  );
}
