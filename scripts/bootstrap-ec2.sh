#!/usr/bin/env bash
set -euo pipefail

# One-shot EC2 production bootstrap for Veritrail.
# Usage: sudo EMAIL=you@example.com ./scripts/bootstrap-ec2.sh [--force-cert]

DOMAIN="${DOMAIN:-app.veritrail.io}"
API_DOMAIN="${API_DOMAIN:-api.veritrail.io}"
EMAIL="${EMAIL:-}"
FORCE_CERT=0
DEPLOY_ONLY=0
HOT_RELOAD="${HOT_RELOAD:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-veritrail}"
COMPOSE_BASE=(docker compose -f "$REPO_DIR/compose.yml" -f "$REPO_DIR/compose.prod.yml" --env-file "$REPO_DIR/$ENV_FILE" --profile prod)
CERT_NAME="$DOMAIN"
NGINX_TEMPLATE="$REPO_DIR/nginx/nginx.conf.template"
NGINX_CONF="$REPO_DIR/nginx/nginx.conf"

usage() {
  cat <<EOF
Usage: sudo EMAIL=you@example.com $0 [OPTIONS]

Bootstrap Veritrail on Ubuntu EC2: base packages, Docker, Let's Encrypt, nginx, .env.prod, compose prod profile.

Environment variables:
  DOMAIN       UI hostname (default: app.veritrail.io)
  API_DOMAIN   API hostname (default: api.veritrail.io)
  EMAIL        Let's Encrypt contact (required on first bootstrap)
  REPO_DIR     Repository root (auto-detected from script location)
  ENV_FILE     Canonical prod env file relative to REPO_DIR (default: .env.prod)

Options:
  --deploy-only  Skip Docker/TLS/cron install; sync env + migrate + compose up (for redeploys)
  --force-cert   Re-obtain certificates even if valid certs already exist
  --hot-reload   Run API/web/worker from bind-mounted source with reload watchers
  -h, --help     Show this help

Prerequisites:
  - Ubuntu 22.04/24.04 EC2 (or Debian with apt)
  - Place secrets in $ENV_FILE before first run (or let the script seed from .env.example)
  - DNS A records for DOMAIN and API_DOMAIN pointing at this host
  - Security group allows inbound TCP 80 and 443
  - EC2 instance profile IAM role (for TRUST_PRINCIPAL_ARN auto-detect)
EOF
}

log() { printf '==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# Docker Compose tries `git rev-parse` during build to stamp image metadata.
# That is optional — builds must not depend on git auth or even a .git directory.
export COMPOSE_DISABLE_GIT_TRACKING="${COMPOSE_DISABLE_GIT_TRACKING:-1}"
export BUILDX_NO_DEFAULT_ATTESTATIONS="${BUILDX_NO_DEFAULT_ATTESTATIONS:-1}"

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --deploy-only) DEPLOY_ONLY=1; shift ;;
      --force-cert) FORCE_CERT=1; shift ;;
      --hot-reload) HOT_RELOAD=1; shift ;;
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

compose_hot_args() {
  if [[ "$HOT_RELOAD" == "1" || "$HOT_RELOAD" == "true" || "$HOT_RELOAD" == "yes" ]]; then
    printf '%s\0%s\0' "-f" "$REPO_DIR/compose.prod-hot.yml"
  fi
}

