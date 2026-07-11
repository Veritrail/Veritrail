# Open work

**Single running list — everything else from prior specs shipped and those docs were removed.**
Add new items here going forward instead of opening new spec files, unless something is big
enough to need its own detailed design doc.

Status key: **done** · **open** · **blocked**

**Next up:** items **2 + 3** together (shared Workspace/Profile template restyle). Do not start
item 5 until 2–4 land. Item 6 is partner/human validation, not engineering.

Deep-research report mapping (composer backlog + human decisions):
[deep-research-roadmap.md](./deep-research-roadmap.md) — **composer buildable items shipped**
(§2.1–§2.12). Remaining: §3 human decisions + #11 GRC adapter (blocked on item 6).

---

## 1. Bug — account drill-down shows org-wide blockers, not account-scoped — **done**

`/accounts?account_id=<aws account>` — "What's blocking this account" was listing org-wide items
(GCP, GitHub) under the wrong cloud account.

**Evidence (dev + working tree):** `findingMatchesAccountRow` filters by provider + account id;
`accountBlockerFindings` feeds `AccountReadinessOverview` (same grouping/ranking as org home,
scoped down). Shipped in `dca641dd`. Intact under parallel Accounts.tsx WIP.

## 2. Workspace page — old design, never restyled — **open**

`/workspace` still uses the pre-redesign **structure**: 4-cell KPI strip
(`workspace-summary` / `PostureMetricCell`) + 2×2 `OverviewActionCard` grid + readiness panel.
Doesn't match Findings/History/Accounts (pill selector cards, denser tables, org-home summary).

**Note:** multi-color left borders are gone — tone variants (`blue`/`green`/`violet`/`amber`)
already collapse to teal accents via `--overview-accent` / `--vt-border` / `--vt-shadow-card`.
Remaining work is structural restyle to the current system, not a color pass.

## 3. Profile page — same old design, shares a template with Workspace — **open**

`/profile` (`Account.tsx`) imports `OverviewActionCard`, `PostureMetricCell`,
`PostureReadinessCell`, `ReadinessChecklistPanel` from `Workspace.tsx` and the same
`workspace-page.css`. Fix once with item 2 — don't design separately.

## 4. Integrations hub — visual restyle — **open** (troubleshoot panel shipped)

`/integrations` — table clip fix verified; cloud troubleshoot panel + scan-failure messaging
shipped (`CloudIntegrationTroubleshootPanel`). Page still reuses Workspace KPI strip
(`integrations-kpi-strip workspace-summary`) and a denser/plainer table than Findings.
Restyle to match current system — consider dropping the top stat row vs. an org-home-style
summary.

## 5. Findings page — minor tablet reflow at ~1024px — **open**

Account/Benchmark/Status selector cards wrap to a second row before reaching Status; severity
filter chips get a horizontal scrollbar; finding titles truncate harder. Partial tablet CSS
exists in `findings-overrides.css` / `findings-v2.css`, but the ~1024px toolbar squeeze remains.
Not broken — low priority; do after items 2–4.

## 6. GRC feed push validation — human action, not code — **blocked**

