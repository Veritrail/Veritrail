# Evidence vault (WORM / immutable archive)

## Where WORM should live

WORM is **not** a feature inside the Postgres database or the downloadable ZIP alone. It is **object storage with Object Lock** (or an equivalent immutable store) written **once** when an evidence pack is finalized.

```
Scan → findings DB → build ZIP (+ checksum + optional signature)
                          ↓
              [evidence vault — optional, EVIDENCE_VAULT_ENABLED]
                          ↓
         S3 object (Object Lock) + auditor read reference
```

### Option A — Veritrail-operated vault (default env target)

- **Bucket:** your account, `EVIDENCE_VAULT_S3_URI=s3://veritrail-evidence-vault/prod/`
- **WORM:** S3 Object Lock (Compliance or Governance mode) + retention days
- **Pros:** One-click for customers; auditors get a stable **object key** per export (`report_id`), not a mutable file.
- **Cons:** You operate retention, cost, and legal hold; data leaves customer AWS.

### Option B — Customer-owned bucket (enterprise)

- Customer creates a bucket with Object Lock; scan role gets **write-only** `PutObject` to `s3://customer-bucket/veritrail/{org_id}/…`
- **Pros:** Data residency; customer owns immutability.
- **Cons:** CFN + policy work per account; harder onboarding.

### Option C — “Constant link” for auditors (usually **not** enough alone)

| Pattern | WORM? | Verdict |
|---------|-------|---------|
| Same HTTPS URL overwritten each week | No | Weak for Type II — auditor cannot prove what existed on sample date |
| New URL per export (`…/packs/{report_id}.zip`) | Only if bucket has Object Lock | Good **if** object is immutable |
| Presigned URL after customer clicks “Share with auditor” | Depends on object | Good **process**; pair with locked object + expiry on the URL, not on the object |
| Permanent public link | No | Do not use |

**Recommended auditor flow (product UI still open):**

1. Customer exports pack → Veritrail writes **immutable** object to vault S3 (`upload_pack_to_vault` from `build_evidence_pack`).
2. Customer **approves** an auditor (email/domain) in Settings → Veritrail mints a **time-limited** read token or presigned URL pointing at that **fixed** `s3_key` / `report_id` *(not built in UI yet; presign helper exists)*.
3. Auditor opens link → read-only GET; object behind it does not change.

The “constant link” is constant **per export** (per `report_id`), not one URL that always shows “latest”.

## S3 bucket policy (veritrail-worm-storage)

Object Lock must be enabled **when the bucket is created** (cannot add later). Then attach a bucket policy so only your Veritrail API principal can write immutable packs.

Example: [`infra/s3/evidence-vault-bucket-policy.json`](../infra/s3/evidence-vault-bucket-policy.json)

Replace `Principal.AWS` with your deploy role (not `root` in production). Required actions for the API: `s3:PutObject`, `s3:PutObjectRetention`, `s3:GetObject`, `s3:ListBucket`.

## Configuration

See `api/app/services/evidence_vault.py` and `.env.example`:

- `EVIDENCE_VAULT_ENABLED` — master switch (default off)
- `EVIDENCE_VAULT_S3_URI` — base location for vault writes, e.g. `s3://my-bucket/veritrail-evidence/`
- `EVIDENCE_VAULT_S3_REGION` — optional region override
- `EVIDENCE_VAULT_OBJECT_LOCK_MODE` — `GOVERNANCE` | `COMPLIANCE` (for future PutObject retention)
- `EVIDENCE_VAULT_RETENTION_DAYS` — retention hint for Object Lock
- `EVIDENCE_VAULT_AUDITOR_ACCESS_MODE` — `none` | `presigned` | `approved_link` (future)

Org-level override (future): `org.settings["evidence_vault"]["customer_s3_uri"]` for Option B.

## Implementation status

**Wired (opt-in)** — set `EVIDENCE_VAULT_ENABLED=true` and `EVIDENCE_VAULT_S3_URI`. On each evidence pack export:

- `plan_vault_upload()` builds object key from `report_id`
- `upload_pack_to_vault()` performs `PutObject` with Object Lock retention when configured
- ZIP includes `vault_upload_plan.json` and `vault_upload_result.json`
- `evidence_exports` rows store `report_id` and vault metadata when upload succeeds

**Not wired yet:** auditor approval UI, share records (`shared_with`), read-only viewer page. `EVIDENCE_VAULT_AUDITOR_ACCESS_MODE=presigned` can mint URLs from code paths that call `generate_presigned_get()` — no end-to-end “approve auditor → link” product flow.

Enable only after bucket Object Lock, IAM, and retention policy review.
