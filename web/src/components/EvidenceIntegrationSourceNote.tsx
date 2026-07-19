import { type ReactNode } from "react";
import { formatRelativeAgo } from "./IntegrationsUi";

export type EvidenceIntegrationSource = {
  type: string;
  label: string;
  connected: boolean;
  last_synced_at: string | null;
};

const IDENTITY_INTEGRATION_TYPES = new Set(["entra", "google_workspace"]);

function integrationSourceLine(row: EvidenceIntegrationSource): string {
  const synced = row.last_synced_at ? formatRelativeAgo(row.last_synced_at) : "never synced";
  return `${row.label} · synced ${synced}`;
}

/** Quiet provenance note for live integration evidence in composite drawers. */
export function EvidenceIntegrationSourceNote({
  integrations,
  className = "",
}: {
  integrations: EvidenceIntegrationSource[] | undefined;
  className?: string;
}) {
  const rows = (integrations ?? []).filter((row) => row.connected);
  if (rows.length === 0) return null;

  const hasIdentity = rows.some((row) => IDENTITY_INTEGRATION_TYPES.has(row.type));
  const prefix = hasIdentity ? "Identity evidence from " : "Evidence from ";
  const body = rows.map((row) => (
    <span key={row.type}>
      <strong>{row.label}</strong>
      {row.last_synced_at ? <> · synced {formatRelativeAgo(row.last_synced_at)}</> : null}
    </span>
  ));

  return (
    <p className={`control-evidence-integration-note ${className}`.trim()} aria-label={prefix + rows.map(integrationSourceLine).join(", ")}>
      {prefix}
      {body.reduce<ReactNode[]>((acc, node, index) => {
        if (index > 0) acc.push(<span key={`sep-${index}`}>, </span>);
        acc.push(node);
        return acc;
      }, [])}
    </p>
  );
}
