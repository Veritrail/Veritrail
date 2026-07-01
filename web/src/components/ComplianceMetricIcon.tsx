export type ComplianceMetricIconKind = "automated" | "external" | "blocking" | "evidence";

/** Shared SVG paths for compliance metric / readiness labels. */
export function ComplianceMetricIconGlyph({ kind }: { kind: ComplianceMetricIconKind }) {
  if (kind === "automated") {
    return (
      <>
        <path strokeLinecap="round" d="M12 4.5v2" />
        <circle cx="12" cy="3.6" r="0.9" fill="currentColor" stroke="none" />
        <rect x="5" y="8.5" width="14" height="10" rx="3" />
        <path strokeLinecap="round" d="M3 12.5h2M19 12.5h2" />
        <circle cx="9.3" cy="13.3" r="1.1" fill="currentColor" stroke="none" />
        <circle cx="14.7" cy="13.3" r="1.1" fill="currentColor" stroke="none" />
        <path strokeLinecap="round" d="M9.5 16.3h5" />
      </>
    );
  }
  if (kind === "external") {
    return (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path strokeLinecap="round" d="M3.5 12h17" />
        <path strokeLinecap="round" d="M12 3.5c2.6 2.6 2.6 14.4 0 17" />
        <path strokeLinecap="round" d="M12 3.5c-2.6 2.6-2.6 14.4 0 17" />
      </>
    );
  }
  if (kind === "evidence") {
    return (
      <>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 4h6l4 4v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="M14 4v4h4" />
        <path strokeLinecap="round" d="M9 13h6M9 17h4" />
      </>
    );
  }
  return (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2Zm10-10V7a4 4 0 0 0-8 0v2"
    />
  );
}
