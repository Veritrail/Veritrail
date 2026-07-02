import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "../api";
import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import { IntegrationScanErrorStatus } from "../components/IntegrationScanErrorStatus";
import { useIntegrationScanFailureNotifications } from "../hooks/useIntegrationScanFailureNotifications";
import { useRecheckNotifications } from "../context/RecheckNotificationsContext";
import { scanFailureAccountLabel } from "../lib/scanFailureMessages";
import "../styles/integration-setup.css";

type GcpAuthMethod = "service_account_impersonation" | "workload_identity";

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
  impersonation_configured: boolean;
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
};

type GcpImpersonationSetup = {
  auth_method: string;
  project_id: string;
  platform_sa_email: string | null;
  veritrail_platform_sa_email: string | null;
  scanner_sa_email: string;
  platform_sa_configured: boolean;
  platform_sa_setup_message: string | null;
};

const WIF_STEPS = ["Project", "Deploy trust", "Connect", "Verify"] as const;
const SA_STEPS = ["Project", "Deploy SA", "Connect", "Verify"] as const;

const AUTH_OPTIONS: { id: GcpAuthMethod; title: string; description: string; recommended?: boolean }[] = [
  {
    id: "service_account_impersonation",
    title: "Service account access",
    description: "Deploy a scanner SA and grant Veritrail TokenCreator — simpler setup, like AWS role assumption.",
    recommended: true,
  },
  {
    id: "workload_identity",
    title: "Workload Identity Federation",
    description: "OIDC federation with per-connection subject binding — no Veritrail service account grant.",
  },
];

