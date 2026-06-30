#!/usr/bin/env bash
set -euo pipefail

# Redeploy Veritrail on an existing Ubuntu EC2 host (no Docker/TLS bootstrap).
# Pulls latest code, syncs .env.prod → .env, migrates, rebuilds prod stack.
#
#   ./scripts/deploy-ec2.sh
#   GIT_PULL=0 ./scripts/deploy-ec2.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

export ENV_FILE="${ENV_FILE:-.env.prod}"
export DOMAIN="${DOMAIN:-app.veritrail.io}"
export API_DOMAIN="${API_DOMAIN:-api.veritrail.io}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-veritrail}"

cd "$REPO_DIR"

if [[ "${GIT_PULL:-1}" == "1" ]] && [[ -d .git ]]; then
  echo "==> git pull --ff-only"
  git pull --ff-only
fi

if [[ "$(id -u)" -eq 0 ]]; then
  exec "$SCRIPT_DIR/bootstrap-ec2.sh" --deploy-only "$@"
fi

exec sudo -E ENV_FILE="$ENV_FILE" DOMAIN="$DOMAIN" API_DOMAIN="$API_DOMAIN" \
  COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" \
  "$SCRIPT_DIR/bootstrap-ec2.sh" --deploy-only "$@"
