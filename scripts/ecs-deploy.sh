#!/usr/bin/env bash
# Build, push, and register Vigil ECS task definitions.
# Prereq: control-plane stack deployed (infra/ecs/cloudformation/control-plane.yaml).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

: "${AWS_REGION:?Set AWS_REGION}"
: "${ENVIRONMENT_NAME:=vigil-prod}"
: "${IMAGE_TAG:=$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d)}"
: "${VITE_API_URL:?Set VITE_API_URL e.g. https://api.vigil.example.com}"

API_REPO="${API_ECR_URI:?Set API_ECR_URI from stack output ApiEcrUri}"
WEB_REPO="${WEB_ECR_URI:?Set WEB_ECR_URI from stack output WebEcrUri}"

echo "==> Logging in to ECR"
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "${API_REPO%%/*}"

echo "==> Building API image"
docker build -f api/Dockerfile.prod -t "${API_REPO}:${IMAGE_TAG}" -t "${API_REPO}:latest" .
docker push "${API_REPO}:${IMAGE_TAG}"
docker push "${API_REPO}:latest"

echo "==> Building web image"
docker build -f web/Dockerfile.prod --build-arg VITE_API_URL="$VITE_API_URL" \
  -t "${WEB_REPO}:${IMAGE_TAG}" -t "${WEB_REPO}:latest" .
docker push "${WEB_REPO}:${IMAGE_TAG}"
docker push "${WEB_REPO}:latest"

register_task() {
  local name="$1" template="$2"
  local out="/tmp/vigil-task-${name}.json"
  sed \
    -e "s|__EXECUTION_ROLE_ARN__|${EXECUTION_ROLE_ARN}|g" \
    -e "s|__TASK_ROLE_ARN__|${TASK_ROLE_ARN}|g" \
    -e "s|__APP_SECRET_ARN__|${APP_SECRET_ARN}|g" \
    -e "s|__AWS_REGION__|${AWS_REGION}|g" \
    -e "s|__API_IMAGE__|${API_REPO}:${IMAGE_TAG}|g" \
    -e "s|__WEB_IMAGE__|${WEB_REPO}:${IMAGE_TAG}|g" \
    "$template" > "$out"
  aws ecs register-task-definition --cli-input-json "file://${out}" --region "$AWS_REGION" >/dev/null
  echo "Registered task definition: vigil-${name}"
}

: "${EXECUTION_ROLE_ARN:?}"
: "${TASK_ROLE_ARN:?}"
: "${APP_SECRET_ARN:?}"

register_task api infra/ecs/task-definitions/api.json
register_task worker infra/ecs/task-definitions/worker.json
register_task beat infra/ecs/task-definitions/beat.json
register_task web infra/ecs/task-definitions/web.json

echo "Done. Update ECS services to the new task definition revisions, or run:"
echo "  aws ecs update-service --cluster ${ECS_CLUSTER:-$ENVIRONMENT_NAME} --service vigil-api --task-definition vigil-api --force-new-deployment"
