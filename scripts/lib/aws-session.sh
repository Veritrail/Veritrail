# shellcheck shell=bash
# AWS CLI helpers for S3 publish scripts.
# Default: hardcoded keys from repo-root upload-cfn.credentials.sh (gitignored).
# Override: export AWS_PROFILE=… and remove/rename the credentials file to use SSO instead.

_PUBLISH_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERITRAIL_PUBLISH_CRED_MODE=""

load_publish_credentials() {
  local creds_file="${VERITRAIL_PUBLISH_CREDS_FILE:-${_PUBLISH_REPO_ROOT}/upload-cfn.credentials.sh}"

  if [ -f "${creds_file}" ]; then
    # shellcheck disable=SC1090
    source "${creds_file}"
    unset AWS_PROFILE
    export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
    export AWS_REGION="${AWS_REGION:-us-east-1}"
    VERITRAIL_PUBLISH_CRED_MODE="static"
    return 0
  fi

  VERITRAIL_PUBLISH_CRED_MODE="profile"
}

aws_cli() {
  if [ "${VERITRAIL_PUBLISH_CRED_MODE}" = "static" ]; then
    aws "$@"
    return
  fi
  if [ -n "${AWS_PROFILE:-}" ]; then
    aws --profile "${AWS_PROFILE}" "$@"
  else
    aws "$@"
  fi
}

require_aws_session() {
  load_publish_credentials

  if ! command -v aws >/dev/null 2>&1; then
    echo "ERROR: aws CLI not found." >&2
    exit 1
  fi

  local err_file
  err_file="$(mktemp)"
  if ! aws_cli sts get-caller-identity --output json >"${err_file}" 2>&1; then
    echo "ERROR: No valid AWS credentials for the CLI." >&2
    cat "${err_file}" >&2
    rm -f "${err_file}"
    echo "" >&2
    if [ "${VERITRAIL_PUBLISH_CRED_MODE}" = "static" ]; then
      echo "  Check upload-cfn.credentials.sh (access key / secret / region)." >&2
    else
      echo "  Add upload-cfn.credentials.sh or set AWS_PROFILE + aws sso login." >&2
    fi
    exit 1
  fi
  rm -f "${err_file}"

  local account arn
  account="$(aws_cli sts get-caller-identity --query Account --output text)"
  arn="$(aws_cli sts get-caller-identity --query Arn --output text)"
  echo "AWS session: account ${account}"
  if [ "${VERITRAIL_PUBLISH_CRED_MODE}" = "static" ]; then
    echo "  credentials: upload-cfn.credentials.sh"
  elif [ -n "${AWS_PROFILE:-}" ]; then
    echo "  profile: ${AWS_PROFILE}"
  else
    echo "  profile: (default credential chain)"
  fi
  echo "  arn:     ${arn}"
  echo ""
}
