import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { logout } from "../api";
import { userDisplayName, userInitials } from "../lib/displayNames";

/**
 * Sidebar footer identity card: avatar + name + subtitle, opening an upward
 * menu with Profile + Sign out. Replaces the old workspace card.
 */
export default function SidebarUserCard({ email, subtitle = email }: { email: string; subtitle?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = userDisplayName(email);
  const initials = userInitials(email);

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

  return (
    <div className="app-sidebar__user" ref={ref}>
      {open ? (
        <div className="app-sidebar__user-menu" role="menu">
          <Link
            to="/profile"
            role="menuitem"
            className="app-sidebar__user-menu-item"
            onClick={() => setOpen(false)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 19.5a7.5 7.5 0 0 1 15 0v.75H4.5v-.75Z" />
            </svg>
            Profile
          </Link>
          <button
            type="button"
            role="menuitem"
            className="app-sidebar__user-menu-item app-sidebar__user-menu-item--danger"
            onClick={() => {
              setOpen(false);
              void logout().finally(() => {
                window.location.href = "/login?signed_out=1";
              });
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
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
          <span className="app-sidebar__workspace-plan" title={email}>{subtitle}</span>
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
