#!/usr/bin/env bash
set -euo pipefail

echo "DEPRECATED: bootstrap/certbot-init.sh — use scripts/bootstrap-ec2.sh instead" >&2
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/bootstrap-ec2.sh" "$@"
