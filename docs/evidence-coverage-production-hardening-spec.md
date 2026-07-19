# Technical Evidence Coverage — Production Hardening Spec

**Status:** Proposed  
**Owner:** Veritrail engineering  
**Source:** `premortem-report-20260719-230505.html`  
**Applies to:** Technical evidence capability lanes, provider integrations, control grading, audit exports, and the Compliance drawer

## 1. Purpose

The technical-evidence rollout has the correct product boundary: Veritrail automates evidence that can be proven from cloud, source-control, security, and operational systems. It does not claim to replace a GRC platform or automatically judge non-technical controls.

The remaining risk is not missing another long list of integrations. It is allowing incomplete, stale, permission-limited, or enablement-only data to look auditor-defensible.

This spec hardens the current implementation without redesigning the capability model or broadening Veritrail into manual GRC assessment.

## 2. Product invariant

> Veritrail may say a technical capability is **verified** only when a qualifying source supplied fresh, successful, scope-complete evidence for every applicable required lane.

The following must never be treated as verified:

- a connected integration with no successful capability collection;
- an enabled service without observable evidence;
- a partially paginated or interrupted inventory;
- a permission- or plan-limited response that prevents scope assessment;
- a scanner result without an authoritative eligible-asset denominator;
- stale evidence;
- a legacy summary that cannot distinguish “no findings” from “no data.”

Equivalent providers remain valid. A customer does not need Snyk when Dependabot or another connected source proves the same lane completely.

## 3. Premortem assessment

The HTML report is an input to this plan, not an implementation specification. Its claims divide into three groups.

### 3.1 Confirmed gaps

| Risk | Current evidence | Required response |
| --- | --- | --- |
| Capability health is shallower than connection health | `integration_health.py` can mark GitHub connected from `/user` even when security endpoints are denied or stale | Separate authentication health from evidence health and expose the last successful capability sync |
| Limitation codes reach the UI as internal strings | `Controls.tsx` replaces underscores in only the first limitation | Add a typed limitation registry with plain-language explanation and one action |
| Snapshot storage has no retention job | `capability_coverage_snapshots` is hourly-deduplicated but append-only | Add configurable retention and a scheduled prune task |
| GitHub pagination has no 429/Retry-After policy | Partial results are safely non-authoritative, but a large tenant can still consume worker capacity | Add bounded retries, budgets, completion metadata, and metrics |
| EDR has no live-tenant release gate | Unit tests validate request shapes, not real CrowdStrike/SentinelOne contracts | Keep EDR beta until one real provider passes Connect → sync → grade |
| Capability UI uses implementation vocabulary | Users see `Unknown`, `Stale`, and lightly humanized limitation codes | Replace with evidence-oriented language and a clear next action |
| Export does not publish an explicit defensibility decision | The lane JSON contains states and limitations, but consumers must interpret them | Add an export-safe verdict and invariant checks |

### 3.2 Partially valid risks

| Premortem claim | Current reality | Remaining work |
| --- | --- | --- |
| “Partial GitHub pages graded fresh” | `_paginate_list()` returns a non-200 final status and the collector does not mark that check authoritative; false resolution is already blocked | Add retry/fairness controls and explicit `collection_complete=false` telemetry |
| “Scanner activity can mark the whole scope covered” | `scanner_sync.py` deliberately supplies no asset denominator, so current scanner envelopes remain partial | Preserve this invariant and add regression tests at export level |
| “Any limitation should cap a lane at limited” | Some limitations are capability-blocking; others are informational or concern an optional module | Classify limitations instead of applying a blanket downgrade |
| “EDR pagination is unimplemented” | CrowdStrike offsets and SentinelOne `nextCursor` are implemented with loop guards | Add contract fixtures, maximum-page budgets, and explicit incomplete-collection behavior |
| “Mega-commit creates product risk” | True as an engineering-process risk, but not a runtime feature | Enforce scoped follow-up PRs and release checklists rather than adding product code |

### 3.3 Outdated or rejected recommendations

- **Manual nginx reload as an unfixed deploy requirement:** `scripts/bootstrap-ec2.sh` already reloads nginx after rebuilding and force-recreates it afterward. Keep this as a deployment smoke assertion; do not implement a duplicate fix.
- **Require every listed third-party scanner:** rejected. Provider equivalence is a core product rule.
- **Downgrade every lane with any limitation:** rejected. An unavailable optional vulnerability module must not invalidate separately complete device-health evidence. Only capability-blocking limitations affect the lane they prevent Veritrail from proving.
- **Treat an audit package as a complete SOC 2 assessment:** rejected. The package proves the technical evidence Veritrail collected and states its boundaries; it does not assess human processes.

