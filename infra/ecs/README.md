# Vigil on ECS Fargate

Deploy the Vigil **control plane** on ECS Fargate. Reuse the VPC/subnets from your existing EKS cluster — Vigil does not need to run on Kubernetes.

## Why ECS instead of EKS for Vigil

| | EKS | ECS Fargate |
|---|-----|-------------|
| Fit for Vigil | Heavy (Compose app, no k8s manifests) | Native fit (api + worker + beat + static web) |
| Idle cost | Control plane + nodes always on | Scale services to **desired count 0** |
| Ops | Helm, ingress, cert-manager | ALB + task definitions |
| Your EKS | Keep it for other workloads | Run Vigil alongside in same VPC |

## Architecture

```
Route53 → ALB (host: api.* / vigil.*)
              ├── ECS service: vigil-api   (Fargate)
              ├── ECS service: vigil-web   (nginx + Vite build)
              ├── ECS service: vigil-worker
              └── ECS service: vigil-beat
                        │
            RDS Postgres + ElastiCache Redis (private subnets)
                        │
            Task IAM role → sts:AssumeRole → customer VigilScannerRole
```

## 1. Deploy infrastructure

```bash
aws cloudformation deploy \
  --template-file infra/ecs/cloudformation/control-plane.yaml \
  --stack-name vigil-control-plane \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    EnvironmentName=vigil-prod \
    VpcId=vpc-xxxx \
    PrivateSubnetIds=subnet-a,subnet-b \
    PublicSubnetIds=subnet-c,subnet-d \
    ApiHostname=api.vigil.example.com \
    WebHostname=vigil.example.com \
    CertificateArn=arn:aws:acm:... \
    DbPassword='...'
```

Point DNS `api.*` and `vigil.*` CNAMEs at stack output `AlbDnsName`.

## 2. Fill app secret

Stack creates `vigil-prod/app` in Secrets Manager with placeholders. Update with real values:

```json
{
  "APP_ENV": "production",
  "APP_SECRET": "...",
  "JWT_SECRET": "...",
  "ENCRYPTION_KEY": "...",
  "TRUST_PRINCIPAL_ARN": "<TaskRoleArn from stack>",
  "API_PUBLIC_URL": "https://api.vigil.example.com",
  "FRONTEND_URL": "https://vigil.example.com",
  "DATABASE_URL": "postgresql+psycopg://hygiene:...@...:5432/hygiene",
  "REDIS_URL": "redis://...:6379/0",
  "CFN_TEMPLATE_URL": "https://your-bucket.s3.../infra/vigil-stack.yaml",
  "RESEND_API_KEY": "...",
  "GITHUB_CLIENT_ID": "...",
  "GITHUB_CLIENT_SECRET": "..."
}
```

`TRUST_PRINCIPAL_ARN` **must** be the ECS **task role** ARN so customer CFN trust policies work.

## 3. Build and push images

```bash
export AWS_REGION=us-east-1
export VITE_API_URL=https://api.vigil.example.com
export API_ECR_URI=$(aws cloudformation describe-stacks --stack-name vigil-control-plane \
  --query "Stacks[0].Outputs[?OutputKey=='ApiEcrUri'].OutputValue" --output text)
export WEB_ECR_URI=$(aws cloudformation describe-stacks --stack-name vigil-control-plane \
  --query "Stacks[0].Outputs[?OutputKey=='WebEcrUri'].OutputValue" --output text)
export EXECUTION_ROLE_ARN=...
export TASK_ROLE_ARN=...
export APP_SECRET_ARN=...

./scripts/ecs-deploy.sh
```

## 4. Create ECS services (first time)

```bash
CLUSTER=vigil-prod
SUBNETS=subnet-a,subnet-b
SG=sg-xxxx   # TaskSecurityGroupId
API_TG=arn:aws:elasticloadbalancing:...
WEB_TG=arn:aws:elasticloadbalancing:...

aws ecs create-service --cluster $CLUSTER --service-name vigil-api \
  --task-definition vigil-api --desired-count 1 --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=$API_TG,containerName=api,containerPort=8000"

aws ecs create-service --cluster $CLUSTER --service-name vigil-web \
  --task-definition vigil-web --desired-count 1 --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=$WEB_TG,containerName=web,containerPort=80"

aws ecs create-service --cluster $CLUSTER --service-name vigil-worker \
  --task-definition vigil-worker --desired-count 1 --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=DISABLED}"

aws ecs create-service --cluster $CLUSTER --service-name vigil-beat \
  --task-definition vigil-beat --desired-count 1 --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=DISABLED}"
```

## 5. Park when not in use (scale to zero)

```bash
for svc in vigil-api vigil-web vigil-worker vigil-beat; do
  aws ecs update-service --cluster vigil-prod --service "$svc" --desired-count 0
done
```

**Still billed while parked:** RDS, ElastiCache, ALB, NAT gateway. To minimize cost:
- Snapshot RDS → stop/delete instance for long idle periods
- Consider ElastiCache Serverless or accept ~$12/mo for `cache.t4g.micro`

**Wake up:**

```bash
for svc in vigil-api vigil-web vigil-worker vigil-beat; do
  aws ecs update-service --cluster vigil-prod --service "$svc" --desired-count 1
done
```

## 6. Customer CFN

Unchanged. Customers deploy `vigil-stack.yaml` in their account. Update `TRUST_PRINCIPAL_ARN` in the launched stack to your ECS task role ARN (same as pre-filled in onboarding when secret is correct).

## Files

| Path | Purpose |
|------|---------|
| `api/Dockerfile.prod` | API / worker / beat image |
| `web/Dockerfile.prod` | Static web + nginx |
| `infra/ecs/task-definitions/*.json` | Fargate task defs |
| `infra/ecs/cloudformation/control-plane.yaml` | Cluster, ECR, ALB, RDS, Redis, IAM |
| `scripts/ecs-deploy.sh` | Build, push, register tasks |
