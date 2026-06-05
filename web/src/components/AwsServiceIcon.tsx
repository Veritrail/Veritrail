import { useState } from "react";
import { awsIconUrlForCheckId, awsServiceIconUrl } from "../lib/awsServiceIconMap";

type Props = {
  size?: number;
  /** Prefer check_id — maps to the correct Architecture Icon for all Vigil checks. */
  checkId?: string;
  /** IAM service prefix label (EC2, LOGS, CLOUDFRONT, …) from policy action grouping. */
  service?: string;
  className?: string;
};

export default function AwsServiceIcon({ checkId, service, size = 32, className }: Props) {
  const primary = checkId ? awsIconUrlForCheckId(checkId) : awsServiceIconUrl(service ?? "");
  const fallback = awsIconUrlForCheckId("");
  const [src, setSrc] = useState(primary);
  const [usedFallback, setUsedFallback] = useState(false);

  function onError() {
    if (!usedFallback && src !== fallback) {
      setUsedFallback(true);
      setSrc(fallback);
      return;
    }
    setSrc(fallback);
  }

  const frameClass =
    className ??
    "shrink-0 rounded-lg bg-white object-contain ring-1 ring-zinc-200/90 shadow-sm shadow-zinc-950/[0.04]";

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={frameClass}
      loading="lazy"
      decoding="async"
      onError={onError}
    />
  );
}
