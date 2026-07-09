# Accounts homepage redesign — merged `dc9fb86d` × `e8c4fe91`

**Spec / plan doc — composer implements. Frontend-only. This is the FINAL homepage pass; no further
variants after this ships.**

Reference mockups (in `design/homepage/`):
- `dc9fb86d-7ee4-4bc9-9795-4e0a8594d620.png` — **structure**: accounts live in the sidebar, main area
  is one single-column dashboard for the selected account.
- `e8c4fe91-95c0-4589-9477-f61e81ca1aed.png` — **content/tone**: editorial hero, KPI strip, numbered
  priority findings, recommended actions.
- `e7966239-9032-4448-971b-949d977a053b.png` — **palette reference only** (future dark mode; see §6).

## What changes, in one line

Kill the two-panel layout (account list column + detail). Accounts become a sidebar switcher; the
freed width becomes a single, confident dashboard with a narrative hero.

---

## 1. Sidebar — account switcher (from `dc9fb86d`)

- New **ACCOUNTS** section at the top of the sidebar, above the nav items:
  - Section label `ACCOUNTS` + `+ Add account` inline action.
  - One card per account: provider logo, name, account id, selected state (ring/accent like the
    mock's teal outline + check). Click = select account, main dashboard swaps.
  - Selected card visual: accent border + check badge (see mock). Unselected: dimmed.
- **Overflow cap:** render at most **6** account cards. Beyond that, show a compact
  "All accounts (N)" row that opens the existing account management view. Sidebar cards must never
  scroll the nav out of view.
- Nav (Accounts/Findings/Compliance/History/Integrations/Workspace) stays below, unchanged.
- Keep the existing dark sidebar palette for now (§6 handles theming).

## 2. Main area — single-column dashboard (from `e8c4fe91`)

Top to bottom for the selected account:

**Header row**
- Provider logo + account name + verified badge, account id, `Connected` status.
- Right: `+ Add account` (secondary), `Scan now` (primary teal), overflow menu.
- Keep the existing account-detail tabs (Overview / Findings / Scans / Resources / Settings) as the
  row under the header — this spec restyles the **Overview** tab only. Other tabs unchanged.

**Hero (Overview)**
- Narrative headline: `Poor posture driven by 16 high findings.` — severity count colored
  (red for high). Subline: one sentence of guidance ("High-severity issues pose the greatest risk…").
- Right side: score ring with the qualitative grade (`Poor` / `Fair` / `Good`) labeled
  **Security score**.
- **Do not** put the open-findings count inside the ring. Count ≠ score; the ring is the grade only.
- Headline copy is data-driven: `{grade} posture driven by {n} {top_severity} findings.` Fall back to
  `No open findings — posture is clean.` when zero.

**KPI strip** (one row, five stats, divider-separated, like `e8c4fe91`):
`{high} High findings · {medium} Medium findings · {low} Low findings · {coverage}% Evidence coverage · {resources} Resources scanned`
- Tabular numerals, big number + small two-line label. No boxes/cards per stat — one quiet strip.

**Two-column band below the strip:**
- Left — **Recommended next actions** card: 3–4 static-ish action bullets driven by current state
  (remediate high findings, address IAM policy risks, resolve public exposure, enforce encryption),
  primary button `View high findings` → Findings filtered high.
- Right — **Priority findings** card: numbered list (1–5) of top high-severity findings, severity
  chip right-aligned, row click opens the finding. `View all` in the card header.

**Bottom band, two columns:**
- **Recent scans**: date, relative time, severity triple (16/410/70), resources; `View all scans`.
- **Recent activity**: recent change events (policy updated, key created, SG modified) with relative
  time; `View all activity`.

## 3. What gets deleted

- The middle account-list column (search box, sort, account cards, "Showing 1–2 of 2 accounts"
  footer). Search/sort move to the "All accounts" management view, which keeps its current
  functionality — reachable from the sidebar overflow row and the Accounts nav item.

## 4. Guardrails (positioning — do not violate)

- **No remediation capability chips.** Mock `34f35541` shows "SSM remediation · Enabled" — do NOT
  carry that anywhere. Read-only evidence product; remediation UI stays behind
  `VITE_SHOW_WRITE_REMEDIATION`.
- Score vs count: the ring shows the **grade**; finding counts live in the KPI strip. Never render a
  finding count styled as a score.
- No new backend endpoints — every stat above already exists on the current Accounts page. Reuse the
  queries.

## 5. Responsive

- Two-column bands stack at < ~1100px. KPI strip wraps 5→3+2. Sidebar account cards collapse to
  logo-only when the sidebar is collapsed (existing collapse behavior).

## 6. Theme tokens (prep for dark mode — do NOT build dark mode now)

- Extract the sidebar/panel colors used by this page into CSS variables (e.g. `--vt-panel-bg`,
  `--vt-panel-fg`, `--vt-panel-accent`) in one place instead of hardcoded hexes. The
  `e7966239` dark palette becomes a future `[data-theme="dark"]` token swap — out of scope here,
  but this pass must not add new hardcoded panel colors.

## 7. Acceptance

1. Login → Accounts: sidebar shows account cards, main shows the hero dashboard for the selected
   (or default-scope) account. No middle list column.
2. Switching accounts via sidebar swaps the dashboard without a full reload.
3. Hero sentence + ring + KPI strip match live data (cross-check against Findings page counts).
4. 7+ accounts: sidebar shows 6 + "All accounts (N)" row; nav still fully visible.
5. No remediation chips anywhere on the page; `tsc` clean; existing tabs still work.
