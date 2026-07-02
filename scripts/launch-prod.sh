#!/usr/bin/env bash
set -euo pipefail

# Production launch checklist (June 2026 assessment blockers):
#   [ ] Rotate RESEND_API_KEY; set DIGEST_FROM to a verified Resend domain
#   [ ] Set ENCRYPTION_KEY, JWT_SECRET, APP_SECRET (not dev defaults)
#   [ ] TRUST_PRINCIPAL_ARN = prod control-plane role; IAP OAuth client configured
#   [ ] CFN templates uploaded to amzn-s3-veritrail; EVIDENCE_VAULT_* if using Object Lock
#   [ ] Nightly pg_dump backups scheduled (see docs/backup-restore-runbook.md)
#   [ ] Smoke-test: signup → connect AWS → scan → evidence pack download
#   [ ] Run: WEB_URL=https://$DOMAIN API_URL=https://$API_DOMAIN ./scripts/smoke-prod.sh
#   [ ] Run browser smoke: cd web && PLAYWRIGHT_BASE_URL=https://$DOMAIN npm run smoke:e2e
#   [ ] Replace legal contact placeholders in web/src/pages/{Privacy,Terms}.tsx
#
# One command: Docker + certbot (if missing) + .env.prod + TLS + migrate + prod compose up.
# Add --hetzner-roles-anywhere on a non-AWS VPS to also configure Vault PKI,
# IAM Roles Anywhere, the AWS profile, and the prod compose runtime mounts.
#
#   ./scripts/launch-prod.sh
#   ./scripts/launch-prod.sh --force-cert
#   ./scripts/launch-prod.sh --deploy-only          # redeploy on an already-bootstrapped host
#   ./scripts/launch-prod.sh --deploy-only --git-pull
#   ./scripts/launch-prod.sh --hetzner-roles-anywhere

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

export EMAIL="${EMAIL:-zenmyx@gmail.com}"
export ENV_FILE="${ENV_FILE:-.env.prod}"
export DOMAIN="${DOMAIN:-app.veritrail.io}"
export API_DOMAIN="${API_DOMAIN:-api.veritrail.io}"
export COMPOSE_DISABLE_GIT_TRACKING="${COMPOSE_DISABLE_GIT_TRACKING:-1}"
export BUILDX_NO_DEFAULT_ATTESTATIONS="${BUILDX_NO_DEFAULT_ATTESTATIONS:-1}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-veritrail}"
export HETZNER_ROLES_ANYWHERE="${HETZNER_ROLES_ANYWHERE:-auto}"
export AWS_REGION="${AWS_REGION:-eu-west-1}"
export AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-}"
export AWS_PROFILE_NAME="${AWS_PROFILE_NAME:-veritrail-ra}"
export RA_ROLE_NAME="${RA_ROLE_NAME:-VeritrailControlPlaneRole}"
export ASSUMABLE_ROLE_RESOURCE="${ASSUMABLE_ROLE_RESOURCE:-arn:aws:iam::*:role/VeritrailScannerRole}"
export AWS_CONFIG_DIR="${AWS_CONFIG_DIR:-}"

GIT_PULL="${GIT_PULL:-0}"
BOOTSTRAP_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --git-pull) GIT_PULL=1 ;;
    *) BOOTSTRAP_ARGS+=("$arg") ;;
  esac
done

if [[ "$GIT_PULL" == "1" ]] && [[ -d "$REPO_DIR/.git" ]]; then
  echo "==> git pull --ff-only"
  git -C "$REPO_DIR" pull --ff-only
fi

if [[ "$(id -u)" -eq 0 ]]; then
  exec "$SCRIPT_DIR/bootstrap-ec2.sh" "${BOOTSTRAP_ARGS[@]}"
fi

exec sudo -E EMAIL="$EMAIL" ENV_FILE="$ENV_FILE" DOMAIN="$DOMAIN" API_DOMAIN="$API_DOMAIN" \
  COMPOSE_DISABLE_GIT_TRACKING="$COMPOSE_DISABLE_GIT_TRACKING" \
  BUILDX_NO_DEFAULT_ATTESTATIONS="$BUILDX_NO_DEFAULT_ATTESTATIONS" \
  COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" \
  HETZNER_ROLES_ANYWHERE="$HETZNER_ROLES_ANYWHERE" \
  AWS_REGION="$AWS_REGION" \
  AWS_ACCOUNT_ID="$AWS_ACCOUNT_ID" \
  AWS_PROFILE_NAME="$AWS_PROFILE_NAME" \
  RA_ROLE_NAME="$RA_ROLE_NAME" \
  ASSUMABLE_ROLE_RESOURCE="$ASSUMABLE_ROLE_RESOURCE" \
  AWS_CONFIG_DIR="$AWS_CONFIG_DIR" \
  "$SCRIPT_DIR/bootstrap-ec2.sh" "${BOOTSTRAP_ARGS[@]}"
