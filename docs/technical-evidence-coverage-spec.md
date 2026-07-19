# Technical evidence coverage — provider-equivalence implementation spec

**Status:** IMPLEMENTED (Phases 0–5) · **Priority:** product core · **Owner decision:**
approved direction, July 19, 2026 · **Customer contract:**
[`coverage-boundaries.md`](./coverage-boundaries.md) updated for shipped collectors/grading.
Honest gaps (unlicensed EDR modules, GitLab Ultimate-only APIs, missing cloud permissions)
surface as `unknown` / limitations — never false verification.

## 1. Product position

Veritrail is the technical evidence-collection layer that feeds GRC platforms such as
Vanta and Drata. It does not attempt to assess non-technical controls from end to end, and
it must not require customers to recreate evidence manually when a connected technical
system already exposes that evidence through an API.

The product must evaluate **evidence capabilities**, not preferred vendor names.

> A customer satisfies a technical evidence capability when at least one connected,
> credible source provides current, sufficiently scoped, machine-verifiable evidence for
> it. No specific third-party product is mandatory when an existing native provider offers
> equivalent evidence.

Examples:

- GitHub Dependabot can satisfy dependency-vulnerability evidence for covered repositories.
- Amazon Inspector can satisfy relevant AWS compute, container, Lambda, dependency, and
  code-vulnerability evidence.
- GCP Security Command Center and its underlying sources can satisfy the GCP evidence they
  actually report.
- Microsoft Defender for Cloud can satisfy the Azure workload evidence enabled by the
  customer's Defender plans.
- Snyk, Wiz, Tenable, Qualys, Orca, and Aikido remain optional alternative evidence
  providers. Their absence alone must never fail a control.

This is **provider equivalence**, not provider interchangeability: tools count only for the
asset classes and evidence types they demonstrably cover.

## 2. Non-negotiable rules

1. **No vendor-presence grading.** Never fail a control because Snyk, Wiz, Splunk,
   PagerDuty, CrowdStrike, or another named vendor is not connected.
2. **No enablement-only verification.** “Enabled” is setup evidence, not proof that the
   capability is operating effectively.
3. **No umbrella vulnerability claim.** Dependabot coverage must not imply that hosts,
   containers, cloud workloads, source code, or secrets are covered.
4. **No double counting.** Two providers reporting the same vulnerability improve source
   confidence but do not create two fulfilled requirements.
5. **No silent gaps.** Unsupported asset classes and repositories must surface as partial
   coverage, not disappear from the denominator.
6. **No over-claiming aggregators.** SCC, Security Hub, Defender for Cloud, Datadog, Elastic,
   and Splunk count only when the relevant product/source, plan, rule, and data flow are
   active—not merely because the platform is connected.
7. **Evidence must be attributable.** Every verdict needs provider, scope, observed-at,
   collected-at, source identifier, and an evidence payload or immutable reference.
8. **The current contract stays honest.** Product copy and audit exports claim new coverage
   only after the corresponding collector, grading logic, and tests ship.

## 3. Capability model

The existing broad `vulnerability_management` composite remains the customer-facing rollup,
but it must be calculated from explicit internal capability lanes.

| Capability lane | What qualifies | Example providers |
|---|---|---|
| Dependency scanning (SCA) | Supported repositories are scanned; alerts, severity, state, age, and resolution are collectable | GitHub Dependabot, GitLab dependency scanning, Snyk |
| Source-code scanning (SAST) | Analysis runs on the default branch and/or pull requests; alert state and severity are collectable | GitHub CodeQL, GitLab SAST, Amazon Inspector Code Security |
| Secret scanning | Repository scanning is active; open alerts and bypass/dismissal state are collectable where supported | GitHub secret scanning, GitLab secret detection |
| CI security enforcement | Required security jobs run on protected branches/merge requests and cannot be silently bypassed | GitHub Actions, GitLab pipelines |
| Container-image scanning | In-scope registries/images are scanned; coverage and current findings are collectable | Inspector/ECR, GitLab container scanning, Defender for Containers |
| Host/workload scanning | In-scope compute is scanned; exclusions, freshness, and current findings are collectable | Inspector/EC2, GCP OS Config/SCC sources, Defender for Servers, CrowdStrike, SentinelOne |
| Serverless scanning | Supported functions and dependencies are scanned | Inspector/Lambda and equivalent native services |
| Cloud findings/posture | Relevant vulnerability or misconfiguration findings are active and attributable to affected resources | GCP SCC, Defender for Cloud, AWS Security Hub/Inspector |
| Finding operations | Findings have state, severity, age, owner or workflow reference, and resolution history | Native provider plus Jira; provider-native workflow |

### Coverage states

Each lane returns one of these states:

