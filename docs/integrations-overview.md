# Integrations overview

Veritrail connects to cloud providers, identity directories, code hosts, vulnerability scanners, SIEM tools, and ticketing systems. Each integration collects evidence for SOC 2 composites or exports summary data into audit packs.

**Target integration semantics:** see
[`technical-evidence-coverage-spec.md`](./technical-evidence-coverage-spec.md). Integrations
are interchangeable only where they provide equivalent evidence for the same asset class;
the absence of a named third-party vendor is not itself a compliance failure.

## Cloud posture

| Integration | Connect path | Evidence |
|---|---|---|
| **AWS** | Accounts → CloudFormation connector | IAM, S3, KMS, CloudTrail, Config, GuardDuty, Inspector (EC2/ECR/Lambda lanes), remediation automation |
| **Google Cloud** | Integrations → Google Cloud | Audit logging, compute public IP, OS Config vuln reports, SCC findings (capability lanes) |
| **Microsoft Azure** | Integrations → Microsoft Azure | Defender for Cloud plans/assessments, storage public blob access |

**Unified APIs:** `GET /v1/integrations/cloud-accounts` and `GET /v1/integrations/cloud-coverage` normalize AWS/GCP/Azure account rows and posture summary. **Scan all cloud** on the Integrations page queues scans across connected providers.

**Google Cloud auth:** Service account impersonation is recommended — connect via Integrations → Google Cloud, run the wizard **gcloud** commands, paste your scanner SA email, and verify. WIF is the alternative when impersonation is not feasible. Operator-side platform SA: `VERITRAIL_GCP_PLATFORM_SA_JSON` / `PATH` / `EMAIL`. See [multi-cloud-collectors.md](./multi-cloud-collectors.md).

## Identity & directory

| Integration | Purpose | Credentials |
|---|---|---|
| **Google Workspace** | MFA enforcement, inactive users, admin review (CC6) | OAuth (Admin SDK read-only) |
| **Microsoft Entra ID** | MFA posture, stale users, privileged roles (CC6) | OAuth (Microsoft Graph) |

Entra sync: `PUT /v1/integrations/entra`, `POST /v1/integrations/entra/sync`. Google Workspace sync: `PUT /v1/integrations/google-workspace`, `POST /v1/integrations/google-workspace/sync`. Identity checks: `entra.org.mfa_not_enforced`, `google_workspace.org.mfa_not_enforced`, and related admin/inactive-user checks. Included in `access_review_summary.json`.

## Source control & SDLC

| Integration | Purpose |
|---|---|
| **GitHub** | Branch protection, reviews, code scanning, Dependabot, secret scanning (alerts paginated; resolve only after successful collection) |
| **GitLab** | Protected branches, MR approvals, SAST/dependency/container scanning; Vulnerability Report findings when API/tier/scopes allow |

Findings use `account_provider` (`github` / `gitlab`) with org/repo scope labels. Audit packs include `sdlc_evidence.json`.

## Vulnerability scanners (optional)

| Integration | Purpose | Credentials | Capability lanes |
|---|---|---|---|
| **Wiz** | Open-finding import + capability envelopes | API URL, OAuth client ID/secret | host, container, cloud posture |
| **Tenable** | Same | API access/secret keys | host, cloud posture |
| **Qualys** | Same | Platform URL, username/password | host, cloud posture |
| **Snyk** | Same (Snyk-shaped adapter) | Org ID, API token | dependency, SAST, container |
| **Orca Security** | Same (Snyk-shaped adapter) | API token | host, container, cloud posture |
| **Aikido** | Same (Snyk-shaped adapter) | OAuth client credentials | dependency, SAST |

Connected scanners sync via `POST /v1/integrations/scanners/{vendor}/sync`. Each pull upserts open findings (`scanner.{vendor}.open_finding`) with dedup on vendor finding ID, writes normalized `capability_evidence` onto the provider config, and auto-resolves stale rows. Summaries export as `scanner_integrations.json` in evidence packs. **Absence of a named scanner never fails a lane** when native evidence covers it.

Implementation: `scanner_sync.py`, `scanner_integrations.py`, `scanner_capability_evidence.py`, `snyk_shaped_scanner.py`.

## Endpoint / workload agents (EDR)

| Integration | Purpose | Credentials |
|---|---|---|
| **CrowdStrike** | Managed-device denominator, sensor health, Spotlight vulns when licensed | OAuth client ID/secret, optional regional `base_url` |
| **SentinelOne** | Agent denominator, health, open threats | Management URL + API token |

Routes: `GET/PUT/DELETE /v1/integrations/edr/{crowdstrike|sentinelone}`, `POST .../sync`. Feeds `host_workload_scanning` capability envelopes. Human endpoint-policy admin is out of scope.

## SIEM & monitoring

| Integration | Purpose | Credentials |
|---|---|---|
| **Splunk** | Index ingestion + security signal grading (not mere connectivity) | Base URL, API token, index name |
| **Datadog** | Security-tagged monitors / Cloud SIEM signals | API key + application key, site |
| **Elastic Security** | `.alerts-security.alerts-default` evidence (not a generic ES cluster) | Cluster URL, API key |

SIEM sync: `PUT /v1/integrations/siem/{vendor}`, `POST /v1/integrations/siem/{vendor}/sync`. Stores `capability_evidence` for logging + threat-detection signal lanes. Exports as `siem_integrations.json` in audit packs.

## Incident workflow

| Integration | Purpose | Credentials |
|---|---|---|
| **PagerDuty** | Services, schedules, escalation policies, open/acked/resolved incidents | REST API token |

PagerDuty grades **incident operations only** — never threat detection. Sync stores operational `capability_evidence`.

## Ticketing & notifications

| Integration | Purpose | QA status |
|---|---|---|
| **Jira** | Create remediation issues from findings (remediation workflow only) | ✅ Fully tested (2026-07-04) — see [integration-test-checklist.md](./integration-test-checklist.md) |
| **Linear** | Same remediation ticket linkage | — |
| **GitHub Issues** | `POST /v1/integrations/github-issues/from-finding/{id}` — reuses GitHub OAuth token when no dedicated token configured | — |
| **Azure Boards** | `POST /v1/integrations/azure-boards/from-finding/{id}` — Azure DevOps PAT + project | — |
| **Slack** | Scan alerts and weekly digest webhooks | — |

All ticketing integrations populate `remediation_ticket_key` / `remediation_ticket_url` on findings.

## Related docs

- [multi-cloud-collectors.md](./multi-cloud-collectors.md) — GCP/Azure collectors, normalization APIs, composite mapping
- [external-evidence.md](./external-evidence.md) — uploaded proof, coverage dashboard, evidence lifecycle

## Capability lane export

Audit packs include `capability_lane_coverage.json` (lane status, providers, assessed/eligible,
limitations, operational SIEM/PagerDuty lanes). Historical snapshots persist in
`capability_coverage_snapshots` when grading runs.

## Coverage boundary (July 2026 scope decision)

**Full per-control contract: [coverage-boundaries.md](./coverage-boundaries.md) — the
authoritative verified / not-verified table.**

Veritrail shows only what it can collect: technical cloud, code, identity, optional scanner,
SIEM, and machine-verifiable EDR evidence. **MDM enrollment programs, HR & security training,
and vendor risk** are not displayed as controls. CrowdStrike/SentinelOne contribute
host/workload *coverage* evidence only — not endpoint-policy administration. Device
*encryption* remains covered via Intune/Jamf under Identity Governance. Program-level criteria
(CC1–CC5, CC9) are excluded. The Compliance page states this boundary in a scope note.
