import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { ListPagination } from "./ListPagination";
import { auditLogPageSchema, type AuditLogEntry } from "../lib/apiSchemas";

const PAGE_SIZE = 15;

/** Human label per audit action. Falls back to a de-slugged version. */
const ACTION_LABELS: Record<string, string> = {
  "account.created": "Connected an AWS account",
  "account.removed": "Removed an AWS account",
  "account.capabilities_updated": "Updated account capabilities",
  "org.settings_updated": "Updated workspace settings",
  "member.invited": "Invited a member",
  "member.invite_revoked": "Revoked an invite",
  "member.invite_accepted": "Accepted an invite",
  "member.role_changed": "Changed a member's role",
  "member.removed": "Removed a member",
  "domain.added": "Added a company domain",
  "domain.verified": "Verified a company domain",
  "domain.removed": "Removed a company domain",
  "domain.auto_join_enabled": "Enabled domain auto-join",
  "domain.auto_join_disabled": "Disabled domain auto-join",
  "member.join_request_approved": "Approved a join request",
  "member.domain_auto_join": "Member joined via domain",
  "trust.access_requested": "Compliance report requested",
};

/** Dot tone per action prefix — quiet visual grouping, no heavy color. */
function toneFor(action: string): string {
  if (action.startsWith("account.removed") || action.startsWith("member.removed")) return "bg-rose-400";
  if (action.startsWith("account.")) return "bg-emerald-400";
  if (action.startsWith("member.")) return "bg-blue-400";
  if (action.startsWith("org.")) return "bg-amber-400";
  return "bg-zinc-300";
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, " ");
}

function relativeTime(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Concise secondary line: target + a couple of detail facts. */
function secondaryLine(e: AuditLogEntry): string {
  const parts: string[] = [];
  if (e.target_label) parts.push(e.target_label);
  const d = e.detail || {};
  if (typeof d.email === "string") parts.push(d.email);
  if (typeof d.role === "string") parts.push(`role: ${d.role}`);
  if (d.from && d.to) parts.push(`${d.from} → ${d.to}`);
  if (Array.isArray(d.sections) && d.sections.length) parts.push(d.sections.join(", "));
  return parts.join(" · ");
}

export function WorkspaceActivity() {
  const [page, setPage] = useState(1);
  const offset = (page - 1) * PAGE_SIZE;

  const q = useQuery({
    queryKey: ["audit-log", page],
    queryFn: () =>
      api(`/v1/audit-log?limit=${PAGE_SIZE}&offset=${offset}`, { schema: auditLogPageSchema }),
    staleTime: 30_000,
  });

  if (q.isLoading) {
    return <p className="text-sm text-zinc-500">Loading activity…</p>;
  }
  if (q.isError) {
    return (
      <p className="text-sm text-zinc-500">
        Only workspace admins can view the activity log.
      </p>
    );
  }

  const entries = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (total === 0) {
    return <p className="text-sm text-zinc-500">No privileged activity recorded yet.</p>;
  }

  return (
    <div className="workspace-activity-panel">
      <div className="workspace-activity-body">
        <ul className="workspace-activity-list">
          {entries.map((e) => {
            const sub = secondaryLine(e);
            return (
              <li key={e.id} className="workspace-activity-item">
                <span className={`workspace-activity-item__dot ${toneFor(e.action)}`} aria-hidden />
                <div className="workspace-activity-item__copy">
                  <p className="workspace-activity-item__title">{actionLabel(e.action)}</p>
                  <p className="workspace-activity-item__meta">
                    {e.actor_email ?? "System"}
                    {sub ? ` · ${sub}` : ""}
                  </p>
                </div>
                <span className="workspace-activity-item__time">{relativeTime(e.created_at)}</span>
              </li>
            );
          })}
        </ul>

        <ListPagination
          variant="card"
          page={page}
          totalPages={totalPages}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPage={setPage}
          itemLabel="activities"
        />
      </div>
    </div>
  );
}
