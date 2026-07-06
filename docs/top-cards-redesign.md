# Top selector cards — redesign

Standardize the top-of-page selectors (Account, and where present Period / Framework / Group) into the
pill-card style in the reference mock, apply consistently across every page that has account selection,
and add the full card row to History. **Spec only — composer implements.**

---

## The card design (match the mock exactly)

Each selector is a **rounded pill-card**, not a plain dropdown:

- Rounded rectangle, white fill, subtle 1px border, light shadow; ~44–48px tall, horizontal padding.
- **Left:** small provider/section icon in a tinted square (AWS logo for Account, calendar for Period,
  SOC badge for Framework, people icon for Group).
- **Middle (stacked):** tiny uppercase-ish **label** on top (e.g. "Account", "Period", "Framework",
  "Group"), **value** below in stronger weight (e.g. "amit-shemesh-clc", "90 days", "SOC 2",
  "All groups").
- **Right:** chevron-down.
- Cards sit in a single horizontal row with even gap, left-aligned, at the very top of the page.

Build **one reusable component** (e.g. `SelectorCard` / `TopFilterCard`) that takes `{ icon, label,
value, onClick }` and wraps the existing dropdown behavior. Reuse it for all selectors so they're
pixel-consistent. The existing `AccountFilterDropdown` should render in this card shape (or be wrapped
by it) rather than the current plain trigger.

---

## Page-name text — remove it (except catalog)

- **Remove** the redundant top-left **page-name text** (the small page label in the top chrome — e.g.
  "History", "Findings") on all pages. The card row + the page's own descriptive header (big icon +
  title + subtitle, like "History / View audit & compliance events") stay — only the duplicate
  top-left label goes.
- **Exception: the Integration Catalog page** keeps its top-left text — there it functions as a
  **return/back button** ("Integrations › Workflow integrations"). Leave that intact.
- Reference: `web/src/Layout.tsx` renders page/subpage labels (`INTEGRATION_SUBPAGE_LABELS`). That's
  where the top-left page-name likely lives.

---

## Apply the card row to every page with account selection

Same card treatment everywhere the account picker appears — consistent component, consistent position:

- **Findings** — Account card (single Account/scope selector; it's the merged scope picker now:
  All cloud accounts / accounts / Source control).
- **Compliance / Controls** — Account card (+ Framework card if the page filters by framework).
- **Accounts** — Account card if applicable.
- **History** — full row: **Account · Period · Framework · Group** (see below).

Wherever the picker currently renders via `HeaderSlot` / `HeaderFilterBar` / `AccountFilterDropdown`,
swap the trigger to the new `SelectorCard` shape. Do not change the underlying data/selection logic —
only the presentation.

---

## History page — add the full card row

`web/src/pages/HistoryV2.tsx` already has these filters (currently plain dropdowns): account, period,
framework, group. Render them as the **four cards** in the mock:

- **Account** (AWS icon) — existing account selector.
- **Period** (calendar icon) — existing period/days selector (e.g. "90 days").
- **Framework** (SOC badge) — existing framework selector ("SOC 2").
- **Group** (people icon) — existing group selector ("All groups").

Row sits at the very top; the "History / View audit & compliance events" descriptive header + search +
filter + help + user avatar stay in the row beneath, as in the mock.

---

## Out of scope / guardrails

- No change to selection logic, data, or URL params — presentation only.
- Keep each selector's existing dropdown menu/behavior; only the **trigger** becomes a card.
- Don't remove the catalog page's top-left return text.
- Keep the descriptive page headers (title + subtitle) — only the duplicate top-chrome page-name goes.

---

## Acceptance

- One reusable card component used by Account/Period/Framework/Group triggers across pages.
- Findings / Controls / History show the account (and page-relevant) selectors as cards matching the
  mock (icon + stacked label/value + chevron).
- History shows all four cards in a top row.
- Top-left page-name text gone on all pages except the catalog (return button intact).
- Descriptive page headers unchanged; tsc clean; no selection-behavior regressions.

---

## Refinements (v2 — after first pass)

First pass shipped but needs polish:

1. **Kill the white box behind icons.** The left icon currently sits on a weird white background tile.
   Remove that — icon should sit on a transparent or lightly-tinted square that matches the card fill,
   no hard white box. (AWS/provider logos keep their own colors; just drop the white container.)

2. **Stronger value typography.** The value line (e.g. "amit-shemesh-clc", "90 days", "SOC 2") reads too
   weak. Bump it: heavier weight (~600), slightly larger, darker ink. The tiny label above stays muted/
   uppercase — increase the *contrast* between label (light) and value (strong). Match the reference
   mock's hierarchy.

3. **More space between cards.** Increase the gap between cards; it's cramped. It's fine to **expand the
   whole top section** to fit — the row is not constrained to the current width. Give it room to breathe.

4. **Framework card icon = dynamic per compliance, not static.** On the Controls/Compliance page the
   framework card uses one static badge. Make it reflect the **selected framework's** icon — reuse the
   existing `FrameworkMark` component (`Soc2Mark` / `CisMark` / `IsoMark` in
   `web/src/components/FrameworkMark.tsx`) so SOC 2 → SOC mark, ISO → ISO mark, CIS → CIS mark. Same for
   the group/framework card wherever it shows a compliance icon — dynamic, not one hardcoded favicon.

5. **Constrain the Account dropdown width.** The account card's dropdown menu is far wider than the card.
   In `AccountFilterDropdown` the menu min-width is `Math.max(rect.width, 360)` — the `360` forces it
   wide. Reduce it so the menu roughly matches the trigger card width (allow a modest max, e.g. clamp to
   the card width up to ~320px, not a hard 360 floor). Menu should read as an extension of the card,
   not overflow well past it.
