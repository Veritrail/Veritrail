# Deep-research report #2 — checklist (2026-07)

_Actionable items from "deep-research-report (2)" (GRC evidence-ingestion APIs, third-party feed
examples, auditor acceptance). Checklist only — no implementation here._

Cross-checked against `docs/deep-research-roadmap.md`, `docs/grc-feed-validation.md`, and recent
`dev` commits. `[x]` = already shipped. Tags: **[grc-blocked]** = gated on a partner/design-partner
API key (human), **[human]** = pricing/GTM/legal decision, not composer work.

Note: this report contains no IaC/write-remediation, GDPR, ExternalId-rotation, or OCSF items, so
nothing here conflicts with the scanning-only constraint or prior rejections.

---

## GRC platform push (Vanta / Drata / Secureframe / Sprinto)

- [ ] Docs-only API review per platform: does an attach-to-control evidence endpoint exist (spec ready in `grc-feed-validation.md`, spike not run) [grc-blocked]
- [ ] Vanta push via private integration (Developer Console, OAuth/API key) [grc-blocked]
- [ ] Drata push via Custom Connections API key (Swif/Aikido pattern) [grc-blocked]
- [ ] Secureframe push via REST API (raw JSON/CSV, normalized by Secureframe) [grc-blocked]
- [ ] Sprinto push via Open API token, evidence per configured check [grc-blocked]
- [ ] Map signed evidence pack → Drata control ID / Vanta test and attach via API (Screenata pattern) [grc-blocked]
- [ ] Recurring sync of report artifact into GRC as external evidence (Aikido daily-sync pattern) [grc-blocked]
- [ ] Idempotent supersede on re-push (quarterly refresh without duplicates) [grc-blocked]
- [x] Export plumbing + GRC destination "coming soon" catalog entries (shipped; adapter itself stays gated on spike)

## Signed evidence packs / direct-to-auditor fallback

- [x] Cryptographically signed evidence packs with timestamps, attribution, chain-of-custody (shipped: pack signing + `PackIntegrityPanel`)
- [x] Evidence clearly shows what was tested, by whom, and when (shipped: provenance in ZIP, PDF meta/integrity copy)
- [x] Timestamped periodic exports covering the audit window (shipped: scheduled evidence exports)
- [x] Deliver organized, verifiable artifacts directly to audit teams (shipped: auditor export, scoped-export SHA display)

## Auditor portal table stakes (only if portal is pursued — report: viable, not required)

- [ ] PBC request tagging (map evidence items to auditor requests / SOC 2 criteria)
- [ ] Period-locking (freeze audit window against post-hoc changes)
- [ ] Sample selection tools for auditors
- [x] Downloadable evidence archives (shipped: evidence-pack ZIP)
- [x] Evidence-to-control mapping visible in auditor-facing exports (shipped)
- [x] Audit trail on evidence items (shipped: provenance / immutable trail)

## Human decisions (pricing / GTM / legal — decide, don't build)

- [ ] [human] Secure a design-partner API key (Vanta or Drata customer) — gates the entire push spike
- [ ] [human] Legal review of Vanta ToS "Vanta Competitor" clause before any Vanta push
- [ ] [human] Choose route: customer-key integration vs formal partner/marketplace listing (co-marketing)
- [ ] [human] Build-vs-skip decision on a dedicated auditor portal (export-only fallback is acceptable)
- [ ] [human] Auditor-channel GTM: engage audit firms / their portals (A-SCEND, Drata Audit Hub, Vanta Auditor View)
