# Spec — EDR Beta must not produce verified verdicts

**Status:** ready to implement · **Audience:** implementing agent (Cursor) · **Do not implement from chat context — this doc is self-contained**

**Related:** Phases A–E of `docs/evidence-coverage-production-hardening-spec.md` (already landed). Live-tenant gate: `docs/edr-live-validation-record.md` and hardening §5.6.

> Line numbers below were verified against the tree at authoring time. Re-confirm symbols with a quick search before editing; treat them as anchors, not frozen absolute truth.

---

## 1. Problem

CrowdStrike / SentinelOne remain labeled **Beta** until a real-tenant GA gate (`docs/edr-live-validation-record.md`, hardening §5.6). Today “Beta” is **display metadata only** and is never consulted during grading:

| Anchor | What it does today |
| --- | --- |
| `api/app/services/edr_integrations.py` `public_config` ~L145–175 | Always emits `"beta": True` in the public config payload. Nothing in grading reads it. |
| `api/app/routes/edr_integration.py` `get_edr` ~L72 | Empty/not-configured response also hard-codes `"beta": True`. |
| `api/app/services/capability_lane_coverage.py` EDR ingest ~L522–534 | Loads every connected EDR provider via `envelopes_from_edr_config(provider_config(ep))` and `all_envelopes.extend(...)` with **no validation gate**. |
| `api/app/services/edr_integrations.py` `envelopes_from_edr_config` ~L473–515 | Rebuilds `EvidenceEnvelope` rows from stored `capability_evidence`, preserving collector `status` (including `"covered"`). |
| `api/app/services/capability_lane_coverage.py` `_summarize_lane` ~L274–380 | Merges envelope statuses → lane `status`; then `audit_verdict_for_lane` can emit `verified_technical_evidence`. |
| `api/app/services/technical_capability.py` `rollup_control_status` ~L477–504 | Control is `"verified"` when every applicable required lane is `"covered"`. |
| `api/app/services/capability_lane_coverage.py` operational rollup ~L637 | `"verified" if lane.get("status") in ("covered", "not_applicable")`. |
| `api/app/services/evidence_pack.py` ~L422–468 | Writes `capability_lane_coverage.json` with per-lane `audit_verdict` from `audit_verdict_for_lane`. |

**Honesty failure:** an unvalidated Beta EDR source can be load-bearing for `host_workload_scanning` (and thus Vulnerability Management), drive lane `status="covered"`, and export `audit_verdict="verified_technical_evidence"`. Labeling the integration “Beta” does not prevent a false verified claim.

Hardening §5.6 / live-validation record already say Beta must not be treated as definitive audit claims. This spec closes the runtime gap.

---

## 2. Goal and non-goals

### Goal

Evidence from an EDR provider that has **not** passed the live-validation GA gate:

1. Remains **visible** (coverage counts, open findings, providers, limitations, freshness).
2. **Cannot** raise a lane to `covered` or a control/export to `verified` / `verified_technical_evidence` when that EDR evidence is **load-bearing**.
3. Surfaces a new lane state **`unvalidated`**: evidence shown, verdict withheld.

### Non-goals (do not implement in this change)

- Completing the full production-hardening checklist.
- Expanding evidence-health beyond GitHub.
- Adding DB/migration CI without Docker.
- Making vitest a committed CI dependency (optional note only).
- Wiring hardening §5.3 / §8 alerting.
- Building a customer-facing “GA validation wizard” UI.
- Changing CrowdStrike/SentinelOne collectors, pagination, or sync behavior.

**Explicit:** after this change alone, **do not declare** technical-evidence production hardening complete.

---

## 3. Design (implement exactly)

Two pieces:

1. Per-provider **`ga_validated`** flag (default `False`).
2. New **`unvalidated`** `CoverageState`, applied with a **load-bearing** demotion that mirrors incomplete-collection demotion.

### 3.1 `ga_validated` flag — data shape and operator flip

**Storage:** boolean on the EDR provider’s existing config JSON (same blob read by `provider_config` / written by `set_provider_config` in `api/app/routes/edr_integration.py`).

```json
{
  "ga_validated": false,
  "capability_evidence": [ ... ],
  "device_count": 12,
  "...": "existing fields unchanged"
}
```

