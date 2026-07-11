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

## 11. Remove account switcher from the sidebar rail → pure nav (org-first) — **done**

**Evidence (dev):** `SidebarAccountSwitcher` removed from `Layout.tsx`; rail is brand → nav → user
card only. "All accounts (N)" rehomed to org-home header slot; "+ Add account" remains on the
management list and Integrations connect flows. Orphaned `sidebar-accounts*` CSS deleted. Shipped in
`4b274870`.
