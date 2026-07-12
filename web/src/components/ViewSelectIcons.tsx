import type { ReactNode } from "react";

const MENU_ICON_CLASS = "history-filter-menu__icon history-filter-menu__icon--view";
const TRIGGER_GLYPH_CLASS = "selector-card__glyph selector-card__glyph--view";

export function ControlsViewIcon({ className = MENU_ICON_CLASS }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function CriteriaViewIcon({ className = MENU_ICON_CLASS }: { className?: string }) {
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
        d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"
      />
      <path strokeLinecap="round" d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
      <path strokeLinecap="round" d="M9 12h6M9 16h4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m13.5 11.25 1.5 1.5 3-3" />
    </svg>
  );
}

export function ActivityViewIcon({ className = MENU_ICON_CLASS }: { className?: string }) {
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
        d="M4 6.5h16M4 12h10M4 17.5h7"
      />
      <circle cx="17.5" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="20" cy="17.5" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function viewOptionIcon(value: string): ReactNode {
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

export function viewValueIcon(value: string): ReactNode {
  switch (value) {
    case "controls":
      return <ControlsViewIcon className={TRIGGER_GLYPH_CLASS} />;
    case "checks":
      return <CriteriaViewIcon className={TRIGGER_GLYPH_CLASS} />;
    case "activity":
      return <ActivityViewIcon className={TRIGGER_GLYPH_CLASS} />;
    default:
      return null;
  }
}
