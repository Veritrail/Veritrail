import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { settingsCardClass } from "./SettingsUi";
import { Select } from "./Select";

type OrgDomain = {
  id: string;
  domain: string;
  verified: boolean;
  verified_at: string | null;
  auto_join_enabled: boolean;
  auto_join_role: string;
  dns_record_name: string;
  dns_record_value: string;
  created_at: string;
};

type JoinRequest = {
  id: string;
  email: string;
  created_at: string;
};

export function DomainsSettings() {
  const qc = useQueryClient();
  const [newDomain, setNewDomain] = useState("");
  const [error, setError] = useState("");

  const { data: domains, isLoading } = useQuery<OrgDomain[]>({
    queryKey: ["org-domains"],
    queryFn: () => api("/v1/domains"),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["org-domains"] });

  const addM = useMutation({
    mutationFn: () => api("/v1/domains", { method: "POST", body: JSON.stringify({ domain: newDomain.trim() }) }),
    onSuccess: () => { invalidate(); setNewDomain(""); setError(""); },
    onError: (e: Error) => setError(e.message),
  });
  const verifyM = useMutation({
    mutationFn: (id: string) => api(`/v1/domains/${id}/verify`, { method: "POST" }),
    onSuccess: () => { invalidate(); setError(""); },
    onError: (e: Error) => setError(e.message),
  });
  const patchM = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/v1/domains/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { invalidate(); setError(""); },
    onError: (e: Error) => setError(e.message),
  });
  const delM = useMutation({
    mutationFn: (id: string) => api(`/v1/domains/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  // Pending access requests (people blocked at signup on a claimed corporate domain)
  const { data: requests } = useQuery<JoinRequest[]>({
    queryKey: ["join-requests"],
    queryFn: () => api("/v1/join-requests"),
  });
  const invalidateReq = () => qc.invalidateQueries({ queryKey: ["join-requests"] });
  const approveM = useMutation({
    mutationFn: (id: string) => api(`/v1/join-requests/${id}/approve`, { method: "POST", body: JSON.stringify({ role: "viewer" }) }),
    onSuccess: invalidateReq,
  });
  const denyM = useMutation({
    mutationFn: (id: string) => api(`/v1/join-requests/${id}/deny`, { method: "POST" }),
    onSuccess: invalidateReq,
  });

  return (
    <div className="space-y-4">
      {requests && requests.length > 0 && (
        <div className={`${settingsCardClass} space-y-2 p-4`}>
          <p className="text-xs font-medium text-zinc-500">Pending access requests</p>
          {requests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 py-2 first:border-t-0 first:pt-0">
              <div className="min-w-0">
                <span className="text-sm font-medium text-zinc-900">{r.email}</span>
                <span className="ml-2 text-xs text-zinc-400">requested {new Date(r.created_at).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => approveM.mutate(r.id)}
                  disabled={approveM.isPending}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  Approve as viewer
                </button>
                <button
                  onClick={() => denyM.mutate(r.id)}
                  disabled={denyM.isPending}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                >
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className={`${settingsCardClass} space-y-3 p-4`}>
        <p className="text-xs font-medium text-zinc-500">Add a company domain</p>
        <div className="flex flex-wrap gap-3">
          <input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="acme.com"
            className="min-w-[200px] flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          />
          <button
            onClick={() => addM.mutate()}
            disabled={addM.isPending || !newDomain.trim()}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {addM.isPending ? "Adding…" : "Add domain"}
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <p className="text-xs leading-relaxed text-zinc-500">
          Verify ownership via DNS, then optionally let new signups on that domain auto-join. Public providers
          (gmail.com, outlook.com…) can't be claimed.
        </p>
      </div>

      {isLoading && <p className="text-xs text-zinc-400">Loading…</p>}

      {domains?.map((d) => (
        <div key={d.id} className={`${settingsCardClass} space-y-3 p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-zinc-900">{d.domain}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  d.verified
                    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/60"
                    : "bg-amber-50 text-amber-700 ring-1 ring-amber-200/60"
                }`}
              >
                {d.verified ? "Verified" : "Unverified"}
              </span>
            </div>
            <button onClick={() => delM.mutate(d.id)} className="text-xs font-medium text-red-600 hover:text-red-700">
              Remove
            </button>
          </div>

          {!d.verified && (
            <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50/70 p-3">
              <p className="text-xs font-semibold text-zinc-600">Add this DNS TXT record, then verify:</p>
              <div className="grid gap-1 text-[11px]">
                <Row label="Type" value="TXT" />
                <Row label="Name" value={d.dns_record_name} />
                <Row label="Value" value={d.dns_record_value} />
              </div>
              <button
                onClick={() => verifyM.mutate(d.id)}
                disabled={verifyM.isPending}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:opacity-50"
              >
                {verifyM.isPending ? "Checking DNS…" : "Verify domain"}
              </button>
            </div>
          )}

          {d.verified && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900">Auto-join</p>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                  New signups with an @{d.domain} email join automatically as the role below.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  size="sm"
                  value={d.auto_join_role}
                  onChange={(v) => patchM.mutate({ id: d.id, body: { auto_join_role: v } })}
                  options={[
                    { value: "viewer", label: "Viewer" },
                    { value: "editor", label: "Editor" },
                    { value: "admin", label: "Admin" },
                  ]}
                />
                <button
                  onClick={() => patchM.mutate({ id: d.id, body: { auto_join_enabled: !d.auto_join_enabled } })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    d.auto_join_enabled
                      ? "bg-zinc-900 text-white hover:bg-zinc-800"
                      : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  {d.auto_join_enabled ? "Auto-join on" : "Enable auto-join"}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-12 shrink-0 text-zinc-400">{label}</span>
      <span className="break-all font-mono text-zinc-700">{value}</span>
    </div>
  );
}
