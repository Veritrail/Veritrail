import { useState, type ReactNode } from "react";
import {
  drawerSectionHead,
  drawerSectionTitle,
  drawerSummaryLabel,
  drawerSummaryValue,
  drawerSummaryValueStrong,
} from "./drawerStyles";

/** Shared workflow primitives. Same rhythm as What If, reusable across drawer tabs. */

export function DrawerFlowLabel({ children }: { children: ReactNode }) {
  return <p className={`${drawerSummaryLabel} px-0.5`}>{children}</p>;
}

type SemanticTone = "neutral" | "caution" | "action" | "positive";

const TONE_STYLES: Record<
  SemanticTone,
  { shell: string; header: string; tag: string }
> = {
  neutral: {
    shell: "border-zinc-200/90 shadow-sm shadow-zinc-900/[0.03]",
    header: "bg-gradient-to-r from-zinc-50/95 to-white",
    tag: "bg-zinc-100 text-zinc-700 ring-zinc-200/80",
  },
  caution: {
    shell: "border-amber-200/75 shadow-sm shadow-amber-900/[0.04]",
    header: "bg-gradient-to-r from-amber-50/90 to-white",
    tag: "bg-amber-100 text-amber-900 ring-amber-200/80",
  },
  action: {
    shell: "border-zinc-200/90 shadow-sm shadow-zinc-900/[0.03]",
    header: "bg-gradient-to-r from-indigo-50/40 to-white",
    tag: "bg-indigo-100 text-indigo-900 ring-indigo-200/70",
  },
  positive: {
    shell: "border-emerald-200/65 shadow-sm shadow-emerald-900/[0.04]",
    header: "bg-gradient-to-r from-emerald-50/50 to-white",
    tag: "bg-emerald-100 text-emerald-900 ring-emerald-200/70",
  },
};

export function SemanticNarrativeBlock({
  tag,
  title,
  tone = "neutral",
  children,
  icon,
}: {
  tag: string;
  title?: string;
  tone?: SemanticTone;
  children: ReactNode;
  icon?: ReactNode;
}) {
  const t = TONE_STYLES[tone];
  return (
    <div className={`overflow-hidden rounded-xl border bg-white ${t.shell}`}>
      <div className={`flex items-start gap-3 px-4 py-2.5 pr-5 ${t.header}`}>
        {icon ?? (
          <span
            className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${t.tag}`}
          >
            {tag}
          </span>
        )}
        {title ? (
          <span className="pt-0.5 text-[13px] font-semibold leading-snug text-zinc-900">{title}</span>
        ) : null}
      </div>
      <div className="border-t border-zinc-100/90 px-4 py-3 pr-5 text-[13px] leading-relaxed text-zinc-700">
        {children}
      </div>
    </div>
  );
}

export type PostureMetricVariant = "status" | "compact";

export function PostureMetricCell({
  label,
  value,
  sub,
  valueClassName = "text-zinc-900",
}: {
  label?: string;
  value: ReactNode;
  sub?: string;
  valueClassName?: string;
  variant?: PostureMetricVariant;
}) {
  if (!label) return null;
  return <FindingTimelineStat label={label} value={value} sub={sub} valueClassName={valueClassName} />;
}

export function PostureMetricsRow({ children }: { children: ReactNode }) {
  return <FindingTimelineGrid>{children}</FindingTimelineGrid>;
}

/** Resource tab hero — type + name with severity accent. */
export function ResourceInspectorHero({
  badge,
  title,
  severity,
}: {
  badge: string;
  title: string;
  severity?: string;
}) {
  const accent =
    severity === "critical" || severity === "high"
      ? "bg-red-500"
      : severity === "medium"
        ? "bg-amber-400"
        : "bg-zinc-300";
  return (
    <div className="flex gap-3 border-b border-zinc-100 bg-gradient-to-br from-white via-white to-zinc-50/70 px-4 py-3.5">
      <div className={`mt-0.5 h-9 w-1 shrink-0 rounded-full ${accent}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-zinc-500">{badge}</p>
        <h3 className="mt-0.5 text-[15px] font-semibold leading-snug tracking-normal text-zinc-900">
          {title}
        </h3>
      </div>
    </div>
  );
}

export function FindingTimelineGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-sm shadow-zinc-950/[0.03] sm:grid-cols-4 sm:divide-y-0">
      {children}
    </div>
  );
}

export function FindingTimelineStat({
  label,
  value,
  sub,
  valueClassName = "text-zinc-900",
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  valueClassName?: string;
}) {
  const numericValue = typeof value === "number";
  return (
    <div className="px-3.5 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide leading-none text-zinc-400">{label}</p>
      <div
        className={`mt-1.5 text-[15px] font-semibold leading-snug ${numericValue ? "tabular-nums" : ""} ${valueClassName}`}
      >
        {value}
      </div>
      {sub ? <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{sub}</p> : null}
    </div>
  );
}