| Field | Type | Default when missing | Meaning |
| --- | --- | --- | --- |
| `ga_validated` | `bool` | **`False`** | Provider has passed the live-tenant GA gate for this org’s connection. |

**Honest default:** on deploy, every connected EDR provider is unvalidated until an operator flips the flag after completing `docs/edr-live-validation-record.md`. Missing key ≡ `False`. Never infer `True` from `"beta": True` being absent, sync success, or device counts.

**Read path:**

- `envelopes_from_edr_config(cfg, ...)` (or its caller at `capability_lane_coverage.py` ~L531–534) must resolve `bool(cfg.get("ga_validated") is True)` — only explicit `True` validates.
- `public_config` (~L145–175) should expose `"ga_validated": bool(cfg.get("ga_validated") is True)` alongside the existing `"beta": True` badge so operators can see honesty state. Keep `"beta": True` until product policy changes the catalog label; `ga_validated` is the **grading** gate, not a rename of the Beta badge.

**Operator flip (smallest honest approach — implement this, mark as v1):**

- Add an **admin-only** route on the EDR router, e.g. `PUT /edr/{vendor}/ga-validated` with body `{ "ga_validated": true | false }`.
- RBAC: same admin dependency as `put_edr` (`RequireAdmin`).
- Implementation: load provider → `config = dict(provider_config(provider))` → set `config["ga_validated"]` → `set_provider_config(provider, config)` → return `EdrIntegrationOut` with updated `public_config`.
- **Do not** auto-set `ga_validated` from Connect/sync success.
- **Do not** build a Controls/Integrations toggle UI in this change (follow-up). Ops/admin API is enough for v1.
- Docstring / OpenAPI description must state: set `true` only after the checklist in `docs/edr-live-validation-record.md` is satisfied for that provider.

Reject larger alternatives for v1: env-wide feature flags, per-release hardcoding, or treating catalog `beta: false` as validated.

### 3.2 New lane state: `unvalidated`

**Semantics:**

| State | Meaning |
| --- | --- |
| `partial` | Covered for **some** in-scope assets (scope incomplete). |
| `unvalidated` | Evidence collected from a source that is **not trusted for verdicts yet** (GA gate not passed). Verdict withheld. |

**Do not reuse `partial` for Beta.** Conflating them re-breaks the honesty model.

### 3.3 Load-bearing enforcement rule (surgical)

Mirror the existing incomplete-collection demotion in `_summarize_lane`:

```322:338:api/app/services/capability_lane_coverage.py
    # Incomplete collection on any envelope cannot leave the lane covered.
    collection_statuses = [e.collection.collection_status for e in envelopes]
    coll_status: str = "complete"
    if any(s != "complete" for s in collection_statuses):
        ...
    merged = apply_limitation_impacts(
        merged,  # type: ignore[arg-type]
        limitations,
        collection_status=coll_status,  # type: ignore[arg-type]
    )
```

**Rule (implement after the collection demotion above, still inside `_summarize_lane` ~L274–380):**

1. **Tag** EDR envelopes from providers where `ga_validated is not True`:
   - Set `EvidenceEnvelope.validated = False` (new field; default `True` for all non-EDR / validated sources).
   - Append limitation code `edr_unvalidated_beta` on those envelopes (and surface it into lane `limitations` when relevant).
2. Compute `merged` through the **existing** path first (scope merge → `merge_lane_states` → `vendor_absence_does_not_fail` → incomplete-collection `apply_limitation_impacts`).
3. **Load-bearing check** — only demote when unvalidated EDR is what holds `covered` up:

   ```
   if merged == "covered" and any(not e.validated for e in envelopes):
       state_without_unvalidated = <same summarization merge over envelopes where e.validated is True only>
       # If there are zero validated envelopes, treat state_without_unvalidated as "unknown"
       if state_without_unvalidated != "covered":
           merged = "unvalidated"
           # ensure "edr_unvalidated_beta" is in lane limitations
   ```

4. Otherwise leave `merged` unchanged.

**Consequences (must hold):**

