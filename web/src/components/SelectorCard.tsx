import { forwardRef, type ReactNode } from "react";

/** Static selector-card shell for header segmented toggles (View, etc.). */
export function HeaderSegmentCard({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={["selector-card selector-card--segment shrink-0", className].filter(Boolean).join(" ")}>
      <span className="selector-card__body">
        <span className="selector-card__label">{label}</span>
        <span className="selector-card__segment">{children}</span>
      </span>
    </div>
  );
}

export type SelectorCardIconTone = "account" | "period" | "framework" | "group" | "neutral";

function FilterChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`selector-card__chevron${open ? " selector-card__chevron--open" : ""}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}

export type SelectorCardProps = {
  icon?: ReactNode;
  label: string;
  value: string;
  open?: boolean;
  iconTone?: SelectorCardIconTone;
  className?: string;
} & Omit<React.ComponentPropsWithoutRef<"button">, "children">;

export const SelectorCard = forwardRef<HTMLButtonElement, SelectorCardProps>(function SelectorCard(
  { icon, label, value, open = false, iconTone = "neutral", className = "", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={[
        "selector-card",
        open ? "selector-card--open" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {icon ? (
        <span className={`selector-card__icon-box selector-card__icon-box--${iconTone}`}>{icon}</span>
      ) : null}
      <span className="selector-card__body">
        <span className="selector-card__label">{label}</span>
        <span className="selector-card__value">{value}</span>
      </span>
      <FilterChevron open={open} />
    </button>
  );
});

export function PeriodSelectorIcon() {
  return (
    <svg
      className="selector-card__glyph selector-card__glyph--period"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
      <path strokeLinecap="round" d="M8 3.5v4M16 3.5v4M3.5 10h17" />
    </svg>
  );
}

export function GroupSelectorIcon() {
  return (
    <svg
      className="selector-card__glyph selector-card__glyph--group"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <circle cx="9" cy="8.5" r="2.75" />
      <circle cx="16.5" cy="9.75" r="2.25" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.75 18.25c0-2.1 1.9-3.75 4.25-3.75s4.25 1.65 4.25 3.75M13.5 18.25c0-1.65 1.35-3 3-3 .85 0 1.62.35 2.17.92"
      />
    </svg>
  );
}
