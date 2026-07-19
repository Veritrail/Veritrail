export type GcpAuthMethod = "service_account_impersonation" | "workload_identity";

export type GcpProject = {
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

export type GcpSetup = {
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

export type GcpImpersonationSetup = {
  auth_method: string;
  project_id: string;
  platform_sa_email: string | null;
  veritrail_platform_sa_email: string | null;
  scanner_sa_email: string;
  platform_sa_configured: boolean;
  platform_sa_setup_message: string | null;
};

export const GCP_AUTH_OPTIONS: {
  id: GcpAuthMethod;
  title: string;
  description: string;
  recommended?: boolean;
}[] = [
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

export const GCP_REQUIRED_APIS = [
  "iam.googleapis.com",
  "iamcredentials.googleapis.com",
  "cloudresourcemanager.googleapis.com",
  "logging.googleapis.com",
  "compute.googleapis.com",
  "osconfig.googleapis.com",
  "securitycenter.googleapis.com",
  "cloudasset.googleapis.com",
] as const;

export const GCP_WIF_APIS = [...GCP_REQUIRED_APIS, "sts.googleapis.com"] as const;

export const GCP_CORE_PERMISSIONS = [
  { role: "roles/viewer", scope: "Project", purpose: "Read resource configuration across GCP services" },
  { role: "roles/logging.viewer", scope: "Project", purpose: "Audit log and logging configuration checks" },
  { role: "roles/osconfig.viewer", scope: "Project", purpose: "OS patch and vulnerability posture" },
  { role: "roles/securitycenter.findingsViewer", scope: "Project", purpose: "Security Command Center findings" },
  { role: "roles/cloudasset.viewer", scope: "Project", purpose: "Cloud Asset Inventory and IAM bindings" },
] as const;

export function impersonationPlatformSaEmail(setup: GcpImpersonationSetup) {
  return setup.veritrail_platform_sa_email?.trim() || setup.platform_sa_email?.trim() || "";
}

export function expectedScannerSaEmail(setup: GcpImpersonationSetup | undefined, projectId: string) {
  const fromSetup = setup?.scanner_sa_email?.trim();
  if (fromSetup) return fromSetup;
  const pid = projectId.trim();
  if (pid) return `veritrail-scanner@${pid}.iam.gserviceaccount.com`;
  return "";
}

export function gcloudSnippet(setup: GcpSetup) {
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

export function saGcloudSnippet(setup: GcpImpersonationSetup) {
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

export function authMethodLabel(method: string) {
  if (method === "service_account_impersonation") return "service account access";
  return method.replaceAll("_", " ");
}
