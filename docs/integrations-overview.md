# Integrations overview

Veritrail connects to cloud providers, identity directories, code hosts, vulnerability scanners, SIEM tools, and ticketing systems. Each integration collects evidence for SOC 2 composites or exports summary data into audit packs.

## Cloud posture

| Integration | Connect path | Evidence |
|---|---|---|
| **AWS** | Accounts → CloudFormation connector | IAM, S3, KMS, CloudTrail, Config, GuardDuty, remediation automation |
| **Google Cloud** | Integrations → Google Cloud | Audit logging, compute public IP checks |
| **Microsoft Azure** | Integrations → Microsoft Azure | Defender for Cloud, storage public blob access |

**Unified APIs:** `GET /v1/integrations/cloud-accounts` and `GET /v1/integrations/cloud-coverage` normalize AWS/GCP/Azure account rows and posture summary. **Scan all cloud** on the Integrations page queues scans across connected providers.

**Google Cloud auth:** Service account impersonation is recommended — connect via Integrations → Google Cloud, run the wizard **gcloud** commands, paste your scanner SA email, and verify. WIF is the alternative when impersonation is not feasible. Operator-side platform SA: `VERITRAIL_GCP_PLATFORM_SA_JSON` / `PATH` / `EMAIL`. See [multi-cloud-collectors.md](./multi-cloud-collectors.md).

## Identity & directory

| Integration | Purpose | Credentials |
|---|---|---|
| **Google Workspace** | MFA enforcement, inactive users, admin review (CC6) | OAuth (Admin SDK read-only) |
| **Microsoft Entra ID** | MFA posture, stale users, privileged roles (CC6) | OAuth (Microsoft Graph) |
| **Okta** | Directory sync, MFA policy posture, admin access-review findings | Org URL + SSWS API token (`OKTA_ORG_URL` / token in provider config) |

Okta sync: `PUT /v1/integrations/okta`, `POST /v1/integrations/okta/sync`. Identity checks: `okta.org.mfa_not_enforced`, `okta.user.inactive_90d`, `okta.admin.unreviewed`. Included in `access_review_summary.json`.

## Source control & SDLC

| Integration | Purpose |
|---|---|
| **GitHub** | Branch protection, reviews, code scanning, Dependabot, secret scanning |
| **GitLab** | Protected branches, MR approvals, SAST/dependency/container scanning |

Findings use `account_provider` (`github` / `gitlab`) with org/repo scope labels. Audit packs include `sdlc_evidence.json`.

## Vulnerability scanners

| Integration | Purpose | Credentials |
|---|---|---|
| **Wiz** | Open-finding import + summary sync | API URL, OAuth client ID/secret |
| **Tenable** | Same | API access/secret keys |
| **Qualys** | Same | Platform URL, username/password |
| **Snyk** | Same (Snyk-shaped adapter) | Org ID, API token |
| **Orca Security** | Same (Snyk-shaped adapter) | API token |
| **Aikido** | Same (Snyk-shaped adapter) | API token |

Connected scanners sync via `POST /v1/integrations/scanners/{vendor}/sync`. Each pull upserts open findings (`scanner.{vendor}.open_finding`) with dedup on vendor finding ID and auto-resolves stale rows. Summaries export as `scanner_integrations.json` in evidence packs.

Implementation: `scanner_sync.py` (import), `scanner_integrations.py` (verify), `snyk_shaped_scanner.py` (Snyk/Orca/Aikido fetch).

## SIEM & monitoring

| Integration | Purpose | Credentials |
|---|---|---|
| **Splunk** | 24h event signal count for logging evidence | Base URL, API token, index name |
| **Datadog** | Triggered security monitor count | API key + application key, site (`datadoghq.com`, etc.) |
| **Elastic / Sentinel** | Security alerts index count (24h) | Cluster URL, API key |

SIEM sync: `PUT /v1/integrations/siem/{vendor}`, `POST /v1/integrations/siem/{vendor}/sync`. Exports as `siem_integrations.json` in audit packs.

## Ticketing & notifications

| Integration | Purpose |
|---|---|
| **Jira** | Create remediation issues from findings |
| **Linear** | Same remediation ticket linkage |
| **GitHub Issues** | `POST /v1/integrations/github-issues/from-finding/{id}` — reuses GitHub OAuth token when no dedicated token configured |
| **Azure Boards** | `POST /v1/integrations/azure-boards/from-finding/{id}` — Azure DevOps PAT + project |
| **Slack** | Scan alerts and weekly digest webhooks |

All ticketing integrations populate `remediation_ticket_key` / `remediation_ticket_url` on findings.

## Related docs

- [multi-cloud-collectors.md](./multi-cloud-collectors.md) — GCP/Azure collectors, normalization APIs, composite mapping
- [external-evidence.md](./external-evidence.md) — uploaded proof, coverage dashboard, evidence lifecycle
