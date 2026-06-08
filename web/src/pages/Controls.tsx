import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, token } from "../api";
import { CHECK_FRAMEWORK_MAP } from "../data/checkFrameworkMap";
import { labelForCheck } from "../data/checkLabels";
import { FRAMEWORKS } from "../data/frameworks";
import ConnectAwsEmptyState from "../components/ConnectAwsEmptyState";
import { EvidencePackExportPanel } from "../components/EvidencePackExportPanel";
import type { EvidenceCoverage } from "../lib/evidenceCoverage";
import {
  controlEvidenceSectionTitle,
  controlEvidenceUsesType2Bar,
  showControlEvidenceSection,
} from "../lib/frameworkEvidenceCoverage";
import { isAccountConnected } from "../lib/accountConnection";
import { AccountSelect } from "../components/AccountSelect";
import NotificationsBell from "../components/NotificationsBell";
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
  status: "pass" | "fail" | "no_data";
  finding_count: number;
  open_finding_ids: string[];
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
  status: "pass" | "fail" | "no_data";
  finding_count: number;
  open_finding_ids: string[];
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

const COMPLIANCE_ROW_GRID =
  "grid w-full grid-cols-1 gap-3 py-4 pl-5 pr-5 text-left transition-colors sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start sm:gap-4";

const COMPLIANCE_CHIP_ACTIVE = "bg-white text-zinc-900 shadow-sm shadow-zinc-950/[0.04] ring-1 ring-zinc-200/80";
const COMPLIANCE_CHIP_IDLE = "text-zinc-500 hover:bg-zinc-50/80 hover:text-zinc-800";

type OpenFindingMeta = { id: string; check_id: string; severity: string; resource_arn: string };

