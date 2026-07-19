import { useMemo, useState, type ReactNode } from "react";
import {
  bucketServicesByUsage,
  formatServiceLastUsed,
  serviceActivityDecision,
  serviceUsageActivityLabel,
  type BlastRadiusService,
  type ServiceActivityDecision,
} from "../lib/blastRadiusDisplay";
import { serviceCategory } from "../lib/awsServiceCatalog";
import { formatIamServiceDisplayName } from "../lib/findingDisplay";
import AwsServiceIcon from "./AwsServiceIcon";
import { ServiceAccessExplorer, type ExplorerBucket } from "./ServiceAccessExplorer";
import { ImpactUsageStats } from "./ImpactAnalysisPanel";
import "../styles/impact-analysis.css";

const TABLE_PREVIEW = 6;

type ActivityFilter = "all" | ServiceActivityDecision;

const ACTIVITY_GROUPS: { id: ServiceActivityDecision; label: string }[] = [
  { id: "keep", label: "Keep" },
  { id: "verify", label: "Verify" },
  { id: "remove", label: "Remove" },
];

function decisionToExplorerBucket(decision: ServiceActivityDecision): ExplorerBucket {
  if (decision === "keep") return "recent";
  if (decision === "verify") return "historical";
  return "safe";
}

function UsageSignal({ tone }: { tone: "active" | "inactive" | "none" }) {
  const bars = tone === "active" ? [1, 1, 1] : tone === "inactive" ? [1, 1, 0] : [1, 0, 0];
  return (
    <span className={`service-activity-signal service-activity-signal--${tone}`} aria-hidden>
      {bars.map((on, i) => (
        <span key={i} className={on ? "is-on" : "is-off"} />
      ))}
    </span>
  );
}

function iamServiceIconLabel(serviceName: string): string {
  return (serviceName.split(":")[0] ?? serviceName).trim();
}

function ServiceActivityRow({ service }: { service: BlastRadiusService }) {
  const decision = serviceActivityDecision(service);
  const usage = serviceUsageActivityLabel(decision);
  const displayName = formatIamServiceDisplayName(service.name);
  const category = serviceCategory(service.name).label;
  const lastUsed =
    decision === "remove" ? usage.sub : `Last used ${formatServiceLastUsed(service.days_ago).toLowerCase()}`;

  return (
    <tr className="service-activity-row">
      <td>
        <div className="service-activity-service">
          <AwsServiceIcon
            service={iamServiceIconLabel(service.name)}
            size={28}
            className="service-activity-icon h-7 w-7 shrink-0 rounded-md bg-white object-contain p-0.5 ring-1 ring-zinc-200/80"
          />
          <div className="min-w-0">
            <span className="service-activity-name">{displayName}</span>
            {service.service_only_signal && (
              <span className="service-activity-badge" title="IAM reported service use without per-action detail">
                Service only
              </span>
            )}
          </div>
        </div>
      </td>
      <td>
        <div className="service-activity-usage">
          <UsageSignal tone={usage.tone} />
          <div className="service-activity-usage-copy">
            <span className="service-activity-usage-title">{usage.title}</span>
            <span className="service-activity-usage-sub">{lastUsed}</span>
          </div>
        </div>
      </td>
      <td>
        <span className="service-activity-category">{category}</span>
      </td>
    </tr>
  );
}

