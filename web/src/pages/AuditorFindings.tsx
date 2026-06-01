import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { auditorApi } from "../api";

type AuditorFinding = {
  id: string;
  account_id: string;
  check_id: string;
  resource_arn: string;
  title: string;
  severity: string;
  risk_score: number;
  status: string;
  evidence: Record<string, unknown>;
  first_seen: string;
  last_seen: string;
};

type FindingsPage = {
  items: AuditorFinding[];
  total: number;
  offset: number;
  limit: number;
};

const sevBadge: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

const statusBadge: Record<string, string> = {
  open: "bg-red-50 text-red-700 ring-1 ring-red-200",
  snoozed: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  resolved: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  ignored: "bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200",
  excepted: "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
};

const LIMIT = 50;

export default function AuditorFindings() {
  const [severity, setSeverity] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [offset, setOffset] = useState(0);

  const params = new URLSearchParams();
  if (severity) params.set("severity", severity);
  if (statusFilter) params.set("status", statusFilter);
  params.set("limit", String(LIMIT));
  params.set("offset", String(offset));

  const { data, isLoading } = useQuery<FindingsPage>({
    queryKey: ["auditor-findings", severity, statusFilter, offset],
    queryFn: () => auditorApi(`/auditor/findings?${params.toString()}`),
  });

  return (
    <div className="w-full space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Findings</h1>
        <p className="mt-1 text-sm text-zinc-500">Read-only · browse compliance findings and evidence.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={severity}
          onChange={(e) => { setSeverity(e.target.value); setOffset(0); }}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
        >
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setOffset(0); }}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="snoozed">Snoozed</option>
          <option value="resolved">Resolved</option>
          <option value="ignored">Ignored</option>
          <option value="excepted">Excepted</option>
        </select>
        {data && <span className="self-center text-sm text-zinc-500">{data.total} findings</span>}
      </div>

      {/* Table */}
      {isLoading && <div className="text-sm text-zinc-400 py-8">Loading…</div>}

      {data && (
        <>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Check</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Risk</th>
                  <th className="px-4 py-3">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.items.map((f) => (
                  <tr key={f.id} className="hover:bg-zinc-50/50">
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{f.check_id}</td>
                    <td className="px-4 py-3 max-w-xs truncate">{f.title}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${sevBadge[f.severity] || "bg-zinc-100 text-zinc-600 border-zinc-200"}`}>
                        {f.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadge[f.status] || ""}`}>
                        {f.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">{f.risk_score}</td>
                    <td className="px-4 py-3 text-xs text-zinc-500">{new Date(f.last_seen).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              disabled={offset === 0}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-zinc-500">
              {offset + 1}–{Math.min(offset + LIMIT, data.total)} of {data.total}
            </span>
            <button
              onClick={() => setOffset(offset + LIMIT)}
              disabled={offset + LIMIT >= data.total}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
