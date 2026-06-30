#!/usr/bin/env bash
set -euo pipefail

# Bootstrap Veritrail on a non-AWS VPS with HashiCorp Vault PKI + AWS IAM Roles Anywhere.
#
# This installs Vault OSS, creates a local PKI CA, issues a client certificate,
# creates IAM Roles Anywhere resources, writes an AWS credential_process profile,
# and updates the Veritrail env file with AWS_PROFILE + TRUST_PRINCIPAL_ARN.
#
# No HashiCorp Cloud/signup is required.
#
# Full setup:
#   sudo AWS_REGION=eu-west-1 ./scripts/bootstrap-hetzner-vault-rolesanywhere.sh
#
# Local Vault/cert/helper only:
#   sudo ./scripts/bootstrap-hetzner-vault-rolesanywhere.sh --skip-aws

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

AWS_REGION="${AWS_REGION:-eu-west-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-}"
AWS_PROFILE_NAME="${AWS_PROFILE_NAME:-veritrail-ra}"
ENV_FILE="${ENV_FILE:-.env}"

VAULT_ADDR="${VAULT_ADDR:-http://127.0.0.1:8200}"
VAULT_PKI_PATH="${VAULT_PKI_PATH:-pki}"
VAULT_PKI_ROLE="${VAULT_PKI_ROLE:-veritrail-hetzner}"
CA_CN="${CA_CN:-Veritrail Hetzner Roles Anywhere Root CA}"
CERT_CN="${CERT_CN:-veritrail-hetzner-control-plane}"
CERT_DOMAIN="${CERT_DOMAIN:-veritrail.internal}"
CERT_TTL="${CERT_TTL:-720h}"

RA_TRUST_ANCHOR_NAME="${RA_TRUST_ANCHOR_NAME:-veritrail-hetzner-vault-ca}"
RA_PROFILE_NAME="${RA_PROFILE_NAME:-veritrail-hetzner-profile}"
RA_ROLE_NAME="${RA_ROLE_NAME:-VeritrailHetznerControlPlaneRole}"
RA_SESSION_DURATION="${RA_SESSION_DURATION:-3600}"
ASSUMABLE_ROLE_RESOURCE="${ASSUMABLE_ROLE_RESOURCE:-*}"

STATE_DIR="${STATE_DIR:-/etc/veritrail/aws-ra}"
VAULT_INIT_FILE="${VAULT_INIT_FILE:-/root/veritrail-vault-init.json}"
VAULT_CONFIG_FILE="${VAULT_CONFIG_FILE:-/etc/vault.d/vault.hcl}"
VAULT_DATA_DIR="${VAULT_DATA_DIR:-/opt/vault/data}"
AWS_HELPER_VERSION="${AWS_HELPER_VERSION:-1.8.4}"

SKIP_AWS=0
SKIP_ENV=0
FORCE_CERT=0

log() { printf '==> %s\n' "$*" >&2; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: sudo [ENV=VALUE ...] $0 [OPTIONS]

Options:
  --skip-aws       Install/configure Vault + client cert only. Do not create AWS resources.
  --skip-env       Do not update Veritrail ENV_FILE with AWS_PROFILE/TRUST_PRINCIPAL_ARN.
  --force-cert     Re-issue the VPS client certificate even if one already exists.
  -h, --help       Show this help.

Important env vars:
  AWS_REGION                 Default: eu-west-1
  AWS_ACCOUNT_ID             Optional. Auto-detected with aws sts get-caller-identity.
  ENV_FILE                   Default: .env
  AWS_PROFILE_NAME           Default: veritrail-ra
  RA_ROLE_NAME               Default: VeritrailHetznerControlPlaneRole
  ASSUMABLE_ROLE_RESOURCE    Default: *  Tighten in production.
  CERT_TTL                   Default: 720h

The AWS creation step requires temporary bootstrap AWS credentials allowed to create IAM role/policy and IAM Roles Anywhere trust-anchor/profile resources.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skip-aws) SKIP_AWS=1; shift ;;
      --skip-env) SKIP_ENV=1; shift ;;
      --force-cert) FORCE_CERT=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown argument: $1" ;;
    esac
  done
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "Run with sudo/root"
}

