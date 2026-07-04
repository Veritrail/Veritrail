import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, formatApiError } from "../api";
import { jiraIntegrationSchema } from "../lib/apiSchemas";
import { displayFindingTitle } from "../lib/findingDisplay";
import { INTEGRATION_BRAND } from "../lib/integrationBrands";

type JiraIssue = { issue_key: string; issue_url: string };

type JiraUser = {
  account_id: string;
  display_name: string;
  email?: string;
  avatar_url?: string;
};

type FindingSummary = {
  id: string;
  check_id: string;
  resource_arn: string;
  title: string;
  severity: string;
  risk_score: number;
  account_label?: string | null;
};

type Props = {
  finding: FindingSummary;
  existing?: { issue_key?: string; issue_url?: string } | null;
  onCreated?: (issue: JiraIssue) => void;
  onRemove?: () => void;
  className?: string;
};

const triggerBase =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[10px] border px-3 text-[13px] font-semibold shadow-sm transition active:scale-[0.99]";

function defaultPriority(severity: string): string {
  if (severity === "critical" || severity === "high") return "High";
  if (severity === "low") return "Low";
  return "Medium";
}

function resourceName(arn: string): string {
  const value = arn.trim();
  if (!value) return "Affected resource";
  return value.split("/").pop()?.split(":").pop() || value;
}

function defaultSummary(finding: FindingSummary): string {
  return `[Veritrail] ${resourceName(finding.resource_arn)} — ${displayFindingTitle(finding.title)}`;
}

function remediationCopy(finding: FindingSummary): string {
  if (finding.check_id.includes("least_privilege")) {
    return "Replace broad IAM permissions with least-privilege policies scoped to observed usage. Remove wildcard Action:* and Resource:* access unless explicitly required and approved.";
  }
  if (finding.check_id.includes("mfa")) {
    return "Enable MFA for the affected identity, then re-scan the account to confirm the finding is resolved.";
  }
  if (finding.check_id.includes("logging") || finding.check_id.includes("cloudtrail")) {
    return "Enable the missing logging coverage, verify events are being collected, then re-scan in Veritrail.";
  }
  return "Apply the remediation guidance in Veritrail, then verify the fix from the finding drawer.";
}

function JiraIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <img
      src={INTEGRATION_BRAND.jira.compactSrc ?? INTEGRATION_BRAND.jira.src}
      alt=""
      aria-hidden
      className={`${className} rounded-[3px] object-contain`}
      draggable={false}
    />
  );
}

function FlagIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1v12z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 22v-7" />
    </svg>
  );
}

function ShieldIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
      />
    </svg>
  );
}

function SearchIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <circle cx="11" cy="11" r="8" />
      <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function ChevronDownIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
    </svg>
  );
}

function DocumentIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  );
}

