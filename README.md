# Veritrail

**AWS-native SOC 2 cloud and change evidence automation for engineering teams.**

Connect AWS, then optionally GitHub or GitLab for change-management evidence. GCP and Azure baseline collectors add multi-cloud posture checks (logging, compute exposure, Defender, storage) alongside AWS scans. Veritrail scans daily, maps cloud and change evidence to SOC 2 CC6/CC7/CC8, and produces auditor-ready evidence packs — JSON, CSV, and PDF — on demand.

Built for AWS-heavy engineering teams heading into SOC 2 who need a credible cloud and change evidence layer, not a broad GRC suite.

**One-line:** Connect your AWS account → first downloadable SOC2 evidence pack in under 10 minutes.

---

## What it is

Veritrail is a **SOC 2 infrastructure evidence layer** — not a CSPM, not a broad compliance suite.

| What Veritrail does | What Veritrail does not do |
|---|---|
| Automates SOC 2 cloud and change evidence from AWS and code-hosting systems | Replace Vanta/Drata (no HR/MDM/vendor/policy) |
| Produces timestamped, auditor-ready evidence packs | Compete with Wiz/Prisma on scan breadth |
| CloudTrail change timeline + GitHub/GitLab evidence in packs | Expand into full GRC (HR, training, vendor risk) |
| GCP/Azure baseline checks + unified cloud-accounts API | Full multi-cloud parity with AWS scan breadth |
| Shows blast radius before you remediate a finding | Generate AI summaries in evidence outputs |
| Console / CLI / Terraform / optional customer SSM Automation | Auto-remediate without customer approval |
| Documents exceptions with approver + reason + expiry | Run agents inside customer VPCs |

---

## How it works

```
Your browser
     │
     ▼
  Reverse proxy (prod)
     ├──▶ API   (FastAPI :8000)  ──▶ Postgres
     └──▶ Web   (React :5173)
                                       ▲
                                  Worker (Celery + beat)
                                       │
                                  sts:AssumeRole (ExternalId)
                                       │
                                       ▼
                              Customer AWS account
                          (read-only role, exact actions,
                           deployed via CloudFormation)
```

Single VPS · Docker Compose · No Kubernetes · No microservices.

The worker runs in Veritrail's control-plane account and assumes a customer-provided read-only role. Nothing runs inside the customer's VPC. IAM and STS are AWS control-plane APIs reachable over public HTTPS.

---

## Quickstart (dev)

```bash
cp .env.example .env
# Required: TRUST_PRINCIPAL_ARN — ARN allowed to assume customer roles
# Required: JWT_SECRET — long random string
# Optional: GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
# Optional: GITLAB_CLIENT_ID / GITLAB_CLIENT_SECRET
# Optional: RESEND_API_KEY (weekly digest email)

docker compose up -d db redis
docker compose run --rm api alembic upgrade head
docker compose up api worker web
```

Open **http://localhost:5173**.

AWS in dev: mount `~/.aws` (already in `compose.yml`) and set `AWS_PROFILE` in `.env`.

---

## Production deploy (Hetzner / VPS)

Fresh Ubuntu VPS (22.04/24.04 — Hetzner or similar): clone the repo, copy your secrets to `.env.prod`, then bootstrap once:

```bash
git clone https://github.com/awakzdev/Veritrail.git && cd Veritrail
# scp or edit .env.prod with prod secrets (JWT, OAuth, Postgres password, etc.)
sudo EMAIL=you@example.com bash scripts/launch-prod.sh --hetzner-roles-anywhere
```

`launch-prod.sh` defaults to `ENV_FILE=.env.prod`, installs Docker + certbot on a bare host, copies `.env.prod` → `.env`, sets `APP_ENV=production`, obtains TLS certs, runs migrations, and starts the prod compose profile. **Git auth is not required to build** — compose only uses git optionally for image labels (disabled by default). Do not run `npm install` in `web/` on the host before building; if you did, `rm -rf web/node_modules` before deploy.

