# Checklist redesign — implementation spec

**Status:** ready to implement · **Owner:** frontend · **Created:** 2026-07-16

Implements the locked `/checklist` redesign (the final `SOC 2 Readiness.dc.html` comp:
light + teal, readiness ring, category split-bar, four muted phase tints). This is the
spec — an implementer (Codex or a fresh session) can build from it without re-deriving.

The comp is a **look + interaction target**, not literal markup. Keep our real data flow
and component structure; change presentation + one data split only.

---

## 0. Ground truth (verify before editing)

| Thing | Where |
|---|---|
| Component | [`web/src/components/ComplianceChecklist.tsx`](../web/src/components/ComplianceChecklist.tsx) (~1050 lines) |
| Styles | [`web/src/styles/compliance-page.css`](../web/src/styles/compliance-page.css) |
| Manual evidence hints | [`web/src/lib/manualEvidenceHints.ts`](../web/src/lib/manualEvidenceHints.ts) — `manualEvidenceHint(framework, controlId) → {expected, integration?}` |
| Absence-gap vs named-resource logic | [`web/src/lib/evidenceGap.ts`](../web/src/lib/evidenceGap.ts), `ChecklistStepResourceDisplay.tsx` |

Current model (do **not** invent a new one — extend it):
- `type ChecklistState = "verified" | "action" | "manual"` (`ComplianceChecklist.tsx:40`)
- `type ChecklistPhaseId = "technical-gaps" | "evidence-required" | "completed"` (`:41`)
- `phaseVisibleInPhase` (`:462`): `technical-gaps` ← `action`, `evidence-required` ← `manual`, `completed` ← `verified`.
- Hero lives in `.compliance-checklist__intro-side` (`:931`) → `.compliance-checklist__progress` (label `<strong>{counts.verified}</strong> of {total}` + a single `.compliance-checklist__progress-bar` filled to `verifiedPct`).
- `counts` = `Record<ChecklistState, number>` (`:547`); `total = counts.verified + counts.action + counts.manual` (`:555`); `verifiedPct` (`:557`).
- Phases render from `CHECKLIST_PHASES` (`:955`); each has `phase-summary` + `ChecklistGroupChip` (tone amber/violet/green today) + expandable body with `renderPlaybookGroups` + `renderManualGroup`.

**Already correct — leave alone:** the drawer (1c design), phase semantics, the honesty line, the absence-gap summary-tile vs resource-cards split, and the action verbs **Enable / Connect / Attach evidence / Review** (never "Fix").

