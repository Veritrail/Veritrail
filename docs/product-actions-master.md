# Veritrail — master action plan

Consolidates every decision from the product-direction thread. Each item links to its detailed spec
where one exists; new decisions (remediation cuts, scope default) are specced inline here. **Spec /
plan doc — composer implements from this + the linked specs.**

## Product spine (the decisions everything serves)

- **Veritrail = cloud evidence for SOC 2.** Collect from AWS / GCP / Azure / Git → produce
  auditor-ready evidence, either as a **downloadable pack** or **fed into the customer's GRC tool**
  (Vanta/Drata/etc.).
- **Evidence company. Not** GRC, not CSPM, not a Vanta competitor, **not a remediation product.**
- **Read-only is the trust line.** Default install must be provably read-only — no write, no PassRole.
- **Hide, don't delete.** Everything cut stays as dormant, flag-gated code.

---

## Priority order for implementation

1. **Remediation cuts + read-only CFN** (§C) — biggest trust win, clearest scope.
2. **Findings scope default fix** (§B) — one-liner, finishes an already-shipped feature.
3. **Resource bulk-actions consolidation** (§D) — refine the rough version already built.
4. **Hardening** (§E) — low urgency, do when convenient.
5. **GRC feed validation** (§F) — NOT code; a validation spike you run before any feed build.

Already shipped + verified: **§A** (integrations scope), **§B core** (scope selector). Listed for context.

---

## A. Integrations scope — DONE ✓ (verify only)

Spec: [`starter-scope-integrations.md`](./starter-scope-integrations.md). Shipped in `92e60928`, verified.

- Extended integrations (scanners / SIEM / IaC / Azure DevOps) hidden behind
  `VITE_SHOW_EXTENDED_INTEGRATIONS` — done.
- Identity providers (Entra / Google Workspace / Okta) **kept visible** — done (deliberate: CC6 evidence).
- Recommended tiers reordered (GitHub/GitLab → Jira/Slack → identity) — done.
- Page retitled "Workflow integrations" — done.
- **No action** unless you want the optional "Source control" group header polish.

---

## B. Findings scope selector — DONE ✓

Spec: [`findings-scope-selector.md`](./findings-scope-selector.md). Core shipped + verified (All cloud
accounts, merged Source control, server-side `?provider=all_cloud|source_control`, mutual-exclusion 400s).

**Default fix — shipped:** `resolveSelectedAccountId` now defaults to `scope:all_cloud` when ≥1 cloud
account and no URL/session selection; SCM-only orgs default to `scope:source_control`. URL/session
precedence unchanged.

---

## C. Remediation cuts + provably-read-only install — DONE ✓ (UI + CFN)

Positioning: Veritrail collects evidence and *shows/tracks* fixes; it does **not** perform them.
The finding drawer's Remediation tab keeps **guidance**, drops **write actions** from the default surface.

**Shipped:**
- Remediation tab: Console, CLI, Suggested policy only (Automated fix + Terraform hidden unless `VITE_SHOW_WRITE_REMEDIATION=true`).
- Suggested policy: service-level default (`advanced=false`); Access Analyzer booster is explicit opt-in in the UI.
- Connector remediation module toggles + SSM dispatch UI flag-gated via `VITE_SHOW_WRITE_REMEDIATION`.
- CFN: SSM start/PassRole removed from core scanner role; moved to optional `veritrail-remediation-ssm` nested stack (attaches to scanner role only when remediation modules enabled).
- Copy: removed "automated remediation" from default product strings.

**Dormant (not deleted):** `tools/hclpatch/`, SSM services, backend routes — restore with env flag.

---

## D. Finding resource bulk-actions — DONE ✓ (verify; no code changes this pass)

Spec: [`finding-resource-bulk-actions.md`](./finding-resource-bulk-actions.md). Verified against shipped UX:
row-click select, inline header count, footer Except N / Create tickets (N), Jira modal Separate/Combined
radios, type-aware combined default, `from-findings` endpoint, client-loop bulk exception.

---

## E. Hardening — DONE ✓ (commit `243eb51d`)

Spec: [`hardening-verified-items.md`](./hardening-verified-items.md). Verified shipped:

- FastAPI bumped to 0.128.0 in `api/requirements.txt`.
- Evidence upload validation + `/uploads` scoped to trust logos (`243eb51d`).
- Findings list indexes migration `0091_findings_list_indexes.py` (`243eb51d`).

No further code changes this pass.

---

## F. GRC feed validation — NOT code, run this before any feed build

Specs: [`grc-feed-validation.md`](./grc-feed-validation.md), [`grc-feed-api-runbook.md`](./grc-feed-api-runbook.md).

- **One binary test:** push one Veritrail evidence artifact → one SOC 2 control → confirm it attaches,
  is auditor-visible, counts, and can be superseded idempotently.
- **Targets (4):** Vanta, Drata, Secureframe, Sprinto — biggest install bases with usable APIs.
- **Access:** design-partner customer's API key (fastest, zero cost/approval) or Drata's free no-CC
  trial. No self-serve signup on any; no payment/partner approval needed to validate.
- **Vanta** = cleaner "evidence → control" (OAuth2, upload to a control-mapped evidence-request doc).
  **Drata** = indirect (custom-connection → records → map a custom test). Do Vanta for the clean yes/no.
- **Scytale** — no public API; not a feed target. Its (heavily manual) customers are standalone-pack
  leads instead.
- **Anecdotes** — closest competitor (enterprise, broad, in-house evidence engine). Watch, don't fight;
  your edge is SMB + deep cloud/Git + read-only + price.
- **Decision gate:** push works on one platform → build the destination adapter
  (`EvidenceSource → NormalizedEvidence → ControlMapping → DestinationAdapter`). Push weak/gated →
  ship export-only (GRC-ready ZIP + upload instructions). **Do not build the adapter before the test.**

---

## What NOT to do (guardrails)

- Don't delete backend/routes/checks for hidden features — flag-gate, keep dormant.
- Don't hide identity providers (Entra/GWS/Okta) — they're CC6 evidence.
- Don't add self-serve billing surfaces (billing isn't wired).
- Don't build the GRC destination adapter before §F validates.
- Don't re-introduce write access to the default cloud role.
