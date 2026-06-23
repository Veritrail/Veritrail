/** Shared row indicator for History filter / page-size menus. */
export function HistoryMenuCheckmark({ selected, className = "history-menu-check" }: { selected: boolean; className?: string }) {
  return (
    <span className={`${className}${selected ? ` ${className}--on` : ""}`} aria-hidden>
      {selected ? (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path
            d="M2.5 6.5L5 9l4.5-5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  );
}
