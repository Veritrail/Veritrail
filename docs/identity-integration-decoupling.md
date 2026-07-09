# Decouple identity integrations from the cloud scan

**Spec / plan doc — mirrors the already-shipped source-control decoupling
(tasks #9–#12). Read `source_control_scan.py` + migration `0090` as the working template.**

## Problem

Entra and Google Workspace are **org-level integrations**, not cloud accounts. Today their
checks only run **inside the AWS account scan** — `scan_pipeline.py` builds `enabled_checks`
from `ALL_CHECKS` and calls `mod.run(db, account.id)`. So after an identity **sync**, findings
do **not** appear and compliance does **not** update until the user scans an unrelated AWS
account. Same bug we already fixed for git (source control runs on git sync, org-scoped, live
compliance).

Confirmed coupling: `api/app/worker/scan_pipeline.py:337-342` excludes only `gcp.` / `azure.` /
`is_source_control_check`. Identity integration checks fall through and run under the account scope.

## Goal

Identity integration checks run **on their integration sync**, persist **org-scoped**
(`account_id = NULL`), and update compliance **immediately** — no cloud scan required. Exactly like
source control.

## Scope — which checks move

Production identity platforms (org-level, NOT cloud accounts):

| Prefix | Checks | Sync service |
|---|---|---|
| `entra.` | org.mfa_not_enforced, admin.unreviewed, user.inactive_90d | `entra_sync.py` |
| `google_workspace.` | org.mfa_not_enforced, admin.unreviewed, user.inactive_90d | `google_workspace_sync.py` |

**Not in scope:** Intune and Jamf are not shipped as Veritrail integrations. Their checks
(`intune.*`, `jamf.*`) remain in the cloud scan path unchanged.

**Stays in the cloud scan — do NOT move:** `identity_center.*` (AWS IAM Identity Center — collected
via AWS APIs during the account scan, genuinely account/cloud-scoped).

Call this new domain **integration-synced org checks**:
```python
INTEGRATION_SYNC_PREFIXES = ("entra.", "google_workspace.")
```

## Tasks (each mirrors a shipped source-control task)

### 1. Registry helpers — `api/app/checks/registry.py`
Add alongside `SOURCE_CONTROL_*`:
```python
INTEGRATION_SYNC_PREFIXES = ("entra.", "google_workspace.")

def is_integration_sync_check(check_id: str) -> bool:
    return check_id.startswith(INTEGRATION_SYNC_PREFIXES)

INTEGRATION_SYNC_CHECKS = [m for m in ALL_CHECKS if is_integration_sync_check(m.CHECK_ID)]

def integration_sync_checks_for(provider_type: str) -> list:
    """Check modules for one provider type ('entra'|'google_workspace')."""
    prefix = f"{provider_type}."
    return [m for m in INTEGRATION_SYNC_CHECKS if m.CHECK_ID.startswith(prefix)]
```

### 2. Exclude from the cloud scan — `api/app/worker/scan_pipeline.py`
Import `is_integration_sync_check`; extend the `enabled_checks` filter so it also drops
`is_integration_sync_check(mod.CHECK_ID)`.

### 3. Runner — `api/app/services/integration_sync_scan.py`
Clone `run_source_control_checks` as `run_integration_checks(db, org_id, provider_type)`.
Use `integration_sync_checks_for`, `mod.run(db, org_id)`, `persist_org_findings`.

### 4. Wire checks for providers that exist

**Pattern (mirrors source control / `github_sync.py`):** run checks **once** in the sync
service after data is flushed and before commit — routes only call the sync function and
return stats. Do **not** also call `run_integration_checks` in the route or checks run twice.

| Trigger | Where checks run | Notes |
|---|---|---|
| Sync now (`POST …/sync`) | `entra_sync.py`, `google_workspace_sync.py` | After `db.flush()`, `run_integration_checks(db, provider.org_id, provider.type)` then `db.commit()` |

`provider.type` values: `entra_id`, `google_workspace`. Map to check-id prefixes via
`check_prefix_for_provider_type()` in `integration_sync_scan.py` (`entra_id` → `entra`).

### 5. Org-level grading + audit inclusion (NOT account views)
Add `org_integration_condition()` and fold into `with_source_control_for_audit` for compliance
grading and evidence pack. Special-case `is_integration_sync_check` in `composite_controls.py`.

### 6. Findings scope
Sentinel `scope:identity` + server-side `?provider=identity` in `findings_scope.py`.
Add "Identity & devices" to the account/scope selector.

### 7. Migration `0092`
Clone migration `0090`: for findings matching `INTEGRATION_SYNC_PREFIXES`, set `account_id = NULL`
and populate `org_id` from the former account's org.

### 8. Frontend invalidation
After successful Entra/Google Workspace sync, invalidate compliance + findings caches.

## Verification
1. Connect + sync Entra or Google Workspace.
2. Trigger **Sync now** — runs identity checks + persists org-scoped.
3. **No AWS scan.** Compliance → **Identity Governance & Access Review** grades from sync.
4. Findings → "Identity & devices" scope lists identity findings; not under AWS account scope.
5. `pytest api/tests/test_integration_sync_persist_isolation.py` — org isolation regression.

## Guardrails
- Use `persist_org_findings`, never `persist_findings(account_id=None)`.
- Org-level identity findings in **compliance grading + evidence pack**, excluded from **account views**.
- `identity_center.*` stays cloud-scoped.
- No Intune/Jamf in this decoupling — not shipped integrations.
