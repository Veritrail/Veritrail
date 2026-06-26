import { api, formatApiError, token } from "../api";
import type { ExternalEvidenceArtifact } from "./externalEvidence";

const API_BASE = (import.meta.env.VITE_API_URL as string) || "http://localhost:8000";

export async function downloadEvidenceArtifact(item: ExternalEvidenceArtifact) {
  if (item.external_url) {
    window.open(item.external_url, "_blank", "noopener,noreferrer");
    return;
  }
  if (!item.filename && !item.id) {
    throw new Error("No file available to download");
  }

  const auth = token();
  const res = await fetch(`${API_BASE}/v1/controls/evidence/${item.id}/download`, {
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
    credentials: "include",
  });
  if (!res.ok) {
    let message = "Download failed";
    try {
      message = formatApiError(await res.json());
    } catch {
      message = formatApiError(await res.text());
    }
    throw new Error(message);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await res.json()) as { url: string };
    window.open(body.url, "_blank", "noopener,noreferrer");
    return;
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = item.filename || "evidence";
  a.click();
  URL.revokeObjectURL(url);
}
