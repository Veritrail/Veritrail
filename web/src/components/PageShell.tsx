import type { ReactNode } from "react";

export function PageShell({
  eyebrow,
  title,
  description,
  actions,
  children,
  width = "max-w-5xl",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  return (
    <div className={`w-full min-w-0 ${width} space-y-5 pb-8`}>
      <header className="rounded-2xl border border-zinc-200 bg-white shadow-sm shadow-zinc-950/[0.03]">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-100 bg-gradient-to-br from-zinc-50 via-white to-indigo-50/30 px-4 py-3">
          <div className="min-w-0">
            {eyebrow && (
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-500">{eyebrow}</p>
            )}
            <h1 className="mt-0.5 text-xl font-bold tracking-tight text-zinc-950">{title}</h1>
            {description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-500">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </header>
      {children}
    </div>
  );
}

export function PageCard({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm shadow-zinc-950/[0.02] ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-zinc-100 px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-bold text-zinc-900">{title}</h2>}
            {description && <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
