import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { logout } from "../api";
import { formatOrgRole } from "../hooks/useMe";
import { userDisplayName, userInitials } from "../lib/displayNames";

const SUPPORT_EMAIL = "elazar.chodjayev@cloud-castles.com";
const PLACEHOLDER_PLAN = "Enterprise Plan";

function BuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
      />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="m18 15-6-6-6 6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
    </svg>
  );
}

type SidebarUserCardProps = {
  email: string;
  orgName: string;
  /** Workspace role from GET /v1/auth/me (`role`). */
  role?: string;
  /** Placeholder until billing/plan API exists. */
  planLabel?: string;
};

/**
 * Sidebar footer identity card: compact trigger opening an upward panel
 * with signed-in user, workspace, navigation, and sign out.
 */
export default function SidebarUserCard({
  email,
  orgName,
  role,
  planLabel = PLACEHOLDER_PLAN,
}: SidebarUserCardProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = userDisplayName(email);
  const initials = userInitials(email);
  const roleLabel = formatOrgRole(role);

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

  const signOut = () => {
    close();
    void logout().finally(() => {
      window.location.href = "/login?signed_out=1";
    });
  };

  return (
    <div className="app-sidebar__user" ref={ref}>
      {open ? (
        <div className="sidebar-user-panel" role="menu">
          <button
            type="button"
            className="sidebar-user-panel__section sidebar-user-panel__section--user"
            onClick={close}
            aria-label="Close user menu"
          >
            <span className="sidebar-user-panel__row">
              <span className="sidebar-user-panel__avatar" aria-hidden>
                {initials}
              </span>
              <span className="sidebar-user-panel__copy">
                <span className="sidebar-user-panel__name">{name}</span>
                {roleLabel ? <span className="sidebar-user-panel__subtitle">{roleLabel}</span> : null}
              </span>
              <span className="sidebar-user-panel__chevron sidebar-user-panel__chevron--up">
                <ChevronUpIcon />
              </span>
            </span>
          </button>

          <div className="sidebar-user-panel__divider" role="separator" />

          <Link
            to="/workspace"
            role="menuitem"
            className="sidebar-user-panel__section sidebar-user-panel__section--workspace"
            onClick={close}
          >
            <span className="sidebar-user-panel__row">
              <span className="sidebar-user-panel__workspace-icon" aria-hidden>
                <BuildingIcon />
              </span>
              <span className="sidebar-user-panel__copy">
                <span className="sidebar-user-panel__workspace-name-row">
                  <span className="sidebar-user-panel__name">{orgName}</span>
                  <span className="sidebar-user-panel__status" aria-label="Active" />
                </span>
                <span className="sidebar-user-panel__subtitle">{planLabel}</span>
              </span>
              <span className="sidebar-user-panel__chevron sidebar-user-panel__chevron--right">
                <ChevronRightIcon />
              </span>
            </span>
          </Link>

          <div className="sidebar-user-panel__divider" role="separator" />

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
            <Link to="/workspace" role="menuitem" className="sidebar-user-panel__menu-item" onClick={close}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
              Account settings
            </Link>
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Veritrail support request")}`}
              role="menuitem"
              className="sidebar-user-panel__menu-item"
              onClick={close}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z"
                />
              </svg>
              Help &amp; support
            </a>
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
        <span className="app-sidebar__workspace-avatar" aria-hidden>
          {initials}
        </span>
        <span className="app-sidebar__workspace-copy">
          <span className="app-sidebar__workspace-name">{name}</span>
          <span className="app-sidebar__workspace-plan" title={email}>
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
