# Org-first readiness home (`/accounts`)

**Spec / plan doc — composer implements.** Replaces the per-account dashboard as the default
Accounts view with a minimal, org-level audit-readiness page. Design reference: the minimal mock
(centered column: sentence → stepper → blockers → timeline) with the punchier headline + math
subline from the "Fix next" mock. Frontend-only; all data exists (recon pointers below).

## Why (decided)

SOC 2 readiness is an **org** property, not an account property. The homepage should answer "is the
company audit ready and what blocks it," aggregating all cloud accounts + org-level sources
(source control, identity). Accounts become drill-downs (rail cards → account detail, unchanged).

---

## 1. Routing / wiring — `web/src/pages/Accounts.tsx`

Current fork (line ~7825, ~8261, ~8368): `viewAll = searchParams.get("view") === "all"`;
`!viewAll` renders the selected-account dashboard (`AccountSplitDetailPane`) from the rail
selection.

**New fork:**
- `/accounts?view=all` → management list (unchanged).
- `/accounts?account_id=X` → existing account detail (`AccountSplitDetailPane`) — the rail's
  `selectAccount` already navigates here (`SidebarAccountSwitcher.tsx`).
- `/accounts` (no `account_id`, no `view`) → **new `<OrgReadinessHome />`**. Do NOT auto-select a
  persisted account on this route. The "Home" nav item lands here.
- Rail behavior unchanged: cards = drill-down; on the org home no rail card shows as selected
  (selection state only applies when an `account_id` is active).
- HeaderSlot on org home: keep the "All accounts (N)" link; drop any account selector — org home
  is unscoped by definition.

## 2. Page layout — new `web/src/components/OrgReadinessHome.tsx`

Single centered column, `max-width: ~56rem`, generous vertical rhythm (page reads: sentence →
stepper → blockers card → timeline). Minimal: no KPI strip, no stat cards, no score ring.
Top-right of content area (or header slot): existing `Scan now` affordance is NOT needed here —
scanning is per-account; omit.

### 2a. Headline block
```
{N} high findings stand between you and SOC 2.
```
- `N` = open findings org-wide with severity critical|high. "high findings" colored `#dc2626`
  (span), rest `#0f172a`. ~28px/700, tight leading.
- Subline (15px, muted), data-driven:
```
Fixing the {three} items below clears {X} of {N} high findings and unblocks {CC6.1 and CC6.2}.
Everything else can wait.
```
  - `X` = sum of finding counts of the top-3 blocker groups (§2c).
  - Control list = union of SOC 2 control ids across the top-3 groups; format "CC6.1 and CC6.2"
    (2), "CC6.1, CC6.2 and CC6.3" (3), cap at 3 + "and more".
  - If only 1–2 blocker groups exist, adjust "three items" wording accordingly ("two items",
    "the item below").
- **Zero-high state:** headline `No high findings stand between you and SOC 2.` (all dark, no
  red), subline swaps to controls status: `{passed} of {total} controls passing — keep evidence
  flowing.` Blockers section hidden, timeline stays.

### 2b. Journey stepper
Five steps, teal filled = done, teal outlined ring = current, grey = future. Connecting hairlines.
```
Connected → Evidence flowing → Fix high findings → Controls passing → Audit ready
```
State logic (org-wide):
1. **Connected**: ≥1 connected cloud account OR any integration connected.
2. **Evidence flowing**: any account has a completed scan OR org-level findings/grading exist
   (controls summary `total > 0`).
3. **Fix high findings**: current while `N > 0`.
4. **Controls passing**: current while `N == 0` and `passed < total`.
5. **Audit ready**: `total > 0 && passed == total`.
Current step = first incomplete. Labels 12.5px; done/current labels teal, future grey.

### 2c. "What's blocking you" card
Header row: `What's blocking you` (15px/650) + right link `All findings →` → `/findings`.
One white card (border `--vt-border`, radius 14px, shadow `--vt-shadow-card`), rows divided by
hairlines:
- Row: `HIGH` chip (red pill, 11px) · title (14px/600) · meta line under title
  (`{count} findings · {CC ids}` 12.5px muted) · right: **`Review →`** ghost button.
