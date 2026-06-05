# Customer-account remediation (SSM Automation)

Vigil's scanner stays read-only unless the customer explicitly enables remediation modules.
Approved fixes run through AWS Systems Manager Automation in the customer account. Vigil
prefers AWS-owned runbooks where they fit the finding exactly, and uses a small custom SSM
document only when extra guardrails are needed.

## Architecture

```
Vigil UI -> review -> explicit Start remediation -> ssm:StartAutomationExecution (automation_region)
-> AWS-owned runbook or Vigil guardrail document
-> SSM Automation assumes customer remediation role
-> document applies the approved action in resource_region (same region for EC2/SSM resources)
```

- **No dynamic IAM attach**: write permissions are static on the customer-owned automation role.
- **AWS-native execution**: execution history and output live in Systems Manager.
- **Regions**: `resource_region` is where the affected resource lives. `automation_region` is where `StartAutomationExecution` runs. **AWS-owned runbooks** use `resource_region`. **Vigil custom documents** deploy through the remediation nested CloudFormation stack in `REMEDIATION_AUTOMATION_REGION`; `PlanJson` includes `resource_region` for regional API calls (EC2, SSM, IAM).
- **Exact-match revoke**: security-group fixes only remove tuples from `exact_match_rules`; returns `stale_plan` if live rules drifted.
- **No custom Lambda runner**: SSM owns execution, audit trail, and output.

## Deploy (connector-first)

1. **Update the Vigil connector stack** (`vigil-stack` / core scanner) with SSM remediation modules enabled.
   The connector role receives scoped `ssm:DescribeDocument`, `ssm:GetDocument`,
   `ssm:StartAutomationExecution`, `ssm:GetAutomationExecution`, and `iam:PassRole` for
   `VigilRemediationAutomationRole` only.

2. **Publish templates and handler scripts to S3** before deploying or updating the customer stack:

```bash
./scripts/upload-cfn.sh
```

3. **Deploy or update the parent connector stack** (`VigilAccountConnector`) with the desired `Enable*Remediation` parameters. The parent stack creates the remediation nested stack, which creates the customer-owned automation role and the Vigil SSM documents via `AWS::SSM::Document`.

AWS-owned runbooks (S3 public access, CloudTrail) do not create Vigil documents, but the connector still needs the remediation permissions and `iam:PassRole` for the customer-owned automation role.

Set Vigil `REMEDIATION_AUTOMATION_REGION=us-east-1` to the automation home region.

## Console: empty `stackName` validation error

AWS documents quick-create links for **create** only (`#/stacks/create/review`). Update wizard
URLs (`#/stacks/update/review` or `update/template`) often drop `stackName` and fail with
`Value '' at 'stackName'`. Vigil no longer uses those links: **Manage capabilities → CLI**
(one command) or **Open stack in console** (filtered list) then Update → Replace template →
paste the template URL from **Copy template URL**.

## Console: "Failed to load stack policy"

This is **not** a bad `vigil-stack.yaml` body. The CloudFormation console calls
`cloudformation:GetStackPolicy` on your existing stack before it will continue an update.
If your IAM user/role lacks that action (common with custom admin policies or SCPs), the
wizard stops on **Specify template** with that red banner.

**Workaround:** use the CLI from Vigil Accounts → Manage capabilities → CLI (includes
`--stack-name` and module parameters), or add to your role:

- `cloudformation:GetStackPolicy`
- `cloudformation:DescribeStacks`
- `cloudformation:GetTemplateSummary`
- `cloudformation:UpdateStack`

Templates on S3 must stay in sync: run `./scripts/upload-cfn.sh` (incremental `aws s3 sync` per folder) to publish `infra/cfn/` under `infra/<release>/`, SSM handler scripts under `infra/<release>/ssm-scripts/`, and latest aliases. Upload templates with
`Content-Type: text/yaml` (see `.env.example`).

## Supported Actions

| Check | SSM action |
|-------|------------|
| `ec2.security_group.unrestricted_ssh` | Revoke exact public SSH ingress from the finding plan |
| `ec2.security_group.unrestricted_rdp` | Revoke exact public RDP ingress from the finding plan |
| `ssm.parameter.plaintext_secret` | Rewrite plaintext `String` parameter as `SecureString` |
| `iam.access_key.unused_45d` / `unused_90d` | Deactivate access key (`Inactive`) via plan executor |
| `s3.bucket.public_access_not_blocked` | AWS-owned runbook enables all four Block Public Access settings |
| `cloudtrail.trail.not_enabled` | Guided AWS-owned runbook; requires customer-provided `S3BucketName` and `TrailName` |

AWS-owned runbook mappings are tracked in `api/app/services/ssm_remediation_catalog.py`.
They should be wired only when Vigil can provide the document's required parameters safely.

IAM policy findings (`iam.role.full_admin_policy`, `iam.policy.wildcard_resource`) are intentionally analysis-first.
Vigil can generate least-privilege candidates and Terraform/PR guidance, but it does not offer one-click SSM
policy detachment/replacement because workload impact must be reviewed against observed usage.

Lambda service findings are detected and documented, but not auto-executed yet:

- `lambda.function.deprecated_runtime` needs an approved target runtime.
- `lambda.function.no_dlq` needs an approved DLQ ARN.

Those should become plan inputs before being automated.

## Plan Fields

| Field | Purpose |
|-------|---------|
| `resource_region` | AWS API region for the affected resource |
| `execution.runner_type` | `ssm` |
| `execution.document_name` | SSM document to execute |
| `exact_match_rules` | Security-group CIDR/protocol/port tuples to revoke |
| `expires_at` | Reject expired plans |
| `content_sha256` | Tamper detection |
| `approval` | Added only by `POST .../remediation/dispatch` |

## Execute

`POST /v1/findings/{id}/remediation/dispatch` starts SSM Automation when the connected
role has the optional remediation permissions and the CloudFormation-managed SSM document exists. The UI also shows a CLI fallback:

```bash
aws ssm start-automation-execution \
  --region us-east-1 \
  --document-name Vigil-RevokeSecurityGroupIngressExact \
  --parameters '{"PlanJson":["{...approved plan json...}"]}'
```

Always re-scan before preparing a plan, then re-scan after successful remediation.

## Troubleshooting

| Symptom | Cause |
|--------|-------|
| Poll step fails: `Invalid Input - When attachment is provided only, Handler should be [file].[function]` | `aws:executeScript` used `Handler: handler` instead of `Handler: <script_basename>.handler` (must match `Attachment` without `.py`, e.g. `revoke_sg_ingress.handler` for `revoke_sg_ingress.py`). Update `vigil-remediation-ssm` nested stack so documents get a new version. |
| `InvalidDocument` | SSM template not deployed in the automation region |
| `plan_expired` / `content_sha256_mismatch` | Old or edited payload; prepare a fresh plan |
| `stale_plan` | Resource changed since scan; re-scan and prepare a new plan |
| `InvalidGroup.NotFound` | Wrong `resource_region` or stale security-group id |
| `AccessDenied` | Automation role lacks the module permission or resource policy blocks it |
