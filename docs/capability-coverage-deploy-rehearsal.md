# Capability coverage — deploy rehearsal

Staging checklist for capability coverage snapshots (migration `0100`) and the daily retention prune. Complements [evidence-coverage-production-hardening-spec.md](./evidence-coverage-production-hardening-spec.md) Phase D.

## Prerequisites

- Staging database restored from a **production-sized** logical copy (same major Postgres version as prod).
- App image/tag that includes migration `0100` and `CAPABILITY_SNAPSHOT_RETENTION_DAYS` (default **400**; **`0` = unlimited**, no prune).
- Compose prod profile available on the host (same path as `scripts/bootstrap-ec2.sh`).

Do **not** add a separate nginx reload step: `scripts/bootstrap-ec2.sh` already reloads nginx after api/web rebuild and force-recreates the nginx container afterward. Treat nginx reachability as a smoke assertion only.

## 1. Migration `0100` upgrade rehearsal

Run against the staging copy **before** promoting the same revision to production.

1. Record baseline revision and table presence:

   ```bash
   docker compose --profile prod exec -T api alembic current
   docker compose --profile prod exec -T db \
     psql -U hygiene -d hygiene -c "\d capability_coverage_snapshots"
   ```

   Expect: current revision is `0099` (or earlier than `0100`); table does not exist yet (or exists only if this rehearsal was already run).

2. Upgrade:

   ```bash
   docker compose --profile prod exec -T api alembic upgrade 0100
   ```

3. Verify:

   - `alembic current` reports `0100`.
   - `capability_coverage_snapshots` exists with `id`, `org_id`, `payload_json`, `taken_at` and indexes on `org_id` / `taken_at`.
   - New nullable-safe columns on cloud evidence tables are present (`inspector_account_status.lambda_code_enabled`, `code_repository_enabled`, `evidence_json`; `gcp_osconfig_vuln.evidence_json`; `gcp_security_command_center.evidence_json`; `azure_defender_status.evidence_json`).
   - Wall-clock duration on the production-sized copy is acceptable for the maintenance window (note duration in the change ticket).

4. Optional load check: trigger one org capability sync (or insert a sample snapshot row) and confirm a row appears with a recent `taken_at`.

## 2. Deploy smoke (after recreate)

After deploy / `compose up -d --force-recreate` of api (and related services as usual):

| Check | Pass criteria |
| --- | --- |
| API health | `GET /health` (or the env’s health path) returns 200 through the public host |
| Nginx routing | App origin serves the SPA; `/v1/...` reaches the API (no upstream 502 after recreate) |
| Controls | Authenticated `GET` Controls / capability coverage payload returns 200 with lane structures |
| Audit export | Recreate an evidence / audit export for a test org; download succeeds and capability lane verdict fields are present |

Confirm beat is scheduled: Celery beat includes `prune-capability-coverage-snapshots` → `app.worker.tasks.prune_capability_coverage_snapshots` (daily 05:30 UTC). A manual `prune_capability_coverage_snapshots.delay()` in a staging shell should return `deleted` / `oldest_retained_at` / `retention_days` without error.

Retention does **not** touch immutable evidence-vault artifacts; those remain under separate vault policies.

## 3. Expand / contract and rollback for `capability_coverage_snapshots`

Migration `0100` is an **expand** step for this table: it **creates** `capability_coverage_snapshots` and adds columns on existing cloud evidence tables. It does not rewrite historical finding rows.

| Direction | Guidance |
| --- | --- |
| Forward (`upgrade 0100`) | Safe additive create/add-column with server defaults. Rehearse on a prod-sized copy first (section 1). |
| Rollback (`downgrade 0100`) | Drops `capability_coverage_snapshots` and the new evidence columns. **Data loss** for any snapshots written after upgrade. Only acceptable before production traffic has relied on snapshot history, or after an explicit backup/restore plan. |
| App rollback without DB downgrade | Prefer leaving revision `0100` applied and rolling back the application image only if the older image tolerates the extra table/columns (unused table is fine). Avoid `alembic downgrade` on production once snapshots are retained for auditors. |
| Contract later | A future migration may drop unused columns only after all running app versions stop reading them. Do not contract in the same release as the expand. |

If retention must be paused during an incident, set `CAPABILITY_SNAPSHOT_RETENTION_DAYS=0` (unlimited) and redeploy/restart workers; the prune task becomes a no-op until a positive day count is restored.
