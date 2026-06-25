import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, token } from "../api";
import { roleAtLeast, useMe } from "../hooks/useMe";
import { labelForCheck } from "../data/checkLabels";
import { FRAMEWORKS } from "../data/frameworks";
import { ComplianceFrameworkSelect } from "../components/ComplianceFrameworkSelect";
import { FilterChipBar } from "../components/FilterChipBar";
import ConnectAwsEmptyState from "../components/ConnectAwsEmptyState";
import { EvidencePackExportPanel } from "../components/EvidencePackExportPanel";
import type { ComplianceHistoryResponse } from "../lib/complianceHistory";
import type { EvidenceCoverage } from "../lib/evidenceCoverage";
import {
  controlEvidenceSectionTitle,
  controlEvidenceUsesType2Bar,
  frameworkEvidenceUi,
  showControlEvidenceSection,
} from "../lib/frameworkEvidenceCoverage";
import { isAccountConnected } from "../lib/accountConnection";
import { fetchAllFindings } from "../lib/fetchAllFindings";
import { openFindingFailsControl } from "../lib/evidenceClass";
import { AccountFilterDropdown } from "../components/AccountFilterDropdown";
import { ExternalEvidencePanel } from "../components/ExternalEvidencePanel";
import { HeaderSlot } from "../context/HeaderSlot";
import "../styles/findings-v2.css";

const BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:8000";

type Account = { id: string; label: string; account_id: string | null; status: string; last_scan_at: string | null };

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
  status: "pass" | "fail" | "no_data";
  finding_count: number;
  open_finding_ids: string[];
};

type ComplianceDisplayStatus = "passing" | "failing" | "at_risk" | "unevaluated";

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
  status: "pass" | "fail" | "no_data";
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
  segments: { status: string; from: string; to: string; duration_seconds: number }[];
  events: { timestamp: string; type: string; detail: string }[];
};

