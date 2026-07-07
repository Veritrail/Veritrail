#!/bin/sh
set -e

LOCKFILE=/app/package-lock.json
STAMP=/app/node_modules/.package-lock.sha256

if [ -f "$LOCKFILE" ]; then
  CURRENT=$(sha256sum "$LOCKFILE" | awk '{print $1}')
  if [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$CURRENT" ]; then
    echo "package-lock.json changed — installing dependencies..."
    npm ci
    echo "$CURRENT" > "$STAMP"
  fi
else
  npm install
fi

exec "$@"
