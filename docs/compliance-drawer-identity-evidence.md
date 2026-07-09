# Compliance drawer: show identity findings as blocking gaps + surface connected integrations

**Status: implemented (2026-07-08).** Three linked fixes so org-level identity evidence (Entra /
Google Workspace) reads correctly in the Compliance composite drawer.

Context: identity integrations now run on sync and persist **org-scoped** findings
(`account_id = NULL`), graded org-level (see `identity-integration-decoupling.md`). Backend grading
already includes them. The drawer and display-status label now reflect them.

---

## Fix 1 — Identity findings must appear under "Blocking gaps" (frontend) ✅

**Root cause:** `web/src/pages/Controls.tsx` (~line 4138) builds `findingCountByCheck` from a single
account-scoped fetch:
```js
fetchAllFindings({ status: "open", ...findingsScopeParams(activeAccount) })
```
Org-scoped identity findings (`account_id NULL`) are excluded, so `entra.*` / `google_workspace.*`
checks show count 0 and never render under "Blocking gaps" (drawer section ~line 3150/3268), even
though the composite grades off them.

**Change:** also fetch org-scoped identity findings and merge into `openFindingsMeta`
(`byId`, `countByCheck`, `severityByCheck`).

- Add a second query: `fetchAllFindings({ status: "open", provider: "identity" })` (the identity
  Findings scope added in the decoupling spec §6). This is org-level — **not** gated on
  `activeAccount`/`hasScanned` (identity findings exist without a cloud scan). Guard it on the org
  having a connected identity provider (a cheap flag from the integrations query) to avoid a wasted
  call when none is connected.
- Merge both result sets into the same `countByCheck` / `byId` / `severityByCheck` maps in
  `openFindingsMeta`. De-dupe by finding id.
- After merge, `entra.org.mfa_not_enforced` etc. carry a count → they render under "Blocking gaps"
  and `regularFailing` counts them.

**Shipped:** second React Query fetch in `Controls.tsx` (guarded on Entra/Google Workspace
connected), merged into `openFindingsMeta` with de-dupe by finding id.

**Acceptance:** with Entra synced (MFA-not-enforced open), open the Identity Governance & Access
Review drawer → "Blocking gaps" lists the Entra MFA + admin findings, with an AWS account selected or
not.

---

## Fix 2 — Absence gap must not mask real failures (backend display status) ✅

**Root cause (original):** `api/app/services/category_evidence_coverage.py` downgraded any composite
with open absence-gap checks to `needs_evidence` ("Coverage gap"), even when real high-severity
findings (Entra MFA) also failed it.

**First fix (2026-07-08):** only downgrade when absence gaps are the *only* open findings; mixed
absence + real failure → `failing`.

**Second fix (2026-07-08):** retire absence-gap → `needs_evidence` for scannable AWS composites
entirely. Pure absence gaps (GuardDuty off, Config off, Access Analyzer off, etc.) → `failing`
because enabling the service in a connected account lets Veritrail grade the control. **Coverage
gap** is reserved for external-only categories (`endpoint_security`, `mdm_endpoint`, `hr_training`,
`vendor_risk`) via `_external_evidence_category_status` / `externalEvidenceCompositeDisplayStatus`.

**Acceptance:** Identity Governance & Access Review (Entra MFA failing + Access Analyzer off) displays
**Failing**, not Coverage gap. A scannable AWS composite whose *only* open finding is an absence
gap (GuardDuty off, Config off, etc.) also displays **Failing** — enabling the service in a
connected account lets Veritrail grade it. **Coverage gap** is reserved for external-only categories
(endpoint security, MDM, HR training, vendor risk) and structural cross-account cases.

---

## Fix 3 — Surface connected integration as an evidence source (drawer) ✅

Auditors/users should see *where* the evidence came from. Today the drawer only shows
`registry_vendor` (external uploads), nothing for a live identity integration.

**Backend:** on each composite row in `list_composite_controls`, add
`evidence_integrations`: the connected `IdentityProvider`s whose check prefixes intersect the
composite's `check_ids`. Shape:
```json
"evidence_integrations": [
  {"type": "entra", "label": "Entra ID", "connected": true, "last_synced_at": "2026-07-08T…"}
]
```
Reuse `load_integration_sync_grading_context`'s provider lookup + `check_prefix_for_provider_type`.
Include source-control (github/gitlab) here too for parity where relevant.

**Frontend:** in the composite drawer header (near the status pill) or the Evidence tab, render a
quiet source note when `evidence_integrations` is non-empty:
> Identity evidence from **Entra ID** · synced 2h ago

Small badge/row, not a big card — it's provenance, not a primary action. Relative-time the
`last_synced_at`. If multiple, list them.

**Shipped:** `evidence_integrations_for_check_ids` in `composite_controls.py`, exposed on
`CompositeControlOut`; `EvidenceIntegrationSourceNote` in drawer header + Gaps tab body.

**Acceptance:** the Identity Governance drawer shows an "Entra ID · synced …" source badge; a composite
with no connected integration shows nothing new.

---

## Notes
- Fixes 1 + 3 are read-only display; Fix 2 is a status-semantics change — smallest blast radius but
  most important to test.
- All three are the same story: identity integration evidence now flows to grading; make the **drawer
  and labels** tell that story truthfully.
