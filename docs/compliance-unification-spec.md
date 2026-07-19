# Compliance unification — implementation spec

**Status:** IMPLEMENTED (July 16, 2026) — all four phases shipped; see notes at each phase
for the as-built deltas. · **Supersedes:** the standalone `/checklist` page and the
`/controls` "Criteria" nav item · **North star:** open-work §0 REVISION 2 (July 16, 2026)

**As-built notes (final):** the primary Compliance view is the restored **composite controls
view** (`CompositeControlsPanel` — auditor-language control cards with Failing / At risk /
Passing / Not evaluated chips, status-filter bar, and the Fix / Evidence / Checks / Mapping
drawer). The owner explicitly preferred this original design over both the phase-based and
the domain-based checklist redesigns — the checklist-style `ComplianceChecklist` component is
now unused (kept in-tree for reference; delete when confident). The topbar View select
toggles **Controls ⇄ Criteria** (`?view=checks` deep-links the Criteria tab, which gained a
criteria-family dropdown). Criteria click opens the control drawer with findings as the
secondary link inside. Home's existing "Capabilities to turn on" section already was the org
rollup (absence-gap findings org-wide with per-account scope labels) — Phase C needed only a
stale-link fix. Nav is 6 items; `/checklist`, `/audit`, `/audit-readiness` all redirect to
`/controls`.

One sentence: restore the **composite controls view as the primary surface under one nav
item "Compliance"**, demote Criteria to a tab inside it, dissolve the Checklist page into
(a) control states + (b) a Home setup module, and cut the nav from 7 to 6.

Why (short): the activations-only checklist was a ~12-row settings list no design pass could
make substantial; Criteria was a redirect to filtered Findings (a saved search, not a
surface); no page answered "how compliant am I, control by control." The market's
"checklist" (Vanta/Drata) is the controls view with three states — failing checks included.

---

## 0. Ground truth (verified July 16 — re-verify before editing)

| Thing | Where |
|---|---|
| Nav | [`web/src/Layout.tsx`](../web/src/Layout.tsx) ~:244-278 — Home(`/accounts`), Findings, **Checklist(`/checklist`)**, **Criteria(`/controls`)**, History, Integrations, Workspace |
| Routes | [`web/src/main.tsx`](../web/src/main.tsx) ~:80-90 (`/home` → `Accounts.tsx` too) |
| Home page | `web/src/pages/Accounts.tsx` (org audit-readiness page; accounts are rail drill-downs) |
| Checklist page | `web/src/pages/Checklist.tsx` → [`web/src/components/ComplianceChecklist.tsx`](../web/src/components/ComplianceChecklist.tsx) (phases, playbook groups from the readiness API, `manualEvidenceHint`, hero ring/breakdown, `ChecklistStepDrawerContent` with per-item Enable instructions/CLI) |
| **Composite controls view — still in code** | [`web/src/pages/Controls.tsx`](../web/src/pages/Controls.tsx): `ComplianceView = "composite" \| "detailed"` (:218), `compositeDisplayStatus` (:247), `compositeMappedControls` (:454), `ControlDetailPanel` import (:80). The Criteria page is this file's checks view; the composite view code was retained when the toggle died. |
| Control drawer | `web/src/components/ControlDetailPanel.tsx` (three-tab: fix / evidence / checks / mapping; manual-evidence upload; attestation) |
| Readiness API (checklist data) | `api/app/services/audit_readiness.py` + `api/app/routes/audit_readiness.py` — per-account playbooks/items |
| Controls API | `api/app/routes/controls.py` (`ControlOut` incl. `scanned_check_ids`) |
| Absence-gap logic | `web/src/lib/evidenceGap.ts` (`isAbsenceGapCheck`: `.not_enabled/.not_detected/.missing`) — these are the ex-checklist "Enable" items and already surface as findings that grade composites |
| Evidence grading | accepted control-tagged `EvidenceArtifact` → `externally_covered` (gap-d join) |
| Hero visuals to carry over | ring + "Where the N requirements stand" breakdown bar, `compliance-page.css` ~:4100-4350 (recently reworked; keep) |

---

## Phase A — Compliance page: composite controls view primary