**Redeploy** on an already-bootstrapped host (git pull + migrate + rebuild):

```bash
./scripts/launch-prod.sh --deploy-only --git-pull
```

Or use the repo shortcut after `source .aliases`: **`d`** (same as above). **`h`** is the one-time Hetzner bootstrap with Vault PKI + IAM Roles Anywhere.

Optional env vars: `DOMAIN` (UI hostname), `API_DOMAIN` (API hostname). Re-issue Let's Encrypt certs with `--force-cert`. Skip git pull with `GIT_PULL=0` or omit `--git-pull`.

**Prerequisites**

- DNS A records for UI + API hostnames pointing at the host
- Firewall allows inbound TCP 80 and 443
- AWS control-plane identity: **Hetzner/VPS** uses Vault PKI + IAM Roles Anywhere (`docs/hetzner-vault-rolesanywhere.md`). An EC2 instance profile still works if you host on AWS, but that is not the current production path.

Production uses the base compose file plus the production override:

```bash
ENV_FILE=.env.prod docker compose \
  -f compose.yml \
  -f compose.prod.yml \
  --env-file .env.prod \
  --profile prod \
  up -d
```

If `IAP_ENABLED=true`, add `-f compose.iap.yml --profile iap`; `scripts/launch-prod.sh` (which delegates to `scripts/bootstrap-ec2.sh` — the shared VPS bootstrap script) does this automatically. After bootstrap, `source .compose.prod.env` before manual compose commands.

`nginx/nginx.conf` and `nginx/iap/iap.*.conf` are generated on the host from `nginx/nginx.conf.template` and `infra/nginx/iap/` during bootstrap/redeploy — they are gitignored and should not be edited in git.

Compose file roles:

| File | Use |
|------|-----|
| `compose.yml` | Base local/dev services plus shared prod-profile services such as `nginx` and `backup` |
| `compose.prod.yml` | Production override: prod Dockerfiles, no bind mounts, no local dev ports, multi-worker API |
| `compose.iap.yml` | Optional production override that makes nginx wait for `oauth2-proxy` when IAP is enabled |

`var/log/nginx/` is intentionally kept in the repo with `.gitkeep`. In production nginx writes `access.log` and `error.log` there, and fail2ban reads `access.log`; the actual `*.log` files are ignored.

---

## Onboarding a customer account (AWS)

1. Sign up — email/password, GitHub, GitLab, or Google login.
2. **AWS Accounts** → choose connection mode:
   - **Core Scanner** (required, read-only) — AWS posture checks and SOC 2 cloud evidence packs.
   - **Advanced IAM policy generation** (optional) — adds `iam:GenerateServiceLastAccessedDetails` and Access Analyzer policy-generation actions to a separate CFN role. Starts AWS analysis jobs only; does not modify resources.
   - **Remediation automation** (optional, second stack) — customer-owned SSM Automation for approved fixes (e.g. security groups). Not required for compliance scanning.
3. **Continue to deploy** → **Launch CloudFormation stack** — template URL, ExternalId, trust principal, and optional parameters are pre-filled from your selections.
4. Deploy the stack in the customer's AWS console → copy `RoleArn` output (and `AdvancedPolicyGenRoleArn` if enabled).
5. Paste ARN → **Verify**. Veritrail calls `sts:AssumeRole` to confirm trust + ExternalId.
6. First scan triggers automatically. Findings appear in ~1–3 min.

**IaC scanning** (Terraform on GitHub/GitLab pull requests) is separate: connect GitHub under Integrations. It does not use the remediation SSM document.

---

## Google Cloud (optional)

Baseline posture checks (audit logging, compute public exposure). Connect under **Integrations → Google Cloud**.

