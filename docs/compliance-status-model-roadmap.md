# Compliance status model — roadmap / follow-ups

Context for the severity-graded control status + cross-account coverage work
(commit `ba63b5f`). Captures what's intentionally left for later so we can pick
it up without re-deriving the reasoning.

## Phase 5 — PDF / audit package graded model (done)

The status model grades controls as **fail / at_risk / pass / no_data**
(`api/app/services/control_status.py`). The UI and **PDF audit package** both honor
all four. See `api/app/services/pdf_report.py`:

- `_STATUS` map includes `at_risk` (amber pill)
- Pass-rate rollups count `at_risk` in evaluated controls
- **Priority Review** section (`_draw_top_controls`) lists fail + at_risk controls
- **Exception Register** section: per-control severity columns, oldest finding age,
  approved exception narratives

Implemented in Phase 1 of [implementation-pipeline.md](./implementation-pipeline.md).

## Flagged categorization calls (awaiting a decision)

In `api/data/composite_controls.json`:

- `cloudtrail.trail.s3_bucket_public` — currently under **Logging & Monitoring**.
  It's a public-exposure issue (the trail's log bucket is public). Move to
  **Data Protection** (like `s3.bucket.public_access_not_blocked`), or keep it
  as a logging-integrity concern?
- `cloudtrail.event.kms_key_disabled_or_deleted` — mapped to **both** Data
  Protection and Logging & Monitoring, so it double-counts. Intentional
  cross-mapping, or dedupe to one?

(`cloudtrail.trail.no_kms` was already moved to Data Protection.)

## Cross-account verification — stronger phase (optional)

`cross_account_coverage` auto-verifies by reading the referenced account's own
scan (the capability's checks ran and are clean there). That's solid, but does
**not** confirm true AWS Organizations **delegated-admin topology** (that
account B is the delegated admin *for A's org*). A stronger version would call
`organizations:ListDelegatedAdministrators` / `DescribeOrganization` during the
scan to assert the org relationship. Needs Organizations read perms on the scan
role + new collector logic.

Related: `api/app/collectors/access_analyzer.py` already detects an org-level
analyzer from the admin account; CloudTrail org trails and GuardDuty / Config /
Security Hub delegated-admin coverage are detected from the member account.
