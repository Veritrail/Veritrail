import { useEffect, useMemo, useRef, useState } from "react";
import type { EvidenceCoverage } from "../lib/evidenceCoverage";
import {
  exportAsOfSectionLabel,
  exportAsOfShowsType2Hint,
  exportScopeSectionLabel,
  frameworkEvidenceUi,
  type EvidenceTone,
  type FrameworkEvidenceUi,
} from "../lib/frameworkEvidenceCoverage";
import { PackIntegrityPanel } from "./PackIntegrityPanel";

const WINDOW_OPTIONS = [
  { value: "last_scan" as const, label: "Last scan" },
  { value: 30 as const, label: "Last 30 days" },
  { value: 90 as const, label: "Last 90 days" },
  { value: 180 as const, label: "Last 180 days" },
  { value: 365 as const, label: "Last 365 days" },
];

const readinessStyles: Record<
  EvidenceTone,
  { badge: string; dot: string; bar: string; headline: string; surface: string }
> = {
  ready: {
    badge: "bg-emerald-50 text-emerald-900 ring-emerald-200/80",
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
    headline: "text-emerald-900",
    surface: "from-emerald-50/70 via-white to-white",
  },
  partial: {
    badge: "bg-amber-50/90 text-amber-950 ring-amber-200/70",
    dot: "bg-amber-400",
    bar: "bg-amber-400",
    headline: "text-amber-950",
    surface: "from-amber-50/70 via-white to-white",
  },
  limited: {
    badge: "bg-zinc-100 text-zinc-800 ring-zinc-200/80",
    dot: "bg-zinc-400",
    bar: "bg-zinc-500",
    headline: "text-zinc-800",
    surface: "from-zinc-50 via-white to-white",
  },
  insufficient: {
    badge: "bg-rose-50/80 text-rose-900 ring-rose-200/60",
    dot: "bg-rose-500",
    bar: "bg-rose-400",
    headline: "text-zinc-900",
    surface: "from-rose-50/60 via-white to-white",
  },
  snapshot: {
    badge: "bg-blue-50 text-blue-900 ring-blue-200/80",
    dot: "bg-blue-500",
    bar: "bg-blue-500",
    headline: "text-blue-900",
    surface: "from-blue-50/70 via-white to-white",
  },
  neutral: {
    badge: "bg-zinc-100 text-zinc-800 ring-zinc-200/80",
    dot: "bg-zinc-500",
    bar: "bg-zinc-500",
    headline: "text-zinc-900",
    surface: "from-zinc-50 via-white to-white",
  },
};

function getFrameworkExportCopy(frameworkId: string) {
  if (frameworkId === "soc2") {
    return {
      eyebrow: "SOC 2 Type II",
      subtitle: "Build a reviewer-ready package around the Type II sampling window.",
    };
  }

  if (frameworkId === "cis_aws_l1") {
    return {
      eyebrow: "CIS AWS Foundations",
      subtitle: "Package benchmark posture with optional evidence history.",
    };
  }

  if (frameworkId === "iso27001") {
    return {
      eyebrow: "ISO 27001",
      subtitle: "Export control evidence and historical posture.",
    };
  }

  if (frameworkId === "gdpr") {
    return {
      eyebrow: "GDPR Article 32",
      subtitle: "Export technical security-of-processing evidence for the selected period.",
    };
  }

  return {
    eyebrow: "Evidence export",
    subtitle: "Create an evidence package for this framework.",
  };
}

function ExportPackageMark({ className }: { className?: string }) {
  return (
    <img
      src="/icons/export-package.png"
      alt=""
      className={className ?? "h-full w-full object-contain object-left"}
      aria-hidden
    />
  );
}

