import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { auditorApi } from "../api";
import { useAuditorAsOf } from "../components/AuditorAsOf";
import "../styles/auditor.css";

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
  const { asOf } = useAuditorAsOf();
  const [entityType, setEntityType] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (entityType) params.set("entity_type", entityType);
  params.set("limit", String(LIMIT));
  params.set("offset", String(offset));
  if (asOf) params.set("as_of", asOf);

  const { data, isLoading } = useQuery<EvidencePage>({
    queryKey: ["auditor-evidence", entityType, offset, asOf],
    queryFn: () => auditorApi(`/auditor/evidence?${params.toString()}`),
  });

  const selectedEvidence = data?.items.find((e) => e.id === selectedId);

  return (
    <div className="aud-page space-y-5 pb-8">
      <div>
        <h1 className="aud-title">Evidence Snapshots</h1>
        <p className="aud-subtitle">Read-only · browse collected evidence from scan runs.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={entityType}
          onChange={(e) => { setEntityType(e.target.value); setOffset(0); }}
          className="aud-select"
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
        {data && <span className="text-sm font-medium text-zinc-500">{data.total} snapshots</span>}
      </div>

      {isLoading && <div className="py-8 text-sm text-zinc-400">Loading…</div>}

      {data && (
        <>
          <div className="aud-table-wrap">
            <table className="aud-table">
              <thead>
                <tr>
                  <th>Entity type</th>
                  <th>Entity ID</th>
                  <th>Collected at</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.id} style={selectedId === s.id ? { background: "#eef2ff" } : undefined}>
                    <td>
                      <span className="aud-fw-pill" style={{ background: "#f1f5f9", color: "#475569", boxShadow: "inset 0 0 0 1px #e2e8f0", fontWeight: 600 }}>
                        {s.entity_type}
                      </span>
                    </td>
                    <td className="aud-td-mono max-w-sm truncate">{s.entity_id}</td>
                    <td className="text-xs text-zinc-500">{new Date(s.taken_at).toLocaleString()}</td>
                    <td>
                      <button
                        onClick={() => setSelectedId(selectedId === s.id ? null : s.id)}
                        className="text-xs font-semibold text-indigo-600 transition hover:text-indigo-800"
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
          <div className="flex items-center gap-3">
            <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className="aud-pager-btn">
              Previous
            </button>
            <span className="text-xs text-zinc-500">{offset + 1}–{Math.min(offset + LIMIT, data.total)} of {data.total}</span>
            <button onClick={() => setOffset(offset + LIMIT)} disabled={offset + LIMIT >= data.total} className="aud-pager-btn">
              Next
            </button>
          </div>

          {/* Evidence detail panel */}
          {selectedEvidence && (
            <div className="aud-card aud-card__pad">
              <h3 className="text-sm font-semibold text-zinc-900">Evidence detail — {selectedEvidence.entity_type}</h3>
              <p className="mt-1 break-all font-mono text-xs text-zinc-500">{selectedEvidence.entity_id}</p>
              <p className="mt-1 text-xs text-zinc-400">Collected: {new Date(selectedEvidence.taken_at).toLocaleString()}</p>
              <pre className="mt-4 max-h-96 overflow-auto rounded-lg bg-zinc-50 p-4 font-mono text-xs text-zinc-700 ring-1 ring-zinc-100">
                {JSON.stringify(selectedEvidence.data, null, 2)}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