compose() {
  local -a iap_args=()
  local -a hot_args=()
  while IFS= read -r -d '' arg; do hot_args+=("$arg"); done < <(compose_hot_args)
  while IFS= read -r -d '' arg; do iap_args+=("$arg"); done < <(compose_iap_args)
  (cd "$REPO_DIR" && COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" ENV_FILE="$ENV_FILE" APP_ENV=production docker_cmd compose -f compose.yml -f compose.prod.yml "${hot_args[@]}" "${iap_args[@]}" --env-file "$ENV_FILE" --profile prod "$@")
}

compose_no_profile() {
  local -a hot_args=()
  while IFS= read -r -d '' arg; do hot_args+=("$arg"); done < <(compose_hot_args)
  (cd "$REPO_DIR" && COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" ENV_FILE="$ENV_FILE" APP_ENV=production docker_cmd compose -f compose.yml -f compose.prod.yml "${hot_args[@]}" --env-file "$ENV_FILE" "$@")
}

install_system_packages() {
  if ! command -v apt-get >/dev/null 2>&1; then
    warn "Non-Debian host — skipping apt base package install"
    return 0
  fi

  log "Installing base packages for Ubuntu EC2..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq \
    ca-certificates \
    curl \
    git \
    gnupg \
    lsb-release \
    openssl \
    python3 \
    psmisc \
    sed

  if ! command -v python3 >/dev/null 2>&1; then
    die "python3 is required but could not be installed"
  fi
  if ! command -v openssl >/dev/null 2>&1; then
    die "openssl is required but could not be installed"
  fi
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

render_iap_nginx() {
  local iap_dir="$REPO_DIR/nginx/iap"
  local src_dir="$REPO_DIR/infra/nginx/iap"
  local iap_enabled
  iap_enabled="$(get_env_value IAP_ENABLED "$REPO_DIR/$ENV_FILE")"
  mkdir -p "$iap_dir"
  if is_iap_enabled "$iap_enabled"; then
    cp "$src_dir/enabled.oauth2.conf" "$iap_dir/iap.oauth2.conf"
    cp "$src_dir/enabled.auth.conf" "$iap_dir/iap.auth.conf"
    local iap_dom
    iap_dom="$(get_env_value IAP_ALLOWED_EMAIL_DOMAIN "$REPO_DIR/$ENV_FILE")"
    log "IAP enabled — edge Google gate for @${iap_dom:-cloud-castles.com}"
  else
    cp "$src_dir/disabled.oauth2.conf" "$iap_dir/iap.oauth2.conf"
    cp "$src_dir/disabled.auth.conf" "$iap_dir/iap.auth.conf"
    log "IAP disabled — nginx serves without oauth2-proxy gate"
  fi
}

install_fail2ban() {
  local log_dir="$REPO_DIR/var/log/nginx"
  local access_log="$log_dir/access.log"
  local jail_dest="/etc/fail2ban/jail.d/veritrail-nginx.local.conf"
  local filter_src="$REPO_DIR/infra/fail2ban/filter.d/veritrail-nginx-scan.conf"
  local jail_tpl="$REPO_DIR/infra/fail2ban/jail.d/veritrail-nginx.local.conf.template"

  [[ -f "$filter_src" && -f "$jail_tpl" ]] || die "Missing fail2ban config under infra/fail2ban/"

  mkdir -p "$log_dir"
  touch "$access_log"
  chmod 644 "$access_log"

  if command -v fail2ban-client >/dev/null 2>&1; then
    log "fail2ban already installed — configuring veritrail-nginx-scan jail"
  else
    log "Installing fail2ban..."
    if command -v apt-get >/dev/null 2>&1; then
      apt-get update -qq
      apt-get install -y -qq fail2ban
    else
      warn "fail2ban install via apt is only supported on Debian/Ubuntu EC2 — skipping"
      return 0
    fi
  fi

  install -m 644 "$filter_src" /etc/fail2ban/filter.d/veritrail-nginx-scan.conf
  sed "s|__VERITRAIL_NGINX_ACCESS_LOG__|$access_log|g" "$jail_tpl" > "$jail_dest"
  chmod 644 "$jail_dest"

  systemctl enable fail2ban >/dev/null 2>&1 || true
  systemctl restart fail2ban
  log "fail2ban jail veritrail-nginx-scan enabled (30x 404/301 in 60s → 1h ban; log: $access_log)"
}

install_renewal_cron() {
  local iap_suffix=""
  if is_iap_enabled "$(get_env_value IAP_ENABLED "$REPO_DIR/$ENV_FILE")"; then
    iap_suffix=" -f compose.iap.yml --profile iap"
  fi
  local compose_renew="cd $REPO_DIR && export COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME && ENV_FILE=$ENV_FILE docker compose -f compose.yml -f compose.prod.yml${iap_suffix} --env-file $ENV_FILE --profile prod"
  local cron_job="0 3 * * * certbot renew --quiet --pre-hook \"$compose_renew stop nginx\" --post-hook \"$compose_renew up -d nginx oauth2-proxy\""

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

# oauth2-proxy v7 uses len(cookie_secret) as the AES key size — must be 16, 24, or 32 bytes.
iap_cookie_secret_valid() {
  local len="${#1}"
  [[ "$len" -eq 16 || "$len" -eq 24 || "$len" -eq 32 ]]
}

random_iap_cookie_secret() {
  openssl rand -hex 16
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
  else
    log "Using existing $ENV_FILE"
  fi

  local frontend_url="https://${DOMAIN}"
  local api_url="https://${API_DOMAIN}"

  set_env_value "FRONTEND_URL" "$frontend_url" "$env_path"
  set_env_value "API_PUBLIC_URL" "$api_url" "$env_path"
  set_env_value "VITE_API_URL" "$api_url" "$env_path"
  set_env_value "APP_ENV" "production" "$env_path"
  set_env_value "DOMAIN" "$DOMAIN" "$env_path"
  set_env_value "API_DOMAIN" "$API_DOMAIN" "$env_path"

  local compose_project
  compose_project="$(get_env_value COMPOSE_PROJECT_NAME "$env_path")"
  if [[ -z "$compose_project" || "$compose_project" == "vigil" ]]; then
    set_env_value "COMPOSE_PROJECT_NAME" "veritrail" "$env_path"
    log "Set COMPOSE_PROJECT_NAME=veritrail (was: ${compose_project:-<unset>})"
  fi

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

  local iap_enabled iap_domain google_domain
  iap_enabled="$(get_env_value IAP_ENABLED "$env_path")"
  if [[ -z "$iap_enabled" ]]; then
    set_env_value "IAP_ENABLED" "true" "$env_path"
    iap_enabled="true"
    log "Set IAP_ENABLED=true (Google edge gate for @cloud-castles.com)"
  fi

  iap_domain="$(get_env_value IAP_ALLOWED_EMAIL_DOMAIN "$env_path")"
  if [[ -z "$iap_domain" ]]; then
    set_env_value "IAP_ALLOWED_EMAIL_DOMAIN" "cloud-castles.com" "$env_path"
    iap_domain="cloud-castles.com"
  fi

  google_domain="$(get_env_value GOOGLE_ALLOWED_DOMAIN "$env_path")"
  if [[ -z "$google_domain" ]]; then
    set_env_value "GOOGLE_ALLOWED_DOMAIN" "$iap_domain" "$env_path"
  fi

  local cookie_domain
  cookie_domain="$(get_env_value IAP_COOKIE_DOMAIN "$env_path")"
  if [[ -z "$cookie_domain" && "$DOMAIN" == *.* ]]; then
    cookie_domain=".${DOMAIN#*.}"
    set_env_value "IAP_COOKIE_DOMAIN" "$cookie_domain" "$env_path"
    log "Set IAP_COOKIE_DOMAIN=$cookie_domain (shared across $DOMAIN and $API_DOMAIN)"
  fi

  local whitelist
  whitelist="$(get_env_value IAP_WHITELIST_DOMAINS "$env_path")"
  if [[ -z "$whitelist" ]]; then
    set_env_value "IAP_WHITELIST_DOMAINS" "${DOMAIN},${API_DOMAIN}" "$env_path"
  fi

  if is_iap_enabled "$iap_enabled"; then
    local iap_secret iap_client iap_secret_val google_id google_secret
    iap_secret="$(get_env_value IAP_COOKIE_SECRET "$env_path")"
    if [[ -z "$iap_secret" ]]; then
      set_env_value "IAP_COOKIE_SECRET" "$(random_iap_cookie_secret)" "$env_path"
      log "Generated IAP_COOKIE_SECRET (32-byte hex string for oauth2-proxy)"
    elif ! iap_cookie_secret_valid "$iap_secret"; then
      warn "IAP_COOKIE_SECRET length is ${#iap_secret} bytes — oauth2-proxy requires exactly 16, 24, or 32"
      warn "Regenerating IAP_COOKIE_SECRET (invalidates existing IAP sessions)"
      set_env_value "IAP_COOKIE_SECRET" "$(random_iap_cookie_secret)" "$env_path"
    fi

    iap_client="$(get_env_value IAP_GOOGLE_CLIENT_ID "$env_path")"
    google_id="$(get_env_value GOOGLE_CLIENT_ID "$env_path")"
    if [[ -z "$iap_client" && -n "$google_id" ]]; then
      set_env_value "IAP_GOOGLE_CLIENT_ID" "$google_id" "$env_path"
      log "Set IAP_GOOGLE_CLIENT_ID from GOOGLE_CLIENT_ID (use a dedicated OAuth app in prod)"
    fi

    iap_secret_val="$(get_env_value IAP_GOOGLE_CLIENT_SECRET "$env_path")"
    google_secret="$(get_env_value GOOGLE_CLIENT_SECRET "$env_path")"
    if [[ -z "$iap_secret_val" && -n "$google_secret" ]]; then
      set_env_value "IAP_GOOGLE_CLIENT_SECRET" "$google_secret" "$env_path"
    fi

    iap_client="$(get_env_value IAP_GOOGLE_CLIENT_ID "$env_path")"
    iap_secret_val="$(get_env_value IAP_GOOGLE_CLIENT_SECRET "$env_path")"
    if [[ -z "$iap_client" || -z "$iap_secret_val" ]]; then
      warn "IAP_ENABLED=true but IAP_GOOGLE_CLIENT_ID or IAP_GOOGLE_CLIENT_SECRET is empty"
      warn "Disabling IAP so nginx and the app can start — set credentials and IAP_ENABLED=true to re-enable"
      warn "Google OAuth redirect URI: https://${DOMAIN}/oauth2/callback"
      set_env_value "IAP_ENABLED" "false" "$env_path"
    fi
  fi
}

sync_dotenv_from_prod() {
  local env_path="$REPO_DIR/$ENV_FILE"
  local dot_env="$REPO_DIR/.env"
  local compose_env="$REPO_DIR/.compose.prod.env"

  [[ -f "$env_path" ]] || die "Missing $ENV_FILE — cannot activate production env"

  if [[ -f "$dot_env" ]] && ! cmp -s "$env_path" "$dot_env"; then
    local backup="$REPO_DIR/.env.pre-prod.$(date +%Y%m%d%H%M%S).bak"
    log "Backing up existing .env to $(basename "$backup")"
    cp "$dot_env" "$backup"
  fi

  log "Activating $ENV_FILE for compose (copying to .env)"
  cp "$env_path" "$dot_env"
  chmod 600 "$env_path" "$dot_env" 2>/dev/null || true

  cat >"$compose_env" <<EOF
# Generated by scripts/bootstrap-ec2.sh — source before manual compose commands.
export REPO_DIR=$REPO_DIR
export ENV_FILE=$ENV_FILE
export APP_ENV=production
export COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME
export DOMAIN=$DOMAIN
export API_DOMAIN=$API_DOMAIN
EOF
  chmod 644 "$compose_env"
  log "Wrote $(basename "$compose_env") — source it for manual docker compose commands"
}

wait_for_db() {
  local user
  user="$(get_env_value POSTGRES_USER "$REPO_DIR/$ENV_FILE")"
  user="${user:-hygiene}"
  local tries=10
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
  local tries=10
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
  if [[ "$HOT_RELOAD" == "1" || "$HOT_RELOAD" == "true" || "$HOT_RELOAD" == "yes" ]]; then
    warn "Hot reload mode enabled — this uses bind-mounted source and dev servers behind prod nginx."
  fi
  log "Starting db and redis..."
  compose_no_profile up -d db redis
  wait_for_db
  wait_for_redis

  log "Running database migrations..."
  compose_no_profile run --rm api alembic upgrade head

  # Defend against host web/node_modules + web/dist copied in via SFTP/scp:
  # `COPY web/ .` in Dockerfile.prod would overwrite the image's clean `npm ci`
  # output and break node_modules/.bin (sh: vite: Permission denied, exit 126).
  # .dockerignore covers this only if it transferred; this guarantees it.
  if [[ -d "$REPO_DIR/web/node_modules" || -d "$REPO_DIR/web/dist" ]]; then
    log "Removing host web/node_modules + web/dist (prevents exit-126 vite build break)..."
    rm -rf "$REPO_DIR/web/node_modules" "$REPO_DIR/web/dist"
  fi

  log "Building and starting production stack..."
  compose up -d --build

  log "Ensuring nginx is up (must run even if oauth2-proxy is unhealthy)..."
  compose up -d nginx --force-recreate
  verify_nginx_running || true
}

verify_nginx_running() {
  local cid status stable=0 tries=10

  log "Verifying nginx stays running (oauth2-proxy may still be crash-looping)..."
  while [[ $tries -gt 0 ]]; do
    cid="$(compose ps --status running -q nginx 2>/dev/null | head -1 || true)"
    if [[ -n "$cid" ]]; then
      status="$(docker_cmd inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || echo unknown)"
      if [[ "$status" == "running" ]]; then
        stable=$((stable + 1))
        if [[ $stable -ge 2 ]]; then
          log "nginx container is running"
          return 0
        fi
      else
        stable=0
      fi
    else
      stable=0
    fi
    tries=$((tries - 1))
    sleep 2
  done

  warn "nginx is not running after deploy"
  warn "Inspect logs: compose logs nginx"
  warn "Last 30 lines of nginx logs:"
  compose logs --tail=30 nginx 2>&1 || true
  if is_iap_enabled "$(get_env_value IAP_ENABLED "$REPO_DIR/$ENV_FILE")"; then
    warn "If oauth2-proxy is crash-looping, fix IAP_COOKIE_SECRET (16/24/32 bytes) then: compose up -d oauth2-proxy nginx --force-recreate"
  fi
  return 1
}

health_check() {
  local url="https://127.0.0.1/healthz"
  local tries=10
  log "Health check: $url (Host: ${API_DOMAIN})"
  while [[ $tries -gt 0 ]]; do
    if curl -fsS --connect-timeout 5 -k "$url" -H "Host: ${API_DOMAIN}" >/dev/null 2>&1; then
      log "API health check passed"
      curl -fsS --connect-timeout 5 -k "$url" -H "Host: ${API_DOMAIN}" || true
      return 0
    fi
    tries=$((tries - 1))
    sleep 2
  done
  warn "API health check failed — inspect logs: compose logs api nginx"
  return 1
}

print_checklist() {
  local iap_suffix=""
  local hot_suffix=""
  if [[ "$HOT_RELOAD" == "1" || "$HOT_RELOAD" == "true" || "$HOT_RELOAD" == "yes" ]]; then
    hot_suffix=" -f compose.prod-hot.yml"
  fi
  if is_iap_enabled "$(get_env_value IAP_ENABLED "$REPO_DIR/$ENV_FILE")"; then
    iap_suffix=" -f compose.iap.yml --profile iap"
  fi
  local compose_hint="cd $REPO_DIR && source .compose.prod.env && docker compose -f compose.yml -f compose.prod.yml${hot_suffix}${iap_suffix} --env-file $ENV_FILE --profile prod"
  cat <<EOF

================================================================================
Veritrail production bootstrap complete.
$(if [[ "$HOT_RELOAD" == "1" || "$HOT_RELOAD" == "true" || "$HOT_RELOAD" == "yes" ]]; then printf '\nHOT RELOAD MODE IS ENABLED: source files are bind-mounted into running app containers.\n'; fi)

Post-deploy checklist:
  1. Open https://${DOMAIN} and confirm the UI loads.
  2. OAuth callback URLs (GitHub / Google / GitLab apps):
       ${API_DOMAIN}/v1/auth/github/callback
       ${API_DOMAIN}/v1/auth/google/callback
       ${API_DOMAIN}/v1/auth/gitlab/callback
     IAP (oauth2-proxy) Google redirect when IAP_ENABLED=true:
       https://${DOMAIN}/oauth2/callback
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

  [[ -f "$REPO_DIR/compose.yml" ]] || die "REPO_DIR does not look like Veritrail root: $REPO_DIR"

  if [[ "$DEPLOY_ONLY" -eq 1 ]]; then
    log "Deploy-only mode — skipping Docker/TLS/cron bootstrap"
    ensure_env_prod
    sync_dotenv_from_prod
    render_nginx_conf
    render_iap_nginx
    deploy_compose
    health_check || true
    print_checklist
    return 0
  fi

  install_system_packages
  install_docker
  install_certbot
  ensure_env_prod
  sync_dotenv_from_prod
  obtain_certs
  render_nginx_conf
  render_iap_nginx
  install_fail2ban
  install_renewal_cron
  deploy_compose
  health_check || true
  print_checklist
}

main "$@"
