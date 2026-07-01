#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-eu-west-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-}"
RA_ROLE_NAME="${RA_ROLE_NAME:-VeritrailControlPlaneRole}"
POLICY_NAME="${POLICY_NAME:-VeritrailAssumeCustomerRoles}"
ASSUMABLE_ROLE_RESOURCE="${ASSUMABLE_ROLE_RESOURCE:-arn:aws:iam::*:role/VeritrailScannerRole}"

log() { printf '==> %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

if [[ -z "$AWS_ACCOUNT_ID" ]]; then
  AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"
fi
[[ -n "$AWS_ACCOUNT_ID" && "$AWS_ACCOUNT_ID" != "None" ]] || die "AWS_ACCOUNT_ID missing and aws sts get-caller-identity failed"

policy_doc="$(mktemp)"
trap 'rm -f "$policy_doc"' EXIT

jq -n --arg resource "$ASSUMABLE_ROLE_RESOURCE" \
  '{
    Version:"2012-10-17",
    Statement:[
      {
        Sid:"AllowVeritrailToAssumeCustomerScannerRoles",
        Effect:"Allow",
        Action:[
          "sts:AssumeRole",
          "sts:SetSourceIdentity",
          "sts:TagSession"
        ],
        Resource:$resource
      }
    ]
  }' >"$policy_doc"

log "Updating inline policy $POLICY_NAME on $RA_ROLE_NAME"
log "Resource: $ASSUMABLE_ROLE_RESOURCE"

aws iam put-role-policy \
  --role-name "$RA_ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document "file://$policy_doc"

log "Done. Control plane role can now assume matching customer scanner roles with source identity and session tags."