install_base_packages() {
  command -v apt-get >/dev/null 2>&1 || die "Ubuntu/Debian with apt-get is required"
  export DEBIAN_FRONTEND=noninteractive
  log "Installing base packages"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg lsb-release jq unzip openssl python3
}

install_vault() {
  if command -v vault >/dev/null 2>&1; then
    log "Vault already installed: $(vault version | head -1)"
    return 0
  fi

  log "Installing Vault OSS"
  install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://apt.releases.hashicorp.com/gpg | gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
  chmod 0644 /usr/share/keyrings/hashicorp-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" \
    >/etc/apt/sources.list.d/hashicorp.list
  apt-get update -qq
  apt-get install -y -qq vault
}

install_aws_cli_v2() {
  if command -v aws >/dev/null 2>&1 && aws --version 2>&1 | grep -q 'aws-cli/2'; then
    log "AWS CLI v2 already installed: $(aws --version 2>&1)"
    return 0
  fi

  log "Installing AWS CLI v2"
  local arch url tmpdir
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) url="https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" ;;
    aarch64|arm64) url="https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" ;;
    *) die "Unsupported AWS CLI architecture: $arch" ;;
  esac
  tmpdir="$(mktemp -d)"
  curl -fsSL "$url" -o "$tmpdir/awscliv2.zip"
  unzip -q "$tmpdir/awscliv2.zip" -d "$tmpdir"
  "$tmpdir/aws/install" --update
  rm -rf "$tmpdir"
}

install_rolesanywhere_helper() {
  if command -v aws_signing_helper >/dev/null 2>&1; then
    log "aws_signing_helper already installed"
    return 0
  fi

  log "Installing IAM Roles Anywhere credential helper"
  local arch helper_arch url
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) helper_arch="X86_64" ;;
    aarch64|arm64) helper_arch="Aarch64" ;;
    *) die "Unsupported aws_signing_helper architecture: $arch" ;;
  esac
  url="https://rolesanywhere.amazonaws.com/releases/${AWS_HELPER_VERSION}/${helper_arch}/Linux/Amzn2023/aws_signing_helper"
  curl -fsSL "$url" -o /usr/local/bin/aws_signing_helper
  chmod 0755 /usr/local/bin/aws_signing_helper
}

configure_vault_service() {
  log "Configuring local-only Vault service"
  install -d -m 0750 -o vault -g vault "$VAULT_DATA_DIR"
  install -d -m 0750 -o vault -g vault /etc/vault.d

  cat >"$VAULT_CONFIG_FILE" <<EOF
ui = false
disable_mlock = true

storage "file" {
  path = "$VAULT_DATA_DIR"
}

listener "tcp" {
  address     = "127.0.0.1:8200"
  tls_disable = 1
}

api_addr = "$VAULT_ADDR"
EOF
  chown vault:vault "$VAULT_CONFIG_FILE"
  chmod 0640 "$VAULT_CONFIG_FILE"
  systemctl enable vault >/dev/null
  systemctl restart vault

  for _ in {1..30}; do
    if VAULT_ADDR="$VAULT_ADDR" vault status >/dev/null 2>&1 || VAULT_ADDR="$VAULT_ADDR" vault status 2>&1 | grep -q 'Initialized'; then
      return 0
    fi
    sleep 1
  done
  die "Vault did not start on $VAULT_ADDR"
}

vault_initialized() {
  VAULT_ADDR="$VAULT_ADDR" vault status -format=json 2>/dev/null | jq -e '.initialized == true' >/dev/null
}

vault_sealed() {
  VAULT_ADDR="$VAULT_ADDR" vault status -format=json 2>/dev/null | jq -e '.sealed == true' >/dev/null
}