**Recommended — service account impersonation:** Run the wizard's copy-paste **gcloud** commands in your project, then paste the scanner SA email back into Veritrail. Veritrail's platform SA impersonates your read-only scanner SA (`roles/iam.serviceAccountTokenCreator` on your side). Optional automation: [`infra/gcp/sa-setup/`](infra/gcp/sa-setup/).

**Alternative — Workload Identity Federation (WIF):** OIDC token exchange when impersonation is not feasible. [`infra/gcp/wif-setup/`](infra/gcp/wif-setup/).

**Operator env (Veritrail host):** `VERITRAIL_GCP_PLATFORM_SA_JSON`, `VERITRAIL_GCP_PLATFORM_SA_JSON_PATH`, and/or `VERITRAIL_GCP_PLATFORM_SA_EMAIL` (e.g. `scanner@veritrail.iam.gserviceaccount.com`).

Details: [docs/multi-cloud-collectors.md](docs/multi-cloud-collectors.md).

---

## Microsoft Azure (optional)

Phase-one baseline posture checks (Microsoft Defender for Cloud pricing/secure score, storage account public blob access). This is intentionally a thin baseline — not AWS-level check parity.

Connect under **Integrations → Microsoft Azure** with an Entra app registration and client credentials (tenant ID, client ID, client secret). Veritrail encrypts credentials at rest.

1. Register an app in Entra ID with **Reader** on the target subscription (and Microsoft Graph `Directory.Read.All` if you also use Entra integration).
2. **Integrations → Microsoft Azure** → add subscription ID + client credentials → **Verify**.
3. Run **Scan** on the subscription; findings include `azure.defender.not_enabled` and `azure.storage.public_blob_access`.

Client secrets are convenient for phase one; federated workload identity for Azure is planned as phase two (similar to GCP WIF / AWS role assumption).

Details: [docs/multi-cloud-collectors.md](docs/multi-cloud-collectors.md).

---

## Evidence pack

`GET /v1/exports/evidence-pack?framework=soc2&account_id=<id>&period=90`

Returns a ZIP bundle:

```
veritrail-evidence-soc2-2026-05-26.zip
  README.txt
  INDEX.csv
  checksum_manifest.json
  pack_signature.json          ← when EVIDENCE_PACK_SIGNING_KEY is set
  vault_upload_plan.json       ← when EVIDENCE_VAULT_S3_URI is set
  vault_upload_result.json     ← when EVIDENCE_VAULT_ENABLED (immutable S3 copy)
  access_roster.json           ← IAM users + Identity Center users, permission sets, and account assignments
  iam_history.json             ← point-in-time IAM snapshot entities
  controls/
    CC6.1/
      summary.json       ← status, finding count, exception count
      findings.json      ← open findings with evidence
      exceptions.json    ← approved exceptions (reason, approver, expiry)
    CC6.2/ …
    CC7.1/ …
  external-evidence/     ← customer-uploaded proof (files + manifest.json)
  external_evidence_summary.json
  evidence_source_registry.json   ← workspace-declared external tools by category
  evidence_coverage.json          ← automated vs external coverage by category
```

### External evidence (engineers)

Under **Compliance → Groups**, engineers can upload or link proof from systems outside AWS (e.g. Wiz, Tenable, GitHub for change management). Workflow:

1. Upload evidence on a failing group (vulnerability groups include a short scanner wizard).
2. Admin **accepts** or **rejects** with optional review notes.
3. Accepted evidence shows **Externally covered** on the group; auditors receive files in the audit pack ZIP.

**Workspace → Evidence** stores your declared external tools per category (included in `evidence_source_registry.json`). Registry rows are persisted in Postgres (`evidence_sources`); legacy JSON in org settings is migrated automatically.

See **[docs/external-evidence.md](docs/external-evidence.md)** for the full workflow, API, lifecycle states, and comments. **[docs/enterprise-readiness.md](docs/enterprise-readiness.md)** summarizes shipped vs deferred enterprise features.

