import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type MenuPosition = { top: number; left: number; minWidth: number };

function checkLabel(tag: string, checkLabels: Record<string, string>): string {
  return checkLabels[tag] ?? tag;
}

export function formatCheckFilterSummary(
  tags: string[],
  checkLabels: Record<string, string>,
  maxNames = 3,
): string {
  const names = tags.map((tag) => checkLabel(tag, checkLabels));
  if (names.length <= maxNames) return names.join(", ");
  const shown = names.slice(0, maxNames).join(", ");
  return `${shown} +${names.length - maxNames} more`;
}

export function FindingsChecksFilter({
  tags,
  checkLabels,
  onChange,
}: {
  tags: string[];
  checkLabels: Record<string, string>;
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const count = tags.length;
  const label = count === 1 ? "Checks 1" : `Checks ${count}`;

  const updateMenuPosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 6,
      left: rect.left,
      minWidth: Math.max(rect.width, 280),
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

  if (count === 0) return null;

  const menu =
    open && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label="Active check filters"
            className="findings-v2-checks-popover fixed z-[120] overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-lg shadow-zinc-900/10"
            style={{ top: menuPos.top, left: menuPos.left, minWidth: menuPos.minWidth }}
          >
            <div className="findings-v2-checks-popover__header">
              <span className="findings-v2-checks-popover__title">
                {count === 1 ? "1 check filter" : `${count} check filters`}
              </span>
              <button
                type="button"
                className="findings-v2-checks-popover__clear"
                onClick={() => {
                  onChange([]);
                  setOpen(false);
                }}
              >
                Clear all
              </button>
            </div>
            <ul className="findings-v2-checks-popover__list" role="list">
              {tags.map((tag) => {
                const name = checkLabel(tag, checkLabels);
                return (
                  <li key={tag} className="findings-v2-checks-popover__item">
                    <span className="findings-v2-checks-popover__item-label">{name}</span>
                    <button
                      type="button"
                      className="findings-v2-checks-popover__remove"
                      aria-label={`Remove ${name} filter`}
                      onClick={() => onChange(tags.filter((t) => t !== tag))}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label} active`}
        className="findings-v2-filter-trigger findings-v2-checks-trigger is-active"
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

export function FindingsChecksFilterSummary({
  tags,
  checkLabels,
  displayGroupCount,
  onClear,
}: {
  tags: string[];
  checkLabels: Record<string, string>;
  /** Rows shown after grouping checks into finding types; clarifies check count vs table rows. */
  displayGroupCount?: number;
  onClear: () => void;
}) {
  if (tags.length === 0) return null;

  const count = tags.length;
  const namesText = formatCheckFilterSummary(tags, checkLabels);
  const groupHint =
    displayGroupCount !== undefined &&
    displayGroupCount > 0 &&
    displayGroupCount < count
      ? `${displayGroupCount} finding group${displayGroupCount === 1 ? "" : "s"} shown`
      : null;

  return (
    <div className="findings-v2-checks-summary">
      <p className="findings-v2-checks-summary__text">
        {count === 1 ? "1 check filter active" : `${count} check filters active`}
        {groupHint ? (
          <>
            <span className="findings-v2-checks-summary__sep" aria-hidden>
              ·
            </span>
            {groupHint}
          </>
        ) : null}
        <span className="findings-v2-checks-summary__sep" aria-hidden>
          ·
        </span>
        {namesText}
      </p>
      <button type="button" className="findings-v2-checks-summary__clear" onClick={onClear}>
        Clear all
      </button>
    </div>
  );
}
