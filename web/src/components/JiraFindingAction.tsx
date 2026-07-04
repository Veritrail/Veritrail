import { useEffect, useMemo, useRef, useState } from "react";
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

function defaultLabels(severity: string): string {
  return `veritrail, ${severity}`;
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

export function JiraFindingAction({ finding, existing, onCreated, onRemove, className }: Props) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(() => defaultSummary(finding));
  const [priority, setPriority] = useState(() => defaultPriority(finding.severity));
  const [labels, setLabels] = useState(() => defaultLabels(finding.severity));
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [assignee, setAssignee] = useState<JiraUser | null>(null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const assigneeFieldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
    setSummary(defaultSummary(finding));
    setPriority(defaultPriority(finding.severity));
    setLabels(defaultLabels(finding.severity));
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
    enabled: open && !!jira?.connected && assigneeOpen && !assignee,
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
          labels: labels
            .split(",")
            .map((label) => label.trim())
            .filter(Boolean),
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
                className="w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-950/20"
              >
                <div className="border-b border-zinc-200 px-6 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-sky-700">
                        <JiraIcon className="h-4 w-4" />
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
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div className="grid max-h-[70vh] gap-5 overflow-y-auto px-6 py-5 md:grid-cols-[1.05fr_0.95fr]">
                  <div className="space-y-4">
                    <label className="block">
                      <span className="text-xs font-semibold text-zinc-700">Summary</span>
                      <input
                        value={summary}
                        onChange={(event) => setSummary(event.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm font-medium text-zinc-900 outline-none transition focus:border-[#439385] focus:ring-4 focus:ring-[#439385]/10"
                      />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-xs font-semibold text-zinc-700">Priority</span>
                        <select
                          value={priority}
                          onChange={(event) => setPriority(event.target.value)}
                          className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-medium text-zinc-900 outline-none transition focus:border-[#439385] focus:ring-4 focus:ring-[#439385]/10"
                        >
                          <option>Highest</option>
                          <option>High</option>
                          <option>Medium</option>
                          <option>Low</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold text-zinc-700">Labels</span>
                        <input
                          value={labels}
                          onChange={(event) => setLabels(event.target.value)}
                          className="mt-1.5 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm font-medium text-zinc-900 outline-none transition focus:border-[#439385] focus:ring-4 focus:ring-[#439385]/10"
                        />
                      </label>
                    </div>
                    <div ref={assigneeFieldRef} className="relative">
                      <label className="block">
                        <span className="text-xs font-semibold text-zinc-700">Assignee</span>
                        {assignee ? (
                          <div className="mt-1.5 flex items-center gap-3 rounded-xl border border-sky-200 bg-sky-50/60 px-3 py-2.5">
                            {assignee.avatar_url ? (
                              <img src={assignee.avatar_url} alt="" className="h-7 w-7 rounded-full" />
                            ) : (
                              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">
                                {assignee.display_name.slice(0, 1)}
                              </span>
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-zinc-900">{assignee.display_name}</span>
                              {assignee.email ? (
                                <span className="block truncate text-xs text-zinc-500">{assignee.email}</span>
                              ) : null}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setAssignee(null);
                                setAssigneeQuery("");
                                setAssigneeOpen(true);
                              }}
                              className="text-xs font-semibold text-sky-700 hover:text-sky-900"
                            >
                              Clear
                            </button>
                          </div>
                        ) : (
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
                            placeholder="Search Jira users..."
                            autoComplete="off"
                            role="combobox"
                            aria-expanded={assigneeOpen}
                            aria-controls="jira-assignee-suggestions"
                            className="mt-1.5 w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm font-medium text-zinc-900 outline-none transition focus:border-[#439385] focus:ring-4 focus:ring-[#439385]/10"
                          />
                        )}
                      </label>
                      {assigneeOpen && !assignee ? (
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
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                  setAssignee(user);
                                  setAssigneeQuery("");
                                  setAssigneeOpen(false);
                                }}
                                className="flex w-full items-center gap-3 border-b border-zinc-100 px-3 py-2.5 text-left last:border-b-0 hover:bg-sky-50/70"
                              >
                                {user.avatar_url ? (
                                  <img src={user.avatar_url} alt="" className="h-7 w-7 rounded-full" />
                                ) : (
                                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">
                                    {user.display_name.slice(0, 1)}
                                  </span>
                                )}
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
                  </div>
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Ticket content</p>
                    <div className="mt-3 space-y-3">
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
                <div className="flex items-center justify-end gap-3 border-t border-zinc-200 bg-zinc-50 px-6 py-4">
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
