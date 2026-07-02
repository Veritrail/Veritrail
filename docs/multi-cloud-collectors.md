# Multi-cloud collectors (phase one & two)

Veritrail's GCP and Azure integrations collect baseline posture evidence via REST APIs, run registered checks, and persist findings scoped to cloud projects or subscriptions. Phase two adds normalized APIs and composite-control mapping so AWS, GCP, and Azure evidence surfaces consistently in the UI and audit packs.

## GCP

### Service account access (recommended)

- **Connect:** Integrations → Google Cloud → **Service account access**: project ID → copy-paste **gcloud commands** from the wizard → paste scanner SA email → verify. Optional automation: `infra/gcp/sa-setup` (`setup.sh` or Terraform).
- **Scanner roles (project-level):** `roles/viewer`, `roles/logging.viewer`, `roles/osconfig.viewer`, `roles/securitycenter.findingsViewer`, `roles/cloudasset.viewer`, plus `roles/iam.serviceAccountTokenCreator` for Veritrail's platform SA on the scanner SA.
- **Auth:** `service_account_impersonation`. Veritrail's platform SA impersonates the customer scanner SA via `roles/iam.serviceAccountTokenCreator`. No WIF pool, no JSON keys.
- **Operator:** `VERITRAIL_GCP_PLATFORM_SA_JSON` (or `VERITRAIL_GCP_PLATFORM_SA_JSON_PATH`), optional `VERITRAIL_GCP_PLATFORM_SA_EMAIL`.
- **Verify:** `POST /v1/integrations/gcp/projects/{id}/verify` — impersonation token + Cloud Resource Manager + Logging API smoke test.

### Workload Identity Federation

- **Connect:** Integrations → Google Cloud → WIF wizard: project ID → copy-paste **gcloud commands** from the wizard → paste pool/provider/SA email → verify. Optional automation: `infra/gcp/wif-setup` (`setup.sh` or Terraform).
- **Auth:** `workload_identity`. Veritrail issues short-lived OIDC tokens (`sub` = per-connection `wif_subject`), exchanges via Google STS, impersonates customer scanner SA. No long-lived JSON keys.
- **Operator:** Configure `GCP_WIF_JWT_PRIVATE_KEY` (RSA PEM), optional `GCP_WIF_ISSUER_URI`, `GCP_WIF_VERITRAIL_AUDIENCE`. Public OIDC discovery: `/v1/integrations/gcp/wif/.well-known/openid-configuration` and `/jwks`.
- **Verify:** same endpoint as above.

### Scans and data

- **Scan:** Celery task `run_gcp_scan` collects audit-log export sinks, compute instances, OS Config vulnerability reports, Security Command Center findings, and Cloud Asset Inventory IAM policies, then runs:
  - `gcp.logging.not_enabled`
  - `gcp.compute.instance_public_ip`
  - `gcp.osconfig.vuln_report_present`
  - `gcp.scc.not_enabled`
  - `gcp.asset.public_iam_binding`
- **Tables:** `gcp_projects` (WIF fields: `auth_method`, `project_number`, `pool_id`, `provider_id`, `service_account_email`, `wif_audience`, `wif_subject`), `gcp_logging_audit`, `gcp_compute_instances`, `gcp_osconfig_vuln`, `gcp_security_command_center`, `gcp_cloud_assets`
- **Setup:** See [gcp-setup.md](./gcp-setup.md) for org-level onboarding, Terraform, and verify degraded-check messaging.
- **Legacy:** `service_account_key` + JSON upload disabled unless `ALLOW_GCP_SA_JSON=true` (dev only).

## Azure

- **Connect:** Integrations → Microsoft Azure → subscription + Entra app client credentials (encrypted).
- **Note:** Client secrets are convenient for phase one but not ideal for production; federated workload identity for Azure is planned as phase two (similar to GCP WIF / AWS role assumption).
- **Verify:** `POST /v1/integrations/azure/subscriptions/{id}/verify`
- **Scan:** Celery task `run_azure_scan` collects Defender pricing/secure score and storage accounts, then runs:
  - `azure.defender.not_enabled`
  - `azure.storage.public_blob_access`
- **Tables:** `azure_subscriptions`, `azure_defender_status`, `azure_storage_accounts`

## Normalization APIs (phase two)

Unified endpoints for Integrations KPIs, Accounts page detail panes, and multi-cloud posture. All open-finding counts use the same rules as `GET /v1/findings/summary`: `status == open`, org-scoped, excluding hidden checks and retired superseded check IDs.

| Endpoint | Purpose |
|---|---|
| `GET /v1/integrations/cloud-accounts` | AWS accounts + GCP projects + Azure subscriptions in one list (`provider`, `id`, `external_id`, `label`, `status`, `last_scan_at`, **`open_findings_count` per row**) |
| `GET /v1/integrations/cloud-accounts/{provider}/{id}/overview` | GCP/Azure detail KPIs: resources, coverage window, SOC 2 posture, **`open_findings_count`**, **`open_findings_trend`** from scan history |
| `GET /v1/integrations/cloud-coverage` | Per-provider `connected_count`, `open_findings_count`, `last_scan_at` plus totals — **`total_open_findings` matches org-wide open count from findings/summary when all open findings are cloud-scoped** |
| `POST /v1/integrations/cloud-scan-all` | Queue scans for every connected AWS account, GCP project, and Azure subscription |