**Already teal:** the app accent is `--vt-teal` = `#0d9488` (== the comp's teal). There is **no** blue→teal conversion; some checklist elements still read flat/neutral, that's what tier 1 fixes.

---

## Tier 1 — reskin (CSS only, no logic change) · low risk

Apply in `compliance-page.css` directly (do **not** bolt on a separate override stylesheet — it fights specificity and rots on refactor).

**Palette (from the comp — muted, distinct, not loud):**

| Role | Tint | chip bg / text / dot | solid (bar/dot) |
|---|---|---|---|
| Enable / technical | amber | `#f9f3e8` / `#946a1c` / `#cf9a3e` | `#d9a441` |
| Connect / sources | indigo | `#eef0f9` / `#4a568f` / `#6f7fc4` | `#6f7fc4` |
| Attach / human evidence | violet | `#f1eefa` / `#6a58a6` / `#9d8ad0` | `#9d8ad0` |
| Completed / inherited | teal | `#e6f5f3` / `#0b7c72` / `#0d9488` | `#0d9488` |
| Surfaces | — | page `#f4f6f8`, card `#fff`, border `#e7ebf0`, muted text `#5c697d`/`#7b8798`, bar track `#eceff3` |

Changes:
1. **Hero as an elevated card** — `.compliance-checklist__intro` on white, `border:1px solid #e7ebf0`, `border-radius:20px`, soft lift shadow `0 18px 40px -24px rgba(16,24,40,.16)`, `padding:32px 36px`. Today it's flat.
2. **Phase number chip** — replace the bare chevron-only header with a 30×30 rounded mono numeral chip (`1`/`2`/`3`, check for Completed) tinted per phase (amber/indigo/violet/teal). Keep the existing chevron for expand.
3. **`ChecklistGroupChip` tones** — extend to `amber | indigo | violet | teal | neutral`; map each phase to its tint.
4. **Phase progress bar** — thicken to ~7px, fill color = phase tint (amber/indigo/violet, teal 100% for Completed).
5. **Row dots** — colored by phase tint (`amber`/`indigo`/`violet`), Completed rows use the teal check. Today they're one grey — either tint or remove; do not leave identical grey noise.
6. **Group cards** — `border-radius:16px`, hairline border, subtle shadow; open card gets a deeper lift (`0 18px 42px -28px rgba(16,24,40,.22)`).

---

## Tier 2 — hero ring + category split-bar (TSX in `intro-side`) · low risk

All values already exist (`counts`, `total`, `verifiedPct`). No backend change. Replace the single flat progress bar with:

1. **Readiness ring** — SVG donut, `r≈74`, `stroke-width 16`, track `#eceff3`, **fill = teal by verified only** (`stroke-dasharray = verifiedPct% of circumference`, so **empty at 0/10** — honest). Center: bold count `{counts.verified}` (46px) + `/{total}` (22px, muted) + uppercase `VERIFIED` label. This is the page's focal anchor.
2. **Category split-bar** — one horizontal bar (~16px, radius 6, track `#eceff3`) whose segments are sized `flex` by count and colored by category, so the bar itself shows the split:
   - **Unify with the phase tints (fixes the comp's nit):** technical=amber `#d9a441`, connect=indigo `#6f7fc4`, attach=violet `#9d8ad0`, verified=teal `#0d9488`. (The comp lumped evidence as one violet; use the 4-tint split so hero == phases.)
   - Legend below: swatch + count + label for each non-zero category.
3. Keep **Export audit package** as the primary teal button in the action rail (already there via `action`), **Re-scan** as the ghost secondary, and the "will flag N open items" note.

Data for the split (post-tier-3): technical = `counts.action`; connect = manual items with `collectionMode==="connect"`; attach = manual items with `collectionMode==="upload"`; verified = `counts.verified`. Pre-tier-3: technical = `counts.action`, evidence = `counts.manual`, verified = `counts.verified` (3 buckets).

---

## Tier 3 — split Connect vs Attach into two phases · product decision + medium

**This is a product call, not just code:** should the checklist separate "Connect a source"
(ongoing auto-collect — Jira, SIEM, MDM) from "Attach a file" (one-time upload — runbook,
policy)? The comp does. It's defensible; confirm before building.

**Recommended approach — frontend-only (no backend/readiness API change):**

1. Add a discriminator to each manual control via `manualEvidenceHints.ts`:
   `collectionMode: "connect" | "upload"`. This is a **per-control product classification**,
   not inferable from `integration?` alone (CC7.3 and CC7.4 both have Jira links today, but
   the comp routes 7.3→Connect, 7.4→Attach). Classification per the comp:

   | Control | Mode | Phase | Action |
   |---|---|---|---|
   | CC7.3 incident evaluation (Jira triage tickets) | connect | Connect | Connect → integration flow |
   | CC7.2 endpoint/log evidence (MDM / SIEM feed) | connect | Connect | Connect → integration flow |
   | CC7.4 incident response plan + exercise | upload | Attach | Attach evidence → upload |
   | CC6.5 media disposal policy | upload | Attach | Attach evidence → upload |
   | CC6.4 physical security | — | Completed | AWS inheritance (already covered) |

2. Extend the model:
   - `ChecklistPhaseId`: add `"evidence-connect"` and `"evidence-attach"`; retire the single
     `"evidence-required"` (or keep as fallback). Update `readStoredPhaseIds` allow-list (`:135`)
     and `CHECKLIST_PHASES` (`:105`).
   - `ChecklistState`: keep 3 states; **route manual items to the two phases by `collectionMode`**
     in `manualControlsByPhase` (don't add a 4th state — phase, not state, carries the split).
   - `phaseVisibleInPhase`: `evidence-connect`/`evidence-attach` both accept `state==="manual"`,
     filtered by the item's `collectionMode`.
3. **Connect action** = link to `/integrations` (or the provider's connect flow) for that source,
   **not** the upload modal. **Attach action** = existing evidence-upload flow (unchanged).
4. Hero split-bar + counts pick up the connect/attach split automatically once the routing exists.

**Alternative (cheaper, skip the model change):** keep 3 phases, render Connect and Attach as
two **groups inside** `evidence-required` with the indigo/violet tints. Loses the top-level phase
count separation but avoids the `ChecklistPhaseId` change. Pick this if the product answer to
"do we split?" is "visually yes, structurally not yet."

---

## Acceptance criteria

1. `/checklist` matches the comp: light surfaces, teal accent, four muted phase tints, ring anchor, category split-bar. No dark chrome.
2. Ring fills by **verified count only** — empty at 0/10, center shows bold `{verified}/{total}`.
3. Split-bar segments + legend show the real category split (technical / connect / attach / verified) by color.
4. Each phase (Enable/Connect/Attach/Completed) is visually distinct via number chip + group chip + phase bar + row dots — restrained saturation.
5. Verbs stay Enable / Connect / Attach evidence / Review. Drawer, honesty line, absence-gap logic unchanged.
6. Tier 3 (if built): manual items route to Connect vs Attach by `collectionMode`; Connect links to the integration flow, Attach opens upload.
7. `npx tsc --noEmit` clean; `npm run build` green.

## Reference

Locked comp: `SOC 2 Readiness.dc.html` (final "energy" iteration — ring back + 4-tint phases +
colored split-bar + colored row dots). Ask the owner for the file if not attached.
