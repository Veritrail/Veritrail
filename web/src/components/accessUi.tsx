// Shared building blocks for the Access settings (auditors + members) so both
// subsections read as one calm, product-grade panel: titled cards, people rows,
// contained composers, status pills — not spreadsheet tables.
import type { ReactNode } from "react";

export const accessInput =
  "h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500/25";

export const accessPrimaryBtn =
  "h-10 shrink-0 rounded-lg border border-zinc-300 bg-zinc-900 px-5 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50";

export const accessGhostBtn =
  "rounded-md px-2.5 py-1.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100";

export const accessDangerBtn =
  "rounded-md px-2.5 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50";

export const accessComposer = "rounded-lg border border-zinc-200 bg-zinc-50/70 p-3";

export function AccessCard({
  title,
  description,
  status,
  children,
}: {
  title: string;
  description: string;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-zinc-900">{title}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{description}</p>
        </div>
        {status}
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

const AVATAR_TONES = [
  "bg-indigo-100 text-indigo-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-sky-100 text-sky-700",
  "bg-rose-100 text-rose-700",
  "bg-violet-100 text-violet-700",
];

export function Avatar({ email, name }: { email: string; name?: string | null }) {
  const initial = (name || email || "?").trim().charAt(0).toUpperCase() || "?";
  let hash = 0;
  for (const ch of email) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const tone = AVATAR_TONES[hash % AVATAR_TONES.length];
  return (
    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold ${tone}`}>
      {initial}
    </div>
  );
}

export function StatusPill({
  tone,
  children,
}: {
  tone: "active" | "muted" | "danger" | "info";
  children: ReactNode;
}) {
  const cls =
    tone === "active"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200/70"
      : tone === "danger"
        ? "bg-red-50 text-red-600 ring-red-200/70"
        : tone === "info"
          ? "bg-teal-50 text-teal-700 ring-teal-200/70"
          : "bg-zinc-100 text-zinc-500 ring-zinc-200/70";
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${cls}`}>
      {children}
    </span>
  );
}

/** A person/access row: avatar + identity on the left, meta + actions on the right. */
export function AccessRow({
  email,
  meta,
  right,
  actions,
}: {
  email: string;
  meta: ReactNode;
  right?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-100 bg-white px-3 py-2.5 transition hover:border-zinc-200 hover:bg-zinc-50/60">
      <Avatar email={email} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-zinc-900">{email}</p>
        <p className="mt-0.5 truncate text-xs text-zinc-500">{meta}</p>
      </div>
      {right && <div className="hidden shrink-0 flex-col items-end text-right sm:flex">{right}</div>}
      {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
    </div>
  );
}
