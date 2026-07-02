# Hetzner VPS identity with Vault PKI + AWS IAM Roles Anywhere

This runbook is for running Veritrail outside AWS, for example on Hetzner, while still using short-lived AWS credentials instead of static IAM user keys.

```text
Hetzner VPS
  -> local Vault OSS PKI issues a client certificate
  -> aws_signing_helper uses that certificate
  -> IAM Roles Anywhere returns temporary STS credentials
  -> Veritrail uses AWS_PROFILE to call sts:AssumeRole into customer accounts
```

## Do I need a HashiCorp signup?

No. The bootstrap installs **Vault OSS** from HashiCorp's apt repository. No HCP Vault, Terraform Cloud, or HashiCorp account is required.

## Do I need the AWS account ID?

Not necessarily.

If the VPS already has temporary AWS bootstrap credentials, the script auto-detects the account ID with:

```bash
aws sts get-caller-identity
```

If not, pass it explicitly:

```bash
sudo AWS_ACCOUNT_ID=123456789012 AWS_REGION=eu-west-1 \
  ./scripts/bootstrap-hetzner-vault-rolesanywhere.sh
```

## Bootstrap modes

### Full setup

Use this when the VPS has temporary AWS admin/bootstrap credentials available for the initial setup.

```bash
sudo AWS_REGION=eu-west-1 \
  ASSUMABLE_ROLE_RESOURCE='arn:aws:iam::*:role/VeritrailCustomerScannerRole-*' \
  ./scripts/bootstrap-hetzner-vault-rolesanywhere.sh
```

The script creates or reuses:

- Vault OSS service on `127.0.0.1:8200`
- Vault PKI root CA
- VPS client certificate and private key under `/etc/veritrail/aws-ra/`
- IAM Roles Anywhere trust anchor
- IAM role trusted by Roles Anywhere
- IAM Roles Anywhere profile
- AWS CLI profile, default name: `veritrail-ra`
- `AWS_PROFILE` and `TRUST_PRINCIPAL_ARN` in `.env`

### Local-only setup

Use this if you want to prepare Vault and the VPS certificate first, but create AWS resources later.

```bash
sudo ./scripts/bootstrap-hetzner-vault-rolesanywhere.sh --skip-aws
```

Then re-run without `--skip-aws` once AWS bootstrap credentials are available.

## Important variables

| Variable | Default | Purpose |
|---|---:|---|
| `AWS_REGION` | `eu-west-1` | Region for IAM Roles Anywhere resources |
| `AWS_ACCOUNT_ID` | auto-detected | AWS control-plane account ID |
| `AWS_PROFILE_NAME` | `veritrail-ra` | Local AWS profile name written to `~/.aws/config` |
| `ENV_FILE` | `.env` | Veritrail env file to update |
| `RA_ROLE_NAME` | `VeritrailControlPlaneRole` | IAM role assumed through Roles Anywhere |
| `ASSUMABLE_ROLE_RESOURCE` | `*` | Which customer scanner roles Veritrail may assume |
| `CERT_TTL` | `720h` | VPS client certificate lifetime |

## Security notes

### Avoid `ASSUMABLE_ROLE_RESOURCE='*'` in production

The default is intentionally permissive so the bootstrap works before final role naming is settled. For production, set a tight role ARN pattern, for example:

```bash
ASSUMABLE_ROLE_RESOURCE='arn:aws:iam::*:role/VeritrailCustomerScannerRole-*'
```

### Protect Vault recovery material

The script writes Vault unseal/root-token material to:

```text
/root/veritrail-vault-init.json
```

Back it up securely. After that, remove it from the VPS if you have another recovery path.

### Protect the client key

The private key used for IAM Roles Anywhere is:

```text
/etc/veritrail/aws-ra/client.key
```

It is created with `0600` permissions. Treat it like a production credential, even though it only works with the IAM Roles Anywhere trust/profile/role you configured.

## Rotate the VPS certificate

Automatic: when IAM Roles Anywhere is enabled, bootstrap installs a daily cron job
(`scripts/renew-vault-client-cert.sh`) that re-issues the Vault client cert when it
expires within 7 days and recreates `api`/`worker`/`beat`.

Manual (immediate rotation):

```bash
sudo ./scripts/bootstrap-hetzner-vault-rolesanywhere.sh --force-cert --skip-aws --skip-env
```

Or use the renewal helper directly:

```bash
sudo RENEW_WITHIN_DAYS=365 ./scripts/renew-vault-client-cert.sh
```

Restart the Veritrail services after rotation if they keep long-running AWS SDK clients:

```bash
docker compose up -d --force-recreate api worker beat
```

## Verify manually

```bash
AWS_PROFILE=veritrail-ra aws sts get-caller-identity
```

Expected result: the returned ARN should be the IAM role created for the Hetzner control plane.

## Relationship to customer roles

This does **not** replace customer account CloudFormation stacks.

Instead, it replaces the EC2 instance profile side of the control plane:

```text
Before:
EC2 instance profile role -> sts:AssumeRole -> customer scanner role

After:
Hetzner cert -> IAM Roles Anywhere -> control-plane role -> sts:AssumeRole -> customer scanner role
```
