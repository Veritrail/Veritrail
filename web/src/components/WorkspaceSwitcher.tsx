import { useEffect, useRef, useState } from "react";
import "../styles/workspace-switcher.css";

export type WorkspaceEntry = { org_id: string; org_name: string; role: string };

function BuildingIcon() {
  return (
    <svg className="workspace-switcher__glyph" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
      />
    </svg>
  );
}

/**
 * Workspace (org) switcher rendered in the app header.
 */
export function WorkspaceSwitcher({
  title = "Workspace",
  workspaces,
  currentOrgId,
  onSwitch,
  pending,
}: {
  title?: string;
  workspaces: WorkspaceEntry[];
  currentOrgId: string;
  onSwitch: (id: string) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  if (workspaces.length === 0) return null;
  const current = workspaces.find((w) => w.org_id === currentOrgId) ?? workspaces[0];
  const canSwitch = workspaces.length > 1;

  return (
    <div
      ref={ref}
      className="workspace-switcher"
      style={pending ? { opacity: 0.6, pointerEvents: "none" } : undefined}
    >
      <div className="workspace-switcher__card">
        <span className="workspace-switcher__icon" aria-hidden>
          <BuildingIcon />
        </span>

        <div className="workspace-switcher__body">
          <button
            type="button"
            onClick={() => canSwitch && setOpen((o) => !o)}
            disabled={!canSwitch}
            aria-expanded={canSwitch ? open : undefined}
            aria-label={canSwitch ? "Switch workspace" : undefined}
            className="workspace-switcher__trigger"
          >
            <span className="workspace-switcher__title">{title}</span>
            {canSwitch ? (
              <span className={`workspace-switcher__chevron${open ? " is-open" : ""}`} aria-hidden>
                <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                </svg>
              </span>
            ) : null}
          </button>

          <p className="workspace-switcher__crumb">
            <span>Workspace</span>
            <span className="workspace-switcher__crumb-sep" aria-hidden>
              ·
            </span>
            <span className="workspace-switcher__crumb-org">{current.org_name}</span>
          </p>
        </div>
      </div>

      {open && canSwitch && (
        <div className="workspace-switcher__menu" role="menu">
          {workspaces.map((w) => {
            const active = w.org_id === currentOrgId;
            return (
              <button
                key={w.org_id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  if (!active) onSwitch(w.org_id);
                }}
                className="workspace-switcher__menu-item"
              >
                <span className="min-w-0 flex-1">
                  <span className="workspace-switcher__menu-item-name">{w.org_name}</span>
                  <span className="workspace-switcher__menu-item-role">{w.role}</span>
                </span>
                {active ? (
                  <svg className="workspace-switcher__menu-item-check" fill="none" stroke="currentColor" strokeWidth={2.25} viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