function CopyField({
  label,
  value,
  emptyMessage,
}: {
  label: string;
  value: string;
  emptyMessage?: string;
}) {
  const [copied, setCopied] = useState(false);
  const canCopy = Boolean(value.trim());
  const displayValue = canCopy ? value : (emptyMessage ?? "");
  async function copy() {
    if (!canCopy) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="integration-setup__copy-field">
      <label className="integration-setup__field-label">{label}</label>
      <div className="integration-setup__copy-row">
        <input
          className={`integration-setup__input${canCopy ? "" : " integration-setup__input--placeholder"}`}
          readOnly
          value={displayValue}
        />
        <button
          type="button"
          className="integration-setup__btn integration-setup__btn--secondary"
          onClick={copy}
          disabled={!canCopy}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

const GCP_REQUIRED_APIS = [
  "iam.googleapis.com",
  "iamcredentials.googleapis.com",
  "cloudresourcemanager.googleapis.com",
  "logging.googleapis.com",
  "compute.googleapis.com",
  "osconfig.googleapis.com",
  "securitycenter.googleapis.com",
  "cloudasset.googleapis.com",
] as const;

const GCP_WIF_APIS = [...GCP_REQUIRED_APIS, "sts.googleapis.com"] as const;

function CodeBlock({ value, label, rows = 8 }: { value: string; label: string; rows?: number }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="integration-setup__code-block">
      <label className="integration-setup__field-label">{label}</label>
      <textarea className="integration-setup__textarea" rows={rows} readOnly value={value} />
      <div className="integration-setup__code-block-actions">
        <button type="button" className="integration-setup__btn integration-setup__btn--secondary" onClick={copy}>
          {copied ? "Copied" : "Copy command"}
        </button>
      </div>
    </div>
  );
}

function statusClass(status: string) {
  if (status === "connected") return "integration-setup__status integration-setup__status--connected";
  if (status === "error") return "integration-setup__status integration-setup__status--error";
  return "integration-setup__status integration-setup__status--pending";
}

function gcloudSnippet(setup: GcpSetup) {
  return `export PROJECT_ID=${setup.project_id}
export PROJECT_NUMBER=${setup.project_number ?? "PROJECT_NUMBER"}
export VERITRAIL_ISSUER_URI=${setup.issuer_uri}
export VERITRAIL_TOKEN_AUDIENCE=${setup.token_audience}
export WIF_SUBJECT=${setup.wif_subject}

POOL_ID="${setup.pool_id}"
PROVIDER_ID="${setup.provider_id}"
SA_ID="veritrail-scanner"

gcloud services enable ${GCP_WIF_APIS.join(" ")} \\
  --project="$PROJECT_ID"

gcloud iam workload-identity-pools create "$POOL_ID" \\
  --project="$PROJECT_ID" \\
  --location=global \\
  --display-name="Veritrail" \\
  --description="Federated access for Veritrail posture scans" \\
  2>/dev/null || true

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \\
  --project="$PROJECT_ID" \\
  --location=global \\
  --workload-identity-pool="$POOL_ID" \\
  --display-name="Veritrail OIDC" \\
  --issuer-uri="$VERITRAIL_ISSUER_URI" \\
  --allowed-audiences="$VERITRAIL_TOKEN_AUDIENCE" \\
  --attribute-mapping="google.subject=assertion.sub" \\
  2>/dev/null || true

gcloud iam service-accounts create "$SA_ID" \\
  --project="$PROJECT_ID" \\
  --display-name="Veritrail scanner (read-only)" \\
  2>/dev/null || true

SA_EMAIL="\${SA_ID}@\${PROJECT_ID}.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \\
  --member="serviceAccount:\${SA_EMAIL}" \\
  --role="roles/viewer" \\
  --condition=None

gcloud projects add-iam-policy-binding "$PROJECT_ID" \\
  --member="serviceAccount:\${SA_EMAIL}" \\
  --role="roles/logging.viewer" \\
  --condition=None

gcloud projects add-iam-policy-binding "$PROJECT_ID" \\
  --member="serviceAccount:\${SA_EMAIL}" \\
  --role="roles/osconfig.viewer" \\
  --condition=None

gcloud projects add-iam-policy-binding "$PROJECT_ID" \\
  --member="serviceAccount:\${SA_EMAIL}" \\
  --role="roles/securitycenter.findingsViewer" \\
  --condition=None

gcloud projects add-iam-policy-binding "$PROJECT_ID" \\
  --member="serviceAccount:\${SA_EMAIL}" \\
  --role="roles/cloudasset.viewer" \\
  --condition=None

PRINCIPAL="principal://iam.googleapis.com/projects/\${PROJECT_NUMBER}/locations/global/workloadIdentityPools/\${POOL_ID}/subject/\${WIF_SUBJECT}"

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \\
  --project="$PROJECT_ID" \\
  --role="roles/iam.workloadIdentityUser" \\
  --member="$PRINCIPAL"

AUDIENCE="//iam.googleapis.com/projects/\${PROJECT_NUMBER}/locations/global/workloadIdentityPools/\${POOL_ID}/providers/\${PROVIDER_ID}"

echo "service_account_email=\${SA_EMAIL}"
echo "wif_audience=\${AUDIENCE}"
echo "principal_member=\${PRINCIPAL}"`;
}

function impersonationPlatformSaEmail(setup: GcpImpersonationSetup) {
  return setup.veritrail_platform_sa_email?.trim() || setup.platform_sa_email?.trim() || "";
}

function expectedScannerSaEmail(setup: GcpImpersonationSetup | undefined, projectId: string) {
  const fromSetup = setup?.scanner_sa_email?.trim();
  if (fromSetup) return fromSetup;
  const pid = projectId.trim();
  if (pid) return `veritrail-scanner@${pid}.iam.gserviceaccount.com`;
  return "";
}

function saGcloudSnippet(setup: GcpImpersonationSetup) {
  const veritrailSa = impersonationPlatformSaEmail(setup);
  const veritrailSaExport = veritrailSa
    ? `export VERITRAIL_PLATFORM_SA_EMAIL=${veritrailSa}`
    : `# Contact your Veritrail administrator for this email
# export VERITRAIL_PLATFORM_SA_EMAIL=<veritrail-service-account@project.iam.gserviceaccount.com>`;

  return `export PROJECT_ID=${setup.project_id}
# Veritrail connection account — grant TokenCreator on your scanner SA to this account
${veritrailSaExport}

SA_ID="veritrail-scanner"

gcloud services enable ${GCP_REQUIRED_APIS.join(" ")} \\
  --project="$PROJECT_ID"

gcloud iam service-accounts create "$SA_ID" \\
  --project="$PROJECT_ID" \\
  --display-name="Veritrail scanner (read-only)" \\
  2>/dev/null || true

SA_EMAIL="\${SA_ID}@\${PROJECT_ID}.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \\
  --member="serviceAccount:\${SA_EMAIL}" \\
  --role="roles/viewer" \\
  --condition=None

gcloud projects add-iam-policy-binding "$PROJECT_ID" \\
  --member="serviceAccount:\${SA_EMAIL}" \\
  --role="roles/logging.viewer" \\
  --condition=None

gcloud projects add-iam-policy-binding "$PROJECT_ID" \\
  --member="serviceAccount:\${SA_EMAIL}" \\
  --role="roles/osconfig.viewer" \\
  --condition=None

gcloud projects add-iam-policy-binding "$PROJECT_ID" \\
  --member="serviceAccount:\${SA_EMAIL}" \\
  --role="roles/securitycenter.findingsViewer" \\
  --condition=None

gcloud projects add-iam-policy-binding "$PROJECT_ID" \\
  --member="serviceAccount:\${SA_EMAIL}" \\
  --role="roles/cloudasset.viewer" \\
  --condition=None

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \\
  --project="$PROJECT_ID" \\
  --role="roles/iam.serviceAccountTokenCreator" \\
  --member="serviceAccount:\${VERITRAIL_PLATFORM_SA_EMAIL}"

echo "service_account_email=\${SA_EMAIL}"`;
}

function authMethodLabel(method: string) {
  if (method === "service_account_impersonation") return "service account access";
  return method.replaceAll("_", " ");
}

export default function GcpIntegration() {
  const qc = useQueryClient();
  const { reportScanFailure } = useRecheckNotifications();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["gcp-projects"],
    queryFn: () => api<GcpProject[]>("/v1/integrations/gcp/projects"),
  });

  const [authMethod, setAuthMethod] = useState<GcpAuthMethod>("service_account_impersonation");
  const [step, setStep] = useState(0);
  const [projectId, setProjectId] = useState("");
  const [label, setLabel] = useState("");
  const [draftProject, setDraftProject] = useState<GcpProject | null>(null);
  const [projectNumber, setProjectNumber] = useState("");
  const [poolId, setPoolId] = useState("veritrail");
  const [providerId, setProviderId] = useState("veritrail-oidc");
  const [serviceAccountEmail, setServiceAccountEmail] = useState("");
  const [saveError, setSaveError] = useState("");
  const [listActionMessage, setListActionMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [actionState, setActionState] = useState<string | null>(null);

  const projects = data ?? [];
  const connected = projects.some((p) => p.status === "connected");
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
  const isWif = authMethod === "workload_identity";
  const steps = isWif ? WIF_STEPS : SA_STEPS;

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
    enabled: Boolean(isWif && draftProject?.project_id && draftProject?.wif_subject && step >= 1),
  });

  const impersonationSetupQuery = useQuery({
    queryKey: ["gcp-impersonation-setup", draftProject?.project_id],
    queryFn: () => {
      const params = new URLSearchParams({ project_id: draftProject!.project_id });
      return api<GcpImpersonationSetup>(`/v1/integrations/gcp/impersonation/setup?${params}`);
    },
    enabled: Boolean(!isWif && draftProject?.project_id && step >= 1),
  });

  const setup = setupQuery.data;
  const impersonationSetup = impersonationSetupQuery.data;

  useEffect(() => {
    if (step !== 2 || isWif || !draftProject) return;
    const expected = expectedScannerSaEmail(impersonationSetup, draftProject.project_id);
    if (!expected) return;
    setServiceAccountEmail((current) => (current.trim() ? current : expected));
  }, [step, isWif, draftProject, impersonationSetup]);

  const create = useMutation({
    mutationFn: () =>
      api<GcpProject>("/v1/integrations/gcp/projects", {
        method: "POST",
        body: JSON.stringify({
          project_id: projectId.trim(),
          label: label.trim() || projectId.trim(),
          auth_method: authMethod,
        }),
      }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
      setSaveError("");
      setDraftProject(row);
      setAuthMethod(row.auth_method === "workload_identity" ? "workload_identity" : "service_account_impersonation");
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

  const patchImpersonation = useMutation({
    mutationFn: (emailOverride?: string) =>
      api<GcpProject>(`/v1/integrations/gcp/projects/${draftProject!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          service_account_email: (emailOverride ?? serviceAccountEmail).trim(),
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

  const impersonationReady = useMemo(() => Boolean(serviceAccountEmail.trim()), [serviceAccountEmail]);

  function continueFromDeploySa() {
    if (!draftProject) return;
    const email = expectedScannerSaEmail(impersonationSetup, draftProject.project_id);
    if (!email) {
      setStep(2);
      return;
    }
    setServiceAccountEmail(email);
    setSaveError("");
    patchImpersonation.mutate(email, {
      onError: () => setStep(2),
    });
  }

  async function verifyProject(id: string) {
    const project = projects.find((p) => p.id === id);
    setActionState(id);
    try {
      const result = await api<{
        ok: boolean;
        degraded_checks?: Array<{ check_id: string; api: string; reason: string }>;
      }>(`/v1/integrations/gcp/projects/${id}/verify`, { method: "POST", body: "{}" });
      qc.invalidateQueries({ queryKey: ["gcp-projects"] });
      setSaveError("");
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
      setSaveError(message);
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
      setSaveError("");
    } catch (e) {
      const message = formatApiError(e);
      setSaveError(message);
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
      if (draftProject) setDraftProject(null);
    },
  });

  function resetWizard() {
    setStep(0);
    setAuthMethod("service_account_impersonation");
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
              Connect via service account access (recommended) or Workload Identity Federation. No customer JSON keys.
            </p>
          </div>
        </div>
      </header>

      {isLoading && <p className="integration-setup__loading">Loading…</p>}

      {isError && (
        <p className="integration-setup__error">
          {formatApiError(error)}
        </p>
      )}

      {!isLoading && !isError && (
        <>
          <div className="integration-setup__card">
            <div className="integration-setup__steps">
              {steps.map((name, i) => (
                <span
                  key={name}
                  className={`integration-setup__step${i === step ? " integration-setup__step--active" : i < step ? " integration-setup__step--done" : ""}`}
                >
                  {i + 1}. {name}
                </span>
              ))}
            </div>

            {step === 0 && (
              <>
                <div className="integration-setup__section">
                  <p className="integration-setup__section-label">Connection method</p>
                  <div className="integration-setup__auth-choices">
                    {AUTH_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        className={`integration-setup__auth-choice${authMethod === opt.id ? " integration-setup__auth-choice--active" : ""}`}
                        onClick={() => setAuthMethod(opt.id)}
                      >
                        {opt.recommended && <span className="integration-setup__auth-choice-badge">Recommended</span>}
                        <div className="integration-setup__auth-choice-title">{opt.title}</div>
                        <p className="integration-setup__auth-choice-desc">{opt.description}</p>
                      </button>
                    ))}
                  </div>
                  <p className="integration-setup__callout">
                    {isWif
                      ? "Enter the GCP project ID to scan. Veritrail will generate a unique federation subject (like AWS ExternalId)."
                      : "Enter the GCP project ID to scan. You will deploy a read-only scanner SA and grant Veritrail TokenCreator."}
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
                </div>
                <div className="integration-setup__actions integration-setup__actions--end">
                  <button
                    type="button"
                    className="integration-setup__btn integration-setup__btn--primary"
                    disabled={!projectId.trim() || create.isPending}
                    onClick={() => create.mutate()}
                  >
                    {create.isPending ? "Creating…" : "Continue"}
                  </button>
                </div>
              </>
            )}

            {step === 1 && draftProject && isWif && (
              <>
                <div className="integration-setup__section">
                  <p className="integration-setup__callout">
                    Run these gcloud commands in your GCP project (Cloud Shell or local CLI) to create the workload identity pool, OIDC provider (trusting Veritrail), and scanner service account.
                  </p>
                  {setupQuery.isLoading && <p className="integration-setup__loading">Loading setup parameters…</p>}
                  {setupQuery.isError && (
                    <p className="integration-setup__error">{formatApiError(setupQuery.error)}</p>
                  )}
                  {setup && (
                    <>
                      <div className="integration-setup__copy-fields">
                        <CopyField label="WIF subject (bind in IAM)" value={setup.wif_subject} />
                        <CopyField label="Veritrail issuer URI" value={setup.issuer_uri} />
                        <CopyField label="Token audience" value={setup.token_audience} />
                        <CopyField label="Principal member" value={setup.principal_member} />
                      </div>
                      <CodeBlock
                        label="gcloud commands (Cloud Shell)"
                        rows={28}
                        value={gcloudSnippet(setup)}
                      />
                    </>
                  )}
                  {saveError && <p className="integration-setup__error">{saveError}</p>}
                </div>
                <div className="integration-setup__actions">
                  <button type="button" className="integration-setup__btn integration-setup__btn--secondary" onClick={() => setStep(0)}>Back</button>
                  <button type="button" className="integration-setup__btn integration-setup__btn--primary" onClick={() => setStep(2)}>
                    I&apos;ve deployed trust →
                  </button>
                </div>
              </>
            )}

            {step === 1 && draftProject && !isWif && (
              <>
                <div className="integration-setup__section">
                  <p className="integration-setup__callout">
                    Run these gcloud commands in your GCP project (Cloud Shell or local CLI) to create the scanner service account and grant Veritrail <code>roles/iam.serviceAccountTokenCreator</code>.
                  </p>
                  {impersonationSetupQuery.isLoading && <p className="integration-setup__loading">Loading setup parameters…</p>}
                  {impersonationSetupQuery.isError && (
                    <p className="integration-setup__error">{formatApiError(impersonationSetupQuery.error)}</p>
                  )}
                  {impersonationSetup && (
                    <>
                      <div className="integration-setup__copy-fields">
                        <CopyField
                          label="Veritrail connection account (grant TokenCreator to this)"
                          value={impersonationPlatformSaEmail(impersonationSetup)}
                          emptyMessage={impersonationSetup.platform_sa_setup_message ?? "Contact your Veritrail administrator"}
                        />
                        <CopyField label="Scanner service account email" value={impersonationSetup.scanner_sa_email} />
                      </div>
                      {!impersonationSetup.platform_sa_configured && impersonationSetup.platform_sa_setup_message && (
                        <p className="integration-setup__callout integration-setup__callout--warning">
                          {impersonationSetup.platform_sa_setup_message}
                        </p>
                      )}
                      <CodeBlock
                        label="gcloud commands (Cloud Shell)"
                        rows={22}
                        value={saGcloudSnippet(impersonationSetup)}
                      />
                    </>
                  )}
                  {saveError && <p className="integration-setup__error">{saveError}</p>}
                </div>
                <div className="integration-setup__actions">
                  <button type="button" className="integration-setup__btn integration-setup__btn--secondary" onClick={() => setStep(0)}>Back</button>
                  <button
                    type="button"
                    className="integration-setup__btn integration-setup__btn--primary"
                    disabled={patchImpersonation.isPending}
                    onClick={continueFromDeploySa}
                  >
                    {patchImpersonation.isPending ? "Saving…" : "I've deployed the scanner SA →"}
                  </button>
                </div>
              </>
            )}

            {step === 2 && draftProject && isWif && (
              <>
                <div className="integration-setup__section">
                  <p className="integration-setup__callout">
                    Paste values from your gcloud output, then continue to verify.
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
                </div>
                <div className="integration-setup__actions">
                  <button type="button" className="integration-setup__btn integration-setup__btn--secondary" onClick={() => setStep(1)}>Back</button>
                  <button
                    type="button"
                    className="integration-setup__btn integration-setup__btn--primary"
                    disabled={!wifReady || patchWif.isPending}
                    onClick={() => patchWif.mutate()}
                  >
                    {patchWif.isPending ? "Saving…" : "Save & verify →"}
                  </button>
                </div>
              </>
            )}

            {step === 2 && draftProject && !isWif && (
              <>
                <div className="integration-setup__section">
                  <p className="integration-setup__callout">
                    Confirm the scanner service account email (prefilled from setup — edit if your gcloud output differs), then continue to verify.
                  </p>
                  <div className="integration-setup__field--wide">
                    <label className="integration-setup__field-label" htmlFor="gcp-sa-email-sa">Scanner service account email</label>
                    <input
                      id="gcp-sa-email-sa"
                      className="integration-setup__input"
                      value={serviceAccountEmail}
                      onChange={(e) => setServiceAccountEmail(e.target.value)}
                    />
                  </div>
                  {saveError && <p className="integration-setup__error">{saveError}</p>}
                </div>
                <div className="integration-setup__actions">
                  <button type="button" className="integration-setup__btn integration-setup__btn--secondary" onClick={() => setStep(1)}>Back</button>
                  <button
                    type="button"
                    className="integration-setup__btn integration-setup__btn--primary"
                    disabled={!impersonationReady || patchImpersonation.isPending}
                    onClick={() => patchImpersonation.mutate(undefined)}
                  >
                    {patchImpersonation.isPending ? "Saving…" : "Save & verify →"}
                  </button>
                </div>
              </>
            )}

            {step === 3 && draftProject && isWif && (
              <>
                <div className="integration-setup__section">
                  <p className="integration-setup__callout">
                    Veritrail exchanges a short-lived OIDC token for federated credentials and tests Cloud Resource Manager + Logging.
                  </p>
                  <CopyField label="Project ID" value={draftProject.project_id} />
                  <CopyField label="WIF subject" value={draftProject.wif_subject ?? ""} />
                  {saveError && <p className="integration-setup__error">{saveError}</p>}
                </div>
                <div className="integration-setup__actions">
                  <button type="button" className="integration-setup__btn integration-setup__btn--secondary" onClick={() => setStep(2)}>Back</button>
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
              </>
            )}

            {step === 3 && draftProject && !isWif && (
              <>
                <div className="integration-setup__section">
                  <p className="integration-setup__callout">
                    Veritrail impersonates your scanner service account and tests Cloud Resource Manager + Logging.
                  </p>
                  <CopyField label="Project ID" value={draftProject.project_id} />
                  <CopyField label="Scanner service account" value={draftProject.service_account_email ?? serviceAccountEmail} />
                  {saveError && <p className="integration-setup__error">{saveError}</p>}
                </div>
                <div className="integration-setup__actions">
                  <button type="button" className="integration-setup__btn integration-setup__btn--secondary" onClick={() => setStep(2)}>Back</button>
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
              </>
            )}
          </div>

          {projects.length > 0 && (
            <div className="integration-setup__card">
              <div className="integration-setup__section-header">
                <h2 className="integration-setup__section-title">Connected projects</h2>
                <button type="button" className="integration-setup__btn integration-setup__btn--secondary" onClick={resetWizard}>
                  Add project
                </button>
              </div>
              {listActionMessage && (
                <p
                  className={
                    listActionMessage.tone === "error"
                      ? "integration-setup__error"
                      : "integration-setup__success"
                  }
                >
                  {listActionMessage.text}
                </p>
              )}
              <ul className="integration-setup__list">
                {projects.map((p) => (
                  <li key={p.id} className="integration-setup__list-item">
                    <div>
                      <strong>{p.label}</strong>
                      <div className="integration-setup__list-meta">
                        {p.project_id} · {authMethodLabel(p.auth_method)} ·{" "}
                        <span className={statusClass(p.status)}>{p.status}</span>
                      </div>
                      {p.last_error && <IntegrationScanErrorStatus raw={p.last_error} />}
                    </div>
                    <div className="integration-setup__actions">
                      <button type="button" className="integration-setup__btn integration-setup__btn--secondary" disabled={actionState === p.id} onClick={() => verifyProject(p.id)}>Verify</button>
                      <button type="button" className="integration-setup__btn integration-setup__btn--secondary" disabled={p.status !== "connected" || actionState === `scan-${p.id}`} onClick={() => scanProject(p.id)}>{actionState === `scan-${p.id}` ? "Scanning…" : "Scan"}</button>
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