const AUDIT_WINDOWS = [
  { value: "last_scan", label: "Last scan (point-in-time)" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
  { value: 180, label: "Last 180 days" },
  { value: 365, label: "Last 365 days" },
] as const;

type StatusFilter = "all" | "pass" | "fail" | "no_data";

type ComplianceView = "composite" | "detailed";

const statusExpandedBg: Record<string, string> = {
  pass: "bg-zinc-50/40",
  fail: "bg-zinc-50/50",
  no_data: "bg-zinc-50/40",
};

const COMPLIANCE_CARD_SHELL =
  "overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-md shadow-zinc-950/[0.04] ring-1 ring-zinc-950/[0.03]";

type OpenFindingMeta = { id: string; check_id: string; severity: string; resource_arn: string };

function ComplianceExpandChevron({ expanded, className = "" }: { expanded: boolean; className?: string }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${expanded ? "rotate-0" : "-rotate-90"} ${className}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function compositeDisplayStatus(
  ctrl: CompositeControlRow,
  findingCountByCheck: Map<string, number>,
): ComplianceDisplayStatus {
  if (ctrl.status === "pass") return "passing";
  if (ctrl.status === "no_data") return "unevaluated";
  const failingChecks = ctrl.check_ids.filter((id) => (findingCountByCheck.get(id) ?? 0) > 0);
  if (failingChecks.length === 0) return "failing";
  const hasCoreFailure = failingChecks.some((id) => (ctrl.check_tiers?.[id] ?? "core") === "core");
  return hasCoreFailure ? "failing" : "at_risk";
}

function controlDisplayStatus(
  ctrl: ControlRow,
  findingCountByCheck: Map<string, number>,
): ComplianceDisplayStatus {
  if (ctrl.status === "pass") return "passing";
  if (ctrl.status === "no_data") return "unevaluated";
  const failingChecks = ctrl.check_ids.filter((id) => (findingCountByCheck.get(id) ?? 0) > 0);
  if (failingChecks.length === 0) return "failing";
  const hasCoreFailure = failingChecks.some((id) => (ctrl.check_tiers?.[id] ?? "core") === "core");
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
  };

  const dotClass: Record<ComplianceDisplayStatus, string> = {
    passing: "bg-emerald-500",
    failing: "bg-rose-500",
    at_risk: "bg-amber-500",
    unevaluated: "bg-zinc-400",
  };

  const chipToneClass: Record<ComplianceDisplayStatus, string> = {
    passing: "bg-emerald-50 text-emerald-800 ring-emerald-200/80",
    failing: "bg-rose-50 text-rose-800 ring-rose-200/70",
    at_risk: "bg-amber-50 text-amber-800 ring-amber-200/70",
    unevaluated: "bg-zinc-100 text-zinc-600 ring-zinc-200/80",
  };
  const chipClass = `inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${chipToneClass[displayStatus]}`;
  const content = (
    <>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass[displayStatus]}`} aria-hidden />
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
        className={`${chipClass} transition hover:opacity-90`}
      >
        {content}
      </button>
    );
  }

  return <span className={chipClass}>{content}</span>;
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
        <p className="mt-1 text-meta leading-relaxed text-zinc-500">{subtitle}</p>
        {toolbar}
      </div>
      {section && <div className="border-b border-zinc-100 px-5 py-2.5">{section}</div>}
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
          No automated check maps here — attest its status with your own evidence.
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
            <option key={s.value} value={s.value}>{s.label}</option>
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
    if (controlId.startsWith("CC6")) return { key: "cc6", label: "CC6 Cloud Access" };
    if (controlId.startsWith("CC7")) return { key: "cc7", label: "CC7 Cloud Operations" };
    if (controlId.startsWith("CC8")) return { key: "cc8", label: "CC8 Change Evidence" };
    return { key: "manual-evidence", label: "Manual Evidence" };
  }

  if (framework === "cis_aws_l1") {
    const section = controlId.split(".")[0];
    if (section === "1") return { key: "cis-1", label: "CIS 1 Identity and Access" };
    if (section === "2") return { key: "cis-2", label: "CIS 2 Storage and Logging" };
    if (section === "3") return { key: "cis-3", label: "CIS 3 Networking" };
    if (section === "4") return { key: "cis-4", label: "CIS 4 Monitoring" };
  }

  if (framework === "iso27001") {
    if (controlId.startsWith("A.9")) return { key: "iso-a9", label: "A.9 Access Control" };
    if (controlId.startsWith("A.10")) return { key: "iso-a10", label: "A.10 Cryptography" };
    if (controlId.startsWith("A.12")) return { key: "iso-a12", label: "A.12 Operations Security" };
    if (controlId.startsWith("A.13")) return { key: "iso-a13", label: "A.13 Communications Security" };
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
    (a, b) => (
      a.key === "manual-evidence" || a.key === "other" ? 1 : 0
    ) - (
      b.key === "manual-evidence" || b.key === "other" ? 1 : 0
    ),
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
  if (/cloudtrail|guardduty|securityhub|aws\.config|vpc/.test(ids)) return "monitoring and logging";
  if (/s3|kms|rds|ec2\.ebs/.test(ids)) return "data-protection";
  if (/ec2\.security_group|rds\.instance\.publicly_accessible/.test(ids)) return "network-exposure";
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
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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
] as const;

const NESTED_COMPOSITE_IDS: Record<string, string> = {
  vulnerability_management: "container_vulnerability_monitoring",
};

const NESTED_COMPOSITE_DISPLAY: Record<string, { title: string; hint: string }> = {
  container_vulnerability_monitoring: {
    title: "Container image coverage",
    hint: "Applies when ECR, ECS, or EKS container evidence exists",
  },
};

type CompositeGroupVisual = {
  bg: string;
  text: string;
  ring: string;
  Icon: ({ className }: { className?: string }) => JSX.Element;
};

function IdentityGovernanceIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
    </svg>
  );
}

function AssetInventoryIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
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
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
    </svg>
  );
}

function ChangeManagementIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  );
}

function DataProtectionIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
      <rect x="5" y="10" width="14" height="9.5" rx="2" />
      <path d="M7.5 10V7a4.5 4.5 0 0 1 9 0v3" />
    </svg>
  );
}

function VulnerabilityManagementIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  );
}

function LoggingMonitoringIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="5" y="11" width="3.5" height="9" rx="0.75" />
      <rect x="10.25" y="6" width="3.5" height="14" rx="0.75" />
      <rect x="15.5" y="13" width="3.5" height="7" rx="0.75" />
    </svg>
  );
}

function BackupResilienceIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
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

function CompositeGroupFallbackIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

const COMPOSITE_GROUP_VISUALS: Record<string, CompositeGroupVisual> = {
  identity_governance: { bg: "bg-violet-50", text: "text-violet-600", ring: "ring-violet-200/80", Icon: IdentityGovernanceIcon },
  asset_inventory: { bg: "bg-sky-50", text: "text-sky-600", ring: "ring-sky-200/80", Icon: AssetInventoryIcon },
  secure_sdlc: { bg: "bg-indigo-50", text: "text-indigo-600", ring: "ring-indigo-200/80", Icon: SecureSdlcIcon },
  change_management: { bg: "bg-amber-50", text: "text-amber-700", ring: "ring-amber-200/80", Icon: ChangeManagementIcon },
  data_protection: { bg: "bg-emerald-50", text: "text-emerald-600", ring: "ring-emerald-200/80", Icon: DataProtectionIcon },
  vulnerability_management: { bg: "bg-rose-50", text: "text-rose-600", ring: "ring-rose-200/80", Icon: VulnerabilityManagementIcon },
  logging_monitoring: { bg: "bg-blue-50", text: "text-blue-600", ring: "ring-blue-200/80", Icon: LoggingMonitoringIcon },
  backup_resilience: { bg: "bg-teal-50", text: "text-teal-600", ring: "ring-teal-200/80", Icon: BackupResilienceIcon },
  container_vulnerability_monitoring: { bg: "bg-orange-50", text: "text-orange-600", ring: "ring-orange-200/80", Icon: VulnerabilityManagementIcon },
};

function CompositeGroupIcon({ id }: { id: string }) {
  const visual = COMPOSITE_GROUP_VISUALS[id] ?? {
    bg: "bg-zinc-100",
    text: "text-zinc-600",
    ring: "ring-zinc-200/70",
    Icon: CompositeGroupFallbackIcon,
  };
  const { bg, text, ring, Icon } = visual;

  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ${bg} ${text} ${ring}`}
      aria-hidden
    >
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

type CompositeTreeRow = {
  row: CompositeControlRow;
  child?: CompositeControlRow;
};

function prepareCompositeTreeRows(rows: CompositeControlRow[]): CompositeTreeRow[] {
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
    if (!COMPOSITE_DISPLAY_ORDER.includes(row.id as (typeof COMPOSITE_DISPLAY_ORDER)[number]) && !nestedChildIds.has(row.id)) {
      out.push({ row });
    }
  }
  return out;
}

function compositeAppliesToFramework(composite: CompositeControlRow, frameworkRows: ControlRow[]): boolean {
  if (frameworkRows.length === 0) return true;
  const checks = new Set(composite.check_ids);
  return frameworkRows.some((row) => row.check_ids.some((id) => checks.has(id)));
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
    .sort((a, b) => b.finding_count - a.finding_count || compareControlIds(a.control_id, b.control_id));
}

function ControlGroupsIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
    </svg>
  );
}

function DetailedCriteriaIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"
      />
    </svg>
  );
}

function ComplianceStatusFilterBar({
  total,
  passed,
  failed,
  noData,
  statusFilter,
  onChange,
}: {
  total: number;
  passed: number;
  failed: number;
  noData: number;
  statusFilter: StatusFilter;
  onChange: (filter: StatusFilter) => void;
}) {
  return (
    <FilterChipBar
      ariaLabel="Control status"
      selected={statusFilter}
      onChange={(id) => onChange(id as StatusFilter)}
      chips={[
        { id: "all", label: "All", count: total },
        { id: "fail", label: "Failing", count: failed, urgent: true },
        { id: "pass", label: "Passing", count: passed },
        { id: "no_data", label: "No data", count: noData },
      ]}
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
    <nav className="findings-v2-filter-chip-bar" role="tablist" aria-label="Control domains">
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
            <span className={isSelected ? "text-zinc-500" : "text-zinc-400"}> · {group.rows.length}</span>
          </button>
        );
      })}
    </nav>
  );
}

