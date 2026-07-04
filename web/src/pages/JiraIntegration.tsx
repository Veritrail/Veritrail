import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, formatApiError } from "../api";
import { jiraIntegrationSchema, type JiraIntegration } from "../lib/apiSchemas";
import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import "../styles/integration-setup.css";

const JIRA_FLOW = [
  { title: "Finding", detail: "Detected risk" },
  { title: "Jira issue", detail: "Auto-created" },
  { title: "Remediation", detail: "Tracked to close" },
];

export default function JiraIntegration() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["jira-integration"],
    queryFn: () => api("/v1/integrations/jira", { schema: jiraIntegrationSchema }),
  });

  const [siteUrl, setSiteUrl] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [issueType, setIssueType] = useState("Task");
  const [saveError, setSaveError] = useState("");
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [testError, setTestError] = useState("");

  useEffect(() => {
    if (!data) return;
    setSiteUrl(data.site_url ?? "");
    setEmail(data.email ?? "");
    setProjectKey(data.project_key ?? "");
    setIssueType(data.issue_type || "Task");
    setApiToken("");
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api<JiraIntegration>("/v1/integrations/jira", {
        method: "PUT",
        body: JSON.stringify({
          site_url: siteUrl.trim(),
          email: email.trim(),
          api_token: apiToken.trim() || undefined,
          project_key: projectKey.trim(),
          issue_type: issueType.trim() || "Task",
        }),
      }),
    onSuccess: (saved) => {
      qc.setQueryData(["jira-integration"], saved);
      setSaveError("");
      setApiToken("");
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const disconnect = useMutation({
    mutationFn: () => api<void>("/v1/integrations/jira", { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jira-integration"] });
      setSiteUrl("");
      setEmail("");
      setApiToken("");
      setProjectKey("");
    },
  });

  async function runTest() {
    setTestState("testing");
    setTestError("");
    try {
      await api("/v1/integrations/jira/test", {
        method: "POST",
        body: JSON.stringify({
          site_url: siteUrl.trim() || undefined,
          email: email.trim() || undefined,
          api_token: apiToken.trim() || undefined,
          project_key: projectKey.trim() || undefined,
        }),
      });
      setTestState("ok");
      setTimeout(() => setTestState("idle"), 3000);
    } catch (e) {
      setTestState("error");
      setTestError(formatApiError(e));
      setTimeout(() => setTestState("idle"), 4000);
    }
  }

  const connected = !!data?.connected;
  const canSave =
    siteUrl.trim() &&
    email.trim() &&
    projectKey.trim() &&
    (apiToken.trim() || data?.has_api_token);

  return (
    <div className="integration-setup integration-setup--elevated">
      <header className="integration-setup__header integration-setup__hero">
        <div className="integration-setup__hero-mark">
          <IntegrationBrandIcon brand="jira" size={64} />
        </div>
        <div className="integration-setup__title-row">
          <h1 className="integration-setup__title">Connect Jira</h1>
          {connected && <span className="integration-setup__badge">Connected</span>}
        </div>
        <p className="integration-setup__subtitle">
          Create Jira issues from Veritrail findings so remediation is tracked in your team's workflow and
          captured as incident-response evidence.
        </p>
        <div className="integration-setup__flow" aria-label="Jira workflow">
          {JIRA_FLOW.map((node) => (
            <div className="integration-setup__flow-node" key={node.title}>
              <span className="integration-setup__flow-title">{node.title}</span>
              <span className="integration-setup__flow-detail">{node.detail}</span>
            </div>
          ))}
        </div>
      </header>

      {isLoading && <p className="integration-setup__loading">Loading…</p>}

      {!isLoading && (
        <div className="integration-setup__card">
          <div className="integration-setup__section">
            <p className="integration-setup__section-label">Connection details</p>
            <p className="integration-setup__section-desc">
              Veritrail authenticates with a Jira Cloud account email and API token, then opens issues in the
              project you choose.
            </p>

            <div className="integration-setup__callout integration-setup__callout--neutral">
              <strong>Recommended:</strong> create a dedicated Jira account (e.g. <code>veritrail@yourco.com</code>)
              for this connection. Issues are attributed to Veritrail instead of a person, and the integration keeps
              working when staff change. It needs its own Jira product license (a seat).
            </div>

            <div className="integration-setup__grid integration-setup__grid--2">
              <div className="integration-setup__field--wide">
                <label htmlFor="jira-site" className="integration-setup__field-label">
                  Site URL
                </label>
                <input
                  id="jira-site"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  placeholder="https://your-company.atlassian.net"
                  className="integration-setup__input"
                />
                <p className="integration-setup__field-hint">
                  Your Atlassian Cloud site. Jira Cloud only.
                </p>
              </div>
              <div>
                <label htmlFor="jira-email" className="integration-setup__field-label">
                  Account email
                </label>
                <input
                  id="jira-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="integration-setup__input"
                />
                <p className="integration-setup__field-hint">
                  The Atlassian account that owns the API token.
                </p>
              </div>
              <div>
                <label htmlFor="jira-token" className="integration-setup__field-label">
                  API token
                </label>
                <input
                  id="jira-token"
                  type="password"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder={connected && data?.has_api_token ? "••••••••••••••••" : "Paste API token"}
                  className="integration-setup__input"
                />
                <p className="integration-setup__field-hint">
                  Create at{" "}
                  <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">
                    id.atlassian.com → Security → API tokens
                  </a>
                  .
                </p>
              </div>
              <div>
                <label htmlFor="jira-project" className="integration-setup__field-label">
                  Project key
                </label>
                <input
                  id="jira-project"
                  value={projectKey}
                  onChange={(e) => setProjectKey(e.target.value.toUpperCase())}
                  placeholder="SEC"
                  className="integration-setup__input uppercase"
                />
                <p className="integration-setup__field-hint">
                  Where Veritrail creates issues, e.g. <code>SEC</code>.
                </p>
              </div>
              <div>
                <label htmlFor="jira-type" className="integration-setup__field-label">
                  Issue type
                </label>
                <input
                  id="jira-type"
                  value={issueType}
                  onChange={(e) => setIssueType(e.target.value)}
                  placeholder="Task"
                  className="integration-setup__input"
                />
                <p className="integration-setup__field-hint">
                  Issue type Veritrail opens, e.g. <code>Task</code> or <code>Bug</code>.
                </p>
              </div>
            </div>
          </div>

          {saveError && <p className="integration-setup__feedback integration-setup__feedback--error">{saveError}</p>}
          {testState === "error" && testError && (
            <p className="integration-setup__feedback integration-setup__feedback--error">{testError}</p>
          )}
          {testState === "ok" && (
            <p className="integration-setup__feedback integration-setup__feedback--ok">Connection verified.</p>
          )}

          <div className="integration-setup__actions">
            <div className="integration-setup__actions-primary">
              <button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending || !canSave}
                className="integration-setup__btn integration-setup__btn--primary"
              >
                {save.isPending ? "Saving…" : connected ? "Save changes" : "Connect Jira"}
              </button>
              <button
                type="button"
                onClick={() => void runTest()}
                disabled={testState === "testing" || !canSave}
                className="integration-setup__btn integration-setup__btn--secondary"
              >
                {testState === "testing" ? "Testing…" : "Test connection"}
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
