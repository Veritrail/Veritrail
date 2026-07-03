import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { memberListSchema } from "../lib/apiSchemas";
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
import { SsoPolicySettings } from "./SsoPolicySettings";

type MemberEntry = {
  id: string;
  email: string;
  role: string;
  created_at: string;
};

type InviteEntry = {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string | null;
  created_at: string;
  invite_url: string;
  email_sent: boolean;
};

type InviteResult = InviteEntry;

const ASSIGNABLE_ROLES = ["admin", "editor", "viewer"] as const;

export function TeamMembersSettings() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ASSIGNABLE_ROLES)[number]>("viewer");
  const [expiryDays, setExpiryDays] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [copyMsg, setCopyMsg] = useState("");
  const [inviteNote, setInviteNote] = useState("");

  const { data: members, isLoading: membersLoading } = useQuery<MemberEntry[]>({
    queryKey: ["team-members"],
    queryFn: () => api("/v1/members", { schema: memberListSchema }),
  });

  const { data: invites, isLoading: invitesLoading } = useQuery<InviteEntry[]>({
    queryKey: ["team-invites"],
    queryFn: () => api("/v1/members/invites"),
  });

  const inviteMutation = useMutation({
    mutationFn: (): Promise<InviteResult> =>
      api<InviteResult>("/v1/members/invites", {
        method: "POST",
        body: JSON.stringify({ email, role, expiry_days: expiryDays }),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["team-invites"] });
      setEmail("");
      setError("");
      copyLink(data.invite_url);
      if (data.email_sent) {
        setInviteNote(`Invite email sent to ${data.email}. Link also copied to clipboard.`);
      } else {
        setInviteNote(
          "No invite email sent — check SMTP settings in .env. Invite link copied to clipboard — share it manually.",
        );
      }
      setTimeout(() => setInviteNote(""), 8000);
    },
    onError: (err: Error) => setError(err.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api(`/v1/members/invites/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team-invites"] }),
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, newRole }: { id: string; newRole: string }) =>
      api(`/v1/members/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team-members"] }),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api(`/v1/members/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team-members"] }),
  });

  function copyLink(url: string) {
    navigator.clipboard.writeText(url).catch(() => {});
    setCopyMsg(url);
    setTimeout(() => setCopyMsg(""), 2000);
  }

  const isLoading = membersLoading || invitesLoading;
  const memberCount = members?.length ?? 0;

  return (
    <div className="space-y-4">
      <SsoPolicySettings />
      <AccessCard
      title="Workspace members"
      description="Teammates who can sign in here. Roles control what they're allowed to change."
      status={<StatusPill tone="muted">{memberCount} member{memberCount === 1 ? "" : "s"}</StatusPill>}
      hideHeader
    >
      <div className={accessComposer}>
        <span className="access-invite-card__icon" aria-hidden>
          <svg fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0-8.53 5.25a2.25 2.25 0 0 1-2.44 0L2.25 6.75" />
          </svg>
        </span>
        <div className="access-invite-card__copy">
          <p className="access-invite-card__title">Invite a member</p>
          <p className="access-invite-card__description">
            For people who do not have a Veritrail account yet — contractors and personal emails are fine. If they already
            belong to another workspace, they must leave that account first or use a different email.
          </p>
        </div>
        <div className="access-invite-card__form">
          <label className="access-field access-field--email">
            <span>Email address</span>
            <span className="access-input-shell">
              <svg fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0-8.53 5.25a2.25 2.25 0 0 1-2.44 0L2.25 6.75" />
              </svg>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
                className={accessInput}
              />
            </span>
          </label>
          <label className="access-field">
            <span>Role</span>
            <Select
              className="access-select-btn"
              value={role}
              onChange={(v) => setRole(v as (typeof ASSIGNABLE_ROLES)[number])}
              options={[
                { value: "admin", label: "Admin" },
                { value: "editor", label: "Editor" },
                { value: "viewer", label: "Viewer" },
              ]}
            />
          </label>
          <label className="access-field">
            <span>Access expiration</span>
            <Select
              className="access-select-btn"
              value={expiryDays == null ? "" : String(expiryDays)}
              onChange={(v) => setExpiryDays(v === "" ? null : Number(v))}
              options={[
                { value: "", label: "No expiration" },
                { value: "7", label: "7 days" },
                { value: "14", label: "14 days" },
                { value: "30", label: "30 days" },
              ]}
            />
          </label>
          <button onClick={() => inviteMutation.mutate()} disabled={inviteMutation.isPending || !email.trim()} className={accessPrimaryBtn}>
            {inviteMutation.isPending ? "Inviting…" : "Invite"}
            <svg fill="none" stroke="currentColor" strokeWidth={1.9} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.126A59.768 59.768 0 0 1 21.485 12 59.77 59.77 0 0 1 3.27 20.876L6 12Zm0 0h7.5" />
            </svg>
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        {inviteNote && <p className="mt-2 text-xs text-zinc-600">{inviteNote}</p>}
      </div>

      {isLoading && <p className="text-xs text-zinc-400">Loading…</p>}

      {invites && invites.length > 0 && (
        <div className="access-members-section">
          <p className="access-members-section__title">Pending invites</p>
          <div className="access-members-list">
            {invites.map((entry) => (
              <AccessRow
                key={entry.id}
                email={entry.email}
                meta={
                  <span className="capitalize">
                    {entry.role} · expires {entry.expires_at ? new Date(entry.expires_at).toLocaleDateString() : "never"}
                  </span>
                }
                right={<StatusPill tone="info">Pending</StatusPill>}
                actions={
                  <>
                    <button onClick={() => copyLink(entry.invite_url)} className={accessGhostBtn}>
                      {copyMsg === entry.invite_url ? "Copied!" : "Copy link"}
                    </button>
                    <button onClick={() => revokeMutation.mutate(entry.id)} className={accessDangerBtn}>
                      Revoke
                    </button>
                  </>
                }
              />
            ))}
          </div>
        </div>
      )}

      {members && members.length > 0 && (
        <div className="access-members-section">
          <p className="access-members-section__title">Members</p>
          <div className="access-members-list">
            {members.map((entry) => (
              <AccessRow
                key={entry.id}
                email={entry.email}
                meta={<>Joined {entry.created_at ? new Date(entry.created_at).toLocaleDateString() : "—"}</>}
                actions={
                  entry.role === "owner" ? (
                    <StatusPill tone="info">Owner</StatusPill>
                  ) : (
                    <>
                      <Select
                        size="sm"
                        value={entry.role}
                        onChange={(newRole) => roleMutation.mutate({ id: entry.id, newRole })}
                        disabled={roleMutation.isPending}
                        options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) }))}
                      />
                      <button onClick={() => removeMutation.mutate(entry.id)} className={accessDangerBtn}>
                        Remove
                      </button>
                    </>
                  )
                }
              />
            ))}
          </div>
        </div>
      )}
    </AccessCard>
    </div>
  );
}
