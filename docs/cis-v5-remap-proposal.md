# CIS AWS Foundations Benchmark v5.0.0 — remap proposal

Status: **PROPOSAL — not yet applied.** Awaiting review.
Source of truth: AWS Security Hub CSPM "CIS AWS Foundations Benchmark" version-comparison
table (v5.0.0 column). https://docs.aws.amazon.com/securityhub/latest/userguide/cis-aws-foundations-benchmark.html

## Headline finding (changes the plan)

**CIS v5.0.0 demoted the entire §4 Monitoring (CloudWatch metric-filter / alarm) family to
"manual check" — they are no longer automated benchmark controls.** Those are exactly Veritrail's
`cloudtrail.event.*` checks (root usage, IAM changes, CMK delete, SG changes, etc.).

Consequence: in real CIS v5 there is **no automated control ID** to give them. The earlier
interim fix — keep the CloudTrail-event detections on SOC 2 (CC7.x) + ISO (A.12.4.x) and *not*
in the CIS matrix — is therefore **correct for v5**. We will instead surface them as a Veritrail
**"extended"** capability: "CIS v5 marks these monitoring controls manual; Veritrail automates them
via CloudTrail event analysis." (Good differentiator, honestly labelled.)

So this rebuild is about **correcting the v5 numbering** of the controls we *do* automate, not
about adding the event family to CIS.

## Part A — renumber the controls we map cleanly to v5.0.0

Current Veritrail id → correct v5.0.0 id (AWS SecHub control in parens). ✓ = unchanged.

| Veritrail check | now | v5.0.0 | AWS control |
|---|---|---|---|
| aws.account.contact_incomplete | 1.1 | **1.1** ✓ | (CIS 1.1, manual contact details) |
| aws.account.security_contact_missing | 1.2 | **1.2** ✓ | Account.1 |
| iam.root.has_access_keys | 1.3 | **1.3** ✓ | IAM.4 |
| iam.root.no_mfa | 1.4 | **1.4** ✓ | IAM.9 |
| (hardware MFA root, no check) | 1.5 | **1.5** ✓ | IAM.6 |
| iam.user.no_mfa | 1.10 | **1.9** | IAM.5 |
| iam.user.credentials_unused_45d, iam.access_key.unused_45d | 1.11 | **1.11** ✓ | IAM.22 |
| iam.access_key.no_rotation_90d | 1.13 | **1.13** ✓ | IAM.3 |
| iam.account.password_policy_weak (min length) | 1.8 | **1.7** | IAM.15 |
| iam.account.password_policy_weak (reuse) | 1.9 | **1.8** | IAM.16 |
| iam.user.direct_policy_attachment | 1.14 | **1.14** ✓ | IAM.2 |
| iam.account.no_support_role | 1.16 | **1.16** ✓ | IAM.18 |
| iam.server_certificate.expired | 1.18 | **1.18** ✓ | IAM.26 |
| aws.access_analyzer.not_enabled | 1.19 | **1.19** ✓ | IAM.28 |
| iam.cloudshell_full_access_granted | 1.21 | **1.21** ✓ | IAM.27 |
| s3.bucket.no_https_policy | 2.1.1 | **2.1.1** ✓ | S3.5 |
| s3.bucket.no_mfa_delete | 2.1.3 | **2.1.2** | S3.20 |
| s3.account.public_access_not_blocked, s3.bucket.public_access_not_blocked | 2.1.4 | **2.1.4** ✓ | S3.1 / S3.8 |
| rds.instance.no_encryption | 2.3.1 | **2.2.1** | RDS.3 |
| rds.instance.publicly_accessible | 2.3.2 | **2.2.3** | RDS.2 |
| cloudtrail.trail.not_enabled | 3.1 | **3.1** ✓ | CloudTrail.1 |
| cloudtrail.trail.no_log_validation | 3.2 | **3.2** ✓ | CloudTrail.4 |
| aws.config.not_enabled | 3.5 | **3.3** | Config.1 |
| cloudtrail.trail.s3_bucket_no_logging | 3.4 | **3.4** ✓ | CloudTrail.7 |
| cloudtrail.trail.no_kms | 3.3 | **3.5** | CloudTrail.2 |
| kms.key.no_rotation | 3.8 | **3.6** | KMS.4 |
| vpc.flow_logs.not_enabled | 4.3 | **3.7** | EC2.6 |
| ec2.ebs.encryption_not_default | 5.1 | **5.1.1** | EC2.7 |
| ec2.security_group.unrestricted_ssh, ...unrestricted_rdp | 4.1 | **5.3** (+5.4 IPv6) | EC2.53 / EC2.54 |
| ec2.security_group.default_allows_traffic | EC2.2 | **5.5** | EC2.2 |
| ec2.instance.imdsv2_not_required | 4.4 | **5.7** | EC2.8 |

## Part B — controls with no automated v5.0.0 home (CIS removed or made manual)

Recommend tagging these **`extended`** (Veritrail checks beyond the v5 automated benchmark), kept
out of the 42-row matrix. They still contribute to SOC 2 / ISO where mapped.

| Veritrail check | now | why no v5 id | proposed |
|---|---|---|---|
| iam.root.usage | 1.6 | "avoid root" (IAM.20) removed; root-usage is manual CloudWatch.1 | extended |
| iam.access_key.multiple_active | 1.12 | not in v5 automated set | extended |
| iam.role.full_admin_policy | 1.15 | IAM.1 (full-admin policy) unsupported in v5 | extended |
| (instance roles, no check) | 1.17 | not automated; no Veritrail check | **drop** |
| iam.account.password_policy_weak (expiry) | 1.20 | IAM.17 password-expiry removed in v5 | **drop** (dup check) |
| iam.role.full_admin_policy | 1.22 | duplicate of 1.15 mapping | **drop** (dup) |
| s3.bucket.no_default_encryption | 2.1.2 | S3 default encryption now always-on; dropped | extended |
| ec2.ebs.volume_unencrypted | 2.2.1 | per-volume EBS enc not a v5 automated control (5.1.1 is account default) | extended |
| rds.instance.no_automated_backup | 2.3.3 | not in v5 automated set | extended |
| cloudtrail.trail.s3_bucket_public | 3.6 | CloudTrail.6 removed in v5 | extended |

## Part C — files to change (on approval)

1. `api/data/control_mappings.json` — apply Part A renumbers; retag Part B as `extended`
   (or drop the 3 marked drop).
2. `api/data/cis_v5_level1_matrix.json` — rebuild to the real 42-row v5.0.0 Level-1 list with
   correct ids/titles (matrix currently mis-numbers §4/§5).
3. `api/app/data/control_narratives.py` + `api/app/services/control_reference_urls.py` —
   rekey narratives/reference URLs to the new ids.
4. `api/tests/test_cis_benchmark_coverage.py` — update `CIS_V5_LEVEL1_TOTAL` / budget to the
   rebuilt matrix.
5. Re-seed; re-run suite.

## Open decisions for you

1. **Part B "extended" vs "drop"** — OK to keep the 7 as `extended` and drop the 3 dups/empties?
2. **§5.4 (IPv6 admin-port)** — split the SSH/RDP check into 5.3 (IPv4) + 5.4 (IPv6), or map the
   single check to 5.3 only?
3. **Scope** — do the full matrix rebuild now, or land Part A renumbers first (smaller) and do
   the 42-row matrix rebuild separately?
