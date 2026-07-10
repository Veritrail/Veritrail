import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../api";
import {
  auditorListSchema,
  evidenceExportListSchema,
  scopedExportLinkSchema,
  vaultShareListSchema,
} from "../lib/apiSchemas";
import { AccessCard, accessInput, accessPrimaryBtn } from "./accessUi";
import { Select } from "./Select";

type Props = {
  embedded?: boolean;
};

export function AuditorScopedExportPanel({ embedded }: Props) {
  const qc = useQueryClient();
  const auditors = useQuery({
    queryKey: ["auditor-list"],
    queryFn: () => api("/v1/auditor/list", { schema: auditorListSchema }),
  });
  const exports = useQuery({
    queryKey: ["auditor-exports"],
    queryFn: () => api("/v1/auditor/exports", { schema: evidenceExportListSchema }),
  });
  const shares = useQuery({
    queryKey: ["vault-shares"],
    queryFn: () => api("/v1/auditor/vault-shares", { schema: vaultShareListSchema }),
  });

  const [exportId, setExportId] = useState("");
  const [auditorId, setAuditorId] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");

  const activeAuditors = (auditors.data ?? []).filter(
    (a) => a.is_active && new Date(a.expires_at) > new Date(),
  );
  const exportRows = exports.data ?? [];

  const mintLink = useMutation({
    mutationFn: () =>
      api("/v1/auditor/exports/" + exportId + "/scoped-link", {
        method: "POST",
        body: JSON.stringify({ auditor_access_id: auditorId, ttl_hours: 168 }),
        schema: scopedExportLinkSchema,
      }),
    onSuccess: (data) => {
      setLinkUrl(data.url);
      setInstructions(data.instructions ?? "");
      setError("");
      qc.invalidateQueries({ queryKey: ["vault-shares"] });
    },
    onError: (err) => setError(formatApiError(err)),
  });

  const body = (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500">
        Generate a scoped download link for a prior evidence pack export. Vault-backed exports receive a time-limited
        presigned URL when configured; otherwise auditors use the read-only portal after verifying their invite.
      </p>
      {exportRows.length === 0 ? (
        <p className="text-sm text-zinc-500">No recorded exports yet. Download an evidence pack from Compliance first.</p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">Evidence export</span>
            <Select
              value={exportId}
              onChange={setExportId}
              options={[
                { value: "", label: "Select export…" },
                ...exportRows.map((row) => ({
                  value: row.id,
                  label: `${row.framework} · ${row.period_days}d · ${row.created_at.slice(0, 10)}${
                    row.zip_sha256 ? ` · sha256:${row.zip_sha256.slice(0, 12)}…` : ""
                  }${row.report_id ? ` · ${row.report_id}` : ""}`,
                })),
              ]}
            />
          </label>
          {exportId ? (
            (() => {
              const selected = exportRows.find((r) => r.id === exportId);
              if (!selected) return null;
              return (
                <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-[11px] text-zinc-600">
                  ZIP SHA-256: {selected.zip_sha256}
                  {selected.report_id ? (
                    <>
                      <br />
                      Report ID: {selected.report_id}
                    </>
                  ) : null}
                </p>
              );
            })()
          ) : null}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">Auditor</span>
            <Select
              value={auditorId}
              onChange={setAuditorId}
              options={[
                { value: "", label: "Select auditor…" },
                ...activeAuditors.map((a) => ({
                  value: a.id,
                  label: a.name ? `${a.name} (${a.email})` : a.email,
                })),
              ]}
            />
          </label>
          <button
            type="button"
            className={accessPrimaryBtn}
            disabled={!exportId || !auditorId || mintLink.isPending}
            onClick={() => mintLink.mutate()}
          >
            {mintLink.isPending ? "Generating…" : "Generate scoped link"}
          </button>
        </>
      )}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {linkUrl ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm">
          <p className="font-medium text-zinc-800">Scoped link</p>
          {instructions ? <p className="mt-1 text-zinc-600">{instructions}</p> : null}
          <input className={`${accessInput} mt-2 font-mono text-xs`} readOnly value={linkUrl} onFocus={(e) => e.target.select()} />
        </div>
      ) : null}
      {(shares.data ?? []).length > 0 ? (
        <div className="mt-4 border-t border-zinc-100 pt-4">
          <p className="text-sm font-medium text-zinc-800">Approval history</p>
          <ul className="mt-2 space-y-2 text-sm text-zinc-600">
            {shares.data!.slice(0, 8).map((row) => (
              <li key={row.id}>
                {row.auditor_email} · {row.link_type} · expires {row.expires_at.slice(0, 10)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );

  if (embedded) return <div className="mt-6 border-t border-zinc-100 pt-6">{body}</div>;
  return (
    <AccessCard title="Scoped export links" description="Share immutable pack exports with approved auditors.">
      {body}
    </AccessCard>
  );
}