| State | Meaning |
|---|---|
| `covered` | A qualifying source covers the expected scope and its evidence is fresh |
| `partial` | A source exists, but some expected repositories/assets/regions/plans are missing or stale |
| `not_covered` | No qualifying evidence source covers the expected scope |
| `stale` | The capability exists, but the last successful evidence exceeds its freshness policy |
| `not_applicable` | The organization has no assets in this lane, supported by inventory evidence |
| `unknown` | Veritrail cannot establish the denominator or lacks permission to assess it |

`unknown` must never be treated as passing. `not_applicable` requires positive inventory
evidence; an empty collector response is not enough.

### Control rollup

- A technical control is **Verified** only when every applicable required lane is `covered`,
  or when accepted external evidence explicitly covers a lane Veritrail cannot automate.
- It is **Action needed** when a lane is `partial`, `not_covered`, or `stale` and Veritrail
  can identify a technical fix.
- It is **Needs evidence** only for genuinely non-automatable or human-process proof—not as
  a fallback for a technical API Veritrail has not implemented yet.
- The UI must expose the lane breakdown behind the rollup so customers can see exactly what
  is and is not covered.

## 4. Required evidence envelope

Normalize every provider result into a shared envelope before grading:

```json
{
  "capability": "dependency_scanning",
  "provider": "github_dependabot",
  "scope_type": "repository",
  "scope_id": "org/repository",
  "asset_type": "source_repository",
  "status": "covered",
  "enabled": true,
  "last_observed_at": "2026-07-19T09:00:00Z",
  "last_successful_scan_at": "2026-07-19T08:45:00Z",
  "coverage": { "eligible": 1, "assessed": 1, "excluded": 0 },
  "open_findings": { "critical": 0, "high": 2, "medium": 4, "low": 1 },
  "oldest_open_finding_at": "2026-06-22T10:10:00Z",
  "source_reference": "provider-specific immutable or API identifier",
  "limitations": []
}
```

The exact persistence model is an implementation decision, but adapters must emit this
semantic shape. Existing finding rows may remain the operational record; capability
snapshots should preserve historical coverage independently of finding lifecycle.

## 5. Provider requirements

### 5.1 GitHub — deepen the existing integration

Current Veritrail evidence primarily records whether Dependabot, code scanning, and secret
scanning are enabled. That is necessary but insufficient.

Implement:

- Dependabot alert ingestion: repository, dependency, ecosystem, manifest, advisory/CVE,
  severity, state, created/fixed/dismissed timestamps, dismissal reason, and fix availability.
- Code-scanning alert ingestion: tool, rule, severity/security severity, state, branch/PR,
  introduced/fixed timestamps, and dismissal reason.
- Secret-scanning alert ingestion where licensed and permitted: alert state, secret type,
  validity where available, resolution, and push-protection bypass evidence.
- Repository denominator: active in-scope repositories versus repositories with each
  feature active.
- GitHub Actions evidence: workflow existence, recent successful execution, security job
  conclusion, default-branch and pull-request triggers, required status checks, protected
  environments, and approval requirements where applicable.
- Coverage must distinguish unavailable-by-plan, permission denied, intentionally excluded,
  archived, disabled, and never configured.
- A repository with Dependabot enabled but no successful/observable security activity must
  not automatically become fully verified.

### 5.2 GitLab — parity with GitHub semantics

Deepen the existing GitLab integration to ingest:

- dependency, SAST, secret-detection, and container-scanning pipeline results;
- pipeline/job freshness and failure state;
- protected-branch and merge-request enforcement;
- project denominator and scanner coverage;
- dismissal/false-positive state where the GitLab API exposes it.

GitHub and GitLab must produce the same normalized capability states even though their APIs
and licensing differ.

### 5.3 AWS — deepen native evidence before requiring external scanners

The existing connector already has Inspector account-status, coverage, findings, and finding-
details permissions and an active-critical-finding check. Expand it to:

- grade Inspector coverage independently for EC2, ECR, Lambda standard, Lambda code, and
  supported code-repository scanning;
- collect eligible versus assessed resources, exclusions, unsupported resources, scan
  status, and last-scanned time;
- ingest active findings across severities, not only critical findings;
- calculate unresolved age and remediation state;
- preserve region/account scope and organization/delegated-administrator gaps;
- treat ECR basic scanning and Inspector enhanced scanning according to the evidence each
  actually provides;
- use AWS inventory to mark lanes `not_applicable` only when the relevant asset class is
  positively absent.

AWS Inspector may satisfy several lanes, but each lane is graded separately.

### 5.4 GCP — deepen SCC and OS Config

The current collector reaches OS Config vulnerability reports and SCC findings, but its
checks are still baseline-level. Implement:

