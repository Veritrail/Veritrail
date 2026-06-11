#!/usr/bin/env bash
set -euo pipefail

# Production launch checklist (June 2026 assessment blockers):
#   [ ] Rotate RESEND_API_KEY; set DIGEST_FROM to a verified Resend domain
#   [ ] Set ENCRYPTION_KEY, JWT_SECRET, APP_SECRET (not dev defaults)
#   [ ] TRUST_PRINCIPAL_ARN = prod control-plane role; IAP OAuth client configured
#   [ ] CFN templates uploaded to amzn-s3-vigil; EVIDENCE_VAULT_* if using Object Lock
#   [ ] Nightly pg_dump backups scheduled (see docs/backup-restore-runbook.md)
#   [ ] Smoke-test: signup → connect AWS → scan → evidence pack download
#
# One command: Docker + certbot (if missing) + .env + TLS + migrate + prod compose up.
#
#   ./scripts/launch-prod.sh
#   ./scripts/launch-prod.sh --force-cert

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export EMAIL="${EMAIL:-zenmyx@gmail.com}"
export ENV_FILE="${ENV_FILE:-.env}"
export DOMAIN="${DOMAIN:-vigil.cclab.cloud-castles.com}"
export API_DOMAIN="${API_DOMAIN:-api.vigil.cclab.cloud-castles.com}"

if [[ "$(id -u)" -eq 0 ]]; then
  exec "$SCRIPT_DIR/bootstrap-ec2.sh" "$@"
fi

exec sudo -E EMAIL="$EMAIL" ENV_FILE="$ENV_FILE" DOMAIN="$DOMAIN" API_DOMAIN="$API_DOMAIN" \
  "$SCRIPT_DIR/bootstrap-ec2.sh" "$@"
