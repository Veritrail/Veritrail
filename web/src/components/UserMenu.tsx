import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { logout } from "../api";
import { userDisplayName, userInitials } from "../lib/displayNames";

export default function UserMenu({ email }: { email: string }) {
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
    <div ref={ref} className="user-menu">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="user-menu__trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account menu for ${name}`}
      >
        <span className="user-menu__avatar">{initials}</span>
      </button>

      {open ? (
        <div className="user-menu__dropdown" role="menu">
          <Link to="/profile" role="menuitem" className="user-menu__item" onClick={() => setOpen(false)}>
            Profile
          </Link>
          <button
            type="button"
            role="menuitem"
            className="user-menu__item user-menu__item--danger"
            onClick={() => {
              setOpen(false);
              void logout().finally(() => {
                window.location.href = "/login?signed_out=1";
              });
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