- SCC service/tier/source inventory;
- active and inactive vulnerability findings with category, class, severity, resource,
  event/create/update times, CVE fields, mute state, and source;
- explicit differentiation between vulnerability, misconfiguration, threat, and other
  finding classes;
- OS Config eligible VM denominator, report freshness, missing agents/reports, and CVE
  findings where available;
- GKE/container and registry evidence only when a connected SCC source or supported native
  API actually supplies it;
- organization/folder/project scope and permission-degraded states;
- source-level limitations in the normalized evidence envelope.

SCC is an aggregation plane. “SCC accessible” is not equivalent to “all GCP workloads are
covered.”

### 5.5 Azure — deepen Defender for Cloud

The current implementation primarily checks Defender enablement/pricing and secure-score
data. Implement:

- enabled plans and relevant plan extensions by subscription;
- eligible versus assessed machines, registries/images, Kubernetes/container workloads,
  databases, and other supported workload classes;
- Defender recommendations/sub-assessments that represent vulnerability findings;
- finding severity, state, affected resource, CVE, first/last observed time, and remediation;
- coverage/freshness and agentless/agent-based limitations;
- subscription and management-group gaps;
- `not_applicable` only from positive Azure Resource Graph inventory.

“Defender enabled” must not imply that Defender for Servers, Containers, or another relevant
plan is active and assessing every eligible resource.

## 6. Approved operational integrations

These integrations broaden technical evidence, but they remain conditional providers—not
universal prerequisites.

| Integration | Capability it may satisfy | Required depth |
|---|---|---|
| Splunk | logging, security detection, alert operations | relevant indexes/sources, ingestion freshness, search/alert health, security signals—not merely API connectivity |
| Elastic Security | logging, detection, alert operations | security solution/rules and current alert evidence—not a generic Elasticsearch cluster |
| Datadog | monitoring and, when licensed/configured, Cloud SIEM | monitors/signals, data freshness, enabled rules and relevant source coverage—not base Datadog presence |
| PagerDuty | on-call and incident operations | schedules/escalation policies, services, incidents, acknowledgement/resolution evidence; not threat detection |
| CrowdStrike | endpoint/workload vulnerability and detection evidence exposed by licensed modules | managed-device denominator, sensor health/freshness, relevant findings/detections |
| SentinelOne | endpoint/workload vulnerability and detection evidence exposed by licensed modules | managed-device denominator, agent health/freshness, relevant findings/detections |
| Jira | remediation workflow evidence | ticket linkage, state, owner, timestamps, resolution; never counted as threat detection or incident-response telemetry |
| Entra ID / Google Workspace | identity evidence | existing scope; maintain provider-equivalent identity semantics |

PagerDuty, Splunk, Elastic, and Datadog already have integration surfaces or backend support
in the repository. Their next step is evidence-depth and capability grading, not another
catalog entry.

CrowdStrike and SentinelOne are approved additions. They reverse the July 2026 decision to
exclude all EDR from the product, but only for machine-verifiable technical evidence. Human
endpoint-policy administration remains outside Veritrail's scope.

## 7. Optional providers

Wiz, Tenable, Qualys, Snyk, Orca, and Aikido remain supported or planned as optional sources.
They are valuable when a customer uses them, but the Compliance page must never display
“Connect Snyk” or “Connect Wiz” as the only route to verification when native evidence
already satisfies the lane.

Provider selection order for a lane:

1. Use every connected qualifying source.
2. Merge duplicate findings using provider identifiers plus CVE/resource/package context.
3. Calculate coverage from the union of assessed assets against the authoritative inventory
   denominator.
4. Show source attribution and conflicts.
5. Recommend another integration only for a concrete uncovered asset class—not as generic
   setup advice.

## 8. UI and audit-package behavior

### Compliance

- The Vulnerability Management drawer shows lane-level coverage, not a single opaque pass.
- Each lane shows status, provider(s), scope, freshness, assessed/eligible count, open severe
  findings, and a concise limitation when partial.
- Actions name the missing capability: “Enable dependency scanning for 4 repositories,” not
  “Connect Snyk.”
- Provider recommendations appear only after Veritrail establishes a real evidence gap.

### Findings

- Provider-native alerts become normal Veritrail findings with source attribution.
- Duplicate provider reports may be grouped, but raw source references remain available.
- Dismissed/muted findings retain reason and actor where the provider exposes them.

### Audit package / GRC feed

Export:

- capability state and rationale;
- assessed/eligible/excluded counts;
- provider and scope attribution;
- evidence freshness;
- open-finding summary and remediation age;
- limitations and permission degradation;
- immutable references or captured evidence snapshots.

The export must distinguish “no findings detected” from “no data collected.”

## 9. Delivery plan

### Phase 0 — shared semantics and honesty