**API:** `GET/POST /v1/controls/evidence`, `PATCH /v1/controls/evidence/{id}/review`, `DELETE /v1/controls/evidence/{id}`, `GET/POST /v1/controls/evidence/{id}/comments`, `GET /v1/controls/evidence-coverage`

**Storage env vars** (optional — defaults to local disk under `data/uploads`):

| Variable | Purpose |
|---|---|
| `EVIDENCE_ARTIFACTS_S3_URI` | e.g. `s3://bucket/prefix` — store uploaded evidence files in S3 |
| `EVIDENCE_ARTIFACTS_S3_REGION` | AWS region for artifact bucket |
| `EVIDENCE_VAULT_ENABLED` + `EVIDENCE_VAULT_S3_URI` | Immutable WORM copy of full evidence pack on export |

Auditors use the **auditor portal** and downloaded pack — not the upload UI.

**Sample pack** (no auth, no account needed):

`GET /v1/exports/sample-evidence-pack?framework=soc2`

---

## Checks (137 automated checks)

Veritrail's automated check registry currently covers AWS posture, AWS activity detections,
identity providers, source-control evidence, and change-management evidence. The
tables below summarize the main launch-facing coverage; the canonical registry lives
in [`api/app/checks/registry.py`](api/app/checks/registry.py).

### AWS checks

| Category | Checks |
|---|---|
| IAM root | no MFA, has access keys, root activity |
| IAM users | no MFA, inactive/unused credentials, admin/direct policies |
| IAM access keys | unused, no rotation, multiple active, newly created |
| IAM roles | unassumed, wildcard action/resource, unused services, external trust, trust wildcard, granted vs used, least privilege |
| IAM policies | wildcard resource, unattached managed policies |
| S3 | public access (bucket + account), no HTTPS policy, no KMS/default encryption, no MFA delete, no logging, CloudTrail bucket exposure |
| KMS | no rotation, wildcard key policy, CloudTrail KMS posture |
| CloudTrail / activity | not enabled, no log validation, no CloudWatch, tampering, public-access changes, IAM policy/key changes, anomalous API volume |
| GuardDuty / Inspector / vulnerability | not enabled, open findings, critical Inspector findings, vulnerability monitoring |
| EC2 / VPC / EBS | unrestricted SSH/RDP, default SG ingress, no flow logs, IMDSv2, public AMIs/snapshots, unencrypted volumes/snapshots, default EBS encryption |
| RDS | public instances/snapshots, no encryption, no backup, no deletion protection, no Multi-AZ |
| Containers / serverless | ECR scan posture, ECS public IP/privileged/container insights, EKS public endpoint/logging/secret encryption, Lambda public URLs/deprecated runtime/no DLQ |
| Governance services | Config, Security Hub, Access Analyzer, account contacts, backup plans, support role, weak password policy |
| Data services | DynamoDB/SNS/SQS encryption posture, DynamoDB PITR, plaintext SSM parameters, secret rotation |

### Source-control and identity checks

| Provider | Coverage |
|---|---|
| GitHub | org MFA, dormant/admin/outside members, branch and environment protection, required reviews/status checks, CODEOWNERS, Dependabot, code/secret scanning |
| GitLab | org MFA, dormant members, branch and environment protection, required reviews/status checks, CODEOWNERS, SAST/dependency/container scanning |
| Google Workspace / Entra / Identity Center | org MFA, inactive users, admin-review evidence |

---

## Frameworks covered

| Framework | Controls |
|---|---|
| SOC 2 TSC | CC6.1 – CC6.8, CC7.1 – CC7.2 |
| CIS AWS Foundations | Supporting AWS control mapping and detection coverage |

SOC 2 cloud and change evidence is the product boundary. Manual governance, HR, vendor, and policy controls may appear in auditor review workflows, but they are not the primary product promise.

---

## Key features

**"What If?" / Control Impact tab**
Before remediating, see what depends on a resource: service usage, last-accessed data, blast radius, policy diff (before/after). Confidence score based on 90-day activity window. Available for all automated checks in the registry (~80+).