function ComplianceExpandChevron({ expanded, className = "h-3.5 w-3.5" }: { expanded: boolean; className?: string }) {
  return (
    <svg
      className={`${className} shrink-0 text-zinc-400 transition-transform ${expanded ? "rotate-0" : "-rotate-90"}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function ComplianceFindingsBadge({
  count,
  status,
  checkIds,
  findingCountByCheck,
}: {
  count: number;
  status: string;
  checkIds?: string[];
  findingCountByCheck?: Map<string, number>;
}) {
  const navigate = useNavigate();
  const href =
    checkIds && findingCountByCheck ? findingsHrefForChecks(checkIds, findingCountByCheck) : null;
  const baseClass =
    "inline-flex h-8 min-w-[3.25rem] items-center justify-center rounded-lg px-3 text-sm font-semibold tabular-nums";

  if (status === "fail" && count > 0 && href) {
    return (
      <button
        type="button"
        title="View open findings"
        onClick={(e) => {
          e.stopPropagation();
          navigate(href);
        }}
        className={`${baseClass} border border-rose-200/70 bg-rose-50/90 text-rose-700 shadow-sm transition hover:border-rose-300/80 hover:bg-rose-100/80`}
      >
        {count}
      </button>
    );
  }
  if (status === "fail" && count > 0) {
    return (
      <span
        className={`${baseClass} border border-rose-200/70 bg-rose-50/90 text-rose-700 shadow-sm`}
        aria-label={`${count} open findings`}
      >
        {count}
      </span>
    );
  }
  return (
    <span className={`${baseClass} text-xs font-medium text-zinc-300`} aria-hidden>
      —
    </span>
  );
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
        <h2 className="text-[15px] font-semibold text-zinc-900">{title}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">{subtitle}</p>
        {toolbar}
      </div>
      {section && <div className="border-b border-zinc-100 px-5 py-2.5">{section}</div>}
      <div className="divide-y divide-zinc-100">{children}</div>
    </section>
  );
}

function controlRowMetadata(
  ctrl: ControlRow,
  findingMap: Map<string, OpenFindingMeta>,
  lastScanAt: string | null,
): string {
  const parts: string[] = [];
  if (ctrl.check_ids.length > 0) {
    parts.push(`${ctrl.check_ids.length} check${ctrl.check_ids.length === 1 ? "" : "s"} mapped`);
  }
  if (ctrl.status === "fail" && ctrl.open_finding_ids.length > 0) {
    const linked = ctrl.open_finding_ids
      .map((id) => findingMap.get(id))
      .filter((f): f is OpenFindingMeta => !!f);
    const urgent = linked.filter((f) => f.severity === "critical" || f.severity === "high").length;
    if (urgent > 0) parts.push(`${urgent} critical/high`);
    const resources = new Set(linked.map((f) => f.resource_arn)).size;
    if (resources > 0) parts.push(`${resources} resource${resources === 1 ? "" : "s"}`);
  }
  if (lastScanAt) parts.push(`scanned ${lastScanLabel(lastScanAt)}`);
  if (parts.length === 0) {
    return ctrl.check_ids.length === 0 ? "Manual attestation required" : "Awaiting scan data";
  }
  return parts.join(" · ");
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

function controlFamily(framework: string, controlId: string) {
  if (framework === "soc2") {
    if (controlId.startsWith("CC6")) return { key: "cc6", label: "CC6 Logical Access" };
    if (controlId.startsWith("CC7")) return { key: "cc7", label: "CC7 System Operations" };
    if (controlId.startsWith("CC8")) return { key: "cc8", label: "CC8 Change Management" };
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

  return { key: "other", label: "Other Controls" };
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

  return Array.from(groups.values());
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
    return "Not automated in Vigil yet — CIS expects this control; map manually or wait for a future check.";
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

function frameworkTagsForComposite(
  ctrl: CompositeControlRow,
  framework: string,
  frameworkRows: ControlRow[],
): string[] {
  const underlying = underlyingCriteriaForComposite(ctrl, frameworkRows);
  if (underlying.length > 0) {
    return underlying.slice(0, 4).map((r) => frameworkControlLabel(framework, r.control_id));
  }
  if (framework === "soc2") {
    return ctrl.soc2_criteria.map((c) => `SOC 2 ${c}`);
  }
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const checkId of ctrl.check_ids) {
    const fws = CHECK_FRAMEWORK_MAP[checkId] ?? [];
    if (framework === "cis_aws_l1" && fws.includes("cis_aws_l1")) seen.add("CIS AWS");
    if (framework === "iso27001" && fws.includes("iso27001")) seen.add("ISO 27001");
  }
  return Array.from(seen);
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
    <div className="inline-flex flex-wrap items-center gap-0.5 rounded-full border border-zinc-200/90 bg-zinc-100/70 p-1">
        {(
          [
            { id: "all" as const, label: "All", count: total },
            { id: "fail" as const, label: "Failing", count: failed },
            { id: "pass" as const, label: "Passing", count: passed },
            { id: "no_data" as const, label: "No data", count: noData },
          ] as const
        ).map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onChange(f.id)}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all ${
              statusFilter === f.id ? COMPLIANCE_CHIP_ACTIVE : COMPLIANCE_CHIP_IDLE
            }`}
          >
            {f.label}
            <span className={statusFilter === f.id ? "text-zinc-500" : "text-zinc-400"}> · {f.count}</span>
          </button>
        ))}
    </div>
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
      className="inline-flex min-w-0 flex-wrap items-center gap-0.5 rounded-full border border-zinc-200/90 bg-zinc-100/70 p-1"
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
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-all ${
              isSelected ? COMPLIANCE_CHIP_ACTIVE : COMPLIANCE_CHIP_IDLE
            }`}
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
    { id: "composite" as const, label: "Control groups", Icon: ControlGroupsIcon },
    { id: "detailed" as const, label: "Detailed criteria", Icon: DetailedCriteriaIcon },
  ];

  return (
    <div
      className="inline-flex shrink-0 rounded-full border border-zinc-200/90 bg-zinc-100/80 p-1.5"
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
            onClick={() => onChange(opt.id)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
              isActive
                ? "bg-white text-zinc-900 shadow-sm shadow-zinc-950/[0.06] ring-1 ring-zinc-200/60"
                : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            <opt.Icon
              className={`h-5 w-5 shrink-0 ${isActive ? "text-zinc-600" : "text-zinc-400"}`}
            />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function findingsHrefForChecks(checkIds: string[], findingCountByCheck: Map<string, number>) {
  const active = checkIds.filter((id) => (findingCountByCheck.get(id) ?? 0) > 0);
  if (active.length === 0) return null;
  return `/findings?checks=${encodeURIComponent(active.join(","))}`;
}

function CalmStatusLabel({ status }: { status: string }) {
  const badgeClass =
    "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium";
  if (status === "pass") {
    return (
      <span className={`${badgeClass} bg-emerald-50/90 text-emerald-700 ring-1 ring-emerald-200/40`}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
        Passing
      </span>
    );
  }
  if (status === "fail") {
    return (
      <span className={`${badgeClass} bg-amber-50/90 text-amber-800 ring-1 ring-amber-200/50`}>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
        Needs attention
      </span>
    );
  }
  return (
    <span className={`${badgeClass} bg-zinc-100/90 text-zinc-500 ring-1 ring-zinc-200/70`}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" aria-hidden />
      No data
    </span>
  );
}

function TopFailingChecksList({
  checkIds,
  findingCountByCheck,
  max = 5,
}: {
  checkIds: string[];
  findingCountByCheck: Map<string, number>;
  max?: number;
}) {
  const navigate = useNavigate();
  const top = useMemo(
    () =>
      [...checkIds]
        .filter((id) => (findingCountByCheck.get(id) ?? 0) > 0)
        .sort((a, b) => (findingCountByCheck.get(b) ?? 0) - (findingCountByCheck.get(a) ?? 0))
        .slice(0, max),
    [checkIds, findingCountByCheck, max],
  );

  if (top.length === 0) return null;

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
  framework,
  frameworkRows,
  accountId,
  findingCountByCheck,
}: {
  ctrl: CompositeControlRow;
  framework: string;
  frameworkRows: ControlRow[];
  accountId?: string | null;
  findingCountByCheck: Map<string, number>;
}) {
  const navigate = useNavigate();
  const underlying = underlyingCriteriaForComposite(ctrl, frameworkRows);
  const findingsHref = findingsHrefForChecks(ctrl.check_ids, findingCountByCheck);

  return (
    <div className={`space-y-4 border-t border-zinc-100 px-5 pb-5 pt-4 sm:pl-[9.5rem] ${statusExpandedBg[ctrl.status]}`}>
      {underlying.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Underlying criteria</p>
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
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Top failing checks</p>
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
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-zinc-700">{display?.title ?? child.title}</p>
          <p className="text-xs text-zinc-500">{display?.hint ?? child.description}</p>
        </div>
        {child.finding_count > 0 && href ? (
          <span
            role="link"
            tabIndex={0}
            title="View open findings"
            onClick={(e) => {
              e.stopPropagation();
              navigate(href);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                e.preventDefault();
                navigate(href);
              }
            }}
            className="shrink-0 cursor-pointer rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums text-rose-600/90 hover:bg-rose-50/80"
          >
            {child.finding_count}
          </span>
        ) : (
          <span className="shrink-0 text-xs text-zinc-300">—</span>
        )}
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
  const treeRows = useMemo(() => prepareCompositeTreeRows(rows), [rows]);

  if (treeRows.length === 0) return null;

  return (
    <CompliancePanelShell
      title="Control groups"
      subtitle="Higher-level compliance rollups — expand for underlying criteria and top failing checks."
    >
        {treeRows.map(({ row: ctrl, child }) => {
          const isExpanded = expandedId === ctrl.id;
          const frameworkTags = frameworkTagsForComposite(ctrl, framework, frameworkRows);

          return (
            <div key={ctrl.id}>
              <button
                type="button"
                onClick={() => onToggle(ctrl.id)}
                className={`${COMPLIANCE_ROW_GRID} ${
                  isExpanded ? statusExpandedBg[ctrl.status] : "hover:bg-zinc-50/70"
                }`}
              >
                <div className="flex items-start gap-2 pt-0.5 sm:w-[8.5rem]">
                  <ComplianceExpandChevron expanded={isExpanded} className="mt-0.5 h-3.5 w-3.5" />
                  <CalmStatusLabel status={ctrl.status} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold leading-snug text-zinc-900">{ctrl.title}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-zinc-600">{ctrl.description}</p>
                  {frameworkTags.length > 0 && (
                    <p className="mt-2 text-xs font-medium text-zinc-500">{frameworkTags.join(" · ")}</p>
                  )}
                  <p className="mt-1.5 text-[13px] text-zinc-500">
                    {ctrl.check_ids.length} mapped check{ctrl.check_ids.length === 1 ? "" : "s"}
                    {ctrl.status === "fail" && ctrl.finding_count > 0
                      ? ` · ${ctrl.finding_count} open finding${ctrl.finding_count === 1 ? "" : "s"}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center sm:pt-0.5">
                  <ComplianceFindingsBadge
                    count={ctrl.finding_count}
                    status={ctrl.status}
                    checkIds={ctrl.check_ids}
                    findingCountByCheck={findingCountByCheck}
                  />
                </div>
              </button>
              {child && compositeAppliesToFramework(child, frameworkRows) && (
                <QuietNestedCompositeRow
                  child={child}
                  expandedId={expandedId}
                  onToggle={onToggle}
                  framework={framework}
                  frameworkRows={frameworkRows}
                  accountId={accountId}
                  findingCountByCheck={findingCountByCheck}
                />
              )}
              {isExpanded && (
                <CompositeExpandedDetails
                  ctrl={ctrl}
                  framework={framework}
                  frameworkRows={frameworkRows}
                  accountId={accountId}
                  findingCountByCheck={findingCountByCheck}
                />
              )}
            </div>
          );
        })}
    </CompliancePanelShell>
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

