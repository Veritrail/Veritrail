import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, formatApiError } from "../api";
import { githubIssuesIntegrationSchema } from "../lib/apiSchemas";
import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import "../styles/integration-setup.css";

export default function GitHubIssuesIntegration() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["github-issues-integration"],
    queryFn: () => api("/v1/integrations/github-issues", { schema: githubIssuesIntegrationSchema }),
  });
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [labels, setLabels] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!data) return;
    setOwner(data.owner ?? "");
    setRepo(data.repo ?? "");
    setLabels((data.labels ?? []).join(", "));
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api("/v1/integrations/github-issues", {
        method: "PUT",
        schema: githubIssuesIntegrationSchema,
        body: JSON.stringify({
          owner: owner.trim(),
          repo: repo.trim(),
          labels: labels.split(",").map((s) => s.trim()).filter(Boolean),
          access_token: accessToken.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github-issues-integration"] });
      setAccessToken("");
      setSaveError("");
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const disconnect = useMutation({
    mutationFn: () => api<void>("/v1/integrations/github-issues", { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["github-issues-integration"] }),
  });

  return (
    <div className="integration-setup">
      <p className="integration-setup__breadcrumb"><Link to="/integrations">Integrations</Link> / GitHub Issues</p>
      <header className="integration-setup__header">
        <IntegrationBrandIcon brand="github" size={48} />
        <div>
          <h1 className="integration-setup__title">GitHub Issues</h1>
          <p className="integration-setup__subtitle">Create remediation issues from findings. Reuses your GitHub OAuth token when no dedicated token is set.</p>
        </div>
      </header>
      {isLoading && <p className="integration-setup__loading">Loading…</p>}
      {!isLoading && (
        <div className="integration-setup__card">
          <div className="integration-setup__grid integration-setup__grid--2">
            <div><label className="integration-setup__field-label">Owner</label><input className="integration-setup__input" placeholder="e.g. awakzdev" value={owner} onChange={(e) => setOwner(e.target.value)} /></div>
            <div><label className="integration-setup__field-label">Repo</label><input className="integration-setup__input" placeholder="e.g. eks-production-iac" value={repo} onChange={(e) => setRepo(e.target.value)} /></div>
            <div className="integration-setup__field--wide"><label className="integration-setup__field-label">Labels (comma-separated)</label><input className="integration-setup__input" value={labels} onChange={(e) => setLabels(e.target.value)} /></div>
            <div><label className="integration-setup__field-label">Access token (optional)</label><input type="password" className="integration-setup__input" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} /></div>
          </div>
          {saveError && <p className="integration-setup__error">{saveError}</p>}
          <div className="integration-setup__actions">
            <button type="button" className="integration-setup__btn integration-setup__btn--primary" disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
            {data?.connected && <button type="button" className="integration-setup__btn integration-setup__btn--danger" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>Disconnect</button>}
          </div>
        </div>
      )}
    </div>
  );
}
