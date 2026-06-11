# Vigil AWS sandbox QA

Use a **dedicated throwaway AWS account** to exercise the full Vigil flow before production.

## Quick start

1. Copy `.env.example` → `.env` and set `TRUST_PRINCIPAL_ARN` to your SSO/admin role.
2. `docker compose up -d db redis && docker compose run --rm api alembic upgrade head && docker compose up`
3. Sign up at http://localhost:5173 and connect the sandbox account via CloudFormation.
4. Run `./scripts/seed-sandbox-findings.sh` for optional misconfiguration ideas.
5. Scan → review Findings → download evidence pack from Compliance.

## What to verify

- Cursor pagination loads all findings (accounts with 500+ findings).
- Activity detections (`cloudtrail.event.*`) appear under **Activity detections** and do not fail ISO/SOC controls.
- ISO **A.12.3.1** reflects AWS Backup plan coverage (`backup.plan.missing`).
- CIS **1.17** flags EC2 instances without an instance profile.

## Cleanup

Delete seeded IAM users, buckets, and security group rules; disconnect the account in Vigil when finished.
