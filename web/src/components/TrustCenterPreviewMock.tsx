import { SafeExternalImage } from "./SafeExternalImage";

const FRAMEWORK_LABELS: Record<string, string> = {
  soc2: "SOC 2",
  iso27001: "ISO 27001",
  cis_aws_l1: "CIS AWS L1",
};

function ShieldMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l7 2.5v5.2c0 4.4-3 8.2-7 9.3-4-1.1-7-4.9-7-9.3V5.5L12 3z"
        fill="#2563eb"
      />
      <path d="M9 12l2.2 2.2L15.5 9.9" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth={2.4} aria-hidden>
      <path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TrustCenterPreviewMock({
  companyName,
  frameworks,
  logoUrl,
}: {
  companyName: string;
  frameworks: string[];
  logoUrl?: string;
}) {
  const displayName = companyName.trim() || "Your company";
  const shortName = displayName.split(" ")[0];
  const tags = frameworks.map((key) => FRAMEWORK_LABELS[key] ?? key).slice(0, 3);

  return (
    <div className="sharing-trust-preview" aria-hidden>
      <div className="sharing-trust-preview__chrome">
        <span />
        <span />
        <span />
      </div>
      <div className="sharing-trust-preview__body">
        <div className="sharing-trust-preview__brand">
          <span className="sharing-trust-preview__logo">
            <SafeExternalImage
              src={logoUrl}
              className="sharing-trust-preview__logo-image"
              fallback={<ShieldMark />}
            />
          </span>
          <div>
            <p className="sharing-trust-preview__company">{displayName}</p>
            <p className="sharing-trust-preview__tagline">Trust Center</p>
          </div>
        </div>

        <p className="sharing-trust-preview__headline">Continuous compliance evidence, refreshed daily.</p>

        <div className="sharing-trust-preview__badges">
          <span>
            <CheckMark />
            Always up to date
          </span>
          <span>
            <CheckMark />
            Verified controls
          </span>
          <span>
            <CheckMark />
            Customer trusted
          </span>
        </div>

        <div className="sharing-trust-preview__cols">
          <div className="sharing-trust-preview__panel">
            <p className="sharing-trust-preview__section-title">Compliance</p>
            <div className="sharing-trust-preview__chips">
              {(tags.length ? tags : ["SOC 2", "ISO 27001"]).map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="sharing-trust-preview__lines">
              <span />
              <span className="is-short" />
            </div>
          </div>
          <div className="sharing-trust-preview__panel">
            <p className="sharing-trust-preview__section-title">About {shortName}</p>
            <div className="sharing-trust-preview__lines">
              <span />
              <span />
              <span className="is-short" />
            </div>
            <span className="sharing-trust-preview__pill">Updated daily</span>
          </div>
        </div>
      </div>
    </div>
  );
}