**Exception workflow**
Flag a finding as a formal documented exception: reason, approver, expiry date. Exceptions appear in evidence packs — auditors see them alongside open findings. Separate from snooze (which is operational deferral, not formal approval).

**History** (`/history`) — SOC 2 evidence timeline with per-snapshot infrastructure event drill-down; `/timeline` redirects here
- **Activity Log** — CloudTrail infrastructure writes from scans; filtered by default to compliance-relevant sources (IAM, S3, EC2, KMS, …). Toggle **Include operational noise** for SSM/Lambda churn.
- **History** — posture improvements/regressions and collapsed no-change scan periods, from `GET /v1/accounts/{id}/compliance-timeline`.
- GitHub/GitLab change evidence stays in compliance packs and integration sync — not on the activity log page.

**Findings drawer**
- Tabs: Overview, Resources, Compliance, Remediation, What If (when supported).
- Opening a finding lands on **Overview**; switching resources in a group keeps your current tab.
- **Remediation**: Console | CLI | Terraform | Automation in one panel.
- **Verify** re-runs the check; if the issue is gone, the finding moves to **Resolved** automatically (no manual “mark resolved”).
- **Reopen** on resolved/ignored findings.

**Scan progress**
Accounts page shows real worker step progress (`progress_step` / `progress_total`) from the API — no misleading time-remaining estimate.

**Evidence freshness**
Every evidence item is timestamped with collection time and source API. Evidence packs include raw JSON from AWS/GitHub/GitLab APIs.

---

## Remediation (read-only core + optional customer automation)

Veritrail's Core Scanner is read-only. If you explicitly enable remediation modules, approved fixes run through customer-owned SSM Automation with scoped permissions. Remediation paths:

| Path | What it does |
|------|----------------|
| **Console / CLI** | Step-by-step copy in the finding drawer (resource names interpolated). |
| **Terraform** | Declarative snippets for **S3 / KMS** only — not security groups (no `null_resource` / local-exec). |
| **Version-control PR** | `POST …/iac/repo-scan` scans repo `.tf`/`.hcl`; `POST …/iac/terraform-pr` opens PR for **S3 PAB** and **KMS rotation** when hclpatch finds an exact resource block. SG: scan shows file/line — fix via SSM Automation. |
| **SSM Automation** | Customer deploys [`infra/cfn/veritrail-remediation-ssm.yaml`](infra/cfn/veritrail-remediation-ssm.yaml); Veritrail plan v2; `POST .../remediation/dispatch` starts SSM Automation when scoped permissions are enabled, with a CLI fallback. |

**Security group checks** (`ec2.security_group.unrestricted_ssh` / `unrestricted_rdp`):
- Collector flags port-specific public ingress (22 / 3389) and **all-traffic** `0.0.0.0/0`; findings include `exposing_rules` in evidence.
- Remediation: **Console, CLI, SSM Automation** — the document revokes `exact_match_rules` only; fixed customer IAM role.
- Plan v2: `resource_region`, `execution.runner_type=ssm`, `expires_at`, `content_sha256`, optional Ed25519 signature via `POST /v1/findings/{id}/remediation/dispatch`.

**APIs**

| Endpoint | Purpose |
|----------|---------|
| `GET /v1/findings/{id}/iac-snippets` | Terraform + apply paths |
| `GET /v1/findings/{id}/remediation-plan` | Signed plan for customer executor |
| `POST /v1/findings/{id}/remediation/dispatch` | SSM Automation payload + `start-automation-execution` CLI |
| `POST /v1/findings/{id}/iac/terraform-pr` | Repo-aware GitHub PR (S3 checks; requires connected GitHub) |
| `GET /v1/accounts/{id}/remediation-runner/status` | Read-only: SSM Automation document check before execution |
| `POST /v1/findings/{id}/iac/repo-scan` | Scan GitHub repo for matching Terraform resources |
| `GET /v1/findings/{id}/remediation-execution` | Dispatch / optional completion status by `plan_id` |
| `POST /v1/findings/{id}/recheck` | Verify — targeted re-collect + re-run one check |
| `POST /v1/findings/{id}/reopen` | Move resolved/ignored finding back to open |

