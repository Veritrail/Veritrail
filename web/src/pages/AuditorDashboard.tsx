import { useQuery } from "@tanstack/react-query";
import { auditorApi } from "../api";

type DashboardData = {
  org_name: string;
  auditor_name: string | null;
  expires_at: string | null;
  active_frameworks: string[];
  connected_accounts: number;
  last_scan_at: string | null;
  findings_total: number;
  findings_by_severity: Record<string, number>;
  evidence_snapshot_count: number;
};

const sevColors: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

const sevOrder = ["critical", "high", "medium", "low"];

function formatWhen(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function AuditorDashboard() {
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["auditor-dashboard"],
    queryFn: () => auditorApi("/auditor/dashboard"),
  });

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center text-sm text-zinc-400">Loading…</div>;
  }

  if (!data) return null;

  return (
    <div className="w-full space-y-8 pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950">
          {data.org_name} — Auditor Dashboard
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Read-only access · {data.auditor_name || "External Auditor"}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Connected Accounts" value={data.connected_accounts} />
        <StatCard label="Evidence Snapshots" value={data.evidence_snapshot_count.toLocaleString()} />
        <StatCard label="Open Findings" value={data.findings_total} />
        <StatCard label="Last Scan" value={formatWhen(data.last_scan_at)} />
      </div>

      {/* Findings by severity */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Findings by Severity</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          {sevOrder.map((sev) => {
            const count = data.findings_by_severity[sev] || 0;
            if (count === 0 && Object.keys(data.findings_by_severity).length > 0) return null;
            return (
              <div key={sev} className={`rounded-xl border px-4 py-3 ${sevColors[sev] || "bg-zinc-100 text-zinc-600 border-zinc-200"}`}>
                <div className="text-xs font-semibold uppercase tracking-wider">{sev}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{count}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Frameworks */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Frameworks in Scope</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {data.active_frameworks.map((fw) => (
            <span key={fw} className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200">
              {fw.toUpperCase().replace(/_/g, " ")}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-zinc-900">{value}</p>
    </div>
  );
}