- Add capability IDs, coverage states, evidence envelope, freshness policies, and rollup
  rules.
- Add tests proving vendor absence does not fail coverage when an equivalent provider
  satisfies the lane.
- Add tests proving enablement alone cannot return `covered`.
- Preserve existing customer-facing claims until later phases ship.

### Phase 1 — deepen source control and CI/CD

- GitHub Dependabot, CodeQL/code-scanning, secret-scanning, and Actions evidence.
- GitLab dependency/SAST/secret/container results and pipeline enforcement.
- Repository denominator and partial-coverage UI.

This is the highest priority because customers already rely on these native tools and the
current implementation mostly checks feature enablement.

### Phase 2 — native cloud vulnerability parity

- AWS Inspector coverage, freshness, all-severity findings, and asset-class grading.
- GCP SCC/OS Config source and finding depth.
- Azure Defender plan, coverage, recommendation, and sub-assessment depth.
- Cross-cloud normalized evidence and audit export.

### Phase 3 — operational evidence depth

- Splunk, Elastic Security, Datadog, and PagerDuty capability grading.
- Keep monitoring, threat detection, incident operations, and remediation workflow as
  separate lanes.

### Phase 4 — endpoint evidence

- CrowdStrike and SentinelOne connectors through the shared provider adapter.
- Device denominator, agent/sensor health, freshness, detections, and vulnerability evidence
  only where licensed APIs provide it.

### Phase 5 — optional scanner parity

- Normalize existing/planned Wiz, Tenable, Qualys, Snyk, Orca, and Aikido adapters into the
  same evidence envelope.
- Remove any UI or grading paths that privilege one vendor over equivalent native evidence.

## 10. Acceptance criteria

1. A customer using Dependabot and GitHub Actions can receive verified dependency-scanning
   and CI-enforcement evidence without connecting Snyk, when every eligible repository is
   covered and evidence is fresh.
2. That same customer does **not** receive verified host/container/runtime coverage unless
   another qualifying source covers those assets or inventory proves they are not applicable.
3. AWS Inspector, GCP SCC/OS Config, and Azure Defender grade the same internal capability
   states despite provider-specific APIs.
4. A connected-but-unconfigured SIEM, PagerDuty tenant, SCC instance, or Defender tenant does
   not produce false verification.
5. Missing permissions and unknown denominators show `unknown`, never Passing.
6. Equivalent providers can satisfy a lane without a named third-party requirement.
7. Duplicate evidence does not inflate the control score or requirement count.
8. Compliance UI and exports show source, scope, freshness, coverage denominator, findings,
   and limitations.
9. Jira evidence is restricted to remediation workflow; PagerDuty to incident operations;
   neither is treated as threat-detection telemetry.
10. Current coverage claims are updated only in the same change that ships and tests the
    corresponding collector and grading behavior.

## 11. Explicitly out of scope

- Complete A-to-Z assessment of non-technical SOC 2 controls.
- Replacing Vanta, Drata, or another GRC system.
- HRIS, training, policy-authoring, vendor-risk, or broad MDM program management.
- Requiring customers to adopt unfamiliar providers solely for Veritrail.
- Treating screenshots or manual uploads as the preferred path when an authorized technical
  API can produce equivalent evidence.
- Claiming complete vulnerability management from a single partial source.

## 12. Authoritative implementation references

- Current customer contract: [`coverage-boundaries.md`](./coverage-boundaries.md)
- Current integrations: [`integrations-overview.md`](./integrations-overview.md)
- Multi-cloud collectors: [`multi-cloud-collectors.md`](./multi-cloud-collectors.md)
- Composite definitions: [`../api/data/composite_controls.json`](../api/data/composite_controls.json)
- Criterion mappings: [`../api/data/control_mappings.json`](../api/data/control_mappings.json)
- GitHub evidence summary: `api/app/services/sdlc_evidence.py`
- GCP client and collectors: `api/app/services/gcp_client.py`, `api/app/collectors/gcp/`
- AWS Inspector connector permissions: `web/src/lib/awsConnectSetup.ts`
- Integration catalog: `web/src/lib/integrationCatalog.ts`

External capability references:

- [GitHub Dependabot alerts](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-alerts)
- [GitHub code-scanning alerts](https://docs.github.com/en/code-security/concepts/code-scanning/code-scanning-alerts)
- [Amazon Inspector automated scan types](https://docs.aws.amazon.com/inspector/latest/user/scanning-resources.html)
- [Google Cloud SCC vulnerability findings](https://docs.cloud.google.com/security-command-center/docs/filter-vulnerability-findings)
- [Microsoft Defender for Cloud vulnerability assessment](https://learn.microsoft.com/en-us/azure/defender-for-cloud/agentless-vulnerability-assessment-azure)
