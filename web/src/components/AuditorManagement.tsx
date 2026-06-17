import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { auditorVerifyUrl } from "../lib/appOrigin";
import { Select } from "./Select";
import { AccessCard, StatusPill } from "./accessUi";

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

function LockIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
  );
}

function KebabIcon() {
  return (
    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

function AuditorRow({
  entry,
  onCopy,
  onExtend,
  onRevoke,
  copyActive,
}: {
  entry: AuditorAccessEntry;
  onCopy: () => void;
  onExtend: () => void;
  onRevoke: () => void;
  copyActive: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const st = getStatus(entry);
  const initial = (entry.email[0] || "?").toUpperCase();
  const expiry = new Date(entry.expires_at).toLocaleDateString();

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  return (
    <div className="workspace-auditor-row">
      <div className="workspace-auditor-row__avatar" aria-hidden>
        {initial}
      </div>
      <div className="workspace-auditor-row__body">
        <p className="workspace-auditor-row__email">{entry.email}</p>
        <p className="workspace-auditor-row__meta">
          {entry.name || "Auditor"} · Expires {expiry}
        </p>
      </div>
      <StatusPill tone={st.tone}>{st.label}</StatusPill>
      <div className="workspace-auditor-row__menu" ref={menuRef}>
        <button
          type="button"
          className="workspace-auditor-row__kebab"
          aria-label="Auditor actions"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <KebabIcon />
        </button>
        {menuOpen && (
          <div className="workspace-auditor-row__dropdown" role="menu">
            {entry.is_active && st.tone === "active" && (
              <>
                <button type="button" role="menuitem" onClick={() => { onCopy(); setMenuOpen(false); }}>
                  {copyActive ? "Copied!" : "Copy link"}
                </button>
                <button type="button" role="menuitem" onClick={() => { onExtend(); setMenuOpen(false); }}>
                  Extend 30 days
                </button>
              </>
            )}
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              onClick={() => { onRevoke(); setMenuOpen(false); }}
            >
              Revoke
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function AuditorManagement({ embedded = false }: { embedded?: boolean }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [expiryDays, setExpiryDays] = useState(30);
  const [error, setError] = useState("");
  const [copyToken, setCopyToken] = useState("");
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
    setCopyToken(token);
    setTimeout(() => setCopyToken(""), 2000);
  }

  const activeCount = (auditors ?? []).filter((a) => a.is_active && new Date(a.expires_at) > new Date()).length;

  const body = (
    <div className="workspace-auditor">
      <div className="workspace-auditor__invite">
        <p className="workspace-auditor__invite-label">Invite an auditor</p>
        <div className="workspace-auditor__invite-row">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="auditor@firm.com"
            className="workspace-auditor__input"
          />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            className="workspace-auditor__input workspace-auditor__input--name"
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
          <button
            type="button"
            onClick={() => inviteMutation.mutate()}
            disabled={inviteMutation.isPending || !email.trim()}
            className="vigil-toolbar-btn workspace-btn--accent"
          >
            {inviteMutation.isPending ? "Inviting…" : "Invite"}
          </button>
        </div>
        {error && <p className="workspace-auditor__error">{error}</p>}
        {inviteNote && <p className="workspace-auditor__note">{inviteNote}</p>}
        <p className="workspace-auditor__secure">
          <LockIcon />
          Auditors never see your API keys or internal details.
        </p>
      </div>

      {isLoading && <p className="text-xs text-zinc-400">Loading…</p>}

      {auditors && auditors.length === 0 && !isLoading && (
        <div className="workspace-auditor__empty">No auditor invites yet.</div>
      )}

      {auditors && auditors.length > 0 && (
        <div className="workspace-auditor__list">
          <p className="workspace-auditor__list-label">Active auditors</p>
          {auditors.map((entry) => (
            <AuditorRow
              key={entry.id}
              entry={entry}
              copyActive={copyToken === entry.access_token}
              onCopy={() => copyLink(entry.access_token)}
              onExtend={() => extendMutation.mutate({ id: entry.id, days: 30 })}
              onRevoke={() => revokeMutation.mutate(entry.id)}
            />
          ))}
        </div>
      )}

      {auditors && auditors.length > 0 && (
        <a href="/compliance/history" className="workspace-trust__audit-log">
          View audit access log &rarr;
        </a>
      )}
    </div>
  );

  if (embedded) return body;

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
      {body}
    </AccessCard>
  );
}
