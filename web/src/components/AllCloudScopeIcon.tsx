/** 3×3 dot grid for the "All cloud accounts" scope — neutral, no provider logos. */
export function AllCloudScopeIcon({ className = "all-cloud-scope-icon" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="4" cy="4" r="1.25" fill="currentColor" />
      <circle cx="8" cy="4" r="1.25" fill="currentColor" />
      <circle cx="12" cy="4" r="1.25" fill="currentColor" />
      <circle cx="4" cy="8" r="1.25" fill="currentColor" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
      <circle cx="12" cy="8" r="1.25" fill="currentColor" />
      <circle cx="4" cy="12" r="1.25" fill="currentColor" />
      <circle cx="8" cy="12" r="1.25" fill="currentColor" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" />
    </svg>
  );
}
