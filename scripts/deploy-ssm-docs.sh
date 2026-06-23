#!/usr/bin/env bash
# deploy-ssm-docs.sh — Debug-only direct SSM document deployment.
#
# Customer installs must deploy SSM documents through CloudFormation via
# infra/cfn/veritrail-remediation-ssm.yaml. This script is kept only for manual
# comparison/debugging during development.
#
# Usage:
#   Uses upload-cfn.credentials.sh (same as upload-cfn.sh)
#   ./scripts/deploy-ssm-docs.sh

set -euo pipefail

if [ "${VERITRAIL_ALLOW_DIRECT_SSM_DOC_DEPLOY:-}" != "1" ]; then
  cat >&2 <<'EOF'
ERROR: Direct SSM document deployment is disabled.

Veritrail's supported customer path is CloudFormation:
  1. ./scripts/upload-cfn.sh
  2. Update/recreate the VeritrailAccountConnector stack with remediation modules enabled.

For development-only debugging, set VERITRAIL_ALLOW_DIRECT_SSM_DOC_DEPLOY=1.
EOF
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/aws-session.sh"
SCRIPTS_SRC="${REPO_DIR}/infra/cfn/ssm-scripts"

REGION="${AWS_REGION:-us-east-1}"
BUCKET="${VERITRAIL_CFN_BUCKET:-amzn-s3-veritrail}"
RELEASE="${RELEASE:-2026.06}"
SSM_KEY="infra/${RELEASE}/ssm-scripts"
S3_PREFIX="s3://${BUCKET}/${SSM_KEY}"
S3_URL_BASE="https://${BUCKET}.s3.${REGION}.amazonaws.com/${SSM_KEY}"

export AWS_REGION="${AWS_REGION:-${REGION}}"

require_aws_session

# ── Role ARN (used by assumeRole in each document) ────────────────────────
ROLE_NAME="${VERITRAIL_ROLE_NAME:-VeritrailRemediationAutomationRole}"
ROLE_ARN="arn:aws:iam::$(aws_cli sts get-caller-identity --query Account --output text):role/${ROLE_NAME}"

# ── Step 1: Upload Python handlers to S3 (incremental) ─────────────────────
SSM_S3_PREFIX="${S3_PREFIX#s3://${BUCKET}/}"
echo "→ Syncing SSM handler scripts (incremental) to s3://${BUCKET}/${SSM_S3_PREFIX}/ …"
echo ""

if [ ! -d "${SCRIPTS_SRC}" ]; then
  echo "ERROR: SSM scripts directory not found: ${SCRIPTS_SRC}" >&2
  exit 1
fi

aws_cli s3 sync "${SCRIPTS_SRC}" "s3://${BUCKET}/${SSM_S3_PREFIX}/" \
  --region "${REGION}" \
  --acl public-read \
  --content-type "text/plain" \
  --exclude "*" \
  --include "*.py"

echo ""
echo "→ Deploying SSM Automation documents …"
echo ""

