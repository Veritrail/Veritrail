# Coverage boundaries — what Veritrail verifies, exactly

_The customer-facing contract. Every claim in the product, the evidence pack, and the
marketing site must stay inside these lines. Last updated: July 2026._

Veritrail is a **technical evidence collector**, not a GRC platform and not an auditor.
It verifies what it can observe through read-only integrations — cloud configuration,
source control, identity directories, device sync, vulnerability scanners — and it says
so explicitly everywhere a status is shown.

## Per-control coverage: verified vs. explicitly NOT verified

| Control (Compliance page) | Verified by checks | NOT verified (needs your evidence or your GRC) |
|---|---|---|
| Identity Governance & Access Review | root/MFA posture, unused credentials, privileged access, key rotation, device encryption (via Intune/Jamf sync) | formal quarterly access-review sign-offs |
| Identity & Access Inventory | inactive/dormant identities, unused credentials, inventory gaps across sources | owner attribution of accounts |
| Secure SDLC | branch protection, required reviews, CI security scanning, self-merge; capability lanes for dependency / SAST / secret / CI enforcement from GitHub/GitLab (enablement alone is not verified) | — (thorough for its claim) |
| Change Management | code review + branch protection; CloudTrail events for **Lambda + RDS changes only** | change approval for infrastructure; EC2/IAM/SG change events; ticket linkage |
| Data Protection | encryption at rest/in transit, public exposure, secret handling (AWS/GCP/Azure) | EFS/ElastiCache/Redshift; media-disposal policy (CC6.5 — uploaded evidence) |
| Network & Boundary | unrestricted ingress, public exposure, flow logs | — (thorough for its claim) |
| Vulnerability Management | Capability lanes graded from native sources when connected: GitHub/GitLab alert activity; AWS Inspector (EC2/ECR/Lambda); GCP OS Config + SCC; Azure Defender plans/assessments; optional scanners (Snyk/Wiz/Tenable/Qualys/Orca/Aikido); CrowdStrike/SentinelOne device denominator + sensor health. Open provider-native alerts are auto-resolved only after a successful authoritative inventory for that check; permission denied / unavailable APIs leave prior findings unchanged (never resolve-by-absence). Optional vendors are never mandatory when an equivalent native source covers the lane | human vulnerability-program process; EDR **policy administration** (machine-verifiable coverage only); Ultimate-only GitLab APIs when the token/tier cannot return Vulnerability Report data |
| Logging & Monitoring | CloudTrail/Config/Security Hub/GuardDuty/flow logs + provider equivalents; SIEM signal depth (Splunk/Datadog/Elastic) when synced — connectivity alone is not verification | **alerting/routing** quality and on-call exercise evidence |
| Threat Detection | detection services enabled, open findings surfaced; SIEM security-signal grading when rules/alerts are present | incident-response plans, triage workflows (CC7.3/CC7.4 — separate evidence); PagerDuty is **not** threat detection |
| Backup & Data Resilience | backups, PITR, deletion protection, snapshot hygiene | retention length; DR test evidence (CC7.5 exercise records) |

## Excluded from the product entirely (July 2026 scope decision)

Not shown as controls, because no Veritrail integration can ever verify them:
**MDM enrollment programs, HR & security-awareness training, vendor risk management,
and program-level SOC 2 criteria (CC1–CC5, CC9).** These belong to the customer's GRC
platform (Vanta, Drata, …), which Veritrail feeds.

**Endpoint security / EDR** was previously excluded entirely. CrowdStrike and SentinelOne
are now approved **machine-verifiable** technical evidence sources for host/workload
scanning (device denominator, agent/sensor health, licensed findings). Human endpoint-policy
administration remains outside Veritrail's scope and is not graded as a control.

## How the product enforces honesty in-UI

1. **Copy**: every control description claims only what its checks grade; "selected" /
   "supported" mark deliberate non-exhaustiveness.
2. **Capability lanes**: Vulnerability Management and Secure SDLC drawers show per-lane
   status, providers, assessed/eligible counts, freshness limitations, and actions that
   name the missing *capability* (not “Connect Snyk”).
3. **Capped chips**: a green composite whose sibling manual criteria (e.g. CC7.3/CC7.4
   for Threat Detection, CC6.5 for Data Protection) lack accepted evidence shows a paired
   **"Evidence pending"** chip — green-green only when the evidence is in.
4. **Mapping tab**: each mapped criterion shows its **own live status** (Passing /
   Failing / Needs evidence / Evidence attached), never inherited from the composite.
5. **Evidence pack**: capability narratives and `capability_lane_coverage.json` carry the
   same boundary notes so exports cannot over-claim.
6. **Scope note** under the Compliance list and the honest-scope section on the
   marketing site state the boundary before purchase.

## Rule for future work

A new check may **narrow** these boundaries (move an item from right column to left);
copy may then be updated in the same change. Never the reverse: no copy, chip, narrative,
or marketing text may claim coverage that has no corresponding check or accepted-evidence
join. When in doubt, the words are "selected", "supported", and "separate evidence".

Implementation phases for provider-equivalent technical evidence are specified in
[`technical-evidence-coverage-spec.md`](./technical-evidence-coverage-spec.md).
