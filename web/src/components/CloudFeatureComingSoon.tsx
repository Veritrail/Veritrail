import {
  ProviderMark,
  providerDisplayName,
  type ScopeProvider,
} from "./AccountSelect";
import "../styles/cloud-feature-coming-soon.css";

type CloudFeaturePage = "history" | "compliance";

type CloudFeatureComingSoonProps = {
  page: CloudFeaturePage;
  provider?: ScopeProvider;
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

export function CloudFeatureComingSoon({
  page,
  provider,
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

      <p className="cloud-feature-coming-soon__status">Coming soon</p>

      <h2 className="cloud-feature-coming-soon__headline">{headline}</h2>
      <p className="cloud-feature-coming-soon__description">{description}</p>
    </div>
  );
}