1. **One nav item "Compliance"** pointing at `/controls` (keep the route; rename label +
   icon in `Layout.tsx`). Remove the **Checklist** and **Criteria** nav items. Add redirects:
   `/checklist` → `/controls`, and keep `/controls?view=checks` working (becomes the tab).
2. **Primary view = the composite controls list** (re-expose the retained `composite` view
   in `Controls.tsx`). Every composite renders in exactly one of three states:
   - **Verified** — checks passing (or `externally_covered`).
   - **Action needed** — any failing mapped check. Absence-gap failures (`.not_enabled` etc.)
     render the **Enable** action + the checklist's per-item instructions
     (reuse `ChecklistStepDrawerContent` inside the control drawer's fix tab);
     named-resource failures render **Review** → drawer/findings. Never "Fix".
   - **Needs evidence** — manual controls awaiting accepted evidence (Attach evidence →
     existing upload flow; `manualEvidenceHint` copy carries over).
3. **Header** = the checklist's shipped hero (ring fills by verified count; breakdown bar
   shows Verified / Action needed / Needs evidence counts; Export audit package + Re-scan).
   States, not a single % score — "14 verified · 9 need action · 4 need evidence".
4. Keep the honesty line and auditor-language group questions on the group cards.

## Phase B — Criteria demoted to a tab, click enriched

1. Inside Compliance, a secondary **Criteria tab** (the current `view=checks` list —
   CC-series for SOC 2, equivalents for ISO/CIS; the collectable-family filter stands).
2. **Row click no longer navigates to Findings.** A criterion opens a panel showing its
   **mapped controls and their live status** (reuse `compositeMappedControls` inverse
   mapping + the same status chips). "View findings" appears inside that panel as a
   secondary link (preserving today's filter behavior) — posture first, operations second.
3. Zero-mapped criteria keep their manual-evidence rendering (drawer Evidence tab).

## Phase C — Home setup module (org-level rollup)

1. On Home (`Accounts.tsx`), add a **"Finish setup" module**: the union of missing
   activations (absence-gap items) across **all connected accounts** in the org.
2. Each row = one activation (e.g. "Enable CloudTrail audit logging") with an aggregate
   "N of M accounts" badge. Clicking opens a drawer listing **which accounts are missing
   it**, each with the per-account instructions/CLI (reuse `ChecklistStepDrawerContent`
   parameterized by account).
3. The module shows a compact progress line and **disappears entirely at 100%** — Home
   returns to pure "attention today".
4. Data: v1 may fan out the existing per-account readiness API client-side (orgs are small);
   if that's ugly, add `GET /v1/org/readiness-rollup` aggregating server-side.
   **Decision point — implementer picks, notes in PR.**

## Phase D — cleanup

1. Delete `web/src/pages/Checklist.tsx` route + nav entry; `ComplianceChecklist.tsx` is
   dismantled for parts (hero, drawer content, group cards) — delete what Compliance/Home
   don't absorb. Keep `localStorage` keys tidy (drop the checklist phase-persistence keys).
2. `docs/checklist-redesign-spec.md` — already marked superseded; do not implement its tiers.
3. History, Findings, Integrations, Workspace untouched. Nav = 6 items.

---

## Acceptance criteria

1. Nav shows **Home · Compliance · Findings · History · Integrations · Workspace** (6).
   `/checklist` redirects to `/controls`; old criteria deep-links still land on the tab.
2. Compliance default view lists every composite control in exactly one of
   Verified / Action needed / Needs evidence; header ring + breakdown reflect the same
   counts; no single-% "score" anywhere.
3. An absence-gap control shows **Enable** + instructions in its drawer; a failing
   named-resource control shows **Review**; a manual control shows **Attach evidence**;
   accepted evidence flips it to Verified (externally covered label preserved).
4. Criteria tab: clicking CC6.1 opens mapped controls + status; findings link is inside
   that panel, not the row's primary action.
5. Home shows the setup module iff ≥1 account is missing ≥1 activation; drawer lists the
   missing accounts with per-account instructions; module gone at 100%.
6. `npx tsc --noEmit` clean; `npm run build` green; backend untouched unless the org-rollup
   endpoint is chosen (then: tests for it).

## Out of scope

- Connect-vs-Attach split (tier 3 of the old spec) — revisit after unification ships.
- Owner-per-control, evidence freshness (§E backlog).
- Any visual re-theming beyond carrying the existing hero/drawer styles over.