function EvidenceCoverageSection({
  ui,
  loading,
}: {
  ui: FrameworkEvidenceUi;
  loading?: boolean;
}) {
  const styles = readinessStyles[ui.tone];
  return (
    <section
      className={`rounded-2xl border border-zinc-200/80 bg-gradient-to-br ${styles.surface} p-4 shadow-sm`}
      aria-label="Evidence coverage"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${styles.badge}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} aria-hidden />
            {ui.badgeLabel}
          </span>
          {loading && <span className="text-[11px] font-medium text-zinc-400">Updating…</span>}
        </div>

        {ui.headline && (
          <p className={`mt-2 text-sm font-semibold tabular-nums ${styles.headline}`}>{ui.headline}</p>
        )}

        {ui.showProgressBar && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/80">
            <div
              className={`h-full rounded-full transition-all duration-300 ${ui.progressPct > 0 ? styles.bar : "bg-transparent"}`}
              style={{ width: `${Math.min(100, Math.max(0, ui.progressPct))}%` }}
              role="progressbar"
              aria-valuenow={ui.progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={ui.progressAriaLabel ?? "Days with scan evidence"}
            />
          </div>
        )}

        {ui.guidanceLine ? (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-200/70 bg-amber-50/90 px-3 py-2 text-xs font-medium text-amber-950">
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold leading-none text-amber-800 ring-1 ring-amber-200/80"
              aria-hidden
            >
              i
            </span>
            <span>{ui.guidanceLine}</span>
          </div>
        ) : ui.detailLine ? (
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">{ui.detailLine}</p>
        ) : null}
      </div>
    </section>
  );
}