| Scenario | Result |
| --- | --- |
| Only unvalidated Beta EDR, collector status `covered` | Lane → `unvalidated` (not `covered`, not `partial`) |
| Validated Inspector / cloud-native / etc. alone covers the lane; Beta also present | Lane stays `covered` (Beta not load-bearing) |
| Validated source covers; no Beta | Unchanged |
| Lane already `partial` / `stale` / `not_covered` / `unknown` from validated sources; Beta also present | **Stay** that state — do **not** rewrite to `unvalidated` unless step 3 would have demoted a `covered` merge |
| Incomplete collection + load-bearing Beta | Collection demotion runs first; if result is not `covered`, load-bearing rule no-ops. If somehow still `covered`, load-bearing then forces `unvalidated`. Prefer: never emit `covered` when either rule applies. |

Extract a small helper if needed (e.g. `_merge_scope_states(envelopes) -> CoverageState`) so the “without unvalidated” pass does not duplicate the scope-union logic at ~L287–294.

### 3.4 State plumbing checklist

#### Backend — `api/app/services/technical_capability.py`

| Symbol | Anchor | Change |
| --- | --- | --- |
| `CoverageState` | ~L22–29 | Add `"unvalidated"`. |
| `PASSING_STATES` | ~L201 | Must **not** include `unvalidated`. |
| `FAILING_ACTION_STATES` | ~L202–204 | **Include** `unvalidated` so `rollup_control_status` returns `action_needed`. |
| `EvidenceEnvelope` | ~L257–274 | Add `validated: bool = True`. Include in `as_dict()`. |
| `envelope()` helper | ~L530+ | Pass-through / default `validated=True` (callers that build EDR rows set False). |
| `merge_lane_states` | ~L445–474 | If `unvalidated` appears in inputs: never return `covered`. Prefer: any `unvalidated` with no sole-`covered` from other states → `unvalidated`; `covered` + `unvalidated` → `unvalidated` **only if** you rely on merge for demotion — preferred design keeps demotion in `_summarize_lane` and still hardens merge so a stray `unvalidated` cannot promote. |
| `rollup_control_status` | ~L477–504 | `unvalidated` is non-covered; `"verified"` only when all applicable lanes are `"covered"` (existing check already fails closed if `FAILING_ACTION_STATES` includes `unvalidated`). |
| `audit_verdict_for_lane` | ~L651–747 | New branch: `status == "unvalidated"` → `audit_verdict="insufficient_evidence"` (or a dedicated reason string; **not** `verified_technical_evidence`, **not** `partial_technical_evidence`). Reason example: “Evidence is present from an unvalidated Beta provider; verdict withheld until live validation.” |

Optional but recommended: register `edr_unvalidated_beta` in `api/app/services/capability_limitations.py` `LIMITATION_REGISTRY` as **informational** or **degrading** (not required to block via `apply_limitation_impacts` — the load-bearing rule owns demotion). Provide title/explanation/action for Controls copy.

#### Backend — `api/app/services/capability_lane_coverage.py`

| Symbol | Anchor | Change |
| --- | --- | --- |
| EDR ingest loop | ~L522–534 | Pass `ga_validated` into envelope construction (via `envelopes_from_edr_config` reading cfg, or set `validated` on returned envelopes). |
| `_summarize_lane` | ~L274–380 | Load-bearing demotion after ~L334–338; action copy for `unvalidated` (e.g. “Complete live validation for this EDR provider before treating host/workload evidence as verified”). |
| Operational rollup | ~L637 | `unvalidated` must not map to `"verified"`. |

#### Backend — `api/app/services/edr_integrations.py` / routes

| Symbol | Anchor | Change |
| --- | --- | --- |
| `public_config` | ~L145–175 | Expose `ga_validated`. |
| `envelopes_from_edr_config` | ~L473–515 | Set `validated=bool(cfg.get("ga_validated") is True)` on each `EE(...)`; if not validated, append `edr_unvalidated_beta` to limitations (dedupe). |
| `api/app/routes/edr_integration.py` | ~L66–178 | Add admin `PUT .../ga-validated` as in §3.1. |

#### Evidence pack — `api/app/services/evidence_pack.py`

| Anchor | Change |
| --- | --- |
| ~L422–468 `capability_lane_coverage.json` | No special-case required if lane status + `audit_verdict_for_lane` are correct: unvalidated lanes must not export `verified_technical_evidence`. Keep the existing fail-closed recheck at ~L436–440. |

