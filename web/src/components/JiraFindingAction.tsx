import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

type JiraProject = {
  key: string;
  name: string;
  id?: string;
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

const PRIORITIES = ["Highest", "High", "Medium", "Low", "Lowest"] as const;
type Priority = (typeof PRIORITIES)[number];

const triggerBase =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[10px] border px-3 text-[13px] font-semibold shadow-sm transition active:scale-[0.99]";

const LABEL_COLORS: Record<string, { bg: string; text: string }> = {
  veritrail: { bg: "#E3FCEF", text: "#216E4E" },
  critical: { bg: "#FFEDEB", text: "#AE2E24" },
  high: { bg: "#F3D0FF", text: "#5E4DB2" },
  medium: { bg: "#FFF7D6", text: "#974F0C" },
  low: { bg: "#E9F2FF", text: "#0055CC" },
  risk: { bg: "#DFE1E6", text: "#44546F" },
};

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

function labelPillStyle(name: string): { bg: string; text: string } {
  return LABEL_COLORS[name.toLowerCase()] ?? { bg: "#DFE1E6", text: "#44546F" };
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
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

function GearIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path d="M19.14 12.94a7.43 7.43 0 000-1.88l2.03-1.58a.5.5 0 00.12-.64l-1.92-3.32a.5.5 0 00-.6-.22l-2.39.96a7.28 7.28 0 00-1.63-.94l-.36-2.54a.5.5 0 00-.5-.42h-3.84a.5.5 0 00-.5.42l-.36 2.54a7.28 7.28 0 00-1.63.94l-2.39-.96a.5.5 0 00-.6.22L2.71 8.84a.5.5 0 00.12.64l2.03 1.58a7.43 7.43 0 000 1.88l-2.03 1.58a.5.5 0 00-.12.64l1.92 3.32a.5.5 0 00.6.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54a.5.5 0 00.5.42h3.84a.5.5 0 00.5-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96a.5.5 0 00.6-.22l1.92-3.32a.5.5 0 00-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1112 8.5a3.5 3.5 0 010 7z" />
    </svg>
  );
}

/** Jira priority glyphs — Atlassian chevron shapes with Jira issue-create colors */
export function JiraPriorityIcon({ priority, className = "h-4 w-4" }: { priority: Priority; className?: string }) {
  const red = "#E34935";
  const redLight = "#FF7452";
  const orange = "#E56910";
  const blue = "#0065FF";
  const blueLight = "#2684FF";

  if (priority === "Highest") {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden>
        <path
          fill={red}
          d="M12.005 8.187l-6.453 3.865a1 1 0 01-1.028-1.716l6.97-4.174a1 1 0 011.031.002l6.906 4.174a1 1 0 11-1.035 1.712l-6.39-3.863z"
        />
        <path
          fill={redLight}
          d="M5.552 18.054a1 1 0 11-1.028-1.715l6.97-4.174a1 1 0 011.031.002l6.906 4.174a1 1 0 11-1.035 1.711l-6.39-3.862-6.454 3.864z"
        />
      </svg>
    );
  }
  if (priority === "High") {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden>
        <path
          fill={red}
          d="M12.017 11.182l-6.454 3.865a1 1 0 11-1.027-1.716l6.97-4.174a1 1 0 011.03.003l6.906 4.173a1 1 0 01-1.035 1.712l-6.39-3.863z"
        />
      </svg>
    );
  }
  if (priority === "Medium") {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden>
        <path
          fill={orange}
          d="M5 8h14a1 1 0 010 2H5a1 1 0 110-2zm0 6h14a1 1 0 010 2H5a1 1 0 010-2z"
        />
      </svg>
    );
  }
  if (priority === "Low") {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden>
        <path
          fill={blue}
          d="M11.996 13.861l6.454-3.865a1 1 0 111.027 1.716l-6.97 4.174a1 1 0 01-1.03-.002L4.57 11.71A1 1 0 015.606 10l6.39 3.862z"
        />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill={blue}
        d="M18.46 11.936a1 1 0 111.028 1.716l-6.97 4.174a1 1 0 01-1.03-.002L4.581 13.65a1 1 0 011.034-1.711l6.391 3.862 6.454-3.865z"
      />
      <path
        fill={blueLight}
        d="M12.007 9.798l6.454-3.864a1 1 0 011.027 1.716l-6.97 4.173a1 1 0 01-1.03-.002L4.581 7.648a1 1 0 011.034-1.712l6.391 3.862z"
      />
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
  const dim = size === "sm" ? "h-6 w-6 text-[10px]" : "h-6 w-6 text-[11px]";
  if (user.avatar_url) {
    return <img src={user.avatar_url} alt="" className={`${dim} rounded-full object-cover`} />;
  }
  return (
    <span
      className={`flex ${dim} items-center justify-center rounded-full font-semibold text-white`}
      style={{ backgroundColor: JIRA_BLUE }}
    >
      {initialsFromName(user.display_name)}
    </span>
  );
}

