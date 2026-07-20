# EDR live validation record

Use this template when promoting CrowdStrike or SentinelOne from **Beta** to GA after a real-tenant gate (see `docs/evidence-coverage-production-hardening-spec.md` §5.6).

**Do not record credentials, client secrets, API tokens, OAuth responses, or other secrets in this file or in linked tickets.**

Copy a filled block into release notes or keep a private ops copy outside the repo if counts are customer-sensitive. Public checklist entries may omit tenant identifiers.

---

## Record

| Field | Value |
| --- | --- |
| **Provider** | CrowdStrike / SentinelOne |
| **Date** | YYYY-MM-DD |
| **Region** | e.g. US-1, EU-1, or management console site |
| **Validating release SHA** | `git rev-parse HEAD` of the build under test |
| **Collected counts** | devices/agents: _; healthy: _; open findings: _ |
| **Resulting lane state** | e.g. covered / partial / not_covered / unknown |
| **Limitations** | codes + plain language (no secrets); e.g. `spotlight_vulnerabilities_not_licensed` |
| **Connect succeeded** | yes / no |
| **Multi-page sync completed** | yes / no |
| **Denominator vs console** | match within documented tolerance? yes / no — notes: _ |
| **Permission denial check** | non-covered evidence + useful UI copy? yes / no |
| **Second sync stable** | counts stable, no duplicate findings? yes / no |
| **Disconnect** | credentials removed and syncs stop? yes / no |
| **Validator** | name / role |
| **Notes** | (optional; no credentials) |

---

## GA checklist (copy status)

- [ ] Connect succeeds against a real tenant
- [ ] A multi-page sync completes
- [ ] Denominator matches the provider console within a documented tolerance
- [ ] A permission denial produces non-covered evidence and useful UI copy
- [ ] A second sync preserves stable counts and does not duplicate findings
- [ ] Disconnect removes credentials and stops future syncs

Until one provider passes this gate, both CrowdStrike and SentinelOne remain labeled **Beta** and must not be treated as definitive audit claims for host/workload scanning alone.
