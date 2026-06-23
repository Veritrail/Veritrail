#!/usr/bin/env bash
# Seed a throwaway AWS account with common misconfigurations for Veritrail QA.
# Requires: AWS CLI, a sandbox account, and Veritrail running locally (docker compose up).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_URL="${API_URL:-http://localhost:8000}"

cat <<'EOF'
Veritrail sandbox QA — minimal seed checklist
=========================================

1. Use a dedicated throwaway AWS account (not prod).
2. Deploy the read-only CFN role from Veritrail Accounts → Connect AWS.
3. Verify role + trigger first scan in the UI (or POST /v1/accounts/{id}/scan).
4. Optional misconfigurations to exercise findings (pick any subset):

   # S3 bucket without default encryption
   aws s3api create-bucket --bucket "veritrail-qa-$(aws sts get-caller-identity --query Account --output text)-unencrypted" \
     --region us-east-1 2>/dev/null || true

   # Security group with SSH open to 0.0.0.0/0 (use default VPC)
   VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
   aws ec2 authorize-security-group-ingress --group-name default --protocol tcp --port 22 --cidr 0.0.0.0/0 2>/dev/null || true

   # IAM user without MFA (console login profile)
   aws iam create-user --user-name veritrail-qa-no-mfa 2>/dev/null || true
   aws iam create-login-profile --user-name veritrail-qa-no-mfa --password 'TempPass123!Change' --no-password-reset-required 2>/dev/null || true

5. Re-scan from Findings → Scan and confirm findings appear.
6. Tear down: delete seeded resources and remove the account in Veritrail when done.

API health check (optional):
EOF

if command -v curl >/dev/null 2>&1; then
  if curl -sf "${API_URL}/health" >/dev/null 2>&1; then
    echo "  ✓ API reachable at ${API_URL}"
  else
    echo "  ✗ API not reachable at ${API_URL} — run: docker compose up"
  fi
fi

echo ""
echo "See also: README.md onboarding flow and HANDOFF.md for full E2E scope."
