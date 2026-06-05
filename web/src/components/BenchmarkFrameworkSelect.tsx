import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FRAMEWORKS, frameworkLabel, type FrameworkId } from "../data/frameworks";

type MenuPosition = { top: number; left: number; minWidth: number };

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
      minWidth: Math.max(rect.width, 216),
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
            className="fixed z-[120] overflow-hidden rounded-xl border border-[#e2e8f0] bg-white py-1 shadow-lg shadow-zinc-900/10"
            style={{ top: menuPos.top, left: menuPos.left, minWidth: menuPos.minWidth }}
          >
            <button
              type="button"
              role="option"
              aria-selected={viewingAll}
              onClick={selectAll}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-semibold transition ${
                viewingAll ? "bg-indigo-50/70 text-zinc-900" : "text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  viewingAll ? "border-indigo-500 bg-indigo-500 text-white" : "border-zinc-300 bg-white"
                }`}
                aria-hidden
              >
                {viewingAll && (
                  <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                )}
              </span>
              All benchmarks
            </button>
            <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Frameworks</p>
            {FRAMEWORKS.map((fw) => {
              const active = selected.includes(fw.id);
              return (
                <button
                  key={fw.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => toggleFramework(fw.id)}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition ${
                    active ? "bg-indigo-50/70" : "hover:bg-zinc-50"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      active ? "border-indigo-500 bg-indigo-500 text-white" : "border-zinc-300 bg-white"
                    }`}
                    aria-hidden
                  >
                    {active && (
                      <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                  </span>
                  <span className="text-xs font-semibold text-zinc-900">{fw.label}</span>
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
        id="findings-benchmark-filter"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Benchmark: ${label}`}
        className="findings-v2-filter-trigger"
      >
        <BenchmarkShieldMark />
        <span className="max-w-[11rem] truncate">{label}</span>
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
