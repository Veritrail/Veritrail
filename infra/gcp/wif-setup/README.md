# GCP Workload Identity Federation — customer setup

Veritrail connects to your GCP project using **Workload Identity Federation (WIF)**. You deploy trust once in your project; Veritrail exchanges short-lived OIDC tokens for federated access and impersonates a read-only service account. **No long-lived JSON keys.**

The **Integrations → Google Cloud** WIF wizard is the primary customer path: copy-paste **gcloud** commands from the UI. The `setup.sh` and Terraform modules below are optional for automation outside the wizard.

## Prerequisites

1. Enable APIs: `iam.googleapis.com`, `iamcredentials.googleapis.com`, `cloudresourcemanager.googleapis.com`, `logging.googleapis.com`, `compute.googleapis.com`
2. From Veritrail → **Integrations → Google Cloud**, add your project ID to obtain a unique **WIF subject** and issuer parameters.

## Option A — Terraform

```bash
cd infra/gcp/wif-setup
terraform init
terraform apply \
  -var="project_id=YOUR_PROJECT" \
  -var="project_number=YOUR_PROJECT_NUMBER" \
  -var="veritrail_issuer_uri=https://api.veritrail.io/v1/integrations/gcp/wif" \
  -var="veritrail_token_audience=veritrail-gcp" \
  -var="wif_subject=SUBJECT_FROM_VERITRAIL_UI"
```

Copy outputs `service_account_email` and `wif_audience` back into Veritrail, then **Verify**.

## Option B — gcloud

```bash
export PROJECT_ID=YOUR_PROJECT
export PROJECT_NUMBER=YOUR_PROJECT_NUMBER
export VERITRAIL_ISSUER_URI=https://api.veritrail.io/v1/integrations/gcp/wif
export WIF_SUBJECT=SUBJECT_FROM_VERITRAIL_UI
chmod +x setup.sh && ./setup.sh
```

## Veritrail OIDC issuer (operator)

Production requires:

| Variable | Purpose |
|---|---|
| `GCP_WIF_JWT_PRIVATE_KEY` | RSA PEM (PKCS#8) used to sign OIDC tokens presented to Google STS |
| `GCP_WIF_JWT_KEY_ID` | `kid` in JWKS (default `veritrail-wif-1`) |
| `GCP_WIF_ISSUER_URI` | Public issuer URL (defaults to `{API_PUBLIC_URL}/v1/integrations/gcp/wif`) |
| `GCP_WIF_VERITRAIL_AUDIENCE` | OIDC `aud` claim / provider allowed audience (default `veritrail-gcp`) |

Public endpoints (for GCP provider configuration):

- `GET /v1/integrations/gcp/wif/.well-known/openid-configuration`
- `GET /v1/integrations/gcp/wif/jwks`

Generate a key pair:

```bash
openssl genrsa -out wif-private.pem 2048
openssl rsa -in wif-private.pem -pubout -out wif-public.pem
```

Set `GCP_WIF_JWT_PRIVATE_KEY` to the PEM contents of `wif-private.pem`.

## Legacy JSON keys

`ALLOW_GCP_SA_JSON=false` by default. Service account JSON upload is disabled in production UI and API unless explicitly enabled for development.