## 4. Scope

### In scope

- capability grading and rollup invariants;
- typed limitations and their severity;
- provider collection completeness;
- capability-level integration health;
- rate-limit and tenant-fairness controls;
- live-provider beta/GA gates;
- snapshot retention;
- audit-export truthfulness;
- Compliance-drawer copy for capability lanes;
- tests, metrics, and rollout gates.

### Out of scope

- adding HRIS, MDM, or other non-essential integrations;
- manual policy/process assessment;
- replacing Vanta, Drata, Secureframe, Sprinto, or another GRC destination;
- redesigning the full Compliance page;
- making optional third-party scanners mandatory;
- changing finding severity or remediation scoring.

## 5. Required design

### 5.1 Typed limitation registry

Create one server-owned registry for every limitation emitted by capability collectors.

Each limitation definition must include:

```python
LimitationDefinition(
    code="permission_denied",
    impact="blocking",          # blocking | degrading | informational
    title="Permission required",
    explanation="Veritrail could not read the evidence needed to assess this capability.",
    action="Grant the required read permission, then sync again.",
)
```

Rules:

- **blocking** means the affected envelope cannot be `covered`;
- **degrading** means the envelope may be partial but cannot prove complete scope;
- **informational** does not change a complete lane when it concerns an optional, separately scoped capability;
- unknown limitation codes must fail closed as `degrading` and render generic safe copy;
- collectors emit codes only; API serializers attach display metadata;
- the browser must never humanize arbitrary snake_case itself.

Initial blocking or degrading codes must include:

- `permission_denied`
- `unavailable_by_plan`
- `unavailable_by_plan_or_tier`
- `enablement_only_legacy_snapshot`
- `legacy_sync_summary_only`
- `asset_denominator_not_collected`
- `scanner_connected_without_assessed_assets`
- `inspector_resource_coverage_not_collected`
- `enablement_only_plan_detail_missing`
- `enablement_only_no_plan_inventory`
- `threats_api_forbidden`
- `spotlight_vulnerabilities_not_licensed`
- `vulnerability_module_not_available`

The last three must be attached only to the capability they prevent. They must not automatically invalidate device/sensor coverage that was independently proven.

Proposed classification for codes emitted by the current implementation:

| Code or family | Default impact | Notes |
| --- | --- | --- |
| `permission_denied` | blocking | Evidence endpoint cannot be assessed |
| `unavailable_by_plan`, `unavailable_by_plan_or_tier` | blocking | Block only the capability gated by that plan |
| `collection_error` | blocking | A failed collection is not authoritative |
| `enablement_only_legacy_snapshot`, `legacy_sync_summary_only` | degrading | Legacy record proves neither activity nor full scope |
| `enabled_without_observable_activity` | degrading | Enablement alone is insufficient |
| `scanner_connected_without_assessed_assets`, `asset_denominator_not_collected` | degrading | External findings are not an eligible-asset inventory |
| `inspector_status_not_collected`, `inspector_resource_coverage_not_collected` | blocking | Inspector scope cannot be established |
| `osconfig_not_collected`, `scc_not_collected`, `defender_status_not_collected` | blocking | Native provider evidence is missing |
| `no_ec2_inventory`, `no_ecr_inventory`, `no_lambda_inventory`, `no_gce_inventory`, `no_azure_vm_inventory` | blocking until scope is established | Do not infer not-applicable from a missing inventory |
| `scc_aggregator_not_full_vm_coverage` | degrading | SCC findings alone do not prove full VM assessment |
| `enablement_only_plan_detail_missing`, `enablement_only_no_plan_inventory`, `servers_plan_not_confirmed` | degrading | Defender enablement does not prove assessed assets |
| `security_job_allows_failure` | degrading | CI security checks may not be enforced |
| `connected_without_security_signals` | degrading | Connection exists, evidence does not |
| `generic_elasticsearch_not_security_solution`, `base_datadog_without_cloud_siem_signals` | blocking for threat-detection lane | May remain informational for a separately proven generic logging lane |
| `splunk_index_not_configured`, `security_detection_rules_not_collected` | degrading | Operational signal scope is incomplete |
| `no_services_or_schedules`, `services_configured_without_incident_activity` | degrading | PagerDuty configuration alone does not prove incident operations |
| `spotlight_vulnerabilities_not_licensed`, `spotlight_vulnerabilities_unavailable`, `spotlight_query_error_*` | informational for sensor-health lane; blocking for vulnerability lane | Requires capability-specific attachment |
| `threats_api_forbidden`, `threats_query_error_*` | informational for agent-health lane; blocking for threat-evidence lane | Requires capability-specific attachment |
| `vulnerability_module_not_available` | informational for agent-health lane; blocking for vulnerability lane | Requires capability-specific attachment |

