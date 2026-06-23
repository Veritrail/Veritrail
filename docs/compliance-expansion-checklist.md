# Veritrail compliance expansion checklist

_Mapped from deepsearch (CC6/CC7, EKS, containers, Inspector, SDLC) + session Q&A + architecture review (2026-06-06)._  
_Last updated: 2026-06-07 (Workspace/Entra identity, admin review, SDLC status checks, mapping audit, backup runbook)_

Use this as the single backlog for **what Veritrail should verify**, **what is already shipped**, and **what is explicitly out of scope for v1**.

Legend: `[x]` done · `[~]` partial · `[ ]` not started · **P0** ship next · **P1** soon · **P2** later · **P3/P4** future / rabbit hole

**Strategic shift:** Veritrail is moving from “scanner” (individual findings) to **compliance platform** (control-level evidence aggregation). Drata/Vanta win on *“show me evidence this control is operating”* — not on finding more CVEs. Composite controls are the product.

---

## 0. Locked product decisions (do not re-litigate)

| Decision | Rationale |
|----------|-----------|
| **Agentless AWS API scanning is the default** | No DaemonSet / pod agent unless customer opts into future “Runtime Monitoring” add-on. |
| **Private EKS API endpoints are fine** | Veritrail uses `eks:DescribeCluster` (AWS control plane), not the Kubernetes API. |
| **Do not require customer source-code access** | Verify SDLC *controls* and *evidence*, not file contents. |
| **Dockerfile scanning is not compliance evidence** | **P3/P4** engineering quality. Auditors care about image vulns tracked/remediated. |
| **Do not name vendor products as the control** | “Container vulnerability monitoring not detected” — not “AWS Inspector disabled.” |
| **Runtime claims require runtime agents** | Falco/eBPF/DaemonSet only if product claims malware/runtime/threat detection. |
| **CFN stack update required for new IAM actions** | Customer must update connector stack, then re-scan. |
| **Run migrations automatically** | Apply `alembic upgrade head` when adding revisions. |
| **Do not auto-deploy CloudTrail silently** | Onboarding: **Use existing trail** OR **Deploy Veritrail-managed trail** — org trails are common. |
| **Customer Terraform repo scanning is a rabbit hole** | **P4** — competes with Checkov/Wiz/Prisma/Snyk; differentiator is **deployed state**. |

**Sharp positioning:**

> Veritrail verifies compliance controls and evidence continuously without requiring access to customer source code. Runtime agents and code scanning are optional extensions, not baseline requirements.

---

## 1. Composite controls (control-level aggregation)

These are the **auditor-facing** units. Individual findings are evidence signals underneath.

| Composite control | Status | Priority | Primary SOC2 | Notes |
|-------------------|--------|----------|--------------|-------|
| **Container vulnerability monitoring** | [x] | **P0** | CC7.1–7.3, CC6.8 | Inspector ECR + EC2 + Lambda + alt sources (GitLab/GitHub CI metadata) |
| **Secure SDLC** | [x] | **P0** | CC6, CC8 | Composite roll-up + GitHub security metadata checks |
| **Change management** | [x] | **P0** | CC6, CC8 | PR required, direct push blocked, audit trail retained |
| **Identity governance & access review** | [x] | **P0** | **CC6** | Composite roll-up over IAM + GitHub/GitLab signals |
| **Logging & monitoring** | [x] | P1 | CC7 | CloudTrail, GuardDuty, Config — composite roll-up shipped |
| **Vulnerability management** (account-wide) | [x] | P1 | CC7 | Superset of container control; includes Inspector EC2/Lambda, patch posture |

### 1.1 Identity governance & access review (CC6) — **NEW, P0**

One of the most common SOC 2 evidence requests. Must answer: *“Show me access is reviewed and stale identity is removed.”*

