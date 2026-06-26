# Enterprise readiness

Summary of what Veritrail ships today versus deferred phase-two/phase-three work (as of 2026-06-26).

## Shipped

### External evidence & coverage

- Nine registry categories + up to five custom org categories (`org.settings.custom_evidence_categories`)
- MDM registry category (`mdm_endpoint`) for Intune/Jamf declarations (no live API yet)
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
