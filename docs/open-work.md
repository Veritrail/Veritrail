# Open work

**Single running list — everything else from prior specs shipped and those docs were removed.**
Add new items here going forward instead of opening new spec files, unless something is big
enough to need its own detailed design doc.

Status key: **done** · **open** · **blocked**

**Next up:** section **0 (north star — checklist consolidation)** governs all UI work; execute
A → B → C → D in order. Items 2 + 3 (Workspace/Profile restyle) after. Item 6 is
partner/human validation, not engineering.

Deep-research report mapping (composer backlog + human decisions):
[deep-research-roadmap.md](./deep-research-roadmap.md) — **composer buildable items shipped**
(§2.1–§2.12). Remaining: §3 human decisions + GRC destination adapter (blocked on item 6;
not numbered here).

---

## 0. NORTH STAR — the checklist is the product — **open** (governs everything below)

Market research (July 2026 deep-research pass on Vanta / Drata / Secureframe / Sprinto /
Oneleet / Thoropass) confirms: every leading SOC 2 product ships exactly **three surfaces** —
a controls **checklist** with three states, a per-control **detail pane**, and a
**time/export** view. None has a separate "audit readiness" narrative page. Criteria codes
(CC6.1 …) are always a secondary reference tab, never primary navigation.

Veritrail got lost by answering "how compliant am I?" on four pages (Home, Compliance,
Audit, History), each re-rendering the same composites/controls/checks. This section is the
single direction; every future change either serves the checklist or does not ship.

### REVISION (July 13, 2026) — Checklist splits out of Compliance

Setup and operations are different species: an **activation** is finite (enable GuardDuty
once, done forever), a **finding** recurs nightly. Mixing them made the checklist score
unwinnable. New cut:

| Page | Job |
|---|---|
| **Checklist** (new nav item, `/checklist`) | Finite setup journey — enable capabilities → connect evidence sources → attach human evidence. Converges to 100%. **No findings.** |
| **Compliance** | CC criteria + control drawers only (status surface). View toggle dies. |
| Findings | Ongoing operations (unchanged). |

This supersedes "§A Compliance = the checklist" below. The rest of §0 stands. Nav is now
7 items — the last addition this product tolerates.

### REVISION 2 (July 16, 2026) — Compliance unification: the controls view returns

The July-13 split failed in practice. Scoping the checklist to **activations only** produced
a ~12-row finite settings list that four design passes could not make feel substantial —
the content was too thin, not the paint. Meanwhile no page in the nav answered the product's
core question ("how compliant am I, control by control, right now?"): Checklist answered
"what setup remains," Criteria became a thin redirect to filtered Findings (a glorified
saved search), and Findings — an *operations* page — became the de-facto strongest surface
of a *compliance* product. The market never split these: Vanta/Drata's "checklist" IS the
controls view — every control in three states, failing checks rolled up into control status.

New cut (supersedes the July-13 table; full spec:
[compliance-unification-spec.md](./compliance-unification-spec.md)):

| Page | Job |
|---|---|
| **Compliance** (one nav item) | THE primary surface — composite controls view, three states per control: **Verified / Action needed / Needs evidence**. "Action needed" includes both not-enabled capabilities (ex-checklist rows) and failing-check rollups. Control drawer (fix / evidence / checks / mapping) unchanged. **Criteria demoted to a tab inside** — a criterion opens its mapped controls + live status; "view findings" is a secondary link within that, never the primary click. |
| **Home** | Keeps "attention today," gains a **setup-journey module**: org-level rollup of missing activations across all accounts; drawer shows which accounts are missing it + per-account instructions; module disappears at 100%. |
| Findings | Ongoing operations (unchanged). |

**Checklist and Criteria leave the nav** (7 → 6 items). The "unwinnable score" concern that
motivated the July-13 split is solved by **states, not a single %**: "14 verified · 9 need
action · 4 need evidence" never lies and never becomes unwinnable.

