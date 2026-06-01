import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { auditorApi } from "../api";

type EvidenceSnapshot = {
  id: string;
  entity_type: string;
  entity_id: string;
  taken_at: string;
  data: Record<string, unknown>;
};

type EvidencePage = {
  items: EvidenceSnapshot[];
  total: number;
  offset: number;
  limit: number;
};

const LIMIT = 50;

export default function AuditorEvidence() {
  const [entityType, setEntityType] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (entityType) params.set("entity_type", entityType);
  params.set("limit", String(LIMIT));
  params.set("offset", String(offset));

  const { data, isLoading } = useQuery<EvidencePage>({
    queryKey: ["auditor-evidence", entityType, offset],
    queryFn: () => auditorApi(`/auditor/evidence?${params.toString()}`),
  });

  const selectedEvidence = data?.items.find((e) => e.id === selectedId);

  return (
    <div className="w-full space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Evidence Snapshots</h1>
        <p className="mt-1 text-sm text-zinc-500">Read-only · browse collected evidence from scan runs.</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={entityType}
          onChange={(e) => { setEntityType(e.target.value); setOffset(0); }}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
        >
          <option value="">All entity types</option>
          <option value="iam_user">IAM Users</option>
          <option value="iam_role">IAM Roles</option>
          <option value="iam_access_key">IAM Access Keys</option>
          <option value="s3_bucket">S3 Buckets</option>
          <option value="kms_key">KMS Keys</option>
          <option value="cloudtrail_trail">CloudTrail Trails</option>
          <option value="security_group">Security Groups</option>
          <option value="rds_instance">RDS Instances</option>
          <option value="lambda_function">Lambda Functions</option>
        </select>
        {data && <span className="self-center text-sm text-zinc-500">{data.total} snapshots</span>}
      </div>

      {isLoading && <div className="text-sm text-zinc-400 py-8">Loading…</div>}

      {data && (
        <>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Entity Type</th>
                  <th className="px-4 py-3">Entity ID</th>
                  <th className="px-4 py-3">Collected At</th>
                  <th className="px-4 py-3 w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.items.map((s) => (
                  <tr key={s.id} className={`hover:bg-zinc-50/50 ${selectedId === s.id ? "bg-indigo-50/50" : ""}`}>
                    <td className="px-4 py-3">
                      <span className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-600">
                        {s.entity_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-600 max-w-sm truncate">
                      {s.entity_id}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {new Date(s.taken_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setSelectedId(selectedId === s.id ? null : s.id)}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                      >
                        {selectedId === s.id ? "Hide" : "View"}
                      </button>
                    </td>
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
            <span className="text-xs text-zinc-500">{offset + 1}–{Math.min(offset + LIMIT, data.total)} of {data.total}</span>
            <button
              onClick={() => setOffset(offset + LIMIT)}
              disabled={offset + LIMIT >= data.total}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 disabled:opacity-40"
            >
              Next
            </button>
          </div>

          {/* Evidence detail panel */}
          {selectedEvidence && (
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-zinc-900">
                Evidence Detail — {selectedEvidence.entity_type}
              </h3>
              <p className="mt-1 font-mono text-xs text-zinc-500 break-all">{selectedEvidence.entity_id}</p>
              <p className="mt-1 text-xs text-zinc-400">
                Collected: {new Date(selectedEvidence.taken_at).toLocaleString()}
              </p>
              <pre className="mt-4 max-h-96 overflow-auto rounded-lg bg-zinc-50 p-4 text-xs text-zinc-700 font-mono">
                {JSON.stringify(selectedEvidence.data, null, 2)}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