const CHECK_GROUP_ORDER = ["IAM", "GitHub", "GitLab", "S3", "KMS", "CloudTrail", "EC2", "RDS", "Lambda", "DynamoDB", "ECR", "EKS", "ECS", "ACM", "ELB", "Secrets", "SSM", "SNS", "SQS", "GuardDuty", "AWS", "VPC"];

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
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Findings</p>
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
}: {
  coverageDays: number;
  coverageTotal: number;
  coveragePct: number;
  barFillClass: string;
}) {
  return (
    <div
      className="h-2.5 overflow-hidden rounded bg-zinc-200/60 ring-1 ring-inset ring-zinc-300/25"
      role="progressbar"
      aria-valuenow={coveragePct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${coverageDays} of ${coverageTotal} audit days with evidence (${coveragePct}%)`}
    >
      <div
        className={`h-full bg-gradient-to-r ${barFillClass} transition-all`}
        style={{ width: `${Math.max(coveragePct, 2)}%` }}
      />
    </div>
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

  const statusLabel =
    control.status === "pass" ? "Passing" : control.status === "fail" ? "Failing" : "Not evaluated";

  const statusTone =
    control.status === "pass"
      ? "border-emerald-200/80 bg-emerald-50/30"
      : control.status === "fail"
        ? "border-rose-200/80 bg-rose-50/25"
        : "border-zinc-200/80 bg-zinc-50/50";

  const statusValueClass =
    control.status === "pass" ? "text-emerald-700" : control.status === "fail" ? "text-rose-700" : "text-zinc-600";

  const h = history.data;

  const scans = coverage?.successful_scans_in_period;
  const coverageDays = coverage?.days_with_data ?? 0;
  const coverageTotal = coverage?.days_requested ?? periodDays;
  const coveragePct = coverage ? Math.min(100, Math.round(coverage.coverage_ratio * 100)) : 0;

  let statusSubline: string | null = null;
  if (h?.current_status === "fail") {
    if (h.failing_since) statusSubline = `Since ${formatEvidenceDate(h.failing_since)}`;
    else if (h.days_failing != null) {
      statusSubline = `Failing for ${h.days_failing} day${h.days_failing === 1 ? "" : "s"}`;
    }
  } else if (h?.current_status === "pass") {
    statusSubline = "Currently passing";
  }

  const statusMark =
    control.status === "pass" ? "✓" : control.status === "fail" ? "✕" : "○";

  const supportMetrics: { value: string; label: string }[] = [];
  if (control.status === "fail") {
    supportMetrics.push({ value: String(control.finding_count), label: "Findings" });
  } else if (control.status === "pass") {
    supportMetrics.push({ value: "0", label: "Findings" });
  } else if (control.check_ids.length === 0) {
    supportMetrics.push({ value: "—", label: "Manual" });
  } else {
    supportMetrics.push({ value: "—", label: "Pending" });
  }
  if (scans != null) supportMetrics.push({ value: String(scans), label: "Scans" });

  const barFillClass =
    coveragePct >= 80 ? "from-emerald-500/90 to-emerald-600/80" : coveragePct >= 40 ? "from-amber-400/90 to-amber-500/80" : "from-rose-400/90 to-rose-500/80";

  return (
    <div className={`w-full rounded-xl border p-4 ${statusTone}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Control status</p>

      <div className="mt-3 flex items-start gap-2.5">
        <span
          className={`w-5 shrink-0 text-center text-xl leading-none ${statusValueClass}`}
          aria-hidden
        >
          {statusMark}
        </span>

        <div className="min-w-0 flex-1 space-y-4">
          <div className="space-y-1">
            <p className={`text-2xl font-bold leading-tight tracking-tight ${statusValueClass}`}>
              {statusLabel}
            </p>
            {statusSubline && <p className="text-sm text-zinc-500">{statusSubline}</p>}
            {supportMetrics.length > 0 && (
              <p className="text-sm leading-relaxed">
                {supportMetrics.map((m, i) => (
                  <span key={m.label}>
                    {i > 0 && <span className="px-2 text-zinc-300">•</span>}
                    <span className="font-semibold tabular-nums text-zinc-900">{m.value}</span>{" "}
                    <span className="text-zinc-600">{m.label}</span>
                  </span>
                ))}
              </p>
            )}
          </div>

          {showControlEvidenceSection(framework) && (
          <div className="max-w-xl space-y-1.5 overflow-visible border-t border-zinc-200/60 pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              {controlEvidenceSectionTitle(framework)}
            </p>

            {coverage ? (
              controlEvidenceUsesType2Bar(framework) ? (
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="text-base leading-snug text-zinc-800">
                      <span className="font-semibold tabular-nums text-zinc-900">{coverageDays}</span>
                      <span className="tabular-nums text-zinc-600"> / </span>
                      <span className="font-semibold tabular-nums text-zinc-900">{coverageTotal}</span>
                      {" audit days collected"}
                    </p>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-700">{coveragePct}%</span>
                  </div>
                  <CoverageProgressBar
                    coverageDays={coverageDays}
                    coverageTotal={coverageTotal}
                    coveragePct={coveragePct}
                    barFillClass={barFillClass}
                  />
                </div>
              ) : (
                <p className="text-base leading-snug text-zinc-800">
                  <span className="font-semibold tabular-nums text-zinc-900">{coverageDays}</span>
                  {coverageDays === 1 ? " day" : " days"} collected in the selected export period
                </p>
              )
            ) : (
              <p className="text-base font-semibold text-zinc-800">{periodDays}-day export window</p>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ControlEvaluationBlock({ checkIds }: { checkIds: string[] }) {
  if (checkIds.length === 0) return null;

  const grouped = groupCheckIds(checkIds);

  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        Mapped checks ({checkIds.length})
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {grouped.map(([group, ids]) => (
          <div key={group}>
            <p className="text-xs font-bold text-zinc-800">
              {group} <span className="font-normal text-zinc-500">({ids.length})</span>
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm leading-snug text-zinc-800">
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
  checkEvidenceClasses,
  findingCountByCheck,
}: {
  control: ControlFindingsSummary;
  checkIds: string[];
  checkEvidenceClasses?: Record<string, string>;
  findingCountByCheck: Map<string, number>;
}) {
  const navigate = useNavigate();

  if (control.status === "pass" && control.finding_count === 0) {
    return (
      <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/30 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800/80">Findings</p>
        <p className="mt-1 text-sm font-medium text-emerald-900">No open findings</p>
      </div>
    );
  }

  const openTotal = control.finding_count;

  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Findings</p>
        {openTotal > 0 && (
          <button
            type="button"
            onClick={() =>
              navigate(
                `/findings?checks=${encodeURIComponent(checkIds.filter((id) => (findingCountByCheck.get(id) ?? 0) > 0).join(","))}`,
              )
            }
            className="text-xs font-semibold text-indigo-700 hover:text-indigo-900"
          >
            {openTotal} open finding{openTotal === 1 ? "" : "s"} →
          </button>
        )}
      </div>
      {openTotal > 0 ? (
        <div className="mt-2.5">
          <MappedChecksList
            checkIds={checkIds}
            checkEvidenceClasses={checkEvidenceClasses}
            findingCountByCheck={findingCountByCheck}
            findingsOnly
            hideHeader
          />
        </div>
      ) : (
        <p className="mt-2 text-sm text-zinc-600">No open findings in mapped checks.</p>
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

function frameworkChipPctClass(frameworkId: string, passRate: number | null, isActive: boolean): string {
  if (passRate == null) return "text-zinc-400";
  if (isActive) return passRateColor(passRate);
  if (frameworkId === "iso27001") return "text-sky-600";
  if (frameworkId === "cis_aws_l1") return "text-amber-600";
  return "text-zinc-500";
}

function frameworkChipShellClass(
  isActive: boolean,
  stats: FrameworkStats | undefined,
): string {
  if (!isActive) {
    return "border-zinc-200/90 bg-white text-zinc-900 hover:border-zinc-300 hover:bg-zinc-50/80";
  }
  const needsAttention = (stats?.openFindings ?? 0) > 0 || (stats?.passRate ?? 100) < 80;
  if (needsAttention) {
    return "border-amber-200/80 bg-amber-50/40 text-zinc-900 shadow-sm shadow-zinc-950/[0.03]";
  }
  return "border-zinc-300/80 bg-white text-zinc-900 shadow-sm shadow-zinc-950/[0.03]";
}

function FrameworkScoreCard({
  fw,
  stats,
  isActive,
  onSelect,
}: {
  fw: { id: string; label: string };
  stats: FrameworkStats | undefined;
  isActive: boolean;
  onSelect: () => void;
}) {
  const pct = stats?.passRate;
  const total = stats?.total ?? 0;
  const passed = stats?.passed ?? 0;
  const hasData = pct != null && total > 0;
  const pctNum = pct ?? 0;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onSelect}
      className={`flex flex-col rounded-2xl border px-4 py-3.5 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${
        isActive
          ? "border-indigo-300/80 bg-indigo-50/40 shadow-sm shadow-indigo-950/[0.04] ring-1 ring-indigo-300/40"
          : "border-zinc-200/90 bg-white hover:border-zinc-300 hover:bg-zinc-50/60"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-zinc-700">{fw.label}</span>
        {isActive && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600">Viewing</span>
        )}
      </span>
      <span
        className={`mt-1 text-[26px] font-bold leading-none tabular-nums tracking-tight ${
          hasData ? passRateColor(pctNum) : "text-zinc-300"
        }`}
      >
        {hasData ? `${pctNum}%` : "—"}
      </span>
      <span className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100" aria-hidden>
        <span
          className={`block h-full rounded-full transition-all ${hasData ? passRateBarColor(pctNum) : "bg-zinc-200"}`}
          style={{ width: `${hasData ? pctNum : 0}%` }}
        />
      </span>
      <span className="mt-2 text-xs font-medium tabular-nums text-zinc-500">
        {hasData ? `${passed} of ${total} controls passing` : "No scan data yet"}
      </span>
    </button>
  );
}

/** Framework score cards — each card is also the framework selector tab. */
function FrameworkNav({
  selectedId,
  statsById,
  currentStats,
  topBlockerDetailed,
  topBlockerComposite,
  complianceView,
  onComplianceViewChange,
  onSelect,
  onOpenTopBlocker,
}: {
  selectedId: string;
  statsById: Record<string, FrameworkStats | undefined>;
  currentStats?: FrameworkStats;
  topBlockerDetailed: ControlRow | null;
  topBlockerComposite: CompositeControlRow | null;
  complianceView: ComplianceView;
  onComplianceViewChange: (view: ComplianceView) => void;
  onSelect: (id: string) => void;
  onOpenTopBlocker: () => void;
}) {
  return (
    <div
      className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3"
      role="tablist"
      aria-label="Compliance framework"
    >
      {FRAMEWORKS.map((fw) => {
        const isActive = selectedId === fw.id;
        const tabStats = isActive ? currentStats : statsById[fw.id];
        return (
          <FrameworkScoreCard
            key={fw.id}
            fw={fw}
            stats={tabStats}
            isActive={isActive}
            onSelect={() => onSelect(fw.id)}
          />
        );
      })}
    </div>
  );
}

export default function Controls() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlFramework = searchParams.get("framework");
  const urlControl = searchParams.get("control");
  const urlComposite = searchParams.get("composite");
  const urlAccountId = searchParams.get("account_id");
  const urlView = searchParams.get("view");
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
  const exportRef = useRef<HTMLDivElement>(null);

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
    if (!urlControl || !controls.data?.length || deepLinkDone.current) return;
    const match = controls.data.find((r) => r.control_id === urlControl);
    if (match) {
      deepLinkDone.current = true;
      setSelectedFamilyKey(controlFamily(framework, match.control_id).key);
      setExpanded(match.id);
      setComplianceView("detailed");
    }
  }, [controls.data, urlControl, framework]);

  useEffect(() => {
    setComplianceView("composite");
    setExpandedComposite(null);
    setStatusFilter("all");
  }, [framework]);

  useEffect(() => {
    if (!urlComposite || !compositeControls.data?.length) return;
    const match = compositeControls.data.find((r) => r.id === urlComposite);
    if (match) {
      setComplianceView("composite");
      setExpandedComposite(match.id);
    }
  }, [compositeControls.data, urlComposite]);

  const openFindingsMeta = useQuery({
    queryKey: ["findings", "open", activeAccount?.id, "controls-meta"],
    queryFn: () =>
      api<{ items: OpenFindingMeta[] }>(`/v1/findings?status=open&limit=500`),
    enabled: !!activeAccount && hasScanned,
    select: (data) => {
      const byId = new Map<string, OpenFindingMeta>();
      const countByCheck = new Map<string, number>();
      for (const f of data.items) {
        byId.set(f.id, f);
        countByCheck.set(f.check_id, (countByCheck.get(f.check_id) ?? 0) + 1);
      }
      return { byId, countByCheck };
    },
  });

  const findingMap = openFindingsMeta.data?.byId ?? new Map<string, OpenFindingMeta>();
  const findingCountByCheck = openFindingsMeta.data?.countByCheck ?? new Map<string, number>();

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
    if (!exportOpen) return;
    function handleClick(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
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

  const rows = controls.data ?? [];
  const passed = rows.filter((r) => r.status === "pass").length;
  const failed = rows.filter((r) => r.status === "fail").length;
  const noData = rows.filter((r) => r.status === "no_data").length;
  const total = rows.length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : null;
  const openFindingsTotal = rows.reduce((sum, r) => sum + r.finding_count, 0);
  const currentFrameworkStats: FrameworkStats = { passRate, failed, passed, total, openFindings: openFindingsTotal };

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

  const topBlockerDetailed = useMemo(() => {
    const failing = rows.filter((row) => row.status === "fail");
    if (failing.length === 0) return null;
    return failing.reduce((worst, row) => (row.finding_count > worst.finding_count ? row : worst));
  }, [rows]);

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

  const topBlockerComposite = useMemo(() => {
    const failing = primaryComposites.filter((c) => c.status === "fail" && c.finding_count > 0);
    if (failing.length === 0) return null;
    return failing.reduce((worst, row) => (row.finding_count > worst.finding_count ? row : worst));
  }, [primaryComposites]);

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
      a.download = `vigil-evidence-${opts?.framework ?? framework}-${(asOfVal ?? new Date().toISOString().slice(0, 10))}.zip`;
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
    <div ref={exportRef} className={`relative shrink-0 ${exportOpen ? "z-[101]" : ""}`}>
      <button
        type="button"
        onClick={() => setExportOpen((open) => !open)}
        aria-expanded={exportOpen}
        aria-haspopup="dialog"
        className="findings-v2-toolbar-btn findings-v2-toolbar-btn--scan findings-v2-toolbar-btn--lg"
      >
        <svg className="shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Generate Audit Package
      </button>
      {exportOpen && (
        <>
          <button
            type="button"
            aria-label="Close evidence pack menu"
            className="fixed inset-0 z-[100] cursor-default bg-zinc-950/15"
            onClick={() => setExportOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Generate Audit Package"
            className="absolute right-0 top-full z-[102] mt-2 rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-lg shadow-zinc-950/10"
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
              openFindings={rows.reduce((sum, r) => sum + r.finding_count, 0)}
              passingCount={passed}
              lastScanLabel={
                activeAccount?.last_scan_at ? lastScanLabel(activeAccount.last_scan_at) : null
              }
              downloading={downloading}
              onDownload={() => void downloadPack()}
            />
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="min-h-full bg-zinc-100/35">
    <div className="w-full px-8 py-8">
      <div className={`mb-4 ${exportOpen ? "relative z-[100]" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Compliance</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {connectedAccounts.length > 0 && activeAccount && (
                <AccountSelect accounts={connectedAccounts} value={activeAccount.id} onChange={handleAccountChange} />
              )}
            </div>
          </div>
          <NotificationsBell />
        </div>
      </div>

      {!hasScanned && connectedAccount && !controls.isLoading && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/60 px-5 py-4 text-sm text-amber-900">
          <span className="font-semibold">Awaiting first scan.</span> Control pass/fail status appears after your account finishes scanning.
        </div>
      )}

      {controls.isLoading && <LoadingSkeleton />}

      {!controls.isLoading && connectedAccount && (
        <FrameworkNav
          selectedId={framework}
          statsById={frameworkStatsById}
          currentStats={currentFrameworkStats}
          topBlockerDetailed={topBlockerDetailed}
          topBlockerComposite={topBlockerComposite}
          complianceView={complianceView}
          onComplianceViewChange={setComplianceViewWithUrl}
          onSelect={(id) => {
            setFramework(id);
            setSelectedFamilyKey(null);
            setExpanded(null);
          }}
          onOpenTopBlocker={() => {
            if (complianceView === "composite") {
              if (!topBlockerComposite) return;
              setExpandedComposite(topBlockerComposite.id);
              return;
            }
            if (!topBlockerDetailed) return;
            setComplianceViewWithUrl("detailed");
            setStatusFilter("fail");
            openControl(topBlockerDetailed);
          }}
        />
      )}

      {!controls.isLoading && connectedAccount && (
        <div
          className={`mb-3 flex flex-wrap items-center justify-between gap-2 ${exportOpen ? "relative z-[100]" : ""}`}
        >
          <ComplianceViewSwitcher view={complianceView} onChange={setComplianceViewWithUrl} />
          <div className="flex flex-wrap items-center gap-2">
            {complianceView === "composite" && !compositeControls.isLoading && primaryComposites.length > 0 ? (
              <ComplianceStatusFilterBar
                total={compositeTotal}
                passed={compositePassed}
                failed={compositeFailed}
                noData={compositeNoData}
                statusFilter={statusFilter}
                onChange={handleStatusFilterChange}
              />
            ) : complianceView === "detailed" && !controls.isLoading && total > 0 ? (
              <ComplianceStatusFilterBar
                total={total}
                passed={passed}
                failed={failed}
                noData={noData}
                statusFilter={statusFilter}
                onChange={handleStatusFilterChange}
              />
            ) : null}
            {showAuditExportAboveCard && <div className="shrink-0">{auditPackageExport}</div>}
          </div>
        </div>
      )}

      {complianceView === "composite" &&
        !compositeControls.isLoading &&
        primaryComposites.length > 0 &&
        filteredCompositePanelRows.length === 0 &&
        statusFilter !== "all" && (
          <div className="mb-4 rounded-2xl border border-zinc-200 bg-white px-6 py-12 text-center text-sm text-zinc-400 shadow-sm">
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
        !controls.isLoading &&
        total > 0 && (
          <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
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

      {complianceView === "detailed" && (
      <section className="min-w-0">
          {!controls.isLoading && rows.length === 0 && (
            <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-16 text-center text-sm text-zinc-400 shadow-sm">
              No controls found for this framework.
            </div>
          )}
          {!controls.isLoading && rows.length > 0 && filteredRows.length === 0 && statusFilter !== "all" && (
            <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-12 text-center text-sm text-zinc-400 shadow-sm">
              No controls match this filter.
            </div>
          )}

          {!controls.isLoading && groupedRows.length > 0 && selectedGroup && (
              <CompliancePanelShell
                title="Detailed criteria"
                subtitle="Raw framework controls — expand for evidence, mapped checks, and auditor response."
                section={
                  <ComplianceFamilyNav
                    groups={groupedRows}
                    selectedKey={selectedGroup.key}
                    onSelect={(key) => {
                      setSelectedFamilyKey(key);
                      setExpanded(null);
                    }}
                  />
                }
              >
                  {selectedGroup.rows.map((ctrl) => {
                    const isExpanded = expanded === ctrl.id;
                    const meta = controlRowMetadata(ctrl, findingMap, connectedAccount?.last_scan_at ?? null);
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
                          className={`${COMPLIANCE_ROW_GRID} ${
                            isExpanded ? statusExpandedBg[ctrl.status] : "hover:bg-zinc-50/70"
                          }`}
                        >
                          <div className="flex items-start gap-2 pt-0.5 sm:w-[8.5rem]">
                            <ComplianceExpandChevron expanded={isExpanded} className="mt-0.5 h-3.5 w-3.5" />
                            <CalmStatusLabel status={ctrl.status} />
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="text-[15px] font-semibold leading-snug text-zinc-900">
                              <span className="font-mono text-[13px] font-semibold text-zinc-500">{ctrl.control_id}</span>
                              {" "}
                              {shortControlTitle(ctrl.title)}
                            </p>
                            <p className="mt-1 text-[13px] leading-relaxed text-zinc-600">{meta}</p>
                          </div>

                          <div className="flex shrink-0 items-center sm:pt-0.5">
                            <ComplianceFindingsBadge
                              count={ctrl.finding_count}
                              status={ctrl.status}
                              checkIds={ctrl.check_ids}
                              findingCountByCheck={findingCountByCheck}
                            />
                          </div>
                        </button>

                        {isExpanded && (
                          <div
                            className={`space-y-3 border-t border-zinc-100 px-5 pb-5 pt-4 sm:pl-[9.5rem] ${statusExpandedBg[ctrl.status]}`}
                          >
                            <ControlStatusBlock
                              control={ctrl}
                              periodDays={exportWindow.period}
                              coverage={evidenceCoverage.data}
                              controlId={ctrl.control_id}
                              framework={framework}
                              accountId={activeAccount?.id ?? ""}
                            />

                            {ctrl.check_ids.length === 0 ? (
                              <p className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 px-3.5 py-2.5 text-xs leading-relaxed text-zinc-600">
                                No automated Vigil checks map to this control yet — attest manually (e.g. IAM users
                                only inherit access via groups or roles).
                              </p>
                            ) : (
                              <>
                                <ControlEvaluationBlock checkIds={ctrl.check_ids} />
                                <ControlFindingsBlock
                                  control={ctrl}
                                  checkIds={ctrl.check_ids}
                                  checkEvidenceClasses={ctrl.check_evidence_classes}
                                  findingCountByCheck={findingCountByCheck}
                                />
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </CompliancePanelShell>
            )}
        </section>
      )}
    </div>
    </div>
  );
}