- **Grouping:** merge org-wide open critical|high findings, group by `check_id`.
  - Title: `labelForCheck(check_id)` (`web/src/data/checkLabels.ts`).
  - CC ids: `CHECK_CONTROL_IDS_MAP[check_id]` filtered `framework === "soc2"`
    (`web/src/data/checkControlIdsMap.ts`), deduped.
  - **Source tag** for org-level groups: prefix `github.`/`gitlab.` → append `· GitHub`/`· GitLab`;
    `entra.` → `· Entra ID`; `google_workspace.` → `· Google Workspace`. Cloud checks: no tag.
- **Ranking:** sort by (count of SOC 2 controls blocked desc, finding count desc). Take top 3.
- `Review →` → `/findings?checks={check_id}` (the Findings page supports `checks` — same pattern
  as `findingsHrefForChecks` in `evidenceGap.ts`).
- **Verb is "Review", never "Fix"** — read-only positioning.

### 2d. Timeline
Header: `Timeline` + right link `History →` → `/history`.
Quiet rows (no card, hairline-separated): `relative time (12px muted, fixed ~64px col) · dot ·
event text (13.5px)`. Dot: green for resolved-type events, grey otherwise. 5–6 rows.
Data: merge `GET /v1/accounts/{id}/compliance-timeline?framework=soc2&days=14&limit=10` across
connected **AWS** accounts (endpoint is AWS-scoped today — see `historyQ`, `Accounts.tsx` ~6221),
sort desc by timestamp, take 6. Reuse `historyDetailLine`/`historyTypeDisplay`
(`lib/historyEvidence.ts`) for labels. Skip `baseline_established`. If no events: single muted row
"Activity appears after your first scan."

## 3. Data assembly (all confirmed to exist)

- **Org-wide open findings:** three `fetchAllFindings` calls merged + de-duped by finding id
  (`web/src/lib/fetchAllFindings.ts`):
  `{status:"open", provider:"all_cloud"}`, `{status:"open", provider:"source_control"}`,
  `{status:"open", provider:"identity"}`. Filter client-side to severity critical|high for N and
  grouping. Guard identity/source fetches on having such integrations connected (same pattern as
  `Controls.tsx` `hasIdentity`).
- **Controls summary (org-level):** `GET /v1/controls?framework=soc2` **without** `account_id` —
  route accepts optional account (`api/app/routes/controls.py:462`), org grading includes org
  integrations. Summarize passed/total like `summarizeSoc2Controls` in `Accounts.tsx`.
- **Accounts/integrations:** existing `useConnectedAccountOptions` + integrations status queries.
- One `useQuery` per concern; skeleton state = grey blocks for headline/stepper/card.

## 4. Guardrails

- **"Review", never "Fix"** anywhere on this page.
- Org copy: "you" = the company. Never "this account is (not) audit ready".
- No remediation affordances; links go to Findings/History only.
- Framework hardcoded SOC 2 for v1 (matches product focus); no framework selector on this page.
- Don't break: `?view=all` management list, `?account_id` detail pane, rail switcher, deep links.
- No new backend endpoints. (Optional later: org-level timeline endpoint to replace the client
  merge — do NOT build now.)
- `tsc` clean; verify with 0-account, 1-account-unscanned, and populated orgs (headline/stepper
  states for each).

## 5. Acceptance

1. `/accounts` (nav click) → org readiness home: headline with real N, math subline consistent
   with the three rows shown, stepper on the correct step, top-3 blockers with correct CC ids,
   timeline with merged real events.
2. Rail card click → account detail (unchanged); "All accounts" → list (unchanged).
3. With Entra/GitHub findings among top blockers, rows carry source tags and appear without any
   AWS account selected.
4. Zero-high org shows the clear-state headline + stepper on "Controls passing"/"Audit ready".
5. No "Fix" verb on the page; all numbers reconcile with the Findings page counts.
