import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { auditorVerifyUrl } from "../lib/appOrigin";
import { Select } from "./Select";
import { AccessCard, AccessRow, StatusPill, accessComposer, accessInput, accessPrimaryBtn } from "./accessUi";

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
    <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  );
}

function ShieldFootnoteIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
    </svg>
  );
}

function KebabIcon() {
  return (
    <svg fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}

function AuditorRowMenu({
  entry,
  statusTone,
  copyActive,
  onCopy,
  onExtend,
  onRevoke,
}: {
  entry: AuditorAccessEntry;
  statusTone: StatusTone;
  copyActive: boolean;
  onCopy: () => void;
  onExtend: () => void;
  onRevoke: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
          {entry.is_active && statusTone === "active" && (
            <>
              <button type="button" role="menuitem" onClick={() => { onCopy(); setMenuOpen(false); }}>
                {copyActive ? "Copied!" : "Copy link"}
              </button>
              <button type="button" role="menuitem" onClick={() => { onExtend(); setMenuOpen(false); }}>
                Extend 30 days
              </button>
            </>
          )}
          <button type="button" role="menuitem" className="is-danger" onClick={() => { onRevoke(); setMenuOpen(false); }}>
            Revoke
          </button>
        </div>
      )}
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

  if (embedded) {
    return (
      <div className="sharing-auditors-stack sharing-auditors-stack--split">
        <section className="sharing-auditor-card sharing-auditor-card--access">
          <header className="sharing-auditor-card__header sharing-auditor-card__header--hero">
            <div className="sharing-auditor-card__intro">
              <span className="sharing-well sharing-well--lock" aria-hidden>
                <LockIcon />
              </span>
              <div>
                <h3 className="sharing-auditor-card__title">Reviewer access</h3>
                <p className="sharing-trust-card__subtitle">Grant secure, time-limited access to private evidence.</p>
              </div>
            </div>
            <span className={`sharing-count-pill${activeCount ? " is-on" : ""}`}>
              {activeCount ? `${activeCount} active` : "None"}
            </span>
          </header>

          <div className="sharing-auditor-card__form sharing-auditor-card__form--inline">
            <label className="sharing-field sharing-field--email">
              <span className="sr-only">Reviewer email</span>
              <span className="sharing-input-shell">
                <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0-8.53 5.25a2.25 2.25 0 0 1-2.44 0L2.25 6.75" />
                </svg>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="auditor@firm.com"
                />
              </span>
            </label>

            <label className="sharing-field sharing-field--expiry">
              <span className="sr-only">Access expires</span>
              <span className="sharing-input-shell sharing-input-shell--select">
                <svg fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
                </svg>
                <Select
                  className="sharing-select-btn"
                  value={String(expiryDays)}
                  onChange={(v) => setExpiryDays(Number(v))}
                  options={[
                    { value: "7", label: "7 days" },
                    { value: "14", label: "14 days" },
                    { value: "30", label: "30 days" },
                    { value: "90", label: "90 days" },
                  ]}
                />
              </span>
            </label>

            <button
              type="button"
              onClick={() => inviteMutation.mutate()}
              disabled={inviteMutation.isPending || !email.trim()}
              className="sharing-btn sharing-btn--outline sharing-auditor-card__send"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.9} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.126A59.768 59.768 0 0 1 21.485 12 59.77 59.77 0 0 1 3.27 20.876L6 12Zm0 0h7.5" />
              </svg>
              {inviteMutation.isPending ? "Inviting…" : "Send invite"}
            </button>
          </div>

          {error && <p className="sharing-auditor-card__error">{error}</p>}
          {inviteNote && <p className="sharing-auditor-card__note">{inviteNote}</p>}

          <p className="sharing-auditor-card__footnote sharing-auditor-card__footnote--soft">
            <ShieldFootnoteIcon />
            Reviewers never see API keys or internal workspace details.
          </p>
        </section>

        <section className="sharing-auditor-card sharing-auditor-card--active-list">
          <header className="sharing-auditor-card__active-header sharing-auditor-card__active-header--hero">
            <div className="sharing-auditor-card__intro">
              <span className="sharing-well sharing-well--people" aria-hidden>
                <PeopleIcon />
              </span>
              <div>
                <h3 className="sharing-auditor-card__title">Active auditors</h3>
                <p className="sharing-trust-card__subtitle">Reviewers with current access.</p>
              </div>
            </div>
          </header>

          {isLoading && <p className="text-xs text-zinc-400">Loading…</p>}

          {auditors && auditors.length > 0 ? (
            <div className="sharing-auditor-list">
              {auditors.map((entry) => {
                const st = getStatus(entry);
                const expiry = new Date(entry.expires_at).toLocaleDateString();
                return (
                  <AccessRow
                    key={entry.id}
                    email={entry.email}
                    meta={<span>{entry.name ? `${entry.name} · ` : ""}Expires {expiry}</span>}
                    right={<StatusPill tone={st.tone}>{st.label}</StatusPill>}
                    actions={
                      <AuditorRowMenu
                        entry={entry}
                        statusTone={st.tone}
                        copyActive={copyToken === entry.access_token}
                        onCopy={() => copyLink(entry.access_token)}
                        onExtend={() => extendMutation.mutate({ id: entry.id, days: 30 })}
                        onRevoke={() => revokeMutation.mutate(entry.id)}
                      />
                    }
                  />
                );
              })}
            </div>
          ) : (
            !isLoading && <div className="sharing-auditor-card__empty">No auditor invites yet.</div>
          )}

          <a href="/compliance/history" className="sharing-auditor-card__log">
            View audit access log &rarr;
          </a>
        </section>
      </div>
    );
  }

  const inviteFields = (
    <>
      <label className="access-field access-field--email">
        <span>Email address</span>
        <span className="access-input-shell">
          <svg fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0-8.53 5.25a2.25 2.25 0 0 1-2.44 0L2.25 6.75" />
          </svg>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="auditor@firm.com" className={accessInput} />
        </span>
      </label>
      <label className="access-field">
        <span>Name (optional)</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Reviewer name" className={accessInput} />
      </label>
      <label className="access-field">
        <span>Access expiration</span>
        <Select
          className="access-select-btn"
          value={String(expiryDays)}
          onChange={(v) => setExpiryDays(Number(v))}
          options={[
            { value: "7", label: "7 days" },
            { value: "14", label: "14 days" },
            { value: "30", label: "30 days" },
            { value: "90", label: "90 days" },
          ]}
        />
      </label>
      <button type="button" onClick={() => inviteMutation.mutate()} disabled={inviteMutation.isPending || !email.trim()} className={accessPrimaryBtn}>
        {inviteMutation.isPending ? "Inviting…" : "Invite"}
        <svg fill="none" stroke="currentColor" strokeWidth={1.9} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.126A59.768 59.768 0 0 1 21.485 12 59.77 59.77 0 0 1 3.27 20.876L6 12Zm0 0h7.5" />
        </svg>
      </button>
    </>
  );

  return (
    <AccessCard
      title="External auditors"
      description="Temporary, scoped access to your evidence for outside reviewers and customers."
      status={activeCount > 0 ? <StatusPill tone="active">{activeCount} active</StatusPill> : <StatusPill tone="muted">None</StatusPill>}
    >
      <div className={accessComposer}>
        <span className="access-invite-card__icon" aria-hidden>
          <PeopleIcon />
        </span>
        <div className="access-invite-card__copy">
          <p className="access-invite-card__title">Invite an auditor</p>
          <p className="access-invite-card__description">
            Grant time-bound access to evidence packs. Auditors never see API keys or internal workspace details.
          </p>
        </div>
        <div className="access-invite-card__form">{inviteFields}</div>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {inviteNote && <p className="mt-2 text-xs text-zinc-600">{inviteNote}</p>}
      {isLoading && <p className="text-xs text-zinc-400">Loading…</p>}
      {auditors && auditors.length > 0 && (
        <div className="workspace-auditor__list">
          <p className="access-members-section__title">Active auditors</p>
          <div className="access-members-list">
            {auditors.map((entry) => {
              const st = getStatus(entry);
              const expiry = new Date(entry.expires_at).toLocaleDateString();
              return (
                <AccessRow
                  key={entry.id}
                  email={entry.email}
                  meta={<span>{entry.name || "Auditor"} · Expires {expiry}</span>}
                  right={<StatusPill tone={st.tone}>{st.label}</StatusPill>}
                  actions={
                    <AuditorRowMenu
                      entry={entry}
                      statusTone={st.tone}
                      copyActive={copyToken === entry.access_token}
                      onCopy={() => copyLink(entry.access_token)}
                      onExtend={() => extendMutation.mutate({ id: entry.id, days: 30 })}
                      onRevoke={() => revokeMutation.mutate(entry.id)}
                    />
                  }
                />
              );
            })}
          </div>
        </div>
      )}
      {auditors && auditors.length === 0 && !isLoading && <div className="workspace-auditor__empty">No auditor invites yet.</div>}
    </AccessCard>
  );
}
