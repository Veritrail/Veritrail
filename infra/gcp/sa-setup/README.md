# GCP service account access — customer setup

Veritrail connects to your GCP project by **impersonating a read-only scanner service account** you deploy in your project. You grant Veritrail's platform service account `roles/iam.serviceAccountTokenCreator` on that scanner SA. **No Workload Identity pool, no JSON keys.**

This is the recommended path — similar to AWS IAM role assumption.

The **Integrations → Google Cloud** wizard is the primary customer path: it shows copy-paste **gcloud** commands (no Terraform in the UI). The `setup.sh` and Terraform modules below are optional for automation outside the wizard.

## Prerequisites

1. Enable APIs: `iam.googleapis.com`, `iamcredentials.googleapis.com`, `cloudresourcemanager.googleapis.com`, `logging.googleapis.com`, `compute.googleapis.com`
2. From Veritrail → **Integrations → Google Cloud**, choose **Service account access** and note the **Veritrail platform SA email**.

## Option A — Terraform

```bash
cd infra/gcp/sa-setup
terraform init
terraform apply \
  -var="project_id=YOUR_PROJECT" \
  -var="veritrail_platform_sa_email=PLATFORM_SA_FROM_VERITRAIL_UI"
```

Copy output `service_account_email` into Veritrail, then **Verify**.

## Option B — gcloud

```bash
export PROJECT_ID=YOUR_PROJECT
export VERITRAIL_PLATFORM_SA_EMAIL=PLATFORM_SA_FROM_VERITRAIL_UI
chmod +x setup.sh && ./setup.sh
```

## Veritrail operator (platform SA)

Veritrail runs a single platform service account used to impersonate per-customer scanner SAs:

| Variable | Purpose |
|---|---|
| `VERITRAIL_GCP_PLATFORM_SA_JSON` | Platform SA key JSON (inline PEM PKCS#8 private key) |
| `VERITRAIL_GCP_PLATFORM_SA_JSON_PATH` | Alternative: path to JSON file on the API host |
| `VERITRAIL_GCP_PLATFORM_SA_EMAIL` | Platform SA email (optional if present in JSON) |

The platform SA needs no roles in customer projects — customers grant `serviceAccountTokenCreator` on their scanner SA to this email.

## Workload Identity Federation

For cross-cloud federation without granting TokenCreator to a Veritrail SA, use `infra/gcp/wif-setup` instead (Integrations → **Workload Identity Federation**).
