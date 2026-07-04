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

const JIRA_BLUE = "#0C66E4";
const JIRA_BLUE_HOVER = "#0052CC";

const PRIORITIES = ["Highest", "High", "Medium", "Low"] as const;
type Priority = (typeof PRIORITIES)[number];

const triggerBase =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[10px] border px-3 text-[13px] font-semibold shadow-sm transition active:scale-[0.99]";

function defaultPriority(severity: string): Priority {
  if (severity === "critical") return "Highest";
  if (severity === "high") return "High";
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

function ChevronRightIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
    </svg>
  );
}

function PriorityIcon({ priority, className = "h-4 w-4" }: { priority: Priority; className?: string }) {
  const color =
    priority === "Highest"
      ? "#CD519D"
      : priority === "High"
        ? "#E56910"
        : priority === "Medium"
          ? "#E2B203"
          : "#57A55A";

  if (priority === "Highest") {
    return (
      <svg className={className} viewBox="0 0 16 16" fill={color} aria-hidden>
        <path d="M8 2.5l2.5 4H10l1.5 5.5L8 9.5 4.5 12 6 6.5H5.5L8 2.5z" />
        <path d="M8 1l3.5 5.5H9.5l1 6.5L8 10 5.5 13l1-6.5H4.5L8 1z" opacity="0.35" transform="translate(0,-1)" />
      </svg>
    );
  }
  if (priority === "High") {
    return (
      <svg className={className} viewBox="0 0 16 16" fill={color} aria-hidden>
        <path d="M8 3l3 5H9l1.5 5.5L8 10 5.5 13.5 7 8H5L8 3z" />
      </svg>
    );
  }
  if (priority === "Medium") {
    return (
      <svg className={className} viewBox="0 0 16 16" fill={color} aria-hidden>
        <rect x="3" y="7" width="10" height="2" rx="1" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 16 16" fill={color} aria-hidden>
      <path d="M8 13l-3-5h2L5.5 2.5 8 6l2.5-3.5L9 8h2l-3 5z" />
    </svg>
  );
}

function IssueTypeIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="#2684FF" aria-hidden>
      <path d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1zm6 1v3h3" fill="none" stroke="#2684FF" strokeWidth="1.2" />
      <path d="M5 8h6M5 10.5h4" stroke="#2684FF" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function UserAvatar({ user, size = "md" }: { user: JiraUser; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-[11px]";
  if (user.avatar_url) {
    return <img src={user.avatar_url} alt="" className={`${dim} rounded-full object-cover`} />;
  }
  return (
    <span
      className={`flex ${dim} items-center justify-center rounded-full bg-[#DFE1E6] font-semibold text-[#44546F]`}
    >
      {user.display_name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function FieldLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <span className="mb-1 block text-sm font-semibold text-[#44546F]">
      {children}
      {required ? <span className="ml-0.5 text-[#E34935]">*</span> : null}
    </span>
  );
}

const fieldInputClass =
  "w-full rounded-[3px] border border-[#DFE1E6] bg-white px-2 py-1.5 text-sm text-[#172B4D] outline-none transition placeholder:text-[#626F86] hover:border-[#B3BAC5] focus:border-[#0C66E4] focus:ring-2 focus:ring-[#0C66E4]/20";

function PrioritySelect({
  value,
  onChange,
}: {
  value: Priority;
  onChange: (priority: Priority) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`${fieldInputClass} flex items-center justify-between gap-2 text-left`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <PriorityIcon priority={value} />
          <span className="truncate">{value}</span>
        </span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-[#626F86]" />
      </button>
      {open ? (
        <ul
          role="listbox"
          aria-label="Priority"
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-[3px] border border-[#DFE1E6] bg-white py-1 shadow-lg"
        >
          {PRIORITIES.map((option) => (
            <li key={option} role="option" aria-selected={value === option}>
              <button
                type="button"
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-[#F4F5F7] ${
                  value === option ? "bg-[#E9F2FF] text-[#0C66E4]" : "text-[#172B4D]"
                }`}
              >
                <PriorityIcon priority={option} />
                <span>{option}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function JiraFindingAction({ finding, existing, onCreated, onRemove, className }: Props) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(() => defaultSummary(finding));
  const [priority, setPriority] = useState<Priority>(() => defaultPriority(finding.severity));
  const [riskLabelSelected, setRiskLabelSelected] = useState(false);
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [assignee, setAssignee] = useState<JiraUser | null>(null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const assigneeFieldRef = useRef<HTMLDivElement>(null);

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
    setPreviewOpen(false);
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

  const issueType = jira.issue_type || "Task";
  const projectKey = jira.project_key || "PROJECT";

  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => setOpen(true)}>
        <JiraIcon />
        Create ticket
      </button>
      {open
        ? createPortal(
            <div className="fixed inset-0 z-[240] flex items-center justify-center bg-[#091E42]/50 p-4">
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="jira-ticket-title"
                className="flex w-full max-w-[640px] flex-col overflow-hidden rounded-[3px] border border-[#DFE1E6] bg-white shadow-xl"
              >
                <div className="flex items-center justify-between border-b border-[#EBECF0] px-6 py-4">
                  <h2 id="jira-ticket-title" className="text-xl font-medium text-[#172B4D]">
                    Create issue
                  </h2>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-[3px] text-[#626F86] transition hover:bg-[#F4F5F7] hover:text-[#172B4D]"
                    aria-label="Close"
                  >
                    <span className="text-xl leading-none">×</span>
                  </button>
                </div>

                <div className="max-h-[min(70vh,640px)] overflow-y-auto px-6 py-4">
                  <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[#626F86]">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-semibold text-[#44546F]">Project</span>
                      <span className="rounded-[3px] bg-[#F4F5F7] px-1.5 py-0.5 font-medium text-[#172B4D]">
                        {projectKey}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-semibold text-[#44546F]">Issue type</span>
                      <span className="inline-flex items-center gap-1 rounded-[3px] bg-[#F4F5F7] px-1.5 py-0.5 font-medium text-[#172B4D]">
                        <IssueTypeIcon className="h-3.5 w-3.5" />
                        {issueType}
                      </span>
                    </span>
                  </div>

                  <div className="space-y-4">
                    <label className="block">
                      <FieldLabel required>Summary</FieldLabel>
                      <input
                        value={summary}
                        onChange={(event) => setSummary(event.target.value)}
                        className={fieldInputClass}
                        placeholder="Enter a summary"
                      />
                    </label>

                    <div>
                      <FieldLabel>Priority</FieldLabel>
                      <PrioritySelect value={priority} onChange={setPriority} />
                    </div>

                    <div ref={assigneeFieldRef}>
                      <FieldLabel>Assignee</FieldLabel>
                      <div className="relative">
                        {assignee ? (
                          <div
                            className={`${fieldInputClass} flex min-h-[36px] items-center gap-2 py-1 pl-1 pr-2`}
                          >
                            <span className="inline-flex min-w-0 flex-1 items-center gap-2 rounded-[3px] bg-[#F4F5F7] py-0.5 pl-0.5 pr-1.5">
                              <UserAvatar user={assignee} size="sm" />
                              <span className="truncate text-sm text-[#172B4D]">{assignee.display_name}</span>
                              <button
                                type="button"
                                onClick={clearAssignee}
                                className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[#626F86] hover:bg-[#DFE1E6] hover:text-[#172B4D]"
                                aria-label={`Remove ${assignee.display_name}`}
                              >
                                ×
                              </button>
                            </span>
                          </div>
                        ) : (
                          <>
                            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[#626F86]" />
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
                              placeholder="Search for a person"
                              autoComplete="off"
                              role="combobox"
                              aria-expanded={assigneeOpen}
                              aria-controls="jira-assignee-suggestions"
                              className={`${fieldInputClass} py-1.5 pl-8 pr-8`}
                            />
                            <button
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => setAssigneeOpen((value) => !value)}
                              className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[3px] text-[#626F86] hover:bg-[#F4F5F7]"
                              aria-label="Toggle assignee suggestions"
                            >
                              <ChevronDownIcon className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {assigneeOpen && !assignee ? (
                          <div
                            id="jira-assignee-suggestions"
                            role="listbox"
                            aria-label="Assignable Jira users"
                            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-[3px] border border-[#DFE1E6] bg-white py-1 shadow-lg"
                          >
                            {usersLoading ? (
                              <p className="px-3 py-2 text-sm text-[#626F86]">Loading assignable users…</p>
                            ) : usersError ? (
                              <p className="px-3 py-2 text-sm text-[#E34935]">{formatApiError(usersError)}</p>
                            ) : users.length ? (
                              users.map((user) => (
                                <button
                                  key={user.account_id}
                                  type="button"
                                  role="option"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => selectAssignee(user)}
                                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-[#F4F5F7]"
                                >
                                  <UserAvatar user={user} />
                                  <span className="min-w-0">
                                    <span className="block truncate text-sm text-[#172B4D]">{user.display_name}</span>
                                    {user.email ? (
                                      <span className="block truncate text-xs text-[#626F86]">{user.email}</span>
                                    ) : null}
                                  </span>
                                </button>
                              ))
                            ) : (
                              <p className="px-3 py-2 text-sm text-[#626F86]">
                                {assigneeQuery.trim()
                                  ? "No matching Jira users."
                                  : "No assignable users found for this project."}
                              </p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div>
                      <FieldLabel>Labels</FieldLabel>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-[3px] border border-[#DFE1E6] bg-[#F4F5F7] px-2 py-0.5 text-xs font-medium text-[#44546F]">
                          veritrail
                        </span>
                        <span className="inline-flex items-center rounded-[3px] border border-[#DFE1E6] bg-[#F4F5F7] px-2 py-0.5 text-xs font-medium text-[#44546F]">
                          {finding.severity}
                        </span>
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-[3px] border border-[#DFE1E6] bg-white px-2 py-1 text-sm text-[#172B4D] hover:bg-[#F4F5F7]">
                          <input
                            type="checkbox"
                            checked={riskLabelSelected}
                            onChange={(event) => setRiskLabelSelected(event.target.checked)}
                            className="h-3.5 w-3.5 rounded border-[#DFE1E6] text-[#0C66E4] focus:ring-[#0C66E4]"
                          />
                          <span>risk</span>
                        </label>
                      </div>
                    </div>

                    <div className="border-t border-[#EBECF0] pt-2">
                      <button
                        type="button"
                        onClick={() => setPreviewOpen((value) => !value)}
                        className="flex w-full items-center gap-2 rounded-[3px] py-2 text-left text-sm font-semibold text-[#44546F] hover:bg-[#F4F5F7]"
                        aria-expanded={previewOpen}
                      >
                        <ChevronRightIcon
                          className={`h-4 w-4 shrink-0 text-[#626F86] transition-transform ${previewOpen ? "rotate-90" : ""}`}
                        />
                        Preview description
                      </button>
                      {previewOpen ? (
                        <div className="mb-2 space-y-3 rounded-[3px] border border-[#EBECF0] bg-[#FAFBFC] p-3">
                          {preview.map((item) => (
                            <div key={item.label}>
                              <p className="text-xs font-semibold text-[#626F86]">{item.label}</p>
                              <p className="mt-0.5 break-words text-sm leading-5 text-[#172B4D]">{item.value}</p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                {create.error ? (
                  <div className="border-t border-[#FFEDEB] bg-[#FFEDEB] px-6 py-2.5 text-sm text-[#AE2E24]">
                    {formatApiError(create.error)}
                  </div>
                ) : null}

                <div className="flex items-center justify-end gap-2 border-t border-[#EBECF0] px-6 py-3">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-[3px] px-3 py-1.5 text-sm font-medium text-[#44546F] transition hover:bg-[#F4F5F7] hover:text-[#172B4D]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={create.isPending || !summary.trim()}
                    onClick={() => create.mutate()}
                    className="rounded-[3px] px-3 py-1.5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ backgroundColor: create.isPending || !summary.trim() ? "#B3BAC5" : JIRA_BLUE }}
                    onMouseEnter={(event) => {
                      if (!create.isPending && summary.trim()) {
                        event.currentTarget.style.backgroundColor = JIRA_BLUE_HOVER;
                      }
                    }}
                    onMouseLeave={(event) => {
                      if (!create.isPending && summary.trim()) {
                        event.currentTarget.style.backgroundColor = JIRA_BLUE;
                      }
                    }}
                  >
                    {create.isPending ? "Creating…" : "Create"}
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
