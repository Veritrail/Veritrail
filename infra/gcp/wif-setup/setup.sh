#!/usr/bin/env bash
# Customer one-shot GCP WIF setup for Veritrail (gcloud alternative to Terraform).
# Usage:
#   export PROJECT_ID=my-project
#   export PROJECT_NUMBER=123456789012
#   export VERITRAIL_ISSUER_URI=https://api.example.com/v1/integrations/gcp/wif
#   export VERITRAIL_TOKEN_AUDIENCE=veritrail-gcp
#   export WIF_SUBJECT=<from Veritrail UI>
#   ./setup.sh

set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID required}"
: "${PROJECT_NUMBER:?PROJECT_NUMBER required}"
: "${VERITRAIL_ISSUER_URI:?VERITRAIL_ISSUER_URI required}"
: "${WIF_SUBJECT:?WIF_SUBJECT required}"

POOL_ID="${POOL_ID:-veritrail}"
PROVIDER_ID="${PROVIDER_ID:-veritrail-oidc}"
SA_ID="${SCANNER_SA_ID:-veritrail-scanner}"
TOKEN_AUDIENCE="${VERITRAIL_TOKEN_AUDIENCE:-veritrail-gcp}"

gcloud iam workload-identity-pools create "$POOL_ID" \
  --project="$PROJECT_ID" \
  --location=global \
  --display-name="Veritrail" \
  --description="Federated access for Veritrail posture scans" \
  2>/dev/null || true

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --project="$PROJECT_ID" \
  --location=global \
  --workload-identity-pool="$POOL_ID" \
  --display-name="Veritrail OIDC" \
  --issuer-uri="$VERITRAIL_ISSUER_URI" \
  --allowed-audiences="$TOKEN_AUDIENCE" \
  --attribute-mapping="google.subject=assertion.sub" \
  2>/dev/null || true

gcloud iam service-accounts create "$SA_ID" \
  --project="$PROJECT_ID" \
  --display-name="Veritrail scanner (read-only)" \
  2>/dev/null || true

SA_EMAIL="${SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/viewer" \
  --condition=None \
  >/dev/null

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/logging.viewer" \
  --condition=None \
  >/dev/null

PRINCIPAL="principal://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/subject/${WIF_SUBJECT}"

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="$PRINCIPAL" \
  >/dev/null

AUDIENCE="//iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"

echo "service_account_email=${SA_EMAIL}"
echo "wif_audience=${AUDIENCE}"
echo "principal_member=${PRINCIPAL}"
