# Compliance status model — roadmap / follow-ups

Context for the severity-graded control status + cross-account coverage work
(commit `ba63b5f`). Captures what's intentionally left for later so we can pick
it up without re-deriving the reasoning.

## Phase 5 — PDF / audit package graded model (NOT done)

The status model now grades controls as **fail / at_risk / pass / no_data**
(`api/app/services/control_status.py`). The UI honors all four. The **PDF audit
package does not yet** — `at_risk` falls through to a neutral "No Data" style.

Where to update (`api/app/services/pdf_report.py`):

- `_STATUS` map (~line 61): add an `at_risk` entry (label "At risk", amber
  fill/border) so the control pill renders correctly instead of defaulting.
- The pass/fail rollups that ignore `at_risk`:
  - `passed = sum(... status == "pass")` (~815) — at_risk is not "passing".
  - `review = [... status == "fail"]` (~259) — decide whether at_risk controls
    belong in the review/exception section.
- Add a **severity / exception register**: per control, show open findings by
  severity (`severity_counts` is already on each composite) + remediation SLA,
  so the report reflects materiality, not a binary pass/fail.

Goal: the audit package mirrors the app — graded status + open exceptions by
severity, not "controls failing."

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
