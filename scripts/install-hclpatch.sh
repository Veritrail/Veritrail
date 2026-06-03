#!/usr/bin/env bash
# install-hclpatch.sh — build and install the Go hclpatch binary for local dev.
#
# The Docker build already compiles hclpatch (see api/Dockerfile multi-stage),
# but local development runs Python directly and needs the binary available.
# Run once after cloning the repo or when the Go source changes.
#
# Usage: ./scripts/install-hclpatch.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BINARY="$REPO_ROOT/tools/hclpatch"
DEST="/usr/local/bin/hclpatch"

# Idempotent: skip if the binary already exists and is up to date.
if [ -x "$DEST" ]; then
  echo "hclpatch already installed at $DEST — checking if up to date…"
  # Compare modification times of source vs installed binary.
  if [ "$BINARY/main.go" -ot "$DEST" ]; then
    echo "Binary is up to date. Nothing to do."
    exit 0
  fi
  echo "Source changed, rebuilding…"
fi

echo "Building hclpatch from $BINARY …"
cd "$BINARY"
go build -o /usr/local/bin/hclpatch .

echo "✅ hclpatch installed to $DEST"
echo "   Verify with: hclpatch --help"
