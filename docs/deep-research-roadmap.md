# Deep-research report → Veritrail roadmap (2026-07)

_Mapping of the July 2026 deep-research report ("Market & Competition / Compliance Domain Depth /
Product & UX / Technical Architecture / Trust / AI / Business & GTM") to concrete work items._

**Composer implements** the items marked buildable below. Business/GTM items are listed separately
as human decisions — do not build those.

**Hard product constraint (locked):** Veritrail is **scanning-only**. No IaC generation, no fix
PRs, no SSM auto-fix, no write access to customer environments — ever. Manual remediation
guidance (console steps / CLI commands shown to the user) stays. Any report recommendation
involving write-remediation is rewritten or dropped below.

Status key: **done** · **partial** · **new** · **out of scope** · **human decision**

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
| 8 | SOC 2 control mapping via `CHECK_CONTROL_IDS_MAP` | **done** | `web/src/data/checkControlIdsMap.ts` (granularity/phrasing still partial — see #10) |
| 9 | High-fidelity, tamper-evident evidence (signed packs, provenance, immutable trail) | **partial** | `api/app/services/pack_signing.py`, `pack_provenance.py`, `snapshot_provenance.py`, `evidence_vault.py`. Missing: surfacing signature/hash verification in exports + auditor portal (§2.1) |
| 10 | Granular control mapping (points of focus, "supports" not "fulfills") | **partial** | Map exists; narratives may overclaim. Audit copy in `checkComplianceCopy.ts` / `control_narratives.py` (§2.2) |
| 11 | Evidence supplier to GRC platforms (Vanta/Drata/Secureframe/Sprinto) | **partial** | Catalog "coming soon" + export plumbing. **Blocked on human validation** — `docs/open-work.md` item 6, `docs/grc-feed-validation.md`. Do not build the adapter first |
| 12 | Continuous compliance: periodic time-stamped exports covering the audit window | **partial** | Scans + History + renewal reminders exist. Missing: scheduled evidence-pack export (§2.4) |
| 13 | Prioritization beyond severity: control coverage weight, exposure, blast radius | **partial** | Blast radius + AI triage exist. Missing: control-coverage weighting in blocker ranking (§2.5). EPSS only relevant for ingested scanner vulns, not Veritrail misconfig checks |
| 14 | ISO 27001 as next framework | **partial** | Framework id + some Annex A refs exist. Missing: coverage parity vs SOC 2 (§2.8) |
| 15 | GDPR mapping after ISO | **new** | Nothing in code. §2.8 |
| 16 | ExternalId rotation support | **new** | AWS-recommended; nothing in code. §2.6 |
| 17 | OCSF export mode for findings | **new** | No OCSF in repo. §2.7 |
| 18 | Postgres scale: indexes, keyset pagination, pre-computed aggregates | **partial** | Indexes + coverage store exist; findings list still page/cap based. §2.9 |
| 19 | Onboarding: no empty states, connect-first, activation metric ("time to first scan result") | **partial** | Connect-first UX exists. Missing: time-to-first-result instrumentation (§2.10) |
| 20 | Golden/canary account testing for scanner fidelity | **partial** | Seed scripts + moto tests. Missing: scheduled live-sandbox regression (§2.11) |
| 21 | Vendor trust page + documented minimal OAuth scopes | **partial** | Trust center exists. Missing: consolidated per-integration scope docs (§2.12) |
| 22 | AI evidence summarization / audit-ready finding descriptions | **done** | `ai_pack_summary.py`, `ai_finding_review.py`, `ai_triage.py` |
| 23 | Credential vaulting / short-lived tokens for Veritrail-held secrets | **partial** | Ops posture (`docs/hetzner-vault-rolesanywhere.md`); keep as reference |
| 24 | Retire write-remediation UI + backend (align product with scanning-only) | **new** | Flag-gated remnants still in tree (`VITE_SHOW_WRITE_REMEDIATION`, IaC repo, SSM modules). §2.3 |
| 25 | LLM-generated Terraform fixes / fix PRs / auto-remediation | **out of scope** | Violates scanning-only. Manual console/CLI guidance stays (`remediationSummaries.ts`, `cliRemediation.ts`) |
| 26 | Agent-based or event-driven (CloudTrail/EventBridge) scanning at scale | **out of scope (for now)** | Cron/AssumeRole is correct at current scale; locked in `docs/compliance-expansion-checklist.md`. Revisit at hundreds of accounts |
| 27 | Pricing, auditor channel, Veritrail's own SOC 2, EU residency, vertical frameworks | **human decision** | See §3 |

---

## 2. Buildable items (composer implements), by priority

### P0

#### 2.1 Surface evidence integrity (signature + hash) in exports and auditor portal

Report: auditors distrust "a downloaded CSV that could be doctored"; chain-of-custody is the
evidence-first differentiator.

- Show pack signature, content hash, and provenance in evidence-pack export UI
  (`web/src/components/EvidencePackExportPanel.tsx`) and PDF (`api/app/services/pdf_report.py`).
- Auditor portal (`web/src/pages/Auditor*.tsx`, `api/app/routes/auditor_portal.py`): "verify this
  pack" affordance (hash + how to check it).
- Backend already computes this (`pack_signing.py`, `pack_provenance.py`) — presentation work.

#### 2.2 Control-mapping phrasing audit — "supports", not "fulfills"

Report: naïve mappings overstate coverage ("branch protection fulfills CC6.3" is wrong; it
*supports* one aspect).

- Audit `web/src/data/checkComplianceCopy.ts` and `api/app/data/control_narratives.py` for
  claims that a single check "satisfies/fulfills/covers" a control; rewrite to scoped
  "supports X aspect of \<control\>" phrasing.
- Extend `api/tests/test_framework_mapping_audit.py` with a copy-level lint: no check narrative
  may claim full satisfaction of a CC-series control.

#### 2.3 Retire write-remediation (scanning-only alignment)

Product constraint: scanning only. Remnants still exist behind `VITE_SHOW_WRITE_REMEDIATION`
and related surfaces — retire them as a dedicated cleanup (not part of this docs-only pass).

**Keep:** console/CLI guidance (`remediationSummaries.ts`, `CliRemediationPanel.tsx`,
`cliRemediation.ts`), read-only Suggested policy, Jira/Linear ticketing, Verify fix
(`fast_finding_recheck.py`).

**Retire (frontend):** flag + gated UI — AWS hub "Remediation" chip (`Integrations.tsx`,
`awsHubCapabilities`), Terraform / Automated-fix tabs (`FindingDrawer.tsx`), connector
remediation-module toggles (`Accounts.tsx`, `ConnectorUpdateModal.tsx`), IaC repository
catalog entry + pages (`IacRepositoryIntegration.tsx`, `IaCRemediationSection.tsx`,
`TerraformIacDrawerSection.tsx`, `useRemediationExecution.ts`).

**Retire (backend / infra, coordinated release):** routes under `…/iac/*`,
`…/remediation/*`, `iac_repository_integration`, `github_issues_integration`; services
(`remediation_dispatch`, `terraform_pr`, `github_iac_pr`, `ssm_remediation_catalog`, …);
`infra/cfn/veritrail-remediation-ssm.yaml` + SSM scripts. Keep DB columns accept-and-ignore
to avoid a breaking migration until a planned template bump.

### P1

#### 2.4 Scheduled evidence exports for the audit window

Report: auditors sample across the period and expect periodic time-stamped exports.

- Org setting: monthly (or weekly) automatic evidence-pack generation into the evidence vault
  (`api/app/services/evidence_vault.py`) with provenance, visible in History.
- Reuse `scan_alert.py` / `digest.py` scheduling; surface "exports covering the audit window:
  N of 12 months" on org readiness home.

#### 2.5 Control-coverage weighting in blocker ranking

Report: prioritize fixes that clear the most compliance ground.

- `web/src/lib/orgReadinessBlockers.ts` already computes `soc2ControlIds` per group — fold
  control count (and whether the control has no other passing evidence via
  `api/app/services/control_status.py`) into ranking, not just severity+count.
- Make "unblocks CC6.1, CC6.6" the sort driver, not just a meta line.

#### 2.6 ExternalId rotation

Report: AWS recommends rotating ExternalIds periodically.

- API: mint a new external id (`api/app/models/aws_account.py`, `api/app/routes/accounts.py`)
  with two-phase flow (issue → customer updates CFN → verify → invalidate old).
- UI: "Rotate external ID" in account menu (`Accounts.tsx` / `ConnectorUpdateModal.tsx` pattern).

#### 2.7 OCSF export mode

Report: keep GRC formats first; offer OCSF for forward-compatibility.

- OCSF (JSON, Compliance Finding class) serializer in `api/app/routes/exports.py` mapped from
  `api/app/models/finding.py`; unit-test schema shape. Format dropdown in export panel only.
- Do **not** rework the internal data model around OCSF.

#### 2.8 ISO 27001 coverage parity, then GDPR mapping

Report: ISO then GDPR are the natural next frameworks.

- Close `iso27001` mapping gaps for existing checks (`api/data/control_mappings.json`,
  `web/src/data/checkFrameworkMap.ts`) — mapping work, no new collectors.
- Treat ISO on par with SOC 2 in Controls, packs, rollups (`org_frameworks.py`,
  `frameworkEvidenceCoverage.ts`).
- GDPR: add framework id for technical-controls subset only (Art. 32); skip DPA/process controls.

### P2

#### 2.9 Findings-list scale pass

- Keyset pagination (`api/app/routes/findings.py`, `web/src/lib/fetchAllFindings.ts`).
- Pre-computed per-control / per-account counts on scan completion (extend
  `control_coverage_store.py`). Worth doing when a workspace exceeds ~100k findings.

#### 2.10 Activation metric: time-to-first-result

- Record `first_scan_completed_at` per org; log signup → first integration → first finding
  durations (backend event log). Ops-only; natural home `api/app/services/org_activity.py`.

#### 2.11 Scheduled sandbox regression run

- Nightly CI: run scanner against seeded sandbox (`scripts/seed-sandbox-findings.sh`), diff
  finding counts vs golden snapshot; alert on drift.

#### 2.12 Integration scope documentation page

- Consolidate exact OAuth scopes / IAM actions per integration into Reference
  (`web/src/pages/Reference.tsx` + setup docs). Content mostly exists scattered today.

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
- **Which vertical frameworks matter** (HIPAA / PCI / NIS2 / DORA) — market question; default
  order is ISO 27001 parity then GDPR (§2.8).
- **Auditor format pre-agreement playbook** — customer-facing docs template ("agree CSV/JSON
  export formats with your auditor up front"); content work, not product code.