Tests must fail when a new static limitation code is emitted without a registry definition. Dynamic error families must resolve through a documented prefix definition rather than generating one registry row per HTTP status.

Likely files:

- `api/app/services/technical_capability.py`
- new `api/app/services/capability_limitations.py`
- `api/app/services/capability_lane_coverage.py`
- provider evidence builders
- API response schemas in `api/app/routes/controls.py`

### 5.2 Collection completeness envelope

Every paginated or multi-request collector must return collection metadata:

```json
{
  "collection_status": "complete",
  "pages_fetched": 4,
  "items_fetched": 327,
  "retry_count": 1,
  "limited_by": null,
  "started_at": "...",
  "completed_at": "..."
}
```

Allowed states:

- `complete`
- `partial`
- `failed`
- `permission_denied`
- `unavailable_by_plan`

Only `complete` may update `last_successful_scan_at`, authorize resolve-by-absence, or contribute a covered envelope. Partial rows may be stored for diagnostics but must not replace the last authoritative inventory.

Apply first to:

- GitHub Dependabot, code-scanning, and secret-scanning pagination;
- GitLab vulnerabilities and pipeline/security-job collection;
- CrowdStrike device and Spotlight pagination;
- SentinelOne agents and threats pagination;
- external scanner finding collection.

### 5.3 Capability-level health

Connection health and evidence health are different fields.

Required provider state:

```json
{
  "connection_status": "connected",
  "evidence_status": "degraded",
  "last_connection_check_at": "...",
  "last_successful_evidence_at": "...",
  "affected_capabilities": ["dependency_scanning"],
  "limitations": ["permission_denied"]
}
```

Requirements:

- the Integration Catalog may still say **Connected** when authentication works;
- it must also show **Evidence needs attention** when capability endpoints fail or age beyond their freshness window;
- a successful `/user` or token exchange must not reset evidence freshness;
- health checks must not call every expensive vendor endpoint; they may derive evidence health from the latest authoritative sync records;
- emit a structured alert when a provider remains connected while one or more previously covered lanes become stale or unknown.

### 5.4 Audit-export verdict

Add a derived field to each exported lane:

```json
{
  "audit_verdict": "verified_technical_evidence",
  "verdict_reason": "Fresh complete evidence covers 42 of 42 eligible repositories.",
  "scope_statement": "Technical repository scanning evidence only; policy operation is not assessed.",
  "blocking_limitations": []
}
```

Allowed verdicts:

- `verified_technical_evidence`
- `partial_technical_evidence`
- `insufficient_evidence`
- `not_applicable`

Export rules:

- `verified_technical_evidence` requires lane state `covered`, complete collection, a known denominator where applicable, fresh evidence, and no blocking limitation;
- a raw lane state and an export verdict must be derived by the same service, not independently recreated;
- every non-verified verdict must contain a precise reason and next action;
- the audit package must retain the product boundary that human policy/process operation is not assessed;
- generation must fail closed to `insufficient_evidence` if grading is unavailable. It must never silently omit the capability file or substitute “covered.”

Likely files:

- `api/app/services/technical_capability.py`
- `api/app/services/capability_lane_coverage.py`
- `api/app/services/evidence_pack.py`
- `api/app/services/pdf_narrative.py`

### 5.5 Rate limits and tenant fairness

For GitHub first, then other paginated providers:

