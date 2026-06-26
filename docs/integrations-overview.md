# Integrations overview

Veritrail connects to cloud providers, identity directories, code hosts, vulnerability scanners, and ticketing tools. Each integration collects evidence for SOC 2 composites or exports summary data into audit packs.

## Cloud posture

| Integration | Connect path | Evidence |
|---|---|---|
| **AWS** | Accounts → CloudFormation connector | IAM, S3, KMS, CloudTrail, Config, GuardDuty, remediation automation |
| **Google Cloud** | Integrations → Google Cloud | Audit logging, compute public IP checks |
| **Microsoft Azure** | Integrations → Microsoft Azure | Defender for Cloud, storage public blob access |

**Unified APIs:** `GET /v1/integrations/cloud-accounts` and `GET /v1/integrations/cloud-coverage` normalize AWS/GCP/Azure account rows and posture summary. **Scan all cloud** on the Integrations page queues scans across connected providers.

**Google Cloud auth:** Service account impersonation is recommended — connect via Integrations → Google Cloud, run the wizard **gcloud** commands, paste your scanner SA email, and verify. WIF is the alternative when impersonation is not feasible. Operator-side platform SA: `VERITRAIL_GCP_PLATFORM_SA_JSON` / `PATH` / `EMAIL`. See [multi-cloud-collectors.md](./multi-cloud-collectors.md).

## Identity & directory

| Integration | Purpose |
|---|---|
| **Google Workspace** | MFA enforcement, inactive users, admin review (CC6) |
| **Microsoft Entra ID** | MFA posture, stale users, privileged roles (CC6) |

## Source control & SDLC

| Integration | Purpose |
|---|---|
| **GitHub** | Branch protection, reviews, code scanning, Dependabot, secret scanning |
| **GitLab** | Protected branches, MR approvals, SAST/dependency/container scanning |

Findings use `account_provider` (`github` / `gitlab`) with org/repo scope labels. Audit packs include `sdlc_evidence.json`.

## Vulnerability scanners

| Integration | Purpose |
|---|---|
| **Wiz** | Open-finding count sync for external vuln evidence |
| **Tenable** | Same summary sync pattern |
| **Qualys** | Same summary sync pattern |

Scanner summaries appear in Integrations when connected and export as `scanner_integrations.json` in evidence packs. Full vuln databases are out of scope for phase one.

## Ticketing & notifications

| Integration | Purpose |
|---|---|
| **Jira** | Create remediation issues from findings; populates `remediation_ticket_key` / `remediation_ticket_url` |
| **Linear** | Same remediation ticket linkage |
| **Slack** | Scan alerts and weekly digest webhooks |

## Related docs

- [multi-cloud-collectors.md](./multi-cloud-collectors.md) — GCP/Azure collectors, normalization APIs, composite mapping
- [external-evidence.md](./external-evidence.md) — uploaded proof, coverage dashboard, evidence lifecycle
