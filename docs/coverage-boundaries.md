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
| Secure SDLC | branch protection, required reviews, CI security scanning, self-merge | — (thorough for its claim) |
| Change Management | code review + branch protection; CloudTrail events for **Lambda + RDS changes only** | change approval for infrastructure; EC2/IAM/SG change events; ticket linkage |
| Data Protection | encryption at rest/in transit, public exposure, secret handling (AWS/GCP/Azure) | EFS/ElastiCache/Redshift; media-disposal policy (CC6.5 — uploaded evidence) |
| Network & Boundary | unrestricted ingress, public exposure, flow logs | — (thorough for its claim) |
| Vulnerability Management | Inspector/ECR/scanner coverage, AMI age, deprecated runtimes | dependency *alerts* (only "scanning enabled" is checked) |
| Logging & Monitoring | CloudTrail/Config/Security Hub/GuardDuty/flow logs + provider equivalents | **alerting/routing** (no CloudWatch-alarm or SNS-subscription checks) |
| Threat Detection | detection services enabled, open findings surfaced | incident-response plans, triage workflows, alert routing (CC7.3/CC7.4 — separate evidence) |
| Backup & Data Resilience | backups, PITR, deletion protection, snapshot hygiene | retention length; DR test evidence (CC7.5 exercise records) |

## Excluded from the product entirely (July 2026 scope decision)

Not shown as controls, because no Veritrail integration can ever verify them:
**Endpoint security / EDR, MDM enrollment programs, HR & security-awareness training,
vendor risk management, and program-level SOC 2 criteria (CC1–CC5, CC9).** These belong
to the customer's GRC platform (Vanta, Drata, …), which Veritrail feeds.

## How the product enforces honesty in-UI

1. **Copy**: every control description claims only what its checks grade; "selected" /
   "supported" mark deliberate non-exhaustiveness.
2. **Capped chips**: a green composite whose sibling manual criteria (e.g. CC7.3/CC7.4
   for Threat Detection, CC6.5 for Data Protection) lack accepted evidence shows a paired
   **"Evidence pending"** chip — green-green only when the evidence is in.
3. **Mapping tab**: each mapped criterion shows its **own live status** (Passing /
   Failing / Needs evidence / Evidence attached), never inherited from the composite.
4. **Evidence pack**: capability narratives carry the same boundary notes
   (`DOMAIN_BOUNDARY_NOTES` in `pdf_narrative.py`) so exports cannot over-claim.
5. **Scope note** under the Compliance list and the honest-scope section on the
   marketing site state the boundary before purchase.

## Rule for future work

A new check may **narrow** these boundaries (move an item from right column to left);
copy may then be updated in the same change. Never the reverse: no copy, chip, narrative,
or marketing text may claim coverage that has no corresponding check or accepted-evidence
join. When in doubt, the words are "selected", "supported", and "separate evidence".