| Page | Job | State |
|---|---|---|
| Home | What needs attention today | **Done — frozen** |
| Findings | Raw findings, triage, bulk actions | **Done — frozen** |
| Compliance | **THE checklist** — what am I missing for SOC 2 | Absorbs the Audit page |
| History | Proof over the audit period (auditor-facing) | One view; Activity tab dies |
| Audit readiness | — | **Removed from nav** once absorbed |

### A. Compliance = the checklist

- One primary view: capability groups in auditor language (the Audit page's questions —
  "Can your data be restored?", "Can security-relevant activity be reconstructed?"),
  every item in exactly one of three states:
  1. **Verified automatically** (✓ — checks passing)
  2. **Action needed** (fix affected resources → Review, or turn service on → Enable)
  3. **Needs manual evidence** (upload/attest — the only state a human must feed)
- Three states double as **list filters** (Drata pattern: Monitored / Unmonitored,
  Evidence mapped / No evidence).
- Keep the honesty line ("Automated evidence only — policies, runbooks, human processes
  are not marked verified.").
- The composite/detailed/criteria view split collapses: checklist is primary;
  **Criteria** stays as a flat secondary reference list — rows link to Findings filtered
  by the criterion's checks. **No drawer on criteria rows** (market: criteria live in a
  "Frameworks" tab of the control detail, nothing more).

### B. The drawer — single purpose, fewer tabs