init_and_unseal_vault() {
  if ! vault_initialized; then
    log "Initializing Vault"
    VAULT_ADDR="$VAULT_ADDR" vault operator init -key-shares=1 -key-threshold=1 -format=json >"$VAULT_INIT_FILE"
    chmod 0600 "$VAULT_INIT_FILE"
    warn "Vault recovery material written to $VAULT_INIT_FILE. Back it up securely."
  fi

  [[ -f "$VAULT_INIT_FILE" ]] || die "Vault initialized but $VAULT_INIT_FILE is missing. Unseal manually and export VAULT_TOKEN."
  local unseal_key root_token
  unseal_key="$(jq -r '.unseal_keys_b64[0]' "$VAULT_INIT_FILE")"
  root_token="$(jq -r '.root_token' "$VAULT_INIT_FILE")"

  if vault_sealed; then
    log "Unsealing Vault"
    VAULT_ADDR="$VAULT_ADDR" vault operator unseal "$unseal_key" >/dev/null
  fi
  export VAULT_ADDR
  export VAULT_TOKEN="$root_token"
}

configure_pki() {
  log "Configuring Vault PKI"
  if ! vault secrets list -format=json | jq -e --arg path "${VAULT_PKI_PATH}/" 'has($path)' >/dev/null; then
    vault secrets enable -path="$VAULT_PKI_PATH" pki >/dev/null
  fi
  vault secrets tune -max-lease-ttl=87600h "$VAULT_PKI_PATH" >/dev/null
  install -d -m 0700 "$STATE_DIR"

  if ! vault read -field=certificate "$VAULT_PKI_PATH/cert/ca" >/dev/null 2>&1; then
    log "Generating Vault root CA"
    vault write -field=certificate "$VAULT_PKI_PATH/root/generate/internal" \
      common_name="$CA_CN" ttl=87600h >"$STATE_DIR/ca.pem"
  else
    vault read -field=certificate "$VAULT_PKI_PATH/cert/ca" >"$STATE_DIR/ca.pem"
  fi

  vault write "$VAULT_PKI_PATH/roles/$VAULT_PKI_ROLE" \
    allowed_domains="$CERT_DOMAIN" \
    allow_subdomains=true \
    allow_bare_domains=true \
    allow_any_name=false \
    enforce_hostnames=false \
    client_flag=true \
    server_flag=false \
    key_type=rsa \
    key_bits=2048 \
    key_usage="DigitalSignature,KeyEncipherment" \
    ext_key_usage="ClientAuth" \
    max_ttl="$CERT_TTL" >/dev/null
  chmod 0644 "$STATE_DIR/ca.pem"
}

issue_client_certificate() {
  if [[ "$FORCE_CERT" -eq 0 && -s "$STATE_DIR/client.pem" && -s "$STATE_DIR/client.key" ]]; then
    log "Client certificate exists. Use --force-cert to rotate."
    return 0
  fi

  log "Issuing VPS client certificate"
  local issue_json
  issue_json="$(mktemp)"
  vault write -format=json "$VAULT_PKI_PATH/issue/$VAULT_PKI_ROLE" \
    common_name="$CERT_CN.$CERT_DOMAIN" ttl="$CERT_TTL" >"$issue_json"
  jq -r '.data.certificate' "$issue_json" >"$STATE_DIR/client.pem"
  jq -r '.data.private_key' "$issue_json" >"$STATE_DIR/client.key"
  jq -r '.data.issuing_ca' "$issue_json" >"$STATE_DIR/issuing-ca.pem"
  rm -f "$issue_json"
  chmod 0644 "$STATE_DIR/client.pem" "$STATE_DIR/issuing-ca.pem"
  chmod 0600 "$STATE_DIR/client.key"
}

ensure_aws_account_id() {
  if [[ -z "$AWS_ACCOUNT_ID" ]]; then
    AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"
  fi
  [[ -n "$AWS_ACCOUNT_ID" && "$AWS_ACCOUNT_ID" != "None" ]] || die "AWS_ACCOUNT_ID missing and aws sts get-caller-identity failed"
}

ensure_trust_anchor() {
  local existing input ca_data arn
  existing="$(aws rolesanywhere list-trust-anchors --region "$AWS_REGION" \
    --query "trustAnchors[?name=='${RA_TRUST_ANCHOR_NAME}'].trustAnchorArn | [0]" --output text 2>/dev/null || true)"
  if [[ -n "$existing" && "$existing" != "None" ]]; then
    printf '%s\n' "$existing"
    return 0
  fi

  log "Creating IAM Roles Anywhere trust anchor"
  input="$(mktemp)"
  ca_data="$(python3 - <<PY
from pathlib import Path
print(Path('$STATE_DIR/ca.pem').read_text())
PY
)"
  jq -n --arg name "$RA_TRUST_ANCHOR_NAME" --arg ca "$ca_data" \
    '{name:$name, enabled:true, source:{sourceType:"CERTIFICATE_BUNDLE", sourceData:{x509CertificateData:$ca}}}' >"$input"
  arn="$(aws rolesanywhere create-trust-anchor --region "$AWS_REGION" --cli-input-json "file://$input" \
    --query 'trustAnchor.trustAnchorArn' --output text)"
  rm -f "$input"
  printf '%s\n' "$arn"
}

