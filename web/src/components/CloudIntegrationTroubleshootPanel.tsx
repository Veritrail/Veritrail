import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, formatApiError } from "../api";
import {
  classifyScanFailure,
  friendlyScanFailureMessage,
  providerShortLabel,
} from "../lib/scanFailureMessages";
import { formatSyncDetail } from "./IntegrationsUi";

export type CloudTroubleshootTarget = {
  provider: "aws" | "gcp" | "azure";
  resourceId: string;
  label: string;
  externalId?: string | null;
  lastScanAt: string | null;
  lastError: string | null;
  connected: boolean;
};

type CloudIntegrationTroubleshootPanelProps = {
  target: CloudTroubleshootTarget | null;
  onClose: () => void;
};

function verifyPath(target: CloudTroubleshootTarget): string {
  if (target.provider === "aws") return `/v1/accounts/${target.resourceId}/verify`;
  if (target.provider === "gcp") return `/v1/integrations/gcp/projects/${target.resourceId}/verify`;
  return `/v1/integrations/azure/subscriptions/${target.resourceId}/verify`;
}

function manageHref(target: CloudTroubleshootTarget): string {
  if (target.provider === "gcp") return "/integrations/gcp";
  if (target.provider === "azure") return "/integrations/azure";
  return `/accounts?account_id=${encodeURIComponent(target.resourceId)}`;
}

export function CloudIntegrationTroubleshootPanel({
  target,
  onClose,
}: CloudIntegrationTroubleshootPanelProps) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!target) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  const verify = useMutation({
    mutationFn: () =>
      api(verifyPath(target!), {
        method: "POST",
        body: target!.provider === "aws" ? JSON.stringify({ role_arn: "" }) : "{}",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cloud-accounts"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
      qc.invalidateQueries({ queryKey: ["azure-subscriptions"] });
    },
  });

  if (!target) return null;

  const providerLabel = providerShortLabel(target.provider) ?? "Cloud";
  const lastScan = formatSyncDetail(target.lastScanAt);
  const rawError = target.lastError?.trim() ?? "";
  const failureInfo = rawError ? classifyScanFailure(rawError, target.provider) : null;
  const friendlyError = rawError
    ? friendlyScanFailureMessage(rawError, {
        provider: target.provider,
        accountLabel: target.label,
      })
    : null;
  const verifyError = verify.isError ? formatApiError(verify.error) : null;

  return (
    <div className="integrations-troubleshoot-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="integrations-troubleshoot-panel"
        role="dialog"
        aria-labelledby="integrations-troubleshoot-title"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="integrations-troubleshoot-panel__head">
          <div>
            <p className="integrations-troubleshoot-panel__eyebrow">{providerLabel} integration</p>
            <h2 id="integrations-troubleshoot-title" className="integrations-troubleshoot-panel__title">
              Troubleshoot {target.label}
            </h2>
            {target.externalId ? (
              <p className="integrations-troubleshoot-panel__meta">{target.externalId}</p>
            ) : null}
          </div>
          <button type="button" className="integrations-troubleshoot-panel__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="integrations-troubleshoot-panel__body">
          <dl className="integrations-troubleshoot-panel__facts">
            <div>
              <dt>Connection</dt>
              <dd>{target.connected ? "Connected" : "Not connected"}</dd>
            </div>
            <div>
              <dt>Last successful scan</dt>
              <dd>{target.lastScanAt ? lastScan.primary : "Never"}</dd>
            </div>
          </dl>

          {failureInfo ? (
            <div className="integrations-troubleshoot-panel__alert">
              <p className="integrations-troubleshoot-panel__alert-title">{failureInfo.title}</p>
              <p className="integrations-troubleshoot-panel__alert-fix">{failureInfo.fix}</p>
              {friendlyError ? (
                <p className="integrations-troubleshoot-panel__alert-detail">{friendlyError}</p>
              ) : null}
            </div>
          ) : (
            <p className="integrations-troubleshoot-panel__muted">
              No recent scan error on record. Run a connectivity check to confirm access.
            </p>
          )}

          {verifyError ? (
            <p className="integrations-troubleshoot-panel__error" role="alert">
              {verifyError}
            </p>
          ) : null}
          {verify.isSuccess ? (
            <p className="integrations-troubleshoot-panel__success" role="status">
              Connectivity check passed. You can run a scan from Accounts or Findings.
            </p>
          ) : null}
        </div>

        <footer className="integrations-troubleshoot-panel__foot">
          <button
            type="button"
            className="integrations-troubleshoot-panel__primary"
            onClick={() => verify.mutate()}
            disabled={verify.isPending}
          >
            {verify.isPending ? "Running check…" : "Run connectivity check"}
          </button>
          <a href={manageHref(target)} className="integrations-troubleshoot-panel__secondary">
            Open integration settings
          </a>
        </footer>
      </aside>
    </div>
  );
}

function cloudIntegrationHealth(opts: {
  scanning?: boolean;
  lastScanAt?: string | null;
  lastError?: string | null;
}): { healthLabel: string; healthTone: Tone } {
  if (opts.scanning) return { healthLabel: "Scanning", healthTone: "sync" };
  if (opts.lastError?.trim()) return { healthLabel: "Needs attention", healthTone: "danger" };
  if (opts.lastScanAt) return { healthLabel: "Healthy", healthTone: "ok" };
  return { healthLabel: "Awaiting scan", healthTone: "idle" };
}

type Tone = "ok" | "warn" | "idle" | "sync" | "danger";

export { cloudIntegrationHealth };
