# Open work

**Single running list — everything else from prior specs shipped and those docs were removed.**
Add new items here going forward instead of opening new spec files, unless something is big
enough to need its own detailed design doc.

Status key: **done** · **open** · **blocked**

**Next up:** items **2 + 3** together (shared Workspace/Profile template restyle). Do not start
item 5 until 2–4 land. Item 6 is partner/human validation, not engineering.

Deep-research report mapping (composer backlog + human decisions):
[deep-research-roadmap.md](./deep-research-roadmap.md) — **composer buildable items shipped**
(§2.1–§2.12). Remaining: §3 human decisions + GRC destination adapter (blocked on item 6;
not numbered here).

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
- §10 audit-readiness technical playbooks and inventory-backed applicability
- §11 pure-nav sidebar rail and duplicate org-home account-header cleanup
- §12 full-width org home with blocker, recommended-action, and timeline cards

## 7. History page — reframe from event log to control-timeline evidence — **done**

**Problem:** the History page is a flat event feed (Resolved / Reopened / Regressed rows). It answers
"what changed" but not "what does this prove," so it competes with — and loses to — Findings
(what's broken now) and Compliance (are we covered). Users barely open it. Worse, it shows churn: the
same 3–4 findings flapping Resolved→Reopened→Resolved fill the list with noise (e.g. Root MFA appears
4× in 30 days).

**Thesis:** History's real, unique job for an evidence company is **continuous-compliance proof over
the audit period** — "was this control in place the whole time, or fixed the week before the audit?"
No screenshot-based competitor can auto-produce that. Rebuild around control timelines + collapse
churn.

**Partial backend exists, but it is account-only.** `build_control_history`
(`api/app/services/compliance_timeline.py:40`, exposed at
`GET /v1/controls/{control_id}/history?framework=…&account_id=…`) returns, for one AWS account and
one control, **status segments over time** (`from`/`to`/`duration_seconds`), `failing_since`,
current status, and raw events. History currently calls the separate account-scoped
`compliance-timeline` feed and renders its events. The build therefore needs a framework-wide
timeline response (and an explicit org aggregation rule if Home/History remains org-first), then a
frontend reshape; do not recompute segment semantics in the browser.

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
5. Extend the existing segment builder into an efficient framework-wide response; decide whether
   multi-account org history merges account segments or remains explicitly account-selected.

### Open question for build
- Does the timeline live **only** in the main app, or is it (also) promoted into the auditor portal?
  Recommend: build in main-app History now; mirror into the auditor portal as a fast follow, since
  that's where the audit-period question is actually asked.

## 8. New page: "Audit readiness" (auditor-language evidence narrative) — **done**

**Evidence (dev):** `GET /v1/audit-readiness`, shared narrative builder extracted from
`pdf_narrative.py` (`audit_readiness.py`), and `AuditReadiness.tsx` route + nav. Shipped in
`89f51588`.

## 9. Gap — check-less human criteria (CC7.4, A1.3, CC7.5, A1.1) can't receive external evidence — **open** (spec)

**Correction to an earlier verbal claim:** the runbook cannot currently be attached from CC7.4 /
A1.3. Backend + model + upload modal support control-level tagging, and these criteria now appear in
the secondary **All controls** view as manual-attestation rows. However, their detail panel suppresses
the evidence section when `check_ids` is empty, and they remain absent from the default composite
view and its upload picker.

**Root cause (verified in code + data):**
- `control_mappings.json`: **CC7.4** (incident response), **A1.3** (DR test), **CC7.5** (recovery),
  **A1.1** (capacity) each have **0 automated checks** — they are purely human/external evidence.
- `underlyingCriteriaForComposite` (`web/src/pages/Controls.tsx`) builds the per-criterion list
  by intersecting a composite's `check_ids` with each control's `check_ids`. A criterion with no
  checks never matches → excluded.
- `ExternalEvidencePanel` (`web/src/components/ExternalEvidencePanel.tsx`) builds its control
  picker **only** from `underlyingCriteria`. No "browse all framework controls" fallback exists.
- `buildDetailedTabs` renders `ManualAttestation` for check-less controls but gates
  `ControlEvidenceTabContent` behind `check_ids.length > 0`, even though that component already
  launches `CriterionEvidenceUploadModal` with the exact control UUID.
- Manual status currently comes only from `ControlAttestation`; accepted control-tagged evidence is
  not joined into the manual criterion's status. Net: the criteria are visible only in the detailed
  catalog, but runbooks/photos still cannot be uploaded there and accepted evidence cannot produce
  `externally_covered`.

**Fix (frontend-led, backend already supports it):**
1. Make the existing manual rows first-class in the default Compliance experience (or add a
   dedicated **Manual controls** section), and render their existing control-level evidence content
   and upload modal even when `check_ids` is empty.
2. Such criteria grade as **needs_evidence** until accepted external evidence is attached, then
   **externally_covered**. This requires joining accepted artifacts by `control_id`; attestation can
   remain a separate assertion, but must not silently stand in for accepted evidence.
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

**Evidence (dev):** shipped through `7b438952` → `7fcf9bea` → `11d04c3e` → `017607b7` →
`17670220`. The page renders a closed technical-playbook checklist with Verified / Action needed /
inventory-backed N/A rows, row-level SOC 2 mappings, and at most three applicable priorities.
Questionnaire/PDF narrative remains available separately. Manual policies, runbooks, and recovery
exercises are never claimed as automated verification; Inspector and DR applicability require
supporting collected inventory.

## 11. Remove account switcher from the sidebar rail → pure nav (org-first) — **done**

**Evidence (dev):** `SidebarAccountSwitcher` removed from `Layout.tsx`; rail is brand → nav → user
card only. "All accounts (N)" rehomed to org-home header slot; "+ Add account" remains on the
management list and Integrations connect flows. Orphaned `sidebar-accounts*` CSS deleted. Shipped in
`a98b2e17`; `3d163c0d` removed the duplicate "All accounts" header on org home.

## 12. Org home — adopt the two-column card layout (mockup-approved) — **done**

**Evidence (dev):** `OrgReadinessHome` is full-width and left-aligned with a dynamic evidence
stepper, a 2:1 blocker/recommended-action grid, and a full-width timeline card. Blocker rows retain
org-wide ranking/math while showing age, cloud region or org source, mapped controls, severity, and
working Review links. The top absence-gap capability has a working Enable link and disappears when
none applies; the blocker card then spans the row.

### Preserved acceptance spec

Ellie approved a mockup that decisively beats the current org-readiness home. Reshape the existing
`OrgReadinessHome` to this layout. **Data is unchanged — this is a layout/presentation reshape**
(same blockers, stepper, capabilities, timeline already computed). Fixes the three standing
complaints: centered narrow column, antivirus feel, and the ENABLE step having no home.

### Layout (left-aligned, full-width, structured cards — not centered prose)
Top (full width, left-aligned):
1. **Eyebrow:** `{Org name} technical evidence  [Not ready]  for SOC 2.` — org name prettified
   (title-case the slug, e.g. `cloud-castles` → "Cloud Castles"); only the state pill colored.
2. **Headline:** `32 high findings stand between you and SOC 2.` ({n} + "high" colored).
3. **Subline (math):** `Fixing the items below clears 24 of 32 high findings and unlocks CC6.1,
   CC6.3, CC6.8 and more. Everything else can wait.`
4. **Stepper:** Connected → Evidence flowing → {n} high findings (current) → Controls passing →
   Evidence ready. Current step label is dynamic ("32 high findings").

Middle — **two-column row**:
- **Left card — "What's blocking you"** (~2/3 width). Header: title + optional right control
  (see caveat). Rows: rank chip · title · meta line `{age} · {region|source} · {CC ids}` ·
  severity chip · `Review →`. Footer link: `View all {N} high findings →`.
- **Right card — "Recommended next step"** (~1/3 width). The top ENABLE item (absence-gap service),
  e.g. "GuardDuty threat detection — Enable →" with a one-line description. If multiple, show one;
  if none, hide the card (left card goes full width).

Bottom — **Timeline card** (full width): header "Timeline" + `History →`; dot-connector rows
`{date} · dot · {event text}` (green dot = resolved, grey = other). 5–6 rows.

### Org-first correctness (do not regress)
The mockup shows a 1-account case (`All accounts (1)`, us-east-1). Home is **org-first** — keep it:
- Blocker rows must still carry **org-level source tags** when not from a single cloud account:
  `· GitHub`, `· GitLab`, `· Entra ID`, `· Google Workspace` (reuse `sourceTagForCheck`). The
  mock's "us-east-1 · CC6.1" is just the cloud case; source-control/identity rows show their source.
- No per-account scoping introduced; this is the org rollup.

### Caveats to resolve during build (don't ship dead/duplicate controls)
- **"Review all ▾"** dropdown in the mock header — only include it if it does something real (bulk
  action / filter). Otherwise omit; `View all {N} high findings →` footer already covers "see all".
- **Header icons:** keep the existing **help + notifications** (do not swap to the mock's lone gear).
- **Org name prettify:** derive from real org name/slug; never hardcode "Cloud Castles".

### What to drop from current
The centered narrow-column layout and the stacked full-width prose sections. Replace with the
two-column card grid above. Keep the existing data hooks (blocker grouping/ranking, stepper state,
absence-gap ENABLE items, timeline merge) — only the render + CSS change.

### Acceptance
1. Home is left-aligned, full-width, two-column (blockers | recommended-next-step) + timeline card;
   no centered narrow column.
2. Recommended-next-step ENABLE card renders the top absence-gap service with a working Enable link;
   hidden when none (blockers card spans full width).
3. Blocker rows show rank · title · meta (age · region/source · CC ids) · severity · Review; org
   source tags present for GitHub/GitLab/identity rows.
4. No dead "Review all" control; help + notifications header kept; org name prettified from real data.
5. Numbers reconcile (subline "clears X of N" = sum of shown rows; N = org-wide high count) — keep
   the existing dev assertion.
