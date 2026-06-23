import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, formatApiError } from "../api";
import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import { Toggle } from "../components/SettingsUi";
import "../styles/integration-setup.css";

type SlackIntegration = {
  connected: boolean;
  webhook_url_masked: string | null;
  webhook_url: string | null;
  slack_digest_enabled: boolean;
  slack_scan_failure_enabled: boolean;
  slack_critical_alerts_enabled: boolean;
};

export default function SlackIntegration() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["slack-integration"],
    queryFn: () => api<SlackIntegration>("/v1/integrations/slack"),
  });

  const [webhookUrl, setWebhookUrl] = useState("");
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [scanFailureEnabled, setScanFailureEnabled] = useState(true);
  const [criticalAlertsEnabled, setCriticalAlertsEnabled] = useState(true);
  const [testState, setTestState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [testError, setTestError] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!data) return;
    setWebhookUrl(data.webhook_url ?? "");
    setDigestEnabled(data.slack_digest_enabled);
    setScanFailureEnabled(data.slack_scan_failure_enabled);
    setCriticalAlertsEnabled(data.slack_critical_alerts_enabled);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api<SlackIntegration>("/v1/integrations/slack", {
        method: "PUT",
        body: JSON.stringify({
          webhook_url: webhookUrl.trim(),
          slack_digest_enabled: digestEnabled,
          slack_scan_failure_enabled: scanFailureEnabled,
          slack_critical_alerts_enabled: criticalAlertsEnabled,
        }),
      }),
    onSuccess: (saved) => {
      qc.setQueryData(["slack-integration"], saved);
      qc.invalidateQueries({ queryKey: ["settings"] });
      setSaveError("");
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const disconnect = useMutation({
    mutationFn: () => api<void>("/v1/integrations/slack", { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["slack-integration"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
      setWebhookUrl("");
      setDigestEnabled(false);
    },
  });

  async function sendTest() {
    setTestState("sending");
    setTestError("");
    try {
      await api("/v1/integrations/slack/test", {
        method: "POST",
        body: JSON.stringify({ url: webhookUrl.trim() || undefined }),
      });
      setTestState("sent");
      setTimeout(() => setTestState("idle"), 3000);
    } catch (e) {
      setTestState("error");
      setTestError(formatApiError(e));
      setTimeout(() => setTestState("idle"), 4000);
    }
  }

  const connected = !!data?.connected;

  return (
    <div className="integration-setup">
      <p className="integration-setup__breadcrumb">
        <Link to="/integrations">Integrations</Link>
        {" / "}Slack
      </p>

      <header className="integration-setup__header">
        <div className="integration-setup__brand">
          <IntegrationBrandIcon brand="slack" size={48} />
          <div>
            <div className="integration-setup__title-row">
              <h1 className="integration-setup__title">Slack</h1>
              {connected && <span className="integration-setup__badge">Connected</span>}
            </div>
            <p className="integration-setup__subtitle">
              Route scan alerts, failures, and weekly digests to a channel with an incoming webhook.
            </p>
          </div>
        </div>
      </header>

      {isLoading && <p className="integration-setup__loading">Loading…</p>}

      {!isLoading && (
        <div className="integration-setup__card">
          <div className="integration-setup__section">
            <label htmlFor="slack-webhook" className="integration-setup__field-label">
              Incoming webhook URL
            </label>
            <p className="integration-setup__field-hint">
              In Slack: <strong className="font-semibold text-slate-600">Apps</strong> →{" "}
              <strong className="font-semibold text-slate-600">Incoming Webhooks</strong> → Add to Slack → copy the URL (
              <code>hooks.slack.com/services/…</code>).
            </p>
            <input
              id="slack-webhook"
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/…"
              className="integration-setup__input"
            />
            {data?.webhook_url_masked && connected && !webhookUrl && (
              <p className="integration-setup__saved">Saved: {data.webhook_url_masked}</p>
            )}
          </div>

          <div className="integration-setup__section">
            <p className="integration-setup__section-label">Deliver to Slack</p>
            <div className="integration-setup__toggle-list">
              <div className="integration-setup__toggle-row">
                <div className="min-w-0">
                  <p className="integration-setup__toggle-title">Critical & high finding alerts</p>
                  <p className="integration-setup__toggle-desc">After each scan that opens new critical or high findings.</p>
                </div>
                <Toggle checked={criticalAlertsEnabled} onChange={setCriticalAlertsEnabled} />
              </div>
              <div className="integration-setup__toggle-row">
                <div className="min-w-0">
                  <p className="integration-setup__toggle-title">Scan failure alerts</p>
                  <p className="integration-setup__toggle-desc">When a compliance scan fails or loses AWS access.</p>
                </div>
                <Toggle checked={scanFailureEnabled} onChange={setScanFailureEnabled} />
              </div>
              <div className="integration-setup__toggle-row">
                <div className="min-w-0">
                  <p className="integration-setup__toggle-title">Weekly digest summary</p>
                  <p className="integration-setup__toggle-desc">Short Monday summary — independent of email digest.</p>
                </div>
                <Toggle checked={digestEnabled} onChange={setDigestEnabled} />
              </div>
            </div>
          </div>

          {saveError && <p className="integration-setup__feedback integration-setup__feedback--error">{saveError}</p>}
          {testState === "error" && testError && (
            <p className="integration-setup__feedback integration-setup__feedback--error">{testError}</p>
          )}
          {testState === "sent" && (
            <p className="integration-setup__feedback integration-setup__feedback--ok">Test message sent.</p>
          )}

          <div className="integration-setup__actions">
            <div className="integration-setup__actions-primary">
              <button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending || !webhookUrl.trim()}
                className="integration-setup__btn integration-setup__btn--primary"
              >
                {save.isPending ? "Saving…" : connected ? "Save changes" : "Connect Slack"}
              </button>
              <button
                type="button"
                onClick={() => void sendTest()}
                disabled={testState === "sending" || !webhookUrl.trim()}
                className="integration-setup__btn integration-setup__btn--secondary"
              >
                {testState === "sending" ? "Sending…" : "Send test"}
              </button>
            </div>
            {connected && (
              <button
                type="button"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
                className="integration-setup__btn integration-setup__btn--danger integration-setup__actions-secondary"
              >
                {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
