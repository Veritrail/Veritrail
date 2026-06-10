#!/usr/bin/env bash
set -euo pipefail

# One-shot EC2 production bootstrap for Vigil.
# Usage: sudo EMAIL=you@example.com ./scripts/bootstrap-ec2.sh [--force-cert]

DOMAIN="${DOMAIN:-vigil.cclab.cloud-castles.com}"
API_DOMAIN="${API_DOMAIN:-api.vigil.cclab.cloud-castles.com}"
EMAIL="${EMAIL:-}"
FORCE_CERT=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_BASE=(docker compose -f "$REPO_DIR/compose.yml" -f "$REPO_DIR/compose.prod.yml" --env-file "$REPO_DIR/$ENV_FILE" --profile prod)
CERT_NAME="$DOMAIN"
NGINX_TEMPLATE="$REPO_DIR/nginx/nginx.conf.template"
NGINX_CONF="$REPO_DIR/nginx/nginx.conf"

usage() {
  cat <<EOF
Usage: sudo EMAIL=you@example.com $0 [OPTIONS]

Bootstrap Vigil on Ubuntu EC2: Docker, Let's Encrypt, nginx, .env.prod, compose prod profile.

Environment variables:
  DOMAIN       UI hostname (default: vigil.cclab.cloud-castles.com)
  API_DOMAIN   API hostname (default: api.vigil.cclab.cloud-castles.com)
  EMAIL        Let's Encrypt contact (required)
  REPO_DIR     Repository root (auto-detected from script location)
  ENV_FILE     Env file name relative to REPO_DIR (default: .env.prod)

Options:
  --force-cert   Re-obtain certificates even if valid certs already exist
  -h, --help     Show this help

Prerequisites:
  - DNS A records for DOMAIN and API_DOMAIN pointing at this host
  - Security group allows inbound TCP 80 and 443
  - EC2 instance profile IAM role (for TRUST_PRINCIPAL_ARN auto-detect)
EOF
}

