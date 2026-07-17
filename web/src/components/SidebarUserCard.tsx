import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { logout } from "../api";
import {
  formatSidebarAccountsCount,
  formatSidebarAccountsStatus,
  getSidebarAccountsBarFill,
} from "../hooks/useAccountsPlanUsage";
import { resolveUserDisplayName } from "../lib/displayNames";

const NULL_AVATAR_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.65} aria-hidden>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 19.5a7.5 7.5 0 0 1 15 0v.75H4.5v-.75Z"
    />
  </svg>
);

type SidebarUserCardProps = {
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  orgName: string;
  /** Workspace role from GET /v1/auth/me (`role`). */
  role?: string;
  /** Workspace plan from GET /v1/accounts/plan-usage (`plan_label`). */
  planLabel?: string;
  used?: number;
  maxAccounts?: number | null;
  planLoading?: boolean;
};

/**
 * Sidebar footer identity card: compact trigger opening an upward panel
 * with signed-in user, workspace, navigation, and sign out.
 */
export default function SidebarUserCard({
  email,
  displayName,
  avatarUrl,
  orgName,
  planLabel,
  used = 0,
  maxAccounts = null,
  planLoading = false,
}: SidebarUserCardProps) {
  const [open, setOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = resolveUserDisplayName(email, displayName);
  const trimmedAvatarUrl = avatarUrl?.trim() ?? "";
  const showAvatar = Boolean(trimmedAvatarUrl) && !avatarFailed;

  useEffect(() => {
    setAvatarFailed(false);
  }, [trimmedAvatarUrl]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  const showAccountsBar = planLoading || planLabel != null;
  const accountsCount = planLoading ? "…" : formatSidebarAccountsCount(used, maxAccounts);
  const accountsBarFill = getSidebarAccountsBarFill(used, maxAccounts);
  const accountsUnlimited = !planLoading && maxAccounts == null;
  const accountsAriaLabel = planLoading
    ? "Accounts connected, loading"
    : formatSidebarAccountsStatus(used, maxAccounts, planLabel);

  const signOut = () => {
    close();
    void logout().finally(() => {
      window.location.href = "/login";
    });
  };

  return (
    <div className="app-sidebar__user" ref={ref}>
      {showAccountsBar ? (
        <div
          className={[
            "app-sidebar__accounts-status",
            planLoading ? "app-sidebar__accounts-status--loading" : "",
            accountsUnlimited ? "app-sidebar__accounts-status--unlimited" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          role="progressbar"
          aria-busy={planLoading || undefined}
          aria-label={accountsAriaLabel}
          aria-valuemin={0}
          aria-valuemax={maxAccounts ?? undefined}
          aria-valuenow={planLoading ? undefined : used}
          aria-valuetext={planLoading ? undefined : accountsCount}
        >
          <div className="app-sidebar__accounts-status-row">
            <span className="app-sidebar__accounts-status-label">Accounts connected</span>
            <span className="app-sidebar__accounts-status-count">{accountsCount}</span>
          </div>
          <div className="app-sidebar__accounts-status-track">
            {planLoading ? (
              <div className="app-sidebar__accounts-status-fill app-sidebar__accounts-status-fill--indeterminate" />
            ) : (
              <div
                className="app-sidebar__accounts-status-fill"
                style={{ width: `${accountsBarFill}%` }}
              />
            )}
          </div>
        </div>
      ) : null}

      {open ? (
        <div className="sidebar-user-panel" role="menu">
          <div className="sidebar-user-panel__menu">
            <Link to="/profile" role="menuitem" className="sidebar-user-panel__menu-item" onClick={close}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 19.5a7.5 7.5 0 0 1 15 0v.75H4.5v-.75Z"
                />
              </svg>
              View profile
            </Link>
          </div>

          <div className="sidebar-user-panel__divider" role="separator" />

          <button type="button" role="menuitem" className="sidebar-user-panel__sign-out" onClick={signOut}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75"
              />
            </svg>
            Sign out
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className="app-sidebar__workspace-card"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className={`app-sidebar__workspace-avatar${showAvatar ? " app-sidebar__workspace-avatar--photo" : ""}`}
          aria-hidden
        >
          {showAvatar ? (
            <img src={trimmedAvatarUrl} alt="" onError={() => setAvatarFailed(true)} />
          ) : (
            NULL_AVATAR_ICON
          )}
        </span>
        <span className="app-sidebar__workspace-copy">
          <span className="app-sidebar__workspace-name">{name}</span>
          <span className="app-sidebar__workspace-org" title={email}>
            {orgName}
          </span>
        </span>
        <svg
          className="app-sidebar__user-chevron"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}
