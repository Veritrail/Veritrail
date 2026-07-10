type FrameworkMarkProps = {
  framework: string;
  className?: string;
};

const markSize = "h-9 w-9 shrink-0";

function Soc2Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 36"
      className={className ?? markSize}
      role="img"
      aria-label="SOC 2"
    >
      <circle cx="18" cy="18" r="18" fill="#0f2b46" />
      <text
        x="18"
        y="13.5"
        textAnchor="middle"
        fill="#ffffff"
        fontSize="5.5"
        fontWeight="600"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        AICPA
      </text>
      <text
        x="18"
        y="22.5"
        textAnchor="middle"
        fill="#ffffff"
        fontSize="8"
        fontWeight="700"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        SOC
      </text>
    </svg>
  );
}

function CisMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 36"
      className={className ?? markSize}
      role="img"
      aria-label="CIS"
    >
      <circle cx="18" cy="18" r="17.5" fill="#ffffff" stroke="#d0d5dd" strokeWidth="1" />
      <path
        d="M6 18a12 12 0 0 1 12-12"
        fill="none"
        stroke="#1d4ed8"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
      <path
        d="M6 18a12 12 0 0 0 12 12"
        fill="none"
        stroke="#1d4ed8"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
      <text
        x="20"
        y="20.5"
        textAnchor="middle"
        fill="#1d4ed8"
        fontSize="9"
        fontWeight="700"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        CIS
      </text>
    </svg>
  );
}

function IsoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 36"
      className={className ?? markSize}
      role="img"
      aria-label="ISO 27001"
    >
      <circle cx="18" cy="18" r="18" fill="#005eb8" />
      <text
        x="18"
        y="21.5"
        textAnchor="middle"
        fill="#ffffff"
        fontSize="10"
        fontWeight="700"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        ISO
      </text>
    </svg>
  );
}

function GdprMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 36"
      className={className ?? markSize}
      role="img"
      aria-label="GDPR Article 32"
    >
      <circle cx="18" cy="18" r="18" fill="#1e3a5f" />
      <text
        x="18"
        y="21.5"
        textAnchor="middle"
        fill="#ffffff"
        fontSize="8"
        fontWeight="700"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        GDPR
      </text>
    </svg>
  );
}

function GenericMark({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full border border-[#d0d5dd] bg-[#f9fafb] text-[10px] font-semibold uppercase tracking-wide text-[#475467] ${className ?? markSize}`}
      aria-hidden
    >
      ?
    </span>
  );
}

export function FrameworkMark({ framework, className }: FrameworkMarkProps) {
  if (framework === "soc2") return <Soc2Mark className={className} />;
  if (framework === "cis_aws_l1") return <CisMark className={className} />;
  if (framework === "iso27001") return <IsoMark className={className} />;
  if (framework === "gdpr") return <GdprMark className={className} />;
  return <GenericMark className={className} />;
}