| Evidence signal | Status | Source | Notes |
|-----------------|--------|--------|-------|
| IAM users inactive 90d+ | [x] | `iam.user.inactive_90d` | |
| IAM user credentials unused 45d | [x] | CIS-aligned checks | |
| IAM roles unassumed 90d | [x] | `iam.role.unassumed_90d` | |
| Root MFA / root usage / root keys | [x] | IAM root checks | |
| GitHub org MFA not enforced | [x] | `github.org.mfa_not_enforced` | |
| GitHub dormant members | [x] | `github.org.dormant_members` | |
| GitLab org MFA / dormant | [x] | GitLab checks | |
| Identity Center user inventory | [x] | Collector exists | `identity_center.user.inactive_90d` — directory update staleness proxy (no last-login API) |
| **Privileged IAM users / admins reviewed** | [x] | **P0** | `iam.user.admin_policy_attached` |
| **GitHub org owners / admins reviewed** | [x] | **P0** | `github.org.admin_unreviewed` |
| **Break-glass / emergency accounts documented** | [ ] | P1 | Manual attestation + detect wildcard admin roles |
| **Terminated employee removal (HR ↔ IdP)** | [~] | **P0** | Google Workspace + Entra integrations shipped; HR correlation still manual |
| **Periodic access review attestation** | [ ] | P1 | Product feature: quarterly sign-off export |
| **Composite: Identity governance** pass/fail | [x] | **P0** | `COMPOSITE.IDENTITY_GOVERNANCE` via `/v1/controls/composites` |

---

## 2. Session work completed (2026-06-06)

### Login / auth UX
- [x] “Keep me signed in for 30 days” — custom quiet checkbox
- [x] Remember-me backend + Chrome password save + sign-out field clearing

### AWS containers (agentless)
- [x] ECR / EKS / ECS collectors + checks (see §4)
- [x] CFN IAM for ECR/EKS/ECS + RDS snapshots
- [x] Migration `0049` applied
- [ ] **Customer:** update CFN connector stack, re-scan

### UI
- [x] Finding timeline — `formatFindingSeenAt()`

---

## 3. AWS agentless scanning — EKS / ECS / ECR

### 3.1 EKS (AWS API only — no K8s API, no agent)

| Item | Status | Priority | Notes |
|------|--------|----------|-------|
| Public endpoint `0.0.0.0/0` / `::/0` | [x] | — | `eks.cluster.public_endpoint` |
| Control plane logging enabled | [x] | **P0** | CIS EKS — `eks.cluster.control_plane_logging_disabled` |
| Secrets encryption (KMS) | [x] | **P0** | `eks.cluster.secrets_encryption_disabled` |
| Node group posture | [ ] | P1 | `DescribeNodegroup` |
| K8s RBAC / NetworkPolicy / in-pod runtime | [ ] | **Deferred** | Different product if claimed |

**DaemonSet:** Correctly **out of scope** for SOC2/ISO/CIS AWS baseline. Only needed for runtime/threat/malware claims.

### 3.2 ECS (AWS API only)

| Item | Status | Priority |
|------|--------|----------|
| Container Insights disabled | [x] | — |
| Service public IP assigned | [x] | — |
| Privileged container (active task def) | [x] | — |
| Task def hardening (non-root, read-only root FS) | [ ] | P1 |

### 3.3 ECR & Inspector (vulnerability **evidence**, not vendor requirement)

Inspector v2 is the cleanest AWS-native signal. Collect **all resource types Inspector exposes** — customers will ask “why only containers?”

| Item | Status | Priority | API |
|------|--------|----------|-----|
| ECR scan-on-push disabled | [x] | — | `ecr:DescribeRepositories` |
| ECR registry enhanced scanning | [x] | **P0** | `ecr:GetRegistryScanningConfiguration` |
| **Inspector — ECR status & coverage & findings** | [x] | **P0** | `BatchGetAccountStatus`, `ListCoverage`, `ListFindings` |
| **Inspector — EC2 status & active findings** | [x] | **P0** | Same APIs, `resourceType` EC2 |
| **Inspector — Lambda status & active findings** | [x] | **P0** | Same APIs, `resourceType` Lambda |
| Inspector finding details (drawer only) | [ ] | P1 | `BatchGetFindingDetails` |
| Dockerfile linting | [ ] | **P3** | Engineering quality, not audit primary |
| Image signing / tag immutability | [ ] | P2 | |

**CFN IAM (Inspector phase):**

```yaml
- inspector2:BatchGetAccountStatus
- inspector2:ListCoverage
- inspector2:ListCoverageStatistics
- inspector2:ListFindings
- inspector2:BatchGetFindingDetails
- ecr:GetRegistryScanningConfiguration
- ecr:DescribeImages   # optional enrichment
```

