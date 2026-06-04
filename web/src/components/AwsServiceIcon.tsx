import { useState } from "react";
import { awsIconUrlForCheckId, awsServiceIconUrl } from "../lib/awsServiceIconMap";

type Props = {
  size?: number;
  /** Prefer check_id — maps to the correct Architecture Icon for all Vigil checks. */
  checkId?: string;
  /** Legacy: service label from ARN parsing (Finding drawer). */
  service?: string;
};

export default function AwsServiceIcon({ checkId, service, size = 32 }: Props) {
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

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-md bg-white object-contain ring-1 ring-zinc-200/80"
      loading="lazy"
      decoding="async"
      onError={onError}
    />
  );
}
