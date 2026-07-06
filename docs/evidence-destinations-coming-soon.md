# Evidence destinations — "coming soon" cards

Add a new **Evidence destinations** section to the integrations catalog with **coming-soon**
placeholder cards for the GRC tools Veritrail will push evidence into. **UI signal only — no adapter,
no API code.** This does not violate the master-plan guardrail ("don't build the destination adapter
before §F validates") — these are non-functional roadmap cards, not a working integration.

**Spec only — composer implements.**

---

## Why this is separate from §F

The master plan's §F (GRC feed) is a *validation spike you run*, not a build — that's why nothing
appeared on the integrations page. This doc adds only a **visible "coming soon" placeholder** so the
product signals direction to buyers. It's honest (labeled coming-soon) and trivially removable if the
push validation fails for a given platform.

---

## What to add

### 1. Brand assets (the real work)

`web/src/lib/integrationBrands.ts` has **no** entries for these. Add them:
- Extend the `IntegrationBrandId` union with `"vanta"`, `"drata"`, `"secureframe"`, `"sprinto"`.
- Add `INTEGRATION_BRAND` records with each logo (`src`, optional `compactSrc`, `fallback`).
- Drop the official logos into `web/public/integrations/` (`vanta.png`, `drata.png`,
  `secureframe.png`, `sprinto.png`). If a real logo isn't handy, a neutral placeholder + the existing
  `fallback` mechanism is fine for a coming-soon card — don't block on assets.

### 2. New catalog category

`web/src/lib/integrationCatalog.ts` → add to `INTEGRATION_CATALOG`:

```ts
{
  id: "evidence-destinations",
  title: "Evidence destinations",
  blurb: "Push Veritrail evidence into your GRC platform (coming soon).",
  entries: [
    { key: "vanta",       brand: "vanta",       name: "Vanta",       description: "Push control-mapped evidence into Vanta.",       tags: ["GRC", "Evidence", "SOC 2"], comingSoon: true },
    { key: "drata",       brand: "drata",       name: "Drata",       description: "Push control-mapped evidence into Drata.",       tags: ["GRC", "Evidence", "SOC 2"], comingSoon: true },
    { key: "secureframe", brand: "secureframe", name: "Secureframe", description: "Push control-mapped evidence into Secureframe.", tags: ["GRC", "Evidence", "SOC 2"], comingSoon: true },
    { key: "sprinto",     brand: "sprinto",     name: "Sprinto",     description: "Push control-mapped evidence into Sprinto.",     tags: ["GRC", "Evidence", "SOC 2"], comingSoon: true },
  ],
},
```

- **No `href`** — matches the `azure-devops` coming-soon pattern (non-clickable placeholder).

### 3. Make sure coming-soon cards actually render

`isAvailableCatalogEntry` (integrationCatalog.ts ~L142) returns `false` for `comingSoon || !href`, so
these entries are **excluded from the "available/browse" list**. Confirm the catalog page renders a
**coming-soon section/state** (the way `azure-devops` shows today) — if the page only maps
`catalogExploreEntries` (available only), these cards won't appear at all. Whichever component shows
`azure-devops` as "coming soon" is the render path to reuse; ensure the new category flows through it.

### 4. Keep them out of counts / recommendations

- Do **not** add these keys to any recommended tier.
- Coming-soon entries should not inflate the "N available integrations" count (they already don't, via
  `isAvailableCatalogEntry`) — verify after adding.

---

## Copy

- Section title: **Evidence destinations**
- Blurb: **"Push Veritrail evidence into your GRC platform (coming soon)."**
- Card badge: **Coming soon** (reuse the existing coming-soon badge/styling from `azure-devops`).

---

## Out of scope

- No OAuth/API/push code, no adapter, no connect flow — cards are non-functional placeholders.
- Don't gate behind `VITE_SHOW_EXTENDED_INTEGRATIONS` — these are core direction, meant to be visible.
- Keep it easy to remove a single card if that platform's push validation (§F) comes back negative.

---

## Acceptance

- Integrations page shows an **Evidence destinations** section with 4 coming-soon cards (Vanta, Drata,
  Secureframe, Sprinto), badged "Coming soon", not clickable.
- Cards render logos (or clean placeholder), don't appear in recommendations, don't change the
  available-integration count, no console errors.
- tsc clean.
