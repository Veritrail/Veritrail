import { Link } from "react-router-dom";

import {
  ProviderMark,
  providerDisplayName,
  type AccountOption,
  type ScopeProvider,
} from "./AccountSelect";
import { findingsPageHref } from "../hooks/useConnectedAccountOptions";
import "../styles/cloud-feature-coming-soon.css";

type CloudFeaturePage = "history" | "compliance";

type CloudFeatureComingSoonProps = {
  page: CloudFeaturePage;
  provider?: ScopeProvider;
  account?: AccountOption;
  className?: string;
};

function providerHeadlineName(provider?: ScopeProvider): string {
  switch (provider) {
    case "gcp":
      return "Google Cloud";
    case "azure":
      return "Azure";
    default:
      return providerDisplayName(provider);
  }
}

function pageCopy(page: CloudFeaturePage, provider?: ScopeProvider): { headline: string; description: string } {
  const providerLabel = providerHeadlineName(provider);

  if (page === "history") {
    return {
      headline: `${providerLabel} history`,
      description:
        "Timeline activity, posture changes, and remediation events will appear here soon.",
    };
  }

  return {
    headline: `${providerLabel} compliance`,
    description:
      "Control groups, framework rollups, and audit packages for this cloud provider will appear here soon.",
  };
}

function ExternalLinkIcon() {
  return (
    <svg
      className="cloud-feature-coming-soon__cta-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H18m0 0v4.5M18 6l-7.5 7.5M6 18h12" />
    </svg>
  );
}

export function CloudFeatureComingSoon({
  page,
  provider,
  account,
  className,
}: CloudFeatureComingSoonProps) {
  const { headline, description } = pageCopy(page, provider);
  const rootClass = ["cloud-feature-coming-soon", className].filter(Boolean).join(" ");

  return (
    <div className={rootClass}>
      <div className="cloud-feature-coming-soon__icon-box" aria-hidden>
        <ProviderMark
          provider={provider}
          variant="compact"
          className={`cloud-feature-coming-soon__provider cloud-feature-coming-soon__provider--${provider ?? "aws"}`}
        />
      </div>

      <span className="cloud-feature-coming-soon__badge">
        <span className="cloud-feature-coming-soon__badge-dot" aria-hidden />
        Coming soon
      </span>

      <h2 className="cloud-feature-coming-soon__headline">{headline}</h2>
      <p className="cloud-feature-coming-soon__description">{description}</p>

      <Link to={findingsPageHref(account)} className="cloud-feature-coming-soon__cta">
        View current findings
        <ExternalLinkIcon />
      </Link>
    </div>
  );
}
