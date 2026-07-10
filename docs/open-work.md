# Open work

**Single running list — everything else from prior specs shipped and those docs were removed.**
Add new items here going forward instead of opening new spec files, unless something is big
enough to need its own detailed design doc.

Status key: **done** · **open** · **blocked**

**Next up:** items **2 + 3** together (shared Workspace/Profile template restyle). Do not start
item 5 until 2–4 land. Item 6 is partner/human validation, not engineering.

`docs/deep-research-roadmap.md` is not in the tree yet (as of this pass). If a parallel agent
adds it for scanning-only / deep-research cleanup, cross-link any overlapping UX or integration
items here.

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

**Parallel WIP:** scanning-only cleanup is editing `Integrations.tsx` / catalog / finding drawer
(uncommitted). Coordinate before restyling that page.

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
