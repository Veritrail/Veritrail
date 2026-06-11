import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { HistoryMenuCheckmark } from "./HistoryMenuCheckmark";

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

type MenuPosition = { top: number; left: number; minWidth: number };

export function HistoryPageSizeDropdown({
  value,
  defaultSize = 15,
  onChange,
}: {
  value: number;
  defaultSize?: number;
  onChange: (size: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updateMenuPosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 6,
      left: rect.right,
      minWidth: 112,
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
            aria-label="Events per page"
            className="history-page-size-menu"
            style={{ top: menuPos.top, left: menuPos.left, minWidth: menuPos.minWidth, transform: "translateX(-100%)" }}
          >
            {PAGE_SIZE_OPTIONS.map((size) => {
              const active = value === size;
              return (
                <button
                  key={size}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(active ? defaultSize : size);
                    setOpen(false);
                  }}
                  className={`history-page-size-menu__option${active ? " history-page-size-menu__option--active" : ""}`}
                >
                  <HistoryMenuCheckmark selected={active} className="history-page-size-menu__check" />
                  Show {size}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  const customized = value !== defaultSize;

  return (
    <div ref={rootRef} className="history-page-size-dropdown">
      {customized ? (
        <button
          type="button"
          className="history-page-size-clear"
          onClick={() => {
            onChange(defaultSize);
            setOpen(false);
          }}
          aria-label={`Clear page size filter (back to ${defaultSize})`}
        >
          Clear
        </button>
      ) : null}
      <button
        ref={triggerRef}
        type="button"
        className={`history-page-size-trigger${open ? " history-page-size-trigger--open" : ""}${customized ? " history-page-size-trigger--active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Showing ${value} events per page`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 5h16l-6 7v5l-4 2v-7L4 5z"
          />
        </svg>
      </button>
      {menu}
    </div>
  );
}
