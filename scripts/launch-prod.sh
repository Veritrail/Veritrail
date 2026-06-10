#!/usr/bin/env bash
set -euo pipefail

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
