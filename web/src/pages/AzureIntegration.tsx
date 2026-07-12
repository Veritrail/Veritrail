import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useState } from "react";
import { api, formatApiError } from "../api";
import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import { IntegrationScanErrorStatus } from "../components/IntegrationScanErrorStatus";
import { AzureConnectFlow } from "../components/cloudConnect/AzureConnectFlow";
import { useIntegrationScanFailureNotifications } from "../hooks/useIntegrationScanFailureNotifications";
import { useRecheckNotifications } from "../context/RecheckNotificationsContext";
import { scanFailureAccountLabel } from "../lib/scanFailureMessages";
import "../styles/accounts-page.css";

type AzureSubscription = {
  id: string;
  subscription_id: string;
  tenant_id: string;
  client_id: string;
  label: string;
  status: string;
  last_scan_at: string | null;
  last_error: string | null;
  has_client_secret: boolean;
};

type ListActionMessage = { tone: "ok" | "error"; text: string };

export default function AzureIntegration() {
  const qc = useQueryClient();
  const { reportScanFailure } = useRecheckNotifications();
  const { data, isLoading } = useQuery({
    queryKey: ["azure-subscriptions"],
    queryFn: () => api<AzureSubscription[]>("/v1/integrations/azure/subscriptions"),
  });

  const [listActionMessage, setListActionMessage] = useState<ListActionMessage | null>(null);
  const [actionState, setActionState] = useState<string | null>(null);
  const [showConnectForm, setShowConnectForm] = useState(false);

  const subs = data ?? [];
  const connected = subs.some((s) => s.status === "connected");
  const showConnect = subs.length === 0 || showConnectForm;
  useIntegrationScanFailureNotifications(
    subs.map((s) => ({
      id: s.id,
      last_error: s.last_error,
      last_scan_at: s.last_scan_at,
      label: s.label,
      external_id: s.subscription_id,
      provider: "azure",
    })),
  );

  async function verifySub(id: string) {
    const sub = subs.find((s) => s.id === id);
    setActionState(id);
    setListActionMessage(null);
    try {
      const result = await api<{
        ok: boolean;
        degraded_checks?: Array<{ check_id: string; api: string; reason: string }>;
      }>(`/v1/integrations/azure/subscriptions/${id}/verify`, { method: "POST", body: "{}" });
      qc.invalidateQueries({ queryKey: ["azure-subscriptions"] });
      const degraded = result.degraded_checks ?? [];
      if (degraded.length > 0) {
        const summary = degraded.map((row) => row.check_id).join(", ");
        setListActionMessage({
          tone: "ok",
          text: `Connected with degraded checks (${summary}). Grant Reader and Security Reader on the subscription and verify again.`,
        });
      } else {
        setListActionMessage({ tone: "ok", text: "Azure connection verified." });
      }
    } catch (e) {
      const message = formatApiError(e);
      reportScanFailure({
        accountId: id,
        accountLabel: scanFailureAccountLabel({
          label: sub?.label,
          externalId: sub?.subscription_id,
        }),
        provider: "azure",
        message,
      });
    } finally {
      setActionState(null);
    }
  }

  async function scanSub(id: string) {
    const sub = subs.find((s) => s.id === id);
    setActionState(`scan-${id}`);
    setListActionMessage(null);
    try {
      await api(`/v1/integrations/azure/subscriptions/${id}/scan`, { method: "POST", body: "{}" });
      qc.invalidateQueries({ queryKey: ["azure-subscriptions"] });
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
          label: sub?.label,
          externalId: sub?.subscription_id,
        }),
        provider: "azure",
        message,
      });
    } finally {
      setActionState(null);
    }
  }

  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/v1/integrations/azure/subscriptions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["azure-subscriptions"] });
      qc.invalidateQueries({ queryKey: ["cloud-accounts"] });
    },
  });

  return (
    <div className="accounts-cloud-connect-page">
      <p className="accounts-cloud-connect-page__breadcrumb">
        <Link to="/integrations">Integrations</Link>
        {" / "}Microsoft Azure
      </p>

      <header className="accounts-cloud-connect-page__header">
        <div className="accounts-cloud-connect-page__brand">
          <IntegrationBrandIcon brand="azure" size={48} />
          <div>
            <div className="accounts-cloud-connect-page__title-row">
              <h1 className="accounts-cloud-connect-page__title">Microsoft Azure</h1>
              {connected ? <span className="accounts-cloud-connect-page__badge">Connected</span> : null}
            </div>
            <p className="accounts-cloud-connect-page__subtitle">
              Defender, storage, Resource Graph, Activity Log, and privileged RBAC checks.
            </p>
          </div>
        </div>
      </header>

      {isLoading && <p className="accounts-cloud-connect-page__loading">Loading…</p>}

      {!isLoading && showConnect ? <AzureConnectFlow onComplete={() => setShowConnectForm(false)} /> : null}

      {!isLoading && subs.length > 0 ? (
        <div className="accounts-cloud-connect-page__list">
          <div className="accounts-cloud-connect-page__list-head">
            <h2 className="accounts-cloud-connect-page__list-title">Connected subscriptions</h2>
            <button
              type="button"
              className="accounts-connect-shell__back"
              onClick={() => setShowConnectForm(true)}
            >
              Add subscription
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
            {subs.map((s) => (
              <li key={s.id} className="accounts-cloud-connect-page__item">
                <div>
                  <strong>{s.label}</strong>
                  <div className="accounts-cloud-connect-page__item-meta">
                    {s.subscription_id} · {s.status}
                  </div>
                  {s.last_error ? <IntegrationScanErrorStatus raw={s.last_error} /> : null}
                </div>
                <div className="accounts-cloud-connect-page__item-actions">
                  <button
                    type="button"
                    className="accounts-connect-shell__back"
                    disabled={actionState === s.id}
                    onClick={() => verifySub(s.id)}
                  >
                    Verify
                  </button>
                  <button
                    type="button"
                    className="accounts-connect-shell__back"
                    disabled={s.status !== "connected" || actionState === `scan-${s.id}`}
                    onClick={() => scanSub(s.id)}
                  >
                    {actionState === `scan-${s.id}` ? "Scanning…" : "Scan"}
                  </button>
                  <button
                    type="button"
                    className="accounts-connect-shell__cancel"
                    onClick={() => remove.mutate(s.id)}
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