export function FlowCallout({
  title,
  children,
  tone = "neutral",
}: {
  title: string;
  children: ReactNode;
  tone?: "neutral" | "positive";
}) {
  const shell =
    tone === "positive"
      ? "border-emerald-200/70 bg-emerald-50/40"
      : "border-zinc-200/80 bg-zinc-50/60";
  return (
    <div className={`rounded-xl border px-4 py-3 pr-5 ${shell}`}>
      <p className="text-[12px] font-semibold text-zinc-800">{title}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-zinc-600">{children}</p>
    </div>
  );
}

export function FlowBadge({
  children,
  variant = "neutral",
}: {
  children: ReactNode;
  variant?: "neutral" | "caution" | "high" | "positive" | "muted";
}) {
  const cls =
    variant === "high"
      ? "bg-amber-100 text-amber-900 ring-amber-200/80"
      : variant === "caution"
        ? "bg-amber-50 text-amber-800 ring-amber-200/60"
        : variant === "positive"
          ? "bg-emerald-100 text-emerald-900 ring-emerald-200/70"
          : variant === "muted"
            ? "bg-zinc-100 text-zinc-600 ring-zinc-200/80"
            : "bg-zinc-100 text-zinc-700 ring-zinc-200/80";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${cls}`}>
      {children}
    </span>
  );
}

function ExceptionDetailCell({
  label,
  children,
  muted = false,
}: {
  label: string;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-amber-200/45 bg-white/75 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-800/70">{label}</p>
      <div className={`mt-1 text-[13px] leading-relaxed ${muted ? "text-zinc-400" : "text-zinc-800"}`}>{children}</div>
    </div>
  );
}

export function ExceptionFlowPanel({
  reason,
  approvedBy,
  expiresAt,
}: {
  reason?: string | null;
  approvedBy?: string | null;
  expiresAt?: string | null;
}) {
  const hasApprovedBy = Boolean(approvedBy?.trim());
  const hasExpiry = Boolean(expiresAt);
  const hasReason = Boolean(reason?.trim());

  return (
    <div className="w-full overflow-hidden rounded-xl border border-amber-200/70 bg-white shadow-sm shadow-amber-900/[0.04]">
      <div className="flex items-start justify-between gap-3 border-b border-amber-100/80 bg-gradient-to-r from-amber-50/90 via-white to-white px-4 py-3 pr-5">
        <div>
          <div className="flex items-center gap-2">
            <FlowBadge variant="caution">Exception</FlowBadge>
            <span className="text-[12px] font-semibold text-zinc-900">Documented risk acceptance</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            Kept in the evidence pack for auditor review.
          </p>
        </div>
      </div>

      <div className="grid gap-2 px-4 py-3 pr-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <ExceptionDetailCell label="Reason" muted={!hasReason}>
            {hasReason ? reason : "No reason captured"}
          </ExceptionDetailCell>
        </div>
        <ExceptionDetailCell label="Approved by" muted={!hasApprovedBy}>
          {hasApprovedBy ? approvedBy : "Not captured"}
        </ExceptionDetailCell>
        <ExceptionDetailCell label="Expires" muted={!hasExpiry}>
          {hasExpiry ? new Date(expiresAt!).toLocaleDateString() : "No expiry set"}
        </ExceptionDetailCell>
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

/** Semantic group — field rows or nested content inside resource inspector. */
export function ResourceGroup({
  children,
  className = "",
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <div className={`border-t border-[#eef2f6] ${className}`}>
      {title ? (
        <div className="border-b border-zinc-100 bg-white px-4 pt-3 pb-0">
          <p className="text-[11px] font-semibold text-zinc-700">{title}</p>
        </div>
      ) : null}
      <div className="bg-white px-4 py-3">{children}</div>
    </div>
  );
}

export function ResourceFieldRow({
  label,
  children,
  mono,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  const valueClass = mono
    ? `${drawerSummaryValue} font-mono text-[12px] break-all text-[#111827]`
    : drawerSummaryValue;
  return (
    <div className="grid grid-cols-[6.75rem_1fr] gap-x-4 border-b border-[#eef2f6] py-3 last:border-b-0 sm:grid-cols-[7.25rem_1fr]">
      <dt className="pt-0.5 text-[11px] font-medium text-zinc-500">{label}</dt>
      <dd className={`min-w-0 ${valueClass}`}>{children}</dd>
    </div>
  );
}

export function ResourceGroupBlock({
  tag,
  title,
  children,
  defaultOpen = true,
}: {
  tag: string;
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-[#eef2f6] first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 ${drawerSectionHead} text-left hover:bg-[#f8fafc]`}
      >
        <Chevron open={open} />
        <span className={drawerSummaryLabel}>{tag}</span>
        <span className={`${drawerSummaryValueStrong} normal-case tracking-normal`}>{title}</span>
      </button>
      {open && <div className="border-t border-[#eef2f6] bg-white px-4 py-3">{children}</div>}
    </div>
  );
}
