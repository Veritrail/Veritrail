# Deep-research report → Veritrail roadmap (2026-07)

_Mapping of the July 2026 deep-research report ("Market & Competition / Compliance Domain Depth /
Product & UX / Technical Architecture / Trust / AI / Business & GTM") to concrete work items._

**Composer implements** the items marked buildable below. Business/GTM items are listed separately
as human decisions — do not build those.

**Hard product constraint (locked):** Veritrail is **scanning-only**. No IaC generation, no fix
PRs, no SSM auto-fix, no write access to customer environments — ever. Manual remediation
guidance (console steps / CLI commands shown to the user) stays. Any report recommendation
involving write-remediation is rewritten or dropped below.

Status key: **done** · **partial** · **new** · **out of scope** · **rejected** · **human decision**

---

## 1. Classification table

| # | Report recommendation | Status | Where it lives / what's missing |
|---|----------------------|--------|--------------------------------|
| 1 | Outcome-first readiness number **with drill-down** ("N findings from SOC 2" must link to action) | **done** | `web/src/components/OrgReadinessHome.tsx`, `web/src/lib/orgReadinessBlockers.ts` (blockers ranked, Review links scoped) |
| 2 | Show top blockers, not raw counts (Wiz "toxic combinations" pattern) | **done** | Org readiness blockers group by check, rank, cap list; absence-gap split in `partitionBlockerFindings` |
| 3 | Evidence-based resource "why" explanations | **done** | Resources tab why column / per-resource evidence (recently shipped on `dev`) |
| 4 | Verify-fix re-check in seconds/minutes, single-check scope | **done** | `api/app/services/fast_finding_recheck.py`, `org_finding_recheck.py`, drawer Verify fix button |
| 5 | AccessDenied / trust-policy failures handled gracefully with user guidance | **done** | `web/src/lib/scanFailureMessages.ts`, `CloudIntegrationTroubleshootPanel`, `api/tests/test_assume_role_audit.py` |
| 6 | Least-privilege cross-account role + ExternalId | **done** | `infra/cfn/veritrail-core-scanner.yaml`, onboarding permission review UI in `web/src/pages/Accounts.tsx` |
| 7 | GitHub / GitLab / Entra / Google Workspace integrations | **done** | Integration pages + collectors; catalog entries in `web/src/lib/integrationCatalog.ts` |
| 8 | SOC 2 control mapping via `CHECK_CONTROL_IDS_MAP` | **done** | `web/src/data/checkControlIdsMap.ts`; phrasing audited in §2.2 |
| 9 | High-fidelity, tamper-evident evidence (signed packs, provenance, immutable trail) | **done** | Pack signing + provenance in ZIP; surfaced in export UI (`PackIntegrityPanel`), auditor export, scoped-export SHA display, PDF meta/integrity copy |
| 10 | Granular control mapping (points of focus, "supports" not "fulfills") | **done** | CC narratives/short answers rewritten to "supports … aspect"; copy lint in `test_framework_mapping_audit.py` |
| 11 | Evidence supplier to GRC platforms (Vanta/Drata/Secureframe/Sprinto) | **partial** | Catalog "coming soon" + export plumbing. **Blocked on human validation** — `docs/open-work.md` item 6, `docs/grc-feed-validation.md`. Do not build the adapter first |
| 12 | Continuous compliance: periodic time-stamped exports covering the audit window | **done** | Scheduled evidence-pack exports (§2.4): org setting + Celery beat + vault persist; audit-window coverage on org home |
| 13 | Prioritization beyond severity: control coverage weight, exposure, blast radius | **done** | Blast radius + AI triage + control-coverage weighting in blocker ranking (§2.5). EPSS only relevant for ingested scanner vulns |
| 14 | ISO 27001 as next framework | **done** | ISO Annex A parity vs SOC 2 checks (§2.8); treated on par in Controls/History/exports |
| 15 | GDPR mapping after ISO | **rejected** | Product decision: GDPR Art. 32 mapping is meaningless for Veritrail; removed from UI/catalog/mappings (§2.8). SOC 2 / ISO kept |
| 16 | ExternalId rotation support | **rejected** | Customers don't redeploy CFN/PermissionSets; rotation UI/APIs removed. Initial ExternalId on connect kept (§2.6) |
| 17 | OCSF export mode for findings | **rejected** | Product decision: OCSF Findings export is meaningless; removed API + format dropdown (§2.7). CSV export kept |
| 18 | Postgres scale: indexes, keyset pagination, pre-computed aggregates | **done** | Keyset pagination + `include_total`; truncated banner; `/findings/summary` wired; post-scan coverage sync (§2.9) |
| 19 | Onboarding: no empty states, connect-first, activation metric ("time to first scan result") | **done** | Connect-first UX + `org.settings.activation` milestones + audit-log activation endpoint (§2.10) |
| 20 | Golden/canary account testing for scanner fidelity | **done** | In-repo golden Stubber regression (`api/tests/golden/`, `test_scan_regression_golden.py`) (§2.11). Live AWS sandbox remains optional/manual |
| 21 | Vendor trust page + documented minimal OAuth scopes | **done** | Trust center + Reference Integrations tab (`integrationScopes.ts`) (§2.12) |
| 22 | AI evidence summarization / audit-ready finding descriptions | **done** | `ai_pack_summary.py`, `ai_finding_review.py`, `ai_triage.py` |
| 23 | Credential vaulting / short-lived tokens for Veritrail-held secrets | **partial** | Ops posture (`docs/hetzner-vault-rolesanywhere.md`); keep as reference |
| 24 | Retire write-remediation UI + backend (align product with scanning-only) | **done** | Frontend + backend/infra retired (§2.3). DB columns accept-and-ignore |
| 25 | LLM-generated Terraform fixes / fix PRs / auto-remediation | **out of scope** | Violates scanning-only. Manual console/CLI guidance stays (`remediationSummaries.ts`, `cliRemediation.ts`) |
| 26 | Agent-based or event-driven (CloudTrail/EventBridge) scanning at scale | **out of scope (for now)** | Cron/AssumeRole is correct at current scale; locked in `docs/compliance-expansion-checklist.md`. Revisit at hundreds of accounts |
| 27 | Pricing, auditor channel, Veritrail's own SOC 2, EU residency, vertical frameworks | **human decision** | See §3 |

---

## 2. Buildable items (composer implements), by priority

### P0

#### 2.1 Surface evidence integrity (signature + hash) in exports and auditor portal — **done**

Report: auditors distrust "a downloaded CSV that could be doctored"; chain-of-custody is the
evidence-first differentiator.

**Shipped:** `PackIntegrityPanel` on evidence-pack export + auditor export; post-download
`X-Veritrail-Pack-SHA256` / `X-Veritrail-Report-Id` headers; scoped-export SHA display; PDF
provenance meta rows + integrity verify copy. Backend signing/provenance unchanged.

#### 2.2 Control-mapping phrasing audit — "supports", not "fulfills" — **done**

Report: naïve mappings overstate coverage ("branch protection fulfills CC6.3" is wrong; it
*supports* one aspect).

**Shipped:** CC `NARRATIVES` / `SHORT_ANSWERS` rewritten to "supports … aspect"; FindingDrawer
CC overclaims softened; copy-level lint in `api/tests/test_framework_mapping_audit.py`.

#### 2.3 Retire write-remediation (scanning-only alignment) — **done**

Product constraint: scanning only.

**Keep:** console/CLI guidance (`remediationSummaries.ts`, `CliRemediationPanel.tsx`,
`cliRemediation.ts`), read-only Suggested policy, Jira/Linear ticketing, Verify fix
(`fast_finding_recheck.py`).

**Shipped (frontend):** removed `VITE_SHOW_WRITE_REMEDIATION`; AWS hub Remediation chip; Terraform /
Automated-fix tabs; connector remediation-module toggles; IaC repository catalog entry + pages.
Legacy routes redirect to `/integrations`.

**Shipped (backend / infra):** removed write-remediation routes (`…/remediation/*`, terraform-PR,
iac-repository / github-issues integrations, accounts remediate, public SSM webhook); deleted
SSM/dispatch/terraform-PR services; removed `infra/cfn/veritrail-remediation-ssm.yaml` + SSM
scripts + nested RemediationStack; retired hclpatch. `/v1/iac` kept scan-only (lint + VCS
webhooks). DB columns (`enable_remediation_*`, `remediation_executions`) left accept-and-ignore.

### P1

#### 2.4 Scheduled evidence exports for the audit window — **done**

**Shipped:** `org.settings.scheduled_exports` + Celery beat `scheduled_evidence_exports`; shared
`evidence_export_persist` helper; `GET /v1/exports/evidence-packs`; Workspace Sharing toggle;
org-home “exports covering the audit window: N of 12 months”.

#### 2.5 Control-coverage weighting in blocker ranking — **done**

**Shipped:** `orgReadinessBlockers.ts` ranks by failing SOC 2 controls first; BlockersList shows
`unblocks CC…`; OrgReadinessHome passes control status map.

#### 2.6 ExternalId rotation — **rejected / removed**

**Rejected:** customers do not redeploy CFN stacks or PermissionSets to rotate ExternalId, so
the two-phase rotate → update → confirm flow is unused.

**Removed:** rotate / confirm / cancel APIs; `RotateExternalIdModal` and UI entry points in
troubleshoot + connector update. Migration `0094_external_id_rotation` columns left
accept-and-ignore (no destructive drop).

**Kept:** ExternalId minting on initial connect / onboarding.

#### 2.7 OCSF export mode — **rejected / removed**

**Rejected:** OCSF Findings export is not a useful customer surface.

**Removed:** `ocsf_export.py`, `GET /v1/exports/findings.ocsf.json`, Findings format dropdown
(CSV | OCSF). CSV export unchanged.

#### 2.8 ISO 27001 coverage parity; GDPR mapping — **ISO done; GDPR rejected / removed**

**Shipped (ISO):** closed SOC 2 → ISO Annex A mapping gaps for existing checks; framework
pickers / exports / coverage UI treat ISO on par (evidence-period semantics).

**Rejected (GDPR):** Art. 32 technical-controls subset was product-meaningless. Removed `gdpr`
from framework catalogs, selectors, Trust Center, evidence UI, and `control_mappings.json`
(+ regenerated check↔framework maps). SOC 2 / ISO / CIS unchanged. Slug `gdpr` remains
reserved for custom org frameworks to avoid colliding with any leftover DB rows.

### P2

#### 2.9 Findings-list scale pass — **done**

**Shipped:** `include_total` on findings list (skip COUNT on cursor walks); truncated banner when
past 5k cap; Dashboard wired to `/v1/findings/summary`; post-scan `sync_coverages_after_scan` +
AWS `open_findings_count` on scan stats.

#### 2.10 Activation metric: time-to-first-result — **done**

**Shipped:** `org.settings.activation` milestones via `record_activation_milestone`; hooks on
workspace create, AWS/GitHub connect, first scan / first finding; `GET /v1/audit-log/activation`
(ops-only).

#### 2.11 Scheduled sandbox regression run — **done** (in-repo CI)

**Shipped:** `api/tests/golden/finding_counts.json` + `test_scan_regression_golden.py` (Stubber /
deterministic fixtures under existing `pytest`). Live AWS sandbox remains optional/manual;
`seed-sandbox-findings.sh` points at the CI golden path.

#### 2.12 Integration scope documentation page — **done**

**Shipped:** `web/src/data/integrationScopes.ts` + Reference page Integrations tab consolidating
OAuth scopes / IAM roles per integration.

---

## 3. Human decisions (not composer work)

From the report's Market / GTM / Business sections — decide, don't build:

- **Pricing model** — flat tiers by cloud-account count vs usage-based; report suggests low
  five-figure ACV for pre-Series-A, ~$5K psychological threshold.
- **Auditor channel** — referral/co-sell with audit firms, white-label reports. (White-label
  theming becomes composer work only if pursued.)
- **GRC push validation spike** — `docs/open-work.md` item 6; needs a design-partner API key.
  Gates classification #11 / any destination adapter.
- **Veritrail's own SOC 2 / ISO certification** and third-party pen test — vendor trust
  prerequisite.
- **EU data residency commitment** — infra/ops before marketing to EU customers.
- **Which vertical frameworks matter** (HIPAA / PCI / NIS2 / DORA) — market question; ISO 27001
  parity shipped (§2.8). GDPR Art. 32 mapping was rejected/removed as product-meaningless;
  verticals still human.
- **Auditor format pre-agreement playbook** — customer-facing docs template ("agree CSV/JSON
  export formats with your auditor up front"); content work, not product code.