Current drawer (overview/gaps/evidence/mappings/guidance) feels overloaded. Target
(matches Drata's detail): lead with **the fix**, then:
- **Evidence** — artifacts, upload, attestation.
- **Checks** — mapped checks with pass/fail **and history** (reuse
  `/v1/controls/history-summary` segments — a per-control pass/fail strip inside the
  drawer; second consumer for the timeline data).
- **Mapping** — CC/ISO/CIS codes (reference only).
Guidance folds into the fix section; overview dies as a separate tab.

### C. Audit page migration → removal

Move into Compliance: auditor-language group questions, honesty note, Enable/Review
split. Copy-narrative was migrated, then deliberately **removed** (July 2026): invisible
clipboard prose on a worklist is noise — narratives live in the audit-package export and
the questionnaire page. Do not re-add it to the checklist. Keep separately: Generate
Audit Package export (button on Compliance) and the auditor portal. Then remove `/audit`
from the nav.

### D. History — one view

Controls timeline is the only view; raw activity becomes the expand-in-row drill-down
(original item 7 spec — the Activity tab was scope creep). If unused after the
consolidation, demote to a "period" lens inside Compliance. Long-term home for
period-proof is the auditor portal.

### E. Post-consolidation backlog (market-validated gaps)

- **Owner per control** — every competitor has assignment; we only have attestation.
- Evidence freshness / overdue nudges (Sprinto alert pattern) — later.
- Trust Center stays out of scope for the lean core (market: optional).

---

## 1b. Advanced IAM policy generation (Access Analyzer) — full rip — **done** (July 14, 2026)

Removed the entire advanced Access Analyzer / CloudTrail policy-generation feature. The
connector is now a single flat **read-only** template (`veritrail-stack.yaml`); deleted the
nested `veritrail-core-scanner.yaml` / `veritrail-policy-generation.yaml` /
`veritrail-readonly-role.yaml`. Backend: dropped the `roles/policy-generation/start|status`
endpoints, `access_analyzer_policy.py` + `policy_generation_messages.py`, the
`enable_advanced_policy_generation` / `advanced_policy_generation_deployed` columns
(migration `0099`), and the advanced branches in `accounts_analysis.py` /
`account_capabilities.py`. The read-only least-privilege **suggestion** (IAM last-accessed →
`roles/generated-policy` → `PolicyProposalReview`) is kept. Frontend: removed the connector
"Advanced IAM policy generation" toggle, the finding-drawer CloudTrail start/rebuild UI, the
`useCloudTrailPolicyGen` hook, and the dormant CloudTrail notification subsystem
(`RecheckNotificationsContext` + `NotificationsBell`). Backend 1001 tests pass; `tsc` + `npm
run build` green.

**Follow-ups (minor):** `verify-capabilities` endpoint is now a no-op and its 3 frontend
`verifyCapabilities` mutations + `onVerifyCapabilities` props are dead (no UI trigger) — safe
to prune later. CFN is **not** re-published to S3 — run `./scripts/upload-cfn.sh --dry-run`
before deploying.

## 1c. Checklist redesign — **superseded by §0 REVISION 2**

The standalone `/checklist` page is dissolving into the unified Compliance controls view +
a Home setup module (see §0 REVISION 2 and
[compliance-unification-spec.md](./compliance-unification-spec.md)). The note below stays
useful only for its visual language (hero ring, states, drawer 1c design) — do not implement
its page-level tiers as written; the shipped hero/ring/breakdown CSS carries over to the
Compliance header.

Original note: locked design comp reskins `/checklist`. Full implementation spec:
[checklist-redesign-spec.md](./checklist-redesign-spec.md). Tier 1 (CSS reskin) + tier 2
(hero ring + category split-bar) are low-risk, frontend-only. Tier 3 (split Connect vs Attach
into two phases) is a product decision — recommended frontend-only via a `collectionMode` field
on `manualEvidenceHints`. App is already teal (`--vt-teal #0d9488`), so no blue→teal work.

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

## 5. Findings page — minor tablet reflow at ~1024px — **open**

Account/Benchmark/Status selector cards wrap to a second row before reaching Status; severity
filter chips get a horizontal scrollbar; finding titles truncate harder. Partial tablet CSS
exists in `findings-overrides.css` / `findings-v2.css`, but the ~1024px toolbar squeeze remains.
Not broken — low priority; do after items 2–3.

## 6. GRC feed push validation — human action, not code — **blocked**

One binary test: push one Veritrail evidence artifact → one SOC 2 control on Vanta or Drata,
confirm it attaches/is auditor-visible/counts/supersedes idempotently. Needs a design-partner
customer's API key (fastest) or Drata's free no-CC trial — no self-serve signup on either.
**Decision gate:** push works → build the destination adapter. Push weak/gated → ship
export-only (GRC-ready ZIP + upload instructions). Do not build the adapter before this test.
Reference: `docs/grc-feed-validation.md`, `docs/grc-feed-api-runbook.md` (API details, still
current, kept as reference docs — not merged here since they're research, not a build spec).

## 7b. Deferred integrations (phase 8) — **open** (migrated from implementation-pipeline.md)

The implementation-pipeline backlog shipped 170/174 items; these are the residual deferred
integrations, kept here after that doc was pruned:
- **Orca / Snyk / Aikido** — additional vulnerability scanners (Phase 8).
- **Datadog / Splunk / SIEM** — log/monitoring evidence connectors (Phase 8).
- **Kandji MDM** — device-management evidence (alongside existing Intune/Jamf).
- **Azure management-group support** — org-level Azure onboarding (stretch).

## 9. Gap — check-less human criteria (CC7.4 et al.) can't receive external evidence — **done**

**Closed by the checklist consolidation.** CC6.4/CC6.5/CC7.3/CC7.4 render in the checklist
"Policies and human processes" phase with evidence hints + "Attach evidence" → opens the control
drawer's Evidence tab (gap-a made it render for `check_ids.length === 0`) → upload tagged to the
exact `control_id`; accepted evidence flips the criterion to `externally_covered` (gap-d backend
join + label). A1.1/A1.3 are moot — the A-series was removed from the SOC 2 seed; CC7.5 gained
automated checks. Verified live July 2026. Original spec below (historical).

### Original spec

## 9-orig. Gap — check-less human criteria (spec)

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
runbook + test photos) that a real customer already has and can't currently file. This is the “needs manual evidence” state of North Star §A — build it as part of the
checklist consolidation, not separately.
