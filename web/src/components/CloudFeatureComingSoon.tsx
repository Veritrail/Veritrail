import { ProviderMark, providerDisplayName, type ScopeProvider } from "./AccountSelect";
import "../styles/cloud-feature-coming-soon.css";

type CloudFeatureComingSoonProps = {
  provider?: ScopeProvider;
  featureName: string;
  description?: string;
  className?: string;
};

export function CloudFeatureComingSoon({
  provider,
  featureName,
  description,
  className,
}: CloudFeatureComingSoonProps) {
  const providerLabel = providerDisplayName(provider);
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
      <div className="cloud-feature-coming-soon__heading-row">
        <p className="cloud-feature-coming-soon__title">
          {providerLabel} {featureName}
        </p>
        <span className="cloud-feature-coming-soon__badge">
          <span className="cloud-feature-coming-soon__badge-dot" aria-hidden />
          Coming soon
        </span>
      </div>
      {description ? <p className="cloud-feature-coming-soon__description">{description}</p> : null}
    </div>
  );
}
