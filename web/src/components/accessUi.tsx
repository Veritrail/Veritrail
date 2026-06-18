// Shared building blocks for the Access settings (auditors + members) so both
// subsections read as one calm, product-grade panel: titled cards, people rows,
// contained composers, status pills — not spreadsheet tables.
import type { ReactNode } from "react";

export const accessInput =
  "access-input";

export const accessPrimaryBtn =
  "access-primary-btn";

export const accessGhostBtn =
  "access-ghost-btn";

export const accessDangerBtn =
  "access-danger-btn";

export const accessComposer = "access-invite-card";

export function AccessCard({
  title,
  description,
  status,
  hideHeader = false,
  children,
}: {
  title: string;
  description: string;
  status?: ReactNode;
  hideHeader?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`access-card${hideHeader ? " access-card--no-header" : ""}`}>
      {!hideHeader && (
        <div className="access-card__header">
          <span className="access-card__icon" aria-hidden>
            <svg fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm6 1.125a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
            </svg>
          </span>
          <div className="access-card__title-wrap">
            <h3 className="access-card__title">{title}</h3>
            <p className="access-card__description">{description}</p>
          </div>
          {status && <div className="access-card__status">{status}</div>}
        </div>
      )}
      <div className="access-card__body">{children}</div>
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
    <div className={`access-avatar ${tone}`}>
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
    <span className={`access-status-pill ${cls}`}>
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
    <div className="access-row">
      <Avatar email={email} />
      <div className="access-row__identity">
        <p className="access-row__email">{email}</p>
        <p className="access-row__meta">{meta}</p>
      </div>
      {right && <div className="access-row__right">{right}</div>}
      {actions && <div className="access-row__actions">{actions}</div>}
    </div>
  );
}