Full runbook: [docs/remediation-automation.md](docs/remediation-automation.md).

**Deferred:** broader repo-aware Terraform patching and optional SSM execution callback keyed by `plan_id`.

**Development only:** `scripts/deploy-ssm-docs.sh` deploys SSM Automation documents directly to AWS (bypasses CloudFormation). It is blocked unless `VERITRAIL_ALLOW_DIRECT_SSM_DOC_DEPLOY=1`. Supported customer path: `./scripts/upload-cfn.sh` + [`infra/cfn/veritrail-remediation-ssm.yaml`](infra/cfn/veritrail-remediation-ssm.yaml).

---

## AWS permissions

Core Scanner is deployed via [`infra/cfn/veritrail-readonly-role.yaml`](infra/cfn/veritrail-readonly-role.yaml).

**Read-only by default. Optional modules require separate customer-approved permissions.**

Base role is strictly **Read / List / Describe** access-level. Key actions: `iam:Get*` / `iam:List*` · `iam:GenerateServiceLastAccessedDetails` / `iam:GetServiceLastAccessedDetails` (read access reports; no mutation) · `s3:GetBucket*` · `s3:ListAllMyBuckets` · `kms:Describe*` / `kms:List*` · `cloudtrail:Describe*` / `cloudtrail:LookupEvents` · `guardduty:List*` / `guardduty:Get*` · `ec2:Describe*` · `rds:Describe*` · `access-analyzer:ListAnalyzers` · `config:Describe*` · `securityhub:Describe*` · `sts:GetCallerIdentity`.

The Write access-level IAM Access Analyzer **policy-generation** actions (`StartPolicyGeneration` / `GetGeneratedPolicy` / `ListPolicyGenerations` / `CancelPolicyGeneration`) are **not** in the base role. They live in an optional separate role `*AdvancedPolicyGen`, created only when `EnableAdvancedPolicyGeneration=Yes` — enable it only if you want Veritrail's Advanced least-privilege policy generation. A second optional role `*AccessAnalyzerMonitor` (Access Analyzer service principal) grants CloudTrail S3 read during policy generation. Remediation uses a separate customer-owned SSM Automation stack and runs only after approval.

The role uses `ExternalId` (confused-deputy protection). Only `TRUST_PRINCIPAL_ARN` can assume it.

---


## Architecture

```
api/
  app/
    core/         config, db, security, aws (sts), passwords, encryption
    models/       SQLAlchemy 2.0 tables
    routes/       auth, auth_oauth, accounts, findings, controls, exports, settings, integrations
    collectors/   boto3 → DB upserts (iam, s3, kms, ec2, rds, vpc, cloudtrail, cloudtrail_events, sg_ingress, ...)
    checks/       pure functions → FindingDraft (registry, persist — auto-resolve on recheck)
    services/     evidence_pack, pdf_report, github_sync, gitlab_sync,
                    iac_snippets, remediation_plan, remediation_dispatch, remediation_iam
    worker/       celery_app + tasks (run_scan, scan_all_accounts, recheck_finding, send_weekly_digests)
  migrations/     Alembic (0001 → 0079)
web/              React + Vite + Tailwind + TanStack Query
                  pages: Findings, Activity log, Compliance timeline, Controls, Accounts, …
tools/
  hclpatch/       Go HCL patcher for repo-aware Terraform PRs (S3 checks)
infra/
  cfn/            veritrail-readonly-role.yaml
                  veritrail-remediation-ssm.yaml          ← SG/SSM remediation (SSM Automation)
docs/             hetzner-vault-rolesanywhere.md, remediation-automation.md, evidence-vault.md
compose.yml       base dev/shared compose file
compose.prod.yml  production override
compose.iap.yml   optional production IAP override
```