#### Frontend

| File | Anchor | Change |
| --- | --- | --- |
| `web/src/lib/capabilityPresentation.ts` | `CapabilityLaneStatus` ~L7–14; `STATUS_COPY` ~L38–82; `presentCapabilityLane` ~L94–116 | Add `"unvalidated"`; copy title e.g. **“Unvalidated (Beta)”**; explanation: evidence collected, verdict withheld until live validation; `statusClass` remains `lane.status` (`unvalidated`). Prefer `verdict_reason` when present (already supported). |
| `web/src/pages/Controls.tsx` | `CapabilityLanesPanel` ~L2586–2615 | Uses `presentCapabilityLane` and `is-${lane.status}` — ensure CSS covers `is-unvalidated`. |
| `web/src/styles/compliance-page.css` | `.capability-lanes__status` ~L4122–4140 | Add `.is-unvalidated` — withheld/neutral (not teal covered, not “incomplete amber” if that would imply partial scope). Example: muted slate, distinct from `.is-covered` / `.is-partial`. |

Do **not** treat `unvalidated` as the covered class in presentation tests or CSS.

---

## 4. Files to change (checklist)

- [ ] `api/app/services/technical_capability.py` — `CoverageState`, `EvidenceEnvelope.validated`, `PASSING_STATES` / `FAILING_ACTION_STATES`, harden `merge_lane_states` / `rollup_control_status`, `audit_verdict_for_lane`.
- [ ] `api/app/services/capability_lane_coverage.py` — tag at EDR ingest; load-bearing demotion in `_summarize_lane`; operational rollup.
- [ ] `api/app/services/edr_integrations.py` — `ga_validated` in `public_config` + `envelopes_from_edr_config`.
- [ ] `api/app/routes/edr_integration.py` — admin PUT to flip `ga_validated`.
- [ ] `api/app/services/capability_limitations.py` — register `edr_unvalidated_beta` (recommended).
- [ ] `api/app/services/evidence_pack.py` — verify export path; change only if verdict plumbing needs a guard.
- [ ] `web/src/lib/capabilityPresentation.ts` (+ optional test file).
- [ ] `web/src/styles/compliance-page.css` — `is-unvalidated`.
- [ ] Tests in §5.

---

## 5. Tests (definition of done)

Prefer placing tests next to existing lane/EDR tests:

- `api/tests/test_capability_lane_coverage.py` (already imports `_summarize_lane`), and/or
- `api/tests/test_edr_integrations.py` (already imports `envelopes_from_edr_config`).

Build envelopes with `EvidenceEnvelope` / `envelope()` / small fixtures — unit-test `_summarize_lane` directly so tests do not need Docker or live EDR.

### Guard test 1 — beta alone → `unvalidated`

**Name:** `test_edr_beta_alone_is_unvalidated_not_verified`

**Setup:** one lane (`host_workload_scanning`) with a single EDR envelope: `status="covered"`, `validated=False`, limitation includes `edr_unvalidated_beta`, non-zero coverage counts / open findings.

**Assert:**

- `_summarize_lane(...).status == "unvalidated"`
- `audit_verdict` ≠ `verified_technical_evidence` (expect `insufficient_evidence`)
- coverage counts and open findings still present (evidence not dropped)
- `rollup_control_status` / operational rollup path does not treat the lane as verified

### Guard test 2 — validated → verified

**Name:** `test_edr_ga_validated_can_verify`

**Setup:** same envelope shape with `validated=True` / config `ga_validated=True` (and no blocking limitations / incomplete collection).

**Assert:**

- lane `status == "covered"`
- `audit_verdict == "verified_technical_evidence"` (subject to existing completeness rules)

### Guard test 3 — beta not load-bearing → stays `covered`

**Name:** `test_edr_beta_not_load_bearing_keeps_covered`

**Setup:** a **validated** non-EDR envelope (e.g. cloud-native / Inspector-style) for the same capability/scope that independently grades `covered`, **plus** an unvalidated Beta EDR envelope also claiming `covered`.

**Assert:**