**Finding wording:** “Container vulnerability monitoring not active” / “No vulnerability scanning evidence detected” — never “Inspector disabled.”

---

## 4. Secure SDLC & change management (CC6 / CC8)

SOC2 does **not** mandate SAST by name. Verify **process evidence**.

| Item | Status | Priority | Notes |
|------|--------|----------|-------|
| Branch protection / required reviews | [x] | — | GitHub + GitLab |
| Code owners | [x] | — | |
| Self-merge blocked | [x] | — | |
| **GitHub environment protection (prod)** | [x] | — | `github.repo.no_env_protection` |
| **GitHub required reviewers on environments** | [~] | **P0** | Partial via env protection check |
| **GitLab protected environments / manual approvals** | [x] | **P0** | `gitlab.repo.no_env_protection` via protected environments API |
| Dependabot / CodeQL / secret scanning enabled | [x] | **P0** | GitHub metadata — `github.repo.*_disabled` checks |
| GitLab SAST / dependency / container scan jobs in CI | [x] | **P0** | Pipeline job metadata — `gitlab.repo.*_disabled` checks |
| Required status checks include security jobs | [x] | **P0** | `github.repo.security_status_checks_missing`, `gitlab.repo.security_ci_not_required` |
| **Composite: Secure SDLC** | [x] | **P0** | `COMPOSITE.SECURE_SDLC` via `/v1/controls/composites` |
| **Composite: Change management** | [x] | **P0** | `COMPOSITE.CHANGE_MANAGEMENT` via `/v1/controls/composites` |

---

## 5. CloudTrail & logging (CC7)

| Item | Status | Priority | Notes |
|------|--------|----------|-------|
| Trail enabled / validation / KMS / CW / S3 hardening | [x] | — | Individual checks exist |
| Event-based detections | [x] | — | |
| **Onboarding: Use existing trail OR deploy new** | [x] | **P1** | Accounts UI + `PATCH /v1/accounts/{id}/cloudtrail-onboarding` |
| Optional “Deploy Veritrail-managed trail” module | [ ] | P1 | Named, documented, customer opt-in |
| Central log account + MFA Delete on log bucket | [ ] | P2 | Detect + document pattern |

---

## 6. Integrations (priority order)

| Integration | Status | Priority | Rationale |
|-------------|--------|----------|-----------|
| GitHub evidence | [x] | — | SDLC + identity signals |
| GitLab evidence | [~] | **P0** | Token refresh on 401 + reconnect UX |
| **Google Workspace** | [x] | **P1 (60d)** | Admin Directory OAuth + identity checks |
| **Microsoft Entra ID** | [x] | **P1 (60d)** | Graph directory read + parallel checks |
| Slack | [ ] | P2 | |
| Jira / Monday / Linear | [ ] | P3 | After identity integrations |

---

## 7. Veritrail platform operations — **highest internal risk**

If Veritrail loses findings, evidence, history, or compliance snapshots, the product is dead. This section was **underweighted in v1**.

| Item | Status | Priority | Notes |
|------|--------|----------|-------|
| Postgres backup exists | [~] | — | `pg_dump` + optional B2 |
| **Scheduled backup verification (automated)** | [~] | **Top 5** | `scripts/verify-backup.sh` + runbook |
| **Restore test + evidence** | [~] | **Top 5** | Checklist in `docs/backup-restore-runbook.md` |
| **Documented RPO/RTO** | [x] | **Top 5** | `docs/backup-restore-runbook.md` |
| Backup encryption + retention policy | [ ] | **P0** | |
| Backup monitoring / alerting | [ ] | P1 | |
| Production TLS, secrets in Secrets Manager | [ ] | P1 | |

---

## 8. Compliance mapping audit — **before launch**

Mapping errors damage trust faster than UI bugs. Do **not** assume CC6.8 = vulnerability management without verification.

| Task | Status | Priority |
|------|--------|----------|
| Full SOC2 mapping review for every `check_id` | [x] | **P0 pre-launch** | `test_control_mappings.py` + `test_compliance_frontend_mappings.py` |
| Full ISO27001 mapping review | [x] | **P0 pre-launch** | Same CI guards |
| Full CIS AWS mapping review | [x] | **P0 pre-launch** | Same CI guards |
| Spot-check: root MFA, access keys, SG, CloudTrail, ECR, Inspector | [ ] | **P0 pre-launch** |
| Composite control → finding roll-up documented in Controls UI | [x] | P1 |

