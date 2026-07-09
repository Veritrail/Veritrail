# Starter Scope — Integrations Cleanup

Direction: Veritrail is **cloud compliance evidence (AWS / GCP / Azure)** with minimal
workflow integrations. Not CSPM/GRC/SIEM. Trim the integration surface so the starter
product shows only what's core + validated, without deleting dormant backend code.

**Do not delete backend, routes, checks, or tests.** This is UI/visibility + copy only.
Hidden integrations keep working if deep-linked or already connected.

---

## Decision: what stays visible vs hidden

**Keep visible (starter set):**

| Group | Keys | Why |
|---|---|---|
| Source control | `github`, `gitlab` | Change-management (CC8) + Secure SDLC evidence |
| Identity | `entra`, `google-workspace` | Access-control (CC6) evidence: MFA, admin review, inactive users — core SOC2, **not** sprawl |
| Workflow | `jira`, `slack` | Remediation tickets, scan alerts |

Cloud accounts (AWS/GCP/Azure) are **not** catalog entries — they live in Accounts. Leave them there.

**Hide (dormant, not deleted):** the category-competing / unvalidated cluster.

| Group | Keys |
|---|---|
| Scanners | `snyk`, `wiz`, `tenable`, `qualys`, `orca`, `aikido` |
| SIEM/monitoring | `splunk`, `datadog`, `elastic` |
| IaC / other | `iac-repository`, `azure-devops` (`azure-devops` is already `comingSoon`) |

Rationale: scanners/SIEM pull Veritrail into CSPM/vuln-mgmt/SIEM competition it should avoid,
and most are not validated end-to-end (Snyk/Aikido are paid-tier-gated and can't be tested on
free plans). Identity providers are deliberately **kept** — they are legitimate CC6 evidence.

---

## Change 1 — Gate hidden integrations behind an env flag

File: `web/src/lib/integrationCatalog.ts`

- Add a static set of extended keys:

```ts
export const EXTENDED_INTEGRATION_KEYS: ReadonlySet<string> = new Set([
  "snyk", "wiz", "tenable", "qualys", "orca", "aikido",
  "splunk", "datadog", "elastic",
  "iac-repository", "azure-devops",
]);

const SHOW_EXTENDED_INTEGRATIONS =
  import.meta.env.VITE_SHOW_EXTENDED_INTEGRATIONS === "true";

export function isStarterHiddenKey(key: string): boolean {
  return EXTENDED_INTEGRATION_KEYS.has(key) && !SHOW_EXTENDED_INTEGRATIONS;
}
```

- There is already a `hiddenKeys` gate: `isAvailableCatalogEntry(entry, hiddenKeys)` (~L121),
  and `filterCatalog` / `catalogExploreEntries` / `catalogEntryCount` all take `hiddenKeys`.
  **Fold the extended gate into the existing check** so there is one visibility source — do not
  add a parallel filter. In `isAvailableCatalogEntry` (and the two inline `!hiddenKeys.has(...)`
  filters), also exclude keys where `isStarterHiddenKey(entry.key)` is true.

- `hiddenKeys` itself is computed in `web/src/hooks/useConnectedCatalogState.ts` (~L137). Leave
  that computation as-is; the extended gate is applied on top in the catalog helpers.

Net effect with the flag unset (default): starter catalog shows only
`github, gitlab, entra, google-workspace, jira, slack`. Setting
`VITE_SHOW_EXTENDED_INTEGRATIONS=true` restores the full catalog for internal use.

---

## Change 2 — Fix recommended-integration tiers

File: `web/src/lib/integrationCatalog.ts` (~L162–168)

Current (wrong order — IaC/Jira/Slack recommended before Git):

```ts
export const RECOMMENDED_INTEGRATION_TIER_1 = ["iac-repository", "jira", "slack"] as const;
export const RECOMMENDED_INTEGRATION_TIER_2 = ["github", "gitlab"] as const;
export const RECOMMENDED_INTEGRATION_TIER_3 = ["google-workspace"] as const;
```

Replace with:

```ts
// Source control first (change-management evidence), then workflow helpers.
export const RECOMMENDED_INTEGRATION_TIER_1 = ["github", "gitlab"] as const;
export const RECOMMENDED_INTEGRATION_TIER_2 = ["jira", "slack"] as const;
export const RECOMMENDED_INTEGRATION_TIER_3 = ["entra", "google-workspace"] as const;
```

- Keep `RECOMMENDED_KEYS` union type in sync with the new tier contents.
- Drop `iac-repository` from recommendations (it is now hidden by default anyway).
- Tier 3 (identity) is optional/last — not pushed up front.

**GitHub vs GitLab nit:** most orgs use one, so recommending both as "connect these" reads odd.
If the recommended-integrations UI renders each tier key as its own card, group Tier 1 as a single
"Connect source control (GitHub or GitLab)" prompt instead of two separate cards. If that's a bigger
change, leave both cards for now — lower priority than the reorder.

---

## Change 3 — Retitle the Integrations page as workflow sidecars

Files: `web/src/pages/Integrations.tsx` and/or `web/src/pages/IntegrationCatalog.tsx`
(whichever renders the catalog header/subtitle).

- Header copy: "Integration catalog" → **"Workflow integrations"** (or "Evidence sources").
- Subtitle: something like **"Connect Git, identity, Jira, and Slack to enrich your cloud
  evidence."** Framing: these are sidecars that feed the evidence pack, not the product itself.
- Do not imply an app marketplace / equal-maturity ecosystem.

---

## Also worth doing (separate, lower priority — not required for the above)

These came out of the same review; listed for later, not part of the hide/reorder pass.

1. **Simplify user-facing status.** Collapse the internal state machine
   (`pass/fail/at_risk/no_data/passing/failing/needs_evidence/externally_covered/out_of_scope/
   not_applicable/accepted/submitted/rejected/expired/superseded`) to **four** labels in the main
   UI: **Passing · Needs review · Needs evidence · Failing.** Expose the raw automated/evidence/
   display statuses only in the control drawer.

2. **External-evidence cards as auditable objects.** Each uploaded-evidence card should surface:
   Submitted by · Reviewed by · Accepted at · Expires at · SHA-256 · Included in pack. The backend
   already tracks these (reviewer gate, hash, signed download, audit log) — surface them.

3. **Maturity honesty.** Only badge an integration "ready" once it's validated end-to-end. Today
   only Jira is fully validated; others should read "beta" or carry no ready badge.

---

## Out of scope for this pass

- Homepage (owner: ignore for now).
- Billing / pricing surfaces.
- Deleting any backend, routes, checks, or tests for hidden integrations.
