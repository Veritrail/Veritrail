# Design consistency + responsive audit (2026-07-10)

**Spec / plan doc — composer implements.** Full sweep of every main-nav page at 1440/1024/390px.
Ordered by severity: fix broken things first, then design-language drift, then the known leak.
No console/JS errors found anywhere — every issue below is CSS/layout, not a crash.

---

## Priority 0 — broken (data unreadable or inaccessible)

### 1. Sidebar doesn't collapse below ~1000px — product unusable on mobile
The sidebar (`app-sidebar`, `web/src/Layout.tsx` + `web/src/styles/sidebar.css`) is a fixed-width
inline column with no responsive breakpoint. At 390px it renders full-width and pushes all page
content off-screen (confirmed: only a sliver of white bleeds in on the right edge, no horizontal
scroll affordance surfaced to the user). No hamburger/drawer toggle exists below desktop width.
**Fix:** add a breakpoint (~900–1000px) where the sidebar becomes an off-canvas drawer (hidden by
default, toggled by a hamburger in the header), matching the existing collapse-to-icons behavior
already built for desktop (`is-collapsed` state) as the visual base to extend from.

### 2. History table — columns overlap and become unreadable at 1024px
`web/src/pages/History.tsx` (+ its table CSS). At 1024px viewport, DATE/TIME and TYPE column
content visually collides/overlaps (confirmed via screenshot — text renders on top of itself,
fully unreadable). Table has no `min-width` + horizontal-scroll fallback; columns just compress
until they overlap instead of scrolling.
**Fix:** give the table a `min-width` (sum of comfortable column widths) inside an
`overflow-x: auto` wrapper, same pattern the Findings table already uses successfully at this
breakpoint. Do not let columns compress past a readable minimum.

### 3. Integrations hub table — content clipped at desktop width, fully cut off at tablet
`web/src/pages/Integrations.tsx`.
- **At 1440px (not a resize bug — broken at full desktop):** Capabilities column chips are
  clipped mid-word ("Au...", confirmed in screenshot). Column is too narrow for its content with
  no wrap/truncate-with-tooltip handling.
- **At 1024px:** Permissions / Capabilities / Manage columns are pushed fully off-screen; the
  table requires horizontal scroll inside an already vertically-scrolling page (double-scroll,
  bad UX) with no visual cue that more columns exist off-screen.
**Fix:** same table pattern as History fix above — `min-width` + contained `overflow-x: auto`,
plus either wrap the capability chips onto a second line within the cell or cap+tooltip long chip
lists instead of hard-clipping.

---

## Priority 1 — old design language (functions fine, doesn't match the current system)

The rest of the product (Accounts org-home, Findings, Compliance/Controls, History's shell) uses
a consistent minimal system: white cards, `--vt-border`/`--vt-shadow-card`, teal accents, pill
selector cards, quiet hairline-divided rows. Two pages + one shared component were never touched
by that pass and still use an older, unrelated visual language:

### 4. Workspace page (`web/src/pages/Workspace.tsx`)
Multi-color left-border cards (green/purple/orange/red accents), a 5-box stat-icon-row header,
small pill tabs. Reads as a different product. Rebuild using the current system: pill
selector-card row → white bordered cards (`--vt-border`, `--vt-shadow-card`, radius 14px), single
accent color (teal) for anything "good," red/amber only for actual severity, not decorative
per-card theming.

### 5. Profile page (`web/src/pages/Account.tsx` or equivalent)
**Same exact old template as Workspace** — 5-stat-box header + colored-border card grid. Confirmed
via screenshot to be visually identical in structure to Workspace, just different copy. Likely
shares a component — fixing the shared component/pattern fixes both pages in one pass. Do not
design these separately; find and fix the shared source.

### 6. Integrations hub — card + table styling
Stat cards (Connected / Syncing / Errors / Cloud accounts) use the old bordered-icon-box style
matching Workspace/Profile's stat row, not the pill-card system used on Findings/History/Accounts.
The data table below is dense and unstyled relative to the Findings/Compliance tables. Restyle to
match: pill cards for the top stats (or drop them — the "What's blocking you" pattern from
org-home may fit this page better than a stat row, worth considering as part of this pass), and
align table typography/row spacing/hover states with the Findings table.

### 7. Account drill-down page — already specced, listed here for completeness
`docs/org-readiness-home.md` **v3** section already covers this (Security score / SOC 2 readiness
/ Evidence coverage cards + Recommended next actions duplicate the org home and Compliance page;
retire them, keep Priority findings + a merged Timeline in the org-home visual style). No new
work here — just confirming it surfaced in this sweep too and is already queued.

---

## Priority 2 — product/positioning leak spotted during the sweep

### 8. "Remediation" capability chip visible on the Integrations hub AWS row
Contradicts the read-only positioning locked earlier this session (`product-actions-master.md`
§C — remediation UI must be flag-gated behind `VITE_SHOW_WRITE_REMEDIATION`, off by default).
Confirmed visible in the current build at `/integrations`, AWS row, Capabilities column. Check why
it's rendering outside the flag gate — either the flag is on in this environment (fine, just
confirm prod default is off) or this specific chip was missed when the remediation cuts shipped.

---

## Priority 3 — minor, not broken, low urgency

### 9. Findings page — header wraps + severity-chip scrollbar at 1024px
`web/src/pages/Findings.tsx`. Account/Benchmark selector cards wrap to a second row before Status;
the severity filter chip bar (All/Critical/High/Medium/Low/Info) gets a horizontal scrollbar and
truncates finding titles harder than desktop. Not broken — content stays readable and reachable —
but worth a pass to tighten the tablet reflow once P0/P1 items are done.

---

## Not audited this pass (lower traffic, sample later if needed)
The 15 individual integration setup pages (`/integrations/github`, `/integrations/gcp`, etc.) were
not swept — these are mostly simple connect/config forms, lower visual surface area, and lower
priority than the main-nav pages above. Spot-check a couple after the P0/P1 items land; do not
block on them.

## Acceptance
1. Resize to 390px on any main-nav page → sidebar becomes a drawer/overlay, page content fully
   usable, no horizontal bleed.
2. History + Integrations tables at 1024px → all columns visible via contained horizontal scroll,
   no text overlap, no columns pushed off-screen invisibly.
3. Integrations hub at 1440px → no clipped chip text.
4. Workspace + Profile restyled to the current card/pill system (single shared fix if they share
   a component).
5. No "Remediation" chip visible on Integrations hub with `VITE_SHOW_WRITE_REMEDIATION` unset/false.