### Counting model

| Scope | Finding filter |
|---|---|
| AWS account row | `Finding.account_id == account.id` |
| GCP project row | `Finding.gcp_project_id == project.id` |
| Azure subscription row | `Finding.azure_subscription_id == subscription.id` |
| Provider aggregate (coverage) | Non-null scope column for that provider |
| Org cloud total | Sum of AWS + GCP + Azure provider aggregates |

Findings from GCP/Azure checks include `account_provider` (`gcp` / `azure`) and scope labels resolved from project/subscription records, matching AWS account metadata on the findings list. After each GCP/Azure scan, `cloud_scan_runs.stats` stores `open_findings_count` and `posture_score` for Accounts overview trend cards.

## Composite control mapping

GCP and Azure baseline checks are mapped into existing composites in `api/data/composite_controls.json`:

| Check | Composite |
|---|---|
| `gcp.logging.not_enabled` | `logging_monitoring` |
| `gcp.compute.instance_public_ip` | `data_protection` |
| `gcp.osconfig.vuln_report_present` | `vulnerability_management` |
| `gcp.scc.not_enabled` | `incident_response`, `logging_monitoring` |
| `gcp.asset.public_iam_binding` | `data_protection`, `network_boundary` |
| `azure.defender.not_enabled` | `logging_monitoring` |
| `azure.storage.public_blob_access` | `data_protection` |

## Scan-all UX

- **Per-provider:** GCP and Azure integration pages expose **Scan** on each connected project/subscription (unchanged).
- **Integrations hub:** **Scan all cloud** calls `POST /v1/integrations/cloud-scan-all` when any cloud account is connected. AWS scans respect the same 30-minute running-scan dedup as `POST /v1/accounts/scan-all`.

## Coverage comparison (AWS vs GCP vs Azure)

Phase-one GCP and Azure are **intentionally thin baselines**. A connected project with many resources can still show only a handful of findings if the two baseline checks pass. This is expected, not a scan failure.

| Dimension | AWS | GCP (phase one) | Azure (phase one) |
|---|---|---|---|
| Collectors | 32 (`api/app/collectors/` — IAM, S3, CloudTrail, VPC, RDS, EC2, EKS, GuardDuty, Config, Security Hub, …) | 5 (`logging_audit`, `compute`, `osconfig_vuln`, `security_command_center`, `cloud_asset_inventory`) | 2 (`defender`, `storage`) |
| Registered checks | ~100 (`ALL_CHECKS` minus `gcp.*` / `azure.*`) | 5 | 2 |
| Scan pipeline | `run_scan` → `ScanPipeline` (collectors + checks + evidence snapshots) | `run_gcp_scan` → `execute_cloud_scan` | `run_azure_scan` → `execute_cloud_scan` |
| Finding scope | `account_id` | `gcp_project_id` | `azure_subscription_id` |

**Why a GCP project can show 1 finding while AWS shows hundreds:** AWS runs dozens of collectors and checks across IAM, networking, storage, logging, databases, containers, and more. GCP phase one only evaluates (1) whether Cloud Audit Logs are routed/exported by an audit-specific logging sink and (2) whether any Compute Engine VM has an external IP. Admin Activity audit logs are written by GCP by default; this phase-one check is about retention/review routing, not whether GCP globally "enables" audit logging. Resources such as GKE, Cloud SQL, GCS buckets, firewall rules, service accounts, and Secret Manager are **not scanned yet**.

**Interpreting low GCP finding counts:** Verify `cloud_scan_runs.status = ok` and inspect collected rows in `gcp_logging_audit` / `gcp_compute_instances`. A healthy scan with few findings means the baseline checks passed or only a small subset of resources matched (e.g. one VM with a public IP).

### GCP phase-two expansion candidates

High-value additions that mirror existing AWS/Azure patterns:

| Area | Collector target | Example check |
|---|---|---|
| Storage | GCS buckets (`storage.googleapis.com`) | Public bucket / uniform access disabled |
| Networking | VPC firewall rules (`compute.firewalls`) | `0.0.0.0/0` ingress on sensitive ports |
| Databases | Cloud SQL instances | Public IP enabled |
| Containers | GKE clusters | Public control-plane endpoint |
| Identity | Service account keys (`iam.serviceAccountKeys`) | User-managed keys present |

## Vulnerability scanners

IdentityProvider types `scanner_wiz`, `scanner_tenable`, and `scanner_qualys` (one per org per vendor) store API credentials. Sync stores `open_findings_count` and `last_synced_at` in provider config — no full vuln database in phase one. Summary is exported in audit packs as `scanner_integrations.json`.

## SDLC and remediation evidence

Audit packs include `sdlc_evidence.json` with workflow run / CI pipeline counts, branch protection coverage, and open findings linked to remediation tickets (`remediation_ticket_key` / `remediation_ticket_url` on findings). Jira and Linear create-issue routes populate these fields.

See also [integrations-overview.md](./integrations-overview.md) and [external-evidence.md](./external-evidence.md).
