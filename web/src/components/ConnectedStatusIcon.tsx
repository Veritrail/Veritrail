/** Connected checkmark — same mark as Accounts list rows (`VerifiedBadgeIcon`). */
export function ConnectedStatusIcon({ className = "" }: { className?: string }) {
  return (
    <span className={`connected-status-icon ${className}`.trim()} title="Connected" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" fill="#2563eb" />
        <path
          d="m8.5 12.2 2.2 2.2L15.8 9.4"
          stroke="#fff"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