---

## Auth

- Email + password (bcrypt + sha256 prehash)
- GitHub OAuth (login + connect for evidence)
- Google OAuth (login only; Google Workspace evidence ingestion is not part of the current product)
- JWT access tokens (24h) + refresh tokens (30d, auto-retry on 401)

---

## Release readiness

Shipped in-repo (narrow design-partner launch):

| Item | Status |
|------|--------|
| **Evidence classification** | `benchmark` / `supporting` / `hygiene` on checks; `check_evidence_classes.json` in ZIP; Detection coverage legend |
| **Root pass-state snapshots** | `account_summary` entity per scan (`GetAccountSummary` for `iam.root.*`) |
| **CIS honesty** | `cis_benchmark_coverage.json` in CIS packs; PDF meta shows mapped vs CIS v5 L1 total (40) |
| **Pack integrity** | `checksum_manifest.json` — SHA-256 per artifact (manifest not self-hashed) |
| **CI** | `.github/workflows/ci.yml` — API tests, frontend build, gitleaks, no tracked `.env` |
| **Historical packs** | Control status at `as_of` from finding events; benchmark-only fail; roster from snapshots |
| **Coverage honesty** | `days_with_data` = union of successful scan days + snapshot days (not elapsed since first scan) |
| **Activity Log** | Multi-region CloudTrail; compliance filter + operational-noise toggle; `/timeline` |
| **History** | `/history` + `GET /v1/accounts/{id}/compliance-timeline` |
| **Scan progress** | Worker `progress_step` / `progress_total` on latest scan run; UI shows steps (no ETA) |
| **Finding lifecycle** | Verify → auto-resolve via `recheck_finding`; reopen endpoint; no manual resolve in UI |
| **IaC three-tier model** | S3/KMS snippets; SG = Console/CLI/SSM Automation only; GitHub PR for S3 (hclpatch + validate) |
| **Remediation v2** | Plan signing, automation vs resource region, exact-match SSM Automation, status API |
| **Evidence vault upload** | Object Lock `PutObject` on export when `EVIDENCE_VAULT_ENABLED` + `EVIDENCE_VAULT_S3_URI` |
| **SG ingress evidence** | `public_exposure` on security groups; `exposing_rules` on findings |

### Deepsearch v3 alignment (architecture review)

Most of the **deepsearch v3** phase 1–2 and navigation (phase 5) recommendations are in the repo (see [`docs/deepsearch-v4-map.md`](docs/deepsearch-v4-map.md)). Not everything is “exact” — gaps are intentional deferrals:

| v3 recommendation | Status |
|-------------------|--------|
| Remediation plan v2 (expiry, bus/resource region, `exact_match_rules`, signature) | **Done** |
| Customer-owned automation in home region, EC2 in `resource_region` | **Done** |
| SSM document validates schema + supported `check_id`s + `execution.runner_type` | **Done** |
| No fake SG Terraform; SG = automation-only | **Done** |
| Go **hclpatch** — scan `.tf`/`.hcl`, match resource by name/attrs, patch file | **Partial** — PR patch: **S3 PAB + KMS rotation**; **scan** also finds **security groups** (manual/SSM Automation to fix) |
| Repo-aware PR | **Partial** — `POST …/iac/repo-scan` then `…/iac/terraform-pr` when `can_patch` |
| Evidence vault: WORM upload per `report_id` | **Partial** — export upload + presigned; auditor approval UI still open |
| Activity log + compliance timeline + noise toggle | **Done** |
| Activity log → related open findings | **Done** (token overlap on resource names/ARNs) |
| Customer-owned SSM Automation document | **Done** — [`infra/cfn/veritrail-remediation-ssm.yaml`](infra/cfn/veritrail-remediation-ssm.yaml) |
| Execution per `plan_id` | **Partial** — dispatch is recorded; SSM output remains in customer account unless a callback is added |
| `noindex` on app shell | **Done** |
| Move long-form reference to external docs site | **Not done** |