Source files: `api/data/control_mappings.json`, `web/src/data/checkComplianceCopy.ts`, `docs/cis-v5-40-controls.md`.

---

## 9. Explicitly deferred (rabbit holes)

| Item | Priority | Why |
|------|----------|-----|
| Customer Terraform/IaC repo scanning | **P4** | Competes with Checkov/Wiz/Prisma; not differentiator |
| Dockerfile linting | **P3** | Engineering quality |
| EKS DaemonSet / Falco / eBPF runtime | **P2+ add-on** | Different product claim |
| In-cluster K8s RBAC/NetworkPolicy scans | **P2+** | Requires K8s API or agent |
| Jira before identity IdP | **Wrong order** | Workspace/Entra first |

---

## 10. Revised priority roadmap

### Next 30 days
1. [ ] Customer CFN stack update + re-scan (ECR/EKS/ECS)
2. [ ] **Inspector integration** (ECR + EC2 + Lambda)
3. [ ] **EKS logging + encryption checks**
4. [x] **Secure SDLC composite** + GitLab protected environments
5. [x] **Identity governance composite** (extend existing IAM/GitHub signals + admin review)
6. [~] **Backup hardening** (schedule, restore test, RPO/RTO) — **Top 5 internal risk**; AWS snapshot/backup composite shipped; Veritrail platform restore test still open
7. [~] **GitLab connector stability** (token refresh on 401)
8. [x] **Google Workspace / Entra ID** integration
9. [x] **CloudTrail onboarding flow** (use existing vs deploy new)
10. [x] **Vulnerability management composite** (account-wide)
11. [x] **Change management, container vuln, logging composites** (Tier 3)
12. [x] **Full compliance mapping audit** (SOC2 / ISO / CIS + frontend labels)

### Much later
13. [ ] Dockerfile scanning (P3)
14. [ ] Customer Terraform scanning (P4)
15. [ ] Runtime agents / DaemonSets (optional product line)
16. [ ] Jira / Slack / ticketing

---

## 11. What v1 checklist got wrong (review log)

| Issue | Correction |
|-------|------------|
| Missing **Identity governance & access review** composite | Added §1.1 — P0, before DaemonSets |
| Inspector listed ECR only | Expanded to **ECR + EC2 + Lambda** as evidence sources |
| Dockerfile at P2 | Moved to **P3** |
| CloudTrail “auto-provision” as default | Changed to **Use existing OR Deploy new** onboarding |
| Backups listed as P0 but risk understated | Elevated to **Top 5 internal risk** with restore testing |
| Jira/Monday before identity IdP | **Workspace/Entra before Jira** |
| Customer IaC at P2 | Demoted to **P4** |
| No pre-launch mapping audit | Added §8 |
| Individual findings without composite roll-ups | §1 strategic shift — platform not scanner |
| GitHub prod deployment protection | Was implied; now explicit + GitLab gap called out |

### What v1 checklist got right (validated)
- Agentless default; DaemonSet only for runtime claims
- Inspector as evidence, not requirement
- No customer source-code read
- Private EKS API ≠ blocked collection
- Session work (login, ECS, CFN, timeline) accurately captured

---

## 12. Session + chat trace

| Topic | Resolution |
|-------|------------|
| Remember me / Chrome save / sign-out UX | Shipped (uncommitted) |
| ECR/EKS/ECS agentless | Shipped; CFN update required |
| Private EKS clusters | AWS EKS API works |
| Inspector API design | `BatchGetAccountStatus` → `ListCoverage` → `ListFindings` |
| SOC2 requires code scan? | No — SDLC control evidence |
| This checklist | `docs/compliance-expansion-checklist.md` |
| Review pass 2 | Identity composite, Inspector breadth, priorities, CloudTrail onboarding |

---

## 13. Related docs

| Doc | Purpose |
|-----|---------|
| [deepsearch-v6-map.md](./deepsearch-v6-map.md) | IAM / policy-gen |
| [cis-v5-40-controls.md](./cis-v5-40-controls.md) | CIS reference |
| [HANDOFF.md](../HANDOFF.md) | Shipped features |
