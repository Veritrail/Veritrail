import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { auditorVerifyUrl } from "../lib/appOrigin";
import { Select } from "./Select";
import {
  AccessCard,
  AccessRow,
  StatusPill,
  accessComposer,
  accessDangerBtn,
  accessGhostBtn,
  accessInput,
  accessPrimaryBtn,
} from "./accessUi";

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
  email_delivery_note?: string | null;
  verify_url?: string;
};

type StatusTone = "active" | "muted" | "danger";

function getStatus(entry: AuditorAccessEntry): { label: string; tone: StatusTone } {
  if (!entry.is_active) return { label: "Revoked", tone: "muted" };
  if (new Date(entry.expires_at) < new Date()) return { label: "Expired", tone: "danger" };
  return { label: "Active", tone: "active" };
}

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
          data.email_delivery_note
            ? `${data.email_delivery_note} Link copied to clipboard — share manually.`
            : "Could not send invite email. Link copied to clipboard — share manually.",
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

  const activeCount = (auditors ?? []).filter((a) => a.is_active && new Date(a.expires_at) > new Date()).length;

  return (
    <AccessCard
      title="External auditors"
      description="Temporary, scoped access to your evidence for outside reviewers and customers."
      status={
        activeCount > 0 ? (
          <StatusPill tone="active">{activeCount} active</StatusPill>
        ) : (
          <StatusPill tone="muted">None</StatusPill>
        )
      }
    >
      <div className={accessComposer}>
        <p className="mb-2 text-xs font-semibold text-zinc-600">Invite an auditor</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="auditor@firm.com"
            className={`${accessInput} min-w-[180px] flex-1 sm:max-w-[300px]`}
          />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            className={`${accessInput} w-36`}
          />
          <Select
            value={String(expiryDays)}
            onChange={(v) => setExpiryDays(Number(v))}
            options={[
              { value: "7", label: "7 days" },
              { value: "14", label: "14 days" },
              { value: "30", label: "30 days" },
              { value: "90", label: "90 days" },
            ]}
          />
          <button onClick={() => inviteMutation.mutate()} disabled={inviteMutation.isPending || !email.trim()} className={accessPrimaryBtn}>
            {inviteMutation.isPending ? "Inviting…" : "Invite"}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        {inviteNote && <p className="mt-2 text-xs text-zinc-600">{inviteNote}</p>}
        <p className="mt-2 text-[11px] text-zinc-400">The invite link opens a scoped auditor portal — never the API or your console.</p>
      </div>

      {isLoading && <p className="text-xs text-zinc-400">Loading…</p>}

      {auditors && auditors.length === 0 && !isLoading && (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/40 px-4 py-7 text-center text-sm text-zinc-400">
          No auditor invites yet.
        </div>
      )}

      {auditors && auditors.length > 0 && (
        <div className="space-y-2">
          {auditors.map((entry) => {
            const st = getStatus(entry);
            return (
              <AccessRow
                key={entry.id}
                email={entry.email}
                meta={<>{entry.name || "Auditor"} · expires {new Date(entry.expires_at).toLocaleDateString()}</>}
                right={<StatusPill tone={st.tone}>{st.label}</StatusPill>}
                actions={
                  <>
                    {entry.is_active && (
                      <>
                        <button onClick={() => copyLink(entry.access_token)} className={accessGhostBtn}>
                          {copyMsg === entry.access_token ? "Copied!" : "Copy link"}
                        </button>
                        <button onClick={() => extendMutation.mutate({ id: entry.id, days: 30 })} className={accessGhostBtn}>
                          Extend
                        </button>
                      </>
                    )}
                    <button onClick={() => revokeMutation.mutate(entry.id)} className={accessDangerBtn}>
                      Revoke
                    </button>
                  </>
                }
              />
            );
          })}
        </div>
      )}
    </AccessCard>
  );
}