function UnassignedAvatar({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <span
      className={`flex ${className} items-center justify-center rounded-full bg-[#DFE1E6] text-[#626F86]`}
      aria-hidden
    >
      <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-4.42 0-8 1.79-8 4v1h16v-1c0-2.21-3.58-4-8-4z" />
      </svg>
    </span>
  );
}

function JiraLabelPill({ label }: { label: string }) {
  const colors = labelPillStyle(label);
  return (
    <span
      className="inline-flex max-w-full items-center rounded-[3px] px-1.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

function DetailsRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,38%)_minmax(0,1fr)] items-start gap-x-4 gap-y-1 py-1.5">
      <span className="pt-0.5 text-sm text-[#626F86]">{label}</span>
      <div className="relative min-h-[28px] min-w-0 overflow-visible text-sm text-[#172B4D]">{children}</div>
    </div>
  );
}

function CollapsibleSection({
  title,
  open,
  onToggle,
  trailing,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-[#EBECF0]">
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-3 text-left text-sm font-semibold text-[#44546F] hover:text-[#172B4D]"
          aria-expanded={open}
        >
          <ChevronRightIcon
            className={`h-4 w-4 shrink-0 text-[#626F86] transition-transform ${open ? "rotate-90" : ""}`}
          />
          {title}
        </button>
        {trailing ? <div className="shrink-0 pr-1 text-[#626F86]">{trailing}</div> : null}
      </div>
      {open ? <div className="pb-3 pl-5">{children}</div> : null}
    </section>
  );
}

function PrioritySelect({
  value,
  onChange,
}: {
  value: Priority;
  onChange: (priority: Priority) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<Priority | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const dropdownOptions = PRIORITIES.filter((option) => option !== value);

  return (
    <div ref={ref} className="relative w-full max-w-[220px]">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex w-full items-center justify-between gap-2 rounded-[3px] border bg-white px-2 py-1.5 text-left text-[14px] leading-5 text-[#172B4D] transition-colors ${
          open
            ? "border-[#0C66E4] ring-2 ring-[#0C66E4]/20"
            : "border-[#DFE1E6] hover:border-[#B3BAC5]"
        }`}
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <JiraPriorityIcon priority={value} className="h-4 w-4 shrink-0" />
          <span className="truncate">{value}</span>
        </span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-[#626F86]" />
      </button>
      {open ? (
        <ul
          role="listbox"
          aria-label="Priority"
          className="absolute left-0 top-full z-50 mt-1 w-full min-w-[180px] overflow-hidden rounded-[3px] border border-[#DFE1E6] bg-white py-1 shadow-[0_4px_8px_-2px_rgba(9,30,66,0.25),0_0_1px_rgba(9,30,66,0.31)]"
        >
          {dropdownOptions.map((option) => (
            <li key={option} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseEnter={() => setHovered(option)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 border-l-[3px] px-2 py-1.5 text-left text-[14px] leading-5 text-[#172B4D] ${
                  hovered === option
                    ? "border-l-[#0C66E4] bg-[#F4F5F7]"
                    : "border-l-transparent hover:border-l-[#0C66E4] hover:bg-[#F4F5F7]"
                }`}
              >
                <JiraPriorityIcon priority={option} className="h-4 w-4 shrink-0" />
                <span>{option}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ProjectSelect({
  value,
  projects,
  loading,
  onChange,
}: {
  value: string;
  projects: JiraProject[];
  loading: boolean;
  onChange: (projectKey: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const selected = projects.find((project) => project.key === value);
  const dropdownOptions = projects.filter((project) => project.key !== value);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div ref={ref} className="relative w-full max-w-[280px]">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={loading || !projects.length}
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex w-full items-center justify-between gap-2 rounded-[3px] border bg-white px-2 py-1.5 text-left text-[14px] leading-5 text-[#172B4D] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          open
            ? "border-[#0C66E4] ring-2 ring-[#0C66E4]/20"
            : "border-[#DFE1E6] hover:border-[#B3BAC5]"
        }`}
      >
        <span className="min-w-0 truncate">
          {loading ? "Loading projects…" : selected ? `${selected.key} — ${selected.name}` : value}
        </span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-[#626F86]" />
      </button>
      {open && dropdownOptions.length ? (
        <ul
          role="listbox"
          aria-label="Project"
          className="absolute left-0 top-full z-50 mt-1 max-h-56 w-full min-w-[220px] overflow-y-auto rounded-[3px] border border-[#DFE1E6] bg-white py-1 shadow-[0_4px_8px_-2px_rgba(9,30,66,0.25),0_0_1px_rgba(9,30,66,0.31)]"
        >
          {dropdownOptions.map((project) => (
            <li key={project.key} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseEnter={() => setHovered(project.key)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => {
                  onChange(project.key);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 border-l-[3px] px-2 py-1.5 text-left text-[14px] leading-5 text-[#172B4D] ${
                  hovered === project.key
                    ? "border-l-[#0C66E4] bg-[#F4F5F7]"
                    : "border-l-transparent hover:border-l-[#0C66E4] hover:bg-[#F4F5F7]"
                }`}
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium">{project.key}</span>
                  <span className="text-[#626F86]"> — {project.name}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function JiraFindingAction({ finding, existing, onCreated, onRemove, className }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(() => defaultSummary(finding));
  const [priority, setPriority] = useState<Priority>(() => defaultPriority(finding.severity));
  const [selectedProject, setSelectedProject] = useState("");
  const [riskLabelSelected, setRiskLabelSelected] = useState(false);
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [assignee, setAssignee] = useState<JiraUser | null>(null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const assigneeFieldRef = useRef<HTMLDivElement>(null);
  const assigneeInputRef = useRef<HTMLInputElement>(null);

  const issueLabels = useMemo(() => {
    const labels = ["veritrail", finding.severity];
    if (riskLabelSelected) labels.push("risk");
    return labels;
  }, [finding.severity, riskLabelSelected]);

  useEffect(() => {
    setOpen(false);
    setSummary(defaultSummary(finding));
    setPriority(defaultPriority(finding.severity));
    setSelectedProject("");
    setRiskLabelSelected(false);
    setAssigneeQuery("");
    setAssignee(null);
    setAssigneeOpen(false);
    setDescriptionOpen(true);
    setDetailsOpen(true);
  }, [finding.id, finding.severity]);

  const { data: jira } = useQuery({
    queryKey: ["jira-integration"],
    queryFn: () => api("/v1/integrations/jira", { schema: jiraIntegrationSchema }),
    staleTime: 60_000,
  });

  const defaultProjectKey = jira?.project_key?.trim() || "";

  useEffect(() => {
    if (!defaultProjectKey) return;
    setSelectedProject((current) => current || defaultProjectKey);
  }, [defaultProjectKey]);

  useEffect(() => {
    if (!open) setAssigneeOpen(false);
  }, [open]);

  useEffect(() => {
    if (!assigneeOpen || assignee) return;
    assigneeInputRef.current?.focus();
  }, [assigneeOpen, assignee]);

  const integrationEmail = jira?.email?.trim() || "";
  const activeProjectKey = selectedProject || defaultProjectKey;

  const {
    data: projects = [],
    isFetching: projectsLoading,
    error: projectsError,
  } = useQuery({
    queryKey: ["jira-projects"],
    queryFn: () => api<JiraProject[]>("/v1/integrations/jira/projects"),
    enabled: open && !!jira?.connected,
    staleTime: 60_000,
  });

  const setDefaultProject = useMutation({
    mutationFn: (projectKey: string) =>
      api("/v1/integrations/jira", {
        method: "PUT",
        body: JSON.stringify({
          site_url: jira?.site_url,
          email: jira?.email,
          project_key: projectKey,
          issue_type: jira?.issue_type || "Task",
        }),
      }),
    onSuccess: (saved) => {
      qc.setQueryData(["jira-integration"], saved);
    },
  });

  const { data: integrationUser } = useQuery({
    queryKey: ["jira-integration-user", integrationEmail, activeProjectKey],
    queryFn: async () => {
      const users = await api<JiraUser[]>(
        `/v1/integrations/jira/assignable-users?query=${encodeURIComponent(integrationEmail)}&project=${encodeURIComponent(activeProjectKey)}`,
      );
      const exact = users.find((user) => user.email?.toLowerCase() === integrationEmail.toLowerCase());
      return exact ?? users[0] ?? null;
    },
    enabled: open && !!jira?.connected && !!integrationEmail && !!activeProjectKey,
    staleTime: 60_000,
  });

  const reporter: JiraUser = useMemo(() => {
    if (integrationUser) return integrationUser;
    const local = integrationEmail.split("@")[0] || "Reporter";
    return {
      account_id: "",
      display_name: local.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      email: integrationEmail,
    };
  }, [integrationEmail, integrationUser]);

  const {
    data: users = [],
    isFetching: usersLoading,
    error: usersError,
  } = useQuery({
    queryKey: ["jira-assignable-users", activeProjectKey, assigneeQuery.trim()],
    queryFn: () =>
      api<JiraUser[]>(
        `/v1/integrations/jira/assignable-users?query=${encodeURIComponent(assigneeQuery.trim())}&project=${encodeURIComponent(activeProjectKey)}`,
      ),
    enabled: open && !!jira?.connected && !!activeProjectKey && assigneeOpen && !assignee,
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
          project_key: activeProjectKey,
        }),
      }),
    onSuccess: (issue) => {
      onCreated?.(issue);
      setOpen(false);
    },
  });

  const descriptionText = useMemo(() => {
    const lines = [
      "Opened from Veritrail finding drawer",
      `Severity: ${finding.severity.toUpperCase()} · Risk score ${finding.risk_score}`,
      `Check: ${finding.check_id}`,
      `Resource: ${finding.resource_arn}`,
      "",
      "Recommended remediation",
      remediationCopy(finding),
      "",
      "Verification",
      "Apply the fix, return to Veritrail, and run Verify fix before closing this ticket.",
    ];
    return lines.join("\n");
  }, [finding]);

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

  function selectProject(projectKey: string) {
    setSelectedProject(projectKey);
    setAssignee(null);
    setAssigneeQuery("");
    setAssigneeOpen(false);
  }

  function assignToMe() {
    if (integrationUser) {
      selectAssignee(integrationUser);
      return;
    }
    setAssigneeOpen(true);
    if (integrationEmail) setAssigneeQuery(integrationEmail);
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
  const projectKey = activeProjectKey || "PROJECT";
  const showSetDefault =
    !!activeProjectKey && !!defaultProjectKey && activeProjectKey !== defaultProjectKey;

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
                className="flex w-full max-w-[760px] flex-col overflow-hidden rounded-[3px] border border-[#DFE1E6] bg-white shadow-xl"
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

                <div className="max-h-[min(75vh,720px)] overflow-y-auto px-6">
                  <div className="flex flex-wrap items-center gap-2 py-4 text-sm text-[#626F86]">
                    <span className="font-medium" style={{ color: JIRA_BLUE }}>
                      {projectKey}
                    </span>
                    <span aria-hidden>/</span>
                    <span className="inline-flex items-center gap-1.5 text-[#172B4D]">
                      <IssueTypeIcon className="h-4 w-4" />
                      {issueType}
                    </span>
                  </div>

                  <label className="block border-b border-[#EBECF0] pb-4">
                    <span className="sr-only">Summary</span>
                    <input
                      value={summary}
                      onChange={(event) => setSummary(event.target.value)}
                      className="w-full border-0 bg-transparent p-0 text-2xl font-medium leading-tight text-[#172B4D] outline-none placeholder:text-[#626F86] focus:ring-0"
                      placeholder="What needs to be done?"
                      autoFocus
                    />
                  </label>

                  <CollapsibleSection
                    title="Description"
                    open={descriptionOpen}
                    onToggle={() => setDescriptionOpen((value) => !value)}
                  >
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[#172B4D]">
                      {descriptionText}
                    </p>
                  </CollapsibleSection>

                  <CollapsibleSection
                    title="Details"
                    open={detailsOpen}
                    onToggle={() => setDetailsOpen((value) => !value)}
                    trailing={<GearIcon className="h-4 w-4" />}
                  >
                    <div className="space-y-0.5 overflow-visible">
                      <DetailsRow label="Assignee">
                        <div ref={assigneeFieldRef} className="relative w-full max-w-[320px]">
                          {assignee ? (
                            <div className="inline-flex max-w-full items-center gap-2">
                              <UserAvatar user={assignee} size="sm" />
                              <span className="truncate">{assignee.display_name}</span>
                              <button
                                type="button"
                                onClick={clearAssignee}
                                className="shrink-0 text-[#626F86] hover:text-[#172B4D]"
                                aria-label={`Remove ${assignee.display_name}`}
                              >
                                ×
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setAssigneeOpen(true)}
                                className="inline-flex items-center gap-2 rounded-[3px] px-0.5 py-0.5 hover:bg-[#F4F5F7]"
                              >
                                <UnassignedAvatar />
                                <span className="text-[#172B4D]">Unassigned</span>
                              </button>
                              <button
                                type="button"
                                onClick={assignToMe}
                                className="text-sm font-medium hover:underline"
                                style={{ color: JIRA_BLUE }}
                              >
                                Assign to me
                              </button>
                            </div>
                          )}
                          {assigneeOpen && !assignee ? (
                            <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-[280px] overflow-hidden rounded-[3px] border border-[#DFE1E6] bg-white shadow-[0_4px_8px_-2px_rgba(9,30,66,0.25),0_0_1px_rgba(9,30,66,0.31)]">
                              <input
                                ref={assigneeInputRef}
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
                                className="w-full border-0 border-b border-[#DFE1E6] bg-white px-2 py-1.5 text-sm text-[#172B4D] outline-none transition placeholder:text-[#626F86] focus:border-[#0C66E4] focus:ring-2 focus:ring-inset focus:ring-[#0C66E4]/20"
                              />
                              <div
                                id="jira-assignee-suggestions"
                                role="listbox"
                                aria-label="Assignable Jira users"
                                className="max-h-48 overflow-y-auto py-1"
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
                                      className="flex w-full items-center gap-2 border-l-2 border-l-transparent px-2 py-1.5 text-left hover:border-l-[#0C66E4] hover:bg-[#F4F5F7]"
                                    >
                                      <UserAvatar user={user} size="sm" />
                                      <span className="min-w-0">
                                        <span className="block truncate text-sm text-[#172B4D]">
                                          {user.display_name}
                                        </span>
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
                            </div>
                          ) : null}
                        </div>
                      </DetailsRow>

                      <DetailsRow label="Priority">
                        <PrioritySelect value={priority} onChange={setPriority} />
                      </DetailsRow>

                      <DetailsRow label="Labels">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <JiraLabelPill label="veritrail" />
                          <JiraLabelPill label={finding.severity} />
                          {riskLabelSelected ? <JiraLabelPill label="risk" /> : null}
                          <button
                            type="button"
                            onClick={() => setRiskLabelSelected((value) => !value)}
                            className="rounded-[3px] px-1 py-0.5 text-xs font-medium hover:bg-[#F4F5F7]"
                            style={{ color: JIRA_BLUE }}
                          >
                            {riskLabelSelected ? "− risk" : "+ risk"}
                          </button>
                        </div>
                      </DetailsRow>

                      <DetailsRow label="Project">
                        <div className="space-y-1">
                          <ProjectSelect
                            value={activeProjectKey}
                            projects={projects}
                            loading={projectsLoading}
                            onChange={selectProject}
                          />
                          {projectsError ? (
                            <p className="text-xs text-[#E34935]">{formatApiError(projectsError)}</p>
                          ) : null}
                          {showSetDefault ? (
                            <button
                              type="button"
                              disabled={setDefaultProject.isPending}
                              onClick={() => setDefaultProject.mutate(activeProjectKey)}
                              className="text-xs font-medium hover:underline disabled:opacity-60"
                              style={{ color: JIRA_BLUE }}
                            >
                              {setDefaultProject.isPending ? "Saving default…" : "Set as default"}
                            </button>
                          ) : null}
                          {setDefaultProject.error ? (
                            <p className="text-xs text-[#E34935]">{formatApiError(setDefaultProject.error)}</p>
                          ) : null}
                        </div>
                      </DetailsRow>

                      <DetailsRow label="Issue type">
                        <span className="inline-flex items-center gap-1.5">
                          <IssueTypeIcon className="h-4 w-4" />
                          {issueType}
                        </span>
                      </DetailsRow>

                      <DetailsRow label="Reporter">
                        <span className="inline-flex max-w-full items-center gap-2">
                          <UserAvatar user={reporter} size="sm" />
                          <span className="truncate">{reporter.display_name}</span>
                        </span>
                      </DetailsRow>
                    </div>
                  </CollapsibleSection>
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
                    disabled={create.isPending || !summary.trim() || !activeProjectKey}
                    onClick={() => create.mutate()}
                    className="rounded-[3px] px-3 py-1.5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ backgroundColor: create.isPending || !summary.trim() || !activeProjectKey ? "#B3BAC5" : JIRA_BLUE }}
                    onMouseEnter={(event) => {
                      if (!create.isPending && summary.trim() && activeProjectKey) {
                        event.currentTarget.style.backgroundColor = JIRA_BLUE_HOVER;
                      }
                    }}
                    onMouseLeave={(event) => {
                      if (!create.isPending && summary.trim() && activeProjectKey) {
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
