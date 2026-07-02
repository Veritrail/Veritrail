#!/usr/bin/env bash
set -euo pipefail

# Renew the Vault PKI client certificate used for IAM Roles Anywhere when it is
# close to expiry. Safe to run from cron — no-op if the cert is still fresh.
#
#   sudo ./scripts/renew-vault-client-cert.sh
#   RENEW_WITHIN_DAYS=14 sudo ./scripts/renew-vault-client-cert.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

STATE_DIR="${STATE_DIR:-/etc/veritrail/aws-ra}"
CLIENT_CERT="${STATE_DIR}/client.pem"
RENEW_WITHIN_DAYS="${RENEW_WITHIN_DAYS:-7}"
ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-veritrail}"

log() { printf '==> %s\n' "$*" >&2; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }

cert_expires_within_days() {
  local cert="$1" days="$2" not_after epoch now cutoff
  [[ -s "$cert" ]] || return 1
  not_after="$(openssl x509 -in "$cert" -noout -enddate 2>/dev/null | cut -d= -f2-)" || return 1
  epoch="$(date -d "$not_after" +%s 2>/dev/null || date -j -f "%b %d %T %Y %Z" "$not_after" +%s 2>/dev/null)" || return 1
  now="$(date +%s)"
  cutoff=$((now + days * 86400))
  [[ "$epoch" -le "$cutoff" ]]
}

compose_recreate_aws_services() {
  local env_path="$REPO_DIR/$ENV_FILE"
  [[ -f "$env_path" ]] || { warn "Missing $env_path — skip service recreate"; return 0; }

  local -a compose_args=(
    -f "$REPO_DIR/compose.yml"
    -f "$REPO_DIR/compose.prod.yml"
    --env-file "$env_path"
    --profile prod
  )
  if grep -qE '^IAP_ENABLED=true' "$env_path" 2>/dev/null; then
    compose_args+=(-f "$REPO_DIR/compose.iap.yml" --profile iap)
  fi
  if [[ -f "$REPO_DIR/compose.hetzner-rolesanywhere.yml" ]] \
    && grep -qE '^(AWS_PROFILE|TRUST_PRINCIPAL_ARN)=' "$env_path" 2>/dev/null; then
    compose_args+=(-f "$REPO_DIR/compose.hetzner-rolesanywhere.yml")
  fi

  log "Recreating api/worker/beat after client cert rotation"
  (
    cd "$REPO_DIR"
    export COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME"
    docker compose "${compose_args[@]}" up -d --force-recreate api worker beat
  ) || warn "Compose recreate failed — restart api/worker/beat manually"
}

main() {
  if [[ ! -s "$CLIENT_CERT" ]]; then
    warn "No Vault client cert at $CLIENT_CERT — skipping"
    exit 0
  fi

  if ! cert_expires_within_days "$CLIENT_CERT" "$RENEW_WITHIN_DAYS"; then
    log "Client cert still valid beyond ${RENEW_WITHIN_DAYS}d — no renewal needed"
    exit 0
  fi

  log "Client cert expires within ${RENEW_WITHIN_DAYS}d — re-issuing via Vault PKI"
  local hetzner_script="$SCRIPT_DIR/bootstrap-hetzner-vault-rolesanywhere.sh"
  [[ -x "$hetzner_script" ]] || { warn "Missing $hetzner_script"; exit 1; }

  if [[ "$(id -u)" -ne 0 ]]; then
    exec sudo -E RENEW_WITHIN_DAYS="$RENEW_WITHIN_DAYS" ENV_FILE="$ENV_FILE" \
      COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" REPO_DIR="$REPO_DIR" "$0" "$@"
  fi

  REPO_DIR="$REPO_DIR" ENV_FILE="$ENV_FILE" "$hetzner_script" --force-cert --skip-aws --skip-env
  compose_recreate_aws_services
  log "Vault client certificate renewed"
}

main "$@"