function PeriodWindowPicker({
  scopeLabel,
  periodKey,
  onPeriodChange,
}: {
  scopeLabel: string;
  periodKey: string | number;
  onPeriodChange: (key: string | number) => void;
}) {
  const selected = WINDOW_OPTIONS.find((opt) => opt.value === periodKey) ?? WINDOW_OPTIONS[0];
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={rootRef} className="relative">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{scopeLabel}</p>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group mt-2 inline-flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-zinc-200/90 bg-gradient-to-b from-white to-zinc-50 px-3.5 text-left text-sm font-semibold text-zinc-900 shadow-sm outline-none transition hover:border-blue-300 hover:shadow-md focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={scopeLabel}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-blue-700 ring-1 ring-blue-100">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </span>
          <span className="truncate">{selected.label}</span>
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-zinc-400 transition group-hover:text-zinc-600 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={scopeLabel}
          className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-zinc-200/90 bg-white p-1 shadow-xl shadow-zinc-950/10 ring-1 ring-zinc-950/[0.04]"
        >
          {WINDOW_OPTIONS.map((opt) => {
            const isSelected = opt.value === selected.value;
            return (
              <li key={String(opt.value)} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onPeriodChange(opt.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
                    isSelected
                      ? "bg-blue-50 text-blue-900"
                      : "text-zinc-800 hover:bg-zinc-50"
                  }`}
                >
                  <span>{opt.label}</span>
                  {isSelected && (
                    <svg className="h-4 w-4 shrink-0 text-blue-600" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIso(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

function formatDisplayDate(iso: string): string {
  return parseIso(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function AuditAsOfPicker({
  value,
  onChange,
  maxIso,
}: {
  value: string;
  onChange: (iso: string) => void;
  maxIso: string;
}) {
  const todayIso = maxIso;
  const selectedIso = value.trim() || todayIso;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"day" | "month" | "year">("day");
  const [view, setView] = useState(() => {
    const d = parseIso(selectedIso);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const d = parseIso(selectedIso);
    setView({ year: d.getFullYear(), month: d.getMonth() });
    setMode("day");
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

  const cells = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    const grid: { iso: string; day: number; inMonth: boolean; disabled: boolean }[] = [];
    for (let i = 0; i < startPad; i++) {
      const d = new Date(view.year, view.month, -startPad + i + 1);
      grid.push({
        iso: toIsoDate(d),
        day: d.getDate(),
        inMonth: false,
        disabled: toIsoDate(d) > maxIso,
      });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(view.year, view.month, day);
      const iso = toIsoDate(d);
      grid.push({ iso, day, inMonth: true, disabled: iso > maxIso });
    }
    while (grid.length % 7 !== 0) {
      const d = new Date(view.year, view.month + 1, grid.length - startPad - daysInMonth + 1);
      const iso = toIsoDate(d);
      grid.push({
        iso,
        day: d.getDate(),
        inMonth: false,
        disabled: iso > maxIso,
      });
    }
    return grid;
  }, [view.month, view.year, maxIso]);

  const monthLabel = new Date(view.year, view.month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const maxDate = parseIso(maxIso);
  const maxYear = maxDate.getFullYear();
  const maxMonth = maxDate.getMonth();
  const yearBlockStart = view.year - (((view.year % 12) + 12) % 12);
  const headerLabel =
    mode === "day"
      ? monthLabel
      : mode === "month"
        ? String(view.year)
        : `${yearBlockStart} - ${yearBlockStart + 11}`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group inline-flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-zinc-200/90 bg-gradient-to-b from-white to-zinc-50 px-3.5 text-left text-sm font-semibold text-zinc-900 shadow-sm transition hover:border-zinc-300 hover:shadow-md"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-blue-100">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" />
            </svg>
          </span>
          <span className="truncate whitespace-nowrap">
            {value.trim() ? formatDisplayDate(value) : `Today · ${formatDisplayDate(todayIso)}`}
          </span>
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-zinc-400 transition group-hover:text-zinc-600 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Choose as-of date"
          className="absolute left-0 right-0 top-full z-30 mt-2 w-full min-w-[18rem] rounded-2xl border border-zinc-200/90 bg-white p-3 shadow-xl shadow-zinc-950/15 ring-1 ring-zinc-950/[0.04]"
        >
          <div className="mb-3 flex items-center justify-between rounded-xl bg-zinc-50 px-1.5 py-1">
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-white hover:text-zinc-800 hover:shadow-sm"
              onClick={() =>
                setView((v) => {
                  if (mode === "year") return { ...v, year: v.year - 12 };
                  if (mode === "month") return { ...v, year: v.year - 1 };
                  const m = v.month - 1;
                  return m < 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: m };
                })
              }
              aria-label={mode === "day" ? "Previous month" : mode === "month" ? "Previous year" : "Previous years"}
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setMode((m) => (m === "day" ? "month" : m === "month" ? "year" : "month"))}
              className="rounded-lg px-2.5 py-1 text-xs font-bold text-zinc-800 hover:bg-white hover:shadow-sm"
              aria-label="Switch month/year"
            >
              {headerLabel}
            </button>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-white hover:text-zinc-800 hover:shadow-sm disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent disabled:hover:shadow-none"
              disabled={
                mode === "year"
                  ? yearBlockStart + 11 >= maxYear
                  : mode === "month"
                    ? view.year >= maxYear
                    : view.year > maxYear || (view.year === maxYear && view.month >= maxMonth)
              }
              onClick={() =>
                setView((v) => {
                  if (mode === "year") return { ...v, year: v.year + 12 };
                  if (mode === "month") return { ...v, year: v.year + 1 };
                  const m = v.month + 1;
                  return m > 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: m };
                })
              }
              aria-label={mode === "day" ? "Next month" : mode === "month" ? "Next year" : "Next years"}
            >
              ›
            </button>
          </div>
          {mode === "year" ? (
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 12 }).map((_, i) => {
                const y = yearBlockStart + i;
                const disabled = y > maxYear;
                const selected = y === parseIso(selectedIso).getFullYear();
                return (
                  <button
                    key={y}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setView((v) => ({ ...v, year: y }));
                      setMode("month");
                    }}
                    className={`h-9 rounded-lg text-[11px] font-semibold tabular-nums transition ${
                      selected
                        ? "bg-blue-600 text-white shadow-sm"
                        : disabled
                          ? "cursor-not-allowed text-zinc-300"
                          : "text-zinc-800 hover:bg-blue-50 hover:text-blue-900"
                    }`}
                  >
                    {y}
                  </button>
                );
              })}
            </div>
          ) : mode === "month" ? (
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 12 }).map((_, m) => {
                const label = new Date(view.year, m, 1).toLocaleDateString(undefined, { month: "short" });
                const disabled = view.year > maxYear || (view.year === maxYear && m > maxMonth);
                const selected = view.year === parseIso(selectedIso).getFullYear() && m === parseIso(selectedIso).getMonth();
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setView({ year: view.year, month: m });
                      setMode("day");
                    }}
                    className={`h-9 rounded-lg text-[11px] font-semibold transition ${
                      selected
                        ? "bg-blue-600 text-white shadow-sm"
                        : disabled
                          ? "cursor-not-allowed text-zinc-300"
                          : "text-zinc-800 hover:bg-blue-50 hover:text-blue-900"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <div className="mb-1.5 grid grid-cols-7 gap-0.5 text-center text-[9px] font-bold uppercase tracking-wide text-zinc-400">
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {cells.map((cell, idx) => {
                  const selected = cell.iso === selectedIso;
                  return (
                    <button
                      key={`${cell.iso}-${idx}`}
                      type="button"
                      disabled={cell.disabled}
                      onClick={() => {
                        onChange(cell.iso);
                        setOpen(false);
                      }}
                      className={`h-8 rounded-lg text-[11px] font-semibold tabular-nums transition ${
                        selected
                          ? "bg-blue-600 text-white shadow-sm"
                          : cell.disabled
                            ? "cursor-not-allowed text-zinc-300"
                            : cell.inMonth
                              ? "text-zinc-800 hover:bg-blue-50 hover:text-blue-900"
                              : "text-zinc-400 hover:bg-zinc-50"
                      }`}
                    >
                      {cell.day}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <button
            type="button"
            className="mt-3 w-full rounded-xl border border-blue-100 bg-blue-50/80 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            Today
          </button>
        </div>
      )}
    </div>
  );
}

export type EvidencePackExportPanelProps = {
  frameworkId: string;
  frameworkLabel: string;
  periodKey: string | number;
  onPeriodChange: (key: string | number) => void;
  asOf: string;
  onAsOfChange: (value: string) => void;
  coverage?: EvidenceCoverage;
  coverageLoading?: boolean;
  controlsEvaluated: number;
  lastScanLabel?: string | null;
  downloading: boolean;
  onDownload: () => void;
  /** ZIP SHA-256 from the last successful download (response header). */
  lastZipSha256?: string | null;
  lastReportId?: string | null;
};

export function EvidencePackExportPanel({
  frameworkId,
  frameworkLabel,
  periodKey,
  onPeriodChange,
  asOf,
  onAsOfChange,
  coverage,
  coverageLoading,
  controlsEvaluated,
  lastScanLabel,
  downloading,
  onDownload,
  lastZipSha256,
  lastReportId,
}: EvidencePackExportPanelProps) {
  const evidenceUi = frameworkEvidenceUi(frameworkId, coverage, periodKey, {
    controlsEvaluated,
    lastScanLabel,
  });
  const scopeLabel = exportScopeSectionLabel(frameworkId);
  const asOfLabel = exportAsOfSectionLabel(frameworkId);
  const showType2AsOfHint = exportAsOfShowsType2Hint(frameworkId);
  const maxIso = toIsoDate(new Date());
  const copy = getFrameworkExportCopy(frameworkId);

  return (
    <div className="w-[min(100vw-2rem,38rem)]">
      <header className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 flex-1 grid-cols-[5rem_minmax(0,1fr)] grid-rows-[auto_auto_auto] gap-x-2.5">
            <div className="row-span-3 flex min-h-0 items-stretch self-stretch">
              <ExportPackageMark className="h-full w-full object-contain object-left" />
            </div>
            <p className="col-start-2 row-start-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#439385]">
              {copy.eyebrow}
            </p>
            <h2 className="col-start-2 row-start-2 mt-1 text-lg font-bold tracking-tight text-zinc-950">
              Generate audit package
            </h2>
            <p className="col-start-2 row-start-3 mt-1 max-w-[30rem] text-sm leading-relaxed text-zinc-600">
              {copy.subtitle}
            </p>
          </div>
          <span className="hidden shrink-0 rounded-full border border-zinc-200/80 px-2.5 py-1 text-xs font-semibold text-zinc-700 sm:inline-flex">
            {frameworkLabel}
          </span>
        </div>
      </header>

      <div className="mt-3 space-y-3">
        <EvidenceCoverageSection ui={evidenceUi} loading={coverageLoading} />

        <section className="overflow-visible rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm">
          <PeriodWindowPicker
            scopeLabel={scopeLabel}
            periodKey={periodKey}
            onPeriodChange={onPeriodChange}
          />

          <div className="mt-4 border-t border-zinc-100 pt-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {asOfLabel}
              {showType2AsOfHint && (
                <span className="ml-1 normal-case tracking-normal text-zinc-400">
                  · end of Type II sampling
                </span>
              )}
            </p>
            <div className="mt-2">
              <AuditAsOfPicker value={asOf} onChange={onAsOfChange} maxIso={maxIso} />
            </div>
          </div>
        </section>

        <PackIntegrityPanel zipSha256={lastZipSha256} reportId={lastReportId} />
      </div>

      <button
        type="button"
        onClick={onDownload}
        disabled={downloading}
        className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#439385] px-4 text-sm font-bold text-white shadow-lg shadow-[#439385]/20 transition hover:bg-[#367a6f] hover:shadow-[#439385]/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {downloading ? (
          <>
            <svg className="h-3.5 w-3.5 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden>
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
            </svg>
            Generating…
          </>
        ) : (
          <>
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1m-4-4-4 4m0 0-4-4m4 4V4" />
            </svg>
            Generate audit package
          </>
        )}
      </button>
    </div>
  );
}
