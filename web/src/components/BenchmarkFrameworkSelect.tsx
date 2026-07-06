import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FRAMEWORKS, frameworkLabel, type FrameworkId } from "../data/frameworks";
import { FrameworkMark } from "./FrameworkMark";
import { HistoryMenuCheckmark } from "./HistoryMenuCheckmark";
import { SelectorCard } from "./SelectorCard";
import "../styles/history-page.css";

type MenuPosition = { top: number; left: number };

function BenchmarkShieldIcon({
  className = "selector-card__glyph selector-card__glyph--framework",
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.96 11.96 0 0 1 3.6 6 12 12 0 0 0 3 9.75c0 5.59 3.82 10.29 9 11.623 5.18-1.33 9-6.03 9-11.62 0-1.31-.21-2.57-.6-3.75h-.15a11.96 11.96 0 0 1-8.25-3.29Z"
      />
    </svg>
  );
}

function triggerIcon(selected: FrameworkId[]): ReactNode {
  if (selected.length === 1) {
    return <FrameworkMark framework={selected[0]} className="selector-card__framework-mark" />;
  }
  return <BenchmarkShieldIcon />;
}

export function benchmarkSelectionLabel(selected: FrameworkId[]): string {
  if (selected.length === 0) return "All benchmarks";
  if (selected.length === 1) return frameworkLabel(selected[0]);
  if (selected.length === 2) return `${frameworkLabel(selected[0])}, ${frameworkLabel(selected[1])}`;
  return `${frameworkLabel(selected[0])} + ${selected.length - 1}`;
}

export function parseFrameworkParam(raw: string | null): FrameworkId[] {
  if (!raw?.trim()) return [];
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.filter((id): id is FrameworkId => FRAMEWORKS.some((f) => f.id === id));
}

export function serializeFrameworkParam(selected: FrameworkId[]): string | null {
  if (selected.length === 0) return null;
  return selected.join(",");
}

export function BenchmarkFrameworkSelect({
  selected,
  onChange,
}: {
  selected: FrameworkId[];
  onChange: (next: FrameworkId[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const viewingAll = selected.length === 0;
  const label = benchmarkSelectionLabel(selected);

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

  function selectAll() {
    onChange([]);
    setOpen(false);
  }

  function toggleFramework(id: FrameworkId) {
    const has = selected.includes(id);
    const next = has ? selected.filter((x) => x !== id) : [...selected, id];
    onChange(next);
  }

  const menu =
    open && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label="Benchmark scope"
            aria-multiselectable="true"
            className="history-filter-menu"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            <p className="history-filter-menu__heading">Benchmark</p>
            <button
              type="button"
              role="option"
              aria-selected={viewingAll}
              onClick={selectAll}
              className={`history-filter-menu__option${viewingAll ? " history-filter-menu__option--active" : ""}`}
            >
              <HistoryMenuCheckmark selected={viewingAll} className="history-filter-menu__check" />
              <BenchmarkShieldIcon className="history-filter-menu__icon history-filter-menu__icon--benchmark" />
              <span className="history-filter-menu__label">All benchmarks</span>
            </button>
            <p className="history-filter-menu__heading">Frameworks</p>
            {FRAMEWORKS.map((fw) => {
              const active = selected.includes(fw.id);
              return (
                <button
                  key={fw.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => toggleFramework(fw.id)}
                  className={`history-filter-menu__option${active ? " history-filter-menu__option--active" : ""}`}
                >
                  <HistoryMenuCheckmark selected={active} className="history-filter-menu__check" />
                  <FrameworkMark framework={fw.id} className="history-filter-menu__icon" />
                  <span className="history-filter-menu__label">{fw.label}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="history-filter-dropdown history-filter-dropdown--framework shrink-0">
      <SelectorCard
        ref={triggerRef}
        id="findings-benchmark-filter"
        icon={triggerIcon(selected)}
        label="Benchmark"
        value={label}
        iconTone="framework"
        open={open}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Benchmark: ${label}`}
      />
      {menu}
    </div>
  );
}