- lane `status == "covered"` (Beta must not demote a validated verdict)
- `audit_verdict` may remain verified if other honesty rules pass

### Run commands

From repo root (API container — preferred when compose is up):

```bash
docker compose exec -T api python -m pytest -q \
  tests/test_capability_lane_coverage.py -k 'edr_beta or edr_ga_validated or edr_beta_not_load_bearing'
```

Or if tests live in the EDR module:

```bash
docker compose exec -T api python -m pytest -q \
  tests/test_edr_integrations.py -k 'beta_alone or ga_validated or not_load_bearing'
```

Local venv alternative (when API deps are installed):

```bash
cd api && python -m pytest -q tests/test_capability_lane_coverage.py -k 'edr_beta or edr_ga_validated or edr_beta_not_load_bearing'
```

**Frontend (optional, not a merge gate unless vitest is committed — see §8):**

```bash
cd web && npx vitest run src/lib/capabilityPresentation.test.ts
```

Assert `status: "unvalidated"` maps to withheld copy/class, never covered styling semantics.

---

## 6. Acceptance criteria

1. Fresh deploy / missing `ga_validated`: every connected EDR provider is unvalidated; a host/workload lane covered **only** by that EDR shows `unvalidated`, not `covered`.
2. Controls and evidence-pack exports show evidence but **no** `verified` / `verified_technical_evidence` claim sourced solely from unvalidated EDR.
3. Setting `ga_validated=true` via the admin API restores normal `covered` / verified behavior for that provider (when other honesty rules pass).
4. A lane already `covered` by Inspector / cloud-native / other validated sources stays `covered` when unvalidated Beta EDR is also attached (load-bearing rule).
5. Non-EDR orgs (GitHub/cloud-only) produce **identical** lane statuses before/after this change.
6. `unvalidated` is never presented as `partial` in API or UI copy.
7. Flipping `ga_validated` does not require a code deploy; Connect/sync alone never sets it to `true`.

---

## 7. Rollback

- Additive and fail-closed by default (`ga_validated` missing → unvalidated).
- To revert behavior: remove load-bearing demotion + `unvalidated` branches; ignore `ga_validated` in config.
- No DB migration required (flag lives in provider config JSON). Stale `ga_validated` keys left in JSON are harmless if unread.
- Admin route can be removed with the feature; no customer data loss.

---

## 8. Out of scope / follow-ups (verified gaps)

Do **not** rubber-stamp hardening complete after shipping this spec. Track separately:

| Gap | Grounding |
| --- | --- |
| Evidence-health is GitHub-only | `api/app/services/capability_evidence_health.py` `capability_evidence_health_for_org` ~L144–146 only appends rows for `github` / `github_app`; comment says later phases. |
| No DB/migration test run in CI without Docker | Hardening added retention/migrations elsewhere; current `api/tests/*integration*` are provider-integration style, not an alembic/DB migration suite runnable without compose/Docker. |
| Vitest presentation test may not be a committed dep / CI step | `web/src/lib/capabilityPresentation.test.ts` imports `vitest`, but `vitest` is not a reliable committed CI gate in `web` (runs via transient `npx` if at all). |
| Completeness metadata still sparse on some collectors | Hardening §5.2 / Phase A patterns exist; not all collectors emit rich `CollectionMeta` into every envelope path. |
| Alerting from hardening not fully wired | Hardening §5.3 requires structured alerts when connected providers leave lanes stale/unknown; not fully implemented as production routing. |
| EDR live GA itself | This change enforces Beta honesty; it does **not** complete the live-tenant gate in `docs/edr-live-validation-record.md` / hardening §5.6. |

**Do not declare the hardening complete after this change alone.**

---

## 9. Implementer notes

- Keep evidence **visible**; withhold the **verdict**.
- Prefer demotion in `_summarize_lane` (lane-level), same shape as incomplete collection — do not delete envelopes.
- `beta` (UI badge) and `ga_validated` (grading gate) are related but distinct; both can be true that a provider is still labeled Beta in catalog while an ops-validated tenant is allowed to verify.
- Re-read hardening §5.6 and the live validation record before flipping any production `ga_validated` flag.
- After implementation, run the three guard tests in §5; if any fails, the honesty model is still broken.