function UserAvatar({ user, size = "md" }: { user: JiraUser; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-6 w-6 text-[10px]" : "h-7 w-7 text-xs";
  if (user.avatar_url) {
    return <img src={user.avatar_url} alt="" className={`${dim} rounded-full object-cover`} />;
  }
  return (
    <span
      className={`flex ${dim} items-center justify-center rounded-full bg-sky-100 font-bold text-sky-700`}
    >
      {user.display_name.slice(0, 1)}
    </span>
  );
}

function LabelChip({
  selected,
  onClick,
  icon,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition ${
        selected
          ? "border-[#439385] bg-[#439385]/10 text-[#2d6a61] shadow-sm shadow-[#439385]/10"
          : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

export function JiraFindingAction({ finding, existing, onCreated, onRemove, className }: Props) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(() => defaultSummary(finding));
  const [priority, setPriority] = useState(() => defaultPriority(finding.severity));
  const [riskLabelSelected, setRiskLabelSelected] = useState(false);
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [assignee, setAssignee] = useState<JiraUser | null>(null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const assigneeFieldRef = useRef<HTMLDivElement>(null);

  const highLabelSelected = priority === "High" || priority === "Highest";

  const issueLabels = useMemo(() => {
    const labels = ["veritrail", finding.severity];
    if (riskLabelSelected) labels.push("risk");
    return labels;
  }, [finding.severity, riskLabelSelected]);

  useEffect(() => {
    setOpen(false);
    setSummary(defaultSummary(finding));
    setPriority(defaultPriority(finding.severity));
    setRiskLabelSelected(false);
    setAssigneeQuery("");
    setAssignee(null);
    setAssigneeOpen(false);
  }, [finding.id, finding.severity]);

  useEffect(() => {
    if (!open) setAssigneeOpen(false);
  }, [open]);

  const { data: jira } = useQuery({
    queryKey: ["jira-integration"],
    queryFn: () => api("/v1/integrations/jira", { schema: jiraIntegrationSchema }),
    staleTime: 60_000,
  });

  const {
    data: users = [],
    isFetching: usersLoading,
    error: usersError,
  } = useQuery({
    queryKey: ["jira-assignable-users", assigneeQuery.trim()],
    queryFn: () =>
      api<JiraUser[]>(
        `/v1/integrations/jira/assignable-users?query=${encodeURIComponent(assigneeQuery.trim())}`,
      ),
    enabled: open && !!jira?.connected && assigneeOpen,
    staleTime: 30_000,
  });

  const create = useMutation({
    mutationFn: () =>
      api<JiraIssue>(`/v1/integrations/jira/issues/from-finding/${finding.id}`, {
        method: "POST",
        body: JSON.stringify({
          summary,
          priority,
          assignee_account_id: assignee?.account_id,
          labels: issueLabels,
        }),
      }),
    onSuccess: (issue) => {
      onCreated?.(issue);
      setOpen(false);
    },
  });

  const preview = useMemo(
    () => [
      { label: "Opened from", value: "Veritrail finding drawer" },
      { label: "Severity", value: `${finding.severity.toUpperCase()} · Risk score ${finding.risk_score}` },
      { label: "Check", value: finding.check_id },
      { label: "Resource", value: finding.resource_arn },
      { label: "Recommended remediation", value: remediationCopy(finding) },
      {
        label: "Verification",
        value: "Apply the fix, return to Veritrail, and run Verify fix before closing this ticket.",
      },
    ],
    [finding],
  );

  function toggleHighLabel() {
    if (highLabelSelected) {
      const fallback = defaultPriority(finding.severity);
      setPriority(fallback === "High" ? "Medium" : fallback);
      return;
    }
    setPriority("High");
  }

  function clearAssignee() {
    setAssignee(null);
    setAssigneeQuery("");
    setAssigneeOpen(true);
  }

  function selectAssignee(user: JiraUser) {
    setAssignee(user);
    setAssigneeQuery("");
    setAssigneeOpen(false);
  }

  if (!jira?.connected) return null;
  const triggerClassName =
    className ?? `${triggerBase} border-sky-200 bg-white text-sky-800 hover:border-sky-300 hover:bg-sky-50`;

  if (existing?.issue_key && existing.issue_url) {
    return (
      <div className="flex shrink-0 items-center gap-1.5">
        <a
          href={existing.issue_url}
          target="_blank"
          rel="noreferrer"
          className={triggerClassName}
          title="Open Jira remediation ticket"
        >
          <JiraIcon />
          Jira {existing.issue_key}
        </a>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-sky-200 bg-white text-sky-700 transition hover:bg-sky-50"
            aria-label="Remove Jira ticket link"
          >
            ×
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => setOpen(true)}
      >
        <JiraIcon />
        Create ticket
      </button>
      {open
        ? createPortal(
            <div className="fixed inset-0 z-[240] flex items-center justify-center bg-zinc-950/45 p-4 backdrop-blur-[2px]">
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="jira-ticket-title"
                className="flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-950/20"
              >
                <div className="border-b border-zinc-200 px-6 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700">
                        <JiraIcon className="h-3.5 w-3.5" />
                        Jira ticket
                      </p>
                      <h3 id="jira-ticket-title" className="mt-1 text-xl font-bold tracking-tight text-zinc-950">
                        Review remediation ticket
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-zinc-600">
                        Adjust ownership and ticket metadata before Veritrail creates the Jira issue.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-lg text-zinc-500 hover:bg-zinc-50"
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="grid max-h-[70vh] gap-6 overflow-y-auto px-6 py-5 md:grid-cols-[1fr_1fr]">
                  <div className="space-y-5">
                    <label className="block">
                      <span className="text-xs font-semibold text-zinc-700">Summary</span>
                      <input
                        value={summary}
                        onChange={(event) => setSummary(event.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm font-medium text-zinc-900 outline-none transition focus:border-[#439385] focus:ring-4 focus:ring-[#439385]/10"
                      />
                    </label>
                    <div>
                      <span className="text-xs font-semibold text-zinc-700">Priority labels</span>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <LabelChip selected={highLabelSelected} onClick={toggleHighLabel} icon={<FlagIcon />}>
                          High
                        </LabelChip>
                        <LabelChip
                          selected={riskLabelSelected}
                          onClick={() => setRiskLabelSelected((value) => !value)}
                          icon={<ShieldIcon />}
                        >
                          Risk
                        </LabelChip>
                      </div>
                    </div>
                    <div ref={assigneeFieldRef}>
                      <span className="text-xs font-semibold text-zinc-700">Assignee</span>
                      <div className="relative mt-1.5">
                        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                        <input
                          value={assigneeQuery}
                          onChange={(event) => setAssigneeQuery(event.target.value)}
                          onFocus={() => setAssigneeOpen(true)}
                          onBlur={() => {
                            window.setTimeout(() => {
                              if (!assigneeFieldRef.current?.contains(document.activeElement)) {
                                setAssigneeOpen(false);
                              }
                            }, 0);
                          }}
                          placeholder="Search users or teams..."
                          autoComplete="off"
                          role="combobox"
                          aria-expanded={assigneeOpen}
                          aria-controls="jira-assignee-suggestions"
                          className="w-full rounded-xl border border-zinc-200 py-2.5 pl-10 pr-10 text-sm font-medium text-zinc-900 outline-none transition focus:border-[#439385] focus:ring-4 focus:ring-[#439385]/10"
                        />
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => setAssigneeOpen((value) => !value)}
                          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600"
                          aria-label="Toggle assignee suggestions"
                        >
                          <ChevronDownIcon />
                        </button>
                        {assigneeOpen ? (
                          <div
                            id="jira-assignee-suggestions"
                            role="listbox"
                            aria-label="Assignable Jira users"
                            className="absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg shadow-zinc-950/10"
                          >
                            {usersLoading ? (
                              <p className="px-3 py-2.5 text-sm text-zinc-500">Loading assignable users…</p>
                            ) : usersError ? (
                              <p className="px-3 py-2.5 text-sm text-red-600">{formatApiError(usersError)}</p>
                            ) : users.length ? (
                              users.map((user) => (
                                <button
                                  key={user.account_id}
                                  type="button"
                                  role="option"
                                  aria-selected={assignee?.account_id === user.account_id}
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => selectAssignee(user)}
                                  className="flex w-full items-center gap-3 border-b border-zinc-100 px-3 py-2.5 text-left last:border-b-0 hover:bg-sky-50/70"
                                >
                                  <UserAvatar user={user} />
                                  <span className="min-w-0">
                                    <span className="block text-sm font-semibold text-zinc-900">{user.display_name}</span>
                                    {user.email ? (
                                      <span className="block truncate text-xs text-zinc-500">{user.email}</span>
                                    ) : null}
                                  </span>
                                </button>
                              ))
                            ) : (
                              <p className="px-3 py-2.5 text-sm text-zinc-500">
                                {assigneeQuery.trim() ? "No matching Jira users." : "No assignable users found for this project."}
                              </p>
                            )}
                          </div>
                        ) : null}
                      </div>
                      {assignee ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 py-1 pl-1 pr-2 text-[13px] font-medium text-zinc-800">
                            <UserAvatar user={assignee} size="sm" />
                            <span className="max-w-[180px] truncate">{assignee.display_name}</span>
                            <button
                              type="button"
                              onClick={clearAssignee}
                              className="flex h-5 w-5 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600"
                              aria-label={`Remove ${assignee.display_name}`}
                            >
                              ×
                            </button>
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50/40 p-4 md:sticky md:top-0 md:self-start">
                    <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                      <DocumentIcon className="h-3.5 w-3.5" />
                      Ticket preview
                    </p>
                    <div className="mt-4 space-y-4">
                      {preview.map((item) => (
                        <div key={item.label}>
                          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-400">{item.label}</p>
                          <p className="mt-1 break-words text-sm leading-5 text-zinc-800">{item.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                {create.error ? (
                  <div className="border-t border-red-100 bg-red-50 px-6 py-3 text-sm font-medium text-red-700">
                    {formatApiError(create.error)}
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-6 py-4">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={create.isPending || !summary.trim()}
                    onClick={() => create.mutate()}
                    className="inline-flex h-10 items-center justify-center rounded-xl bg-[#439385] px-4 text-sm font-semibold text-white shadow-sm shadow-[#439385]/20 transition hover:bg-[#367a6f] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {create.isPending ? "Creating..." : "Create ticket"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