# ── Helper: deploy a single SSM document ─────────────────────────────────
deploy_doc() {
  local name="$1"
  local description="$2"
  local handler_script="$3"
  local extra_params="$4"   # JSON string of extra parameters (or "{}")

  local s3_url="${S3_URL_BASE}/${handler_script}"

  # Build the document content as JSON (SSM uses JSON for document content)
  local content
  content=$(jq -n \
    --arg desc "$description" \
    --arg roleArn "$ROLE_ARN" \
    --argjson extraParams "$extra_params" \
    '{
      schemaVersion: "0.3",
      description: $desc,
      assumeRole: $roleArn,
      parameters: (
        if ($extraParams | length > 0) then
          { PlanJson: { type: "String", description: "Signed Veritrail remediation plan JSON (veritrail_remediation_plan/v2)" } } * $extraParams
        else
          { PlanJson: { type: "String", description: "Signed Veritrail remediation plan JSON (veritrail_remediation_plan/v2)" } }
        end
      ),
      mainSteps: []
    }')

  # Check if document already exists
  local existing
  existing=$(aws_cli ssm describe-document --name "$name" --query "Document.Name" --output text 2>/dev/null || echo "")

  if [ "$existing" = "$name" ]; then
    # Document exists — compare content
    local current_version
    current_version=$(aws_cli ssm describe-document --name "$name" --query "Document.DocumentVersion" --output text)

    # Update the document with attachments
    echo "  Updating ${name} (v${current_version}) …"
    local result
    result=$(aws_cli ssm update-document \
      --name "$name" \
      --content "$content" \
      --document-version "\$LATEST" \
      --attachments "Key=${handler_script},Values=[${s3_url}]" \
      --document-format JSON \
      2>&1) || true

    if echo "$result" | grep -qi "error"; then
      echo "    ❌ Update failed: ${result}"
      return 1
    fi

    local new_version
    new_version=$(aws_cli ssm describe-document --name "$name" --query "Document.DocumentVersion" --output text)
    if [ "$new_version" != "$current_version" ]; then
      echo "    ✅ Updated (v${current_version} → v${new_version})"
    else
      echo "    ⚪ Unchanged (v${current_version})"
    fi
  else
    # Document doesn't exist — create it
    echo "  Creating ${name} …"
    local result
    result=$(aws_cli ssm create-document \
      --name "$name" \
      --content "$content" \
      --document-type "Automation" \
      --document-format JSON \
      --attachments "Key=${handler_script},Values=[${s3_url}]" \
      2>&1) || true

    if echo "$result" | grep -qi "error"; then
      echo "    ❌ Create failed: ${result}"
      return 1
    fi
    echo "    ✅ Created (v1)"
  fi
}

# ── Document definitions ─────────────────────────────────────────────────

echo "── SSM Automation Documents ──"
echo ""

# 1. Veritrail-RevokeSecurityGroupIngressExact
deploy_doc \
  "Veritrail-RevokeSecurityGroupIngressExact" \
  "Veritrail: Remove only the public security-group ingress rules authorized in a signed remediation plan. Revokes specific 0.0.0.0/0 or ::/0 ingress rules that match the approved plan." \
  "revoke_sg_ingress.py" \
  '{}'

echo ""

# 2. Veritrail-DeactivateIamAccessKey
deploy_doc \
  "Veritrail-DeactivateIamAccessKey" \
  "Veritrail: Deactivate only the IAM access key approved in a signed remediation plan. Validates plan integrity and expiry before setting the key status to Inactive." \
  "deactivate_access_key.py" \
  '{}'

echo ""

# 3. Veritrail-MigrateSsmParameterToSecureString
deploy_doc \
  "Veritrail-MigrateSsmParameterToSecureString" \
  "Veritrail: Rewrite a reviewed plaintext SSM String parameter as SecureString. Verifies plan integrity and expiry, reads current value, and performs the migration only when the parameter is still a plaintext String." \
  "migrate_to_secure_string.py" \
  '{}'

echo ""

# 4. Veritrail-ConfigureS3BucketPublicAccessBlock
deploy_doc \
  "Veritrail-ConfigureS3BucketPublicAccessBlock" \
  "Veritrail: Enable all four Block Public Access settings on a specific S3 bucket approved in a signed remediation plan. Verifies plan integrity, extracts the bucket name, and applies the full PublicAccessBlockConfiguration." \
  "configure_s3_pab.py" \
  '{}'

echo ""

# 5. Veritrail-RemediateIamExcessPermissions
deploy_doc \
  "Veritrail-RemediateIamExcessPermissions" \
  "Veritrail: Detach full-admin managed policies or replace wildcard inline policies per a signed remediation plan. Supports two actions — detach_full_admin and replace_wildcard_inline — both scoped to the specific role and policies in the plan." \
  "remediate_excess_permissions.py" \
  '{}'

echo ""
echo "── Done ──"
echo ""
echo "Document URLs:"
echo "  https://${REGION}.console.aws.amazon.com/systems-manager/documents"