- honor `Retry-After` and GitHub rate-limit reset headers;
- retry only idempotent reads;
- use capped exponential backoff with jitter;
- stop after a configured request, page, or wall-clock budget;
- record the collection as partial when a budget is exhausted;
- do not continue hammering the next repository after a secondary-rate-limit response;
- expose requests, pages, retries, duration, and budget exhaustion as structured metrics;
- checkpoint per-repository progress so one large organization does not monopolize both workers;
- preserve last authoritative evidence until a new complete run succeeds.

Initial defaults should be conservative and configurable. The implementation must document why each default fits the existing Celery 15-minute soft and 20-minute hard limits.

### 5.6 EDR beta and live validation

CrowdStrike and SentinelOne remain labeled **Beta** until one provider passes a real-tenant gate.

CrowdStrike requirements:

- explicit cloud-region presets plus custom base URL;
- OAuth error copy that distinguishes credentials, region, Hosts scope, and optional Spotlight licensing;
- contract fixtures for device offset pagination and Spotlight `after` pagination;
- host/sensor coverage remains separate from vulnerability-module coverage.

SentinelOne requirements:

- validate management URL before saving;
- contract fixtures for agents and threats `nextCursor` pagination;
- distinguish Agents permission from Threats/Vulnerability module access;
- host/agent coverage remains separate from optional vulnerability evidence.

The live validation record must contain no credentials. Record only provider, date, region, collected counts, resulting lane state, limitations, and the validating release SHA.

GA exit criteria:

- Connect succeeds against a real tenant;
- a multi-page sync completes;
- denominator matches the provider console within a documented tolerance;
- a permission denial produces non-covered evidence and useful UI copy;
- a second sync preserves stable counts and does not duplicate findings;
- disconnect removes credentials and stops future syncs.

### 5.7 Snapshot retention

Add `CAPABILITY_SNAPSHOT_RETENTION_DAYS` with a documented default of 400 days.

Add a daily task that:

- deletes capability snapshots older than the configured retention;
- deletes in bounded batches;
- records deleted count and oldest retained timestamp;
- is safe to rerun;
- does nothing when retention is `0` only if `0` is explicitly documented as unlimited;
- has unit tests and one database integration test.

Hourly deduplication remains. Retention must not affect immutable evidence artifacts governed by separate evidence-vault policies.

Likely files:

- `api/app/core/config.py`
- `api/app/models/capability_coverage.py`
- `api/app/worker/tasks.py`
- `api/app/worker/celery_app.py`
- new `api/app/services/capability_snapshot_retention.py`

### 5.8 Compliance UI language

Replace implementation states with evidence language:

| Internal state | User-facing title | Explanation pattern |
| --- | --- | --- |
| `covered` | Verified | “Fresh evidence covers X of X in-scope assets.” |
| `partial` | Incomplete evidence | “Evidence covers X of Y in-scope assets.” |
| `stale` | Evidence needs refresh | “The last complete evidence is N days old.” |
| `not_covered` | Capability not enabled | “No qualifying source is protecting the in-scope assets.” |
| `unknown` | Not enough evidence | “Veritrail could not determine coverage because …” |
| `not_applicable` | Not applicable | “No applicable assets were found in the connected scope.” |

UI requirements:

- do not display the word `rollup`;
- do not display raw limitation codes;
- show at most one primary explanation and one primary action per lane;
- retain provider, assessed/eligible denominator, freshness, and severe-open-finding counts as supporting metadata;
- `Unknown` must never appear without a reason;
- preserve the current clean card hierarchy; this is a copy and state-presentation change, not a page redesign.

Likely files:

- `web/src/pages/Controls.tsx`
- new `web/src/lib/capabilityPresentation.ts`
- `web/src/styles/compliance-page.css`

## 6. Delivery plan

Each phase must be a separate PR. Do not mix Findings, Accounts, Home, or unrelated CSS work into these changes.

### Phase A — Honesty invariants (P0)

- typed limitation registry;
- blocking/degrading/informational grading rules;
- collection-completeness field;
- export verdict and fail-closed assertions;
- unit tests covering every state transition.

**Exit:** no audit export can say verified while a blocking limitation, unknown denominator, stale timestamp, or incomplete collection exists.

### Phase B — Provider resilience (P0)

- GitHub rate-limit handling and request budgets;
- preserve-last-authoritative behavior;
- structured metrics;
- capability-level health derived from authoritative syncs.

**Exit:** a simulated 429 mid-pagination never resolves findings, never refreshes evidence, and does not starve unrelated tenant jobs.

### Phase C — EDR production gate (P1)

