# Veritrail — SOC 2 coverage map & expansion order

_Created 2026-06-22. Control-level view of where Veritrail stands against the SOC 2
Common Criteria, what each evidence source unlocks, and the order to close the
gap. Complements [compliance-expansion-checklist.md](./compliance-expansion-checklist.md)
(which is the check-level backlog); this doc is the **control-level** strategy._

## TL;DR

- Veritrail is **already multi-source**, not AWS-only: it ships checks for **AWS**,
  **Google Workspace + Entra** (identity) and **GitHub + GitLab** (change mgmt).
- It maps **9 SOC 2 Common Criteria points today — all in CC6 / CC7 / CC8**
  (logical access, system operations, change management). These are the
  technical criteria, and coverage there is **deep**.
- The readiness **% is capped by the ~24 non-technical CC points** (CC1–CC5,
  CC9, plus CC6.4/6.5 and CC7.3–7.5) that no scanner can prove. **The single
  biggest lever to get customers "closer to SOC 2" is a manual control
  checklist** (auto-pass from collectors where possible, attest + upload where
  not) that turns coverage into one honest readiness number.

## Where Veritrail stands (the 9 mapped controls)

| Control | Title | Evidence source today |
|---|---|---|
| CC6.1 | Logical access — asset inventory | AWS IAM, identity (GWS/Entra) |
| CC6.2 | Credential registration | AWS IAM, identity |
| CC6.3 | Access removal (deprovisioning) | AWS IAM, identity (HR↔IdP still manual) |
| CC6.6 | External threat controls | AWS (39 checks) |
| CC6.7 | Transmission encryption | AWS |
| CC6.8 | Encryption at rest | AWS |
| CC7.1 | Config change detection | AWS, CloudTrail |
| CC7.2 | Anomaly detection | AWS, CloudTrail |
| CC8.1 | Authorized changes | AWS config + **GitHub/GitLab** (branch protection, reviews, scanning) |

## Full SOC 2 Common Criteria — status & how to close

Legend: **✅ covered** · **🟡 partial** · **⬜ gap** · _how to close_

| CC | Area | Status | How to close |
|---|---|---|---|
| **CC1.1–1.5** | Control environment — ethics, board, org structure, HR/competence, accountability | ⬜ | **Manual attest** (org chart, code of conduct, background-check policy) |
| **CC2.1–2.3** | Communication & information | ⬜ | **Manual attest** (security policy comms, channels) |
| **CC3.1–3.4** | Risk assessment | ⬜ | **Manual attest** (risk register upload) + light template |
| **CC4.1–4.2** | Monitoring activities | 🟡 | Partly your continuous scanning; **attest** the rest (internal audit cadence) |
| **CC5.1–5.3** | Control activities / policies | ⬜ | **Manual attest** (policy set — thin policy-acknowledgment if you choose) |
| **CC6.1–6.3** | Logical access — provisioning / MFA / removal | ✅ | Deepen: **HR↔IdP correlation** + **quarterly access-review export** (both flagged P0/P1) |
| **CC6.4** | Physical access | ⬜ | **Manual attest** (data-center is AWS's SOC 2 — inherit; office attest) |
| **CC6.5** | Data disposal | ⬜ | **Manual attest** |
| **CC6.6–6.8** | External threats / encryption | ✅ | Maintain |
| **CC7.1–7.2** | Config change / anomaly detection | ✅ | Maintain |
| **CC7.3–7.4** | Incident detection & response | 🟡 | Enrich from **Slack/PagerDuty/CloudTrail alerts** + **attest** runbook |
| **CC7.5** | Recovery | 🟡 | **Backup checks** (partly shipped) + **attest** DR test |
| **CC8.1** | Change management | ✅ | Done — AWS + source control |
| **CC9.1** | Business-disruption risk | 🟡 | Backup/DR evidence + **attest** BCP |
| **CC9.2** | Vendor / subprocessor risk | ⬜ | Thin **vendor registry** (name, data, SOC 2 upload) — _not_ a full TPRM product |

Roughly **9 covered, ~6 partial, ~18 gap** of the ~33 CC points. Every gap is
either **manual attestation** or **thin enrichment of an existing signal** — none
require becoming a GRC suite.

## Recommended build order

1. **Manual control checklist** (biggest readiness-% jump). Every SOC 2 control
   as a row: technical ones **auto-pass from collectors**, the rest are
   **attest + evidence upload**. Output: one honest **readiness %**. This is the
   thin-glue layer that makes Veritrail feel like "closer to SOC 2," not a scanner.
2. **Deepen identity** (already half-built): HR↔IdP terminated-user correlation,
   SSO-enforcement, and a **quarterly access-review export** (CC6.3 / CC6.1).
3. **Incident + recovery enrichment** (CC7.3–7.5, CC9.1): pull alert routing
   from Slack/PagerDuty; surface backup/DR evidence; attest the runbook.
4. **Endpoint / MDM** (Kandji, Jamf, Intune) — disk encryption + lock screen
   (CC6.x device controls). Fully technical, new collector.
5. **Cloud parity** (GCP / Azure collectors) — only when customers ask. Mirrors
   the AWS work; highest effort, lowest near-term leverage.

## Guardrails (do not implement — confirmed out of scope)

- Becoming the **auditor** (regulated CPA-firm function; conflicts with selling
  the tool).
- **Advisory-as-a-product** (services business, doesn't scale).
- Heavy **vendor-risk / security-training / policy-authoring** *modules* — thin
  attestation rows are fine; full products pull Veritrail into the Vanta/Drata
  breadth fight a solo founder loses.

## The honest tradeoff

Multi-source + a readiness % moves Veritrail toward Vanta/Drata's lane. The defense
is **depth** (blast-radius, least-privilege, AWS rigor) + **price** + serving
**engineering teams who want real technical evidence**, not 100 SaaS connectors
and checkbox theater. Go deep on the engineering stack; keep the human/document
GRC surface thin.
