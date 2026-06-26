# Multi-cloud collectors (phase one)

Veritrail's phase-one GCP and Azure integrations collect baseline posture evidence via REST APIs, run registered checks, and persist findings scoped to cloud projects or subscriptions.

## GCP

- **Connect:** Integrations → Google Cloud → add project with service account JSON (encrypted at rest).
- **Verify:** `POST /v1/integrations/gcp/projects/{id}/verify` — validates credentials against Cloud Resource Manager.
- **Scan:** Celery task `run_gcp_scan` collects logging sinks and compute instances, then runs:
  - `gcp.logging.not_enabled`
  - `gcp.compute.instance_public_ip`
- **Tables:** `gcp_projects`, `gcp_logging_audit`, `gcp_compute_instances`

## Azure

- **Connect:** Integrations → Microsoft Azure → subscription + Entra app client credentials (encrypted).
- **Verify:** `POST /v1/integrations/azure/subscriptions/{id}/verify`
- **Scan:** Celery task `run_azure_scan` collects Defender pricing/secure score and storage accounts, then runs:
  - `azure.defender.not_enabled`
  - `azure.storage.public_blob_access`
- **Tables:** `azure_subscriptions`, `azure_defender_status`, `azure_storage_accounts`

## Vulnerability scanners

IdentityProvider types `scanner_wiz`, `scanner_tenable`, and `scanner_qualys` (one per org per vendor) store API credentials. Sync stores `open_findings_count` and `last_synced_at` in provider config — no full vuln database in phase one. Summary is exported in audit packs as `scanner_integrations.json`.

## SDLC and remediation evidence

Audit packs include `sdlc_evidence.json` with workflow run / CI pipeline counts, branch protection coverage, and open findings linked to remediation tickets (`remediation_ticket_key` / `remediation_ticket_url` on findings). Jira and Linear create-issue routes populate these fields.

See also [external-evidence.md](./external-evidence.md).
