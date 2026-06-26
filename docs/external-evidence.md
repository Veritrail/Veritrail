# External evidence

Veritrail treats customer-uploaded proof and declared external tools as first-class audit inputs — not a side note on failing AWS checks.

## Product rules

1. **Never silently fail** because the customer does not use Veritrail's preferred AWS source (Inspector, GuardDuty, etc.).
2. **Two paths** on every absence gap: upload external evidence **or** enable/fix the capability in AWS.
3. **Reviewer gate**: engineers submit; admins accept or reject before evidence counts as coverage.
4. **Integrity**: SHA-256 on uploads; optional ClamAV scan; signed download URLs; audit log on download.

## Where to work in the UI

| Surface | Purpose |
|---------|---------|
| **Compliance → Groups** | Upload/link proof per composite group; coverage dashboard; status filters |
| **Compliance → Detailed criteria** | Slide-over per criterion: gaps, evidence, upload, comments |
| **Workspace → Evidence** | Declare external tools per category (EDR, scanner, IdP, etc.) |
| **Settings → Notifications** | `evidence_renewal_email_enabled` for expiry/stale reminders |

## Evidence categories (registry)

Nine workspace categories map to compliance composites:

| Key | Label | Composites |
|-----|-------|------------|
| `identity_access` | Identity & access | `identity_governance` |
| `asset_inventory` | Asset inventory | `asset_inventory` |
| `secure_sdlc` | Secure SDLC | `secure_sdlc` |
| `change_management` | Change management | `change_management` |
| `data_protection` | Data protection | `data_protection` |
| `vulnerability_management` | Vulnerability management | `vulnerability_management`, `container_vulnerability_monitoring` |
| `logging_monitoring` | Logging & monitoring | `logging_monitoring` |
| `backup_resilience` | Backup & resilience | `backup_resilience` |
| `endpoint_security` | Endpoint security | `endpoint_security` |

Registry rows live in Postgres (`evidence_sources` table). Legacy `org.settings.evidence_sources` JSON is imported on first read.

## Lifecycle states

| Status | Meaning |
|--------|---------|
| `submitted` | Awaiting admin review |
| `accepted` | Counts toward external coverage |
| `rejected` | Does not count; engineer may re-upload |
| `superseded` | Replaced by a newer accepted artifact (`superseded_by`) |
| `expired` | Past `expires_at` (daily Celery task) |

**Coverage overrides** (`out_of_scope`, `not_applicable`) are set per composite via org settings and appear in the coverage dashboard.

## Comments vs review notes

- **Review notes** — one optional note when an admin accepts or rejects (decision record).
- **Comments** — thread on an artifact (`GET/POST /v1/controls/evidence/{id}/comments`) for back-and-forth between submitter and reviewer without re-uploading.

## API reference

```
GET    /v1/controls/evidence
POST   /v1/controls/evidence              multipart upload or external_url
GET    /v1/controls/evidence/{id}/download
PATCH  /v1/controls/evidence/{id}/review  { status, review_notes? }
DELETE /v1/controls/evidence/{id}
GET    /v1/controls/evidence/{id}/comments
POST   /v1/controls/evidence/{id}/comments  { body }
GET    /v1/controls/evidence-coverage
PATCH  /v1/settings                       { evidence_sources, coverage_overrides, notifications }
```

## Storage

| Variable | Purpose |
|----------|---------|
| `EVIDENCE_ARTIFACTS_S3_URI` | S3 prefix for uploaded files (local disk fallback) |
| `EVIDENCE_ARTIFACTS_DEFAULT_EXPIRY_DAYS` | Default `expires_at` on upload |
| `EVIDENCE_CLAMAV_ENABLED` | Optional INSTREAM scan before save |
| `EVIDENCE_VAULT_*` | Immutable pack copy on export — see [evidence-vault.md](./evidence-vault.md) |

## Audit pack contents

See [README](../README.md#evidence-pack). Key external-evidence files:

- `external-evidence/` — files + `manifest.json`
- `external_evidence_summary.json`
- `evidence_source_registry.json`
- `category_evidence_coverage.json` (as `evidence_coverage.json` category view in pack)

## Related docs

- [multi-cloud-collectors.md](./multi-cloud-collectors.md) — GCP/Azure phase-one collectors and scanner API sync
- [evidence-vault.md](./evidence-vault.md) — WORM / immutable archive for finalized packs
- [remediation.md](./remediation.md) — fixing findings in AWS (the other path)
