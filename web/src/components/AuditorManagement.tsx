import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { auditorVerifyUrl } from "../lib/appOrigin";
import { settingsCardClass } from "./SettingsUi";

type AuditorAccessEntry = {
  id: string;
  email: string;
  name: string | null;
  access_token: string;
  expires_at: string;
  is_active: boolean;
  created_at: string;
  last_accessed_at: string | null;
};

type AuditorInviteResult = AuditorAccessEntry & {
  email_sent?: boolean;
  verify_url?: string;
};

export function AuditorManagement() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [expiryDays, setExpiryDays] = useState(30);
  const [error, setError] = useState("");
  const [copyMsg, setCopyMsg] = useState("");
  const [inviteNote, setInviteNote] = useState("");

  const { data: auditors, isLoading } = useQuery<AuditorAccessEntry[]>({
    queryKey: ["auditor-list"],
    queryFn: () => api("/v1/auditor/list"),
  });

  const inviteMutation = useMutation({
    mutationFn: (): Promise<AuditorInviteResult> =>
      api<AuditorInviteResult>("/v1/auditor/invite", {
        method: "POST",
        body: JSON.stringify({ email, name: name || null, expiry_days: expiryDays }),
      }),
    onSuccess: (data: AuditorInviteResult) => {
      qc.invalidateQueries({ queryKey: ["auditor-list"] });
      setEmail("");
      setName("");
      setError("");
      copyLink(data.access_token);
      if (data.email_sent) {
        setInviteNote(`Invite email sent to ${data.email}. Link also copied to clipboard.`);
      } else {
        setInviteNote(
          "No invite email sent (set RESEND_API_KEY on the API). Auditor link copied to clipboard — share it manually.",
        );
      }
      setTimeout(() => setInviteNote(""), 8000);
    },
    onError: (err: Error) => setError(err.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api(`/v1/auditor/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auditor-list"] }),
  });

  const extendMutation = useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) =>
      api(`/v1/auditor/${id}/extend`, {
        method: "POST",
        body: JSON.stringify({ additional_days: days }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auditor-list"] }),
  });

  function copyLink(token: string) {
    navigator.clipboard.writeText(auditorVerifyUrl(token)).catch(() => {});
    setCopyMsg(token);
    setTimeout(() => setCopyMsg(""), 2000);
  }

  function getStatus(entry: AuditorAccessEntry): { label: string; color: string } {
    if (!entry.is_active) return { label: "Revoked", color: "bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200" };
    const exp = new Date(entry.expires_at);
    if (exp < new Date()) return { label: "Expired", color: "bg-red-50 text-red-600 ring-1 ring-red-200" };
    return { label: "Active", color: "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200" };
  }

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Auditor Access</h3>

      {/* Invite form */}
      <div className={`${settingsCardClass} p-4 space-y-3`}>
        <p className="text-xs font-medium text-zinc-500">Invite an external auditor</p>
        <div className="flex flex-wrap gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="auditor@firm.com"
            className="flex-1 min-w-[200px] rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            className="w-40 rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          />
          <select
            value={expiryDays}
            onChange={(e) => setExpiryDays(Number(e.target.value))}
            className="rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
          <button
            onClick={() => inviteMutation.mutate()}
            disabled={inviteMutation.isPending || !email.trim()}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
          >
            {inviteMutation.isPending ? "Inviting…" : "Invite"}
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        {inviteNote && <p className="text-xs text-zinc-600">{inviteNote}</p>}
        <p className="text-[11px] text-zinc-400">
          Copy link opens the app at{" "}
          <span className="font-mono text-zinc-500">{auditorVerifyUrl("…")}</span> — not the API.
        </p>
      </div>

      {/* Auditor list */}
      {isLoading && <p className="text-xs text-zinc-400">Loading…</p>}

      {auditors && auditors.length === 0 && (
        <p className="text-xs text-zinc-500">No auditor invites yet.</p>
      )}

      {auditors && auditors.length > 0 && (
        <div className={`${settingsCardClass} overflow-hidden`}>
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 border-b border-zinc-100">
              <tr className="text-left text-zinc-500">
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Expires</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {auditors.map((entry) => {
                const st = getStatus(entry);
                return (
                  <tr key={entry.id} className="hover:bg-zinc-50/50">
                    <td className="px-3 py-2.5 text-zinc-900">{entry.email}</td>
                    <td className="px-3 py-2.5 text-zinc-500">{entry.name || "—"}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.color}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-zinc-500">{new Date(entry.expires_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1.5">
                        {entry.is_active && (
                          <>
                            <button
                              onClick={() => copyLink(entry.access_token)}
                              className="rounded-md bg-zinc-100 px-2 py-1 text-[10px] font-semibold text-zinc-600 hover:bg-zinc-200"
                            >
                              {copyMsg === entry.access_token ? "Copied!" : "Copy Link"}
                            </button>
                            <button
                              onClick={() => extendMutation.mutate({ id: entry.id, days: 30 })}
                              className="rounded-md bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-200"
                            >
                              +30d
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => revokeMutation.mutate(entry.id)}
                          className="rounded-md bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-600 hover:bg-red-100"
                        >
                          Revoke
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
