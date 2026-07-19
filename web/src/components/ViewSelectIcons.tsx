import type { ReactNode } from "react";

const TRIGGER_GLYPH_CLASS = "selector-card__glyph selector-card__glyph--view";

export function EyeViewIcon({ className = TRIGGER_GLYPH_CLASS }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.75 12s3.4-6 9.25-6 9.25 6 9.25 6-3.4 6-9.25 6-9.25-6-9.25-6Z"
      />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}

export function ControlsViewIcon({ className = TRIGGER_GLYPH_CLASS }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" />
      <rect x="13" y="13" width="7.5" height="7.5" rx="1.5" />
    </svg>
  );
}

export function CriteriaViewIcon({ className = TRIGGER_GLYPH_CLASS }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 5.5H8a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-11a2 2 0 0 0-2-2h-1"
      />
      <path strokeLinecap="round" d="M9.5 5.5a2.5 2.5 0 0 1 5 0" />
      <path strokeLinecap="round" d="M8.5 12.5h7M8.5 16h5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m9.25 10.75 1.25 1.25 2.5-2.5" />
    </svg>
  );
}

export function ActivityViewIcon({ className = TRIGGER_GLYPH_CLASS }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <circle cx="5.5" cy="7.5" r="1.75" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="12" r="1.75" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="16.5" r="1.75" fill="currentColor" stroke="none" />
      <path strokeLinecap="round" d="M10 7.5h9.5M10 12h7M10 16.5h8.5" />
    </svg>
  );
}

export function viewValueIcon(value: string): ReactNode {
  switch (value) {
    case "controls":
      return <ControlsViewIcon />;
    case "checks":
      return <CriteriaViewIcon />;
    case "activity":
      return <ActivityViewIcon />;
    default:
      return null;
  }
}
