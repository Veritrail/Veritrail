# Veritrail product assessment — June 2026

Snapshot taken 2026-06-11 on `dev`. Numbers from the codebase: ~135 registered
checks across 142 check files, 27 collectors, 9 SOC2 + 41 CIS AWS L1 + 16
ISO 27001 controls mapped, 4 identity integrations (GitHub, GitLab, Entra,
Google Workspace + Identity Center collector), full evidence stack (pack,
vault, coverage, diff, PDF, weekly digest).

## 1. Where we are

Late beta, pre-revenue, feature-complete for the wedge. The core loop works
end to end: connect AWS → scan → grouped findings → per-resource evidence →
remediation (console / CLI / Terraform / SSM with confidence gating) →
compliance rollups → evidence pack. Differentiators that competitors do not
have at this price point: blast radius, least-privilege policy generation
from observed usage, evidence-over-time. The gaps are production hardening,
a real customer, and trust signals — not features.

## 2. Scan coverage

135 checks is competitive for the ICP. Quality over quantity now. The only
additions worth making fix visible holes on our own compliance page:

- **CIS 1.17 (IAM instance roles)** — mapped control with 0 checks; renders
  permanent "no data". Implement with existing EC2 collector data.
- **CIS 1.5 (hardware MFA for root)** — 0 checks; not reliably detectable via
  API (`GetAccountSummary` does not distinguish hardware vs virtual MFA).
  Mark manual attestation so it stops reading as a gap.
- **AWS Backup plans** — ISO A.12.3.1 has only 3 checks; backup evidence is
  auditor-sampled. Needs `backup:ListBackupPlans` etc. added to the read-only
  CFN role — customer-facing role change, schedule with the next connector
  template rev.

Do NOT build DNS / WAF / CloudFront / Shield checks — not SOC2-relevant (see
§6). Multi-account AWS Orgs support is worth more than any new service check.

## 3. UI

Findings / Compliance / finding drawer are ~9/10 after the June pass
(grouped findings, affected-resources cards, posture strips, hero strip,
segmented controls, token type scale). Remaining: expand/collapse motion,
empty/positive states (emerald moments — partly data-dependent), dead-code
sweep, the History page. Stop polishing past that; diminishing returns.

## 4. Wording

Fixed this cycle: CMK vs "not encrypted" accuracy, least-privilege merge,
info severity tier, S3/encryption labels. Standing rule: **every encryption
title must carry the "customer-managed key (SSE-KMS)" qualifier** —
DynamoDB / SNS / SQS / EBS are encrypted at rest by default with AWS-owned
keys, so a bare "not encrypted at rest" is factually wrong and an
auditor-savvy customer will call it out. The error class to hunt: claims that
are technically false vs merely strict. Process: QA pass over the ~30 checks
that fire in the sandbox; long tail QA'd as each first fires on a real
account.

## 5. Competitive gaps

- vs **Vanta / Drata** (the real fight): policy templates, employee/device
  management, vendor management, auditor portal / trust page, ticketing +
  Slack integrations. We deliberately skip GRC. The one table-stakes item:
  **Slack alerts + ticket creation (Jira/Linear)** — asked for in first
  demos AND doubles as CC7 incident-response evidence. Slack webhook
  implemented this cycle; Jira/Linear deferred.
- vs **Wiz / Orca**: attack-path graph, workload scanning. Not our fight;
  blast radius is our graph story.

## 6. SOC2 Type II readiness (CC6/CC7)

- **CC6: yes**, with one soft spot — CC6.7 (transmission encryption) had a
  single check; remapped ELB weak-TLS into it this cycle.
- **CC7: automated half yes** — CC7.1 (19 checks) and CC7.2 (9 via CloudTrail
  events / GuardDuty / Config) are strong. The procedural half (CC7.3–7.5,
  incident response evidence) is tickets, response timelines, post-mortems —
  no scan produces that. Path: ticketing integration + first-class manual
  attestation.
- **DNS is not a SOC2 requirement. Skip it.**
- The Type II ace is already built: evidence snapshots + period coverage +
  control history. The one unforgivable failure is a silent scan gap inside
  the audit window → missed-scan alerting implemented this cycle (>26h
  since last successful scan).

## 7. Finding QA ("fail over all findings?")

Two readings, two answers:

- **QA every finding**: yes, tiered. Manually verify the ~30 check types that
  fire in the sandbox (title / severity / evidence / remediation), QA the
  long tail as each first fires.
- **Should every finding fail a control**: no. Info-severity and hygiene
  evidence-class findings must not flip a control to failing — otherwise
  customers see un-passable controls and trust drops.

## 8. Things we are doing wrong (and fixes)

1. **No CI typecheck gate** — tsc errors live on the tree while Vite serves
   happily. Fix: CI job running `tsc --noEmit` (added this cycle).
2. **Findings page fetches `limit=500` once** — grouping silently breaks past
   500 findings; a 2-account customer hits that. Fix: cursor-walk all pages.
3. **15 `cloudtrail.event.*` checks share the posture lifecycle** — "Root
   account API activity" is a detection, not a misconfiguration; it resolves
   oddly on re-scan. Fix: tag as activity class, present separately.
4. **No real-customer E2E** — seeded sandbox + production deploy remain the
   actual blockers; UI polish past 9/10 is deferred from this.
5. **RESEND key + `onboarding@resend.dev` sender** — rotate key, verified
   domain before prod (pre-prod blocker from CLAUDE.md).

## Priority order

CI typecheck gate → wording QA on firing checks → CC6.7 remap + CIS 1.17 →
Slack (CC7 evidence + competitive) → production deploy + missed-scan
alerting → multi-account AWS Orgs.

## Implementation log (2026-06-11, dev branch)

Filled in by the implementation pass that accompanied this assessment — see
git history on `dev` for the commits, one per item.
