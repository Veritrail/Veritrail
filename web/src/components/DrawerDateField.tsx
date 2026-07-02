import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatDisplayDate, parseIso, toIsoDate, todayIso } from "../lib/isoDate";
import "../styles/drawer-date-field.css";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
const CLOSE_MS = 150;
const POPOVER_GAP = 8;
const POPOVER_WIDTH = 280;
const POPOVER_EST_HEIGHT = 320;

type PopoverCoords = {
  top: number;
  left: number;
  width: number;
  placement: "above" | "below";
};

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

function computePopoverCoords(
  trigger: HTMLElement,
  preferred: "above" | "below",
  popoverHeight: number,
  popoverWidth: number,
): PopoverCoords {
  const rect = trigger.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;

  let placement = preferred;
  if (preferred === "below" && spaceBelow < popoverHeight && spaceAbove > spaceBelow) {
    placement = "above";
  } else if (preferred === "above" && spaceAbove < popoverHeight && spaceBelow > spaceAbove) {
    placement = "below";
  }

  const height = popoverHeight || POPOVER_EST_HEIGHT;
  const top =
    placement === "below"
      ? rect.bottom + POPOVER_GAP
      : Math.max(POPOVER_GAP, rect.top - POPOVER_GAP - height);

  let left = rect.left;
  if (left + popoverWidth > window.innerWidth - POPOVER_GAP) {
    left = Math.max(POPOVER_GAP, window.innerWidth - popoverWidth - POPOVER_GAP);
  }

  return { top, left, width: popoverWidth, placement };
}

