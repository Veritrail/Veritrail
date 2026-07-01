import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type FindingsStatus = "open" | "excepted" | "resolved" | "all";

const STATUS_OPTIONS: { id: FindingsStatus; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "excepted", label: "Exceptions" },
  { id: "resolved", label: "Resolved" },
  { id: "all", label: "All" },
];

type MenuPosition = { top: number; left: number; minWidth: number };

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
  const label = STATUS_OPTIONS.find((o) => o.id === value)?.label ?? "Open";

  const updateMenuPosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 6,
      left: rect.left,
      minWidth: Math.max(rect.width, 168),
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
            className="fixed z-[120] overflow-hidden rounded-xl border border-[#e2e8f0] bg-white py-1 shadow-lg shadow-zinc-900/10"
            style={{ top: menuPos.top, left: menuPos.left, minWidth: menuPos.minWidth }}
          >
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
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold transition ${
                    active ? "bg-teal-50/70 text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                    {active ? (
                      <svg className="h-3.5 w-3.5 text-teal-600" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : null}
                  </span>
                  {option.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        id="findings-status-filter"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Status: ${label}`}
        className="findings-v2-filter-trigger findings-v2-status-trigger"
      >
        <span className="truncate">{label}</span>
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-[#98a2b3] transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {menu}
    </div>
  );
}
