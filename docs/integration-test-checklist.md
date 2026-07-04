# Integration test checklist

Manual QA checklist for Veritrail integrations **not yet validated** in your workspace.

**Last updated:** 2026-07-04

---

## Scope

| Status | Integrations |
|--------|--------------|
| **Already tested — skip** | Jira, GitHub, GitLab, Slack |
| **Out of scope (this doc)** | AWS, GCP, Azure cloud posture — connect via **Accounts**, not this checklist |
| **In scope below** | Identity, MDM, vuln scanners, SIEM, IaC repository, Linear (API), coming-soon catalog items |

**Entry points**

- Main hub: `/integrations`
- Full catalog: `/integrations/catalog`
- Compliance evidence export: **Compliance** → download evidence pack (includes `access_review_summary.json`, `scanner_integrations.json`, `siem_integrations.json`, `sdlc_evidence.json` when connected)

**Legend**

- **Free to try** — usable on a free tier, developer sandbox, or with credentials you already have
- **Paid / trial only** — needs vendor trial, enterprise license, or paid plan
- `[ ]` unchecked · `[x]` done · `[~]` partial / blocked

---

## Suggested test order (free & low-friction first)

Work top-to-bottom when possible — later items assume less setup.

| # | Integration | Cost | Route |
|---|-------------|------|-------|
| 1 | Snyk | Free to try | `/integrations/scanners/snyk` |
| 2 | Aikido | Free to try | `/integrations/scanners/aikido` |
| 3 | Okta | Free to try | `/integrations/okta` |
| 4 | Linear (API) | Free to try | API only — see § Ticketing |
| 5 | IaC repository | Free to try* | `/integrations/iac-repository` |
| 6 | Google Workspace | Paid / trial only† | `/integrations/google-workspace` |
| 7 | Microsoft Entra ID | Free to try‡ | `/integrations/entra` |
| 8 | Datadog | Paid / trial only | `/integrations/siem/datadog` |
| 9 | Elastic | Paid / trial only | `/integrations/siem/elastic` |
| 10 | Microsoft Intune | Paid / trial only | `/integrations/intune` |
| 11 | Jamf Pro | Paid / trial only | `/integrations/jamf` |
| 12 | Splunk | Paid / trial only | `/integrations/siem/splunk` |
| 13 | Wiz | Paid / trial only | `/integrations/scanners/wiz` |
| 14 | Tenable | Paid / trial only | `/integrations/scanners/tenable` |
| 15 | Qualys | Paid / trial only | `/integrations/scanners/qualys` |
| 16 | Orca Security | Paid / trial only | `/integrations/scanners/orca` |

