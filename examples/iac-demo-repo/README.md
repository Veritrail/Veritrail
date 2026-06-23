# Veritrail IaC Demo Repo

Small intentionally-bad IaC repository for testing Veritrail remediation flows.

## Layout

- `terraform/s3-public/` — Terraform bucket matching `s3.bucket.public_access_not_blocked`.
- `terraform/cloudtrail-missing/` — Terraform account baseline with no trail; used to preview the CloudTrail remediation snippet.
- `terraform/ecr-no-scan/` — Terraform ECR repository with image scan on push disabled.
- `terragrunt/live/prod/s3/` — Terragrunt-style live directory pointing at `terragrunt/modules/s3-public`.

## Current Limitations

Veritrail's repo-aware PR path currently scans `.tf` files. Terragrunt support should be treated as partial until we add plan JSON support or resolve `terragrunt.hcl` sources into rendered Terraform.
