# Write remediation — retired

Veritrail is **scanning-only**. Automated write remediation (SSM Automation, Terraform fix PRs,
IaC repository connectors, GitHub Issues remediation tickets) has been **retired**.

## What customers use instead

- **Console / CLI guidance** in the finding drawer (`CliRemediationPanel`, remediation summaries)
- **Verify fix** — single-check recheck after the customer applies a change themselves
- **Suggested policy** (read-only IAM Access Analyzer output) — not applied by Veritrail
- **Jira / Linear / Azure Boards** ticketing for tracking human remediations

## What was removed

- API routes under `…/remediation/*`, terraform-PR / repo-scan, IaC repository + legacy GitHub
  Issues integrations, account remediation-runner status, public SSM execution webhook
- Services: remediation dispatch/plan/SSM catalog, terraform PR helpers, hclpatch
- Infra: `veritrail-remediation-ssm.yaml`, nested RemediationStack, SSM handler scripts

## DB / ops notes

- `aws_accounts.enable_remediation_*` / `remediation_*_deployed` columns and the
  `remediation_executions` table remain in the schema (**accept-and-ignore**) until a planned
  template/schema bump.
- Customers who previously deployed the remediation nested stack can leave or delete that stack
  in AWS; Veritrail no longer orchestrates it.
- See `docs/deep-research-roadmap.md` §2.3.
