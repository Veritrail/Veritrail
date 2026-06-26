#!/usr/bin/env bash
# Customer one-shot GCP scanner SA setup for Veritrail impersonation auth.
# Usage:
#   export PROJECT_ID=my-project
#   export VERITRAIL_PLATFORM_SA_EMAIL=scanner@veritrail.iam.gserviceaccount.com
#   ./setup.sh

set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID required}"
: "${VERITRAIL_PLATFORM_SA_EMAIL:?VERITRAIL_PLATFORM_SA_EMAIL required}"

SA_ID="${SCANNER_SA_ID:-veritrail-scanner}"

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

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --project="$PROJECT_ID" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --member="serviceAccount:${VERITRAIL_PLATFORM_SA_EMAIL}" \
  >/dev/null

echo "service_account_email=${SA_EMAIL}"
