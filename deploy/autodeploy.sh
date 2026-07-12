#!/usr/bin/env bash
# Poll-based auto-deploy for the dev box.
#
# Checks whether origin/dev moved; if so, fast-forwards and reruns the stack.
# Designed to run from cron every minute — cheap no-op when nothing changed.
#
# Install (one time, on the VM):
#   crontab -e
#   * * * * * /path/to/Veritrail/deploy/autodeploy.sh >> $HOME/autodeploy.log 2>&1
#
# The rerun step prefers ~/deploy.sh (put the body of the `d` alias there,
# minus the git pull — aliases don't exist in cron's non-interactive shell).
# Without it, falls back to `docker compose up -d --build`.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${AUTODEPLOY_BRANCH:-dev}"
LOCK_FILE="/tmp/veritrail-autodeploy.lock"

# One deploy at a time — a build can outlive the 1-minute cron interval.
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

cd "$REPO_DIR"
git fetch origin "$BRANCH" --quiet
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"
[ "$LOCAL" = "$REMOTE" ] && exit 0

echo "[$(date -Is)] deploying ${LOCAL:0:8} -> ${REMOTE:0:8}"
git pull --ff-only origin "$BRANCH"

if [ -x "$HOME/deploy.sh" ]; then
  "$HOME/deploy.sh"
else
  docker compose up -d --build
fi

echo "[$(date -Is)] deploy done at $(git rev-parse --short HEAD)"
