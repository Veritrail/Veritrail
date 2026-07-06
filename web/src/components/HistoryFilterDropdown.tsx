import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { FrameworkMark } from "./FrameworkMark";
import { HistoryMenuCheckmark } from "./HistoryMenuCheckmark";
import { GroupSelectorIcon, PeriodSelectorIcon, SelectorCard, type SelectorCardIconTone } from "./SelectorCard";

type MenuPosition = { top: number; left: number; minWidth: number };

export type HistoryFilterOption = {
  value: string;
  label: string;
};

function defaultIconForLabel(label: string, selectedValue: string): ReactNode {
  if (label === "Period") return <PeriodSelectorIcon />;
  if (label === "Group") return <GroupSelectorIcon />;
  if (label === "Framework") {
    return <FrameworkMark framework={selectedValue} className="selector-card__framework-mark" />;
  }
  return null;
}

function defaultOptionIcon(label: string, optionValue: string): ReactNode {
  if (label === "Framework") {
    return <FrameworkMark framework={optionValue} className="history-filter-menu__icon" />;
  }
  return null;
}

function iconToneForLabel(label: string): SelectorCardIconTone {
  if (label === "Period") return "period";
  if (label === "Framework") return "framework";
  if (label === "Group") return "group";
  return "neutral";
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
}: {
  label: string;
  value: string;
  options: HistoryFilterOption[];
  onChange: (value: string) => void;
  boxClassName?: string;
  ariaLabel: string;
  valueIcon?: ReactNode;
  optionIcon?: (optionValue: string) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value) ?? options[0];
  const triggerIcon = valueIcon ?? defaultIconForLabel(label, value);

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
                  {optionIcon?.(option.value) ?? defaultOptionIcon(label, option.value)}
                  <span className="history-filter-menu__label">{option.label}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className={["history-filter-dropdown", boxClassName].filter(Boolean).join(" ")}>
      <SelectorCard
        ref={triggerRef}
        icon={triggerIcon}
        label={label}
        value={selected?.label ?? value}
        iconTone={iconToneForLabel(label)}
        open={open}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${selected?.label ?? value}`}
      />
      {menu}
    </div>
  );
}