One binary test: push one Veritrail evidence artifact → one SOC 2 control on Vanta or Drata,
confirm it attaches/is auditor-visible/counts/supersedes idempotently. Needs a design-partner
customer's API key (fastest) or Drata's free no-CC trial — no self-serve signup on either.
**Decision gate:** push works → build the destination adapter. Push weak/gated → ship
export-only (GRC-ready ZIP + upload instructions). Do not build the adapter before this test.
Reference: `docs/grc-feed-validation.md`, `docs/grc-feed-api-runbook.md` (API details, still
current, kept as reference docs — not merged here since they're research, not a build spec).

---

## Recently shipped on `dev` (not tracked above)

- Org readiness home v4, accounts redesign, sidebar rename (Accounts → Home)
- Design-language drift fixes from design-consistency audit
- GCP/Azure resource type labels on Findings
- Per-resource evidence in Resources tab why column
- Verify fix for org-scoped GitHub/GitLab findings
- Org readiness Review links scoped to org-wide findings
- Account-scoped blockers + `AccountReadinessOverview` on account drill-down
- Cloud integration troubleshoot panel + scan-failure messaging
- Deep-research P0: evidence pack integrity UI + auditor verify affordance (§2.1)
- Deep-research P0: control-mapping "supports" phrasing + copy lint (§2.2)
- Deep-research P0–P2: write-remediation backend/infra retirement (§2.3); scheduled evidence
  exports (§2.4); control-coverage blocker weighting (§2.5); findings scale pass (§2.9);
  activation metric (§2.10); golden sandbox regression (§2.11); integration scope docs (§2.12)
- Deep-research rejections: ExternalId rotation (§2.6), OCSF export (§2.7), GDPR Art. 32
  mapping (§2.8) — removed from product; ISO / SOC 2 / CIS and initial ExternalId on connect kept
- Audit readiness page — auditor-language narrative (§8; shared PDF narrative builder)

## 7. History page — reframe from event log to control-timeline evidence — **open** (spec)

**Problem:** the History page is a flat event feed (Resolved / Reopened / Regressed rows). It answers
"what changed" but not "what does this prove," so it competes with — and loses to — Findings
(what's broken now) and Compliance (are we covered). Users barely open it. Worse, it shows churn: the
same 3–4 findings flapping Resolved→Reopened→Resolved fill the list with noise (e.g. Root MFA appears
4× in 30 days).

**Thesis:** History's real, unique job for an evidence company is **continuous-compliance proof over
the audit period** — "was this control in place the whole time, or fixed the week before the audit?"
No screenshot-based competitor can auto-produce that. Rebuild around control timelines + collapse
churn.

**Good news — backend already computes this.** `build_control_history`
(`api/app/services/compliance_timeline.py:40`, exposed at `GET /v1/controls/.../control-history`)
already returns, per control: **status segments over time** (passing/failing spans with
`from`/`to`/`duration_seconds`), `failing_since`, and current status. This is the audit-period
timeline data. The frontend just doesn't render it — it renders the event feed
(`build_compliance_timeline`) instead. **So this is primarily a frontend reshape, not a backend
build.** Confirm `control-history` is reachable org-wide / per selected framework; extend if it's
account-only.

### Primary reader: the customer's auditor first, engineer second
Lead with the audit-period view. It may also belong in the **auditor portal**, not only the main app
(decide during build — at minimum the main-app History adopts it).

### A. Control-timeline view (new default)
Replace the flat table's default with **one row per control**, each showing a horizontal timeline bar
across the selected period:
- Green spans = passing, red spans = failing, grey = no data — from `control-history` segments.
- Right-side summary: current status + "failing since {date}" or "passing {N} days".
- Example a reader immediately understands: *"CC6.6 — failing Jun 26–30, remediated Jul 1, passing
  since."*
- Group rows by capability domain (same grouping as Compliance page) so it reads like the audit
  evidence it is.
- Click a control row → drill into its findings/events (the current detailed feed, scoped to that
  control) — keep the event feed, demote it to a drill-down, don't delete it.

### B. Collapse churn (applies to the event feed wherever it still shows)
- Collapse repeat flaps of the same finding into one row: "Root MFA — flapped 4× in 30d, now
  resolved," expandable to the individual events.
- Default the event filter to **material** changes only: first-time regressions (newly failing) and
  first-time resolutions — not every nightly re-detection. Add a "show all activity" toggle for the
  raw feed (power users / debugging).

### C. Reframe rows around readiness, not raw findings
- Each event's headline = its effect on readiness, not the check label: "Regressed — Backup &
  Recovery dropped below passing" over "IAM account — no longer detected."
- Keep the control id, but as secondary metadata, not the primary column.

### Acceptance
1. History defaults to a per-control timeline (green/red spans over the period), grouped by capability
   domain, driven by `control-history` segments — not the flat event feed.
2. An auditor can see, per control, whether it held across the whole period and exactly when any gap
   opened/closed.
3. Repeated flaps of one finding collapse to a single row; the default view shows material changes,
   with an opt-in "all activity" toggle.
4. The raw event feed still exists as a per-control drill-down — nothing lost, just demoted.
5. No backend timeline recomputation added unless `control-history` proves account-only and needs an
   org-wide/framework-wide variant (extend, don't rebuild).

### Open question for build
- Does the timeline live **only** in the main app, or is it (also) promoted into the auditor portal?
  Recommend: build in main-app History now; mirror into the auditor portal as a fast follow, since
  that's where the audit-period question is actually asked.

## 8. New page: "Audit readiness" (auditor-language evidence narrative) — **done**

**Evidence (dev):** `GET /v1/audit-readiness`, shared narrative builder extracted from
`pdf_narrative.py` (`audit_readiness.py`), and `AuditReadiness.tsx` route + nav. Shipped in
`89f51588`.

## 9. Gap — check-less human criteria (CC7.4, A1.3, CC7.5, A1.1) can't receive external evidence — **open** (spec)

**Correction to an earlier verbal claim:** I said the runbook could already be attached to CC7.4 /
A1.3. That was wrong for these specific criteria. Backend + model + upload modal *do* support
control-level tagging — but the **UI never offers a check-less criterion as an upload target**, so
they're unreachable.

**Root cause (verified in code + data):**
- `control_mappings.json`: **CC7.4** (incident response), **A1.3** (DR test), **CC7.5** (recovery),
  **A1.1** (capacity) each have **0 automated checks** — they are purely human/external evidence.
- `underlyingCriteriaForComposite` (`web/src/pages/Controls.tsx:1234`) builds the per-criterion list
  by intersecting a composite's `check_ids` with each control's `check_ids`. A criterion with no
  checks never matches → excluded.
- `ExternalEvidencePanel` (`web/src/components/ExternalEvidencePanel.tsx:106`) builds its control
  picker **only** from `underlyingCriteria`. No "browse all framework controls" fallback exists.
- Net: CC7.4 / A1.3 / CC7.5 / A1.1 appear in no composite drill-down and in no upload picker. The
  runbook + DR-test photos have nowhere to attach, even though `EvidenceArtifact.control_id`,
  the upload route, and `CriterionEvidenceUploadModal` all support it.

**Deeper question to confirm during build:** do these check-less criteria render **anywhere** on the
Compliance page today? Composite membership is derived from checks, so a 0-check criterion may be
orphaned entirely (not shown, not gradeable, not attachable). If so, they're invisible — worse than
just un-attachable.

**Fix (frontend-led, backend already supports it):**
1. Surface check-less framework criteria as **upload targets**. Two options:
   - (a) Loosen `underlyingCriteriaForComposite` / the picker to also include criteria that map to the
     composite's framework controls even with 0 checks (needs a control→composite mapping that isn't
     check-derived — may require a small backend/data addition since composite membership is
     currently check-based); OR
   - (b) Add a dedicated **"Manual controls"** section on the Compliance page (or in the audit-readiness
     page, item 8) listing all framework criteria with 0 automated checks — each with an "Attach
     evidence" action → the existing `CriterionEvidenceUploadModal` with that `control_id`. This is
     the cleaner option and reuses the shipped upload flow verbatim.
2. Such criteria grade as **needs_evidence** until accepted external evidence is attached, then
   **externally_covered** — same state machine as the external-only categories.
3. Auditor-visible: the attached runbook/photos show on that criterion and in the evidence pack under
   CC7.4 / A1.3.

**Acceptance:**
1. CC7.4, A1.3, CC7.5, A1.1 are visible on the Compliance (or audit-readiness) page as manual criteria.
2. Each offers "Attach evidence" → uploads tagged to that exact `control_id`.
3. Attaching accepted evidence flips the criterion to externally_covered and surfaces it in the
   evidence pack under that control.
4. Confirms/closes the orphaned-criterion question (they must render somewhere, not vanish).

**Priority:** high for the audit-readiness story — this is the exact use case (hand-written IR/DR
runbook + test photos) that a real customer already has and can't currently file. Relates to item 8
(the external-attach state) and item 4 of the SOC 2 map (EXTERNAL criteria).

## 10. Audit-readiness page — auditor technical playbooks — **done**

**Evidence (dev):** the API now returns a closed auditor technical-playbook registry rather than
expanding raw mapped checks. The page asks concise outcome questions for DR, vulnerability
management, logging and monitoring, identity and access, encryption and data protection, network
boundaries, and change/deployment controls. Rows show Verified / Action needed / inventory-backed
N/A, cap actions at the top three applicable priorities, and keep SOC 2 mapping secondary.
Questionnaire/PDF narrative remains separate behind copy/expand and in the evidence export.

**Scope correction:** policy documents, runbooks, recovery exercises, and other manual evidence are
explicitly outside this automated checklist and are never presented as verified. Inspector is shown
only when EC2/ECS/EKS/ECR workload inventory makes it applicable; DR checks become N/A when no
supported stateful resource is present.

The page shipped (item 8) with correct **data** but wrong **presentation**: each domain is a wall of
narrative prose, stacked as another wall below, and the whole thing is centered in a narrow column
with a large empty left gutter. Ellie's intent is a **scannable checklist** — per capability, the
concrete services/actions and what control they map to — not paragraphs.

### The data for a checklist already exists — stop collapsing it into a paragraph
`api/app/services/audit_readiness.py` + `pdf_narrative.py` already compute per domain:
`verified_phrases` (what each passing check proves), gap findings, `named_sources` (which
accounts/repos), `check_ids`, control tags, and the absence-gap service registry
(`web/src/lib/evidenceGap.ts`) is available client-side. The paragraph (`assertion_text`) is a
join of these — render the parts as rows instead.

### A. Replace the assertion paragraph with checklist rows
Each domain card becomes a header (title + status pill) + a **list of check rows**, one per
capability/service. Three row types, visually distinct:
- **Verified** (green check): "VPC Flow Logs enabled — accounts amit-shemesh-clc" · maps to
  `CC7.2`. Source named inline (which accounts/repos). Built from `verified_phrases` +
  `named_sources` + control tags.
- **Action / enable** (amber, actionable): "GuardDuty not enabled — **Activate**" · maps to
  `CC6.6`. For absence-gap checks (off services), the row's action is a direct enable link
  (`ABSENCE_GAP_CONSOLE_URL`). For non-absence failing checks: "**Review**" → findings.
- **Not applicable** (muted): "Container image scanning — N/A (no container resources)". See §C.

Show the control mapping **per row** (which CC/ISO the item satisfies), not just a tag cloud at the
bottom — that's the "corresponds to" Ellie wants ("these services active → this control met").

### B. Keep the narrative — demote it
The auditor-prose paragraph is genuinely useful for pasting into questionnaires. Keep it behind the
existing **"Copy for questionnaire"** action (and in the PDF). It is not the primary on-screen
content. Optionally a small "Show auditor narrative" expander per domain.

### C. Auto not-applicable when no relevant resources exist
Ellie: "ignore DR if no resources that use it are available." If a domain's checks have **no
in-scope resources** in the environment (e.g. no containers → container scanning; no RDS → DB
backup checks), render the domain/row as **Not applicable — no {resource} in scope**, auto-detected,
and exclude it from the readiness rollup. Distinct from the user-marked N/A (item 8-C) — this one is
automatic from resource inventory. Backend likely needs a per-domain "has in-scope resources" signal
(derive from whether any resource of the relevant type was collected in the last scan); confirm and
add if missing.

### D. Fix the layout (the visible bug)
Content renders in a narrow centered column with a large empty left gutter (see screenshot).
`audit-readiness-page.css` — make the page **full-width, left-aligned**, matching the org-home /
Compliance content width and gutters. No centered narrow column, no empty left band. Cards span the
content area; text left-aligned; comfortable max line length via padding, not by centering a skinny
column.

### E. Row density
Checklist should scan fast: single-line rows where possible (icon + capability + source + control +
action), wrapping only when needed. This is a checklist, not an essay — the reader skims for red
rows (activate these) and green rows (proven).

### Acceptance
1. Each domain shows a checklist of rows (verified / action-enable / N/A), not a prose paragraph.
2. Absence-gap "off" services show an **Activate** action with the exact service + the control it
   satisfies; failing checks show Review.
3. Each row states which control(s) it maps to.
4. Domains/rows with no in-scope resources auto-render as Not applicable and drop from the rollup.
5. The auditor narrative survives as "Copy for questionnaire" + PDF, not as the primary UI.
6. Layout is full-width and left-aligned — no centered skinny column, no empty left gutter.

**Note:** ~80% frontend reshape (render existing fields as rows + CSS). Backend additions likely
limited to: per-domain "has in-scope resources" flag (§C) and, optionally, a structured
`checklist_items[]` per domain so page and PDF share one shape (recommended — keeps them from
diverging, same principle as item 8).

## 11. Remove account switcher from the sidebar rail → pure nav (org-first) — **done**

**Evidence (dev):** `SidebarAccountSwitcher` removed from `Layout.tsx`; rail is brand → nav → user
card only. "All accounts (N)" rehomed to org-home header slot; "+ Add account" remains on the
management list and Integrations connect flows. Orphaned `sidebar-accounts*` CSS deleted. Shipped in
`4b274870`.
