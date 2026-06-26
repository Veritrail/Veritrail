import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { api, formatApiError } from "../api";
import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import "../styles/integration-setup.css";

type GcpProject = {
  id: string;
  project_id: string;
  label: string;
  status: string;
  auth_method: string;
  project_number: string | null;
  pool_id: string | null;
  provider_id: string | null;
  service_account_email: string | null;
  wif_subject: string | null;
  last_scan_at: string | null;
  last_error: string | null;
  has_service_account: boolean;
  wif_configured: boolean;
};

type GcpSetup = {
  auth_method: string;
  issuer_uri: string;
  token_audience: string;
  jwks_uri: string;
  wif_subject: string;
  project_id: string;
  project_number: string | null;
  pool_id: string;
  provider_id: string;
  service_account_email: string;
  wif_audience: string;
  principal_member: string;
  terraform_path: string;
  gcloud_script_path: string;
};

const STEPS = ["Project", "Deploy trust", "Connect", "Verify"] as const;

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div>
      <label className="integration-setup__field-label">{label}</label>
      <div className="integration-setup__copy-row">
        <input className="integration-setup__input" readOnly value={value} />
        <button type="button" className="integration-setup__btn" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function terraformSnippet(setup: GcpSetup) {
  return `terraform apply \\
  -var="project_id=${setup.project_id}" \\
  -var="project_number=${setup.project_number ?? "PROJECT_NUMBER"}" \\
  -var="veritrail_issuer_uri=${setup.issuer_uri}" \\
  -var="veritrail_token_audience=${setup.token_audience}" \\
  -var="wif_subject=${setup.wif_subject}"`;
}

function gcloudSnippet(setup: GcpSetup) {
  return `export PROJECT_ID=${setup.project_id}
export PROJECT_NUMBER=${setup.project_number ?? "PROJECT_NUMBER"}
export VERITRAIL_ISSUER_URI=${setup.issuer_uri}
export VERITRAIL_TOKEN_AUDIENCE=${setup.token_audience}
export WIF_SUBJECT=${setup.wif_subject}
./infra/gcp/wif-setup/setup.sh`;
}

