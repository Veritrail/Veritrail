#!/usr/bin/env bash
# Verify a pg_dump custom-format archive without restoring data.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup.dump>" >&2
  exit 1
fi

DUMP="$1"
if [[ ! -f "$DUMP" ]]; then
  echo "File not found: $DUMP" >&2
  exit 1
fi

echo "Listing archive contents..."
pg_restore --list "$DUMP" > /dev/null

echo "OK: backup archive is readable ($(stat -f%z "$DUMP" 2>/dev/null || stat -c%s "$DUMP") bytes)"