- Beta labels and regional UX;
- contract fixtures;
- live-provider validation record;
- capability-specific optional-module limitations.

**Exit:** at least one real EDR provider passes the GA checklist, or both remain Beta and are excluded from definitive audit claims.

### Phase D — Retention and deploy rehearsal (P1)

- snapshot retention setting and job;
- migration 0100 rehearsal against a production-sized copy;
- deploy smoke asserts API health, nginx routing, Controls response, and audit export after recreate;
- document expand/contract or rollback constraints.

**Exit:** staging can upgrade, recreate services, serve traffic, export evidence, and prune snapshots without manual intervention.

### Phase E — User-facing evidence language (P1)

- capability presentation registry;
- plain-language states, limitations, and actions;
- responsive and accessibility verification.

**Exit:** no raw enum or snake_case limitation appears in the Compliance drawer or audit narrative.

## 7. Test requirements

### Unit tests

- every limitation code has a registry entry;
- unknown codes fail closed;
- blocking limitations cannot coexist with `covered`;
- informational optional-module limitations do not invalidate unrelated complete evidence;
- complete/partial/failed collection transitions;
- export verdict matrix;
- snapshot retention boundaries;
- presentation copy for every internal state.

### Provider contract tests

- GitHub Link pagination, 403, 404, 429 with `Retry-After`, malformed body, and page-budget exhaustion;
- GitLab plan-gated and permission-denied responses;
- CrowdStrike regional OAuth, host offsets, Spotlight `after`, and optional-module 403;
- SentinelOne agents/threats cursors and optional-module denial;
- scanner response with findings but no denominator remains partial.

### Database integration tests

- migration 0100 upgrade from the previous revision;
- capability snapshot write, hourly deduplication, and retention prune;
- last authoritative evidence survives a failed or partial later sync;
- audit export persists and returns the same verdict as the Controls API.

### Browser verification

- every capability state renders with understandable copy;
- no raw limitation code is visible;
- action is specific and singular;
- cards remain usable at supported desktop and mobile widths;
- Connected + Evidence needs attention can appear together without contradiction.

### Live-provider smoke tests

- one real GitHub organization;
- one GitLab namespace when plan access exists, otherwise preserve a recorded plan-gated result;
- one AWS account with Inspector;
- one CrowdStrike or SentinelOne tenant before EDR GA.

## 8. Observability and release gates

Track at minimum:

- provider sync attempts, successes, partials, and failures;
- collection duration, pages, requests, retries, and budget exhaustion;
- capability lanes by state and provider;
- connected providers with stale/unknown capability evidence;
- audit exports by verdict;
- capability snapshot row count and prune count;
- collector failure rate by provider and release SHA.

Alert when:

- a previously covered lane becomes stale or unknown for more than one scheduled interval;
- a connected provider has no successful capability sync within its freshness window;
- more than a configured percentage of a tenant’s lanes regress simultaneously;
- provider 401/403/429 or collector failures rise materially after a release;
- snapshot pruning has not succeeded within 48 hours.

Release must be blocked when:

- any P0 invariant test fails;
- the audit verdict differs between Controls and the evidence package;
- a provider contract fixture shows partial collection as authoritative;
- a migration rehearsal or post-deploy smoke fails.

## 9. Definition of done

This hardening effort is complete when:

1. Veritrail cannot emit verified technical evidence from enablement-only, stale, incomplete, permission-limited, plan-limited, or denominator-less data.
2. Every non-verified state explains what is missing and what the customer should do next.
3. Authentication health and evidence health are separately visible.
4. Large-provider syncs are bounded, observable, and fair to other tenants.
5. EDR remains Beta until a real provider passes the documented gate.
6. Capability snapshots have a tested retention lifecycle.
7. Audit exports state exactly what technical evidence proves and explicitly preserve the human-process boundary.
8. Each implementation phase ships in a scoped, reviewable PR with its own tests.

## 10. Implementation handoff

Do not instruct an implementation agent to “fix the premortem report.” The HTML describes hypothetical failure stories and includes outdated assumptions.

Use this document as the source of truth. Begin with **Phase A — Honesty invariants**. Before editing code, produce a short file-level plan and identify any emitted limitation code not represented in the registry. Stop the phase if a proposed change would broaden Veritrail into non-technical control assessment or make an optional vendor mandatory.
