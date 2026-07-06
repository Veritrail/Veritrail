# Hardening — verified items only

Distilled from an external deep-research audit. **Only the items below were verified true against
the actual codebase.** The rest of that report was wrong or stale — see [Do NOT act on](#do-not-act-on-from-the-report)
at the bottom. **Spec only — no production code here.**

Priority: all three are **low-to-medium urgency hygiene**, not emergencies. Do them when convenient.

---

## 1. Bump FastAPI / Starlette

**Verified state:** `api/requirements.txt` pins `fastapi==0.115.0`; installed Starlette is **0.38.6**
(old). No confirmed active exploit — the CVE IDs the report cited were unverifiable / one was
fabricated — but 0.38 is stale and worth updating as routine maintenance, especially since the app
serves files via `StaticFiles` (see item 2).

**Do:**
- Bump `fastapi` to a current release (which pulls a current Starlette) in `api/requirements.txt`.
  Pin explicitly (both `fastapi` and, if listed, `starlette`) so the lock is deterministic.
- Rebuild the API container.
- Run the full backend test suite (`pytest`) — FastAPI minor bumps occasionally shift Pydantic/
  response-model behavior. Fix any breakage before merging.
- Re-run the app locally; smoke-test auth + a findings request.

**Acceptance:** tests green, app boots, `python -c "import starlette; print(starlette.__version__)"`
shows the new version.

**Not required:** chasing specific CVE numbers from the report (see bottom). This is a version-hygiene
bump, framed honestly.

---

## 2. Harden the evidence-upload path

**Verified state:**
- `api/app/main.py:152` mounts `/uploads` via `StaticFiles(directory=LOCAL_UPLOAD_DIR)` — anything
  written to that dir is publicly servable by path.
- The writer is the evidence upload endpoint at `api/app/routes/settings.py:680`
  (`file: UploadFile = File(...)`).

**Risk:** without server-side validation, a user could upload active content (HTML/SVG/JS) that then
serves from the app origin, or an oversized file. Low likelihood (auth-gated, evidence use), but cheap
to close.

**Do (at the upload endpoint, `settings.py:680` — validate before writing to `_upload_root`):**
- **Allowlist content types / extensions** — evidence is documents/images. Accept e.g.
  `pdf, png, jpg, jpeg, csv, txt, json` (confirm the real set the product expects); reject others with 400.
  Validate the actual bytes / declared `content_type`, not just the filename.
- **Cap file size** — reject over a sane limit (e.g. 25 MB; confirm product need). Stream-check size
  rather than loading the whole file into memory.
- **Sanitize the stored filename** — no path separators / traversal; generate a safe stored name
  (uuid + validated extension), don't trust the client filename.

**Optional (defensive, lower priority):**
- Serve `/uploads` with `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` so files
  download rather than render inline in the app origin.

**Acceptance:** uploading a `.html`/`.exe` → 400; oversized file → 400; a valid PDF still uploads and
downloads; stored filename can't escape `_upload_root`.

---

## 3. Add findings DB indexes

**Verified state:** the `findings` table has **only `findings_pkey`** — no index on the columns the
list/summary endpoints filter and sort by. Real perf gap as data grows (fine at current volume).

**Query shape (verified, `api/app/routes/findings.py` list route):**
- Filters: `org_id` (always), then one scope (`account_id` / `gcp_project_id` / `azure_subscription_id`,
  or org-level `account_id IS NULL` for source control), `status`, sometimes `severity` / `check_id`.
- Order + cursor: `ORDER BY risk_score DESC, id DESC` (keyset pagination on `(risk_score, id)`).
- The org-level cloud/source-control scopes also filter on `gcp_project_id` / `azure_subscription_id`
  NULL-ness and `check_id LIKE 'github.%'|'gitlab.%'`.

**Do (new Alembic migration — next number is `0091`, after `0090_source_control_findings_org_scoped.py`):**
- Add a composite index matching the dominant access pattern, e.g.:
  - `(org_id, account_id, status, risk_score DESC, id DESC)` — the per-account list + pagination path.
  - Plus `(org_id, status, risk_score DESC, id DESC)` for the org-wide/`all_cloud` path where
    `account_id` isn't the filter.
- Confirm column names against `api/app/models/finding.py` before writing the migration.
- Keep it to 1–2 well-chosen composite indexes — don't index every column; each index costs write time.
- `downgrade()` drops them.

**Acceptance:** migration applies + reverts cleanly; `\d findings` shows the new indexes;
`EXPLAIN` on the findings list query uses an index scan instead of a seq scan. All tests still pass.

**Urgency:** low — this is a scale-ahead optimization, not a current bug.

---

## Do NOT act on (from the report)

These were verified **false, already-handled, or stale** — ignore them:

- **"Critical: default `dev-secret` / `dev-jwt` lets attackers forge JWTs."** FALSE. `api/app/core/config.py:186` (`_validate_secrets_not_default`) already **raises on startup in any non-dev env** if the dev defaults are used. Production can't boot with them. The report's proposed fix already exists.
- **`CVE-2026-47410`** — fabricated (future-dated, no such advisory). The specific Starlette CVEs cited are unverified; treat the "actively exploitable" framing as noise. Item 1 covers the real (hygiene) action.
- **Frontend UX section (move account selector into the header).** Stale — already done; the selector lives in `HeaderFilterBar` via `HeaderSlot`. It also references `AccountPicker.tsx`, which doesn't exist (real components are `AccountFilterDropdown` / `AccountSelect`). Skip entirely.
- **CORS** — the report itself confirms it's safe (`CORS_ORIGINS=""`). No action.
- **Generic ops boilerplate** (Sentry, pip-audit/Dependabot, prod TLS/HSTS, off-host `pg_dump`) — reasonable someday, but unverified against current infra and out of scope for this pass. Decide separately, not from this report.