function ServiceActivityTable({
  services,
  onViewAll,
}: {
  services: BlastRadiusService[];
  onViewAll: (bucket: ExplorerBucket) => void;
}) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const tally = { keep: 0, verify: 0, remove: 0 };
    for (const s of services) {
      tally[serviceActivityDecision(s)] += 1;
    }
    return { ...tally, all: services.length };
  }, [services]);

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) => {
      const display = formatIamServiceDisplayName(s.name).toLowerCase();
      return s.name.toLowerCase().includes(q) || display.includes(q);
    });
  }, [services, query]);

  const previewRows = useMemo(() => {
    type Row = { kind: "group"; decision: ServiceActivityDecision; count: number } | { kind: "service"; service: BlastRadiusService };

    if (filter !== "all") {
      const items = searched.filter((s) => serviceActivityDecision(s) === filter);
      return { rows: items.slice(0, TABLE_PREVIEW).map((service) => ({ kind: "service" as const, service })), total: items.length, shown: Math.min(TABLE_PREVIEW, items.length) };
    }

    const rows: Row[] = [];
    let remaining = TABLE_PREVIEW;
    let shown = 0;

    for (const group of ACTIVITY_GROUPS) {
      const items = searched.filter((s) => serviceActivityDecision(s) === group.id);
      if (items.length === 0) continue;
      rows.push({ kind: "group", decision: group.id, count: items.length });
      for (const service of items) {
        if (remaining === 0) break;
        rows.push({ kind: "service", service });
        remaining -= 1;
        shown += 1;
      }
      if (remaining === 0) break;
    }

    return { rows, total: searched.length, shown };
  }, [searched, filter]);

  const tabs: { id: ActivityFilter; label: string; count: number; tone: string }[] = [
    { id: "all", label: "All", count: counts.all, tone: "all" },
    { id: "keep", label: "Keep", count: counts.keep, tone: "keep" },
    { id: "verify", label: "Verify", count: counts.verify, tone: "verify" },
    { id: "remove", label: "Remove", count: counts.remove, tone: "remove" },
  ];

  return (
    <div className="service-activity">
      <div className="service-activity-header">
        <h3 className="service-activity-title">Service activity</h3>
        <div className="service-activity-toolbar">
          <button
            type="button"
            className="service-activity-filter-btn"
            aria-label="Open full service explorer"
            onClick={() => onViewAll("all")}
          >
            <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z"
              />
            </svg>
          </button>
          <label className="service-activity-search">
            <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search services"
              aria-label="Search services"
            />
          </label>
        </div>
      </div>

      <div className="service-activity-tabs" role="tablist" aria-label="Filter services">
        {tabs.map((tab) => {
          const active = filter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`service-activity-tab service-activity-tab--${tab.tone}${active ? " is-active" : ""}`}
              onClick={() => setFilter(tab.id)}
            >
              <span className="service-activity-tab-label">{tab.label}</span>
              <span className={`service-activity-tab-count service-activity-tab-count--${tab.tone}`}>{tab.count}</span>
            </button>
          );
        })}
      </div>

      <div className="service-activity-table-wrap">
        <table className="service-activity-table">
          <colgroup>
            <col className="service-activity-col-service" />
            <col className="service-activity-col-usage" />
            <col className="service-activity-col-category" />
          </colgroup>
          <thead>
            <tr>
              <th className="service-activity-th-service">Service</th>
              <th className="service-activity-th-usage">
                <div className="service-activity-usage">
                  <span className="service-activity-signal service-activity-signal--header" aria-hidden="true">
                    <span className="is-off" />
                    <span className="is-off" />
                    <span className="is-off" />
                  </span>
                  <div className="service-activity-usage-copy">
                    <span className="service-activity-usage-heading">Usage</span>
                  </div>
                </div>
              </th>
              <th className="service-activity-th-category">Category</th>
            </tr>
          </thead>
          <tbody>
            {previewRows.rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="service-activity-empty">
                  {query.trim() ? "No services match your search." : "No service usage data yet."}
                </td>
              </tr>
            ) : (
              previewRows.rows.map((row, i) => {
                if (row.kind === "group") {
                  const group = ACTIVITY_GROUPS.find((g) => g.id === row.decision)!;
                  return (
                    <tr key={`group-${row.decision}`} className="service-activity-group-row">
                      <td colSpan={3}>
                        <span className={`service-activity-group-dot service-activity-group-dot--${row.decision}`} />
                        {group.label} ({row.count})
                      </td>
                    </tr>
                  );
                }
                return <ServiceActivityRow key={`${row.service.name}-${i}`} service={row.service} />;
              })
            )}
          </tbody>
        </table>
      </div>

      {previewRows.total > 0 && (
        <div className="service-activity-footer">
          <span className="service-activity-showing">
            Showing 1–{previewRows.shown} of {previewRows.total}
          </span>
          <button type="button" className="service-activity-view-all" onClick={() => onViewAll(filter === "all" ? "all" : decisionToExplorerBucket(filter))}>
            View all services
          </button>
        </div>
      )}
    </div>
  );
}

