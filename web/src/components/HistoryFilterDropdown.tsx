import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { HistoryMenuCheckmark } from "./HistoryMenuCheckmark";

type MenuPosition = { top: number; left: number; minWidth: number };

export type HistoryFilterOption = {
  value: string;
  label: string;
};

function FilterChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`history-filter-box__chevron${open ? " history-filter-box__chevron--open" : ""}`}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function HistoryFilterDropdown({
  label,
  value,
  options,
  onChange,
  boxClassName = "",
  ariaLabel,
  valueIcon,
  optionIcon,
  variant = "inline",
}: {
  label: string;
  value: string;
  options: HistoryFilterOption[];
  onChange: (value: string) => void;
  boxClassName?: string;
  ariaLabel: string;
  valueIcon?: ReactNode;
  optionIcon?: (optionValue: string) => ReactNode;
  variant?: "boxed" | "inline";
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value) ?? options[0];

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
            aria-label={ariaLabel}
            className="history-filter-menu"
            style={{ top: menuPos.top, left: menuPos.left, minWidth: menuPos.minWidth }}
          >
            <p className="history-filter-menu__heading">{label}</p>
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`history-filter-menu__option${active ? " history-filter-menu__option--active" : ""}`}
                >
                  <HistoryMenuCheckmark selected={active} className="history-filter-menu__check" />
                  {optionIcon?.(option.value)}
                  <span className="history-filter-menu__label">{option.label}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  const isInline = variant === "inline";

  return (
    <div
      ref={rootRef}
      className={[
        "history-filter-dropdown",
        isInline ? "history-filter-dropdown--inline" : "",
        boxClassName,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        ref={triggerRef}
        type="button"
        className={isInline ? "history-filter-inline" : "history-filter-box"}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${selected?.label ?? value}`}
      >
        {isInline ? (
          <>
            <span className="history-filter-inline__content">
              {valueIcon}
              <span className="history-filter-inline__value">{selected?.label ?? value}</span>
            </span>
            <FilterChevron open={open} />
          </>
        ) : (
          <>
            <span className="history-filter-box__label">{label}</span>
            <span className="history-filter-box__trail">
              <span className="history-filter-box__choice">
                {valueIcon}
                <span className="history-filter-box__selected">{selected?.label ?? value}</span>
              </span>
              <FilterChevron open={open} />
            </span>
          </>
        )}
      </button>
      {menu}
    </div>
  );
}
