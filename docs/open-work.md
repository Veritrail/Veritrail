# Open work

**Single running list — everything else from prior specs shipped and those docs were removed.**
Add new items here going forward instead of opening new spec files, unless something is big
enough to need its own detailed design doc.

Status key: **done** · **open**

---

## 1. Bug — account drill-down shows org-wide blockers, not account-scoped — **done**

`/accounts?account_id=<aws account>` — "What's blocking this account" was listing org-wide items
(GCP, GitHub) under the wrong cloud account.

**Shipped:** account drill-down blockers query filters to this account's provider + account id
(same grouping/ranking as org home, scoped down). Account detail overview uses
`AccountReadinessOverview` with account-scoped blocker findings.

## 2. Workspace page — old design, never restyled — **open**

`/workspace` still uses the pre-redesign visual language: multi-color left-border cards
(green/purple/orange/red), 4-box stat-icon header row. Doesn't match the rest of the app (white
cards, `--vt-border`/`--vt-shadow-card`, teal accents, pill selector cards). Rebuild using the
current system.

## 3. Profile page — same old design, shares a template with Workspace — **open**

`/profile` is visually identical in structure to Workspace (same stat-box header + colored-card
grid, different copy). Confirmed same shared pattern — fix once, applies to both pages. Don't
design these separately.

## 4. Integrations hub — visual restyle — **open** (troubleshoot panel shipped)

`/integrations` — table content no longer clips (verified fixed). Cloud integration troubleshoot
panel + scan-failure messaging shipped; full visual restyle to pill-card system still open.
Page still uses old stat-card style (bordered icon-boxes) instead of the pill-card system used
on Findings/History/Accounts, and the data table is denser/plainer than the Findings table.
Restyle to match current system — consider whether the top stat row is even needed vs. an
org-home-style summary.

## 5. Findings page — minor tablet reflow at ~1024px — **open**

Account/Benchmark/Status selector cards wrap to a second row before reaching Status; severity
filter chips get a horizontal scrollbar; finding titles truncate harder. Not broken, just not
tight. Low priority — do after items 2–4.

## 6. GRC feed push validation — human action, not code — **open**

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