type AttachedPolicy = {
  policy_arn: string;
  policy_name: string;
  policy_type: "aws_managed" | "customer_managed";
  granted_services: string[];
  unused_services: string[];
  active_services: string[];
  has_wildcard_action: boolean;
  action: "detach_and_replace" | "edit";
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

export function BlastRadiusCollapsible({
  title,
  subtitle,
  defaultOpen = true,
  badge,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  badge?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-zinc-200/90 bg-zinc-50/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-zinc-50/80 transition-colors"
      >
        <Chevron open={open} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-zinc-800">{title}</span>
            {badge}
          </div>
          {subtitle && <p className="mt-0.5 text-[11px] text-zinc-500">{subtitle}</p>}
        </div>
      </button>
      {open && <div className="border-t border-zinc-100 px-3 pb-3 pt-2">{children}</div>}
    </div>
  );
}

function isServiceUsageOnlyNote(text: string) {
  const normalized = text.trim().replace(/\s+/g, " ");
  return /^Service ['"`]?[^'"`]+['"`]?(?: was)?(?: last)? used \d+ days? ago\s*(?:—|–|-)\s*verify before removing\.?$/i.test(normalized);
}

/** Advisory notes — visually distinct from usage decision accordions below */
export function BlastRadiusConsiderations({
  items,
  tone = "warning",
}: {
  items: string[];
  tone?: "warning" | "info";
}) {
  const visibleItems = items.filter((item) => !isServiceUsageOnlyNote(item));
  const [open, setOpen] = useState(visibleItems.length <= 3);
  if (visibleItems.length === 0) return null;

  const shell =
    tone === "warning"
      ? "border-amber-300/70 bg-gradient-to-br from-amber-50/90 via-amber-50/40 to-white"
      : "border-zinc-300/60 bg-gradient-to-br from-zinc-50 to-white";
  const titleClass = tone === "warning" ? "text-amber-950" : "text-zinc-800";
  const subClass = tone === "warning" ? "text-amber-900/75" : "text-zinc-500";
  const badgeClass =
    tone === "warning" ? "bg-amber-200/70 text-amber-950" : "bg-zinc-200/80 text-zinc-700";
  const listBorder = tone === "warning" ? "border-amber-200/50" : "border-zinc-200/80";

  return (
    <div className={`rounded-lg border border-dashed ${shell} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 pr-5 text-left transition-colors hover:bg-white/40"
      >
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
            tone === "warning" ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-500"
          }`}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
            />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[13px] font-semibold ${titleClass}`}>Before you change this</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${badgeClass}`}>
              {visibleItems.length} note{visibleItems.length !== 1 ? "s" : ""}
            </span>
          </div>
          <p className={`mt-0.5 text-[11px] leading-snug ${subClass}`}>
            Policy and scope warnings — not the same as service usage groups below
          </p>
        </div>
        <Chevron open={open} />
      </button>
      {open && (
        <ul className={`space-y-2 border-t px-4 pb-3.5 pt-2.5 pr-5 ${listBorder}`}>
          {visibleItems.map((text, i) => (
            <li key={i} className={`flex gap-2.5 text-[12px] leading-relaxed ${tone === "warning" ? "text-amber-950/90" : "text-zinc-600"}`}>
              <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${tone === "warning" ? "bg-amber-400" : "bg-zinc-400"}`} />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RoleServiceUsageAnalysis({
  services,
  showStats = true,
}: {
  services: BlastRadiusService[];
  activeCount?: number;
  unusedCount?: number;
  showStats?: boolean;
}) {
  const { recentlyActive, historicallyUsed, likelySafe } = bucketServicesByUsage(services);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [explorerBucket, setExplorerBucket] = useState<ExplorerBucket>("all");

  const openExplorer = (bucket: ExplorerBucket) => {
    setExplorerBucket(bucket);
    setExplorerOpen(true);
  };

  return (
    <>
      <div className="space-y-2.5">
        {showStats ? (
          <ImpactUsageStats
            granted={services.length}
            recent={recentlyActive.length}
            historical={historicallyUsed.length}
            safe={likelySafe.length}
          />
        ) : null}

        <ServiceActivityTable services={services} onViewAll={openExplorer} />
      </div>

      <ServiceAccessExplorer
        open={explorerOpen}
        onClose={() => setExplorerOpen(false)}
        services={services}
        initialBucket={explorerBucket}
        title="Service activity"
      />
    </>
  );
}