function ComplianceViewSwitcher({
  view,
  onChange,
}: {
  view: ComplianceView;
  onChange: (view: ComplianceView) => void;
}) {
  const options = [
    {
      id: "composite" as const,
      label: "Groups",
      title: "Control groups — higher-level rollups",
      Icon: ControlGroupsIcon,
    },
    {
      id: "detailed" as const,
      label: "Criteria",
      title: "Detailed criteria — per framework control",
      Icon: DetailedCriteriaIcon,
    },
  ];

  return (
    <div
      className="inline-flex h-9 shrink-0 items-center gap-0.5 rounded-lg border border-[#dce3ec] bg-[#f8fafc]/90 p-0.5"
      role="tablist"
      aria-label="Compliance view"
    >
      {options.map((opt) => {
        const isActive = view === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            title={opt.title}
            onClick={() => onChange(opt.id)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-all outline-none focus-visible:ring-2 focus-visible:ring-[#1f4e79]/25 ${
              isActive
                ? "bg-white text-[#1f4e79] shadow-sm shadow-zinc-950/[0.04] ring-1 ring-[#dce3ec]"
                : "text-[#6b7280] hover:bg-white/80 hover:text-[#111827]"
            }`}
          >
            <opt.Icon
              className={`h-4 w-4 shrink-0 ${isActive ? "text-[#1f4e79]/80" : "text-[#98a2b3]"}`}
            />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ComplianceUnifiedToolbar({
  complianceView,
  onComplianceViewChange,
  framework,
  frameworkStatsById,
  onFrameworkChange,
  statusFilter,
  onStatusFilterChange,
  statusCounts,
  showStatusFilter,
  auditExport,
  showAuditExport,
}: {
  complianceView: ComplianceView;
  onComplianceViewChange: (view: ComplianceView) => void;
  framework: string;
  frameworkStatsById: Record<string, FrameworkStats | undefined>;
  onFrameworkChange: (id: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (filter: StatusFilter) => void;
  statusCounts: { total: number; passed: number; failed: number; noData: number };
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
            statusFilter={statusFilter}
            onChange={onStatusFilterChange}
          />
        )}
        <ComplianceFrameworkSelect
          selectedId={framework}
          statsById={frameworkStatsById}
          onSelect={onFrameworkChange}
        />
      </div>
      <div className="findings-v2-control-cluster">
        <div
          className="findings-v2-toolbar-group findings-v2-toolbar-group--divider"
          role="group"
          aria-label="Compliance view"
        >
          <ComplianceViewSwitcher view={complianceView} onChange={onComplianceViewChange} />
        </div>
        {showAuditExport && (
          <div className="findings-v2-toolbar-group findings-v2-actions-group" role="group" aria-label="Export">
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
  toolbar: ReactNode;
  section?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-4 min-w-0 rounded-2xl border border-[#e6ebf2] bg-white shadow-sm shadow-zinc-950/[0.04]">
      {toolbar}
      {section && <div className="border-b border-zinc-100 px-5 py-2.5">{section}</div>}
      <div className="divide-y divide-zinc-100 overflow-hidden rounded-b-2xl">{children}</div>
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

function findingsHrefForChecks(checkIds: string[], findingCountByCheck: Map<string, number>) {
  const active = checkIds.filter((id) => (findingCountByCheck.get(id) ?? 0) > 0);
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
    .sort((a, b) => (findingCountByCheck.get(b) ?? 0) - (findingCountByCheck.get(a) ?? 0))
    .slice(0, max);
}

const COMPOSITE_RISK_SUMMARY: Record<string, string> = {
  identity_governance: "High impact from over-provisioned access",
  asset_inventory: "Untracked or dormant assets weaken access reviews",
  secure_sdlc: "Missing CI security controls increase supply-chain risk",
  change_management: "Unprotected branches allow unaudited production changes",
  data_protection: "Encryption gaps expose data at rest and in transit",
  vulnerability_management: "Unpatched or unscanned workloads increase breach risk",
  logging_monitoring: "Monitoring blind spots hide unauthorized activity",
  backup_resilience: "Missing backups threaten recovery objectives",
  container_vulnerability_monitoring: "Container images may ship without vulnerability coverage",
};

function compositeRiskSummary(ctrl: CompositeControlRow): string {
  return COMPOSITE_RISK_SUMMARY[ctrl.id] ?? ctrl.guidance ?? "Review mapped checks and remediate open findings.";
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
          const pct = maxCount > 0 ? Math.max(4, Math.round((count / maxCount) * 100)) : 0;
          return (
            <li key={checkId} className="border-b border-zinc-100 last:border-b-0">
              <button
                type="button"
                onClick={() => navigate(`/findings?checks=${encodeURIComponent(checkId)}`)}
                className="compliance-top-checks-table__row group grid w-full grid-cols-[auto_minmax(0,1fr)_4.5rem_6.5rem] items-center gap-3 py-3 text-left transition hover:bg-zinc-50/80"
              >
                <span className="w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-zinc-400">
                  {index + 1}
                </span>
                <span className="truncate text-sm font-medium text-zinc-900">{labelForCheck(checkId)}</span>
                <span className="text-right text-sm font-semibold tabular-nums text-zinc-900">{count}</span>
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

function InsightIcon({ tone, children }: { tone: "emerald" | "sky" | "rose"; children: ReactNode }) {
  return (
    <span className={`compliance-group-insight__icon compliance-group-insight__icon--${tone}`} aria-hidden>
      {children}
    </span>
  );
}

function CompositeGroupInsights({
  ctrl,
  findingCountByCheck,
}: {
  ctrl: CompositeControlRow;
  findingCountByCheck: Map<string, number>;
}) {
  const topCheckId = sortedTopFailingChecks(ctrl.check_ids, findingCountByCheck, 1)[0];
  const topIssueCount = topCheckId ? (findingCountByCheck.get(topCheckId) ?? 0) : 0;

  return (
    <div className="compliance-group-insights-card">
      <p className="compliance-group-card-title">Group insights</p>
      <ul className="compliance-group-insight-rows">
        <li className="compliance-group-insight-row">
          <div className="compliance-group-insight-row__lead">
            <InsightIcon tone="emerald">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </InsightIcon>
            <span className="compliance-group-insight-row__label">Total findings</span>
          </div>
          <span className="compliance-group-insight-row__value tabular-nums">{ctrl.finding_count}</span>
        </li>
        {topCheckId ? (
          <li className="compliance-group-insight-row">
            <div className="compliance-group-insight-row__lead">
              <InsightIcon tone="sky">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
              </InsightIcon>
              <span className="compliance-group-insight-row__label">Top issue</span>
            </div>
            <span className="compliance-group-insight-row__value compliance-group-insight-row__value--wrap">
              {labelForCheck(topCheckId)}{" "}
              <span className="tabular-nums text-rose-700">({topIssueCount} findings)</span>
            </span>
          </li>
        ) : null}
        <li className="compliance-group-insight-row">
          <div className="compliance-group-insight-row__lead">
            <InsightIcon tone="rose">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </InsightIcon>
            <span className="compliance-group-insight-row__label">Risk summary</span>
          </div>
          <span className="compliance-group-insight-row__value compliance-group-insight-row__value--wrap">
            {compositeRiskSummary(ctrl)}
            {ctrl.finding_count > 0 ? <span className="compliance-group-insight-row__dot" aria-hidden /> : null}
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
        <p className="compliance-group-explore-card__hint">Dive deeper into findings and historical activity.</p>
      </div>
      <div className="compliance-group-explore-card__actions">
        {findingsHref ? (
          <button type="button" onClick={() => navigate(findingsHref)} className="compliance-group-explore-btn compliance-group-explore-btn--primary">
            View findings
          </button>
        ) : (
          <span className="text-sm text-zinc-500">No open findings</span>
        )}
        <Link to={`/history?${historyParams.toString()}`} className="compliance-group-explore-btn" onClick={(e) => e.stopPropagation()}>
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
                onClick={() => navigate(`/findings?checks=${encodeURIComponent(checkId)}`)}
                className="flex w-full items-center justify-between gap-3 text-left transition hover:opacity-80"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" aria-hidden />
                  <span className="truncate text-sm text-zinc-800">{labelForCheck(checkId)}</span>
                </span>
                <span className="shrink-0 tabular-nums text-sm font-medium text-zinc-700">{count}</span>
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
        const pct = maxCount > 0 ? Math.max(4, Math.round((count / maxCount) * 100)) : 0;
        return (
          <li key={checkId}>
            <button
              type="button"
              onClick={() => navigate(`/findings?checks=${encodeURIComponent(checkId)}`)}
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
                <span className="truncate text-sm font-medium text-zinc-900">{labelForCheck(checkId)}</span>
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
}: {
  ctrl: CompositeControlRow;
  findingCountByCheck: Map<string, number>;
  variant?: "default" | "card";
  framework?: string;
  frameworkRows?: ControlRow[];
  accountId?: string | null;
}) {
  const navigate = useNavigate();
  const findingsHref = findingsHrefForChecks(ctrl.check_ids, findingCountByCheck);

  if (variant === "card") {
    return (
      <div className="compliance-group-expanded">
        <div className="compliance-group-checks-card">
          {ctrl.finding_count > 0 ? (
            <div className="compliance-top-checks__header grid grid-cols-[auto_minmax(0,1fr)_4.5rem_6.5rem] items-end gap-3">
              <p className="col-span-2 compliance-group-card-title">Top failing checks</p>
              <span className="compliance-top-checks__col-head">Findings</span>
              <span className="compliance-top-checks__col-head">Density</span>
            </div>
          ) : (
            <p className="compliance-group-card-title">Top failing checks</p>
          )}
          {ctrl.finding_count > 0 ? (
            <TopFailingChecksTable checkIds={ctrl.check_ids} findingCountByCheck={findingCountByCheck} />
          ) : (
            <p className="mt-2 text-sm text-zinc-500">No open findings on mapped checks.</p>
          )}
        </div>
        <div className="compliance-group-expanded__side">
          <CompositeGroupInsights ctrl={ctrl} findingCountByCheck={findingCountByCheck} />
          <ExternalEvidencePanel
            compositeId={ctrl.id}
            compositeTitle={ctrl.title}
            framework={framework}
            checkIds={ctrl.check_ids}
            underlyingCriteria={underlyingCriteriaForComposite(ctrl, frameworkRows)}
            frameworkControlLabel={(controlId) => frameworkControlLabel(framework, controlId)}
          />
          <CompositeGroupExplore groupId={ctrl.id} findingsHref={findingsHref} framework={framework} accountId={accountId} />
        </div>
      </div>
    );
  }

  const underlying = underlyingCriteriaForComposite(ctrl, frameworkRows);

  return (
    <div className={`veritrail-expand-in space-y-4 border-t border-zinc-100 px-5 pb-5 pt-4 sm:pl-12 ${statusExpandedBg[ctrl.status]}`}>
      {underlying.length > 0 && (
        <div>
          <p className="veritrail-kicker">Underlying criteria</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {underlying.slice(0, 10).map((c) => {
              const params = new URLSearchParams({ framework, control: c.control_id });
              if (accountId) params.set("account_id", accountId);
              return (
                <Link
                  key={c.id}
                  to={`/controls?${params}`}
                  className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700 transition hover:border-indigo-200 hover:text-indigo-800"
                >
                  {frameworkControlLabel(framework, c.control_id)}
                  {c.finding_count > 0 && (
                    <span className="ml-1.5 tabular-nums text-rose-600/90">({c.finding_count})</span>
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
          <TopFailingChecksList checkIds={ctrl.check_ids} findingCountByCheck={findingCountByCheck} />
        </div>
      </div>
    </div>
  );
}

function QuietNestedCompositeRow({
  child,
  expandedId,
  onToggle,
  framework,
  frameworkRows,
  accountId,
  findingCountByCheck,
}: {
  child: CompositeControlRow;
  expandedId: string | null;
  onToggle: (id: string) => void;
  framework: string;
  frameworkRows: ControlRow[];
  accountId?: string | null;
  findingCountByCheck: Map<string, number>;
}) {
  const navigate = useNavigate();
  const display = NESTED_COMPOSITE_DISPLAY[child.id];
  const isExpanded = expandedId === child.id;
  const href = findingsHrefForChecks(child.check_ids, findingCountByCheck);

  return (
    <div className="border-t border-zinc-100/90 bg-zinc-50/20">
      <button
        type="button"
        onClick={() => onToggle(child.id)}
        className="flex w-full items-center gap-2 py-2.5 pl-5 pr-5 text-left transition-colors hover:bg-zinc-50/80 sm:pl-[10.75rem]"
      >
        <span className="shrink-0 text-sm text-zinc-300" aria-hidden>
          └
        </span>
        <div className="min-w-0 flex-1 truncate text-[13px] leading-snug">
          <span className="font-medium text-zinc-700">{display?.title ?? child.title}</span>
          {(display?.hint ?? child.description) ? (
            <>
              <span className="px-1.5 font-normal text-zinc-300" aria-hidden>
                ·
              </span>
              <span className="font-normal text-zinc-500">{display?.hint ?? child.description}</span>
            </>
          ) : null}
        </div>
        <ComplianceRowSummary
          displayStatus={compositeDisplayStatus(child, findingCountByCheck)}
          href={href}
          onNavigate={(h) => navigate(h)}
        />
        <ComplianceExpandChevron expanded={isExpanded} className="h-3 w-3" />
      </button>
      {isExpanded && (
        <CompositeExpandedDetails
          ctrl={child}
          framework={framework}
          frameworkRows={frameworkRows}
          accountId={accountId}
          findingCountByCheck={findingCountByCheck}
        />
      )}
    </div>
  );
}

function CompositeControlsPanel({
  rows,
  findingCountByCheck,
  expandedId,
  onToggle,
  framework,
  frameworkRows,
  accountId,
}: {
  rows: CompositeControlRow[];
  findingCountByCheck: Map<string, number>;
  expandedId: string | null;
  onToggle: (id: string) => void;
  framework: string;
  frameworkRows: ControlRow[];
  accountId?: string | null;
}) {
  const navigate = useNavigate();
  const treeRows = useMemo(() => prepareCompositeTreeRows(rows), [rows]);

  if (treeRows.length === 0) return null;

  return (
    <div className="divide-y divide-zinc-100">
      {treeRows.map(({ row: ctrl, child }) => {
        const isExpanded = expandedId === ctrl.id;
        const displayStatus = compositeDisplayStatus(ctrl, findingCountByCheck);
        const findingsHref = findingsHrefForChecks(ctrl.check_ids, findingCountByCheck);

        return (
          <div key={ctrl.id}>
            <button
              type="button"
              onClick={() => onToggle(ctrl.id)}
              aria-expanded={isExpanded}
              className={`flex w-full items-start gap-3.5 px-5 py-4 text-left transition-colors ${
                displayStatus === "passing" && !isExpanded
                  ? "bg-emerald-50/30 hover:bg-emerald-50/50"
                  : "hover:bg-zinc-50/60"
              } ${isExpanded ? "bg-white" : ""}`}
            >
              <CompositeGroupIcon id={ctrl.id} />
              <div className="min-w-0 flex-1 py-0.5">
                <p className="text-[15px] font-semibold leading-snug tracking-[-0.01em] text-zinc-900">{ctrl.title}</p>
                <p
                  className={`mt-1 text-[13px] leading-relaxed text-zinc-500 ${isExpanded ? "" : "line-clamp-1"}`}
                >
                  {ctrl.description}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 self-center">
                <ComplianceRowSummary
                  displayStatus={displayStatus}
                  href={findingsHref}
                  onNavigate={(href) => navigate(href)}
                />
                <ComplianceExpandChevron expanded={isExpanded} />
              </div>
            </button>

            <div className={`veritrail-accordion-panel ${isExpanded ? "is-open" : ""}`}>
              <div className="veritrail-accordion-panel__inner">
                <div className="border-t border-zinc-100 bg-white px-5 pb-5 pt-5">
                  <CompositeExpandedDetails
                    ctrl={ctrl}
                    findingCountByCheck={findingCountByCheck}
                    variant="card"
                    framework={framework}
                    frameworkRows={frameworkRows}
                    accountId={accountId}
                  />
                </div>
              </div>
            </div>

            {child && compositeAppliesToFramework(child, frameworkRows) ? (
              <QuietNestedCompositeRow
                child={child}
                expandedId={expandedId}
                onToggle={onToggle}
                framework={framework}
                frameworkRows={frameworkRows}
                accountId={accountId}
                findingCountByCheck={findingCountByCheck}
              />
            ) : null}
          </div>
        );
      })}
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

const CHECK_GROUP_ORDER = ["IAM", "GitHub", "GitLab", "Entra", "Google_workspace", "Identity_center", "S3", "KMS", "CloudTrail", "EC2", "RDS", "Lambda", "DynamoDB", "ECR", "EKS", "ECS", "ACM", "ELB", "Secrets", "SSM", "SNS", "SQS", "GuardDuty", "AWS", "VPC"];

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
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
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
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${styles}`}>
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
        (a, b) => (findingCountByCheck.get(b) ?? 0) - (findingCountByCheck.get(a) ?? 0),
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
                    onClick={() => navigate(`/findings?checks=${encodeURIComponent(cid)}`)}
                    className="group flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-zinc-50/80"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-snug text-zinc-900 group-hover:text-indigo-700">
                        {labelForCheck(cid)}
                        {openCount > 0 && (
                          <span className="ml-1.5 tabular-nums text-rose-600/80">({openCount})</span>
                        )}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <EvidenceClassBadge evidenceClass={checkEvidenceClasses[cid]} />
                      </div>
                    </div>
                    <svg
                      className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition-colors group-hover:text-indigo-500"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
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
      <p className="mt-0.5 text-xs text-zinc-500">Open findings by mapped check · click to filter in Findings</p>
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
    <svg className={`${className} shrink-0 text-zinc-400`} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" />
    </svg>
  );
}

function ControlStatusPill({ status, compact = false }: { status: ControlRow["status"]; compact?: boolean }) {
  const styles = {
    pass: {
      pill: compact ? "bg-emerald-50/80 text-emerald-800 ring-emerald-200/60" : "bg-emerald-50 text-emerald-800 ring-emerald-200/70",
      dot: "bg-emerald-500",
      icon: "text-emerald-600",
    },
    fail: {
      pill: compact ? "bg-amber-50/80 text-amber-900 ring-amber-200/60" : "bg-amber-50 text-amber-900 ring-amber-200/70",
      dot: "bg-amber-500",
      icon: "text-amber-600",
    },
    no_data: {
      pill: compact ? "bg-zinc-100 text-zinc-600 ring-zinc-200/70" : "bg-zinc-100 text-zinc-600 ring-zinc-200/80",
      dot: "bg-zinc-400",
      icon: "text-zinc-500",
    },
  }[status];

  const label = status === "pass" ? "Passing" : status === "fail" ? "Failing" : "Not evaluated";

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${styles.pill}`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${styles.dot}`} aria-hidden />
        {label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${styles.pill}`}
    >
      {status === "fail" ? (
        <svg className={`h-3.5 w-3.5 shrink-0 ${styles.icon}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M8 12h8M12 8v8" />
        </svg>
      ) : status === "pass" ? (
        <svg className={`h-3.5 w-3.5 shrink-0 ${styles.icon}`} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${styles.dot}`} aria-hidden />
      )}
      {label}
    </span>
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
  const coveragePct = coverage ? Math.min(100, Math.round(coverage.coverage_ratio * 100)) : 0;
  const evidenceUi = frameworkEvidenceUi(framework, coverage, periodDays);
  const showEvidence = showControlEvidenceSection(framework);

  let statusSubline: string | null = null;
  if (h?.current_status === "fail") {
    if (h.failing_since) statusSubline = `Since ${formatEvidenceDate(h.failing_since)}`;
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
    framework === "soc2" ? "Evidence coverage" : controlEvidenceSectionTitle(framework);
  const compactStatus = framework !== "soc2";

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200/80 bg-white">
      <div className={`grid grid-cols-1 ${showEvidence ? "lg:grid-cols-2 lg:divide-x lg:divide-zinc-100" : ""}`}>
        <div className={compactStatus ? "px-4 py-3" : "p-4"}>
          <p className="text-sm font-semibold text-zinc-950">Control status</p>
          <div className={`${compactStatus ? "mt-2" : "mt-3"} w-fit`}>
            <ControlStatusPill status={control.status} compact={compactStatus} />
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
                <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2m-9 4h10m-9 4h6m-7 6h8a2 2 0 002-2v-6H6v6a2 2 0 002 2z" />
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
                      <span className="font-semibold tabular-nums text-zinc-900">{scans}</span> Scans
                    </>
                  ) : null}
                </span>
              </div>
            )}
          </div>
        </div>

        {showEvidence ? (
          <div className="border-t border-zinc-100 p-4 lg:border-t-0">
            <p className="text-sm font-semibold text-zinc-950">{evidenceTitle}</p>
            {coverage ? (
              controlEvidenceUsesType2Bar(framework) ? (
                <div className="mt-3 space-y-2.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm text-zinc-700">
                    <span>
                      <span className="font-semibold tabular-nums text-zinc-900">{coverageDays}</span>
                      <span className="tabular-nums text-zinc-500"> / </span>
                      <span className="font-semibold tabular-nums text-zinc-900">{coverageTotal}</span>
                      {" audit days collected"}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-zinc-900">{coveragePct}%</span>
                  </div>
                  <CoverageProgressBar
                    coverageDays={coverageDays}
                    coverageTotal={coverageTotal}
                    coveragePct={coveragePct}
                    barFillClass={barFillClass}
                    className="h-2"
                  />
                  {coverageGuidance ? (
                    <p className="text-sm leading-relaxed text-zinc-500">{coverageGuidance}</p>
                  ) : null}
                </div>
              ) : (
                <div className="mt-3 space-y-1.5">
                  <p className="text-sm text-zinc-700">
                    {evidenceUi.headline ?? (
                      <>
                        <span className="font-semibold tabular-nums text-zinc-900">{coverageDays}</span>
                        {coverageDays === 1 ? " day" : " days"} collected in the selected export period
                      </>
                    )}
                  </p>
                  {evidenceUi.detailLine ? (
                    <p className="text-sm leading-relaxed text-zinc-500">{evidenceUi.detailLine}</p>
                  ) : null}
                </div>
              )
            ) : (
              <p className="mt-3 text-sm text-zinc-600">{periodDays}-day export window</p>
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
    <div>
      <p className="text-base font-semibold text-zinc-950">Mapped checks ({checkIds.length})</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {grouped.map(([group, ids]) => (
          <div key={group} className="rounded-lg border border-zinc-200/80 bg-white px-4 py-3.5">
            <p className="text-sm font-bold text-zinc-900">
              {group} <span className="font-normal text-zinc-500">({ids.length})</span>
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm leading-snug text-zinc-800">
              {ids.map((cid) => (
                <li key={cid} title={cid}>
                  {labelForCheck(cid)}
                </li>
              ))}
            </ul>
          </div>
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
      <div>
        <p className="text-sm font-semibold text-zinc-900">Findings</p>
        <p className="mt-1 text-sm text-zinc-500">No open findings on mapped checks.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm font-semibold text-zinc-900">Top failing checks</p>
      <TopFailingChecksTable checkIds={checkIds} findingCountByCheck={findingCountByCheck} max={8} />
      {findingsHref ? (
        <button
          type="button"
          onClick={() => navigate(findingsHref)}
          className="mt-4 text-sm font-medium text-indigo-600 transition hover:text-indigo-800"
        >
          View all {openTotal} findings →
        </button>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">No open findings in mapped checks.</p>
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

function useFrameworkStats(framework: string, accountId: string | undefined, enabled: boolean) {
  return useQuery({
    // Share the ["controls", ...] cache key (same endpoint) so this is covered by every
    // existing ["controls"] invalidation. A dedicated key here was never invalidated after
    // scans/rechecks, so the tab percentages went stale until a hard refresh.
    queryKey: ["controls", framework, accountId],
    queryFn: () =>
      api<ControlRow[]>(
        `/v1/controls?framework=${framework}${accountId ? `&account_id=${accountId}` : ""}`
      ),
    enabled: enabled && !!accountId,
    select: (rows): FrameworkStats => {
      const total = rows.length;
      const passed = rows.filter((r) => r.status === "pass").length;
      const failed = rows.filter((r) => r.status === "fail").length;
      const openFindings = rows.reduce((sum, r) => sum + r.finding_count, 0);
      return {
        passRate: total > 0 ? Math.round((passed / total) * 100) : null,
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
  const [framework, setFramework] = useState(
    () => (urlFramework && FRAMEWORKS.some((f) => f.id === urlFramework) ? urlFramework : "soc2"),
  );
  const [selectedFamilyKey, setSelectedFamilyKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedComposite, setExpandedComposite] = useState<string | null>(null);
  const [complianceView, setComplianceView] = useState<ComplianceView>(() =>
    urlView === "detailed" || urlControl ? "detailed" : "composite",
  );
  const [downloading, setDownloading] = useState(false);
  const [periodKey, setPeriodKey] = useState<string | number>(90);
  const [asOf, setAsOf] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportAnchor, setExportAnchor] = useState<{ top: number; right: number } | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const exportPanelRef = useRef<HTMLDivElement>(null);

  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<Account[]>("/v1/accounts"),
  });

  const connectedAccount = accounts.data?.find((a) => isAccountConnected(a));
  const connectedAccounts = useMemo(
    () => accounts.data?.filter((a) => isAccountConnected(a)) ?? [],
    [accounts.data],
  );
  const activeAccount =
    (urlAccountId && accounts.data?.find((a) => a.id === urlAccountId && isAccountConnected(a))) ||
    connectedAccount;
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
        `/v1/controls?framework=${framework}${activeAccount ? `&account_id=${activeAccount.id}` : ""}`
      ),
    enabled: !accounts.isLoading,
  });

  const qc = useQueryClient();
  const meQ = useMe();
  const canAttest = roleAtLeast(meQ.data?.role, "admin");
  const attest = useMutation({
    mutationFn: (v: { id: string; status: string }) =>
      api(`/v1/controls/${v.id}/attestation`, { method: "PUT", body: JSON.stringify({ status: v.status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["controls"] }),
  });

  const compositeControls = useQuery({
    queryKey: ["controls", "composites", activeAccount?.id],
    queryFn: () =>
      api<CompositeControlRow[]>(
        `/v1/controls/composites${activeAccount ? `?account_id=${activeAccount.id}` : ""}`,
      ),
    enabled: !accounts.isLoading && !!activeAccount,
  });

  const deepLinkDone = useRef(false);
  useEffect(() => {
    deepLinkDone.current = false;
  }, [framework, urlControl]);

  useEffect(() => {
    if (urlStatus === "pass" || urlStatus === "fail" || urlStatus === "no_data") {
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
      if (urlStatus === "pass" || urlStatus === "fail" || urlStatus === "no_data") {
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
    if (!urlComposite || !compositeControls.data?.length) return;
    const match = compositeControls.data.find((r) => r.id === urlComposite);
    if (match) {
      setComplianceView("composite");
      setExpandedComposite(match.id);
    }
  }, [compositeControls.data, urlComposite]);

  const checkFrameworksQ = useQuery({
    queryKey: ["check-frameworks"],
    queryFn: () =>
      api<{ evidence_classes: Record<string, string> }>("/v1/controls/check-frameworks"),
    staleTime: 300_000,
  });

  const openFindingsRaw = useQuery({
    queryKey: ["findings", "open", activeAccount?.id, "controls-meta"],
    queryFn: () => fetchAllFindings<OpenFindingMeta>({ status: "open" }),
    enabled: !!activeAccount && hasScanned,
  });

  const openFindingsMeta = useMemo(() => {
    const evidenceClasses = checkFrameworksQ.data?.evidence_classes;
    const byId = new Map<string, OpenFindingMeta>();
    const countByCheck = new Map<string, number>();
    for (const f of openFindingsRaw.data?.items ?? []) {
      if (!openFindingFailsControl(f.check_id, evidenceClasses)) continue;
      byId.set(f.id, f);
      countByCheck.set(f.check_id, (countByCheck.get(f.check_id) ?? 0) + 1);
    }
    return { byId, countByCheck };
  }, [checkFrameworksQ.data?.evidence_classes, openFindingsRaw.data?.items]);

  const findingCountByCheck = openFindingsMeta.countByCheck;

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
    queryKey: ["evidence-coverage", activeAccount?.id, exportWindow.period, exportWindow.asOf],
    queryFn: () => {
      const params = new URLSearchParams({
        period: String(exportWindow.period),
      });
      if (exportWindow.asOf) params.set("as_of", exportWindow.asOf);
      return api<EvidenceCoverage>(
        `/v1/accounts/${activeAccount!.id}/evidence-coverage?${params}`
      );
    },
    enabled: !!activeAccount && hasScanned,
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

  const soc2Stats = useFrameworkStats("soc2", activeAccount?.id, hasScanned);
  const cisStats = useFrameworkStats("cis_aws_l1", activeAccount?.id, hasScanned);
  const isoStats = useFrameworkStats("iso27001", activeAccount?.id, hasScanned);

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
    enabled: !!activeAccount && hasScanned,
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
  const passed = rows.filter((r) => r.status === "pass").length;
  const failed = rows.filter((r) => r.status === "fail").length;
  const noData = rows.filter((r) => r.status === "no_data").length;
  const total = rows.length;
  const filteredRows = useMemo(
    () => (statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter)),
    [rows, statusFilter]
  );

  const groupedRows = useMemo(
    () => groupControls(filteredRows, framework),
    [filteredRows, framework],
  );
  const selectedGroup = groupedRows.find((group) => group.key === selectedFamilyKey) ?? groupedRows[0] ?? null;
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
    () => compositePanelRows.filter((c) => c.id !== "container_vulnerability_monitoring"),
    [compositePanelRows],
  );

  const compositePassed = primaryComposites.filter((c) => c.status === "pass").length;
  const compositeFailed = primaryComposites.filter((c) => c.status === "fail").length;
  const compositeNoData = primaryComposites.filter((c) => c.status === "no_data").length;
  const compositeTotal = primaryComposites.length;

  const filteredCompositePanelRows = useMemo(
    () =>
      statusFilter === "all"
        ? compositePanelRows
        : compositePanelRows.filter((c) => c.status === statusFilter),
    [compositePanelRows, statusFilter],
  );

  function handleStatusFilterChange(filter: StatusFilter) {
    setStatusFilter(filter);
    setExpanded(null);
    setExpandedComposite(null);
  }

  async function downloadPack(opts?: { framework?: string; period?: number; asOf?: string }) {
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
      a.download = `veritrail-evidence-${opts?.framework ?? framework}-${(asOfVal ?? new Date().toISOString().slice(0, 10))}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Download failed: " + String(e));
    } finally {
      setDownloading(false);
    }
  }

  if (!accounts.isLoading && !connectedAccount) {
    return <ConnectAwsEmptyState />;
  }

  const showAuditExportAboveCard =
    !!connectedAccount &&
    !controls.isLoading &&
    ((complianceView === "composite" &&
      !compositeControls.isLoading &&
      filteredCompositePanelRows.length > 0) ||
      (complianceView === "detailed" && groupedRows.length > 0 && !!selectedGroup));

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
          <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
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
                  activeAccount?.last_scan_at ? lastScanLabel(activeAccount.last_scan_at) : null
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
          <AccountFilterDropdown accounts={connectedAccounts} value={activeAccount.id} onChange={handleAccountChange} />
        </HeaderSlot>
      )}

      {!hasScanned && connectedAccount && !controls.isLoading && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/60 px-5 py-4 text-sm text-amber-900">
          <span className="font-semibold">Awaiting first scan.</span> Control pass/fail status appears after your account finishes scanning.
        </div>
      )}

      {controls.isLoading && <LoadingSkeleton />}

      {!controls.isLoading && connectedAccount && (
        <ComplianceContentShell
          toolbar={
            <div>
              <ComplianceUnifiedToolbar
                complianceView={complianceView}
                onComplianceViewChange={setComplianceViewWithUrl}
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
                        failed: compositeFailed,
                        noData: compositeNoData,
                      }
                    : { total, passed, failed, noData }
                }
                showStatusFilter={
                  (complianceView === "composite" &&
                    !compositeControls.isLoading &&
                    primaryComposites.length > 0) ||
                  (complianceView === "detailed" && total > 0)
                }
                auditExport={auditPackageExport}
                showAuditExport={showAuditExportAboveCard}
              />
            </div>
          }
          section={
            complianceView === "detailed" && groupedRows.length > 1 && selectedGroup ? (
              <ComplianceFamilyNav
                groups={groupedRows}
                selectedKey={selectedGroup.key}
                onSelect={(key) => {
                  setSelectedFamilyKey(key);
                  setExpanded(null);
                }}
              />
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
                expandedId={expandedComposite}
                onToggle={(id) => setExpandedComposite(expandedComposite === id ? null : id)}
                framework={framework}
                frameworkRows={rows}
                accountId={activeAccount?.id}
              />
            )}

          {complianceView === "composite" &&
            !compositeControls.isLoading &&
            primaryComposites.length === 0 &&
            total > 0 && (
              <div className="px-5 py-4 text-sm text-zinc-600">
                No control groups map to this framework yet. Switch to{" "}
                <button
                  type="button"
                  onClick={() => setComplianceViewWithUrl("detailed")}
                  className="font-semibold text-indigo-700 hover:text-indigo-900"
                >
                  Detailed criteria
                </button>{" "}
                for the full control list.
              </div>
            )}

          {complianceView === "detailed" && rows.length === 0 && (
            <div className="px-6 py-16 text-center text-sm text-zinc-400">No controls found for this framework.</div>
          )}

          {complianceView === "detailed" && rows.length > 0 && filteredRows.length === 0 && statusFilter !== "all" && (
            <div className="px-6 py-12 text-center text-sm text-zinc-400">No controls match this filter.</div>
          )}

          {complianceView === "detailed" &&
            groupedRows.length > 0 &&
            selectedGroup &&
            selectedGroup.rows.map((ctrl) => {
              const isExpanded = expanded === ctrl.id;
              const displayStatus = controlDisplayStatus(ctrl, findingCountByCheck);
              const findingsHref = findingsHrefForChecks(ctrl.check_ids, findingCountByCheck);

              return (
                <div key={ctrl.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      const scrollY = window.scrollY;
                      setExpanded(isExpanded ? null : ctrl.id);
                      requestAnimationFrame(() => window.scrollTo(0, scrollY));
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
                        <span className="font-mono text-meta font-semibold text-zinc-500">{ctrl.control_id}</span>{" "}
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
                    <div className="flex shrink-0 items-center gap-3 self-center">
                      <ComplianceRowSummary
                        displayStatus={displayStatus}
                        href={findingsHref}
                        onNavigate={(href) => navigate(href)}
                      />
                      <ComplianceExpandChevron expanded={isExpanded} />
                    </div>
                  </button>

                  <div className={`veritrail-accordion-panel ${isExpanded ? "is-open" : ""}`}>
                    <div className="veritrail-accordion-panel__inner">
                      <div className="veritrail-expand-in space-y-4 border-t border-zinc-100 px-5 pb-5 pt-4">
                        <ControlStatusBlock
                          control={ctrl}
                          periodDays={exportWindow.period}
                          coverage={evidenceCoverage.data}
                          controlId={ctrl.control_id}
                          framework={framework}
                          accountId={activeAccount?.id ?? ""}
                        />

                        {ctrl.kind === "manual" ? (
                          <ManualAttestation
                            status={ctrl.attestation_status ?? "pending"}
                            canEdit={canAttest}
                            saving={attest.isPending}
                            onChange={(status) => attest.mutate({ id: ctrl.id, status })}
                          />
                        ) : ctrl.check_ids.length === 0 ? (
                          <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/60 px-3.5 py-2.5 text-sm leading-relaxed text-zinc-600">
                            No automated Veritrail checks map to this control yet — attest manually (e.g. IAM users only
                            inherit access via groups or roles).
                          </p>
                        ) : (
                          <>
                            <ControlEvaluationBlock checkIds={ctrl.check_ids} />
                            <ControlFindingsBlock
                              control={ctrl}
                              checkIds={ctrl.check_ids}
                              findingCountByCheck={findingCountByCheck}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
        </ComplianceContentShell>
      )}
    </div>
  );
}
