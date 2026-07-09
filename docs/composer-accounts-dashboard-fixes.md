# Accounts dashboard — follow-up fixes (Composer brief)

Context: the Accounts page was recently restructured. `/accounts` is now a
full-width dashboard for the selected account (no middle account-list column);
`/accounts?view=all` is the management list. Three follow-ups came out of
design review. **Scope is exactly these three items — do not redesign the page.**

Key files:

- `web/src/pages/Accounts.tsx` — page component. Dashboard topbar is the
  `accounts-dashboard__topbar` block near the bottom of the default export.
  The bottom cards live in `OverviewInsightsGrid` (~line 5690). Finding click
  handler is `openFinding` inside `OverviewInsightsGrid`. Priority rows built by
  `buildAccountPriorityFindings` (~line 5640).
- `web/src/components/SidebarAccountSwitcher.tsx` — sidebar "+ Add account" link.
- `web/src/lib/accountPosture.ts` — `buildRecommendedActions` (each action has
  `label` **and** `detail`; `detail` is currently not rendered).
- `web/src/styles/accounts-page.css` — all `accounts-dashboard__*` and
  `accounts-detail-overview__*` styles.

---

## 1. Move "‹ All accounts" to the very top; remove the duplicate "+ Add account"

Current: the dashboard renders a topbar row (breadcrumb left, "+ Add account"
button right) *below* the global header strip and above the account pane.

Wanted:

- The "‹ All accounts (N)" breadcrumb moves into the **very top section** of the
  page — the global top strip (the mostly-empty white bar that currently only
  has the help + notifications icons on the right). It should read as page-level
  navigation, not as a row floating above the card.
- Remove the "+ Add account" button from the dashboard topbar entirely. Adding
  accounts is not a dashboard action; it already exists in the left panel and in
  the management view.
- ⚠️ Dependency: the sidebar "+ Add account" link
  (`SidebarAccountSwitcher.tsx`, `sidebar-accounts__add`) currently links to
  `/accounts` — which after this change would land on a dashboard with **no add
  affordance**. Point it at `/accounts?view=all` (the management view keeps its
  Add button + provider picker in `AccountsToolbar`). Verify the add flow still
  works end-to-end from the sidebar link.
- If the topbar row then contains only the breadcrumb, collapse the row so the
  dashboard card moves up — no orphaned empty strip.

Acceptance:

- Breadcrumb visible in the topmost strip of the page, left-aligned.
- No "+ Add account" anywhere on the dashboard view.
- Sidebar "+ Add account" → management view → provider picker opens.

## 2. Recommended next actions — rows look bare next to Priority findings

Current: the left card (Priority findings) has uppercase column headers
(SEVERITY / FINDING) and structured rows; the right card (Recommended next
actions) is four bare text lines. Side by side the right card looks unfinished.

Wanted — give the action rows real substance instead of adding fake columns:

- Render each action as a **two-line row**: `label` (semibold) on top,
  `detail` underneath (smaller, muted). The `detail` strings already exist in
  `buildRecommendedActions` (`web/src/lib/accountPosture.ts`) — e.g.
  "16 open high findings need attention." — they are simply not rendered.
- Keep row dividers consistent with the findings card. No icons, no chips, no
  buttons — keep the quiet "View high findings →" text link at the bottom.
- Optional, if it helps balance: a small muted count badge in the card header
  (like the findings card's `5` badge) showing the number of actions.

Acceptance:

- Each action shows label + one-line supporting detail.
- Vertical rhythm (row height, dividers, padding) matches the findings card.

## 3. Priority findings shows stale findings (dead resources) + broken click-through

Observed: the top priority finding is
`KMS key '111a2101-…' was ScheduleKeyDeletion` (CloudTrail). Clicking it leads
nowhere useful — the resource no longer exists (the key was scheduled for
deletion and is gone). Two separate problems:

**3a. Click-through is fragile.** `openFinding` in `OverviewInsightsGrid`
(`web/src/pages/Accounts.tsx`) navigates to
`/findings?account_id=…&q=<finding title>` — a free-text search. If the title
doesn't match the Findings page's search behavior, the user lands on an empty
list. Fix: deep-link by **finding id** and have the Findings page open that
finding's drawer directly (the drawer currently opens only from local state —
add support for a `?finding=<id>` param or equivalent). The drawer should show
the finding's stored evidence even when the underlying resource is gone.

**3b. Event findings never resolve.** Investigate before changing behavior:

- The scan pipeline (`api/app/worker/scan_pipeline.py` → `persist_findings`)
  auto-resolves findings that stop being detected on re-scan. That works for
  resource-state checks. But CloudTrail **event** findings (like
  ScheduleKeyDeletion) describe a past event — the "resource" can vanish while
  the finding stays open indefinitely. Confirm which checks are event-derived
  and how (or whether) they currently age out.
- Decide + implement a consistent policy, e.g.: event findings auto-resolve
  after N days, or when the referenced resource no longer exists; OR they stay
  open but the UI labels them as an event ("occurred Jun 12") rather than a
  live resource finding.
- The dashboard's priority list (`buildAccountPriorityFindings`) currently
  takes the top 5 open critical/high by `risk_score` with no recency filter.
  The `Finding` schema already has `first_seen` / `last_seen`
  (`web/src/lib/apiSchemas.ts`). Prefer findings seen in the most recent scan;
  at minimum, show a "last seen X ago" hint so an old finding can't masquerade
  as current.

Acceptance:

- Clicking a priority finding always lands on that exact finding (drawer open),
  never an empty search result.
- A finding whose resource no longer exists either (a) no longer appears in
  Priority findings, or (b) appears clearly marked as a past event with working
  evidence on click — pick one policy and apply it consistently.
- No regression to the auto-resolve behavior for normal resource findings.

---

## Verification notes

- Dev stack runs via docker compose (`veritrail-web-1` serves Vite on
  `127.0.0.1:5173` with hot reload; API on `:8000`).
- Dev login: seed with `docker exec veritrail-api-1 python -m scripts.seed_dev_user`
  → `dev@veritrail.io` / `dev-veritrail-2026` (attaches to the org with real
  scanned accounts).
- `web/scripts/screenshot-accounts.mjs` takes authenticated screenshots of both
  views (`node scripts/screenshot-accounts.mjs`, output in `/tmp/veritrail-shots`).
- Typecheck: `npm run lint` in `web/`.
- Note: 3 of 4 Playwright e2e tests were already failing before this work
  (stale copy assertions unrelated to the Accounts page) — don't chase those.