function CompactServiceList({ names, tone }: { names: string[]; tone: "remove" | "keep" | "neutral" }) {
  const [expanded, setExpanded] = useState(false);
  const limit = 8;
  const visible = expanded ? names : names.slice(0, limit);
  const hidden = names.length - visible.length;

  if (names.length === 0) {
    return <span className="text-[11px] text-zinc-400">—</span>;
  }

  const chipClass =
    tone === "keep"
      ? "bg-zinc-100 text-zinc-600"
      : tone === "remove"
        ? "bg-zinc-100/80 text-zinc-500"
        : "bg-white text-zinc-600 ring-1 ring-zinc-200/60";

  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {visible.map((n) => (
          <span key={n} className={`rounded px-1.5 py-0.5 text-[10px] ${chipClass}`}>
            {formatIamServiceDisplayName(n)}
          </span>
        ))}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-800"
        >
          +{hidden} more
        </button>
      )}
      {expanded && names.length > limit && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-1 text-[10px] font-medium text-zinc-500 hover:text-zinc-700"
        >
          Show less
        </button>
      )}
    </div>
  );
}

export function RolePoliciesAnalysis({
  policies,
  renderConsoleLink,
  showRemovable = true,
  inUseLabel = "Keep — recently used",
}: {
  policies: AttachedPolicy[];
  renderConsoleLink: (pol: AttachedPolicy) => ReactNode;
  showRemovable?: boolean;
  inUseLabel?: string;
}) {
  const [expandedPolicies, setExpandedPolicies] = useState<Record<string, boolean>>({});

  const togglePolicy = (arn: string) => {
    setExpandedPolicies((prev) => ({ ...prev, [arn]: !prev[arn] }));
  };

  return (
    <BlastRadiusCollapsible
      title="Policy breakdown"
      subtitle={`${policies.length} attached polic${policies.length === 1 ? "y" : "ies"}`}
      defaultOpen={policies.length <= 2}
    >
      <div className="space-y-1.5">
        {policies.map((pol) => {
          const open = expandedPolicies[pol.policy_arn] ?? policies.length === 1;
          const removable = pol.unused_services.length;
          const active = pol.active_services.length;
          return (
            <div key={pol.policy_arn} className="rounded-md border border-zinc-200/80 bg-white overflow-hidden">
              <button
                type="button"
                onClick={() => togglePolicy(pol.policy_arn)}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-zinc-50/50"
              >
                <Chevron open={open} />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium text-zinc-800">
                  {pol.policy_name}
                </span>
                <span
                  className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase ${
                    pol.policy_type === "aws_managed"
                      ? "bg-blue-50 text-blue-700"
                      : "bg-violet-50 text-violet-700"
                  }`}
                >
                  {pol.policy_type === "aws_managed" ? "AWS" : "Custom"}
                </span>
                {showRemovable && removable > 0 && (
                  <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">{removable} removable</span>
                )}
                {pol.has_wildcard_action && (
                  <span className="shrink-0 text-[9px] font-medium text-amber-700">wildcard</span>
                )}
              </button>
              {open && (
                <div className="border-t border-zinc-100 px-2.5 py-2 space-y-2">
                  <div className="flex justify-end">{renderConsoleLink(pol)}</div>
                  {active > 0 && (
                    <div>
                      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                        {inUseLabel} ({active})
                      </p>
                      <CompactServiceList names={pol.active_services} tone="keep" />
                    </div>
                  )}
                  {showRemovable && removable > 0 && (
                    <div>
                      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                        Removable ({removable})
                      </p>
                      <CompactServiceList names={pol.unused_services} tone="remove" />
                    </div>
                  )}
                  {active === 0 && (showRemovable ? removable === 0 : true) && pol.granted_services.length > 0 && (
                    <p className="text-[11px] text-zinc-400">No usage data yet — run another scan.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </BlastRadiusCollapsible>
  );
}

export function RoleTrustPrincipals({ principals }: { principals: string[] }) {
  if (principals.length === 0) return null;
  return (
    <div>
      <p className="impact-section-label mb-1.5 px-0.5">Trusted by</p>
      <div className="impact-trusted">
        <ul className="space-y-1">
          {principals.map((p, i) => (
            <li key={i} title={p}>
              {p}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
