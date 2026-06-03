# Remediation (customer-hosted)

Vigil stays **read-only** for scanning. Remediation execution runs in the customer AWS account through AWS Systems Manager Automation.

## Flow

1. Open a finding -> **Remediation plan** (`GET /v1/findings/{id}/remediation-plan`).
2. Review Console/CLI/IaC/Automation steps in the UI.
3. Prepare approved automation (`POST /v1/findings/{id}/remediation/dispatch`).
4. Vigil starts `ssm:StartAutomationExecution` through the scoped connector permissions, or the UI shows a CLI fallback.
5. SSM Automation assumes the customer-owned remediation role and applies only supported actions from the plan.

## Customer Infrastructure

Deploy or update the parent `VigilAccountConnector` CloudFormation stack with the remediation modules enabled. The parent stack launches `infra/cfn/vigil-remediation-ssm.yaml` as a nested stack in the automation home region. It creates:

- `VigilRemediationAutomationRole`
- `Vigil-RevokeSecurityGroupIngressExact`
- `Vigil-DeactivateIamAccessKey`
- `Vigil-MigrateSsmParameterToSecureString`
- `Vigil-RemediateIamExcessPermissions`

Do not deploy SSM documents with direct `aws ssm create-document` commands for customer installs; the supported path is CloudFormation through the connector stack.

## IaC / PRs

Generated Terraform snippets and repo-aware PRs remain declarative only. Live resource mutation should go through SSM Automation, Console, or CLI.
