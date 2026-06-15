import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { auditorApi } from "../api";
import { useAuditorAsOf } from "../components/AuditorAsOf";
import "../styles/auditor.css";

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

const LIMIT = 50;

export default function AuditorFindings() {
  const { asOf } = useAuditorAsOf();
  const [severity, setSeverity] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [offset, setOffset] = useState(0);

  const params = new URLSearchParams();
  if (severity) params.set("severity", severity);
  if (statusFilter) params.set("status", statusFilter);
  params.set("limit", String(LIMIT));
  params.set("offset", String(offset));
  if (asOf) params.set("as_of", asOf);

  const { data, isLoading } = useQuery<FindingsPage>({
    queryKey: ["auditor-findings", severity, statusFilter, offset, asOf],
    queryFn: () => auditorApi(`/auditor/findings?${params.toString()}`),
  });

  return (
    <div className="aud-page space-y-5 pb-8">
      <div>
        <h1 className="aud-title">Findings</h1>
        <p className="aud-subtitle">Read-only · browse compliance findings and evidence.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={severity}
          onChange={(e) => { setSeverity(e.target.value); setOffset(0); }}
          className="aud-select"
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
          className="aud-select"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="snoozed">Snoozed</option>
          <option value="resolved">Resolved</option>
          <option value="ignored">Ignored</option>
          <option value="excepted">Excepted</option>
        </select>
        {data && <span className="text-sm font-medium text-zinc-500">{data.total} findings</span>}
      </div>

      {/* Table */}
      {isLoading && <div className="py-8 text-sm text-zinc-400">Loading…</div>}

      {data && (
        <>
          <div className="aud-table-wrap">
            <table className="aud-table">
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Title</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Risk</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((f) => (
                  <tr key={f.id}>
                    <td className="aud-td-mono">{f.check_id}</td>
                    <td className="aud-td-strong max-w-md truncate">{f.title}</td>
                    <td>
                      <span className={`aud-pill aud-pill--${f.severity}`}>
                        <span className="aud-pill__dot" aria-hidden />
                        {f.severity}
                      </span>
                    </td>
                    <td>
                      <span className={`aud-pill aud-pill--${f.status}`}>{f.status}</span>
                    </td>
                    <td className="font-semibold tabular-nums text-zinc-900">{f.risk_score}</td>
                    <td className="text-xs text-zinc-500">{new Date(f.last_seen).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center gap-3">
            <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className="aud-pager-btn">
              Previous
            </button>
            <span className="text-xs text-zinc-500">
              {offset + 1}–{Math.min(offset + LIMIT, data.total)} of {data.total}
            </span>
            <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= data.total} className="aud-pager-btn">
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
