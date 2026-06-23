# Veritrail platform backup and restore runbook

_Last updated: 2026-06-07_

## Scope

This runbook covers the **Veritrail control plane** (Postgres findings, evidence history, org settings). Customer AWS data is not stored beyond scan snapshots in Postgres.

## Targets

| Metric | Target | Notes |
|--------|--------|-------|
| **RPO** (Recovery Point Objective) | 24 hours | Daily `pg_dump` minimum; hourly if SLA requires |
| **RTO** (Recovery Time Objective) | 4 hours | Restore + smoke test + DNS cutover |

## Backup procedure

1. Run nightly `pg_dump` from the production host (or sidecar cron):
   ```bash
   pg_dump -Fc -h localhost -U hygiene hygiene > veritrail-$(date +%F).dump
   ```
2. Copy dump to off-site storage (S3/B2) with versioning enabled.
3. Encrypt at rest (SSE-KMS or provider-native encryption).
4. Retain 30 daily + 12 monthly backups minimum.

## Verification

Run after every backup (automated or manual):

```bash
./scripts/verify-backup.sh veritrail-YYYY-MM-DD.dump
```

The script validates archive integrity via `pg_restore --list` without applying data.

## Restore test checklist (quarterly)

- [ ] Restore latest dump to an isolated staging Postgres instance
- [ ] Run `alembic upgrade head` if schema drift
- [ ] Smoke test: login, list findings, download evidence pack for one account
- [ ] Record restore duration and document in internal audit log
- [ ] Delete staging instance after sign-off

## Restore procedure (incident)

1. Stop API + worker to prevent writes during restore
2. Drop/recreate empty `hygiene` database (or new instance)
3. `pg_restore -d hygiene --no-owner --role=hygiene veritrail-YYYY-MM-DD.dump`
4. Verify row counts: `orgs`, `findings`, `aws_accounts`
5. Start API/worker; confirm `/healthz` and one authenticated scan read
6. Post-incident: rotate `JWT_SECRET` / `ENCRYPTION_KEY` only if dump may have leaked

## Monitoring

- Alert if backup job fails or dump file size drops >50% vs 7-day median
- Alert if backup age exceeds 26 hours

## Out of scope

- Customer CloudFormation connector redeploy (separate customer action)
- Evidence vault S3 Object Lock buckets (see `EVIDENCE_VAULT_*` env vars)
