import { useEffect, useMemo, useRef, useState } from "react";
import { formatDisplayDate, parseIso, toIsoDate, todayIso } from "../lib/isoDate";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

function buildMonthGrid(year: number, month: number, minIso: string, maxIso: string) {
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const grid: { iso: string; day: number; inMonth: boolean; disabled: boolean }[] = [];

  for (let i = 0; i < startPad; i++) {
    const d = new Date(year, month, -startPad + i + 1);
    const iso = toIsoDate(d);
    grid.push({ iso, day: d.getDate(), inMonth: false, disabled: iso < minIso || iso > maxIso });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = toIsoDate(new Date(year, month, day));
    grid.push({ iso, day, inMonth: true, disabled: iso < minIso || iso > maxIso });
  }
  while (grid.length % 7 !== 0) {
    const d = new Date(year, month + 1, grid.length - startPad - daysInMonth + 1);
    const iso = toIsoDate(d);
    grid.push({ iso, day: d.getDate(), inMonth: false, disabled: iso < minIso || iso > maxIso });
  }
  return grid;
}

export function DrawerDateField({
  id,
  value,
  onChange,
  minIso = todayIso(),
  maxIso,
  placeholder = "Select date",
  allowClear = true,
}: {
  id?: string;
  value: string;
  onChange: (iso: string) => void;
  minIso?: string;
  maxIso?: string;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const max = maxIso ?? toIsoDate(new Date(new Date().getFullYear() + 10, 11, 31));
  const selectedIso = value.trim();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const d = selectedIso ? parseIso(selectedIso) : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const d = selectedIso ? parseIso(selectedIso) : new Date();
    setView({ year: d.getFullYear(), month: d.getMonth() });
  }, [open, selectedIso]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
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

  const cells = useMemo(
    () => buildMonthGrid(view.year, view.month, minIso, max),
    [view.year, view.month, minIso, max],
  );

  const monthLabel = new Date(view.year, view.month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const minDate = parseIso(minIso);
  const maxDate = parseIso(max);
  const canPrevMonth = view.year > minDate.getFullYear() || (view.year === minDate.getFullYear() && view.month > minDate.getMonth());
  const canNextMonth = view.year < maxDate.getFullYear() || (view.year === maxDate.getFullYear() && view.month < maxDate.getMonth());

  function pick(iso: string) {
    onChange(iso);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-left text-sm shadow-sm transition hover:border-zinc-300 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className={selectedIso ? "font-medium text-zinc-800" : "text-zinc-400"}>
          {selectedIso ? formatDisplayDate(selectedIso) : placeholder}
        </span>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"
            />
          </svg>
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose date"
          className="absolute bottom-full left-0 z-30 mb-2 w-[17.5rem] rounded-xl border border-zinc-200 bg-white p-3 shadow-xl shadow-zinc-900/10 ring-1 ring-zinc-950/[0.04]"
        >
          <div className="mb-2.5 flex items-center justify-between rounded-lg bg-zinc-50 px-1 py-0.5">
            <button
              type="button"
              disabled={!canPrevMonth}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-30"
              onClick={() =>
                setView((v) => {
                  const m = v.month - 1;
                  return m < 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: m };
                })
              }
              aria-label="Previous month"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m15 19-7-7 7-7" />
              </svg>
            </button>
            <span className="text-xs font-semibold text-zinc-800">{monthLabel}</span>
            <button
              type="button"
              disabled={!canNextMonth}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-30"
              onClick={() =>
                setView((v) => {
                  const m = v.month + 1;
                  return m > 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: m };
                })
              }
              aria-label="Next month"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
              </svg>
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((cell, idx) => {
              const selected = cell.iso === selectedIso;
              const isToday = cell.iso === todayIso();
              return (
                <button
                  key={`${cell.iso}-${idx}`}
                  type="button"
                  disabled={cell.disabled}
                  onClick={() => pick(cell.iso)}
                  className={`relative h-8 rounded-lg text-xs font-semibold tabular-nums transition ${
                    selected
                      ? "bg-zinc-800 text-white shadow-sm"
                      : cell.disabled
                        ? "cursor-not-allowed text-zinc-300"
                        : cell.inMonth
                          ? isToday
                            ? "text-zinc-800 ring-1 ring-zinc-300 hover:bg-zinc-100"
                            : "text-zinc-700 hover:bg-zinc-100"
                          : "text-zinc-400 hover:bg-zinc-50"
                  }`}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>

          <div className="mt-2.5 flex gap-2 border-t border-zinc-100 pt-2.5">
            {allowClear && (
              <button
                type="button"
                className="flex-1 rounded-lg border border-zinc-200 bg-white py-1.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                Clear
              </button>
            )}
            <button
              type="button"
              className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 py-1.5 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-100"
              onClick={() => {
                const t = todayIso();
                if (t >= minIso && t <= max) pick(t);
              }}
              disabled={todayIso() < minIso || todayIso() > max}
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
