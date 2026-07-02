# GCP setup guide (Release 3)

Veritrail scans GCP projects via a read-only **scanner service account** (impersonation or Workload Identity Federation). This guide covers project-level and organization-level onboarding for Release 3 collectors.

## Onboarding paths

| Path | Best for | Veritrail auth |
|---|---|---|
| **Project-level** | Single-project startups | Service account impersonation or WIF per project |
| **Organization-level** | Multi-project enterprises | One scanner SA per folder/org + IAM at org/folder scope |

### Project-level (default)

1. Integrations → **Google Cloud** → choose **Service account access** or **Workload Identity Federation**.
2. Run the wizard **gcloud** commands (or `infra/gcp/sa-setup`).
3. Paste the scanner SA email → **Verify** → **Scan**.

### Organization-level

For many projects under one org:

1. Create the scanner SA in a **management project** (or shared security project).
2. Grant org- or folder-scoped IAM to the scanner SA:
   - `roles/viewer` (resource inventory baseline)
   - `roles/logging.viewer`
   - `roles/osconfig.viewer`
   - `roles/securitycenter.findingsViewer`
   - `roles/cloudasset.viewer`
3. Grant Veritrail's platform SA `roles/iam.serviceAccountTokenCreator` on the scanner SA.
4. In Veritrail, connect **each project** you want scanned (project ID + same scanner SA email). Veritrail scopes findings per connected project.

Folder-level bindings (repeat per folder if not using org-wide roles):

```bash
export FOLDER_ID=folders/1234567890
export SCANNER_SA=veritrail-scanner@mgmt-project.iam.gserviceaccount.com

for ROLE in roles/viewer roles/logging.viewer roles/osconfig.viewer \
  roles/securitycenter.findingsViewer roles/cloudasset.viewer; do
  gcloud resource-manager folders add-iam-policy-binding "$FOLDER_ID" \
    --member="serviceAccount:${SCANNER_SA}" \
    --role="$ROLE"
done
```

## Required APIs

Enable on each scanned project (or org-wide via org policy / service usage):

- `cloudresourcemanager.googleapis.com`
- `logging.googleapis.com`
- `compute.googleapis.com`
- `osconfig.googleapis.com`
- `securitycenter.googleapis.com`
- `cloudasset.googleapis.com`

## Terraform (optional)

Project-level automation lives in `infra/gcp/sa-setup/main.tf`:

```bash
cd infra/gcp/sa-setup
terraform init
terraform apply \
  -var="project_id=YOUR_PROJECT" \
  -var="veritrail_platform_sa_email=PLATFORM_SA_FROM_VERITRAIL_UI"
```

WIF path: `infra/gcp/wif-setup/`.

## Verify and degraded checks

`POST /v1/integrations/gcp/projects/{id}/verify` probes each Release 3 API. When IAM is insufficient, the response includes `degraded_checks`:

```json
{
  "ok": true,
  "project_id": "my-project",
  "degraded_checks": [
    {
      "check_id": "gcp.osconfig.vuln_report_present",
      "api": "osconfig",
      "reason": "GCP API returned HTTP 403 — grant the scanner role access to osconfig."
    }
  ]
}
```

The Integrations UI surfaces degraded check IDs after verify. Scans still run; affected checks may report **no data** until permissions are fixed.

## Release 3 collectors

| Collector | Check | Composite |
|---|---|---|
| OS Config vulnerability reports | `gcp.osconfig.vuln_report_present` | Vulnerability management |
| Security Command Center | `gcp.scc.not_enabled` | Incident response / logging |
| Cloud Asset Inventory (public IAM) | `gcp.asset.public_iam_binding` | Data protection / network boundary |

See [multi-cloud-collectors.md](./multi-cloud-collectors.md) for scan pipeline details.