export function DrawerDateField({
  id,
  value,
  onChange,
  minIso = todayIso(),
  maxIso,
  placeholder = "Select date",
  allowClear = true,
  triggerClassName,
  popoverPlacement = "above",
  variant = "default",
  popoverMatchTriggerWidth,
  todayLabel,
}: {
  id?: string;
  value: string;
  onChange: (iso: string) => void;
  minIso?: string;
  maxIso?: string;
  placeholder?: string;
  allowClear?: boolean;
  /** Extra classes on the trigger (e.g. panel input styles). */
  triggerClassName?: string;
  popoverPlacement?: "above" | "below";
  /** `audit` matches Generate Audit Package date picker (blue accents, single Use today). */
  variant?: "default" | "audit";
  /** When true, popover width matches the trigger; defaults to true for audit variant. */
  popoverMatchTriggerWidth?: boolean;
  /** Footer today action label; defaults to "Today" or "Use today" for audit variant. */
  todayLabel?: string;
}) {
  const max = maxIso ?? toIsoDate(new Date(new Date().getFullYear() + 10, 11, 31));
  const isAudit = variant === "audit";
  const matchTriggerWidth = popoverMatchTriggerWidth ?? isAudit;
  const resolvedAllowClear = isAudit ? false : allowClear;
  const resolvedTodayLabel = todayLabel ?? (isAudit ? "Use today" : "Today");
  const selectedIso = value.trim();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [entered, setEntered] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords | null>(null);
  const [view, setView] = useState(() => {
    const d = selectedIso ? parseIso(selectedIso) : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const measured = popoverRef.current?.offsetHeight ?? POPOVER_EST_HEIGHT;
    const triggerWidth = trigger.getBoundingClientRect().width;
    const popoverWidth = matchTriggerWidth ? triggerWidth : POPOVER_WIDTH;
    setCoords(computePopoverCoords(trigger, popoverPlacement, measured, popoverWidth));
  }, [matchTriggerWidth, popoverPlacement]);

  function closePopover() {
    if (!open || closing) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      setCoords(null);
      closeTimerRef.current = null;
    }, CLOSE_MS);
  }

  function openPopover() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setClosing(false);
    setEntered(false);
    setOpen(true);
  }

  function togglePopover() {
    if (open && !closing) closePopover();
    else openPopover();
  }

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open || closing) return;
    const d = selectedIso ? parseIso(selectedIso) : new Date();
    setView({ year: d.getFullYear(), month: d.getMonth() });
  }, [open, closing, selectedIso]);

  useLayoutEffect(() => {
    if (!open || closing) {
      setCoords(null);
      return;
    }
    updatePosition();
  }, [open, closing, updatePosition]);

  useEffect(() => {
    if (!open || closing) return;
    function onScrollOrResize() {
      updatePosition();
    }
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, closing, updatePosition]);

  useEffect(() => {
    if (!open || closing) {
      setEntered(false);
      return;
    }
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => setEntered(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [open, closing, coords]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      closePopover();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePopover();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, closing]);

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
  const canPrevMonth =
    view.year > minDate.getFullYear() ||
    (view.year === minDate.getFullYear() && view.month > minDate.getMonth());
  const canNextMonth =
    view.year < maxDate.getFullYear() ||
    (view.year === maxDate.getFullYear() && view.month < maxDate.getMonth());

  function pick(iso: string) {
    onChange(iso);
    closePopover();
  }

  const effectivePlacement = coords?.placement ?? popoverPlacement;
  const popoverClass = [
    "drawer-date-field__popover",
    "drawer-date-field__popover--portal",
    matchTriggerWidth ? "drawer-date-field__popover--match-trigger" : "",
    effectivePlacement === "below" ? "is-below" : "is-above",
    entered ? "is-open" : "",
    closing ? "is-closing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const triggerClass = [
    "drawer-date-field__trigger",
    triggerClassName ??
      "rounded-lg border border-[#e4e4e7] bg-white px-3 py-2.5 text-sm shadow-sm transition hover:border-zinc-300 focus:outline-none",
  ]
    .filter(Boolean)
    .join(" ");

  const popover =
    open && coords ? (
      <div
        ref={popoverRef}
        role="dialog"
        aria-label="Choose date"
        className={popoverClass}
        style={{
          top: coords.top,
          left: coords.left,
          ...(matchTriggerWidth ? { width: coords.width } : null),
        }}
      >
        <div className="drawer-date-field__nav">
          <button
            type="button"
            disabled={!canPrevMonth}
            className="drawer-date-field__nav-btn"
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
          <span className="drawer-date-field__month">{monthLabel}</span>
          <button
            type="button"
            disabled={!canNextMonth}
            className="drawer-date-field__nav-btn"
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

        <div className="drawer-date-field__weekdays">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="drawer-date-field__grid">
          {cells.map((cell, idx) => {
            const selected = cell.iso === selectedIso;
            const isToday = cell.iso === todayIso();
            const dayClass = [
              "drawer-date-field__day",
              selected ? "is-selected" : "",
              !cell.inMonth ? "is-outside" : "",
              isToday && !selected ? "is-today" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={`${cell.iso}-${idx}`}
                type="button"
                disabled={cell.disabled}
                onClick={() => pick(cell.iso)}
                className={dayClass}
              >
                {cell.day}
              </button>
            );
          })}
        </div>

        <div
          className={`drawer-date-field__footer${isAudit ? " drawer-date-field__footer--audit" : ""}`}
        >
          {resolvedAllowClear && (
            <button
              type="button"
              className="drawer-date-field__footer-btn"
              onClick={() => {
                onChange("");
                closePopover();
              }}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className={`drawer-date-field__footer-btn drawer-date-field__footer-btn--today${isAudit ? " drawer-date-field__footer-btn--use-today" : ""}`}
            onClick={() => {
              if (isAudit) {
                onChange("");
                closePopover();
                return;
              }
              const t = todayIso();
              if (t >= minIso && t <= max) pick(t);
            }}
            disabled={!isAudit && (todayIso() < minIso || todayIso() > max)}
          >
            {resolvedTodayLabel}
          </button>
        </div>
      </div>
    ) : null;

  const rootClass = ["drawer-date-field", isAudit ? "drawer-date-field--audit" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        onClick={togglePopover}
        className={triggerClass}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span
          className={`drawer-date-field__value ${selectedIso ? "font-medium text-zinc-800" : "is-empty"}`}
        >
          {selectedIso ? formatDisplayDate(selectedIso) : placeholder}
        </span>
        <span className="drawer-date-field__icon" aria-hidden>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"
            />
          </svg>
        </span>
      </button>

      {popover ? createPortal(popover, document.body) : null}
    </div>
  );
}
