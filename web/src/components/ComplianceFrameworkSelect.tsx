import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FRAMEWORKS } from "../data/frameworks";
import { FrameworkMark } from "./FrameworkMark";
import { HistoryMenuCheckmark } from "./HistoryMenuCheckmark";
import { SelectorCard } from "./SelectorCard";
import "../styles/history-page.css";

type MenuPosition = { top: number; left: number };

export type ComplianceFrameworkStats = {
  passRate: number | null;
  passed: number;
  total: number;
};

function passRateLabel(stats: ComplianceFrameworkStats | undefined): string {
  if (!stats || stats.total === 0 || stats.passRate == null) return "—";
  return `${stats.passRate}%`;
}

function passRateClass(stats: ComplianceFrameworkStats | undefined): string {
  if (!stats || stats.total === 0 || stats.passRate == null) return "text-[#98a2b3]";
  if (stats.passRate >= 80) return "text-emerald-600";
  if (stats.passRate >= 50) return "text-amber-600";
  return "text-rose-600";
}

function triggerValueLabel(label: string, stats: ComplianceFrameworkStats | undefined): string {
  if (!stats || stats.total === 0 || stats.passRate == null) return label;
  return `${label} · ${stats.passRate}%`;
}

export function ComplianceFrameworkSelect({
  selectedId,
  statsById,
  onSelect,
}: {
  selectedId: string;
  statsById: Record<string, ComplianceFrameworkStats | undefined>;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeFw = FRAMEWORKS.find((f) => f.id === selectedId) ?? FRAMEWORKS[0];
  const activeStats = statsById[selectedId];

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
            aria-label="Compliance framework"
            className="history-filter-menu"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            <p className="history-filter-menu__heading">Framework</p>
            {FRAMEWORKS.map((fw) => {
              const stats = statsById[fw.id];
              const isActive = fw.id === selectedId;
              const hasData = stats && stats.total > 0;
              return (
                <button
                  key={fw.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    onSelect(fw.id);
                    setOpen(false);
                  }}
                  className={`history-filter-menu__option history-filter-menu__option--with-meta${
                    isActive ? " history-filter-menu__option--active" : ""
                  }`}
                >
                  <HistoryMenuCheckmark selected={isActive} className="history-filter-menu__check" />
                  <FrameworkMark framework={fw.id} className="history-filter-menu__icon" />
                  <span className="history-filter-menu__label history-filter-menu__label--stacked">
                    <span className="history-filter-menu__label-primary">{fw.label}</span>
                    <span className="history-filter-menu__label-secondary">
                      {hasData ? `${stats.passed} of ${stats.total} passing` : "No scan data"}
                    </span>
                  </span>
                  <span className={`history-filter-menu__option-rate ${passRateClass(stats)}`}>
                    {passRateLabel(stats)}
                  </span>
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
        icon={<FrameworkMark framework={selectedId} className="selector-card__framework-mark" />}
        label="Framework"
        value={triggerValueLabel(activeFw.label, activeStats)}
        iconTone="framework"
        open={open}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Framework: ${triggerValueLabel(activeFw.label, activeStats)}`}
      />
      {menu}
    </div>
  );
}