Still manual / planned (not blockers for first design partners):

| Item | Notes |
|------|--------|
| **Auditor share workflow** | Vault presign works; no “approve auditor → link for `report_id`” product flow yet |
| **Cryptographic pack signing** | Set `EVIDENCE_PACK_SIGNING_KEY` — `pack_signature.json`; public key at `GET /v1/meta/evidence-pack-signing-key` |
| **Full CIS v5 parity** | `cis_v5_level1_matrix.json`; ~24 core-mapped in Compliance |
| **IAM history UI** | `GET /v1/accounts/:id/iam-history?as_of=` + pack JSON only |
| **GitLab MR + broader Terraform PR** | GitHub S3 PR only; SG/KMS repo patches later |
| **Control copy template** | Standardize Controls UI blocks |
| **Narrative audit automation** | Script: narrative ↔ `check_id` registry |
| **Ops hygiene** | Nightly backups (`docs/backup-restore-runbook.md`), secrets rotation, smoke tests — see `scripts/launch-prod.sh` checklist |

### Deepsearch v4 alignment (architecture review)

See [`docs/deepsearch-v4-map.md`](docs/deepsearch-v4-map.md) for the full feature matrix. IAM policy generator / last-accessed behavior: [`docs/policy-generator-iam-last-accessed.md`](docs/policy-generator-iam-last-accessed.md). Summary:

| v4 recommendation | Status |
|-------------------|--------|
| SSM Automation remediation (not Terraform local-exec) | **Done** |
| Signed plan v2 + exact-match SG rules | **Done** |
| `approval` on dispatched plan (`token`, `approved_by`, `approved_at`) | **Done** (dispatch only; preview plan unchanged) |
| Evidence vault Object Lock upload | **Done** when `EVIDENCE_VAULT_ENABLED` |
| Export row vault metadata (`report_id`, S3 URI, version, lock mode) | **Done** (migration 0034) |
| AWS-owned SSM runbook expansion | **Partial** — catalog exists; wire parameters per check before enabling |
| Auditor approve → share UI | **Gap** |
| Repo-aware Terraform beyond S3/KMS patch | **Partial** |
| Docs said vault “scaffold only” | **Fixed** — code was ahead of docs |

**Reference docs:** Hetzner/VPS deploy: [`docs/hetzner-vault-rolesanywhere.md`](docs/hetzner-vault-rolesanywhere.md). Remediation runbook: [`docs/remediation-automation.md`](docs/remediation-automation.md). Vault design: [`docs/evidence-vault.md`](docs/evidence-vault.md). Product assessment: [`docs/product-assessment-2026-06.md`](docs/product-assessment-2026-06.md). SOC 2 coverage map: [`docs/soc2-coverage-map.md`](docs/soc2-coverage-map.md). Multi-cloud collectors: [`docs/multi-cloud-collectors.md`](docs/multi-cloud-collectors.md). Integrations overview: [`docs/integrations-overview.md`](docs/integrations-overview.md).

**Ops hygiene:** Never distribute repo archives with `.env` / `.env.prod`. Use `git archive` or CI artifacts. Rotate any secret that ever appeared in a shared ZIP.

---

## Public site files (`web/public/`)

Served at the web app root (Vite `public/`):

| File | Purpose |
|------|---------|
| `llms.txt` | Product summary for LLM crawlers |
| `robots.txt` | Crawl rules (app routes disallowed; `/login`, `/privacy`, `/terms` allowed) |
| `sitemap.xml` | Public URLs only — update `SITE_BASE` in file when the production hostname changes |

Default canonical host in sitemap: `https://app.veritrail.io`.

---

## License

Source closed.