\*Reuses GitHub/GitLab auth you already connected.  
†Requires Google Workspace (not personal Gmail). [google-workspace-setup.md](./google-workspace-setup.md)  
‡[Microsoft 365 Developer Program](https://developer.microsoft.com/microsoft-365/dev-program) E5 sandbox works well.

---

## Global prerequisites (all tests)

- [ ] Veritrail API + web running locally or on a deployed environment
- [ ] Signed in as **org admin** (integration connect requires admin RBAC)
- [ ] At least one **AWS account** connected (optional but useful — many findings and IaC remediation flows assume cloud context)
- [ ] Note your `API_PUBLIC_URL` for OAuth callbacks (local default: `http://localhost:8000`)

**After each integration**

- [ ] Integration card appears on `/integrations` with **Connected** / **Healthy**
- [ ] **Sync now** completes without error (where available)
- [ ] Relevant findings or summary counts update (Findings, Controls, or integration page callout)
- [ ] Evidence pack export includes the integration’s JSON artifact (see per-section **Verify export**)

---

## 1. Identity providers

### 1.1 Okta — **Free to try**

| | |
|---|---|
| **Route** | `/integrations/okta` |
| **API** | `PUT /v1/integrations/okta` · `POST /v1/integrations/okta/sync` |
| **Prerequisites** | [Okta Developer Edition](https://developer.okta.com/) org; SSWS API token with read-only directory access |

**Setup**

- [ ] Create API token: Okta Admin → **Security** → **API** → **Tokens** → Create token
- [ ] In Veritrail: enter org URL (`https://your-org.okta.com`) + token → **Save**
- [ ] **Sync now** — confirm user/admin counts and MFA policy callout

**Functional tests**

- [ ] Findings include Okta checks: `okta.org.mfa_not_enforced`, `okta.user.inactive_90d`, `okta.admin.unreviewed` (and optionally `okta.app.overprivileged_grant`, `okta.service.api_token_stale`)
- [ ] **Controls** → Identity governance composite reflects Okta signals
- [ ] Disconnect + reconnect with bad token shows clear error

**Verify export**

- [ ] Evidence pack contains `access_review_summary.json` with Okta section populated

---

### 1.2 Google Workspace — **Paid / trial only**

| | |
|---|---|
| **Route** | `/integrations/google-workspace` |
| **API** | `GET /v1/integrations/google-workspace/connect-url` · `POST /v1/integrations/google-workspace/sync` |
| **Prerequisites** | Workspace super-admin; OAuth client + redirect URI — see [google-workspace-setup.md](./google-workspace-setup.md) |
| **Env (operator)** | `GOOGLE_WORKSPACE_CLIENT_ID`, `GOOGLE_WORKSPACE_CLIENT_SECRET`, `API_PUBLIC_URL` |

**Setup**

- [ ] Register redirect: `{API_PUBLIC_URL}/v1/integrations/google-workspace/callback`
- [ ] **Connect with Google** as Workspace super-admin (not `@gmail.com`)
- [ ] **Sync now** — confirm domain, user/admin counts, 2SV enforcement status

**Functional tests**

- [ ] Findings: `google_workspace.org.mfa_not_enforced`, `google_workspace.user.inactive_90d`, `google_workspace.admin.unreviewed`
- [ ] OAuth error paths: `redirect_uri_mismatch`, `access_denied`, `insufficient_scopes` show actionable UI messages
- [ ] Token refresh survives overnight (re-sync without reconnect)

**Verify export**

- [ ] `access_review_summary.json` includes Google Workspace data

---

### 1.3 Microsoft Entra ID — **Free to try** (M365 dev sandbox)

| | |
|---|---|
| **Route** | `/integrations/entra` |
| **API** | `GET /v1/integrations/entra/connect-url` · `POST /v1/integrations/entra/sync` |
| **Prerequisites** | Entra tenant; Global Reader or equivalent; OAuth app registration |
| **Env (operator)** | `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `API_PUBLIC_URL` |
| **Scopes** | `Directory.Read.All`, `RoleManagement.Read.Directory` |

**Setup**

- [ ] Azure Portal → App registration → add redirect `{API_PUBLIC_URL}/v1/integrations/entra/callback`
- [ ] **Connect with Microsoft** → grant admin consent
- [ ] **Sync now** — confirm tenant ID, identity/admin counts, security defaults flag

**Functional tests**

- [ ] Findings: `entra.org.mfa_not_enforced`, `entra.user.inactive_90d`, `entra.admin.unreviewed`
- [ ] Reconnect flow after token expiry (`status: error` → Connect again)
- [ ] Identity governance composite updates on Controls page

**Verify export**

- [ ] `access_review_summary.json` includes Entra section

---

## 2. MDM / endpoint (not in catalog UI — direct routes)

These pages exist at dedicated URLs but are not yet on `/integrations/catalog`. Navigate directly.

### 2.1 Microsoft Intune — **Paid / trial only**

| | |
|---|---|
| **Route** | `/integrations/intune` |
| **API** | `PUT /v1/integrations/intune` · `POST /v1/integrations/intune/sync` |
| **Prerequisites** | Intune-licensed M365 tenant; Microsoft Graph token with `DeviceManagementManagedDevices.Read.All` |
| **Check ID** | `intune.device.not_encrypted` |

**Setup**

- [ ] Obtain tenant ID (Azure Portal → Entra → Overview)
- [ ] Generate Graph access token (Azure CLI, app registration, or short-lived portal token for dev)
- [ ] Save tenant ID + token → **Sync now** → confirm device count

**Functional tests**

- [ ] At least one managed device appears in sync stats
- [ ] Finding `intune.device.not_encrypted` appears when an unencrypted device exists (or confirm clean state if fleet is encrypted)
- [ ] Invalid token returns readable error on Save/Sync

---

### 2.2 Jamf Pro — **Paid / trial only**

| | |
|---|---|
| **Route** | `/integrations/jamf` |
| **API** | `PUT /v1/integrations/jamf` · `POST /v1/integrations/jamf/sync` |
| **Prerequisites** | Jamf Pro or [Jamf Cloud](https://www.jamf.com/) instance; API user with read access to computers |
| **Check ID** | `jamf.device.not_encrypted` |

**Setup**

- [ ] Create API-enabled account in Jamf (Settings → System Settings → Jamf Pro User Accounts)
- [ ] Enter Jamf URL (e.g. `yourorg.jamfcloud.com`), username, password → **Save**
- [ ] **Sync now** → confirm Mac device count

**Functional tests**

- [ ] Finding `jamf.device.not_encrypted` for FileVault-off devices (or clean pass if all encrypted)
- [ ] Wrong credentials fail verification on Save

---

## 3. Vulnerability scanners

All scanners: connect → **Sync now** → open findings upsert as `scanner.{vendor}.open_finding`.  
**API pattern:** `PUT /v1/integrations/scanners/{vendor}` · `POST /v1/integrations/scanners/{vendor}/sync`

### 3.1 Snyk — **Free to try**

| | |
|---|---|
| **Route** | `/integrations/scanners/snyk` |
| **Credentials** | Org ID + API token (Organization settings → General → API key) |

- [ ] Save org ID + token — connection verifies
- [ ] Sync imports open findings; UI shows count (e.g. “Synced N open findings”)
- [ ] Findings list filtered by `scanner.snyk.open_finding`
- [ ] Re-sync deduplicates; resolved findings auto-close on next sync
- [ ] **Verify export:** `scanner_integrations.json` includes Snyk summary

---

### 3.2 Aikido — **Free to try**

| | |
|---|---|
| **Route** | `/integrations/scanners/aikido` |
| **Credentials** | API token (Integrations → API) |

- [ ] Save token → verify → sync
- [ ] Open findings appear as `scanner.aikido.open_finding`
- [ ] **Verify export:** `scanner_integrations.json`

---

### 3.3 Wiz — **Paid / trial only**

| | |
|---|---|
| **Route** | `/integrations/scanners/wiz` |
| **Credentials** | API URL, OAuth client ID, client secret (Wiz tenant settings) |

- [ ] Save credentials → verify connection
- [ ] Sync pulls cloud findings → `scanner.wiz.open_finding`
- [ ] **Verify export:** `scanner_integrations.json`

---

### 3.4 Tenable — **Paid / trial only**

| | |
|---|---|
| **Route** | `/integrations/scanners/tenable` |
| **Credentials** | Tenable.io access key + secret key (Settings → My Account → API Keys) |

- [ ] Save keys → verify → sync
- [ ] Findings: `scanner.tenable.open_finding`
- [ ] **Verify export:** `scanner_integrations.json`

---

### 3.5 Qualys — **Paid / trial only**

| | |
|---|---|
| **Route** | `/integrations/scanners/qualys` |
| **Credentials** | Platform URL (e.g. `https://qualysapi.qg2.apps.qualys.com`) + username/password |

- [ ] Save platform URL + credentials → verify → sync
- [ ] Findings: `scanner.qualys.open_finding`
- [ ] **Verify export:** `scanner_integrations.json`

---

### 3.6 Orca Security — **Paid / trial only**

| | |
|---|---|
| **Route** | `/integrations/scanners/orca` |
| **Credentials** | API token (Settings → API tokens) |

- [ ] Save token → verify → sync (Snyk-shaped adapter)
- [ ] Findings: `scanner.orca.open_finding`
- [ ] **Verify export:** `scanner_integrations.json`

---

## 4. SIEM & monitoring

Signal evidence: 24h event/alert counts for logging & monitoring composites.  
**API pattern:** `PUT /v1/integrations/siem/{vendor}` · `POST /v1/integrations/siem/{vendor}/sync`

### 4.1 Datadog — **Paid / trial only** (14-day trial)

| | |
|---|---|
| **Route** | `/integrations/siem/datadog` |
| **Credentials** | API key + Application key; site (`datadoghq.com`, `datadoghq.eu`, etc.) |

- [ ] Save keys + site → verify (`/api/v1/validate`)
- [ ] Sync returns security monitor alert/warn count (`signal_count` on integration page)
- [ ] **Verify export:** `siem_integrations.json` includes Datadog row

---

### 4.2 Elastic / Sentinel — **Paid / trial only** (Elastic Cloud trial)

| | |
|---|---|
| **Route** | `/integrations/siem/elastic` |
| **Credentials** | Cluster URL + API key with read on `.alerts-security.alerts-default` |

- [ ] Save cluster URL + API key → verify (`/_cluster/health`)
- [ ] Sync returns 24h security alert count (0 is OK if index empty)
- [ ] **Verify export:** `siem_integrations.json`

---

### 4.3 Splunk — **Paid / trial only**

| | |
|---|---|
| **Route** | `/integrations/siem/splunk` |
| **Credentials** | Management port base URL (e.g. `https://splunk.example.com:8089`), API token, index name |

- [ ] Save base URL + token + index → verify (`/services/server/info`)
- [ ] Sync runs 24h search job → populates `signal_count`
- [ ] **Verify export:** `siem_integrations.json`

---

## 5. Ticketing & remediation

### 5.1 IaC repository — **Free to try** (reuses GitHub/GitLab)

| | |
|---|---|
| **Route** | `/integrations/iac-repository` |
| **API** | `PUT /v1/integrations/iac-repository` · `POST /v1/integrations/iac-repository/from-finding/{id}` |
| **Prerequisites** | GitHub or GitLab already connected; Terraform/Terragrunt repo with write access |

**Wizard (4 steps)**

- [ ] **Provider** — select GitHub (or GitLab)
- [ ] **Terragrunt** — indicate whether repo uses Terragrunt
- [ ] **Layout** — single vs dual repo mode
- [ ] **Link repos** — owner/repo path, verify **Verified** badge

**Functional tests**

- [ ] Integration shows on `/integrations` as connected with repo ref
- [ ] Open a cloud finding → **Remediation** drawer → create IaC PR (`/v1/integrations/iac-repository/from-finding/{id}`)
- [ ] PR link stored on finding (`remediation_ticket_key` / `remediation_ticket_url`)
- [ ] **Verify export:** `sdlc_evidence.json` references remediation tickets

---

### 5.2 Linear (API) — **Free to try**

No dedicated UI page yet — configure and test via API (mirrors Jira backend).

| | |
|---|---|
| **API base** | `/v1/integrations/linear` |
| **Prerequisites** | [Linear personal API key](https://linear.app/settings/api); team ID for issue creation |

**Setup (curl or API client)**

- [ ] `PUT /v1/integrations/linear` with `{ "api_key": "lin_api_...", "team_id": "..." }`
- [ ] `POST /v1/integrations/linear/test` — returns workspace user / email
- [ ] `GET /v1/integrations/linear` — `connected: true`, `has_api_key: true`

**Functional tests**

- [ ] `GET /v1/integrations/linear/issues` — lists recent issues
- [ ] Open finding → `POST /v1/integrations/linear/issues/from-finding/{finding_id}` — creates Linear issue
- [ ] Finding shows Linear URL; duplicate call returns same issue (idempotent)
- [ ] Missing `team_id` returns clear 400 before create

**Future UI**

- [ ] When Linear setup page ships, repeat above flows in browser and retire manual API steps

---

## 6. Coming soon (catalog — smoke only)

These appear on `/integrations/catalog` as **Coming soon**. No connect flow to test yet — track for regression when shipped.

| Integration | Catalog key | Notes |
|-------------|-------------|-------|
| **Azure DevOps Pipelines** | `azure-devops` | Ticketing & remediation category; disabled Connect button |
| **Azure Boards** | — | Route `/integrations/azure-boards` redirects to `/integrations`; API exists for `from-finding` |

**When available**

- [ ] Catalog card enables **Connect** (not disabled)
- [ ] Setup page loads; credentials save and verify
- [ ] At least one remediation or evidence signal works end-to-end

---

## 7. Cross-integration smoke (after individual passes)

Run once several connectors are green:

- [ ] `/integrations` KPI strip: connected count, syncing, errors accurate
- [ ] `/integrations/catalog` hides already-connected entries
- [ ] **Scan all** (if cloud connected) does not break identity/scanner sync state
- [ ] **Compliance** evidence pack with multiple integrations — all JSON artifacts present and non-empty:
  - `access_review_summary.json`
  - `scanner_integrations.json`
  - `siem_integrations.json`
  - `sdlc_evidence.json`
- [ ] Findings drawer remediation actions: Jira (tested), Linear (API), IaC PR — no cross-vendor confusion on ticket URLs

---

## Quick reference — routes & docs

| Doc | Topic |
|-----|-------|
| [integrations-overview.md](./integrations-overview.md) | All integration types and API summary |
| [google-workspace-setup.md](./google-workspace-setup.md) | Workspace OAuth redirect URIs |
| [multi-cloud-collectors.md](./multi-cloud-collectors.md) | Cloud collectors (out of scope here) |
| [external-evidence.md](./external-evidence.md) | Manual evidence uploads |

| UI route | Integration |
|----------|-------------|
| `/integrations/catalog` | Browse all catalog entries |
| `/integrations/google-workspace` | Google Workspace |
| `/integrations/entra` | Microsoft Entra ID |
| `/integrations/okta` | Okta |
| `/integrations/intune` | Microsoft Intune |
| `/integrations/jamf` | Jamf Pro |
| `/integrations/scanners/{snyk\|wiz\|tenable\|qualys\|orca\|aikido}` | Vulnerability scanners |
| `/integrations/siem/{splunk\|datadog\|elastic}` | SIEM & monitoring |
| `/integrations/iac-repository` | IaC remediation PRs |

---

## Test log (optional)

| Date | Tester | Integration | Result | Notes |
|------|--------|-------------|--------|-------|
| | | | | |
| | | | | |
