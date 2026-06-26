# Multi-cloud collectors (phase one & two)

Veritrail's GCP and Azure integrations collect baseline posture evidence via REST APIs, run registered checks, and persist findings scoped to cloud projects or subscriptions. Phase two adds normalized APIs and composite-control mapping so AWS, GCP, and Azure evidence surfaces consistently in the UI and audit packs.

## GCP (production — Workload Identity Federation)

- **Connect:** Integrations → Google Cloud → WIF wizard: project ID → deploy customer trust (`infra/gcp/wif-setup` Terraform or `setup.sh`) → paste pool/provider/SA email → verify.
- **Auth:** `workload_identity` (default). Veritrail issues short-lived OIDC tokens (`sub` = per-connection `wif_subject`), exchanges via Google STS, impersonates customer scanner SA. No long-lived JSON keys.
- **Operator:** Configure `GCP_WIF_JWT_PRIVATE_KEY` (RSA PEM), optional `GCP_WIF_ISSUER_URI`, `GCP_WIF_VERITRAIL_AUDIENCE`. Public OIDC discovery: `/v1/integrations/gcp/wif/.well-known/openid-configuration` and `/jwks`.
- **Verify:** `POST /v1/integrations/gcp/projects/{id}/verify` — WIF token exchange + Cloud Resource Manager + Logging API smoke test.
- **Scan:** Celery task `run_gcp_scan` collects logging sinks and compute instances, then runs:
  - `gcp.logging.not_enabled`
  - `gcp.compute.instance_public_ip`
- **Tables:** `gcp_projects` (WIF fields: `auth_method`, `project_number`, `pool_id`, `provider_id`, `service_account_email`, `wif_audience`, `wif_subject`), `gcp_logging_audit`, `gcp_compute_instances`
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

Unified endpoints for Integrations KPIs, future Accounts page, and multi-cloud posture:

| Endpoint | Purpose |
|---|---|
| `GET /v1/integrations/cloud-accounts` | AWS accounts + GCP projects + Azure subscriptions in one list (`provider`, `id`, `external_id`, `label`, `status`, `last_scan_at`) |
| `GET /v1/integrations/cloud-coverage` | Per-provider `connected_count`, `open_findings_count`, `last_scan_at` plus totals |
| `POST /v1/integrations/cloud-scan-all` | Queue scans for every connected AWS account, GCP project, and Azure subscription |

Findings from GCP/Azure checks include `account_provider` (`gcp` / `azure`) and scope labels resolved from project/subscription records, matching AWS account metadata on the findings list.

## Composite control mapping

GCP and Azure baseline checks are mapped into existing composites in `api/data/composite_controls.json`:

| Check | Composite |
|---|---|
| `gcp.logging.not_enabled` | `logging_monitoring` |
| `gcp.compute.instance_public_ip` | `data_protection` |
| `azure.defender.not_enabled` | `logging_monitoring` |
| `azure.storage.public_blob_access` | `data_protection` |

## Scan-all UX

- **Per-provider:** GCP and Azure integration pages expose **Scan** on each connected project/subscription (unchanged).
- **Integrations hub:** **Scan all cloud** calls `POST /v1/integrations/cloud-scan-all` when any cloud account is connected. AWS scans respect the same 30-minute running-scan dedup as `POST /v1/accounts/scan-all`.

## Vulnerability scanners

IdentityProvider types `scanner_wiz`, `scanner_tenable`, and `scanner_qualys` (one per org per vendor) store API credentials. Sync stores `open_findings_count` and `last_synced_at` in provider config — no full vuln database in phase one. Summary is exported in audit packs as `scanner_integrations.json`.

## SDLC and remediation evidence

Audit packs include `sdlc_evidence.json` with workflow run / CI pipeline counts, branch protection coverage, and open findings linked to remediation tickets (`remediation_ticket_key` / `remediation_ticket_url` on findings). Jira and Linear create-issue routes populate these fields.

See also [integrations-overview.md](./integrations-overview.md) and [external-evidence.md](./external-evidence.md).