ensure_iam_role() {
  local trust_anchor_arn="$1"
  local role_arn="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${RA_ROLE_NAME}"
  local trust_doc policy_doc

  trust_doc="$(mktemp)"
  jq -n --arg account "$AWS_ACCOUNT_ID" --arg source "$trust_anchor_arn" \
    '{Version:"2012-10-17",Statement:[{Effect:"Allow",Principal:{Service:"rolesanywhere.amazonaws.com"},Action:["sts:AssumeRole","sts:SetSourceIdentity","sts:TagSession"],Condition:{StringEquals:{"aws:SourceAccount":$account},ArnEquals:{"aws:SourceArn":$source}}}]}' >"$trust_doc"

  if aws iam get-role --role-name "$RA_ROLE_NAME" >/dev/null 2>&1; then
    log "Updating IAM role trust policy: $RA_ROLE_NAME"
    aws iam update-assume-role-policy --role-name "$RA_ROLE_NAME" --policy-document "file://$trust_doc" >/dev/null
  else
    log "Creating IAM role: $RA_ROLE_NAME"
    aws iam create-role --role-name "$RA_ROLE_NAME" --assume-role-policy-document "file://$trust_doc" >/dev/null
  fi
  rm -f "$trust_doc"

  policy_doc="$(mktemp)"
  jq -n --arg resource "$ASSUMABLE_ROLE_RESOURCE" \
    '{Version:"2012-10-17",Statement:[{Sid:"AllowVeritrailToAssumeCustomerScannerRoles",Effect:"Allow",Action:["sts:AssumeRole"],Resource:$resource}]}' >"$policy_doc"
  aws iam put-role-policy --role-name "$RA_ROLE_NAME" --policy-name VeritrailAssumeCustomerRoles --policy-document "file://$policy_doc" >/dev/null
  rm -f "$policy_doc"

  printf '%s\n' "$role_arn"
}

ensure_rolesanywhere_profile() {
  local role_arn="$1"
  local existing arn
  existing="$(aws rolesanywhere list-profiles --region "$AWS_REGION" \
    --query "profiles[?name=='${RA_PROFILE_NAME}'].profileArn | [0]" --output text 2>/dev/null || true)"
  if [[ -n "$existing" && "$existing" != "None" ]]; then
    printf '%s\n' "$existing"
    return 0
  fi

  log "Creating IAM Roles Anywhere profile"
  arn="$(aws rolesanywhere create-profile --region "$AWS_REGION" --name "$RA_PROFILE_NAME" \
    --role-arns "$role_arn" --duration-seconds "$RA_SESSION_DURATION" --enabled \
    --query 'profile.profileArn' --output text)"
  printf '%s\n' "$arn"
}

write_aws_profile() {
  local trust_anchor_arn="$1" profile_arn="$2" role_arn="$3"
  local target_user target_home aws_dir config_file
  target_user="${SUDO_USER:-root}"
  if [[ "$target_user" == "root" ]]; then
    target_home="/root"
  else
    target_home="$(getent passwd "$target_user" | cut -d: -f6)"
  fi

  aws_dir="$target_home/.aws"
  config_file="$aws_dir/config"
  install -d -m 0700 -o "$target_user" -g "$target_user" "$aws_dir"
  touch "$config_file"
  chown "$target_user:$target_user" "$config_file"
  chmod 0600 "$config_file"

  log "Writing AWS profile [$AWS_PROFILE_NAME]"
  python3 - "$config_file" "$AWS_PROFILE_NAME" "$AWS_REGION" "$trust_anchor_arn" "$profile_arn" "$role_arn" "$STATE_DIR" <<'PY'
import configparser
import sys

config_file, profile, region, trust_anchor, ra_profile, role_arn, state_dir = sys.argv[1:]
section = f"profile {profile}" if profile != "default" else "default"
cp = configparser.RawConfigParser()
cp.read(config_file)
if not cp.has_section(section):
    cp.add_section(section)
credential_process = (
    f"/usr/local/bin/aws_signing_helper credential-process "
    f"--certificate {state_dir}/client.pem "
    f"--private-key {state_dir}/client.key "
    f"--trust-anchor-arn {trust_anchor} "
    f"--profile-arn {ra_profile} "
    f"--role-arn {role_arn} "
    f"--region {region} "
    f"--session-duration 3600"
)
cp.set(section, "region", region)
cp.set(section, "credential_process", credential_process)
with open(config_file, "w") as f:
    cp.write(f)
PY
}

