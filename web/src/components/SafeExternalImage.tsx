import { useState, type ReactNode } from "react";
import { resolveTrustLogoUrl } from "../lib/safeExternalUrl";

export function SafeExternalImage({
  src,
  alt = "",
  className,
  fallback,
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  fallback: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const safeSrc = resolveTrustLogoUrl(src);

  if (!safeSrc || failed) {
    return <>{fallback}</>;
  }

  return (
    <img
      src={safeSrc}
      alt={alt}
      className={className}
      referrerPolicy="no-referrer"
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