log() { printf '==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --force-cert) FORCE_CERT=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown argument: $1 (see --help)" ;;
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

compose() {
  (cd "$REPO_DIR" && ENV_FILE="$ENV_FILE" docker_cmd compose -f compose.yml -f compose.prod.yml --env-file "$ENV_FILE" --profile prod "$@")
}

compose_no_profile() {
  (cd "$REPO_DIR" && ENV_FILE="$ENV_FILE" docker_cmd compose -f compose.yml -f compose.prod.yml --env-file "$ENV_FILE" "$@")
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker_cmd compose version >/dev/null 2>&1; then
    log "Docker and compose plugin already installed — skipping"
    return 0
  fi

  log "Installing Docker (includes compose plugin)..."
  curl -fsSL https://get.docker.com | sh

  if ! docker_cmd compose version >/dev/null 2>&1; then
    die "Docker installed but compose plugin missing — install docker-compose-plugin and re-run"
  fi

  local target_user="${SUDO_USER:-${USER:-}}"
  if [[ -n "$target_user" && "$target_user" != "root" ]]; then
    usermod -aG docker "$target_user" 2>/dev/null || true
    log "Added $target_user to docker group (log out/in if docker without sudo fails)"
  fi
}

install_certbot() {
  if command -v certbot >/dev/null 2>&1; then
    log "certbot already installed — skipping"
    return 0
  fi

  log "Installing certbot..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq
    apt-get install -y -qq certbot
  else
    die "certbot install via apt is only supported on Debian/Ubuntu EC2"
  fi
}

certs_valid() {
  local cert_dir="/etc/letsencrypt/live/$CERT_NAME"
  [[ -f "$cert_dir/fullchain.pem" && -f "$cert_dir/privkey.pem" ]] || return 1
  certbot certificates 2>/dev/null | grep -q "Certificate Name: $CERT_NAME" || return 1
  return 0
}

stop_port_binders() {
  log "Stopping services that may bind ports 80/443..."
  compose stop nginx 2>/dev/null || true
  compose_no_profile stop nginx 2>/dev/null || true

  if command -v fuser >/dev/null 2>&1; then
    fuser -k 80/tcp 443/tcp 2>/dev/null || true
  fi
}

obtain_certs() {
  if [[ "$FORCE_CERT" -eq 0 ]] && certs_valid; then
    log "Valid Let's Encrypt certs found for $CERT_NAME — skipping (use --force-cert to renew)"
    return 0
  fi

  [[ -n "$EMAIL" ]] || die "EMAIL is required for certbot (e.g. sudo EMAIL=you@example.com $0)"

  stop_port_binders

  log "Obtaining certificate for $DOMAIN and $API_DOMAIN..."
  local renew_args=()
  if [[ "$FORCE_CERT" -eq 1 ]] && certs_valid; then
    renew_args=(--force-renewal)
  fi
  certbot certonly --standalone \
    -d "$DOMAIN" \
    -d "$API_DOMAIN" \
    --email "$EMAIL" \
    --agree-tos \
    --non-interactive \
    "${renew_args[@]}"
}

render_nginx_conf() {
  [[ -f "$NGINX_TEMPLATE" ]] || die "Missing nginx template: $NGINX_TEMPLATE"
  log "Rendering $NGINX_CONF from template..."
  sed \
    -e "s|__DOMAIN__|${DOMAIN}|g" \
    -e "s|__API_DOMAIN__|${API_DOMAIN}|g" \
    -e "s|__CERT_NAME__|${CERT_NAME}|g" \
    "$NGINX_TEMPLATE" > "$NGINX_CONF"
}

install_renewal_cron() {
  local compose_renew="cd $REPO_DIR && ENV_FILE=$ENV_FILE docker compose -f compose.yml -f compose.prod.yml --env-file $ENV_FILE --profile prod"
  local cron_job="0 3 * * * certbot renew --quiet --pre-hook \"$compose_renew stop nginx\" --post-hook \"$compose_renew up -d nginx\""

  log "Installing certbot renewal cron job..."
  (crontab -l 2>/dev/null | grep -v "certbot renew" || true; echo "$cron_job") | crontab -
}

get_env_value() {
  local key="$1" file="$2"
  grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2- || true
}

set_env_value() {
  local key="$1" value="$2" file="$3"
  local escaped="${value//\\/\\\\}"
  escaped="${escaped//|/\\|}"

  if grep -qE "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

random_secret() {
  openssl rand -hex 32
}

random_fernet_key() {
  python3 -c "import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
}

detect_instance_role_arn() {
  local token role account
  token="$(curl -fsS -m 2 -X PUT "http://169.254.169.254/latest/api/token" \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null)" || return 1
  role="$(curl -fsS -m 2 -H "X-aws-ec2-metadata-token: $token" \
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/" 2>/dev/null)" || return 1
  [[ -n "$role" ]] || return 1
  account="$(curl -fsS -m 2 -H "X-aws-ec2-metadata-token: $token" \
    "http://169.254.169.254/latest/dynamic/instance-identity/document" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['accountId'])" 2>/dev/null)" || return 1
  echo "arn:aws:iam::${account}:role/${role}"
}

is_placeholder_secret() {
  local val="$1"
  [[ -z "$val" || "$val" == "change-me-long-random" ]]
}

is_placeholder_trust() {
  local val="$1"
  [[ -z "$val" || "$val" == "arn:aws:iam::000000000000:root" ]]
}

ensure_env_prod() {
  local env_path="$REPO_DIR/$ENV_FILE"
  local example_path="$REPO_DIR/.env.example"

  if [[ ! -f "$env_path" ]]; then
    [[ -f "$example_path" ]] || die "Missing $ENV_FILE and .env.example — cannot seed env"
    log "Seeding $ENV_FILE from .env.example..."
    cp "$example_path" "$env_path"
  fi

  local frontend_url="https://${DOMAIN}"
  local api_url="https://${API_DOMAIN}"

  set_env_value "FRONTEND_URL" "$frontend_url" "$env_path"
  set_env_value "API_PUBLIC_URL" "$api_url" "$env_path"
  set_env_value "VITE_API_URL" "$api_url" "$env_path"
  set_env_value "APP_ENV" "production" "$env_path"

  local jwt_secret app_secret trust_arn detected_arn
  jwt_secret="$(get_env_value JWT_SECRET "$env_path")"
  app_secret="$(get_env_value APP_SECRET "$env_path")"
  trust_arn="$(get_env_value TRUST_PRINCIPAL_ARN "$env_path")"

  if is_placeholder_secret "$jwt_secret"; then
    set_env_value "JWT_SECRET" "$(random_secret)" "$env_path"
    log "Generated JWT_SECRET"
  fi

  if is_placeholder_secret "$app_secret"; then
    set_env_value "APP_SECRET" "$(random_secret)" "$env_path"
    log "Generated APP_SECRET"
  fi

  local encryption_key
  encryption_key="$(get_env_value ENCRYPTION_KEY "$env_path")"
  if [[ -z "$encryption_key" ]]; then
    set_env_value "ENCRYPTION_KEY" "$(random_fernet_key)" "$env_path"
    log "Generated ENCRYPTION_KEY"
  fi

  if is_placeholder_trust "$trust_arn"; then
    if detected_arn="$(detect_instance_role_arn)"; then
      set_env_value "TRUST_PRINCIPAL_ARN" "$detected_arn" "$env_path"
      log "Set TRUST_PRINCIPAL_ARN from EC2 instance profile: $detected_arn"
    else
      warn "Could not detect EC2 instance role via IMDS — set TRUST_PRINCIPAL_ARN manually in $ENV_FILE"
    fi
  else
    log "TRUST_PRINCIPAL_ARN already set — leaving unchanged"
  fi

  trust_arn="$(get_env_value TRUST_PRINCIPAL_ARN "$env_path")"
  if is_placeholder_trust "$trust_arn"; then
    warn "TRUST_PRINCIPAL_ARN is still a placeholder ($trust_arn)"
    warn "Customer CFN stacks will not trust this host until you set the real control-plane role ARN"
  fi
}

wait_for_db() {
  local user
  user="$(get_env_value POSTGRES_USER "$REPO_DIR/$ENV_FILE")"
  user="${user:-hygiene}"
  local tries=60
  log "Waiting for Postgres to accept connections..."
  while [[ $tries -gt 0 ]]; do
    if compose_no_profile exec -T db pg_isready -U "$user" >/dev/null 2>&1; then
      return 0
    fi
    tries=$((tries - 1))
    sleep 2
  done
  die "Postgres did not become ready in time"
}

wait_for_redis() {
  local tries=30
  log "Waiting for Redis..."
  while [[ $tries -gt 0 ]]; do
    if compose_no_profile exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
      return 0
    fi
    tries=$((tries - 1))
    sleep 2
  done
  die "Redis did not become ready in time"
}

deploy_compose() {
  log "Starting db and redis..."
  compose_no_profile up -d db redis
  wait_for_db
  wait_for_redis

  log "Running database migrations..."
  compose_no_profile run --rm api alembic upgrade head

  log "Building and starting production stack..."
  compose up -d --build
}

health_check() {
  local url="https://${API_DOMAIN}/healthz"
  local tries=30
  log "Health check: $url"
  while [[ $tries -gt 0 ]]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      log "API health check passed"
      curl -fsS "$url" || true
      return 0
    fi
    tries=$((tries - 1))
    sleep 5
  done
  warn "API health check failed — inspect logs: compose logs api nginx"
  return 1
}

print_checklist() {
  local compose_hint="cd $REPO_DIR && ENV_FILE=$ENV_FILE docker compose -f compose.yml -f compose.prod.yml --env-file $ENV_FILE --profile prod"
  cat <<EOF

================================================================================
Vigil production bootstrap complete.

Post-deploy checklist:
  1. Open https://${DOMAIN} and confirm the UI loads.
  2. OAuth callback URLs (GitHub / Google / GitLab apps):
       ${API_DOMAIN}/v1/auth/github/callback
       ${API_DOMAIN}/v1/auth/google/callback
       ${API_DOMAIN}/v1/auth/gitlab/callback
  3. EC2 instance IAM role must match TRUST_PRINCIPAL_ARN in $ENV_FILE
     (customer CFN connector stack trusts this principal for sts:AssumeRole).
  4. If you change TRUST_PRINCIPAL_ARN, update existing customer scanner role
     trust policies in AWS, then recreate API/worker:
       $compose_hint up -d --force-recreate api worker beat
  5. After any $ENV_FILE edit, recreate affected services:
       $compose_hint up -d --force-recreate api worker beat web
  6. Optional: configure RESEND_API_KEY, OAuth secrets, B2 backup vars in $ENV_FILE

Useful commands:
  $compose_hint ps
  $compose_hint logs -f api
  $compose_hint run --rm backup
================================================================================
EOF
}

main() {
  parse_args "$@"

  [[ -f "$REPO_DIR/compose.yml" ]] || die "REPO_DIR does not look like Vigil root: $REPO_DIR"

  install_docker
  install_certbot
  ensure_env_prod
  obtain_certs
  render_nginx_conf
  install_renewal_cron
  deploy_compose
  health_check || true
  print_checklist
}

main "$@"
