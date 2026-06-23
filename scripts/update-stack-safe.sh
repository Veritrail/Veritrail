#!/usr/bin/env bash
# update-stack-safe.sh — Safely update a CloudFormation stack via change sets.
#
# Creates a change set, prints the planned resource actions, and asks for
# confirmation before executing. If the change set creation fails (e.g.
# template validation error), the actual error reason is printed instead
# of the opaque UPDATE_ROLLBACK_COMPLETE that direct update-stack gives.
#
# Usage:
#   ./scripts/update-stack-safe.sh <stack-name> <template-file> [parameters…]
#
#   Parameters are passed through as --parameters ParameterKey=X,ParameterValue=Y
#
# Examples:
#   ./scripts/update-stack-safe.sh veritrail-remediation infra/cfn/veritrail-remediation-ssm.yaml
#
#   ./scripts/update-stack-safe.sh veritrail-remediation infra/cfn/veritrail-remediation-ssm.yaml \
#     EnableSecurityGroupRemediation=Yes \
#     EnableS3Remediation=No

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

REGION="${AWS_REGION:-us-east-1}"
export AWS_REGION="${REGION}"

# ── Parse positional args ────────────────────────────────────────────────
if [ $# -lt 2 ]; then
  echo "Usage: $(basename "$0") <stack-name> <template-file> [ParameterKey=Value …]" >&2
  echo "" >&2
  echo "Examples:" >&2
  echo "  $(basename "$0") veritrail-remediation infra/cfn/veritrail-remediation-ssm.yaml" >&2
  echo "  $(basename "$0") veritrail-remediation infra/cfn/veritrail-remediation-ssm.yaml \\" >&2
  echo "    EnableSecurityGroupRemediation=Yes EnableS3Remediation=No" >&2
  exit 1
fi

STACK_NAME="$1"
TEMPLATE_FILE="$2"
shift 2

# Build --parameters array from remaining args
PARAMS_ARGS=()
for param in "$@"; do
  key="${param%%=*}"
  val="${param#*=}"
  PARAMS_ARGS+=("ParameterKey=${key},ParameterValue=${val}")
done

# Resolve template path (relative to repo root)
if [[ "$TEMPLATE_FILE" != /* ]]; then
  TEMPLATE_FILE="${REPO_DIR}/${TEMPLATE_FILE}"
fi

if [ ! -f "$TEMPLATE_FILE" ]; then
  echo "❌ Template not found: ${TEMPLATE_FILE}" >&2
  exit 1
fi

# ── Step 1: Check if stack exists and get current status ─────────────────
echo "→ Checking stack: ${STACK_NAME} …"
STACK_STATUS=""
set +e
STACK_STATUS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].StackStatus" \
  --output text 2>/dev/null)
STACK_EXISTS=$?
set -e

if [ $STACK_EXISTS -ne 0 ]; then
  echo "❌ Stack '${STACK_NAME}' not found." >&2
  echo "   Use aws cloudformation create-stack to create a new stack." >&2
  exit 1
fi

echo "   Current status: ${STACK_STATUS}"

case "$STACK_STATUS" in
  *_IN_PROGRESS)
    echo "❌ Stack is in progress (${STACK_STATUS}). Wait for completion." >&2
    exit 1
    ;;
  ROLLBACK_COMPLETE|ROLLBACK_FAILED)
    echo "⚠  Stack is in ${STACK_STATUS}. Consider deleting and recreating." >&2
    ;;
esac

# ── Step 2: Create a change set ─────────────────────────────────────────
CHANGE_SET_NAME="${STACK_NAME}-cs-$(date +%s)"

echo ""
echo "→ Creating change set: ${CHANGE_SET_NAME} …"

CREATE_CMD=(
  aws cloudformation create-change-set
  --stack-name "$STACK_NAME"
  --change-set-name "$CHANGE_SET_NAME"
  --change-set-type UPDATE
  --template-body "file://${TEMPLATE_FILE}"
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM
  --output json
)

if [ ${#PARAMS_ARGS[@]} -gt 0 ]; then
  CREATE_CMD+=(--parameters "${PARAMS_ARGS[@]}")
fi

CHANGE_SET_RESULT=$("${CREATE_CMD[@]}" 2>&1) || {
  echo ""
  echo "❌ Failed to create change set:"
  echo "${CHANGE_SET_RESULT}" | sed 's/^/   /'
  echo ""
  echo "   Check the template syntax and parameter values above."
  exit 1
}

CHANGE_SET_ID=$(echo "$CHANGE_SET_RESULT" | jq -r '.Id')
echo "   Change set ID: ${CHANGE_SET_ID}"

# ── Step 3: Wait for change set to be created ───────────────────────────
echo "   Waiting for change set to be ready …"

WAIT_SECONDS=30
POLL_INTERVAL=3
ELAPSED=0

while [ $ELAPSED -lt $WAIT_SECONDS ]; do
  sleep $POLL_INTERVAL
  ELAPSED=$((ELAPSED + POLL_INTERVAL))

  set +e
  CS_STATUS=$(aws cloudformation describe-change-set \
    --change-set-name "$CHANGE_SET_ID" \
    --query "Status" \
    --output text 2>/dev/null)
  CS_REASON=$(aws cloudformation describe-change-set \
    --change-set-name "$CHANGE_SET_ID" \
    --query "StatusReason" \
    --output text 2>/dev/null)
  set -e

  case "$CS_STATUS" in
    CREATE_COMPLETE)
      break
      ;;
    FAILED)
      echo ""
      echo "❌ Change set creation FAILED."
      echo "   Reason: ${CS_REASON}"
      echo ""
      if [ -n "$CS_REASON" ]; then
        echo "   ══ Common causes ══"
        if echo "$CS_REASON" | grep -qi "template"; then
          echo "   → Template validation error — check YAML syntax"
        fi
        if echo "$CS_REASON" | grep -qi "parameter"; then
          echo "   → Missing or invalid parameter value"
        fi
        if echo "$CS_REASON" | grep -qi "permission"; then
          echo "   → IAM permissions insufficient"
        fi
      fi
      aws cloudformation delete-change-set --change-set-name "$CHANGE_SET_ID" 2>/dev/null || true
      exit 1
      ;;
  esac
done

# ── Step 4: Describe the changes ─────────────────────────────────────────
echo ""
echo "→ Planned changes:"
echo ""

CHANGES=$(aws cloudformation describe-change-set \
  --change-set-name "$CHANGE_SET_ID" \
  --query "Changes[*].[ResourceChange.Action, ResourceChange.LogicalResourceId, ResourceChange.ResourceType, ResourceChange.Replacement]" \
  --output table 2>/dev/null || echo "(no changes or failed to describe)")

echo "$CHANGES"

# Check if there are no changes
CHANGE_COUNT=$(aws cloudformation describe-change-set \
  --change-set-name "$CHANGE_SET_ID" \
  --query "length(Changes)" \
  --output text 2>/dev/null || echo "0")

if [ "$CHANGE_COUNT" = "0" ]; then
  echo ""
  echo "⚪ No changes detected. Nothing to execute."
  aws cloudformation delete-change-set --change-set-name "$CHANGE_SET_ID" 2>/dev/null || true
  exit 0
fi

# ── Step 5: Confirmation ─────────────────────────────────────────────────
echo ""
read -r -p "Execute this change set? (y/n) " CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "✗ Aborted. Deleting change set …"
  aws cloudformation delete-change-set --change-set-name "$CHANGE_SET_ID" 2>/dev/null || true
  echo "  Change set deleted."
  exit 0
fi

# ── Step 6: Execute ──────────────────────────────────────────────────────
echo ""
echo "→ Executing change set …"

aws cloudformation execute-change-set --change-set-name "$CHANGE_SET_ID"

echo "   Change set executed."
echo ""
echo "→ Monitoring stack update …"
echo "   (Ctrl-C to stop watching — update will continue in background)"

aws cloudformation wait stack-update-complete --stack-name "$STACK_NAME" 2>&1 || {
  echo ""
  echo "❌ Stack update did not complete successfully."
  echo "   Check AWS Console → CloudFormation → ${STACK_NAME} → Events"
  exit 1
}

echo ""
echo "✅ Stack update complete: ${STACK_NAME}"