set_env_value() {
  local key="$1" value="$2" file="$3"
  local escaped="${value//\\/\\\\}"
  escaped="${escaped//|/\\|}"
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

update_veritrail_env() {
  [[ "$SKIP_ENV" -eq 0 ]] || return 0
  local role_arn="$1" env_path="$REPO_DIR/$ENV_FILE"
  if [[ ! -f "$env_path" ]]; then
    [[ -f "$REPO_DIR/.env.example" ]] || { warn "No $ENV_FILE or .env.example found. Skipping env update."; return 0; }
    cp "$REPO_DIR/.env.example" "$env_path"
  fi
  log "Updating $ENV_FILE with AWS_PROFILE and TRUST_PRINCIPAL_ARN"
  set_env_value "AWS_PROFILE" "$AWS_PROFILE_NAME" "$env_path"
  set_env_value "TRUST_PRINCIPAL_ARN" "$role_arn" "$env_path"
  chmod 0600 "$env_path" 2>/dev/null || true
}

test_profile() {
  local target_user="${SUDO_USER:-root}"
  log "Testing AWS_PROFILE=$AWS_PROFILE_NAME"
  if [[ "$target_user" == "root" ]]; then
    AWS_PROFILE="$AWS_PROFILE_NAME" aws sts get-caller-identity || warn "Profile test failed"
  else
    sudo -u "$target_user" AWS_PROFILE="$AWS_PROFILE_NAME" aws sts get-caller-identity || warn "Profile test failed"
  fi
}

print_done() {
  cat <<EOF

================================================================================
Hetzner/Vault/IAM Roles Anywhere bootstrap complete.

Files:
  CA certificate:       $STATE_DIR/ca.pem
  VPS certificate:      $STATE_DIR/client.pem
  VPS private key:      $STATE_DIR/client.key
  Vault init material:  $VAULT_INIT_FILE

AWS profile:
  AWS_PROFILE=$AWS_PROFILE_NAME

Veritrail env:
  ENV_FILE=$ENV_FILE

Hardening:
  1. Replace ASSUMABLE_ROLE_RESOURCE='*' with the exact customer scanner role pattern.
  2. Back up $VAULT_INIT_FILE securely.
  3. Rotate the client cert periodically with --force-cert.
================================================================================
EOF
}

main() {
  parse_args "$@"
  require_root
  [[ -f "$REPO_DIR/compose.yml" ]] || warn "REPO_DIR does not look like Veritrail root: $REPO_DIR"

  install_base_packages
  install_vault
  install_aws_cli_v2
  install_rolesanywhere_helper
  configure_vault_service
  init_and_unseal_vault
  configure_pki
  issue_client_certificate

  if [[ "$SKIP_AWS" -eq 1 ]]; then
    warn "Skipping AWS resource creation"
    print_done
    return 0
  fi

  ensure_aws_account_id
  log "Using AWS account $AWS_ACCOUNT_ID in $AWS_REGION"

  local trust_anchor_arn role_arn profile_arn
  trust_anchor_arn="$(ensure_trust_anchor)"
  role_arn="$(ensure_iam_role "$trust_anchor_arn")"
  profile_arn="$(ensure_rolesanywhere_profile "$role_arn")"

  write_aws_profile "$trust_anchor_arn" "$profile_arn" "$role_arn"
  update_veritrail_env "$role_arn"
  test_profile
  print_done
}

main "$@"
