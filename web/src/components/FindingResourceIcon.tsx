import AwsServiceIcon from "./AwsServiceIcon";
import { findingScopeProvider } from "../lib/findingDisplay";
import { AWS_LOGO_LIGHT } from "../lib/awsBrand";

type FindingLike = {
  check_id: string;
  account_provider?: string | null;
};

const PROVIDER_FAVICON: Record<string, string> = {
  aws: "/aws-account-icon.png",
  github: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
  gitlab: "/integrations/gitlab.png",
  gcp: "https://www.gstatic.com/images/branding/product/2x/google_cloud_48dp.png",
  azure: "https://azure.microsoft.com/favicon.ico",
};

function FaviconImg({
  src,
  size,
  fallback,
}: {
  src: string;
  size: number;
  fallback?: string;
}) {
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0 object-contain"
      decoding="async"
      loading="lazy"
      onError={
        fallback
          ? (event) => {
              if (event.currentTarget.src.endsWith(fallback)) return;
              event.currentTarget.src = fallback;
            }
          : undefined
      }
    />
  );
}

/** Cloud provider brand mark — AWS / GitHub / GitLab / GCP / Azure. */
export function CloudProviderFavicon({ finding, size = 16 }: { finding: FindingLike; size?: number }) {
  const scope = findingScopeProvider(finding);
  if (scope === "aws") {
    return <FaviconImg src={PROVIDER_FAVICON.aws} size={size} fallback={AWS_LOGO_LIGHT} />;
  }
  if (scope === "github") {
    return <FaviconImg src={PROVIDER_FAVICON.github} size={size} />;
  }
  if (scope === "gitlab") {
    return <FaviconImg src={PROVIDER_FAVICON.gitlab} size={size} />;
  }
  if (scope === "gcp") {
    return <FaviconImg src={PROVIDER_FAVICON.gcp} size={size} />;
  }
  if (scope === "azure") {
    return <FaviconImg src={PROVIDER_FAVICON.azure} size={size} />;
  }

  return <FaviconImg src={PROVIDER_FAVICON.aws} size={size} fallback={AWS_LOGO_LIGHT} />;
}

/** Circular provider mark for resource rows (matches reference mock). */
export function CloudProviderMark({ finding }: { finding: FindingLike }) {
  const scope = findingScopeProvider(finding);
  const imgClass =
    scope === "aws"
      ? "h-[1.35rem] w-[1.75rem] object-contain"
      : "h-5 w-5 object-contain";

  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-200/90 bg-white shadow-sm shadow-zinc-950/[0.03]">
      {scope === "aws" ? (
        <img
          src={PROVIDER_FAVICON.aws}
          alt=""
          className={imgClass}
          decoding="async"
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = AWS_LOGO_LIGHT;
          }}
        />
      ) : (
        <CloudProviderFavicon finding={finding} size={20} />
      )}
    </span>
  );
}

/** Circular service mark — matches FrameworkMark / mapped-controls row icons. */
export function AwsServiceMark({ finding, className = "h-9 w-9" }: { finding: FindingLike; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-200/90 bg-white shadow-sm shadow-zinc-950/[0.03] ${className}`}
    >
      <FindingResourceIcon finding={finding} size={22} />
    </span>
  );
}

/** AWS service Architecture Icon per check, or provider favicon for VCS. */
export function FindingResourceIcon({ finding, size = 22 }: { finding: FindingLike; size?: number }) {
  const scope = findingScopeProvider(finding);

  if (scope === "aws") {
    return (
      <AwsServiceIcon
        checkId={finding.check_id}
        size={size}
        className="shrink-0 rounded-sm object-contain"
      />
    );
  }

  if (scope === "github") {
    return <FaviconImg src={PROVIDER_FAVICON.github} size={size} />;
  }

  if (scope === "gitlab") {
    return <FaviconImg src={PROVIDER_FAVICON.gitlab} size={size} />;
  }
  if (scope === "gcp") {
    return <FaviconImg src={PROVIDER_FAVICON.gcp} size={size} />;
  }
  if (scope === "azure") {
    return <FaviconImg src={PROVIDER_FAVICON.azure} size={size} />;
  }

  return (
    <AwsServiceIcon
      checkId={finding.check_id}
      size={size}
      className="shrink-0 rounded-sm object-contain"
    />
  );
}
