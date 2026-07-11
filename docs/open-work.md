# Open work

**Single running list — everything else from prior specs shipped and those docs were removed.**
Add new items here going forward instead of opening new spec files, unless something is big
enough to need its own detailed design doc.

Status key: **done** · **open** · **blocked**

**Next up:** items **2 + 3** together (shared Workspace/Profile template restyle). Do not start
item 5 until 2–4 land. Item 6 is partner/human validation, not engineering.

Deep-research report mapping (composer backlog + human decisions):
[deep-research-roadmap.md](./deep-research-roadmap.md) — **composer buildable items shipped**
(§2.1–§2.12). Remaining: §3 human decisions + #11 GRC adapter (blocked on item 6).

---

## 1. Bug — account drill-down shows org-wide blockers, not account-scoped — **done**

`/accounts?account_id=<aws account>` — "What's blocking this account" was listing org-wide items
(GCP, GitHub) under the wrong cloud account.

**Evidence (dev + working tree):** `findingMatchesAccountRow` filters by provider + account id;
`accountBlockerFindings` feeds `AccountReadinessOverview` (same grouping/ranking as org home,
scoped down). Shipped in `dca641dd`. Intact under parallel Accounts.tsx WIP.

## 2. Workspace page — old design, never restyled — **open**

`/workspace` still uses the pre-redesign **structure**: 4-cell KPI strip
(`workspace-summary` / `PostureMetricCell`) + 2×2 `OverviewActionCard` grid + readiness panel.
Doesn't match Findings/History/Accounts (pill selector cards, denser tables, org-home summary).

**Note:** multi-color left borders are gone — tone variants (`blue`/`green`/`violet`/`amber`)
already collapse to teal accents via `--overview-accent` / `--vt-border` / `--vt-shadow-card`.
Remaining work is structural restyle to the current system, not a color pass.

## 3. Profile page — same old design, shares a template with Workspace — **open**

`/profile` (`Account.tsx`) imports `OverviewActionCard`, `PostureMetricCell`,
`PostureReadinessCell`, `ReadinessChecklistPanel` from `Workspace.tsx` and the same
`workspace-page.css`. Fix once with item 2 — don't design separately.

## 4. Integrations hub — visual restyle — **open** (troubleshoot panel shipped)

`/integrations` — table clip fix verified; cloud troubleshoot panel + scan-failure messaging
shipped (`CloudIntegrationTroubleshootPanel`). Page still reuses Workspace KPI strip
(`integrations-kpi-strip workspace-summary`) and a denser/plainer table than Findings.
Restyle to match current system — consider dropping the top stat row vs. an org-home-style
summary.

## 5. Findings page — minor tablet reflow at ~1024px — **open**

Account/Benchmark/Status selector cards wrap to a second row before reaching Status; severity
filter chips get a horizontal scrollbar; finding titles truncate harder. Partial tablet CSS
exists in `findings-overrides.css` / `findings-v2.css`, but the ~1024px toolbar squeeze remains.
Not broken — low priority; do after items 2–4.

## 6. GRC feed push validation — human action, not code — **blocked**