export default function GcpIntegration() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["gcp-projects"],
    queryFn: () => api<GcpProject[]>("/v1/integrations/gcp/projects"),
  });

  const [step, setStep] = useState(0);
  const [projectId, setProjectId] = useState("");
  const [label, setLabel] = useState("");
  const [draftProject, setDraftProject] = useState<GcpProject | null>(null);
  const [projectNumber, setProjectNumber] = useState("");
  const [poolId, setPoolId] = useState("veritrail");
  const [providerId, setProviderId] = useState("veritrail-oidc");
  const [serviceAccountEmail, setServiceAccountEmail] = useState("");
  const [saveError, setSaveError] = useState("");
  const [actionState, setActionState] = useState<string | null>(null);
  const [deployTab, setDeployTab] = useState<"terraform" | "gcloud">("terraform");

  const projects = data ?? [];
  const connected = projects.some((p) => p.status === "connected");

  const setupQuery = useQuery({
    queryKey: ["gcp-wif-setup", draftProject?.project_id, draftProject?.wif_subject],
    queryFn: () => {
      const params = new URLSearchParams({
        project_id: draftProject!.project_id,
        wif_subject: draftProject!.wif_subject!,
      });
      if (projectNumber.trim()) params.set("project_number", projectNumber.trim());
      return api<GcpSetup>(`/v1/integrations/gcp/wif/setup?${params}`);
    },
    enabled: Boolean(draftProject?.project_id && draftProject?.wif_subject && step >= 1),
  });

  const setup = setupQuery.data;

  const create = useMutation({
    mutationFn: () =>
      api<GcpProject>("/v1/integrations/gcp/projects", {
        method: "POST",
        body: JSON.stringify({
          project_id: projectId.trim(),
          label: label.trim() || projectId.trim(),
          auth_method: "workload_identity",
        }),
      }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
      setSaveError("");
      setDraftProject(row);
      setPoolId(row.pool_id ?? "veritrail");
      setProviderId(row.provider_id ?? "veritrail-oidc");
      setServiceAccountEmail(row.service_account_email ?? "");
      setProjectNumber(row.project_number ?? "");
      setStep(1);
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const patchWif = useMutation({
    mutationFn: () =>
      api<GcpProject>(`/v1/integrations/gcp/projects/${draftProject!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          project_number: projectNumber.trim(),
          pool_id: poolId.trim(),
          provider_id: providerId.trim(),
          service_account_email: serviceAccountEmail.trim(),
        }),
      }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
      setDraftProject(row);
      setSaveError("");
      setStep(3);
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const wifReady = useMemo(
    () =>
      Boolean(
        projectNumber.trim() &&
          poolId.trim() &&
          providerId.trim() &&
          serviceAccountEmail.trim(),
      ),
    [projectNumber, poolId, providerId, serviceAccountEmail],
  );

  async function verifyProject(id: string) {
    setActionState(id);
    try {
      await api(`/v1/integrations/gcp/projects/${id}/verify`, { method: "POST", body: "{}" });
      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
      setSaveError("");
    } catch (e) {
      setSaveError(formatApiError(e));
    } finally {
      setActionState(null);
    }
  }

  async function scanProject(id: string) {
    setActionState(`scan-${id}`);
    try {
      await api(`/v1/integrations/gcp/projects/${id}/scan`, { method: "POST", body: "{}" });
      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
    } catch (e) {
      setSaveError(formatApiError(e));
    } finally {
      setActionState(null);
    }
  }

  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/v1/integrations/gcp/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
      if (draftProject) setDraftProject(null);
    },
  });

  function resetWizard() {
    setStep(0);
    setProjectId("");
    setLabel("");
    setDraftProject(null);
    setProjectNumber("");
    setPoolId("veritrail");
    setProviderId("veritrail-oidc");
    setServiceAccountEmail("");
    setSaveError("");
  }

  return (
    <div className="integration-setup">
      <p className="integration-setup__breadcrumb">
        <Link to="/integrations">Integrations</Link>
        {" / "}Google Cloud
      </p>

      <header className="integration-setup__header">
        <div className="integration-setup__brand">
          <IntegrationBrandIcon brand="gcp" size={48} />
          <div>
            <div className="integration-setup__title-row">
              <h1 className="integration-setup__title">Google Cloud</h1>
              {connected && <span className="integration-setup__badge">Connected</span>}
            </div>
            <p className="integration-setup__subtitle">
              Production connection via Workload Identity Federation — deploy trust in your project, then verify. No JSON keys.
            </p>
          </div>
        </div>
      </header>

      {isLoading && <p className="integration-setup__loading">Loading…</p>}

      {!isLoading && (
        <>
          <div className="integration-setup__card">
            <div className="integration-setup__steps">
              {STEPS.map((name, i) => (
                <span
                  key={name}
                  className={`integration-setup__step${i === step ? " integration-setup__step--active" : i < step ? " integration-setup__step--done" : ""}`}
                >
                  {i + 1}. {name}
                </span>
              ))}
            </div>

            {step === 0 && (
              <div className="integration-setup__section">
                <p className="integration-setup__callout">
                  Enter the GCP project ID to scan. Veritrail will generate a unique federation subject (like AWS ExternalId).
                </p>
                <div className="integration-setup__grid integration-setup__grid--2">
                  <div>
                    <label className="integration-setup__field-label" htmlFor="gcp-project-id">Project ID</label>
                    <input
                      id="gcp-project-id"
                      className="integration-setup__input"
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="integration-setup__field-label" htmlFor="gcp-label">Label</label>
                    <input
                      id="gcp-label"
                      className="integration-setup__input"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="Production GCP"
                    />
                  </div>
                </div>
                {saveError && <p className="integration-setup__error">{saveError}</p>}
                <div className="integration-setup__actions">
                  <button
                    type="button"
                    className="integration-setup__btn integration-setup__btn--primary"
                    disabled={!projectId.trim() || create.isPending}
                    onClick={() => create.mutate()}
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {step === 1 && draftProject && (
              <div className="integration-setup__section">
                <p className="integration-setup__callout">
                  Run Terraform or gcloud in your GCP project to create the workload identity pool, OIDC provider (trusting Veritrail), and scanner service account.
                </p>
                {setupQuery.isLoading && <p className="integration-setup__loading">Loading setup parameters…</p>}
                {setup && (
                  <>
                    <CopyField label="WIF subject (bind in IAM)" value={setup.wif_subject} />
                    <CopyField label="Veritrail issuer URI" value={setup.issuer_uri} />
                    <CopyField label="Token audience" value={setup.token_audience} />
                    <CopyField label="Principal member" value={setup.principal_member} />
                    <div className="integration-setup__tabs">
                      <button
                        type="button"
                        className={deployTab === "terraform" ? "integration-setup__tab--active" : ""}
                        onClick={() => setDeployTab("terraform")}
                      >
                        Terraform
                      </button>
                      <button
                        type="button"
                        className={deployTab === "gcloud" ? "integration-setup__tab--active" : ""}
                        onClick={() => setDeployTab("gcloud")}
                      >
                        gcloud
                      </button>
                    </div>
                    <label className="integration-setup__field-label">
                      {deployTab === "terraform" ? "Terraform (infra/gcp/wif-setup)" : "gcloud script"}
                    </label>
                    <textarea
                      className="integration-setup__textarea"
                      rows={8}
                      readOnly
                      value={deployTab === "terraform" ? terraformSnippet(setup) : gcloudSnippet(setup)}
                    />
                  </>
                )}
                {saveError && <p className="integration-setup__error">{saveError}</p>}
                <div className="integration-setup__actions">
                  <button type="button" className="integration-setup__btn" onClick={() => setStep(0)}>Back</button>
                  <button type="button" className="integration-setup__btn integration-setup__btn--primary" onClick={() => setStep(2)}>
                    I&apos;ve deployed trust →
                  </button>
                </div>
              </div>
            )}

            {step === 2 && draftProject && (
              <div className="integration-setup__section">
                <p className="integration-setup__callout">
                  Paste values from your Terraform/gcloud outputs, then continue to verify.
                </p>
                <div className="integration-setup__grid integration-setup__grid--2">
                  <div>
                    <label className="integration-setup__field-label" htmlFor="gcp-pnum">Project number</label>
                    <input id="gcp-pnum" className="integration-setup__input" value={projectNumber} onChange={(e) => setProjectNumber(e.target.value)} />
                  </div>
                  <div>
                    <label className="integration-setup__field-label" htmlFor="gcp-pool">Pool ID</label>
                    <input id="gcp-pool" className="integration-setup__input" value={poolId} onChange={(e) => setPoolId(e.target.value)} />
                  </div>
                  <div>
                    <label className="integration-setup__field-label" htmlFor="gcp-provider">Provider ID</label>
                    <input id="gcp-provider" className="integration-setup__input" value={providerId} onChange={(e) => setProviderId(e.target.value)} />
                  </div>
                  <div className="integration-setup__field--wide">
                    <label className="integration-setup__field-label" htmlFor="gcp-sa-email">Scanner service account email</label>
                    <input id="gcp-sa-email" className="integration-setup__input" value={serviceAccountEmail} onChange={(e) => setServiceAccountEmail(e.target.value)} />
                  </div>
                </div>
                {saveError && <p className="integration-setup__error">{saveError}</p>}
                <div className="integration-setup__actions">
                  <button type="button" className="integration-setup__btn" onClick={() => setStep(1)}>Back</button>
                  <button
                    type="button"
                    className="integration-setup__btn integration-setup__btn--primary"
                    disabled={!wifReady || patchWif.isPending}
                    onClick={() => patchWif.mutate()}
                  >
                    Save &amp; verify →
                  </button>
                </div>
              </div>
            )}

            {step === 3 && draftProject && (
              <div className="integration-setup__section">
                <p className="integration-setup__callout">
                  Veritrail exchanges a short-lived OIDC token for federated credentials and tests Cloud Resource Manager + Logging.
                </p>
                <CopyField label="Project ID" value={draftProject.project_id} />
                <CopyField label="WIF subject" value={draftProject.wif_subject ?? ""} />
                {saveError && <p className="integration-setup__error">{saveError}</p>}
                <div className="integration-setup__actions">
                  <button type="button" className="integration-setup__btn" onClick={() => setStep(2)}>Back</button>
                  <button
                    type="button"
                    className="integration-setup__btn integration-setup__btn--primary"
                    disabled={actionState === draftProject.id}
                    onClick={async () => {
                      await verifyProject(draftProject.id);
                      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
                      resetWizard();
                    }}
                  >
                    {actionState === draftProject.id ? "Verifying…" : "Verify connection"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {projects.length > 0 && (
            <div className="integration-setup__card">
              <div className="integration-setup__section-header">
                <h2 className="integration-setup__section-title">Connected projects</h2>
                <button type="button" className="integration-setup__btn" onClick={resetWizard}>
                  Add project
                </button>
              </div>
              <ul className="integration-setup__list">
                {projects.map((p) => (
                  <li key={p.id} className="integration-setup__list-item">
                    <div>
                      <strong>{p.label}</strong>
                      <div className="text-sm text-slate-500">
                        {p.project_id} · {p.auth_method} · {p.status}
                      </div>
                      {p.last_error && <div className="text-sm text-red-600">{p.last_error}</div>}
                    </div>
                    <div className="integration-setup__actions">
                      <button type="button" className="integration-setup__btn" disabled={actionState === p.id} onClick={() => verifyProject(p.id)}>Verify</button>
                      <button type="button" className="integration-setup__btn" disabled={p.status !== "connected" || actionState === `scan-${p.id}`} onClick={() => scanProject(p.id)}>Scan</button>
                      <button type="button" className="integration-setup__btn integration-setup__btn--danger" onClick={() => remove.mutate(p.id)}>Remove</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
