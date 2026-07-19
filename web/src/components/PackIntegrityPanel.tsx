import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { signingKeySchema } from "../lib/apiSchemas";

export type PackIntegrityPanelProps = {
  /** Compact variant for auditor portal cards */
  variant?: "default" | "auditor";
  /** ZIP SHA-256 from download response header or prior export record */
  zipSha256?: string | null;
  /** Report id when known */
  reportId?: string | null;
  className?: string;
};

function truncateHash(hash: string, keep = 12): string {
  if (hash.length <= keep * 2) return hash;
  return `${hash.slice(0, keep)}…${hash.slice(-8)}`;
}

export function PackIntegrityPanel({
  variant = "default",
  zipSha256,
  reportId,
  className,
}: PackIntegrityPanelProps) {
  const signingKey = useQuery({
    queryKey: ["evidence-pack-signing-key"],
    queryFn: () => api("/v1/meta/evidence-pack-signing-key", { schema: signingKeySchema }),
    staleTime: 60_000,
  });

  const enabled = signingKey.data?.enabled === true;
  const isAuditor = variant === "auditor";

  return (
    <section
      className={
        className ??
        (isAuditor
          ? "rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm"
          : "rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm")
      }
      aria-label="Pack integrity"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p
          className={
            isAuditor
              ? "text-xs font-semibold uppercase tracking-wider text-zinc-500"
              : "text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
          }
        >
          Verify this pack
        </p>
        {signingKey.isSuccess && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
              enabled
                ? "bg-emerald-50 text-emerald-900 ring-emerald-200/80"
                : "bg-zinc-100 text-zinc-700 ring-zinc-200/80"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-emerald-500" : "bg-zinc-400"}`}
              aria-hidden
            />
            Signature {enabled ? "enabled" : "not configured"}
          </span>
        )}
      </div>

      {zipSha256 ? (
        <p className="mt-2 font-mono text-xs text-zinc-800">
          ZIP SHA-256:{" "}
          <span title={zipSha256} className="break-all">
            {truncateHash(zipSha256)}
          </span>
          <button
            type="button"
            className="ml-2 text-[11px] font-semibold text-[#439385] hover:underline"
            onClick={() => void navigator.clipboard?.writeText(zipSha256)}
          >
            Copy
          </button>
        </p>
      ) : (
        <p className="mt-2 text-xs text-zinc-600">
          After download, the ZIP SHA-256 is returned in the{" "}
          <code className="rounded bg-zinc-100 px-1 text-[11px]">X-Veritrail-Pack-SHA256</code>{" "}
          response header.
        </p>
      )}

      {reportId ? (
        <p className="mt-1 font-mono text-[11px] text-zinc-500">Report ID: {reportId}</p>
      ) : null}

      <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-zinc-600">
        <li>
          Unzip the pack and confirm each file matches{" "}
          <code className="rounded bg-zinc-100 px-1 text-[11px]">checksum_manifest.json</code>.
        </li>
        <li>
          When present, verify{" "}
          <code className="rounded bg-zinc-100 px-1 text-[11px]">pack_signature.json</code> (Ed25519
          over the checksum manifest) with the public key below.
        </li>
        <li>
          Review{" "}
          <code className="rounded bg-zinc-100 px-1 text-[11px]">source_manifest.json</code> →{" "}
          <code className="rounded bg-zinc-100 px-1 text-[11px]">pack_provenance</code> for build
          lineage (pack version, check registry hash, git SHA).
        </li>
      </ol>

      {enabled && signingKey.data?.public_key_base64 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-zinc-700">
            Public signing key ({signingKey.data.algorithm} · {signingKey.data.key_id})
          </summary>
          <p className="mt-2 break-all font-mono text-[10px] leading-relaxed text-zinc-600">
            {signingKey.data.public_key_base64}
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            Also available at{" "}
            <code className="rounded bg-zinc-100 px-1">GET /v1/meta/evidence-pack-signing-key</code>.
          </p>
        </details>
      ) : signingKey.isSuccess && !enabled ? (
        <p className="mt-3 text-[11px] text-zinc-500">
          Pack signing is not configured on this deployment. Checksums in the manifest still support
          tamper detection after download.
        </p>
      ) : null}
    </section>
  );
}

/** Read integrity headers from an evidence-pack download response. */
export function packIntegrityFromResponse(res: Response): {
  zipSha256: string | null;
  reportId: string | null;
} {
  return {
    zipSha256:
      res.headers.get("X-Veritrail-Pack-SHA256") ?? res.headers.get("X-Content-SHA256") ?? null,
    reportId: res.headers.get("X-Veritrail-Report-Id"),
  };
}
