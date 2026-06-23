#!/usr/bin/env bash
# Lightweight launch smoke checks for a running Veritrail deployment.
set -euo pipefail

WEB_URL="${WEB_URL:-${FRONTEND_URL:-http://127.0.0.1:5173}}"
API_URL="${API_URL:-${API_PUBLIC_URL:-http://127.0.0.1:8000}}"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

check_status() {
  local label="$1"
  local url="$2"
  local want="${3:-200}"
  local status
  status="$(curl -ksS -o /dev/null -w "%{http_code}" "$url")" || fail "$label request failed: $url"
  [[ "$status" == "$want" ]] || fail "$label returned HTTP $status, expected $want: $url"
  echo "OK: $label ($status)"
}

check_body() {
  local label="$1"
  local url="$2"
  local pattern="$3"
  local body
  body="$(curl -ksS "$url")" || fail "$label request failed: $url"
  grep -qi "$pattern" <<<"$body" || fail "$label did not contain '$pattern': $url"
  echo "OK: $label contains '$pattern'"
}

echo "Smoke target:"
echo "  WEB_URL=$WEB_URL"
echo "  API_URL=$API_URL"

check_body "API health" "$API_URL/healthz" '"ok"[[:space:]]*:[[:space:]]*true'
check_status "frontend login" "$WEB_URL/login"
check_status "privacy route" "$WEB_URL/privacy"
check_status "terms route" "$WEB_URL/terms"
check_status "sample evidence pack" "$API_URL/v1/exports/sample-evidence-pack?framework=soc2"

echo "OK: launch smoke checks passed"
echo "Note: run the Playwright smoke suite to assert rendered SPA content:"
echo "  cd web && PLAYWRIGHT_BASE_URL=$WEB_URL npm run smoke:e2e"
