import { useNavigate, useLocation } from "react-router-dom";
import { orgInitials } from "../lib/displayNames";

export default function SidebarWorkspaceCard({
  orgName,
  planLabel,
}: {
  orgName: string;
  planLabel?: string | null;
}) {
  const nav = useNavigate();
  const location = useLocation();
  const onWorkspace = location.pathname === "/workspace" || location.pathname.startsWith("/workspace/");

  return (
    <button
      type="button"
      onClick={() => nav("/workspace")}
      className="app-sidebar__workspace-card"
      aria-current={onWorkspace ? "page" : undefined}
    >
      <span className="app-sidebar__workspace-avatar" aria-hidden>
        {orgInitials(orgName)}
      </span>
      <span className="app-sidebar__workspace-copy">
        <span className="app-sidebar__workspace-name">{orgName}</span>
        <span className="app-sidebar__workspace-plan">{planLabel ?? "Workspace"}</span>
      </span>
      <svg
        className="app-sidebar__workspace-chevron"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );
}
