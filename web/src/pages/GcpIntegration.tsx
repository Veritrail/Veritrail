import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useState } from "react";
import { api, formatApiError } from "../api";
import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import { IntegrationScanErrorStatus } from "../components/IntegrationScanErrorStatus";
import { GcpConnectFlow } from "../components/cloudConnect/GcpConnectFlow";
import { useIntegrationScanFailureNotifications } from "../hooks/useIntegrationScanFailureNotifications";
import { useRecheckNotifications } from "../context/RecheckNotificationsContext";
import { scanFailureAccountLabel } from "../lib/scanFailureMessages";
import { authMethodLabel, type GcpProject } from "../lib/gcpConnectSetup";
import "../styles/accounts-page.css";

function statusClass(status: string) {
  if (status === "connected") return "integration-setup__status integration-setup__status--connected";
  if (status === "error") return "integration-setup__status integration-setup__status--error";
  return "integration-setup__status integration-setup__status--pending";
}

export default function GcpIntegration() {
  const qc = useQueryClient();
  const { reportScanFailure } = useRecheckNotifications();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["gcp-projects"],
    queryFn: () => api<GcpProject[]>("/v1/integrations/gcp/projects"),
  });

  const [listActionMessage, setListActionMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [actionState, setActionState] = useState<string | null>(null);
  const [showConnectForm, setShowConnectForm] = useState(false);

  const projects = data ?? [];
  const connected = projects.some((p) => p.status === "connected");
  const showConnect = projects.length === 0 || showConnectForm;
  useIntegrationScanFailureNotifications(
    projects.map((p) => ({
      id: p.id,
      last_error: p.last_error,
      last_scan_at: p.last_scan_at,
      label: p.label,
      external_id: p.project_id,
      provider: "gcp",
    })),
  );

  async function verifyProject(id: string) {
    const project = projects.find((p) => p.id === id);
    setActionState(id);
    try {
      const result = await api<{
        ok: boolean;
        degraded_checks?: Array<{ check_id: string; api: string; reason: string }>;
      }>(`/v1/integrations/gcp/projects/${id}/verify`, { method: "POST", body: "{}" });
      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
      const degraded = result.degraded_checks ?? [];
      if (degraded.length > 0) {
        const summary = degraded.map((row) => row.check_id).join(", ");
        setListActionMessage({
          tone: "ok",
          text: `Connected with degraded checks (${summary}). Grant the scanner role additional read permissions and verify again.`,
        });
      } else {
        setListActionMessage({ tone: "ok", text: "GCP connection verified." });
      }
    } catch (e) {
      const message = formatApiError(e);
      reportScanFailure({
        accountId: id,
        accountLabel: scanFailureAccountLabel({
          label: project?.label,
          externalId: project?.project_id,
        }),
        provider: "gcp",
        message,
      });
    } finally {
      setActionState(null);
    }
  }

  async function scanProject(id: string) {
    const project = projects.find((p) => p.id === id);
    setActionState(`scan-${id}`);
    setListActionMessage(null);
    try {
      await api(`/v1/integrations/gcp/projects/${id}/scan`, { method: "POST", body: "{}" });
      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
      qc.invalidateQueries({ queryKey: ["cloud-accounts"] });
      setListActionMessage({
        tone: "ok",
        text: "Scan queued. Findings will update when the scan completes.",
      });
    } catch (e) {
      const message = formatApiError(e);
      setListActionMessage({ tone: "error", text: "Scan failed — see notifications" });
      reportScanFailure({
        accountId: id,
        accountLabel: scanFailureAccountLabel({
          label: project?.label,
          externalId: project?.project_id,
        }),
        provider: "gcp",
        message,
      });
    } finally {
      setActionState(null);
    }
  }

  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/v1/integrations/gcp/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
      qc.invalidateQueries({ queryKey: ["cloud-accounts"] });
    },
  });

  return (
    <div className="accounts-cloud-connect-page">
      <p className="accounts-cloud-connect-page__breadcrumb">
        <Link to="/integrations">Integrations</Link>
        {" / "}Google Cloud
      </p>

      <header className="accounts-cloud-connect-page__header">
        <div className="accounts-cloud-connect-page__brand">
          <IntegrationBrandIcon brand="gcp" size={48} />
          <div>
            <div className="accounts-cloud-connect-page__title-row">
              <h1 className="accounts-cloud-connect-page__title">Google Cloud</h1>
              {connected ? <span className="accounts-cloud-connect-page__badge">Connected</span> : null}
            </div>
            <p className="accounts-cloud-connect-page__subtitle">
              Connect via service account access (recommended) or Workload Identity Federation. No customer JSON keys.
            </p>
          </div>
        </div>
      </header>

      {isLoading && <p className="accounts-cloud-connect-page__loading">Loading…</p>}

      {isError && <p className="accounts-output-panel__error">{formatApiError(error)}</p>}

      {!isLoading && !isError && showConnect ? (
        <GcpConnectFlow onComplete={() => setShowConnectForm(false)} />
      ) : null}

      {!isLoading && !isError && projects.length > 0 ? (
        <div className="accounts-cloud-connect-page__list">
          <div className="accounts-cloud-connect-page__list-head">
            <h2 className="accounts-cloud-connect-page__list-title">Connected projects</h2>
            <button
              type="button"
              className="accounts-connect-shell__back"
              onClick={() => setShowConnectForm(true)}
            >
              Add project
            </button>
          </div>
          {listActionMessage ? (
            <p
              className={
                listActionMessage.tone === "error"
                  ? "accounts-output-panel__error"
                  : "accounts-connect-col__foot-note"
              }
            >
              {listActionMessage.text}
            </p>
          ) : null}
          <ul className="accounts-cloud-connect-page__items">
            {projects.map((p) => (
              <li key={p.id} className="accounts-cloud-connect-page__item">
                <div>
                  <strong>{p.label}</strong>
                  <div className="accounts-cloud-connect-page__item-meta">
                    {p.project_id} · {authMethodLabel(p.auth_method)} ·{" "}
                    <span className={statusClass(p.status)}>{p.status}</span>
                  </div>
                  {p.last_error ? <IntegrationScanErrorStatus raw={p.last_error} /> : null}
                </div>
                <div className="accounts-cloud-connect-page__item-actions">
                  <button
                    type="button"
                    className="accounts-connect-shell__back"
                    disabled={actionState === p.id}
                    onClick={() => verifyProject(p.id)}
                  >
                    Verify
                  </button>
                  <button
                    type="button"
                    className="accounts-connect-shell__back"
                    disabled={p.status !== "connected" || actionState === `scan-${p.id}`}
                    onClick={() => scanProject(p.id)}
                  >
                    {actionState === `scan-${p.id}` ? "Scanning…" : "Scan"}
                  </button>
                  <button
                    type="button"
                    className="accounts-connect-shell__cancel"
                    onClick={() => remove.mutate(p.id)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
