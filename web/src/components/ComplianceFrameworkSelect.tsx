import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FRAMEWORKS } from "../data/frameworks";

type MenuPosition = { top: number; left: number; minWidth: number };

export type ComplianceFrameworkStats = {
  passRate: number | null;
  passed: number;
  total: number;
};

function BenchmarkShieldMark() {
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[#0876df]" aria-hidden>
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.96 11.96 0 0 1 3.6 6 12 12 0 0 0 3 9.75c0 5.59 3.82 10.29 9 11.623 5.18-1.33 9-6.03 9-11.62 0-1.31-.21-2.57-.6-3.75h-.15a11.96 11.96 0 0 1-8.25-3.29Z"
        />
      </svg>
    </span>
  );
}

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

  const updateMenuPosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 6,
      left: rect.left,
      minWidth: Math.max(rect.width, 240),
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
            className="fixed z-[120] overflow-hidden rounded-xl border border-[#e2e8f0] bg-white py-1 shadow-lg shadow-zinc-900/10"
            style={{ top: menuPos.top, left: menuPos.left, minWidth: menuPos.minWidth }}
          >
            <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
              Framework
            </p>
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
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition ${
                    isActive ? "bg-indigo-50/70" : "hover:bg-zinc-50"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-zinc-900">{fw.label}</span>
                    <span className="mt-0.5 block text-[11px] text-zinc-500">
                      {hasData ? `${stats.passed} of ${stats.total} passing` : "No scan data"}
                    </span>
                  </span>
                  <span className={`shrink-0 text-xs font-bold tabular-nums ${passRateClass(stats)}`}>
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
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Framework: ${activeFw.label}`}
        className="findings-v2-filter-trigger findings-v2-benchmark-trigger"
      >
        <BenchmarkShieldMark />
        <span className="truncate">{activeFw.label}</span>
        {(() => {
          const activeStats = statsById[selectedId];
          if (!activeStats || activeStats.total === 0 || activeStats.passRate == null) return null;
          return (
            <span className={`shrink-0 text-xs font-bold tabular-nums ${passRateClass(activeStats)}`}>
              {activeStats.passRate}%
            </span>
          );
        })()}
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
