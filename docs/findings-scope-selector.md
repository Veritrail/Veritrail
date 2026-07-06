# Findings scope selector — implementation spec

Spec for org-level **All cloud accounts** scope and merged **Source control** scope in the Findings account picker (and shared scope selectors where applicable). **Spec only — no code in this doc.**

Product decisions are locked; see [Out of scope](#out-of-scope) for what this work explicitly excludes.

---

## Problem / current behavior

### Findings scope today

[`web/src/pages/Findings.tsx`](../web/src/pages/Findings.tsx) builds the header picker from:

1. **Cloud accounts** — from [`useConnectedAccountOptions`](../web/src/hooks/useConnectedAccountOptions.ts) (`GET /v1/accounts` + `GET /v1/integrations/cloud-accounts`, AWS + connected GCP/Azure).
2. **Separate source-control entries** — one row per connected SCM provider (`sourceControlScopeOption("github")` / `"gitlab"`), appended after cloud accounts when `GET /v1/integrations/github` or `/gitlab` returns a connected provider.

Selection is stored in the URL:

| Active scope | URL | API params sent by [`fetchAllFindings`](../web/src/lib/fetchAllFindings.ts) |
|---|---|---|
| Single AWS account | `?account_id=<uuid>` | `account_id` |
| Single GCP project | `?account_id=<uuid>` (internal id) | `gcp_project_id` |
| Single Azure subscription | `?account_id=<uuid>` | `azure_subscription_id` |
| GitHub findings | `?provider=github` (no `account_id`) | `provider=github` |
| GitLab findings | `?provider=gitlab` | `provider=gitlab` |

Sentinel ids for SCM rows use prefix `scope:` ([`SOURCE_CONTROL_SCOPE_PREFIX`](../web/src/hooks/useConnectedAccountOptions.ts)); e.g. `scope:github` → `?provider=github`.

**Default:** [`resolveSelectedAccountId`](../web/src/lib/selectedAccountStorage.ts) picks URL `account_id`, then sessionStorage, then **the first connected cloud account**. There is no org-wide cloud aggregate.

**Trigger label:** [`AccountFilterDropdown`](../web/src/components/AccountFilterDropdown.tsx) shows [`accountDisplayName`](../web/src/components/AccountSelect.tsx) — for SCM scopes that is `"GitHub"` or `"GitLab"` (from `sourceControlScopeOption` label), not a merged label.

### Backend findings filters today

[`api/app/routes/findings.py`](../api/app/routes/findings.py):

**`GET /v1/findings`** query params:

| Param | Type | Behavior |
|---|---|---|
| `status` | string | Default `open`; `all` disables status filter |
| `severity` | string | Optional severity filter |
| `check_id` | string | Optional |
| `account_id` | UUID string | AWS account scope — `Finding.account_id == id` |
| `gcp_project_id` | UUID string | GCP scope — `Finding.gcp_project_id == id` |
| `azure_subscription_id` | UUID string | Azure scope — `Finding.azure_subscription_id == id` |
| `provider` | string | **`github` or `gitlab` only** — org-level SCM: `account_id IS NULL` AND `check_id LIKE '{provider}.%'` |
| `limit`, `cursor` | pagination | Max 500/page |

Scope logic lives in `_apply_provider_or_scope` → `_apply_scope_filter`:

- **`provider=github|gitlab`:** source-control findings only (mutually exclusive with cloud account params).
- **Single cloud param:** one AWS/GCP/Azure resource.
- **No scope params:** **no scope filter** — returns **all org findings**, including SCM (`account_id` NULL) **and** cloud. This is the guardrail motivator: the UI must not treat “no filter” as “all cloud.”

**`GET /v1/findings/summary`:** same cloud params (`account_id`, `gcp_project_id`, `azure_subscription_id`) via `_apply_scope_filter` only — **no `provider` param**, no org cloud aggregate.

**`GET /v1/exports/findings.csv`:** [`api/app/routes/exports.py`](../api/app/routes/exports.py) — `status` + optional `account_id` (AWS only). No GCP/Azure/`provider`/all-cloud support. Findings page export passes cloud params + `provider` in the client, but the export route ignores most of them today.

### Data model (what “cloud” vs “source control” means)

[`api/app/models/finding.py`](../api/app/models/finding.py):

- **AWS:** `Finding.account_id` → `aws_accounts.id`
- **GCP:** `Finding.gcp_project_id` → `gcp_projects.id`
- **Azure:** `Finding.azure_subscription_id` → `azure_subscriptions.id`
- **Source control:** org-level; **`account_id`, `gcp_project_id`, and `azure_subscription_id` are all NULL**; `check_id` prefixed `github.` or `gitlab.` ([`is_source_control_check`](../api/app/checks/registry.py))

Existing cloud aggregation helper: [`cloud_open_findings_total`](../api/app/services/cloud_normalization.py) / per-provider `open_findings_count` — counts open findings where the relevant cloud FK column is NOT NULL. Reuse this definition for **`all_cloud`**.

### Other pages using the same picker

| Page | Scope selector | Source control in dropdown? | Notes |
|---|---|---|---|
| **Findings** | `AccountFilterDropdown` | Yes (separate GitHub + GitLab) | Full scope behavior described above |
| **Controls** (`Compliance`) | `AccountFilterDropdown` | **No** — cloud accounts only | [`useConnectedAccountOptions`](../web/src/hooks/useConnectedAccountOptions.ts) only; links to Findings use `?provider=github\|gitlab` via `providerScopeForChecks` |
| **History** (`HistoryV2`) | `AccountFilterDropdown` | **No** | AWS account timeline; GCP/Azure composites disabled (`isAwsAccount`) |

**Integrations hub:** separate GitHub and GitLab connect cards ([`web/src/pages/Integrations.tsx`](../web/src/pages/Integrations.tsx)); [`RECOMMENDED_INTEGRATION_TIER_1`](../web/src/lib/integrationCatalog.ts) lists both — **unchanged by this work**.

---

## Goals

1. Add **All cloud accounts** scope: all AWS + GCP + Azure findings for the org, **excluding** source-control and other org-level non-cloud findings.
2. Merge GitHub + GitLab picker entries into one **Source control** scope; trigger shows **Source control** when active.
3. Backend **explicit** filters — `all_cloud` and `source_control` (or equivalent) — so unscoped queries never accidentally represent “all cloud.”
4. Default selection should **lean org-level** (All cloud accounts) where sensible on Findings.
5. Keep Integrations connect UI **split** (GitHub card + GitLab card).

---

## UX: scope dropdown options

Recommended **display order** (top = org-level scopes, then per-account):

1. **All cloud accounts** — org aggregate (AWS + GCP + Azure only)
2. *(divider or visual group optional)* **Cloud accounts** — one row per connected AWS account, GCP project, Azure subscription (existing rows, unchanged ordering within group)
3. **Source control** — single row if **either** GitHub or GitLab is connected (not two rows)

**Labels (exact copy):**

| Scope | Trigger label | Subtitle / meta line (dropdown row) |
|---|---|---|
| All cloud accounts | `All cloud accounts` | e.g. `AWS · GCP · Azure` or account count |
| Per cloud account | Existing (label or external id) | Existing `Provider · id` |
| Source control | `Source control` | e.g. `GitHub · GitLab` or connected provider names |

**Visibility rules:**

- **All cloud accounts:** show when `connectedCloudAccounts.length >= 1` (any AWS/GCP/Azure).
- **Source control:** show when GitHub **or** GitLab integration is connected (same queries Findings uses today).
- If org has **only** source control (no cloud accounts): show Source control only; empty state elsewhere unchanged.

**URL / sentinel ids (frontend):**

Extend [`SOURCE_CONTROL_SCOPE_PREFIX`](../web/src/hooks/useConnectedAccountOptions.ts) pattern:

| Scope | Sentinel `id` | URL |
|---|---|---|
| All cloud accounts | `scope:all_cloud` | `?provider=all_cloud` (clear `account_id`) |
| Source control | `scope:source_control` | `?provider=source_control` (clear `account_id`) |
| Single cloud account | account uuid | `?account_id=<uuid>` (clear `provider`) |

**Default (Findings):** when cloud accounts exist and URL has no scope, select **All cloud accounts** (`provider=all_cloud`) instead of first account. Persist via URL + sessionStorage sentinel `scope:all_cloud`.

**Scan button:** unchanged — [`FindingsScanButton`](../web/src/pages/Findings.tsx) only renders for a **single selected AWS account** (`awsScanAccountId`). Hidden for All cloud accounts and Source control.

**Client-side post-filter:** today Findings re-filters with `findingBelongsToAccount` (single account) or `findingScopeProvider === providerScope` (SCM). For **`all_cloud`** and **`source_control`**, rely on backend filtering; remove redundant client filters that assume single-provider SCM.

---

## Backend: new/changed query params, filtering rules, edge cases

### Extend `provider` query param (recommended)

Keep one param on `GET /v1/findings` for consistency with existing SCM scope. Extend allowed values:

| `provider` value | SQL / filter semantics | Mutually exclusive with |
|---|---|---|
| *(absent)* + cloud id params | Unchanged single-account scope | `provider` |
| `github` | **Legacy** — same as today | cloud id params |
| `gitlab` | **Legacy** — same as today | cloud id params |
| **`source_control`** | `account_id IS NULL` AND (`check_id LIKE 'github.%'` OR `check_id LIKE 'gitlab.%'`) — prefer `is_source_control_check(check_id)` | cloud id params |
| **`all_cloud`** | `(account_id IS NOT NULL OR gcp_project_id IS NOT NULL OR azure_subscription_id IS NOT NULL)` | cloud id params, `source_control`, `github`, `gitlab` |

Implement in `_apply_provider_or_scope` ([`findings.py`](../api/app/routes/findings.py)). Reject invalid combinations with **400** (e.g. `provider=all_cloud&account_id=...`).

**Critical guard:** `provider=all_cloud` must **not** include findings where all three cloud FKs are NULL (source control). Do **not** implement all-cloud as “no filter.”

**Align with existing helpers:**

```python
# Equivalent to “any cloud scope column set” — mirror cloud_normalization.open_findings_count per provider
or_(
    Finding.account_id.isnot(None),
    Finding.gcp_project_id.isnot(None),
    Finding.azure_subscription_id.isnot(None),
)
```

### Edge cases

| Case | Expected in `all_cloud`? | Notes |
|---|---|---|
| AWS/GCP/Azure scan findings | Yes | FK column set |
| GitHub/GitLab (`github.*`, `gitlab.*`) | **No** | All cloud FKs NULL |
| Scanner findings (`scanner.*`) with NULL cloud FKs | **No** (by FK rule) | Org-level scanner imports; not starter cloud-account scope |
| Identity findings (Okta/Entra/etc.) with NULL cloud FKs | **No** | Same as above |
| Legacy deep links `?provider=github` | Still work | Backend unchanged for `github`/`gitlab`; UI maps to Source control row |
| Org with one cloud account | All cloud == that account’s findings | Still show All cloud as default/top option for consistency |

### Other endpoints to update (same scope semantics)

| Endpoint | Current gap | Change |
|---|---|---|
| `GET /v1/findings/summary` | No `provider`; unscoped = everything | Add `provider` (`all_cloud`, `source_control`, legacy SCM); apply shared helper |
| `GET /v1/exports/findings.csv` | AWS `account_id` only | Add `gcp_project_id`, `azure_subscription_id`, `provider` (all values); reuse `_apply_provider_or_scope` |
| `POST /v1/findings/bulk-triage` | AWS `account_id` optional | Out of scope unless triage UX needs all-cloud (defer) |

**Shared helper:** extract `_apply_provider_or_scope` (or rename to `_apply_findings_scope`) into a small module importable from `findings.py` and `exports.py` to avoid drift.

### API contract (frontend)

Update [`FetchAllFindingsParams`](../web/src/lib/fetchAllFindings.ts):

```ts
provider?: "github" | "gitlab" | "source_control" | "all_cloud";
```

[`findingsScopeParams`](../web/src/hooks/useConnectedAccountOptions.ts): return `{ provider: "all_cloud" }` for All cloud sentinel; `{}` for source control (caller sets `provider: "source_control"`).

---

## Frontend: files to touch

### Core scope model

| File | Changes |
|---|---|
| [`web/src/hooks/useConnectedAccountOptions.ts`](../web/src/hooks/useConnectedAccountOptions.ts) | `allCloudScopeOption()`, `sourceControlScopeOption()` (merged), export `parseScopeFromSearchParams`, build `connectedScopeOptions` list in correct order |
| [`web/src/hooks/useSelectedAccountId.ts`](../web/src/hooks/useSelectedAccountId.ts) | When `provider` is org-level (`all_cloud`, `source_control`, legacy github/gitlab), **do not** force-write `account_id` into URL (similar to Findings’ SCM handling) |
| [`web/src/lib/selectedAccountStorage.ts`](../web/src/lib/selectedAccountStorage.ts) | Default resolution: prefer `scope:all_cloud` when cloud accounts exist |
| [`web/src/lib/fetchAllFindings.ts`](../web/src/lib/fetchAllFindings.ts) | Typed `provider` union; pass new values |
| [`web/src/components/AccountSelect.tsx`](../web/src/components/AccountSelect.tsx) | Optional: extend `ScopeProvider` with synthetic providers or handle display names for `all_cloud` / `source_control` in `accountDisplayName` / `ProviderMark` (generic cloud icon + SCM icon) |
| [`web/src/components/AccountFilterDropdown.tsx`](../web/src/components/AccountFilterDropdown.tsx) | Menu heading may stay “Accounts” or become “Scope”; ensure synthetic rows render sensible icons/subtitles; footer count text (“N accounts”) may need tweak when org scopes included |

### Findings page

| File | Changes |
|---|---|
| [`web/src/pages/Findings.tsx`](../web/src/pages/Findings.tsx) | Replace dual SCM options with merged list; parse `provider=all_cloud\|source_control`; update `handleAccountChange`, query key, `scopedFindings`, CSV export QS, `findingsQueryEnabled` |
| [`web/src/lib/findingDisplay.ts`](../web/src/lib/findingDisplay.ts) | Optional: `findingScopeProviderLabel` for grouped SCM display in rows (unchanged per-finding) |

### Controls (partial — links + optional dropdown)

| File | Changes |
|---|---|
| [`web/src/pages/Controls.tsx`](../web/src/pages/Controls.tsx) | `providerScopeForChecks` → emit `provider=source_control` when any SCM check; update remediation copy (“Fix in source control” vs provider-specific); **optional phase 2:** add All cloud + Source control to dropdown if compliance API gains multi-scope support |

Controls **open findings** query today uses `findingsScopeParams(activeAccount)` for a **single** account only ([~L4162](../web/src/pages/Controls.tsx)). All-cloud compliance grading is **not** supported by `GET /v1/controls` (AWS `account_id` only). **Recommend Findings-first** for All cloud; Controls dropdown parity is a follow-up unless product insists on phase 1.

### History

| File | Changes |
|---|---|
| [`web/src/pages/HistoryV2.tsx`](../web/src/pages/HistoryV2.tsx) | **Defer** All cloud / Source control — timeline is per AWS account today. Document as future if product expands History to multi-cloud. |

### Tests (backend)

| File | Changes |
|---|---|
| New: `api/tests/test_findings_scope.py` | Cases: `all_cloud` excludes SCM; `source_control` includes both providers; mutual exclusion; legacy `github`/`gitlab`; unscoped still returns everything (regression baseline) |
| [`api/tests/test_findings_summary.py`](../api/tests/test_findings_summary.py) | Add `provider=all_cloud` / `source_control` summary tests |
| Export tests | CSV respects new params |

---

## Out of scope

- **Integrations connect UI:** keep separate GitHub and GitLab cards on catalog/hub ([`Integrations.tsx`](../web/src/pages/Integrations.tsx)); do not merge OAuth flows.
- **Backend deletion** of legacy `provider=github|gitlab` — keep for deep links and API compat.
- **Controls / History full org-level grading** across all cloud accounts (needs controls API design).
- **History** source-control timeline scope.
- **Changing** [`RECOMMENDED_INTEGRATION_TIER_1`](../web/src/lib/integrationCatalog.ts) (`["github", "gitlab"]`).
- **Scanner / identity** findings in All cloud scope (excluded by FK-based filter unless product revisits).
- **Bulk triage / recheck** behavior for org-level scopes (recheck remains AWS-account-bound).

---

## Implementation phases

### Phase 1 — Backend (ship first)

1. Add `_apply_findings_scope` with `provider=all_cloud` and `provider=source_control`.
2. Wire `GET /v1/findings` + tests.
3. Wire `GET /v1/findings/summary` + tests.
4. Wire `GET /v1/exports/findings.csv` (parity with list endpoint).

**Exit criteria:** API tests green; manual `curl` confirms SCM excluded from `all_cloud` and included in `source_control`.

### Phase 2 — Frontend Findings

1. Scope option builders + URL parsing in hooks.
2. Findings page wired to new params; default `all_cloud`.
3. Merged Source control row; trigger label **Source control**.
4. CSV export uses same scope params.
5. Remove client-side SCM provider filter when backend scope is active.

**Exit criteria:** Findings E2E — default load, switch scopes, export, deep link `?provider=github` still works.

### Phase 3 — Controls polish (optional)

1. Update Findings links from Controls to `provider=source_control`.
2. Evaluate All cloud in Controls dropdown after compliance API discussion.

### Parallel work

Phase 1 and Phase 2 can proceed in parallel **once param names and filter semantics are frozen**; frontend should feature-detect or flag-gate until backend is deployed.

---

## Test plan checklist

### Backend

- [ ] `GET /v1/findings?provider=all_cloud` returns AWS+GCP+Azure findings only
- [ ] Same request **excludes** `github.*` / `gitlab.*` with NULL cloud FKs
- [ ] `GET /v1/findings?provider=source_control` returns both GitHub and GitLab findings
- [ ] `provider=source_control` **excludes** cloud-scoped findings
- [ ] Legacy `provider=github` and `provider=gitlab` unchanged
- [ ] `provider=all_cloud` + `account_id` → 400
- [ ] Unscoped list still returns full org (regression — documents why UI must send explicit scope)
- [ ] Summary endpoint mirrors list filters
- [ ] Export CSV mirrors list filters for all scope modes
- [ ] Hidden / retired checks still filtered in all modes

### Frontend — Findings

- [ ] Dropdown order: All cloud accounts → cloud accounts → Source control (if connected)
- [ ] Default selection is All cloud accounts when ≥1 cloud account
- [ ] Trigger shows **All cloud accounts** / account name / **Source control** (never “GitHub” when Source control scope active, including legacy URL normalization)
- [ ] URL sync: switching scope updates `provider` / `account_id` correctly
- [ ] Scan button hidden for All cloud and Source control
- [ ] Export download respects active scope
- [ ] Empty states: cloud-only org, SCM-only org, both
- [ ] SessionStorage restore respects org-level sentinels

### Frontend — Controls (if in scope)

- [ ] “View findings” links use `provider=source_control` for mixed SCM checks
- [ ] Remediation hint copy acceptable for merged scope

### Regression

- [ ] Single-account scopes unchanged (AWS/GCP/Azure)
- [ ] Integrations page still shows separate GitHub and GitLab cards
- [ ] No change to connect/OAuth routes

---

## Open questions

1. **Controls / History dropdown:** Should **All cloud accounts** appear on Compliance and History in v1, or **Findings-only**? (Controls API is AWS-account-centric today.)
2. **Default when no cloud accounts:** If org has only Source control connected, confirm default = Source control (not empty All cloud).
3. **Legacy URLs:** Should `?provider=github` **display** as Source control in the trigger (recommended) while keeping the URL, or rewrite to `provider=source_control` on load?
4. **Dropdown grouping:** Pin org-level rows with a divider vs flat list with icons only — any design preference?
5. **Export route auth:** Findings export requires admin (`RequireAdmin`); scope work does not change that — confirm intentional.

---

## Key reference files

| Area | Path |
|---|---|
| Findings page scope UI | `web/src/pages/Findings.tsx` |
| Scope hooks / sentinels | `web/src/hooks/useConnectedAccountOptions.ts`, `web/src/hooks/useSelectedAccountId.ts` |
| Account picker UI | `web/src/components/AccountFilterDropdown.tsx`, `web/src/components/AccountSelect.tsx` |
| Findings fetch client | `web/src/lib/fetchAllFindings.ts` |
| Findings API | `api/app/routes/findings.py` |
| Findings export | `api/app/routes/exports.py` |
| Cloud vs SCM definitions | `api/app/services/cloud_normalization.py`, `api/app/checks/registry.py` |
| Controls (links only) | `web/src/pages/Controls.tsx` (`providerScopeForChecks`) |
| History (cloud only) | `web/src/pages/HistoryV2.tsx` |
| Integrations (out of scope) | `web/src/pages/Integrations.tsx`, `web/src/lib/integrationCatalog.ts` |
