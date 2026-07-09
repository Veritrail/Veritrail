# Enterprise readiness

Summary of what Veritrail ships today versus deferred phase-two/phase-three work (as of 2026-07-02).

## Shipped

### External evidence & coverage

- Ten registry categories + up to five custom org categories (`org.settings.custom_evidence_categories`)
- MDM registry category (`mdm_endpoint`) for Intune/Jamf declarations (no live API yet; requires accepted upload to count as covered)
- Employee endpoint / EDR categories require external evidence — AWS GuardDuty and EC2 checks do not substitute for corporate device coverage
- Upload/review lifecycle, comments, superseded/expired states, renewal emails
- Coverage dashboard, overrides, absence-gap CTAs, criterion slide-over upload
- Policy-to-evidence linking via optional `policy_ref` on uploads

### Evidence storage & integrity

- S3 artifact storage with presigned downloads and retention
- Optional ClamAV scan + strict `EVIDENCE_UPLOAD_QUARANTINE_ENABLED` mode
- Evidence vault (S3 Object Lock) for finalized packs — see [evidence-vault.md](./evidence-vault.md)
- SHA-256 checksums in API and audit exports

### Multi-cloud & integrations

- AWS baseline collectors (core product)
- GCP/Azure phase-one collectors — [multi-cloud-collectors.md](./multi-cloud-collectors.md)
- Wiz/Tenable/Qualys scanner API phase-one
- GitHub/GitLab SDLC depth: enriched `sdlc_evidence.json`, composite `sdlc_insights`
- Jira/Linear remediation tickets on findings
- Entra/Google Workspace sync with `access_review_summary.json` in audit packs

### Scale & auditor experience

- `GET /v1/findings` cursor pagination + `GET /v1/findings/summary` server-side counts
- Findings UI: infinite scroll pages + `@tanstack/react-virtual` group list
- Auditor portal, scoped export link generation (vault presign when configured)
- Trust Center public posture page

### UI shell

- `CompliancePageHeader` on Compliance, Findings, Workspace, Accounts, Integrations, History, Dashboard
- Graded control status (`pass` / `at_risk` / `fail` / `no_data`) in UI and PDF exports
- Absence-gap CTAs and external-only control rules — controls do not hard-fail when the expected AWS-native source is unavailable
- Findings infinite scroll + virtualized group list; Compliance composite control list virtualized (Phase 2)

## Current gaps

Tracks the deferred backlog from direction strategy docs. **Not** stale pre-June claims — external evidence, S3/ClamAV/vault storage, graded status, GCP/Azure phase-one, and shared page shells are **shipped** (see above).

| Gap | Status | Notes |
|-----|--------|-------|
| Full HR / training / vendor-risk modules | Deferred P4 | Out of phase-one scope |
| Full generic SOC 2 questionnaire | Deferred P4 | Use composite groups + external evidence instead |
| Advanced custom frameworks | Deferred P4 | Per-control org mapping is Phase 7 |
| AI evidence-pack summary | Deferred | Findings triage infra exists; pack-level narrative not wired |
| Live Intune / Jamf API collectors | Phase-two | Registry + upload path shipped; no live sync |
| Scanner API auto-import | Phase-two | Wiz/Tenable/Qualys creds + manual sync shipped |
| Multi-cloud normalization polish | Phase 3 | AWS/GCP/Azure baselines shipped; parity APIs pending |
| GCP phase-two collectors | Phase 4 | CAI, SCC, OS Config vuln beyond logging audit + compute |
| Azure phase-two collectors | Phase 5 | Resource Graph, Activity Log, Entra/RBAC, Policy beyond Defender + storage |
| Granular evidence RBAC | Phase 6 | Contributor / reviewer / auditor-viewer beyond coarse org roles |
| Per-control org mapping | Phase 7 | Custom evidence categories shipped; mapping overrides pending |
| Release 5 integrations | Phase 8 | Snyk/Orca/Aikido/Splunk/Datadog/SIEM |
| Auditor approval UI for vault objects | Deferred | Presign API exists; end-to-end share records minimal |
| Separate EvidenceRequirement / ControlCoverage tables | Deferred P4 | Logic in composites + `category_evidence_coverage.py` today |

Canonical pipeline: [implementation-pipeline.md](./implementation-pipeline.md).

## Deferred (intentional)

| Area | Reason |
|------|--------|
| Full HR/training/vendor-risk modules | P4 — out of phase-one scope |
| Full generic SOC 2 questionnaire | P4 — use composite groups + external evidence instead |
| Advanced custom frameworks | P4 |
| AI evidence pack summary | AI triage infra exists for findings only; pack-level summary not wired |
| Live Intune/Jamf API collectors | Registry + upload path only; API integration phase-two |
| Scanner API pull (auto-import) | Phase-two; manual upload + registry shipped |
| Full cloud evidence normalization | Ongoing; AWS/GCP/Azure baselines shipped |
| Auditor approval UI for vault objects | Presign API exists; end-to-end share records still minimal |

## Plan tiers (connected AWS accounts)

Billing is not wired yet — set `orgs.plan` manually (or via migration). Unknown slugs fall back to **Trial** (1 account).

| Plan | Slug | Connected accounts |
|------|------|-------------------|
| Trial | `trial` | 1 |
| Starter | `starter` | 3 |
| Growth | `growth` | 10 |
| Scale | `scale` | 25 |
| Enterprise | `enterprise` | Unlimited |

Legacy aliases: `free` → trial, `paid` → growth. Enforcement lives in `api/app/data/plans.py` and `POST /v1/accounts` (402 when at cap).

The Cloud Castles dogfood workspace (`slug = cloud-castles`) is on **Growth** via migration `0075`.

## Configuration checklist (enterprise)

1. `EVIDENCE_ARTIFACTS_S3_URI` + IAM for uploads
2. `EVIDENCE_CLAMAV_ENABLED` + `EVIDENCE_UPLOAD_QUARANTINE_ENABLED` for strict AV
3. `EVIDENCE_VAULT_ENABLED` + Object Lock bucket for immutable packs
4. `EVIDENCE_VAULT_AUDITOR_ACCESS_MODE=presigned` for scoped export links
5. Connect identity providers (Entra, Google Workspace) for access-review evidence

## Related docs

- [external-evidence.md](./external-evidence.md)
- [evidence-vault.md](./evidence-vault.md)
- [integrations-overview.md](./integrations-overview.md)
- [multi-cloud-collectors.md](./multi-cloud-collectors.md)
