#!/usr/bin/env bash
set -euo pipefail

# Safely tear down legacy / duplicate Veritrail Docker Compose stacks on EC2.
# Stops containers from both legacy (vigil) and current (veritrail) project names.
# Does not remove the Postgres volume unless --wipe-volumes is passed explicitly.
#
# Primary cleanup uses `docker compose ... down` (same prod + IAP file set as bootstrap).
# Orphan containers matching veritrail-* or vigil-* (e.g. stale veritrail-oauth2-proxy-1)
# are removed only if they still exist after compose down.
#
# Usage:
#   ./scripts/reset-prod-stack.sh
#   ./scripts/reset-prod-stack.sh --prune-images
#   ./scripts/reset-prod-stack.sh --wipe-volumes   # destroys db_data volume — data loss

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-veritrail}"
LEGACY_PROJECT_NAME="vigil"

PRUNE_IMAGES=0
WIPE_VOLUMES=0

usage() {
  cat <<EOF
Usage: $0 [OPTIONS]

Stop and remove Veritrail prod compose stacks (legacy project name: $LEGACY_PROJECT_NAME,
current: $COMPOSE_PROJECT_NAME). Postgres volume is preserved unless --wipe-volumes.

Options:
  --prune-images   Remove dangling Docker images after stack teardown
  --wipe-volumes   Pass -v to compose down (removes db_data — irreversible)
  -h, --help       Show this help
EOF
}

log() { printf '==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --prune-images) PRUNE_IMAGES=1; shift ;;
      --wipe-volumes) WIPE_VOLUMES=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) warn "Unknown argument: $1"; usage; exit 1 ;;
    esac
  done
}

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
  else
    sudo docker "$@"
  fi
}

get_env_value() {
  local key="$1" file="$2"
  grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2- || true
}

is_iap_enabled() {
  local val="${1:-}"
  [[ "$val" == "1" || "$val" == "true" || "$val" == "yes" || "$val" == "TRUE" ]]
}

compose_iap_args() {
  local iap_enabled
  iap_enabled="$(get_env_value IAP_ENABLED "$REPO_DIR/$ENV_FILE")"
  if is_iap_enabled "$iap_enabled"; then
    printf '%s\0%s\0' "-f" "$REPO_DIR/compose.iap.yml"
    printf '%s\0%s\0' "--profile" "iap"
  fi
}

compose_down_project() {
  local project="$1"
  local -a iap_args=()
  local -a down_args=(down --remove-orphans)

  while IFS= read -r -d '' arg; do iap_args+=("$arg"); done < <(compose_iap_args)

  if [[ "$WIPE_VOLUMES" -eq 1 ]]; then
    down_args+=(-v)
  fi

  log "docker compose -p $project down (${down_args[*]})"
  (
    cd "$REPO_DIR"
    export COMPOSE_PROJECT_NAME="$project"
    docker_cmd compose -p "$project" \
      -f compose.yml \
      -f compose.prod.yml \
      "${iap_args[@]}" \
      --env-file "$ENV_FILE" \
      --profile prod \
      "${down_args[@]}"
  ) || warn "compose down for project '$project' failed or stack was not running"
}

remove_orphan_containers() {
  local names=()
  local name

  while IFS= read -r name; do
    [[ -n "$name" ]] && names+=("$name")
  done < <(docker_cmd ps -a --format '{{.Names}}' | grep -E '^(veritrail|vigil)-' || true)

  if [[ ${#names[@]} -eq 0 ]]; then
    log "No orphan veritrail-* / vigil-* containers found"
    return 0
  fi

  log "Removing ${#names[@]} orphan container(s): ${names[*]}"
  for name in "${names[@]}"; do
    docker_cmd rm -f "$name" 2>/dev/null || warn "Could not remove container: $name"
  done
}

prune_images() {
  log "Pruning dangling Docker images..."
  docker_cmd image prune -f
}

print_next_steps() {
  cat <<EOF

================================================================================
Prod stack reset complete.

Next steps:
  1. Ensure $ENV_FILE has COMPOSE_PROJECT_NAME=veritrail (bootstrap sets this).
  2. If oauth2-proxy was crash-looping (Restarting), IAP creds are likely missing:
       set IAP_GOOGLE_CLIENT_ID and IAP_GOOGLE_CLIENT_SECRET in $ENV_FILE, or
       set IAP_ENABLED=false to bring nginx + app up without the edge gate.
  3. Redeploy:
       cd $REPO_DIR && git pull --ff-only
       ./scripts/launch-prod.sh --deploy-only
     — or —
       ./scripts/deploy-ec2.sh

Containers will be named ${COMPOSE_PROJECT_NAME}-<service>-1 (e.g. ${COMPOSE_PROJECT_NAME}-api-1).
$(if [[ "$WIPE_VOLUMES" -eq 0 ]]; then
  echo "Postgres volume preserved. Pass --wipe-volumes only if you intend to wipe the database."
else
  echo "WARNING: --wipe-volumes was used — database volume was removed."
fi)
================================================================================
EOF
}

main() {
  parse_args "$@"

  [[ -f "$REPO_DIR/compose.yml" ]] || { warn "REPO_DIR does not look like Veritrail root: $REPO_DIR"; exit 1; }
  [[ -f "$REPO_DIR/$ENV_FILE" ]] || warn "$ENV_FILE not found — compose down may still find running containers by project name"

  if [[ "$WIPE_VOLUMES" -eq 1 ]]; then
    warn "--wipe-volumes will destroy Postgres data in project volumes (vigil_db_data / veritrail_db_data)"
  fi

  for project in "$LEGACY_PROJECT_NAME" "$COMPOSE_PROJECT_NAME"; do
    compose_down_project "$project"
  done

  remove_orphan_containers

  if [[ "$PRUNE_IMAGES" -eq 1 ]]; then
    prune_images
  fi

  print_next_steps
}

main "$@"
