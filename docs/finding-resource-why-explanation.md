# "Why this resource is affected" doesn't actually explain why (most checks)

**Spec / plan doc — composer implements.** The Resources tab's "why" column is supposed to say
why *this specific resource* tripped the check. For nearly all checks it doesn't — it repeats
static per-check boilerplate, and for the one visible in the current build (IAM least-privilege)
it shows a coded tag instead of using real data the backend already computed.

## Root cause

`web/src/components/FindingResourcesTab.tsx:58`, `resourceAffectedReason()`:
```ts
function resourceAffectedReason(finding: ResourcesTabFinding): string {
  const override = RESOURCE_AFFECTED_DETAIL[finding.check_id];
  if (override) return override;

  if (finding.check_id === "iam.role.least_privilege_policy") {
    const scope = finding.evidence?.scope;
    if (scope === "full_admin") return "Action:* + Resource:*";   // ← coded tag, not a sentence
    if (scope === "wildcard_action") return "Action:* (wildcard)";
    return "Broader than observed usage";
  }

  const summary = remediationSummaryForFinding(finding);
  return (summary.risk || summary.impact).replace(/\s*—\s*/g, ". ");  // ← same string for EVERY
}                                                                       //   resource under this check
```
- `RESOURCE_AFFECTED_DETAIL` (line 48) has genuine resource-level copy, but for **5 of ~159**
  check_ids (all S3).
- The IAM special case hardcodes `"Action:* + Resource:*"` — but
  `api/app/checks/iam_role_least_privilege.py:79-94` already computes `evidence.sources`, e.g.
  `"customer managed full admin: AdminAccessPolicy"` — **the actual offending policy name**. The
  frontend never reads it.
- Every other check (~153) falls back to `remediationSummaryForFinding(finding).risk` — a static
  string keyed by `check_id` in `web/src/data/remediationSummaries.ts`. It's identical for every
  resource under that check (e.g. every stale access key shows "Long-lived credential with no
  recent use", regardless of which key or how old). It explains the check, not the resource.

## Fix 1 — IAM least-privilege (immediate, data already exists)

Replace the coded tag with a sentence built from `evidence.sources` / `evidence.risk` (already on
the finding, already correctly computed backend-side):
```ts
if (finding.check_id === "iam.role.least_privilege_policy") {
  const sources = finding.evidence?.sources as string[] | undefined;
  if (sources?.length) return `Granted via ${sources.join("; ")}.`;
  // fallback only if evidence is somehow missing sources
  const scope = finding.evidence?.scope;
  return scope === "full_admin" ? "Grants full admin (Action:* + Resource:*)." : "Grants Action:* on scoped resources.";
}
```
Result: `"Granted via customer managed full admin: AdminAccessPolicy."` instead of
`"Action:* + Resource:*"` — names the actual policy, not just the shape.

## Fix 2 — the general pattern (audit, don't boil the ocean)

Don't attempt to hand-write resource-specific copy for all ~159 checks in one pass. Instead:

1. **Audit check evidence payloads** (`api/app/checks/*.py`) for ones that already store a
   resource-specific fact in `evidence` but aren't surfaced in `resourceAffectedReason` — the IAM
   case (Fix 1) is proof this pattern already exists elsewhere and is just unwired. Grep for
   checks whose `evidence={...}` includes named/specific fields (policy names, port numbers,
   principal ARNs, specific misconfigured settings) versus checks whose evidence is purely
   boolean/generic (just "this is on/off"). Prioritize the former — likely a meaningful chunk of
   the "high-signal" severity checks (IAM, security groups, KMS, trust policies) already carry
   this data; low-signal checks (e.g. "inactive 90 days") genuinely have nothing more
   resource-specific to say than the generic sentence, which is fine as-is.
2. **For checks with real per-resource evidence but no surfaced reason:** add a case to
   `resourceAffectedReason` (or generalize `RESOURCE_AFFECTED_DETAIL` into a function-per-check
   registry instead of a flat static-string map, so it can interpolate evidence fields) rather
   than adding entries one at a time to the flat map.
3. **For checks with genuinely nothing resource-specific to say:** leave the generic fallback —
   don't fabricate specificity that doesn't exist. Being honest that "this is just a category-wide
   rule" is fine; showing the same fake-specific sentence per resource is not.

## Acceptance

1. IAM least-privilege finding → Resources tab "why" column names the actual offending policy
   (e.g. "Granted via customer managed full admin: AdminAccessPolicy."), not "Action:* + Resource:*".
2. At least the highest-severity/highest-volume checks with genuine per-resource evidence (start
   with security-group, KMS, trust-policy, and other IAM checks — audit per step 1) get real
   resource-specific reasons instead of the static per-check fallback.
3. No regression: checks with no resource-specific evidence keep their current (honest, generic)
   fallback text — don't fabricate false specificity.
