import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { HistoryMenuCheckmark } from "./HistoryMenuCheckmark";
import { SelectorCard } from "./SelectorCard";
import "../styles/history-page.css";

export type FindingsStatus = "open" | "excepted" | "resolved" | "all";

const STATUS_OPTIONS: { id: FindingsStatus; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "excepted", label: "Exceptions" },
  { id: "resolved", label: "Resolved" },
  { id: "all", label: "All" },
];

type MenuPosition = { top: number; left: number };

export function FindingsStatusSelect({
  value,
  onChange,
}: {
  value: FindingsStatus;
  onChange: (next: FindingsStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = STATUS_OPTIONS.find((o) => o.id === value) ?? STATUS_OPTIONS[0];

  const updateMenuPosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 6,
      left: rect.left,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPosition();
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    function onScrollOrResize() {
      updateMenuPosition();
    }
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const menu =
    open && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label="Finding status"
            className="history-filter-menu"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            <p className="history-filter-menu__heading">Status</p>
            {STATUS_OPTIONS.map((option) => {
              const active = option.id === value;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                  className={`history-filter-menu__option${active ? " history-filter-menu__option--active" : ""}`}
                >
                  <HistoryMenuCheckmark selected={active} className="history-filter-menu__check" />
                  <span className="history-filter-menu__label">{option.label}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="history-filter-dropdown history-filter-dropdown--status shrink-0">
      <SelectorCard
        ref={triggerRef}
        id="findings-status-filter"
        label="Status"
        value={selected.label}
        iconTone="neutral"
        open={open}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Status: ${selected.label}`}
      />
      {menu}
    </div>
  );
}