One binary test: push one Veritrail evidence artifact → one SOC 2 control on Vanta or Drata,
confirm it attaches/is auditor-visible/counts/supersedes idempotently. Needs a design-partner
customer's API key (fastest) or Drata's free no-CC trial — no self-serve signup on either.
**Decision gate:** push works → build the destination adapter. Push weak/gated → ship
export-only (GRC-ready ZIP + upload instructions). Do not build the adapter before this test.
Reference: `docs/grc-feed-validation.md`, `docs/grc-feed-api-runbook.md` (API details, still
current, kept as reference docs — not merged here since they're research, not a build spec).

---

## Recently shipped on `dev` (not tracked above)

- Org readiness home v4, accounts redesign, sidebar rename (Accounts → Home)
- Design-language drift fixes from design-consistency audit
- GCP/Azure resource type labels on Findings
- Per-resource evidence in Resources tab why column
- Verify fix for org-scoped GitHub/GitLab findings
- Org readiness Review links scoped to org-wide findings
- Account-scoped blockers + `AccountReadinessOverview` on account drill-down
- Cloud integration troubleshoot panel + scan-failure messaging
- Deep-research P0: evidence pack integrity UI + auditor verify affordance (§2.1)
- Deep-research P0: control-mapping "supports" phrasing + copy lint (§2.2)
- Deep-research P0–P2: write-remediation backend/infra retirement (§2.3); scheduled evidence
  exports (§2.4); control-coverage blocker weighting (§2.5); findings scale pass (§2.9);
  activation metric (§2.10); golden sandbox regression (§2.11); integration scope docs (§2.12)
- Deep-research rejections: ExternalId rotation (§2.6), OCSF export (§2.7), GDPR Art. 32
  mapping (§2.8) — removed from product; ISO / SOC 2 / CIS and initial ExternalId on connect kept
- Audit readiness page — auditor-language narrative (§8; shared PDF narrative builder)

## 7. History page — reframe from event log to control-timeline evidence — **open** (spec)

**Problem:** the History page is a flat event feed (Resolved / Reopened / Regressed rows). It answers
"what changed" but not "what does this prove," so it competes with — and loses to — Findings
(what's broken now) and Compliance (are we covered). Users barely open it. Worse, it shows churn: the
same 3–4 findings flapping Resolved→Reopened→Resolved fill the list with noise (e.g. Root MFA appears
4× in 30 days).

**Thesis:** History's real, unique job for an evidence company is **continuous-compliance proof over
the audit period** — "was this control in place the whole time, or fixed the week before the audit?"
No screenshot-based competitor can auto-produce that. Rebuild around control timelines + collapse
churn.

**Good news — backend already computes this.** `build_control_history`
(`api/app/services/compliance_timeline.py:40`, exposed at `GET /v1/controls/.../control-history`)
already returns, per control: **status segments over time** (passing/failing spans with
`from`/`to`/`duration_seconds`), `failing_since`, and current status. This is the audit-period
timeline data. The frontend just doesn't render it — it renders the event feed
(`build_compliance_timeline`) instead. **So this is primarily a frontend reshape, not a backend
build.** Confirm `control-history` is reachable org-wide / per selected framework; extend if it's
account-only.

### Primary reader: the customer's auditor first, engineer second
Lead with the audit-period view. It may also belong in the **auditor portal**, not only the main app
(decide during build — at minimum the main-app History adopts it).

### A. Control-timeline view (new default)
Replace the flat table's default with **one row per control**, each showing a horizontal timeline bar
across the selected period:
- Green spans = passing, red spans = failing, grey = no data — from `control-history` segments.
- Right-side summary: current status + "failing since {date}" or "passing {N} days".
- Example a reader immediately understands: *"CC6.6 — failing Jun 26–30, remediated Jul 1, passing
  since."*
- Group rows by capability domain (same grouping as Compliance page) so it reads like the audit
  evidence it is.
- Click a control row → drill into its findings/events (the current detailed feed, scoped to that
  control) — keep the event feed, demote it to a drill-down, don't delete it.

### B. Collapse churn (applies to the event feed wherever it still shows)
- Collapse repeat flaps of the same finding into one row: "Root MFA — flapped 4× in 30d, now
  resolved," expandable to the individual events.
- Default the event filter to **material** changes only: first-time regressions (newly failing) and
  first-time resolutions — not every nightly re-detection. Add a "show all activity" toggle for the
  raw feed (power users / debugging).

### C. Reframe rows around readiness, not raw findings
- Each event's headline = its effect on readiness, not the check label: "Regressed — Backup &
  Recovery dropped below passing" over "IAM account — no longer detected."
- Keep the control id, but as secondary metadata, not the primary column.

### Acceptance
1. History defaults to a per-control timeline (green/red spans over the period), grouped by capability
   domain, driven by `control-history` segments — not the flat event feed.
2. An auditor can see, per control, whether it held across the whole period and exactly when any gap
   opened/closed.
3. Repeated flaps of one finding collapse to a single row; the default view shows material changes,
   with an opt-in "all activity" toggle.
4. The raw event feed still exists as a per-control drill-down — nothing lost, just demoted.
5. No backend timeline recomputation added unless `control-history` proves account-only and needs an
   org-wide/framework-wide variant (extend, don't rebuild).

### Open question for build
- Does the timeline live **only** in the main app, or is it (also) promoted into the auditor portal?
  Recommend: build in main-app History now; mirror into the auditor portal as a fast follow, since
  that's where the audit-period question is actually asked.

## 8. New page: "Audit readiness" (auditor-language evidence narrative) — **done**

**Evidence (dev):** `GET /v1/audit-readiness`, shared narrative builder extracted from
`pdf_narrative.py` (`audit_readiness.py`), and `AuditReadiness.tsx` route + nav. Shipped in
`89f51588`.

**Idea (from Ellie):** a page that states SOC 2 readiness in the language an auditor actually uses —
narrative assertions backed by real evidence, not pass/fail chips. Examples of the target language:
- "DR is in progress. Services A and B active on accounts C and D."
- "Vulnerability scanning enabled via AWS Inspector. On {date}, {N} critical vulnerabilities were
  remediated, reducing critical count from {A} to {B}."
- "SDLC controls verified: default branch protection enforced and Dependabot enabled across {N}
  repositories."

This is the highest-leverage surface for an evidence company — it's the auditor-facing "system
description / control narrative" auto-written from data, which screenshot-based tools cannot produce.

**Naming:** Ellie called it "Checklist," but the content is narrative assertions, not checkboxes.
Recommend title **"Audit readiness"** (or "Readiness narrative"); each item carries a status marker
(supported / partially supported / not affirmed) + prose. Confirm title during build.

### Most of this already exists — surface it, don't rebuild it
`api/app/services/pdf_narrative.py` **already generates** the target content, today, for the evidence
PDF only:
- Per **capability domain** (Identity & Access, SDLC & Source Control, etc. — `DOMAIN_DEFS`).
- Evidence-anchored **assertion paragraphs** (`_assertion_text`) with live numbers ("{X} of {Y}
  automated checks reported no open findings"), verified-evidence phrases, gaps vs documented
  exceptions, account scope, and as-of timestamp.
- The exact auditor-safe phrasing rules are already enforced (assertions say a capability "is
  supported by collected evidence" — never "fulfills / compliant / secure"). Do not loosen these.
- Pre-written per-control narratives also exist in `api/app/data/control_narratives.py`
  (`narrative_for(framework, control_id)`).

### Backend work
1. **Extract the narrative builder from the PDF path into a reusable service** that returns
   **structured JSON** (domain → { status, assertion_text, coverage_line, verified_phrases[],
   gaps[], exceptions[], control_tags[], evidence_refs[] }). `pdf_narrative.py` currently returns
   PDF-bound structures; refactor so both the PDF and a new API endpoint consume the same builder —
   single source of truth, no divergence between what the page says and what the pack says.
2. **New endpoint** `GET /v1/audit-readiness?framework=soc2` returning the structured domains
   org-wide (same scoping as the org readiness home — cloud + source-control + identity).
3. **Add the temporal / remediation sentence** the examples call for — pdf_narrative is point-in-time
   ("as of X"); this page needs "on {date}, {N} critical vulns closed, reduced from {A} to {B}" and
   "DR in progress." Pull from the control-timeline segments + finding resolution events (item 7's
   `build_control_history` data) to generate one trend sentence per domain where there's a material
   change in-period. Reuse item 7's backend — do not build a second timeline computation.
4. **Make phrases concrete where data allows** — name the services/accounts/repos ("AWS Inspector on
   accounts C, D"; "Dependabot on {N} repos") rather than generic "checks passed," pulling from the
   evidence the domain's checks already carry.

### Frontend
- New route + nav entry. Page = stacked capability-domain cards, each:
  - Domain title + status marker (supported / partial / not affirmed).
  - The assertion paragraph (auditor prose).
  - The temporal sentence when present ("On {date}, remediated…").
  - Coverage line + framework control tags (CC6.1, A.9.2.5, …).
  - "View evidence" → drills to the findings/resources backing it (reuse existing findings drawer /
    Compliance drawer).
- Minimal, document-like layout (this reads like a report, not a dashboard) — matches the calm
  org-home / minimal system, not the old dense card style.
- A "Copy for questionnaire" / "Export" affordance per domain is high value (auditors paste these
  into SOC 2 questionnaires) — the `control_narratives.py` copy is literally labeled "copy-paste
  starting points for questionnaires."

### Where it lives
Primary: main app, new top-level page. Strong candidate to **also** surface in the auditor portal
(same structured endpoint) — the auditor is the ideal reader. Build main-app first; mirror to portal
as fast-follow (same pattern noted for item 7).

### Acceptance
1. New "Audit readiness" page renders per-domain auditor-language assertions driven by the shared
   narrative builder (same source as the evidence PDF — page and pack never disagree).
2. Assertions carry live numbers, named sources where available, and at least one temporal/remediation
   sentence per domain when a material in-period change exists.
3. Auditor-safe phrasing preserved verbatim (no "compliant"/"secure"/"fulfills").
4. Each domain drills to the evidence behind it; each domain is copy/exportable for questionnaires.
5. PDF evidence pack still renders identically (shared builder, no regression).

### Depends on / relates to
- Reuses item 7 (`build_control_history`) for the temporal sentences — sequence after or alongside 7.
- Reuses existing `pdf_narrative.py` + `control_narratives.py` — this is ~70% surfacing existing
  backend, ~30% new (JSON endpoint + temporal layer + page).

### Item 8 appendix — full SOC 2 (TSC) → Veritrail coverage map (the page's data model)

**Note:** `docs/soc2-coverage-map.md` is stale ("9 mapped controls", 2026-06-22). Veritrail now maps
**36 SOC 2 controls** (all of CC1–CC9 + A1) across 15 composite domains. This appendix is the current
truth and the data the Audit-readiness page renders. Legend: **AUTO** = Veritrail proves from
collected evidence · **ENABLE** = a service to turn on, then AUTO (absence-gap) · **EXTERNAL** =
human/policy/vendor evidence, uploaded & attested · **SHARED** = cloud-provider responsibility
(AWS SOC 2 report).

#### CC6 — Logical & Physical Access  (Veritrail's deepest domain — AUTO)
| Control | Assertion Veritrail can make | Source / service |
|---|---|---|
| CC6.1 | Logical access + identity inventory monitored | AWS IAM; Okta / Entra / Google Workspace |
| CC6.2 | Credential registration: no root keys, MFA enforced, password policy meets baseline | AWS IAM; identity MFA |
| CC6.3 | Least privilege + access removal (wildcard policies, external trust, unused grants) | AWS IAM; identity. HR↔IdP deprovisioning = **EXTERNAL** |
| CC6.4 | Physical access to facilities | **SHARED** (AWS data-center SOC 2) |
| CC6.5 | Data disposal / logical teardown | S3 lifecycle partial; mostly **EXTERNAL** policy |
| CC6.6 | External threat controls: no unrestricted ingress, threat detection on | GuardDuty, Security Hub, security groups, MFA (**ENABLE** GuardDuty) |
| CC6.7 | Transmission encryption (TLS in transit) | ELB TLS, S3 HTTPS-only policy |
| CC6.8 | Encryption at rest / unauthorized-software prevention | EBS/RDS/S3 KMS; GuardDuty malware |

#### CC7 — System Operations  (AUTO + ENABLE, with EXTERNAL IR process)
| Control | Assertion | Source / service |
|---|---|---|
| CC7.1 | Config-change + vulnerability detection running | AWS Config, Inspector, Security Hub, CloudTrail (**ENABLE** Config, Inspector) |
| CC7.2 | Security-event / anomaly monitoring active | GuardDuty, CloudTrail anomaly, VPC Flow Logs (**ENABLE** VPC Flow Logs, GuardDuty) |
| CC7.3 | Security events evaluated | Findings triage in Veritrail (partial) + **EXTERNAL** IR process |
| CC7.4 | Incident response | Detection services on = precondition (AUTO); runbook + post-mortems = **EXTERNAL** |
| CC7.5 | Recovery from incidents | Backup config (AUTO) + DR test = **EXTERNAL** |

#### CC8 — Change Management  (AUTO via source control)
| Control | Assertion | Source / service |
|---|---|---|
| CC8.1 | Authorized, reviewed, tracked changes: branch protection, required reviews, Dependabot, CI checks | GitHub / GitLab; IaC repo |

#### CC9 — Risk Mitigation
| Control | Assertion | Source / service |
|---|---|---|
| CC9.1 | Business-disruption mitigation | Backup/DR config (partial AUTO) + **EXTERNAL** |
| CC9.2 | Vendor / business-partner risk | **EXTERNAL** (vendor assessments, DPAs) — Vendor Risk Mgmt domain |

#### A1 — Availability
| Control | Assertion | Source / service |
|---|---|---|
| A1.1 | Capacity monitored | Partial cloud metrics; mostly **EXTERNAL** |
| A1.2 | Backup & recovery infrastructure in place | AWS Backup, RDS multi-AZ + automated backups, EBS snapshots (**ENABLE** Backup plan) |
| A1.3 | Recovery tested | **EXTERNAL** (DR test evidence) — this is the "DR in progress" narrative Ellie wrote by hand |

#### CC1–CC5 — Governance, Risk, Monitoring, Control Activities  (mostly EXTERNAL)
| Group | Assertion | Source |
|---|---|---|
| CC1 Control environment | Org structure, integrity/ethics, board oversight, competence | **EXTERNAL** (policies, org chart, code of conduct, job descriptions) |
| CC2 Communication & information | Security policies communicated internally/externally | **EXTERNAL** (policy acknowledgments) |
| CC3 Risk assessment | Risk identification / analysis / fraud / change impact | **EXTERNAL** (risk register); Veritrail finding inventory = supporting input only |
| CC4 Monitoring activities | Ongoing control monitoring + deficiency remediation | **AUTO (narrative win):** Veritrail's continuous scanning + finding-remediation tracking *is* an ongoing monitoring activity — assert it here. Formal internal-control evaluation = **EXTERNAL** |
| CC5 Control activities | Control selection + technology general controls + policies | Tech general controls partial AUTO; policies **EXTERNAL** |

#### The "turn these on" checklist (ENABLE — absence-gap services, already in `evidenceGap.ts`)
Each, when enabled, flips from a red finding to an AUTO assertion, and the page should render the
concrete enable action + the control it satisfies:
- **CloudTrail** → CC7.1 / CC7.2 logging
- **VPC Flow Logs** → CC7.2 / CC6.6 network monitoring
- **AWS Config** → CC7.1 config-change detection
- **GuardDuty** → CC6.6 / CC7.2 threat detection
- **Security Hub** → CC7.1 / CC7.2 aggregated posture
- **IAM Access Analyzer** → CC6.3 / CC6.6 external-access review
- **AWS Inspector** → CC7.1 vulnerability scanning
- **ECR image/enhanced scanning** → CC7.1 container vulnerability
- **AWS Backup plan** → A1.2 resilience

#### External-evidence-only domains (upload + attest, never AUTO)
Endpoint Security & EDR · Device Management (MDM) · HR & Security Awareness Training · Vendor Risk
Management · plus CC1/CC2/CC3 governance, CC6.4 physical, CC7.4 IR runbooks, A1.3 DR test.

**Page implication:** each Audit-readiness domain card is one of three states — **Proven** (AUTO,
assertion + evidence), **Turn on** (ENABLE, one-click service + which control it satisfies), or
**Attach evidence** (EXTERNAL, upload/attest). This is exactly Ellie's monitoring/logging +
threat-detection example generalized across the whole TSC.
